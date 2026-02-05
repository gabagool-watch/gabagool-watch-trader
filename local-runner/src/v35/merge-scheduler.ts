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
import { getEntry } from '../accounting-ledger.js';
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

  // Captured at expiry (preferred for CPP, survives short-term drift)
  capturedUpShares?: number;
  capturedDownShares?: number;
  capturedUpCost?: number;
  capturedDownCost?: number;
  capturedAtTs?: number;

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

  // Guard: merge requires a valid conditionId (bytes32)
  if (!market.conditionId || !market.conditionId.startsWith('0x') || market.conditionId.length !== 66) {
    console.log(`[MergeScheduler] ⚠️ Not scheduling merge for ${slug.slice(-25)}: invalid conditionId="${market.conditionId}"`);
    return;
  }

  // Cancel any existing schedule
  if (scheduledMerges.has(slug)) {
    cancelMerge(slug);
  }

  const now = Date.now();
  const expiryMs = market.expiry.getTime();
  const mergeTime = expiryMs + (MERGE_AFTER_EXPIRY_SEC * 1000);
  const delayMs = mergeTime - now;

  // Store essential data + placeholders for captured accounting at expiry
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
    
    console.log(`[MergeScheduler] 📊 On-chain balances (CTF):`);
    console.log(`[MergeScheduler]    Outcome[1]: ${balances.upBalance.toFixed(2)} shares`);
    console.log(`[MergeScheduler]    Outcome[2]: ${balances.downBalance.toFixed(2)} shares`);
    console.log(`[MergeScheduler]    Pairable (on-chain): ${balances.pairable.toFixed(2)} shares`);

    // ----------------------------------------------------------
    // Determine CPP + pairable shares from captured accounting
    // ----------------------------------------------------------
    let accUpShares = entry.capturedUpShares;
    let accDownShares = entry.capturedDownShares;
    let accUpCost = entry.capturedUpCost;
    let accDownCost = entry.capturedDownCost;

    if (
      !Number.isFinite(accUpShares) ||
      !Number.isFinite(accDownShares) ||
      !Number.isFinite(accUpCost) ||
      !Number.isFinite(accDownCost)
    ) {
      const up = getEntry(slug, entry.asset, 'UP');
      const down = getEntry(slug, entry.asset, 'DOWN');
      accUpShares = up.openShares;
      accDownShares = down.openShares;
      accUpCost = up.openCostUsd;
      accDownCost = down.openCostUsd;
    }

    const pairedAccounting = Math.min(accUpShares || 0, accDownShares || 0);
    if (pairedAccounting <= 0) {
      console.log(`[MergeScheduler] ⚠️ No paired shares in accounting for ${slug.slice(-25)} (skipping merge to avoid losing CPP)`);
      entry.status = 'skipped';
      entry.result = { success: false, mergedShares: 0, error: 'no_accounting_pairs' };
      logMergeEvent(entry, 'skipped');
      if (mergeCallback) mergeCallback(slug, entry.result);
      scheduledMerges.delete(slug);
      return;
    }

    const avgUp = accUpShares && accUpShares > 0 ? (accUpCost || 0) / accUpShares : 0;
    const avgDown = accDownShares && accDownShares > 0 ? (accDownCost || 0) / accDownShares : 0;
    const cpp = avgUp + avgDown;

    if (!Number.isFinite(cpp) || cpp <= 0) {
      console.log(`[MergeScheduler] ⚠️ Invalid CPP from accounting (${cpp}) - skipping`);
      entry.status = 'skipped';
      entry.result = { success: false, mergedShares: 0, error: 'invalid_cpp' };
      logMergeEvent(entry, 'skipped');
      if (mergeCallback) mergeCallback(slug, entry.result);
      scheduledMerges.delete(slug);
      return;
    }

    // Shares we can both justify (accounting) and actually merge (on-chain)
    const sharesToMerge = Math.min(balances.pairable, pairedAccounting);

    console.log(`[MergeScheduler] 📌 Accounting snapshot:`);
    console.log(`[MergeScheduler]    UP:   ${(accUpShares || 0).toFixed(2)} shares @ ${(avgUp * 100).toFixed(2)}¢`);
    console.log(`[MergeScheduler]    DOWN: ${(accDownShares || 0).toFixed(2)} shares @ ${(avgDown * 100).toFixed(2)}¢`);
    console.log(`[MergeScheduler]    CPP:  $${cpp.toFixed(4)} | mergeable: ${sharesToMerge.toFixed(2)} shares`);

    // Minimum size gate
    if (sharesToMerge < MIN_PAIRED_SHARES) {
      console.log(`[MergeScheduler] ⚠️ Only ${sharesToMerge.toFixed(2)} mergeable (min: ${MIN_PAIRED_SHARES}), skipping`);
      entry.status = 'skipped';
      entry.result = { success: false, mergedShares: 0, error: 'below_minimum' };
      logMergeEvent(entry, 'skipped');
      if (mergeCallback) mergeCallback(slug, entry.result);
      scheduledMerges.delete(slug);
      return;
    }

    // Profitability gate (per spec)
    if (cpp >= 1.0) {
      console.log(`[MergeScheduler] ⛔ CPP >= 1.00 ($${cpp.toFixed(4)}), skipping merge`);
      entry.status = 'skipped';
      entry.result = { success: false, mergedShares: 0, error: 'cpp_ge_1' };
      logMergeEvent(entry, 'skipped');
      if (mergeCallback) mergeCallback(slug, entry.result);
      scheduledMerges.delete(slug);
      return;
    }

    const candidate: MergeCandidate = {
      conditionId: entry.conditionId,
      marketSlug: slug,
      asset: entry.asset,
      pairedShares: sharesToMerge,
      upShares: balances.upBalance,
      downShares: balances.downBalance,
      avgUpPrice: avgUp,
      avgDownPrice: avgDown,
      cpp,
      expectedPnl: sharesToMerge * (1.0 - cpp),
      upTokenId: entry.upTokenId,
      downTokenId: entry.downTokenId,
    };
    
    console.log(`[MergeScheduler] ✅ Proceeding with merge of ${candidate.pairedShares.toFixed(2)} pairs (expected PnL: $${candidate.expectedPnl >= 0 ? '+' : ''}${candidate.expectedPnl.toFixed(2)})...`);

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
 * Capture final position accounting at expiry.
 * This is injected by runner cleanupExpiredMarkets() and is the preferred CPP source.
 */
export function updateMergeEntryPositions(
  marketSlug: string,
  upShares: number,
  downShares: number,
  upCost: number,
  downCost: number,
): void {
  const entry = scheduledMerges.get(marketSlug);
  if (!entry) {
    console.log(`[MergeScheduler] ⚠️ updateMergeEntryPositions: no scheduled entry for ${marketSlug.slice(-25)}`);
    return;
  }

  entry.capturedUpShares = upShares;
  entry.capturedDownShares = downShares;
  entry.capturedUpCost = upCost;
  entry.capturedDownCost = downCost;
  entry.capturedAtTs = Date.now();

  const paired = Math.min(upShares || 0, downShares || 0);
  const avgUp = upShares > 0 ? upCost / upShares : 0;
  const avgDown = downShares > 0 ? downCost / downShares : 0;
  const cpp = avgUp + avgDown;

  console.log(`[MergeScheduler] 🧷 Captured at expiry ${marketSlug.slice(-25)}: paired=${paired.toFixed(2)} CPP=$${cpp.toFixed(4)}`);
}

export function isMergeSchedulerReady(): boolean {
  return initialized && (mergeManager?.isReady() ?? false);
}
