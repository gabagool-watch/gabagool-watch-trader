// ============================================================
// V37.6.2 MERGE SCHEDULER
// ============================================================
// Schedules merge operations 30 seconds AFTER market expiry.
// This ensures the market has fully settled before merging
// paired positions back to USDC.
// ============================================================

import type { V35Market, V35Asset } from './types.js';
import { getMergeManager, MergeManager, type MergeCandidate, type MergeResult } from './merge-manager.js';
import { getCachedPosition } from '../position-cache.js';

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
    console.log('[MergeScheduler] ✅ Initialized');
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
  
  // Create entry first (before any async operations)
  const entry: MergeScheduleEntry = {
    marketSlug: slug,
    conditionId: market.conditionId,
    asset: market.asset,
    expiryTime: expiryMs,
    mergeTime,
    timeout: null as any, // Will be set below
    status: 'scheduled',
  };
  
  scheduledMerges.set(slug, entry);
  
  // Don't schedule if in the past (shouldn't happen)
  if (delayMs <= 0) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: Merge time already passed, executing immediately`);
    executeMerge(market).catch(err => {
      console.error(`[MergeScheduler] Immediate merge error for ${slug}:`, err);
    });
    return;
  }
  
  const secsUntilExpiry = Math.max(0, (expiryMs - now) / 1000);
  console.log(`[MergeScheduler] Scheduled merge for ${slug.slice(-25)} in ${(delayMs / 1000).toFixed(0)}s (expiry in ${secsUntilExpiry.toFixed(0)}s + 30s wait)`)
  
  entry.timeout = setTimeout(() => {
    executeMerge(market).catch(err => {
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
 * Execute merge for a market
 */
async function executeMerge(market: V35Market): Promise<void> {
  const slug = market.slug;
  const entry = scheduledMerges.get(slug);
  
  if (!entry) {
    console.log(`[MergeScheduler] No entry found for ${slug}`);
    return;
  }
  
  if (!initialized || !mergeManager) {
    console.log(`[MergeScheduler] Merge manager not initialized, skipping ${slug}`);
    entry.status = 'skipped';
    return;
  }
  
  entry.status = 'executing';
  
  // Get current position from cache (ground truth)
  // V37.6.3: Use explicit check for 0 since cache returns object with 0 shares
  const position = getCachedPosition(slug);
  
  const upShares = (position && position.upShares > 0) ? position.upShares : market.upQty;
  const downShares = (position && position.downShares > 0) ? position.downShares : market.downQty;
  const upCost = (position && position.upCost > 0) ? position.upCost : market.upCost;
  const downCost = (position && position.downCost > 0) ? position.downCost : market.downCost;
  
  // Create merge candidate
  const candidate = MergeManager.createCandidate(
    market.conditionId,
    slug,
    market.asset,
    upShares,
    downShares,
    upCost,
    downCost
  );
  
  if (!candidate) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: No paired shares, skipping merge`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'no_paired_shares' };
    
    if (mergeCallback) {
      mergeCallback(slug, entry.result);
    }
    return;
  }
  
  if (candidate.pairedShares < MIN_PAIRED_SHARES) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: Only ${candidate.pairedShares} paired (min: ${MIN_PAIRED_SHARES}), skipping`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'below_minimum' };
    
    if (mergeCallback) {
      mergeCallback(slug, entry.result);
    }
    return;
  }
  
  // Check if profitable
  if (!MergeManager.shouldMerge(candidate)) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: CPP >= $1.00, skipping unprofitable merge`);
    entry.status = 'skipped';
    entry.result = { success: false, mergedShares: 0, error: 'unprofitable' };
    
    if (mergeCallback) {
      mergeCallback(slug, entry.result);
    }
    return;
  }
  
  // Execute merge
  const result = await mergeManager.merge(candidate);
  
  entry.status = result.success ? 'completed' : 'failed';
  entry.result = result;
  
  if (result.success) {
    console.log(`[MergeScheduler] ✅ ${slug.slice(-25)}: Merged ${result.mergedShares} pairs`);
  } else {
    console.log(`[MergeScheduler] ❌ ${slug.slice(-25)}: Merge failed - ${result.error}`);
  }
  
  // Notify callback
  if (mergeCallback) {
    mergeCallback(slug, result);
  }
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
 * Check if merge scheduler is ready
 */
export function isMergeSchedulerReady(): boolean {
  return initialized && (mergeManager?.isReady() ?? false);
}
