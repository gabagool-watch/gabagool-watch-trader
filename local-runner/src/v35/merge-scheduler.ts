// ============================================================
// V37.7.0 MERGE SCHEDULER
// ============================================================
// Schedules merge operations 30 seconds AFTER market expiry.
// This ensures the market has fully settled before merging
// paired positions back to USDC.
//
// V37.7.0: Fixed snapshot update - now updates DB after merge completes
// ============================================================

import type { V35Market, V35Asset } from './types.js';
import { getMergeManager, MergeManager, type MergeCandidate, type MergeResult } from './merge-manager.js';
import { getCachedPosition } from '../position-cache.js';
import { saveBotEvent } from '../backend.js';
import { saveV35ExpirySnapshot, type V35ExpirySnapshotData } from './backend.js';

// ============================================================
// TYPES
// ============================================================

export interface MergeScheduleEntry {
  marketSlug: string;
  conditionId: string;
  asset: V35Asset;
  expiryTime: number;     // ms timestamp
  mergeTime: number;      // When to trigger merge (30s AFTER expiry)
  timeout: NodeJS.Timeout;
  status: 'scheduled' | 'executing' | 'completed' | 'failed' | 'skipped';
  result?: MergeResult;
  // V37.7.0: Store market data for PnL logging
  upShares?: number;
  downShares?: number;
  upCost?: number;
  downCost?: number;
  upTokenId?: string;
  downTokenId?: string;
}

// ============================================================
// STATE
// ============================================================

const scheduledMerges = new Map<string, MergeScheduleEntry>();
let mergeCallback: ((slug: string, result: MergeResult) => void) | null = null;
let mergeManager: MergeManager | null = null;
let initialized = false;

// ============================================================
// CONFIGURATION
// ============================================================

const MERGE_AFTER_EXPIRY_SEC = 30; // Trigger merge 30 seconds AFTER expiry
const MIN_PAIRED_SHARES = 5;       // Minimum paired shares to trigger merge

// ============================================================
// INITIALIZATION
// ============================================================

export async function initMergeScheduler(): Promise<boolean> {
  if (initialized) return true;
  
  mergeManager = getMergeManager();
  const success = await mergeManager.initialize();
  
  if (success) {
    initialized = true;
    const walletType = mergeManager.getWalletType();
    console.log(`[MergeScheduler] ✅ Initialized (wallet: ${walletType.toUpperCase()})`);
  } else {
    console.log('[MergeScheduler] ⚠️ Initialization failed - merge disabled');
  }
  
  return success;
}

// ============================================================
// CALLBACK REGISTRATION
// ============================================================

/**
 * Register callback to be called when merge completes
 * This allows runner to update expiry snapshot with merge data
 */
export function setMergeCallback(callback: (slug: string, result: MergeResult) => void): void {
  mergeCallback = callback;
}

// ============================================================
// SCHEDULING
// ============================================================

/**
 * Schedule a merge operation for a market
 * Will trigger 30 seconds AFTER expiry
 */
export function scheduleMerge(market: V35Market): void {
  const slug = market.slug;
  
  // Cancel any existing schedule
  if (scheduledMerges.has(slug)) {
    cancelMerge(slug);
  }
  
  const now = Date.now();
  const expiryMs = market.expiry.getTime();
  const mergeTime = expiryMs + (MERGE_AFTER_EXPIRY_SEC * 1000); // 30s AFTER expiry
  const delayMs = mergeTime - now;
  
  // V37.7.0: Store market data for later PnL calculation
  const entry: MergeScheduleEntry = {
    marketSlug: slug,
    conditionId: market.conditionId,
    asset: market.asset,
    expiryTime: expiryMs,
    mergeTime,
    timeout: null as any,
    status: 'scheduled',
    upShares: market.upQty,
    downShares: market.downQty,
    upCost: market.upCost,
    downCost: market.downCost,
    upTokenId: market.upTokenId,
    downTokenId: market.downTokenId,
  };
  
  scheduledMerges.set(slug, entry);
  
  // Don't schedule if in the past
  if (delayMs <= 0) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: Merge time already passed, executing immediately`);
    executeMergeFromEntry(entry).catch(err => {
      console.error(`[MergeScheduler] Immediate merge error for ${slug}:`, err);
    });
    return;
  }
  
  const secsUntilExpiry = Math.max(0, (expiryMs - now) / 1000);
  console.log(`[MergeScheduler] Scheduled merge for ${slug.slice(-25)} in ${(delayMs / 1000).toFixed(0)}s (expiry in ${secsUntilExpiry.toFixed(0)}s + 30s wait)`)
  
  entry.timeout = setTimeout(() => {
    executeMergeFromEntry(entry).catch(err => {
      console.error(`[MergeScheduler] Merge execution error for ${slug}:`, err);
    });
  }, delayMs);
}

/**
 * Cancel a scheduled merge
 */
export function cancelMerge(slug: string): void {
  const entry = scheduledMerges.get(slug);
  if (entry) {
    clearTimeout(entry.timeout);
    scheduledMerges.delete(slug);
    console.log(`[MergeScheduler] Cancelled merge for ${slug.slice(-25)}`);
  }
}

/**
 * Cancel all scheduled merges
 */
export function cancelAllMerges(): void {
  for (const [slug, entry] of scheduledMerges.entries()) {
    clearTimeout(entry.timeout);
    console.log(`[MergeScheduler] Cancelled merge for ${slug.slice(-25)}`);
  }
  scheduledMerges.clear();
}

// ============================================================
// EXECUTION
// ============================================================

/**
 * Execute merge using stored entry data (V37.7.0)
 */
async function executeMergeFromEntry(entry: MergeScheduleEntry): Promise<void> {
  const slug = entry.marketSlug;
  
  if (!initialized || !mergeManager) {
    console.log(`[MergeScheduler] Merge manager not initialized, skipping ${slug}`);
    entry.status = 'skipped';
    return;
  }
  
  entry.status = 'executing';
  
  // V37.7.0: Use cached position if available, fall back to stored entry data
  const position = getCachedPosition(slug);
  
  const upShares = (position && position.upShares > 0) ? position.upShares : (entry.upShares ?? 0);
  const downShares = (position && position.downShares > 0) ? position.downShares : (entry.downShares ?? 0);
  const upCost = (position && position.upCost > 0) ? position.upCost : (entry.upCost ?? 0);
  const downCost = (position && position.downCost > 0) ? position.downCost : (entry.downCost ?? 0);
  
  // Create merge candidate with token IDs for balance verification
  const candidate = MergeManager.createCandidate(
    entry.conditionId,
    slug,
    entry.asset,
    upShares,
    downShares,
    upCost,
    downCost,
    entry.upTokenId,
    entry.downTokenId
  );
  
  if (!candidate) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: No paired shares, skipping merge`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'no_paired_shares' };
    logMergeEvent(entry, 'skipped');
    if (mergeCallback) mergeCallback(slug, entry.result);
    return;
  }
  
  if (candidate.pairedShares < MIN_PAIRED_SHARES) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: Only ${candidate.pairedShares} paired (min: ${MIN_PAIRED_SHARES}), skipping`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'below_minimum' };
    logMergeEvent(entry, 'skipped');
    if (mergeCallback) mergeCallback(slug, entry.result);
    return;
  }
  
  // Check if profitable
  if (!MergeManager.shouldMerge(candidate)) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: CPP >= $1.00, skipping unprofitable merge`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'unprofitable' };
    logMergeEvent(entry, 'skipped');
    if (mergeCallback) mergeCallback(slug, entry.result);
    return;
  }
  
  // Execute merge
  const result = await mergeManager.merge(candidate);
  
  entry.status = result.success ? 'completed' : 'failed';
  entry.result = result;
  
  if (result.success) {
    console.log(`[MergeScheduler] ✅ ${slug.slice(-25)}: Merged ${result.mergedShares} pairs, PnL: $${(result.realizedPnl ?? 0).toFixed(2)}`);
    logMergeEvent(entry, 'completed');
  } else {
    console.log(`[MergeScheduler] ❌ ${slug.slice(-25)}: Merge failed - ${result.error}`);
    logMergeEvent(entry, 'failed');
  }
  
  // Notify callback
  if (mergeCallback) {
    mergeCallback(slug, result);
  }
}

/**
 * Log merge event to database for PnL tracking (V37.7.0)
 */
function logMergeEvent(entry: MergeScheduleEntry, outcome: 'completed' | 'failed' | 'skipped'): void {
  const result = entry.result;
  saveBotEvent({
    event_type: 'MERGE_EXECUTION',
    asset: entry.asset,
    market_id: entry.marketSlug,
    ts: Date.now(),
    data: {
      outcome,
      mergedShares: result?.mergedShares ?? 0,
      realizedPnl: result?.realizedPnl ?? 0,
      txHash: result?.txHash,
      gasUsed: result?.gasUsed,
      error: result?.error,
      walletType: result?.walletType,
      upShares: entry.upShares,
      downShares: entry.downShares,
      upCost: entry.upCost,
      downCost: entry.downCost,
    },
  }).catch(() => {});
}

// ============================================================
// STATUS
// ============================================================

/**
 * Get merge result for a market (if completed)
 */
export function getMergeResult(slug: string): MergeResult | null {
  const entry = scheduledMerges.get(slug);
  return entry?.result || null;
}

/**
 * Get all scheduled merges
 */
export function getScheduledMerges(): Map<string, MergeScheduleEntry> {
  return new Map(scheduledMerges);
}

/**
 * Get count of scheduled merges
 */
export function getScheduledMergeCount(): number {
  return scheduledMerges.size;
}

/**
 * V37.7.1: Update position data for an existing scheduled merge entry.
 * Called by runner when market expires to ensure merge has latest position data.
 */
export function updateMergeEntryPositions(
  marketSlug: string,
  upShares: number,
  downShares: number,
  upCost: number,
  downCost: number,
): void {
  const entry = scheduledMerges.get(marketSlug);
  if (entry) {
    entry.upShares = upShares;
    entry.downShares = downShares;
    entry.upCost = upCost;
    entry.downCost = downCost;
    console.log(`[MergeScheduler] 📊 Updated positions for ${marketSlug.slice(-25)}: UP=${upShares.toFixed(1)}, DOWN=${downShares.toFixed(1)}, Cost=$${(upCost + downCost).toFixed(2)}`);
  } else {
    console.log(`[MergeScheduler] ⚠️ No scheduled merge found for ${marketSlug.slice(-25)} to update`);
  }
}

/**
 * Check if merge scheduler is ready
 */
export function isMergeSchedulerReady(): boolean {
  return initialized && (mergeManager?.isReady() ?? false);
}
