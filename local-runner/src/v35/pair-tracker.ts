// ============================================================
// V37 PAIR TRACKER - SIMPLE DUMB LOOP
// ============================================================
// Version: V37.0.0 - "Back to Basics"
//
// SUPER SIMPLE LOGIC:
// 1. Every 5 seconds: buy expensive side as TAKER
// 2. Immediately place MAKER limit at: 100 - takerPrice - 5c
// 3. Max 10 pairs open (WAITING_HEDGE status)
// 4. No reversals, no guards, no complexity
//
// That's it. Simple market making.
// ============================================================

import type { V35Market, V35Side, V35Asset, V35Fill } from './types.js';
import { placeOrder, cancelOrder } from '../polymarket.js';
import { logPairEvent, saveV35Fill } from './backend.js';
import { getV35Config } from './config.js';
import { registerOurOrderId } from './user-ws.js';

// ============================================================
// TYPES
// ============================================================

export type PairStatus = 
  | 'PENDING_ENTRY'      // Waiting for taker entry to fill
  | 'WAITING_HEDGE'      // Taker filled, waiting for maker hedge
  | 'HEDGED'             // Both sides filled
  | 'EXPIRED'            // Market expired
  | 'CANCELLED';         // Manually cancelled

export interface PendingPair {
  id: string;
  marketSlug: string;
  asset: V35Asset;
  conditionId: string;
  
  // Entry side (expensive/winning side)
  takerSide: V35Side;
  takerPrice: number;
  takerSize: number;
  takerOrderId?: string;
  takerFilledAt?: number;
  takerFilledPrice?: number;
  takerFilledSize?: number;
  
  // Hedge side (cheap/losing side)
  makerSide: V35Side;
  makerPrice: number;
  makerSize: number;
  makerOrderId?: string;
  makerFilledAt?: number;
  makerFilledPrice?: number;
  makerFilledSize?: number;
  
  // Lifecycle
  status: PairStatus;
  createdAt: number;
  updatedAt: number;
  
  // P&L tracking
  targetCpp: number;       // Target combined price per share
  actualCpp?: number;      // Actual combined cost
  pnl?: number;            // Realized P&L
}

export interface PairTrackerConfig {
  maxPendingPairs: number;           // Max concurrent pairs (WAITING_HEDGE)
  targetMargin: number;              // Target margin (default 5c = 0.05)
  minSharesPerPair: number;          // Minimum shares per pair
  maxSharesPerPair: number;          // Maximum shares per pair
  pairCooldownMs: number;            // Interval between new pairs
}

const DEFAULT_CONFIG: PairTrackerConfig = {
  maxPendingPairs: 10,              // Max 10 open maker orders
  targetMargin: 0.05,               // 5c margin = 95c CPP
  minSharesPerPair: 5,
  maxSharesPerPair: 20,
  pairCooldownMs: 5_000,            // 5 seconds between pairs
};

// ============================================================
// PAIR TRACKER CLASS - SIMPLE VERSION
// ============================================================

export class PairTracker {
  private config: PairTrackerConfig;
  private pairs: Map<string, PendingPair> = new Map();
  private pairCounter = 0;
  private lastPairOpenedAt: number = 0;
  
  constructor(config: Partial<PairTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ============================================================
  // SIMPLE CHECKS
  // ============================================================
  
  /**
   * Check if we can open a new pair
   * Only checks: cooldown + max pairs
   */
  canOpenNewPair(): boolean {
    // Check cooldown
    const timeSinceLastPair = Date.now() - this.lastPairOpenedAt;
    if (timeSinceLastPair < this.config.pairCooldownMs) {
      const remaining = Math.ceil((this.config.pairCooldownMs - timeSinceLastPair) / 1000);
      console.log(`[PairTracker] ⏳ Cooldown: ${remaining}s remaining`);
      return false;
    }
    
    // Check max pairs (only count WAITING_HEDGE)
    const waitingCount = this.getWaitingPairs().length;
    if (waitingCount >= this.config.maxPendingPairs) {
      console.log(`[PairTracker] 🛑 Max pairs: ${waitingCount}/${this.config.maxPendingPairs}`);
      return false;
    }
    
    console.log(`[PairTracker] ✅ Can open: ${waitingCount}/${this.config.maxPendingPairs} pairs`);
    return true;
  }
  
  /**
   * Get pairs in WAITING_HEDGE status
   */
  getWaitingPairs(): PendingPair[] {
    return Array.from(this.pairs.values()).filter(p => p.status === 'WAITING_HEDGE');
  }
  
  /**
   * Get all active pairs (PENDING_ENTRY + WAITING_HEDGE)
   */
  getActivePairs(): PendingPair[] {
    return Array.from(this.pairs.values()).filter(p => 
      p.status === 'PENDING_ENTRY' || p.status === 'WAITING_HEDGE'
    );
  }
  
  /**
   * Get pairs for a specific market
   */
  getMarketPairs(marketSlug: string): PendingPair[] {
    return Array.from(this.pairs.values()).filter(p => p.marketSlug === marketSlug);
  }
  
  // ============================================================
  // MAIN ENTRY: OPEN PAIR
  // ============================================================
  
  /**
   * Open a new pair - SIMPLE VERSION
   * 
   * 1. Buy expensive side as TAKER (FOK)
   * 2. Place MAKER limit at: 100 - takerPrice - 5c
   */
  async openPair(
    market: V35Market,
    expensiveSide: V35Side,
    size: number
  ): Promise<{ success: boolean; pairId?: string; error?: string }> {
    const config = getV35Config();
    
    // Only BTC for now
    if (market.asset !== 'BTC') {
      return { success: false, error: 'only_btc' };
    }
    
    // Check if we can open
    if (!this.canOpenNewPair()) {
      return { success: false, error: 'cooldown_or_max_pairs' };
    }
    
    // Set cooldown immediately
    this.lastPairOpenedAt = Date.now();
    
    // Clamp size
    size = Math.max(this.config.minSharesPerPair, Math.min(size, this.config.maxSharesPerPair));
    
    // Get prices
    const expensiveAsk = expensiveSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    const cheapSide: V35Side = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    
    // Calculate maker price: 100 - takerPrice - margin
    const makerPrice = 1.00 - expensiveAsk - this.config.targetMargin;
    
    // Validate maker price
    if (makerPrice < 0.01) {
      console.log(`[PairTracker] ❌ Maker price too low: $${makerPrice.toFixed(3)}`);
      return { success: false, error: 'maker_price_below_1c' };
    }
    
    if (makerPrice > 0.99) {
      console.log(`[PairTracker] ❌ Maker price too high: $${makerPrice.toFixed(3)}`);
      return { success: false, error: 'maker_price_above_99c' };
    }
    
    // Ensure $1 minimum order value
    const MIN_ORDER_VALUE = 1.00;
    const takerOrderValue = size * expensiveAsk;
    if (takerOrderValue < MIN_ORDER_VALUE) {
      size = Math.ceil(MIN_ORDER_VALUE / expensiveAsk);
      console.log(`[PairTracker] 📈 Adjusted size for $1 min: ${size} shares`);
    }
    
    // Create pair ID
    const pairId = `pair_${Date.now()}_${++this.pairCounter}`;
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 🟠 OPENING ${pairId}`);
    console.log(`[PairTracker]    TAKER: ${size} ${expensiveSide} @ ~$${expensiveAsk.toFixed(2)}`);
    console.log(`[PairTracker]    MAKER: ${size} ${cheapSide} @ $${makerPrice.toFixed(2)} (limit)`);
    console.log(`[PairTracker]    TARGET CPP: $${(1.00 - this.config.targetMargin).toFixed(2)}`);
    console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
    
    if (config.dryRun) {
      console.log(`[PairTracker] [DRY RUN] Would open pair`);
      return { success: false, error: 'dry_run' };
    }
    
    // Create pair object
    const pair: PendingPair = {
      id: pairId,
      marketSlug: market.slug,
      asset: market.asset,
      conditionId: market.conditionId,
      
      takerSide: expensiveSide,
      takerPrice: expensiveAsk,
      takerSize: size,
      
      makerSide: cheapSide,
      makerPrice: makerPrice,
      makerSize: size,
      
      status: 'PENDING_ENTRY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCpp: 1.00 - this.config.targetMargin,
    };
    
    this.pairs.set(pairId, pair);
    
    // Get token IDs
    const takerTokenId = expensiveSide === 'UP' ? market.upTokenId : market.downTokenId;
    const makerTokenId = cheapSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    // =========================================================================
    // STEP 1: PLACE TAKER (FOK)
    // =========================================================================
    try {
      const takerPrice = Math.min(0.99, expensiveAsk + 0.02); // Small buffer
      console.log(`[PairTracker] 🚀 TAKER: ${size} ${expensiveSide} @ $${takerPrice.toFixed(3)} (FOK)`);
      
      const takerResult = await placeOrder({
        tokenId: takerTokenId,
        side: 'BUY',
        price: takerPrice,
        size,
        orderType: 'FOK',
      });
      
      if (!takerResult.success || !takerResult.orderId) {
        console.log(`[PairTracker] ❌ Taker failed: ${takerResult.error}`);
        this.pairs.delete(pairId);
        return { success: false, error: takerResult.error || 'taker_failed' };
      }
      
      registerOurOrderId(takerResult.orderId);
      pair.takerOrderId = takerResult.orderId;
      
      // Check if filled
      if (takerResult.status !== 'filled' && takerResult.status !== 'partial') {
        console.log(`[PairTracker] ❌ Taker not filled: ${takerResult.status}`);
        this.pairs.delete(pairId);
        return { success: false, error: 'taker_not_filled' };
      }
      
      const filledSize = takerResult.filledSize || size;
      const filledPrice = takerResult.avgPrice || expensiveAsk;
      
      pair.takerFilledAt = Date.now();
      pair.takerFilledPrice = filledPrice;
      pair.takerFilledSize = filledSize;
      
      console.log(`[PairTracker] ✅ TAKER FILLED: ${filledSize} @ $${filledPrice.toFixed(3)}`);
      
      // Save fill to database
      saveV35Fill({
        orderId: takerResult.orderId,
        tokenId: takerTokenId,
        side: expensiveSide,
        price: filledPrice,
        size: filledSize,
        timestamp: new Date(),
        marketSlug: market.slug,
        asset: market.asset,
        fillType: 'TAKER',
      }).catch(err => console.error('[PairTracker] Failed to save taker fill:', err));
      
      // =========================================================================
      // STEP 2: PLACE MAKER IMMEDIATELY (GTC limit order)
      // =========================================================================
      // Recalculate maker price based on actual fill price
      const actualMakerPrice = Math.max(0.01, 1.00 - filledPrice - this.config.targetMargin);
      
      // Ensure $1 minimum for maker too
      let makerSize = filledSize;
      const makerOrderValue = makerSize * actualMakerPrice;
      if (makerOrderValue < MIN_ORDER_VALUE) {
        makerSize = Math.ceil(MIN_ORDER_VALUE / actualMakerPrice);
        console.log(`[PairTracker] 📈 Adjusted maker size for $1 min: ${makerSize} shares`);
      }
      
      console.log(`[PairTracker] 📝 MAKER: ${makerSize} ${cheapSide} @ $${actualMakerPrice.toFixed(3)} (GTC)`);
      
      const makerResult = await placeOrder({
        tokenId: makerTokenId,
        side: 'BUY',
        price: actualMakerPrice,
        size: makerSize,
        orderType: 'GTC',
      });
      
      if (!makerResult.success || !makerResult.orderId) {
        console.log(`[PairTracker] ⚠️ Maker failed: ${makerResult.error}`);
        // Taker already filled - we're stuck, but continue
        pair.status = 'CANCELLED';
        return { success: false, error: `taker_filled_maker_failed: ${makerResult.error}` };
      }
      
      registerOurOrderId(makerResult.orderId);
      pair.makerOrderId = makerResult.orderId;
      pair.makerPrice = actualMakerPrice;
      pair.makerSize = makerSize;
      pair.status = 'WAITING_HEDGE';
      pair.updatedAt = Date.now();
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ PAIR OPENED: ${pairId}`);
      console.log(`[PairTracker]    TAKER: ${filledSize} ${expensiveSide} @ $${filledPrice.toFixed(3)} ✓`);
      console.log(`[PairTracker]    MAKER: ${makerSize} ${cheapSide} @ $${actualMakerPrice.toFixed(3)} (open)`);
      console.log(`[PairTracker]    PROJECTED CPP: $${(filledPrice + actualMakerPrice).toFixed(3)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      // Log to database
      logPairEvent({
        pairId,
        eventType: 'pair_opened',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: expensiveSide,
        takerPrice: filledPrice,
        takerSize: filledSize,
        makerSide: cheapSide,
        makerPrice: actualMakerPrice,
        makerSize: makerSize,
        status: 'WAITING_HEDGE',
      }).catch(() => {});
      
      return { success: true, pairId };
      
    } catch (err: any) {
      console.error(`[PairTracker] Error:`, err?.message);
      this.pairs.delete(pairId);
      return { success: false, error: err?.message };
    }
  }
  
  // ============================================================
  // FILL HANDLING
  // ============================================================
  
  /**
   * Handle a fill from WebSocket
   * Just marks the pair as HEDGED if maker fills
   */
  onFill(fill: V35Fill): void {
    // Find the pair this fill belongs to
    const pair = Array.from(this.pairs.values()).find(p => 
      p.makerOrderId === fill.orderId && p.status === 'WAITING_HEDGE'
    );
    
    if (!pair) {
      // Could be taker fill or unknown - ignore
      return;
    }
    
    // Maker filled!
    pair.makerFilledAt = Date.now();
    pair.makerFilledPrice = fill.price;
    pair.makerFilledSize = (pair.makerFilledSize || 0) + fill.size;
    
    // Calculate P&L
    const takerCost = (pair.takerFilledPrice || 0) * (pair.takerFilledSize || 0);
    const makerCost = (pair.makerFilledPrice || 0) * pair.makerFilledSize;
    const totalCost = takerCost + makerCost;
    const pairedShares = Math.min(pair.takerFilledSize || 0, pair.makerFilledSize);
    
    pair.actualCpp = totalCost / pairedShares;
    pair.pnl = pairedShares - totalCost; // Each pair pays $1 at settlement
    
    // Check if fully hedged
    if (pair.makerFilledSize >= (pair.takerFilledSize || 0)) {
      pair.status = 'HEDGED';
      pair.updatedAt = Date.now();
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ ${pair.id} FULLY HEDGED`);
      console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${pair.takerFilledPrice?.toFixed(3)}`);
      console.log(`[PairTracker]    MAKER: ${pair.makerFilledSize} ${pair.makerSide} @ $${pair.makerFilledPrice?.toFixed(3)}`);
      console.log(`[PairTracker]    CPP: $${pair.actualCpp?.toFixed(3)} | P&L: $${pair.pnl?.toFixed(2)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      // Save maker fill
      saveV35Fill({
        orderId: fill.orderId,
        tokenId: fill.tokenId,
        side: pair.makerSide,
        price: fill.price,
        size: fill.size,
        timestamp: new Date(),
        marketSlug: pair.marketSlug,
        asset: pair.asset,
        fillType: 'MAKER',
      }).catch(err => console.error('[PairTracker] Failed to save maker fill:', err));
      
      // Log hedged event
      logPairEvent({
        pairId: pair.id,
        eventType: 'pair_hedged',
        marketSlug: pair.marketSlug,
        asset: pair.asset,
        takerSide: pair.takerSide,
        takerPrice: pair.takerFilledPrice || 0,
        takerSize: pair.takerFilledSize || 0,
        makerSide: pair.makerSide,
        makerPrice: pair.makerFilledPrice || 0,
        makerSize: pair.makerFilledSize,
        cpp: pair.actualCpp,
        pnl: pair.pnl,
        status: 'HEDGED',
      }).catch(() => {});
    }
  }
  
  // ============================================================
  // MARKET CLEANUP
  // ============================================================
  
  /**
   * Reset all pairs for a market (when it expires)
   */
  resetMarketPairs(marketSlug: string): { reset: number } {
    const marketPairs = this.getMarketPairs(marketSlug);
    let reset = 0;
    
    for (const pair of marketPairs) {
      if (pair.status === 'PENDING_ENTRY' || pair.status === 'WAITING_HEDGE') {
        pair.status = 'EXPIRED';
        pair.updatedAt = Date.now();
        reset++;
      }
      this.pairs.delete(pair.id);
    }
    
    if (reset > 0) {
      console.log(`[PairTracker] 🔄 Reset ${reset} pairs for: ${marketSlug.slice(-30)}`);
    }
    
    return { reset };
  }
  
  /**
   * Cancel all open maker orders for a market
   */
  async cancelAllMakerOrders(marketSlug: string): Promise<number> {
    const waitingPairs = this.getMarketPairs(marketSlug)
      .filter(p => p.status === 'WAITING_HEDGE' && p.makerOrderId);
    
    let cancelled = 0;
    for (const pair of waitingPairs) {
      try {
        await cancelOrder(pair.makerOrderId!);
        pair.status = 'CANCELLED';
        cancelled++;
      } catch (err) {
        console.error(`[PairTracker] Failed to cancel ${pair.makerOrderId}:`, err);
      }
    }
    
    return cancelled;
  }
  
  // ============================================================
  // SUMMARY & DEBUG
  // ============================================================
  
  /**
   * Get summary stats for a market
   */
  getMarketSummary(marketSlug: string): {
    waiting: number;
    hedged: number;
    totalTakerShares: number;
    totalMakerShares: number;
  } {
    const pairs = this.getMarketPairs(marketSlug);
    
    return {
      waiting: pairs.filter(p => p.status === 'WAITING_HEDGE').length,
      hedged: pairs.filter(p => p.status === 'HEDGED').length,
      totalTakerShares: pairs.reduce((sum, p) => sum + (p.takerFilledSize || 0), 0),
      totalMakerShares: pairs.reduce((sum, p) => sum + (p.makerFilledSize || 0), 0),
    };
  }
  
  /**
   * Get all pairs (for debugging)
   */
  getAllPairs(): PendingPair[] {
    return Array.from(this.pairs.values());
  }
  
  /**
   * Get stats for logging/monitoring
   */
  getStats(): {
    totalPairs: number;
    waitingPairs: number;
    hedgedPairs: number;
    totalTakerShares: number;
    totalMakerShares: number;
    totalPnl: number;
  } {
    const allPairs = this.getAllPairs();
    const waiting = allPairs.filter(p => p.status === 'WAITING_HEDGE');
    const hedged = allPairs.filter(p => p.status === 'HEDGED');
    
    return {
      totalPairs: allPairs.length,
      waitingPairs: waiting.length,
      hedgedPairs: hedged.length,
      totalTakerShares: allPairs.reduce((sum, p) => sum + (p.takerFilledSize || 0), 0),
      totalMakerShares: allPairs.reduce((sum, p) => sum + (p.makerFilledSize || 0), 0),
      totalPnl: hedged.reduce((sum, p) => sum + (p.pnl || 0), 0),
    };
  }
  
  // ============================================================
  // LEGACY COMPATIBILITY STUBS
  /**
   * Cleanup old pairs (remove HEDGED/EXPIRED/CANCELLED pairs older than 5 minutes)
   */
  cleanup(): void {
    const CLEANUP_AGE_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    
    for (const [id, pair] of this.pairs) {
      if (
        (pair.status === 'HEDGED' || pair.status === 'EXPIRED' || pair.status === 'CANCELLED') &&
        (now - pair.updatedAt) > CLEANUP_AGE_MS
      ) {
        this.pairs.delete(id);
        console.log(`[PairTracker] 🧹 Cleaned up old pair: ${id}`);
      }
    }
  }
  
  // ============================================================
  // These are no-ops to maintain compatibility with runner.ts
  
  registerMarketStart(_marketSlug: string): void {
    // No startup delay in simple mode
  }
  
  isStartupDelayComplete(_marketSlug: string): boolean {
    return true; // Always ready
  }
  
  clearMarketStart(_marketSlug: string): void {
    // No-op
  }
  
  getInventoryStatus(_marketSlug: string): { UP: number; DOWN: number } {
    return { UP: 0, DOWN: 0 }; // No inventory tracking in simple mode
  }
}

// ============================================================
// SINGLETON
// ============================================================

let pairTrackerInstance: PairTracker | null = null;

export function getPairTracker(): PairTracker {
  if (!pairTrackerInstance) {
    pairTrackerInstance = new PairTracker();
  }
  return pairTrackerInstance;
}

export function resetPairTracker(): void {
  pairTrackerInstance = null;
}
