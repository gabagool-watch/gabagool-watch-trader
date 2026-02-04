/**
 * position-cache.ts
 * ============================================================
 * PROFESSIONAL-GRADE POSITION CACHE
 * 
 * This module provides a fast, always-fresh cache of Polymarket positions.
 * The cache is the SINGLE SOURCE OF TRUTH for the bot's trading decisions.
 * 
 * Key principles:
 * 1. Cache is refreshed from Polymarket API every 1 second
 * 2. Before any trade decision, verify cache is < 2s old
 * 3. If drift detected between local fills and cache, HALT trading
 * 4. All position reads go through this cache, never from local tracking
 * 
 * This prevents the bot from making decisions on stale/incorrect position data.
 * 
 * CRITICAL FIX (v7.4.1): The runner uses epoch-based slugs like "btc-updown-15m-1767294000"
 * while the Data API may return different eventSlugs or none at all. We now build a
 * conditionId → runnerSlug mapping so positions are always matched correctly.
 */

import { config } from './config.js';

const DATA_API_URL = 'https://data-api.polymarket.com';

// ============================================================
// TYPES
// ============================================================

export interface CachedPosition {
  tokenId: string;
  conditionId: string;
  marketSlug: string;
  outcome: 'UP' | 'DOWN';
  shares: number;
  avgPrice: number;
  cost: number;
  currentValue: number;
  currentPrice: number;
  pnl: number;
}

export interface MarketPositionCache {
  marketSlug: string;
  asset: string;
  upShares: number;
  downShares: number;
  upCost: number;
  downCost: number;
  upAvgPrice: number;
  downAvgPrice: number;
  lastFetchedAtMs: number;
}

export interface PositionCacheState {
  positions: Map<string, MarketPositionCache>;  // keyed by marketSlug (runner's slug)
  allPositions: CachedPosition[];
  lastRefreshAtMs: number;
  lastRefreshDurationMs: number;
  refreshCount: number;
  errorCount: number;
  lastError: string | null;
  isHealthy: boolean;
}

export interface PositionDrift {
  detected: boolean;
  marketSlug: string;
  asset: string;
  localUp: number;
  localDown: number;
  cacheUp: number;
  cacheDown: number;
  driftUp: number;
  driftDown: number;
  reason: string;
}

// ============================================================
// SLUG MAPPING (CRITICAL for correct position matching)
// ============================================================
// The runner uses epoch-based slugs like "btc-updown-15m-1767294000"
// The Data API may return different slugs or none at all.
// This map allows the runner to register its markets so we can match
// positions by conditionId OR tokenId.

// Maps: conditionId -> runnerSlug
const conditionIdToSlug = new Map<string, string>();
// Maps: tokenId -> { slug, side }
// NOTE: include conditionId to prevent tokenId reuse / overwrites from mis-attributing positions
// across market windows.
const tokenIdToSlug = new Map<
  string,
  { slug: string; side: 'UP' | 'DOWN'; conditionId: string }
>();

// Track which runner slugs are currently active/registered.
// This lets us safely use API slug fallback ONLY when it refers to an active market.
const registeredSlugs = new Set<string>();

/**
 * Register a market from the runner so we can match positions correctly.
 * Call this whenever the runner discovers a new market.
 */
export function registerMarketForCache(
  runnerSlug: string,
  conditionId: string,
  upTokenId: string,
  downTokenId: string
): void {
  if (runnerSlug) {
    registeredSlugs.add(runnerSlug);
  }
  if (conditionId) {
    conditionIdToSlug.set(conditionId, runnerSlug);
  }
  if (upTokenId) {
    tokenIdToSlug.set(upTokenId, { slug: runnerSlug, side: 'UP', conditionId });
  }
  if (downTokenId) {
    tokenIdToSlug.set(downTokenId, { slug: runnerSlug, side: 'DOWN', conditionId });
  }
}

/**
 * Unregister a market when it expires.
 */
export function unregisterMarketFromCache(
  conditionId: string,
  upTokenId: string,
  downTokenId: string
): void {
  if (conditionId) {
    const slug = conditionIdToSlug.get(conditionId);
    if (slug) registeredSlugs.delete(slug);
    conditionIdToSlug.delete(conditionId);
  }
  if (upTokenId) tokenIdToSlug.delete(upTokenId);
  if (downTokenId) tokenIdToSlug.delete(downTokenId);
}

// ============================================================
// CACHE STATE
// ============================================================

const cacheState: PositionCacheState = {
  positions: new Map(),
  allPositions: [],
  lastRefreshAtMs: 0,
  lastRefreshDurationMs: 0,
  refreshCount: 0,
  errorCount: 0,
  lastError: null,
  isHealthy: false,
};

// Cache configuration
const CACHE_CONFIG = {
  maxStaleMs: 2000,           // Max age before cache is considered stale
  refreshIntervalMs: 1000,    // How often to refresh (1 second)
  driftThreshold: 0.5,        // Shares difference to trigger drift warning (allow rounding)
  driftHaltThreshold: 5,      // Shares difference to HALT trading (serious mismatch)
  maxConsecutiveErrors: 5,    // Errors before marking cache unhealthy
  fetchTimeoutMs: 3000,       // API timeout
};

let refreshInterval: NodeJS.Timeout | null = null;
let isRefreshing = false;

// ============================================================
// FETCH POSITIONS FROM POLYMARKET
// ============================================================

interface RawPosition {
  tokenId: string;
  conditionId: string;
  apiSlug: string | null;  // Slug from API (may differ from runner's slug)
  outcome: 'UP' | 'DOWN';
  shares: number;
  avgPrice: number;
  cost: number;
  currentValue: number;
  currentPrice: number;
  pnl: number;
}

async function fetchPositionsFromApi(walletAddress: string): Promise<RawPosition[]> {
  const positions: RawPosition[] = [];

  let cursor: string | null = null;
  let pageCount = 0;
  const maxPages = 20;

  while (pageCount < maxPages) {
    pageCount++;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CACHE_CONFIG.fetchTimeoutMs);

    try {
      let url = `${DATA_API_URL}/positions?user=${walletAddress}&sizeThreshold=0&limit=500`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      const items: any[] = Array.isArray(data) ? data : (data.positions || []);
      const nextCursor: string | null =
        Array.isArray(data) ? null : (data.next_cursor || data.nextCursor || null);

      for (const p of items) {
        const size = parseFloat(p.size) || 0;
        if (size <= 0) continue;

        const tokenId = p.asset || '';
        const conditionId = p.conditionId || '';
        const apiSlug = p.eventSlug || p.slug || null;

        const outcomeRaw = String(p.outcome ?? '').toUpperCase();
        const outcome: 'UP' | 'DOWN' =
          outcomeRaw === 'YES' || outcomeRaw === 'UP'
            ? 'UP'
            : outcomeRaw === 'NO' || outcomeRaw === 'DOWN'
              ? 'DOWN'
              : (Number(p.outcomeIndex) === 0 ? 'UP' : 'DOWN');

        const cost = parseFloat(p.initialValue) || 0;

        positions.push({
          tokenId,
          conditionId,
          apiSlug,
          outcome,
          shares: size,
          avgPrice: parseFloat(p.avgPrice) || (size > 0 ? cost / size : 0),
          cost,
          currentValue: parseFloat(p.currentValue) || 0,
          currentPrice: parseFloat(p.curPrice) || 0,
          pnl: parseFloat(p.cashPnl) || 0,
        });
      }

      // Pagination
      if (!nextCursor || nextCursor === cursor || items.length === 0) break;
      cursor = nextCursor;
    } catch (error: any) {
      throw new Error(`Position fetch failed: ${error?.message || error}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return positions;
}

/**
 * Resolve the runner's slug for a position using our registered mappings.
 * Priority:
 * 1. tokenId mapping (most precise - exact match)
 * 2. conditionId mapping (fallback)
 * 3. API slug if it matches our pattern (last resort)
 */
function resolveRunnerSlug(pos: RawPosition): string | null {
  // 1. Try tokenId mapping (most accurate)
  const tokenMatch = tokenIdToSlug.get(pos.tokenId);
  if (tokenMatch) {
    // Guard against tokenId reuse across windows (or mapping overwrites):
    // if the API position's conditionId doesn't match the token mapping's conditionId,
    // do NOT attribute it to this slug.
    if (pos.conditionId && tokenMatch.conditionId && pos.conditionId !== tokenMatch.conditionId) {
      // fall through to conditionId mapping
    } else {
    return tokenMatch.slug;
    }
  }

  // 2. Try conditionId mapping
  const conditionMatch = conditionIdToSlug.get(pos.conditionId);
  if (conditionMatch) {
    return conditionMatch;
  }

  // 3. If API provides a slug that looks like our format, use it
  // But only for 15m/updown markets we care about
  if (
    pos.apiSlug &&
    (pos.apiSlug.includes('15m') || pos.apiSlug.includes('updown')) &&
    registeredSlugs.has(pos.apiSlug)
  ) {
    return pos.apiSlug;
  }

  // No match found - this position is not in our trading universe
  return null;
}

// ============================================================
// CACHE REFRESH
// ============================================================

async function refreshCache(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;
  
  const startMs = Date.now();
  
  try {
    const rawPositions = await fetchPositionsFromApi(config.polymarket.address);

    // Aggregate by RUNNER's slug (using our slug mapping)
    const byMarket = new Map<
      string,
      {
        upShares: number;
        downShares: number;
        upCost: number;
        downCost: number;
        upValue: number;
        downValue: number;
      }
    >();

    // Also build the CachedPosition array for allPositions
    const resolvedPositions: CachedPosition[] = [];

    for (const pos of rawPositions) {
      // Use our slug mapping to get the runner's slug
      const runnerSlug = resolveRunnerSlug(pos);
      
      // Skip positions we can't map to our trading universe
      if (!runnerSlug) {
        continue;
      }

      // Add to resolved positions list
      resolvedPositions.push({
        tokenId: pos.tokenId,
        conditionId: pos.conditionId,
        marketSlug: runnerSlug,  // Use runner's slug, not API's
        outcome: pos.outcome,
        shares: pos.shares,
        avgPrice: pos.avgPrice,
        cost: pos.cost,
        currentValue: pos.currentValue,
        currentPrice: pos.currentPrice,
        pnl: pos.pnl,
      });

      // Aggregate by market
      if (!byMarket.has(runnerSlug)) {
        byMarket.set(runnerSlug, {
          upShares: 0,
          downShares: 0,
          upCost: 0,
          downCost: 0,
          upValue: 0,
          downValue: 0,
        });
      }

      const agg = byMarket.get(runnerSlug)!;
      if (pos.outcome === 'UP') {
        agg.upShares += pos.shares;
        agg.upCost += pos.cost;
        agg.upValue += pos.currentValue;
      } else {
        agg.downShares += pos.shares;
        agg.downCost += pos.cost;
        agg.downValue += pos.currentValue;
      }
    }

    // Update cache state
    const nowMs = Date.now();
    const newPositions = new Map<string, MarketPositionCache>();

    for (const [slug, agg] of byMarket) {
      const asset = slug.split('-')[0]?.toUpperCase() || 'UNKNOWN';

      newPositions.set(slug, {
        marketSlug: slug,
        asset,
        upShares: agg.upShares,
        downShares: agg.downShares,
        upCost: agg.upCost,
        downCost: agg.downCost,
        upAvgPrice: agg.upShares > 0 ? agg.upCost / agg.upShares : 0,
        downAvgPrice: agg.downShares > 0 ? agg.downCost / agg.downShares : 0,
        lastFetchedAtMs: nowMs,
      });
    }

    cacheState.positions = newPositions;
    cacheState.allPositions = resolvedPositions;
    cacheState.lastRefreshAtMs = nowMs;
    cacheState.lastRefreshDurationMs = nowMs - startMs;
    cacheState.refreshCount++;
    cacheState.errorCount = 0; // Reset on success
    cacheState.lastError = null;
    cacheState.isHealthy = true;
    
  } catch (error: any) {
    cacheState.errorCount++;
    cacheState.lastError = error?.message || String(error);
    cacheState.isHealthy = cacheState.errorCount < CACHE_CONFIG.maxConsecutiveErrors;
    
    // Log error but don't spam
    if (cacheState.errorCount <= 3 || cacheState.errorCount % 10 === 0) {
      console.error(`❌ [PositionCache] Refresh error #${cacheState.errorCount}: ${cacheState.lastError}`);
    }
  } finally {
    isRefreshing = false;
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Start the position cache refresh loop
 */
export function startPositionCache(): void {
  if (refreshInterval) return;
  
  console.log('🔄 [PositionCache] Starting real-time position cache (1s refresh)');
  
  // Initial fetch
  refreshCache();
  
  // Start refresh loop
  refreshInterval = setInterval(refreshCache, CACHE_CONFIG.refreshIntervalMs);
}

/**
 * Stop the position cache refresh loop
 */
export function stopPositionCache(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    console.log('⏹️ [PositionCache] Position cache stopped');
  }
}

/**
 * Force an immediate cache refresh
 */
export async function forceRefresh(): Promise<void> {
  await refreshCache();
}

/**
 * Get cached position for a market
 * Returns null if not found or cache is stale
 */
export function getCachedPosition(marketSlug: string): MarketPositionCache | null {
  const cached = cacheState.positions.get(marketSlug);
  
  if (!cached) {
    // No position found - this is valid (flat position)
    return {
      marketSlug,
      asset: marketSlug.split('-')[0]?.toUpperCase() || 'UNKNOWN',
      upShares: 0,
      downShares: 0,
      upCost: 0,
      downCost: 0,
      upAvgPrice: 0,
      downAvgPrice: 0,
      lastFetchedAtMs: cacheState.lastRefreshAtMs,
    };
  }
  
  return cached;
}

/**
 * Check if cache is stale (too old to trust)
 */
export function isCacheStale(): boolean {
  const ageMs = Date.now() - cacheState.lastRefreshAtMs;
  return ageMs > CACHE_CONFIG.maxStaleMs;
}

/**
 * Check if cache is healthy (refreshing successfully)
 */
export function isCacheHealthy(): boolean {
  return cacheState.isHealthy && !isCacheStale();
}

/**
 * Get cache stats for monitoring
 */
export function getCacheStats(): {
  lastRefreshAtMs: number;
  lastRefreshDurationMs: number;
  refreshCount: number;
  errorCount: number;
  isHealthy: boolean;
  isStale: boolean;
  positionCount: number;
  marketCount: number;
} {
  return {
    lastRefreshAtMs: cacheState.lastRefreshAtMs,
    lastRefreshDurationMs: cacheState.lastRefreshDurationMs,
    refreshCount: cacheState.refreshCount,
    errorCount: cacheState.errorCount,
    isHealthy: cacheState.isHealthy,
    isStale: isCacheStale(),
    positionCount: cacheState.allPositions.length,
    marketCount: cacheState.positions.size,
  };
}

/**
 * Detect drift between local position tracking and cache
 * This is critical for catching mismatches before they cause bad trades
 */
export function detectPositionDrift(
  marketSlug: string,
  asset: string,
  localUpShares: number,
  localDownShares: number
): PositionDrift {
  const cached = getCachedPosition(marketSlug);
  
  if (!cached || isCacheStale()) {
    return {
      detected: false,
      marketSlug,
      asset,
      localUp: localUpShares,
      localDown: localDownShares,
      cacheUp: 0,
      cacheDown: 0,
      driftUp: 0,
      driftDown: 0,
      reason: 'CACHE_STALE_OR_MISSING',
    };
  }
  
  const driftUp = Math.abs(localUpShares - cached.upShares);
  const driftDown = Math.abs(localDownShares - cached.downShares);
  
  // Minor drift (rounding, timing) - log but don't halt
  const hasMinorDrift = driftUp > CACHE_CONFIG.driftThreshold || driftDown > CACHE_CONFIG.driftThreshold;
  
  // Major drift - HALT trading on this market
  const hasMajorDrift = driftUp > CACHE_CONFIG.driftHaltThreshold || driftDown > CACHE_CONFIG.driftHaltThreshold;
  
  return {
    detected: hasMajorDrift,
    marketSlug,
    asset,
    localUp: localUpShares,
    localDown: localDownShares,
    cacheUp: cached.upShares,
    cacheDown: cached.downShares,
    driftUp,
    driftDown,
    reason: hasMajorDrift 
      ? `MAJOR_DRIFT: local=${localUpShares}/${localDownShares} cache=${cached.upShares}/${cached.downShares}` 
      : hasMinorDrift 
        ? 'MINOR_DRIFT' 
        : 'NO_DRIFT',
  };
}

/**
 * Get the authoritative position for a market
 * This should be used for ALL trading decisions
 */
export function getAuthoritativePosition(marketSlug: string): {
  upShares: number;
  downShares: number;
  upCost: number;
  downCost: number;
  upAvgPrice: number;
  downAvgPrice: number;
  isStale: boolean;
  ageMs: number;
} {
  const cached = getCachedPosition(marketSlug);
  const ageMs = Date.now() - (cached?.lastFetchedAtMs || 0);
  
  if (!cached) {
    return {
      upShares: 0,
      downShares: 0,
      upCost: 0,
      downCost: 0,
      upAvgPrice: 0,
      downAvgPrice: 0,
      isStale: true,
      ageMs,
    };
  }
  
  return {
    upShares: cached.upShares,
    downShares: cached.downShares,
    upCost: cached.upCost,
    downCost: cached.downCost,
    upAvgPrice: cached.upAvgPrice,
    downAvgPrice: cached.downAvgPrice,
    isStale: isCacheStale(),
    ageMs,
  };
}

/**
 * Log cache status (for periodic monitoring)
 */
export function logCacheStatus(): void {
  const stats = getCacheStats();
  const ageMs = Date.now() - stats.lastRefreshAtMs;
  
  console.log(`📊 [PositionCache] Status: ${stats.isHealthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}`);
  console.log(`   Last refresh: ${ageMs}ms ago (${stats.lastRefreshDurationMs}ms duration)`);
  console.log(`   Refreshes: ${stats.refreshCount} total, ${stats.errorCount} errors`);
  console.log(`   Positions: ${stats.positionCount} total, ${stats.marketCount} markets`);
}
