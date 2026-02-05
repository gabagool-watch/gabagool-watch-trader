// ============================================================
// V37.8.0 MERGE SCHEDULER - SIMPLIFIED
// ============================================================
// SIMPLE APPROACH:
// 1. Schedule merge 30 seconds AFTER market expiry
// 2. At merge time: check ON-CHAIN balances (source of truth)
// 3. Calculate pairable shares from on-chain data
// 4. Execute merge if profitable
//
// V37.8.0: Removed all complex position tracking. Trust on-chain data only.
// ============================================================

import type { V35Market, V35Asset } from './types.js';
import { getMergeManager, MergeManager, type MergeCandidate, type MergeResult } from './merge-manager.js';
import { saveBotEvent } from '../backend.js';

// ============================================================
// TYPES
// ============================================================

export interface MergeScheduleEntry {
  marketSlug: string;
  conditionId: string;
  asset: V35Asset;
  upTokenId: string;
  downTokenId: string;
  expiryTime: number;
  mergeTime: number;
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

export function setMergeCallback(callback: (slug: string, result: MergeResult) => void): void {
  mergeCallback = callback;
}

// ============================================================
// SCHEDULING
// ============================================================

/**
 * Schedule a merge operation for a market
 * V37.8.0: Only stores essential data - on-chain balances checked at merge time
 */
export function scheduleMerge(market: V35Market): void {
  const slug = market.slug;
  
  // Cancel any existing schedule
  if (scheduledMerges.has(slug)) {
    cancelMerge(slug);
  }
  
  const now = Date.now();
  const expiryMs = market.expiry.getTime();
  const mergeTime = expiryMs + (MERGE_AFTER_EXPIRY_SEC * 1000);
  const delayMs = mergeTime - now;
  
  // V37.8.0: Only store essential data - no position tracking needed
  const entry: MergeScheduleEntry = {
    marketSlug: slug,
    conditionId: market.conditionId,
    asset: market.asset,
    upTokenId: market.upTokenId,
    downTokenId: market.downTokenId,
    expiryTime: expiryMs,
    mergeTime,
    timeout: null as any,
    status: 'scheduled',
  };
  
  scheduledMerges.set(slug, entry);
  
  // Don't schedule if in the past
  if (delayMs <= 0) {
    console.log(`[MergeScheduler] ${slug.slice(-25)}: Merge time passed, executing immediately`);
    executeMergeFromEntry(entry).catch(err => {
      console.error(`[MergeScheduler] Immediate merge error for ${slug}:`, err);
    });
    return;
  }
  
  const secsUntilExpiry = Math.max(0, (expiryMs - now) / 1000);
  console.log(`[MergeScheduler] 📅 Scheduled: ${slug.slice(-25)} in ${(delayMs / 1000).toFixed(0)}s (expiry +30s)`);
  
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
    console.log(`[MergeScheduler] Cancelled: ${slug.slice(-25)}`);
  }
}

/**
 * Cancel all scheduled merges
 */
export function cancelAllMerges(): void {
  for (const [slug, entry] of scheduledMerges.entries()) {
    clearTimeout(entry.timeout);
    console.log(`[MergeScheduler] Cancelled: ${slug.slice(-25)}`);
  }
  scheduledMerges.clear();
}

// ============================================================
// EXECUTION - V37.8.0 SIMPLIFIED
// ============================================================

/**
 * Execute merge using ON-CHAIN balances (source of truth)
 * V37.8.0: No more position tracking - just check what's on-chain
 */
async function executeMergeFromEntry(entry: MergeScheduleEntry): Promise<void> {
  const slug = entry.marketSlug;
  
  if (!initialized || !mergeManager) {
    console.log(`[MergeScheduler] ❌ Not initialized, skipping ${slug.slice(-25)}`);
    entry.status = 'skipped';
    scheduledMerges.delete(slug);
    return;
  }
  
  entry.status = 'executing';
  
  console.log(`\n[MergeScheduler] ═══════════════════════════════════════════════`);
  console.log(`[MergeScheduler] 🔄 MERGE CHECK: ${slug.slice(-35)}`);
  console.log(`[MergeScheduler] ═══════════════════════════════════════════════`);
  
  try {
    // V37.8.0: CHECK ON-CHAIN BALANCES - THIS IS THE SOURCE OF TRUTH
    const balances = await mergeManager.checkBalances(
      entry.conditionId,
      entry.upTokenId,
      entry.downTokenId
    );
    
    console.log(`[MergeScheduler] 📊 On-chain balances:`);
    console.log(`[MergeScheduler]    UP:   ${balances.upBalance.toFixed(2)} shares`);
    console.log(`[MergeScheduler]    DOWN: ${balances.downBalance.toFixed(2)} shares`);
    console.log(`[MergeScheduler]    Pairable: ${balances.pairable.toFixed(2)} shares`);
    
    // Check if we have enough to merge
    if (balances.pairable < MIN_PAIRED_SHARES) {
      console.log(`[MergeScheduler] ⚠️ Only ${balances.pairable.toFixed(2)} pairable (min: ${MIN_PAIRED_SHARES}), skipping`);
      entry.status = 'skipped';
      entry.result = { success: false, mergedShares: 0, error: 'below_minimum' };
      logMergeEvent(entry, 'skipped');
      if (mergeCallback) mergeCallback(slug, entry.result);
      scheduledMerges.delete(slug);
      return;
    }
    
    // Create merge candidate from on-chain data
    // We don't have CPP from on-chain, so we assume it's profitable if we have pairs
    // The merge itself is always profitable (1 UP + 1 DOWN = $1 USDC)
    const candidate: MergeCandidate = {
      conditionId: entry.conditionId,
      marketSlug: slug,
      asset: entry.asset,
      pairedShares: balances.pairable,
      upShares: balances.upBalance,
      downShares: balances.downBalance,
      avgUpPrice: 0, // Unknown - but doesn't matter for on-chain merge
      avgDownPrice: 0,
      cpp: 0, // Will be calculated from actual accounting data
      expectedPnl: balances.pairable, // Worst case: $1 per pair
      upTokenId: entry.upTokenId,
      downTokenId: entry.downTokenId,
    };
    
    console.log(`[MergeScheduler] ✅ Proceeding with merge of ${balances.pairable.toFixed(2)} pairs...`);
    
    // Execute merge
    const result = await mergeManager.merge(candidate);
    
    entry.status = result.success ? 'completed' : 'failed';
    entry.result = result;
    
    if (result.success) {
      console.log(`[MergeScheduler] ✅ MERGED ${result.mergedShares.toFixed(2)} pairs`);
      console.log(`[MergeScheduler]    TX: ${result.txHash}`);
      console.log(`[MergeScheduler]    Gas: ${result.gasUsed ?? 'unknown'}`);
      logMergeEvent(entry, 'completed');
    } else {
      console.log(`[MergeScheduler] ❌ Merge failed: ${result.error}`);
      logMergeEvent(entry, 'failed');
    }
    
    // Notify callback
    if (mergeCallback) {
      mergeCallback(slug, result);
    }
    
  } catch (err: any) {
    console.error(`[MergeScheduler] ❌ Unexpected error:`, err?.message || err);
    entry.status = 'failed';
    entry.result = { success: false, mergedShares: 0, error: err?.message || 'unknown' };
    logMergeEvent(entry, 'failed');
  } finally {
    // Clean up the entry after execution
    scheduledMerges.delete(slug);
  }
}

/**
 * Log merge event to database
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
    },
  }).catch(() => {});
}

// ============================================================
// STATUS
// ============================================================

export function getMergeResult(slug: string): MergeResult | null {
  const entry = scheduledMerges.get(slug);
  return entry?.result || null;
}

export function getScheduledMerges(): Map<string, MergeScheduleEntry> {
  return new Map(scheduledMerges);
}

export function getScheduledMergeCount(): number {
  return scheduledMerges.size;
}

/**
 * V37.8.0: Deprecated - no longer needed, on-chain data is used
 */
export function updateMergeEntryPositions(
  marketSlug: string,
  upShares: number,
  downShares: number,
  upCost: number,
  downCost: number,
): void {
  // V37.8.0: No-op - we use on-chain balances now
  console.log(`[MergeScheduler] ℹ️ updateMergeEntryPositions ignored - using on-chain data`);
}

export function isMergeSchedulerReady(): boolean {
  return initialized && (mergeManager?.isReady() ?? false);
}
