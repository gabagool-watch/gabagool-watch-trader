// ============================================================
// V35 MARKET DISCOVERY
// ============================================================
// Uses the same get-market-tokens edge function as V29R for reliable
// 15-minute market discovery via epoch-based slug generation.
// ============================================================

import type { V35Asset } from './types.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

const SUPPORTED_ASSETS: V35Asset[] = ['BTC', 'ETH', 'SOL', 'XRP'];

export interface DiscoveredMarket {
  slug: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  asset: V35Asset;
  expiry: Date;
  strikePrice?: number;
}

interface MarketToken {
  slug: string;
  asset: string;
  upTokenId: string;
  downTokenId: string;
  strikePrice: number;
  eventStartTime: string;
  eventEndTime: string;
  conditionId?: string;
}

/**
 * Fetch active 15-minute markets via get-market-tokens edge function
 * This is the same method V29R uses - reliable and battle-tested
 */
async function fetchMarketsFromBackend(): Promise<MarketToken[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('[MarketDiscovery] Missing Supabase credentials, falling back to direct API');
    return [];
  }

  const url = `${SUPABASE_URL}/functions/v1/get-market-tokens`;
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[MarketDiscovery] Calling get-market-tokens (attempt ${attempt}/${maxRetries})...`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ mode: '15m' }),
        signal: AbortSignal.timeout(20000), // V36.3.5: increased timeout
      });

      if (!response.ok) {
        const text = await response.text();
        console.log(`[MarketDiscovery] get-market-tokens failed: ${response.status} - ${text}`);
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 2000 * attempt)); // exponential backoff
          continue;
        }
        return [];
      }

      const data = await response.json();
      
      if (!data.success || !Array.isArray(data.markets)) {
        console.log(`[MarketDiscovery] get-market-tokens returned no markets`);
        return [];
      }

      console.log(`[MarketDiscovery] get-market-tokens returned ${data.markets.length} markets`);
      return data.markets;
    } catch (error) {
      console.log(`[MarketDiscovery] get-market-tokens error (attempt ${attempt}): ${error}`);
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * attempt)); // exponential backoff
        continue;
      }
      return [];
    }
  }
  
  return [];
}

/**
 * Extract asset from slug
 */
function extractAsset(slug: string): V35Asset | null {
  const lower = slug.toLowerCase();
  if (lower.startsWith('btc-') || lower.includes('-btc-')) return 'BTC';
  if (lower.startsWith('eth-') || lower.includes('-eth-')) return 'ETH';
  if (lower.startsWith('sol-') || lower.includes('-sol-')) return 'SOL';
  if (lower.startsWith('xrp-') || lower.includes('-xrp-')) return 'XRP';
  return null;
}

/**
 * Find all active 15-minute up/down markets
 */
export async function discoverMarkets(minSecondsToExpiry: number = 180): Promise<DiscoveredMarket[]> {
  const markets: DiscoveredMarket[] = [];
  
  // Use the same backend as V29R
  const backendMarkets = await fetchMarketsFromBackend();
  
  const now = Date.now();
  
  for (const m of backendMarkets) {
    const asset = extractAsset(m.slug);
    if (!asset || !SUPPORTED_ASSETS.includes(asset)) continue;
    
    if (!m.upTokenId || !m.downTokenId) {
      console.log(`[MarketDiscovery] ${m.slug}: missing token IDs`);
      continue;
    }
    
    // Parse start and expiry times
    let startTime: Date;
    let expiry: Date;
    try {
      startTime = new Date(m.eventStartTime);
      expiry = new Date(m.eventEndTime);
      if (isNaN(startTime.getTime()) || isNaN(expiry.getTime())) continue;
    } catch {
      continue;
    }
    
    // Skip if market hasn't started yet
    if (startTime.getTime() > now) {
      const secsUntilStart = (startTime.getTime() - now) / 1000;
      console.log(`[MarketDiscovery] ${m.slug}: FUTURE (starts in ${Math.round(secsUntilStart)}s) - SKIPPING`);
      continue;
    }
    
    // Skip if too close to expiry or already expired
    const secondsToExpiry = (expiry.getTime() - now) / 1000;
    if (secondsToExpiry < minSecondsToExpiry) {
      console.log(`[MarketDiscovery] ${m.slug}: ${Math.round(secondsToExpiry)}s to expiry (min: ${minSecondsToExpiry})`);
      continue;
    }
    
    console.log(`[MarketDiscovery] ✅ ${m.slug}: ${Math.round(secondsToExpiry)}s to expiry`);
    
    markets.push({
      slug: m.slug,
      conditionId: m.conditionId || '',
      upTokenId: m.upTokenId,
      downTokenId: m.downTokenId,
      asset,
      expiry,
      strikePrice: m.strikePrice,
    });
  }
  
  console.log(`[MarketDiscovery] Found ${markets.length} active 15m up/down markets`);
  return markets;
}

/**
 * Filter markets by asset
 */
export function filterByAssets(markets: DiscoveredMarket[], assets: V35Asset[]): DiscoveredMarket[] {
  return markets.filter(m => assets.includes(m.asset));
}
