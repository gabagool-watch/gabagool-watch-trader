// ============================================================
// V36 PAIR TRACKER - INDEPENDENT PAIR LIFECYCLE MANAGEMENT
// ============================================================
// Version: V36.10.0 - "Dynamic CPP Escalation"
// Version: V36.7.0 - "Dynamic Delta Margin"
// Version: V36.6.0 - "Risk Guards - Share Gap Guard"
// Version: V36.5.3 - "Maker Inventory Pre-Hedging"
//
// V36.5.3 CAPITAL EFFICIENCY:
// - Surplus maker shares (from $1 minimum scaling) go to "inventory"
// - New takers check inventory first → instant pre-hedge, no new order
// - Example: 50 DOWN filled for 20 UP taker → 30 surplus to inventory
//            Next 15 UP taker → consumed from inventory, instantly hedged!
// - Prevents wasteful "extra" maker shares that don't hedge anything
//
// V36.5.1 CRITICAL FIX:
// - Maker size is calculated INDEPENDENTLY from taker size
// - Formula: makerSize = max(takerSize, ceil(1.00 / makerPrice))
// - This ensures maker orders always meet $1.00 minimum
//
// V36.4.3 CRITICAL FIX:
// - Early Whitelisting: Register orderId IMMEDIATELY after API response
// - Fill Audit Fallback: Poll API for fills if WebSocket misses them
//
// V36.3.1 CRITICAL FIX:
// - Set makerPlaced=true BEFORE async placeOrder call
// - Prevents race conditions where REST + WebSocket both try to place
//
// V36.3.0 CRITICAL FIX:
// - MAKER ORDER IS PLACED ONLY ONCE - in openPair() after taker fill
// - onFill() now only tracks fills, does NOT place maker orders
//
// CORE CONCEPT:
// Each trade is an INDEPENDENT "Pair" with its own lifecycle:
// 1. TAKER entry on expensive (winning) side - MARKET ORDER (FOK)
// 2. MAKER limit order on cheap (losing) side - placed IMMEDIATELY after taker
// 3. Settlement OR Emergency Hedge if reversal detected
// ============================================================

import type { V35Market, V35Side, V35Asset, V35Fill } from './types.js';
import { placeOrder, cancelOrder, getOpenOrders, getOrderFillInfo } from '../polymarket.js';
import { getBinanceFeed } from './binance-feed.js';
import { logV35GuardEvent, logPairEvent, saveV35Fill } from './backend.js';
import { getV35Config } from './config.js';
// CRITICAL: Register our order IDs so fills are recognized as ours!
import { registerOurOrderId } from './user-ws.js';
// V36.6: Import reversal detector for capacity boost during reversals
import { getReversalDetector } from './reversal-detector.js';

// ============================================================
// TYPES
// ============================================================

export type PairStatus = 
  | 'PENDING_ENTRY'      // Waiting for taker entry to fill
  | 'WAITING_HEDGE'      // Taker filled, waiting for maker hedge
  | 'HEDGED'             // Both sides filled
  | 'EMERGENCY_HEDGED'   // Stop-loss triggered
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
  
  // V36.5.2: FIFO Hedge Aggregation
  // When a maker order hedges multiple takers, track the linked pairs
  linkedPairIds?: string[];           // IDs of other pairs sharing this maker order
  makerAllocatedSize?: number;        // How many maker shares were allocated to THIS pair
  isPrimaryMakerPair?: boolean;       // True if this pair "owns" the maker order
  
  // Emergency hedge (if reversal detected)
  emergencyOrderId?: string;
  emergencyFilledAt?: number;
  emergencyFilledPrice?: number;
  emergencyFilledSize?: number;
  
  // Lifecycle
  status: PairStatus;
  createdAt: number;
  updatedAt: number;
  
  // P&L tracking
  targetCpp: number;       // Target combined price per share
  actualCpp?: number;      // Actual combined cost
  pnl?: number;            // Realized P&L
  
  // V36.3.0: Flag to prevent double maker placement
  makerPlaced: boolean;
}

export interface PairTrackerConfig {
  maxPendingPairs: number;           // Max concurrent pairs
  maxPendingPairsReversal: number;   // V36.6: Extra capacity during reversal
  targetCpp: number;                 // Target combined cost (e.g., 0.95)
  emergencyMaxCpp: number;           // Max combined cost for emergency hedge
  emergencyTakerOffset: number;      // Offset above ask for emergency (e.g., 0.005)
  minSharesPerPair: number;          // Minimum shares per pair
  maxSharesPerPair: number;          // Maximum shares per pair
  startupDelayMs: number;            // Wait after market open before first pair
  pairCooldownMs: number;            // V36.3.1: Cooldown between opening new pairs
}

const DEFAULT_CONFIG: PairTrackerConfig = {
  maxPendingPairs: 5,               // V36.5.0: 5 concurrent pairs for better throughput
  maxPendingPairsReversal: 8,       // V36.6: +3 extra pairs during reversal (5 + 3)
  targetCpp: 0.93,                  // V36.10: Start lower for better profit margin
  emergencyMaxCpp: 1.05,
  emergencyTakerOffset: 0.005,
  minSharesPerPair: 5,
  maxSharesPerPair: 20,
  startupDelayMs: 60_000,            // 1 MINUTE observation period
  pairCooldownMs: 10_000,            // V36.12: 10 seconds between new pairs
};

// ============================================================
// V36.10: CPP ESCALATION SCHEDULE
// ============================================================
// The maker order price ESCALATES over time to ensure hedging:
// - Start at targetCpp (0.93) for maximum profit margin
// - After 30s:  escalate to 0.95 (+2ct)
// - After 60s:  escalate to 0.97 (+4ct)
// - After 90s:  escalate to 0.99 (+6ct)
// - After 120s: escalate to 1.00 (break-even, but HEDGED!)
// ============================================================
interface CppEscalationStep {
  afterMs: number;
  maxCpp: number;
}

const CPP_ESCALATION_SCHEDULE: CppEscalationStep[] = [
  { afterMs: 0,       maxCpp: 0.93 },   // Initial: best margin
  { afterMs: 30_000,  maxCpp: 0.95 },   // 30s: slightly higher
  { afterMs: 60_000,  maxCpp: 0.97 },   // 60s: getting urgent
  { afterMs: 90_000,  maxCpp: 0.99 },   // 90s: near break-even
  { afterMs: 120_000, maxCpp: 1.00 },   // 120s: break-even guaranteed hedge
];

// ============================================================
// V36.5.3: MAKER INVENTORY - Pre-hedge surplus shares
// ============================================================
// When maker orders are scaled up for $1 minimum, surplus shares
// become "inventory" that can pre-hedge future takers:
//
// Example:
//   Taker A: 20 UP @ $0.90
//   Maker:   50 DOWN @ $0.02 (scaled, 30 surplus)
//   → Inventory: { DOWN: 30 }
//
//   Taker B: 15 UP @ $0.91 (later)
//   → Check inventory: 30 DOWN available!
//   → Consume 15 from inventory, no new maker needed
//   → Inventory: { DOWN: 15 }
// ============================================================

interface MakerInventory {
  UP: number;
  DOWN: number;
  avgPrice: { UP: number; DOWN: number };  // Track avg cost for P&L
}

// ============================================================
// PAIR TRACKER CLASS
// ============================================================

export class PairTracker {
  private config: PairTrackerConfig;
  private pairs: Map<string, PendingPair> = new Map();
  private pairCounter = 0;
  private marketStartTimes: Map<string, number> = new Map();
  private lastPairOpenedAt: number = 0;  // V36.3.1: Track last pair open time
  
  // V36.5.3: Maker inventory per market - surplus shares for future hedges
  private makerInventory: Map<string, MakerInventory> = new Map();
  
  constructor(config: Partial<PairTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ============================================================
  // V36.5.3: MAKER INVENTORY MANAGEMENT
  // ============================================================
  
  /**
   * Get or create inventory for a market
   */
  private getInventory(marketSlug: string): MakerInventory {
    let inv = this.makerInventory.get(marketSlug);
    if (!inv) {
      inv = { UP: 0, DOWN: 0, avgPrice: { UP: 0, DOWN: 0 } };
      this.makerInventory.set(marketSlug, inv);
    }
    return inv;
  }
  
  /**
   * Add surplus shares to inventory after maker fill
   */
  private addToInventory(marketSlug: string, side: V35Side, shares: number, price: number): void {
    const inv = this.getInventory(marketSlug);
    const existing = inv[side];
    const existingAvg = inv.avgPrice[side];
    
    // Weighted average price
    if (existing + shares > 0) {
      inv.avgPrice[side] = (existing * existingAvg + shares * price) / (existing + shares);
    }
    inv[side] += shares;
    
    console.log(`[PairTracker] 📦 V36.5.3: Added ${shares} ${side} to inventory @ $${price.toFixed(3)}`);
    console.log(`[PairTracker]    Inventory now: UP=${inv.UP} | DOWN=${inv.DOWN}`);
  }
  
  /**
   * Consume shares from inventory for a new taker (pre-hedge)
   * Returns: { consumed: number, remainingNeeded: number, avgPrice: number }
   */
  private consumeFromInventory(
    marketSlug: string, 
    side: V35Side, 
    needed: number
  ): { consumed: number; remainingNeeded: number; avgPrice: number } {
    const inv = this.getInventory(marketSlug);
    const available = inv[side];
    
    if (available <= 0) {
      return { consumed: 0, remainingNeeded: needed, avgPrice: 0 };
    }
    
    const consumed = Math.min(available, needed);
    const avgPrice = inv.avgPrice[side];
    inv[side] -= consumed;
    
    console.log(`[PairTracker] 📦 V36.5.3: Consumed ${consumed} ${side} from inventory @ avg $${avgPrice.toFixed(3)}`);
    console.log(`[PairTracker]    Inventory now: UP=${inv.UP} | DOWN=${inv.DOWN}`);
    
    return { 
      consumed, 
      remainingNeeded: needed - consumed,
      avgPrice 
    };
  }
  
  /**
   * Get current inventory levels (for dashboard/logging)
   */
  getInventoryStatus(marketSlug: string): { UP: number; DOWN: number } {
    const inv = this.makerInventory.get(marketSlug);
    return inv ? { UP: inv.UP, DOWN: inv.DOWN } : { UP: 0, DOWN: 0 };
  }
  
  /**
   * Register when a market window starts (for startup delay calculation)
   */
  registerMarketStart(marketSlug: string): void {
    if (!this.marketStartTimes.has(marketSlug)) {
      this.marketStartTimes.set(marketSlug, Date.now());
      console.log(`[PairTracker] 📍 Registered market start: ${marketSlug} | Waiting ${this.config.startupDelayMs / 1000}s before trading`);
    }
  }
  
  /**
   * Check if startup delay has passed for this market
   */
  isStartupDelayComplete(marketSlug: string): boolean {
    const startTime = this.marketStartTimes.get(marketSlug);
    if (!startTime) {
      this.registerMarketStart(marketSlug);
      return false;
    }
    
    const elapsed = Date.now() - startTime;
    const complete = elapsed >= this.config.startupDelayMs;
    
    if (!complete) {
      const remaining = Math.ceil((this.config.startupDelayMs - elapsed) / 1000);
      if (remaining % 5 === 0 || remaining <= 3) {
        console.log(`[PairTracker] ⏳ Startup delay: ${remaining}s remaining for ${marketSlug}`);
      }
    }
    
    return complete;
  }
  
  /**
   * Clear market start time (for cleanup when market ends)
   */
  clearMarketStart(marketSlug: string): void {
    this.marketStartTimes.delete(marketSlug);
  }
  
  /**
   * Check if we can open a new pair (respects max pairs AND cooldown)
   * 
   * V36.3.8 CRITICAL FIX: Block new pairs if too many are WAITING_HEDGE!
   * This was the root cause of massive losses - bot kept placing takers
   * while makers weren't being filled, creating huge unhedged exposure.
   * 
   * V36.6: During active reversal, allow +3 extra pairs to recover
   */
  canOpenNewPair(): boolean {
    const activePairs = this.getActivePairs();
    const count = activePairs.length;
    
    const pending = activePairs.filter(p => p.status === 'PENDING_ENTRY').length;
    const waiting = activePairs.filter(p => p.status === 'WAITING_HEDGE').length;
    
    // V36.3.1: Check cooldown
    const timeSinceLastPair = Date.now() - this.lastPairOpenedAt;
    if (timeSinceLastPair < this.config.pairCooldownMs) {
      const remaining = Math.ceil((this.config.pairCooldownMs - timeSinceLastPair) / 1000);
      console.log(`[PairTracker] ⏳ Pair cooldown: ${remaining}s remaining`);
      return false;
    }
    
    // V36.9.1: Check for active reversal → use higher capacity
    const reversalDetector = getReversalDetector();
    const isReversalActive = reversalDetector.isReversalActive();
    const effectiveMax = isReversalActive 
      ? this.config.maxPendingPairsReversal 
      : this.config.maxPendingPairs;
    
    // V36.9.1 FIX: MAX_WAITING_HEDGE should match effectiveMax, not be a separate restrictive limit
    // Old behavior: MAX_WAITING_HEDGE = 3 blocked new pairs even when maxPendingPairs = 5
    // New behavior: WAITING_HEDGE limit = effectiveMax (5 normally, 8 during reversal)
    if (waiting >= effectiveMax) {
      const modeLabel = isReversalActive ? 'REVERSAL MODE' : 'normal';
      console.log(`[PairTracker] 🚨 BLOCK: ${waiting} pairs WAITING_HEDGE (max ${effectiveMax}) [${modeLabel}]`);
      console.log(`[PairTracker]    💡 Waiting for maker orders to fill before opening more pairs`);
      return false;
    }
    
    if (count >= effectiveMax) {
      const modeLabel = isReversalActive ? 'REVERSAL MODE' : 'normal';
      console.log(`[PairTracker] 🛑 Max pairs reached: ${count}/${effectiveMax} [${modeLabel}] (pending=${pending}, waiting=${waiting})`);
      return false;
    }
    
    if (isReversalActive) {
      console.log(`[PairTracker] ✅ Can open pair: ${count}/${effectiveMax} [REVERSAL MODE +3] (pending=${pending}, waiting=${waiting})`);
    } else {
      console.log(`[PairTracker] ✅ Can open pair: ${count}/${effectiveMax} (pending=${pending}, waiting=${waiting})`);
    }
    return true;
  }
  
  /**
   * Get all active (non-terminal) pairs
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
    return Array.from(this.pairs.values()).filter(p => 
      p.marketSlug === marketSlug
    );
  }
  
  /**
   * V36.5.2: Get unhedged pairs that need the same maker side
   * Used for FIFO aggregation - find older pairs we can hedge together
   * 
   * Returns pairs sorted by createdAt (oldest first = FIFO)
   */
  getUnhedgedPairsForMakerSide(marketSlug: string, makerSide: V35Side): PendingPair[] {
    return Array.from(this.pairs.values())
      .filter(p => 
        p.marketSlug === marketSlug &&
        p.makerSide === makerSide &&
        p.status === 'WAITING_HEDGE' &&
        !p.makerOrderId &&  // No maker order placed yet
        p.takerFilledAt     // Taker is filled
      )
      .sort((a, b) => a.createdAt - b.createdAt);  // FIFO: oldest first
  }
  
  /**
   * V36.3.6: Reset all pairs for a specific market (when market expires)
   * This prevents stale pairs from blocking new pairs in the next market cycle
   */
  resetMarketPairs(marketSlug: string): { reset: number; active: number } {
    const marketPairs = this.getMarketPairs(marketSlug);
    const activePairs = marketPairs.filter(p => 
      p.status === 'PENDING_ENTRY' || p.status === 'WAITING_HEDGE'
    );
    
    let resetCount = 0;
    for (const pair of marketPairs) {
      // Mark all non-terminal pairs as EXPIRED
      if (pair.status === 'PENDING_ENTRY' || pair.status === 'WAITING_HEDGE') {
        pair.status = 'EXPIRED';
        pair.updatedAt = Date.now();
        resetCount++;
      }
      // Delete the pair entirely
      this.pairs.delete(pair.id);
    }
    
    // Also clear the market start time
    this.clearMarketStart(marketSlug);
    
    if (resetCount > 0) {
      console.log(`[PairTracker] 🔄 Reset ${resetCount} pairs for expired market: ${marketSlug.slice(-30)}`);
    }
    
    return { reset: resetCount, active: activePairs.length };
  }
  
  /**
   * Open a new pair: ALWAYS execute TAKER on expensive side
   * V36.3.0: Maker order is placed ONLY here, immediately after taker fill
   */
  async openPair(
    market: V35Market,
    expensiveSide: V35Side,
    size: number
  ): Promise<{ success: boolean; pairId?: string; error?: string }> {
    const config = getV35Config();
    
    // ONLY BTC
    if (market.asset !== 'BTC') {
      return { success: false, error: 'only_btc_allowed' };
    }
    
    // Check startup delay
    if (!this.isStartupDelayComplete(market.slug)) {
      return { success: false, error: 'startup_delay_active' };
    }
    
    // Validate
    if (!this.canOpenNewPair()) {
      return { success: false, error: `max_pairs_reached_or_cooldown` };
    }
    
    // V36.3.4: SET COOLDOWN TIMER IMMEDIATELY at entry point
    // This prevents rapid-fire calls from bypassing the cooldown
    // even if later checks fail (dry run, price cap, etc.)
    this.lastPairOpenedAt = Date.now();
    console.log(`[PairTracker] ⏱️ Cooldown started - next pair allowed in ${this.config.pairCooldownMs / 1000}s`);
    
    size = Math.max(this.config.minSharesPerPair, Math.min(size, this.config.maxSharesPerPair));
    
    // Get current prices
    const expensiveAsk = expensiveSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    const cheapAsk = expensiveSide === 'UP' ? market.downBestAsk : market.upBestAsk;
    const cheapSide: V35Side = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    
    // =========================================================================
    // MINIMUM ORDER VALUE CHECK ($1.00) - TAKER ONLY
    // =========================================================================
    // V36.5.1: We only check taker side here. Maker size is independently
    // calculated in placeMakerOrder() to meet $1 minimum at that price.
    // =========================================================================
    const MIN_ORDER_VALUE = 1.00;
    
    const takerOrderValue = size * expensiveAsk;
    
    if (takerOrderValue < MIN_ORDER_VALUE) {
      const minSharesForTaker = Math.ceil(MIN_ORDER_VALUE / expensiveAsk);
      
      if (minSharesForTaker > this.config.maxSharesPerPair) {
        console.log(`[PairTracker] ⚠️ Cannot meet $1 minimum for taker: need ${minSharesForTaker} shares but max is ${this.config.maxSharesPerPair}`);
        size = this.config.maxSharesPerPair;
      } else {
        console.log(`[PairTracker] 📈 Adjusting taker size for $1 minimum: ${size} → ${minSharesForTaker} shares`);
        size = minSharesForTaker;
      }
    }
    
    // V36.3.3: Block taker orders above $0.95 - no profit margin possible
    const MAX_TAKER_PRICE = 0.95;
    if (expensiveAsk > MAX_TAKER_PRICE) {
      console.log(`[PairTracker] 🔴 BLOCKED: Expensive side @ $${expensiveAsk.toFixed(3)} > $${MAX_TAKER_PRICE.toFixed(2)} cap`);
      // Log to database
      logPairEvent({
        pairId: `blocked_${Date.now()}`,
        eventType: 'pair_blocked',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: expensiveSide,
        takerPrice: expensiveAsk,
        takerSize: size,
        makerSide: cheapSide,
        makerPrice: 0,
        makerSize: size,
        status: 'expensive_side_above_cap',
      });
      return { success: false, error: 'expensive_side_above_cap' };
    }
    
    // =========================================================================
    // V36.6.0 RISK GUARD 1: SHARE GAP + TIME REMAINING
    // =========================================================================
    // Data shows 82% of losses occur with imbalance > 20 shares.
    // When gap > 20 AND time < 300s, block new entries - too risky!
    // =========================================================================
    const SHARE_GAP_THRESHOLD = 20;
    const TIME_REMAINING_THRESHOLD_SEC = 300;
    const currentGap = Math.abs(market.upQty - market.downQty);
    const secondsRemaining = Math.max(0, (market.expiry.getTime() - Date.now()) / 1000);
    
    if (currentGap > SHARE_GAP_THRESHOLD && secondsRemaining < TIME_REMAINING_THRESHOLD_SEC) {
      const reason = `SHARE_GAP_GUARD: gap=${currentGap.toFixed(0)} > ${SHARE_GAP_THRESHOLD} AND time=${secondsRemaining.toFixed(0)}s < ${TIME_REMAINING_THRESHOLD_SEC}s`;
      console.log(`[PairTracker] 🔴 BLOCKED: ${reason}`);
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'SHARE_GAP_TIME_GUARD',
        blockedSide: expensiveSide,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide,
        reason,
      }).catch(() => {});
      logPairEvent({
        pairId: `blocked_${Date.now()}`,
        eventType: 'pair_blocked',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: expensiveSide,
        takerPrice: expensiveAsk,
        takerSize: size,
        makerSide: cheapSide,
        makerPrice: 0,
        makerSize: size,
        status: 'share_gap_time_guard',
      });
      return { success: false, error: 'share_gap_time_guard' };
    }
    
    // =========================================================================
    // V36.7.0: DYNAMIC DELTA MARGIN
    // =========================================================================
    // Profit margin scales with delta confidence:
    // - Large delta (|delta| > 500): High confidence → 10¢ margin
    // - Medium delta (|delta| > 200): Medium confidence → 7¢ margin  
    // - Small-medium (|delta| > 50): Low-medium confidence → 4¢ margin
    // - Small delta (|delta| <= 50): Low confidence → 3¢ margin
    //
    // This allows more profit when we're confident, less when uncertain.
    // Always falls back to minimum viable margin if ideal isn't possible.
    // =========================================================================
    const binanceFeed = getBinanceFeed();
    const currentBtcPrice = binanceFeed?.getPrice('BTC') || 0;
    const strikePrice = market.strikePrice || 0;
    const delta = currentBtcPrice - strikePrice;
    const absDelta = Math.abs(delta);
    
    // Calculate target margin based on delta confidence
    let targetMargin: number;
    let confidenceLevel: string;
    
    if (absDelta > 500) {
      targetMargin = 0.10;  // 10¢ - very confident, take more profit
      confidenceLevel = 'HIGH';
    } else if (absDelta > 200) {
      targetMargin = 0.07;  // 7¢ - medium confidence
      confidenceLevel = 'MEDIUM';
    } else if (absDelta > 50) {
      targetMargin = 0.04;  // 4¢ - low-medium confidence (V36.8.1)
      confidenceLevel = 'LOW_MEDIUM';
    } else {
      targetMargin = 0.03;  // 3¢ - low confidence, play safe
      confidenceLevel = 'LOW';
    }
    
    // Calculate ideal maker price: 1.00 - expensiveAsk - targetMargin
    // (Orderbook sums to ~$1, so cheapSide ≈ 1 - expensiveSide)
    const idealMakerPrice = 1.00 - expensiveAsk - targetMargin;
    
    // But we need at least $0.05 for Polymarket minimum
    const POLYMARKET_MIN_PRICE = 0.05;
    
    // If ideal price is too low, calculate maximum achievable margin
    let actualMakerPrice: number;
    let actualMargin: number;
    
    if (idealMakerPrice >= POLYMARKET_MIN_PRICE) {
      // We can achieve our target margin
      actualMakerPrice = idealMakerPrice;
      actualMargin = targetMargin;
    } else {
      // Fall back to minimum price, accept reduced margin
      actualMakerPrice = POLYMARKET_MIN_PRICE;
      actualMargin = 1.00 - expensiveAsk - POLYMARKET_MIN_PRICE;
      console.log(`[PairTracker] ⚠️ Ideal price $${idealMakerPrice.toFixed(2)} < $${POLYMARKET_MIN_PRICE} min, falling back to $${actualMakerPrice.toFixed(2)} (${(actualMargin * 100).toFixed(1)}¢ margin)`);
    }
    
    // V36.8: CPP-LEIDEND - Check projected CPP, NOT current combined best ask!
    // We place limit orders on maker side, so we don't care if current combined ask > $1.00.
    // What matters is: takerPrice + makerLimitPrice = projected CPP
    const projectedCpp = expensiveAsk + actualMakerPrice;
    
    // Only block if our projected CPP (with our limit order) exceeds target
    if (projectedCpp > this.config.targetCpp) {
      console.log(`[PairTracker] 🔴 BLOCKED: Projected CPP $${projectedCpp.toFixed(3)} > target $${this.config.targetCpp.toFixed(2)}`);
      logPairEvent({
        pairId: `blocked_${Date.now()}`,
        eventType: 'pair_blocked',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: expensiveSide,
        takerPrice: expensiveAsk,
        takerSize: size,
        makerSide: cheapSide,
        makerPrice: actualMakerPrice,
        makerSize: size,
        status: 'cpp_above_target',
      });
      return { success: false, error: 'cpp_above_target' };
    }
    
    // Log the margin as info (not a blocker)
    if (actualMargin < 0.03) {
      console.log(`[PairTracker] ⚠️ Low margin: ${(actualMargin * 100).toFixed(1)}¢ (INFO - not blocking, CPP $${projectedCpp.toFixed(3)} OK)`);
    }
    
    console.log(`[PairTracker] 📊 DYNAMIC MARGIN: delta=${delta.toFixed(0)} (${confidenceLevel}) → target=${(targetMargin * 100).toFixed(0)}¢, actual=${(actualMargin * 100).toFixed(1)}¢`);
    console.log(`[PairTracker]    Taker: ${expensiveSide} @ $${expensiveAsk.toFixed(3)} | Maker: ${cheapSide} @ $${actualMakerPrice.toFixed(3)}`);
    
    // Use actualMakerPrice instead of the old projectedMakerPrice
    const projectedMakerPrice = actualMakerPrice;
    
    // Maker must be at least $0.05 (Polymarket minimum)
    if (projectedMakerPrice < 0.05) {
      console.log(`[PairTracker] 🔴 BLOCKED: Maker price $${projectedMakerPrice.toFixed(3)} < $0.05 min`);
      logPairEvent({
        pairId: `blocked_${Date.now()}`,
        eventType: 'pair_blocked',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: expensiveSide,
        takerPrice: expensiveAsk,
        takerSize: size,
        makerSide: cheapSide,
        makerPrice: projectedMakerPrice,
        makerSize: size,
        status: 'maker_price_below_minimum',
      });
      return { success: false, error: 'maker_price_below_minimum' };
    }
    
    // V36.4.1: Removed "maker viability check" - we place a LIMIT order
    // on the cheap side, so we don't care about the current ask price.
    // We provide liquidity, we don't take it!
    console.log(`[PairTracker] ✓ Maker will be placed at $${projectedMakerPrice.toFixed(3)} (limit order)`)
    
    // Create pair ID
    const pairId = `pair_${Date.now()}_${++this.pairCounter}`;
    
    // Get token ID for taker
    const takerTokenId = expensiveSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 🟠 ${pairId} OPENED`);
    console.log(`[PairTracker]    TAKER: ${size} ${expensiveSide} @ ~$${expensiveAsk.toFixed(2)} (pending)`);
    console.log(`[PairTracker]    MAKER: ${size} ${cheapSide} @ ~$${projectedMakerPrice.toFixed(2)} (target)`);
    console.log(`[PairTracker]    TARGET CPP: $${this.config.targetCpp.toFixed(2)}`);
    console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
    if (config.dryRun) {
      console.log(`[PairTracker] [DRY RUN] Would open pair`);
      return { success: false, error: 'dry_run' };
    }
    
    // Create pair FIRST (before placing order for WebSocket race handling)
    const pair: PendingPair = {
      id: pairId,
      marketSlug: market.slug,
      asset: market.asset,
      conditionId: market.conditionId,
      
      takerSide: expensiveSide,
      takerPrice: expensiveAsk,
      takerSize: size,
      takerOrderId: undefined,
      
      makerSide: cheapSide,
      makerPrice: 0,
      makerSize: size,
      makerOrderId: undefined,
      
      status: 'PENDING_ENTRY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCpp: this.config.targetCpp,
      
      // V36.3.0: Track if maker was placed to prevent double placement
      makerPlaced: false,
    };
    
    this.pairs.set(pairId, pair);
    // V36.3.4: Cooldown now set at start of openPair(), not here
    
    // Place TAKER order (FOK - Fill or Kill)
    try {
      // V36.3.3: Cap taker price at $0.95 (was $0.99)
      const takerPrice = Math.min(MAX_TAKER_PRICE, expensiveAsk + 0.03);
      console.log(`[PairTracker] 🚀 Placing TAKER (FOK): ${size} ${expensiveSide} @ $${takerPrice.toFixed(3)}`);
      
      const takerResult = await placeOrder({
        tokenId: takerTokenId,
        side: 'BUY',
        price: takerPrice,
        size,
        orderType: 'FOK',
      });
      
      if (!takerResult.success || !takerResult.orderId) {
        console.log(`[PairTracker] ❌ Taker order failed: ${takerResult.error}`);
        this.pairs.delete(pairId);
        return { success: false, error: takerResult.error || 'taker_failed' };
      }
      
      // Register order ID for WebSocket tracking
      registerOurOrderId(takerResult.orderId);
      pair.takerOrderId = takerResult.orderId;
      pair.updatedAt = Date.now();
      
      console.log(`[PairTracker] ✓ Taker placed: ${takerResult.orderId.slice(0, 8)}... status=${takerResult.status}`);
      
      // =========================================================================
      // V36.3.0: IMMEDIATE MAKER PLACEMENT - THE ONLY PLACE MAKER IS PLACED
      // =========================================================================
      // If taker filled, place maker IMMEDIATELY. This is the ONLY code path
      // that places a maker order. onFill() will NEVER place a maker.
      // =========================================================================
      
      if (takerResult.status === 'filled' || takerResult.status === 'partial') {
        const filledSize = takerResult.filledSize || size;
        const filledPrice = takerResult.avgPrice || expensiveAsk;
        
        console.log(`[PairTracker] 🟠 ${pairId} TAKER FILLED: ${filledSize} @ $${filledPrice.toFixed(2)}`);
        
        // =========================================================================
        // V36.8.0 FIX: SAVE TAKER FILL DIRECTLY TO DATABASE
        // =========================================================================
        // The WebSocket may reject this fill due to race condition (orderId not yet
        // whitelisted when WS receives the fill). So we MUST save the fill here
        // directly from the HTTP response, bypassing the WebSocket entirely.
        // This is critical for accurate v35_fills logging!
        // =========================================================================
        const takerFill = {
          orderId: takerResult.orderId || `taker_${pairId}`,
          tokenId: takerTokenId,
          side: expensiveSide,
          price: filledPrice,
          size: filledSize,
          timestamp: new Date(),
          marketSlug: market.slug,
          asset: market.asset,
          fillType: 'TAKER' as const,
        };
        
        // Save taker fill to database (fire-and-forget with error logging)
        saveV35Fill(takerFill).then(success => {
          if (success) {
            console.log(`[PairTracker] ✅ V36.8.0: Saved TAKER fill to v35_fills: ${filledSize} ${expensiveSide} @ $${filledPrice.toFixed(2)}`);
          } else {
            console.warn(`[PairTracker] ⚠️ Failed to save TAKER fill to database`);
          }
        }).catch(err => {
          console.error(`[PairTracker] ❌ Error saving TAKER fill:`, err?.message || err);
        });
        
        // Log taker fill event (legacy event log)
        logPairEvent({
          pairId,
          eventType: 'pair_taker_filled',
          marketSlug: market.slug,
          asset: market.asset,
          takerSide: expensiveSide,
          takerPrice: filledPrice,
          takerSize: filledSize,
          makerSide: pair.makerSide,
          makerPrice: 0,
          makerSize: filledSize,
          fillPrice: filledPrice,
          fillSize: filledSize,
          status: 'PENDING_ENTRY',
        }).catch(() => {});
        
        // Update pair state - V36.5.2: Set WAITING_HEDGE immediately after taker fill
        // This allows getUnhedgedPairsForMakerSide() to find this pair for aggregation
        pair.takerFilledAt = Date.now();
        pair.takerFilledPrice = filledPrice;
        pair.takerFilledSize = filledSize;
        pair.status = 'WAITING_HEDGE';  // V36.5.2: Update status before maker placement
        pair.updatedAt = Date.now();
        
        // =========================================================================
        // V36.5.3: CHECK INVENTORY FIRST - PRE-HEDGING FROM SURPLUS
        // =========================================================================
        // If we have maker inventory from previous scaled orders, consume it
        // instead of placing a new maker order. This makes the pair instantly hedged!
        // =========================================================================
        const inventoryResult = this.consumeFromInventory(market.slug, pair.makerSide, filledSize);
        
        if (inventoryResult.consumed > 0) {
          console.log(`[PairTracker] 📦 V36.5.3: Pre-hedged ${inventoryResult.consumed}/${filledSize} from inventory!`);
          
          if (inventoryResult.remainingNeeded <= 0) {
            // Fully pre-hedged from inventory!
            pair.makerPlaced = true;
            pair.makerFilledAt = Date.now();
            pair.makerFilledPrice = inventoryResult.avgPrice;
            pair.makerFilledSize = inventoryResult.consumed;
            pair.makerPrice = inventoryResult.avgPrice;
            pair.makerSize = inventoryResult.consumed;
            pair.status = 'HEDGED';
            pair.updatedAt = Date.now();
            
            // Calculate CPP
            pair.actualCpp = filledPrice + inventoryResult.avgPrice;
            pair.pnl = (1.0 - pair.actualCpp) * inventoryResult.consumed;
            
            console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
            console.log(`[PairTracker] 🟢 ${pairId} PRE-HEDGED FROM INVENTORY!`);
            console.log(`[PairTracker]    TAKER: ${filledSize} ${pair.takerSide} @ $${filledPrice.toFixed(2)} (filled)`);
            console.log(`[PairTracker]    MAKER: ${inventoryResult.consumed} ${pair.makerSide} @ $${inventoryResult.avgPrice.toFixed(3)} (from inventory)`);
            console.log(`[PairTracker]    CPP: $${pair.actualCpp.toFixed(3)} | P&L: ${pair.pnl >= 0 ? '+' : ''}$${pair.pnl.toFixed(2)}`);
            console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
            
            // Log pre-hedge event
            logPairEvent({
              pairId,
              eventType: 'pair_prehedged_from_inventory',
              marketSlug: market.slug,
              asset: market.asset,
              takerSide: pair.takerSide,
              takerPrice: filledPrice,
              takerSize: filledSize,
              makerSide: pair.makerSide,
              makerPrice: inventoryResult.avgPrice,
              makerSize: inventoryResult.consumed,
              cpp: pair.actualCpp,
              pnl: pair.pnl,
              status: 'HEDGED',
            }).catch(() => {});
            
            return { success: true, pairId };
          } else {
            // Partially pre-hedged - still need some maker shares
            // For now, place maker for the remaining needed
            console.log(`[PairTracker] 📦 Partial pre-hedge: need ${inventoryResult.remainingNeeded} more via maker`);
            // Update the size we need from the maker
            pair.takerFilledSize = inventoryResult.remainingNeeded;
          }
        }
        
        // Calculate and place maker
        const makerPlaceResult = await this.placeMakerOrder(pair, market, filledPrice, inventoryResult.remainingNeeded > 0 ? inventoryResult.remainingNeeded : filledSize);
        
        if (makerPlaceResult.success) {
          return { success: true, pairId };
        } else {
          // Maker failed - pair is stuck with only taker filled
          console.log(`[PairTracker] ⚠️ CRITICAL: Taker filled but maker failed: ${makerPlaceResult.error}`);
          pair.status = 'CANCELLED';
          return { success: false, error: `taker_filled_but_maker_failed: ${makerPlaceResult.error}` };
        }
      }
      
      // Taker not filled yet - wait for WebSocket (unlikely with FOK)
      console.log(`[PairTracker] ⏳ Taker not immediately filled, status=${takerResult.status}`);
      
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'PAIR_OPENED',
        blockedSide: null,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide,
        reason: `Pair ${pairId}: ${size} shares TAKER placed (status=${takerResult.status}), awaiting fill`,
      }).catch(() => {});
      
      return { success: true, pairId };
      
    } catch (err: any) {
      console.error(`[PairTracker] Error opening pair:`, err?.message);
      this.pairs.delete(pairId);
      return { success: false, error: err?.message };
    }
  }
  
  /**
   * V36.3.1: Place maker order - PRIVATE METHOD
   * This is the ONLY place a maker order is created!
   * 
   * CRITICAL FIX: Set makerPlaced=true BEFORE the async call to prevent race conditions
   * 
   * V36.4.3 CRITICAL FIX: Early Whitelisting
   * We must register the orderId for WebSocket IMMEDIATELY after the API response,
   * BEFORE the slow getOrder() verification. Otherwise, if the maker fills instantly,
   * the WebSocket will reject it as a "foreign fill" because the ID isn't whitelisted yet.
   */
  private async placeMakerOrder(
    pair: PendingPair,
    market: V35Market,
    takerFilledPrice: number,
    takerFilledSize: number
  ): Promise<{ success: boolean; error?: string }> {
    
    // V36.3.1: CRITICAL - Check AND SET flag atomically BEFORE async work
    // This prevents race conditions where two calls both pass the check
    if (pair.makerPlaced) {
      console.log(`[PairTracker] ⚠️ Maker already placed for ${pair.id} - skipping duplicate!`);
      return { success: true }; // Already done, not an error
    }
    
    // V36.3.1: SET FLAG IMMEDIATELY before any async work!
    // If we fail later, we'll set it back to false
    pair.makerPlaced = true;
    console.log(`[PairTracker] 🔒 Locked makerPlaced=true for ${pair.id} (preventing race conditions)`);
    
    // Calculate maker price: targetCpp - takerFillPrice
    const makerPrice = this.config.targetCpp - takerFilledPrice;
    
    if (makerPrice < 0.05) {
      console.log(`[PairTracker] ⚠️ Maker price too low: $${makerPrice.toFixed(3)}`);
      pair.makerPlaced = false; // Release lock on failure
      return { success: false, error: 'maker_price_too_low' };
    }
    
    const clampedMakerPrice = Math.min(0.95, Math.max(0.05, makerPrice));
    const makerTokenId = pair.makerSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    // =========================================================================
    // V36.5.2: FIFO HEDGE AGGREGATION
    // =========================================================================
    // When maker size needs scaling for $1 minimum, check if we can hedge
    // multiple older takers with the same order (more capital efficient).
    //
    // Example:
    //   - Taker A: 10 UP @ $0.90 (waiting for hedge)
    //   - Taker B: 10 UP @ $0.91 (waiting for hedge) <- current
    //   - Maker price: $0.05 -> need ceil($1 / $0.05) = 20 shares minimum
    //   - Solution: One 20-share maker hedges BOTH takers!
    // =========================================================================
    const MIN_ORDER_VALUE = 1.00;
    const minSharesForMaker = Math.ceil(MIN_ORDER_VALUE / clampedMakerPrice);
    
    // Find other unhedged pairs that need the same maker side (FIFO order)
    const unhedgedPairs = this.getUnhedgedPairsForMakerSide(market.slug, pair.makerSide)
      .filter(p => p.id !== pair.id);  // Exclude current pair
    
    // Calculate total unhedged taker exposure we could cover
    let totalTakerSharesAvailable = takerFilledSize;
    const pairsToHedge: { pair: PendingPair; allocation: number }[] = [
      { pair, allocation: takerFilledSize }
    ];
    
    // V36.5.2: If we need to scale up, try to aggregate older pairs first
    if (minSharesForMaker > takerFilledSize && unhedgedPairs.length > 0) {
      console.log(`[PairTracker] 🔍 V36.5.2: Checking FIFO aggregation (need ${minSharesForMaker}, have ${takerFilledSize})`);
      
      // Add older unhedged pairs until we reach minSharesForMaker or run out
      for (const olderPair of unhedgedPairs) {
        if (totalTakerSharesAvailable >= minSharesForMaker) break;
        
        const olderTakerSize = olderPair.takerFilledSize || olderPair.takerSize;
        
        // Lock this pair too (prevent race conditions)
        if (olderPair.makerPlaced) continue;
        olderPair.makerPlaced = true;
        
        totalTakerSharesAvailable += olderTakerSize;
        pairsToHedge.push({ pair: olderPair, allocation: olderTakerSize });
        
        console.log(`[PairTracker]    + Added ${olderPair.id}: ${olderTakerSize} shares (total: ${totalTakerSharesAvailable})`);
      }
    }
    
    // Final maker size: max of (total taker shares, minimum required)
    const makerSize = Math.max(totalTakerSharesAvailable, minSharesForMaker);
    
    const isAggregated = pairsToHedge.length > 1;
    const wasScaledUp = makerSize > totalTakerSharesAvailable;
    
    if (isAggregated) {
      console.log(`[PairTracker] 🔗 V36.5.2: FIFO Aggregation - hedging ${pairsToHedge.length} pairs with 1 maker order`);
      pairsToHedge.forEach((p, i) => {
        console.log(`[PairTracker]    [${i + 1}] ${p.pair.id}: ${p.allocation} ${p.pair.takerSide} shares`);
      });
    }
    
    if (wasScaledUp) {
      console.log(`[PairTracker] 📈 V36.5.2: Maker scaled: ${totalTakerSharesAvailable} → ${makerSize} (min $1 @ $${clampedMakerPrice.toFixed(3)})`);
    }
    
    console.log(`[PairTracker] 📝 Placing MAKER: ${makerSize} ${pair.makerSide} @ $${clampedMakerPrice.toFixed(3)}`);
    console.log(`[PairTracker]    Calculation: $${this.config.targetCpp.toFixed(2)} - $${takerFilledPrice.toFixed(3)} = $${makerPrice.toFixed(3)}`);
    
    try {
      const makerResult = await placeOrder({
        tokenId: makerTokenId,
        side: 'BUY',
        price: clampedMakerPrice,
        size: makerSize,
        orderType: 'GTC',
      });
      
      if (!makerResult.success || !makerResult.orderId) {
        console.log(`[PairTracker] ❌ Maker order failed: ${makerResult.error}`);
        // Release locks on all pairs
        pairsToHedge.forEach(p => { p.pair.makerPlaced = false; });
        return { success: false, error: makerResult.error || 'maker_failed' };
      }
      
      // =========================================================================
      // V36.4.3 CRITICAL: EARLY WHITELISTING - BEFORE ANY VERIFICATION!
      // =========================================================================
      registerOurOrderId(makerResult.orderId);
      console.log(`[PairTracker] 🔑 V36.4.3: Early-whitelisted orderId ${makerResult.orderId.slice(0, 12)}...`);
      
      // =========================================================================
      // V36.5.2: Link all pairs to this maker order
      // =========================================================================
      const linkedPairIds = pairsToHedge.map(p => p.pair.id);
      
      for (const { pair: p, allocation } of pairsToHedge) {
        p.makerOrderId = makerResult.orderId;
        p.makerPrice = clampedMakerPrice;
        p.makerSize = makerSize;  // Total maker order size
        p.makerAllocatedSize = allocation;  // This pair's share of the fill
        p.linkedPairIds = linkedPairIds;
        p.isPrimaryMakerPair = (p.id === pair.id);  // Primary pair "owns" the order
        p.status = 'WAITING_HEDGE';
        p.updatedAt = Date.now();
      }
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      if (isAggregated) {
        console.log(`[PairTracker] 🟠 AGGREGATED MAKER PLACED (${pairsToHedge.length} pairs)`);
        console.log(`[PairTracker]    MAKER: ${makerSize} ${pair.makerSide} @ $${clampedMakerPrice.toFixed(2)} [FIFO AGGREGATED]`);
        for (const { pair: p, allocation } of pairsToHedge) {
          console.log(`[PairTracker]    └─ ${p.id}: ${allocation} shares`);
        }
      } else {
        console.log(`[PairTracker] 🟠 ${pair.id} MAKER PLACED`);
        console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${takerFilledPrice.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    MAKER: ${makerSize} ${pair.makerSide} @ $${clampedMakerPrice.toFixed(2)} (open)${wasScaledUp ? ' [SCALED]' : ''}`);
      }
      console.log(`[PairTracker]    PROJECTED CPP: $${(takerFilledPrice + clampedMakerPrice).toFixed(3)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      // Log pair event to database
      logPairEvent({
        pairId: pair.id,
        eventType: isAggregated ? 'pair_maker_aggregated' : 'pair_maker_placed',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: pair.takerSide,
        takerPrice: takerFilledPrice,
        takerSize: takerFilledSize,
        makerSide: pair.makerSide,
        makerPrice: clampedMakerPrice,
        makerSize: makerSize,
        makerSizeScaled: wasScaledUp,
        linkedPairCount: pairsToHedge.length,  // V36.5.2: Track aggregation
        linkedPairIds: isAggregated ? linkedPairIds : undefined,
        status: 'WAITING_HEDGE',
      }).catch(() => {});
      
      return { success: true };
      
    } catch (err: any) {
      console.error(`[PairTracker] Error placing maker:`, err?.message);
      pair.makerPlaced = false; // Release lock on failure
      return { success: false, error: err?.message };
    }
  }
  
  /**
   * Handle a fill event - update pair status
   * 
   * V36.3.0 CRITICAL: This method ONLY TRACKS fills, it does NOT place orders!
   * All maker orders are placed in openPair() -> placeMakerOrder()
   */
  async onFill(fill: V35Fill, market: V35Market): Promise<{
    pairUpdated: boolean;
    pair?: PendingPair;
  }> {
    console.log(`[PairTracker] 🔍 onFill: ${fill.side} ${fill.size.toFixed(0)} @ $${fill.price.toFixed(2)} | orderId: ${fill.orderId?.slice(0, 12)}...`);
    console.log(`[PairTracker]    Total pairs: ${this.pairs.size}`);
    
    // Find matching pair
    for (const pair of this.pairs.values()) {
      if (pair.marketSlug !== market.slug) continue;
      
      console.log(`[PairTracker]    Checking ${pair.id}: status=${pair.status} makerPlaced=${pair.makerPlaced}`);
      
      // =========================================================================
      // TAKER FILL TRACKING (for pairs where taker wasn't immediately filled)
      // =========================================================================
      // V36.3.0: If taker fills via WebSocket AND maker wasn't placed yet,
      // place the maker now. This handles the edge case where FOK doesn't
      // report as filled immediately.
      // =========================================================================
      // V36.4.2: FIX - fill.side is 'BUY'/'SELL', pair.takerSide is 'UP'/'DOWN'
      // We always BUY for taker fills, so check the order ID match instead!
      const isTakerMatch = 
        pair.status === 'PENDING_ENTRY' &&
        !pair.takerFilledAt &&
        pair.takerOrderId === fill.orderId;
      
      if (isTakerMatch) {
        console.log(`[PairTracker] 🎯 WebSocket taker fill detected for ${pair.id}`);
        
        // Update taker fill info
        if (fill.orderId) pair.takerOrderId = fill.orderId;
        pair.takerFilledAt = Date.now();
        pair.takerFilledPrice = fill.price;
        pair.takerFilledSize = fill.size;
        pair.status = 'WAITING_HEDGE';  // V36.5.2: Set immediately for aggregation lookup
        pair.updatedAt = Date.now();
        
        // V36.3.0: Place maker if not already placed
        if (!pair.makerPlaced) {
          console.log(`[PairTracker] 📝 Placing maker via WebSocket fill path`);
          const makerResult = await this.placeMakerOrder(pair, market, fill.price, fill.size);
          
          if (!makerResult.success) {
            console.log(`[PairTracker] ⚠️ Maker placement failed via WebSocket: ${makerResult.error}`);
            pair.status = 'CANCELLED';
          }
        } else {
          console.log(`[PairTracker] ✓ Maker already placed - just updating taker info`);
        }
        
        return { pairUpdated: true, pair };
      }
      
      // =========================================================================
      // MAKER FILL TRACKING
      // V36.5.2: Handle FIFO allocation when multiple pairs share one maker order
      // =========================================================================
      if (pair.makerOrderId === fill.orderId && pair.status === 'WAITING_HEDGE') {
        
        // V36.5.2: Check if this is an aggregated maker (linked to multiple pairs)
        const linkedIds = pair.linkedPairIds || [pair.id];
        const isAggregated = linkedIds.length > 1;
        
        if (isAggregated) {
          // FIFO allocation across all linked pairs
          console.log(`[PairTracker] 🔗 V36.5.2: Aggregated maker fill - allocating to ${linkedIds.length} pairs`);
          
          let remainingFillSize = fill.size;
          
          // Process pairs in FIFO order (sorted by createdAt)
          const linkedPairs = linkedIds
            .map(id => this.pairs.get(id))
            .filter((p): p is PendingPair => p !== undefined && p.status === 'WAITING_HEDGE')
            .sort((a, b) => a.createdAt - b.createdAt);
          
          for (const linkedPair of linkedPairs) {
            if (remainingFillSize <= 0) break;
            
            const allocationNeeded = linkedPair.makerAllocatedSize || linkedPair.takerFilledSize || linkedPair.takerSize;
            const allocated = Math.min(remainingFillSize, allocationNeeded);
            remainingFillSize -= allocated;
            
            // Update this linked pair
            linkedPair.makerFilledAt = Date.now();
            linkedPair.makerFilledPrice = fill.price;
            linkedPair.makerFilledSize = allocated;
            linkedPair.status = 'HEDGED';
            linkedPair.updatedAt = Date.now();
            
            // Calculate actual CPP for this pair
            const takerCost = linkedPair.takerFilledPrice || linkedPair.takerPrice;
            linkedPair.actualCpp = takerCost + fill.price;
            linkedPair.pnl = (1.0 - linkedPair.actualCpp) * allocated;
            
            console.log(`[PairTracker]    ✓ ${linkedPair.id}: ${allocated} shares allocated | CPP: $${linkedPair.actualCpp.toFixed(3)} | P&L: $${linkedPair.pnl.toFixed(2)}`);
            
            // Log per-pair hedge event
            logPairEvent({
              pairId: linkedPair.id,
              eventType: 'pair_hedged_fifo',
              marketSlug: market.slug,
              asset: market.asset,
              takerSide: linkedPair.takerSide,
              takerPrice: linkedPair.takerFilledPrice || linkedPair.takerPrice,
              takerSize: linkedPair.takerFilledSize || linkedPair.takerSize,
              makerSide: linkedPair.makerSide,
              makerPrice: fill.price,
              makerSize: allocated,
              fillPrice: fill.price,
              fillSize: allocated,
              cpp: linkedPair.actualCpp,
              pnl: linkedPair.pnl,
              status: 'HEDGED',
              aggregatedFrom: linkedIds.length,
            }).catch(() => {});
          }
          
          // V36.5.3: Check for surplus shares to add to inventory
          if (remainingFillSize > 0) {
            console.log(`[PairTracker] 📦 V36.5.3: ${remainingFillSize} surplus shares from aggregated fill`);
            this.addToInventory(market.slug, pair.makerSide, remainingFillSize, fill.price);
          }
          
          console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
          console.log(`[PairTracker] 🟢 AGGREGATED MAKER FILLED - ${linkedPairs.length} pairs hedged!`);
          console.log(`[PairTracker]    Total fill: ${fill.size} ${pair.makerSide} @ $${fill.price.toFixed(2)}`);
          if (remainingFillSize > 0) {
            console.log(`[PairTracker]    📦 Surplus: ${remainingFillSize} → inventory`);
          }
          console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
          
          return { pairUpdated: true, pair };
        }
        
        // Standard single-pair flow (no aggregation)
        pair.makerFilledAt = Date.now();
        pair.makerFilledPrice = fill.price;
        pair.makerFilledSize = fill.size;
        pair.status = 'HEDGED';
        pair.updatedAt = Date.now();
        
        // Calculate actual CPP
        const takerCost = pair.takerFilledPrice || pair.takerPrice;
        pair.actualCpp = takerCost + fill.price;
        
        // V36.5.3: Check for surplus (maker scaled up beyond taker size)
        const takerSize = pair.takerFilledSize || pair.takerSize;
        const surplusShares = fill.size - takerSize;
        
        // P&L is based on the matched shares only
        pair.pnl = (1.0 - pair.actualCpp) * Math.min(takerSize, fill.size);
        
        console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
        console.log(`[PairTracker] 🟢 ${pair.id} HEDGED - COMPLETE!`);
        console.log(`[PairTracker]    TAKER: ${takerSize} ${pair.takerSide} @ $${takerCost.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    MAKER: ${fill.size} ${pair.makerSide} @ $${fill.price.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    CPP: $${pair.actualCpp.toFixed(3)} | P&L: ${pair.pnl >= 0 ? '+' : ''}$${pair.pnl.toFixed(2)}`);
        
        // V36.5.3: Add surplus to inventory for future pre-hedging
        if (surplusShares > 0) {
          console.log(`[PairTracker]    📦 Surplus: ${surplusShares} ${pair.makerSide} → inventory`);
          this.addToInventory(market.slug, pair.makerSide, surplusShares, fill.price);
        }
        console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
        
        // Log maker fill event
        logPairEvent({
          pairId: pair.id,
          eventType: 'pair_hedged',
          marketSlug: market.slug,
          asset: market.asset,
          takerSide: pair.takerSide,
          takerPrice: pair.takerFilledPrice || pair.takerPrice,
          takerSize: pair.takerFilledSize || pair.takerSize,
          makerSide: pair.makerSide,
          makerPrice: fill.price,
          makerSize: fill.size,
          fillPrice: fill.price,
          fillSize: fill.size,
          cpp: pair.actualCpp,
          pnl: pair.pnl,
          status: 'HEDGED',
        }).catch(() => {});
        
        return { pairUpdated: true, pair };
      }
      
      // =========================================================================
      // EMERGENCY FILL TRACKING
      // =========================================================================
      if (pair.emergencyOrderId === fill.orderId) {
        pair.emergencyFilledAt = Date.now();
        pair.emergencyFilledPrice = fill.price;
        pair.emergencyFilledSize = fill.size;
        pair.status = 'EMERGENCY_HEDGED';
        pair.updatedAt = Date.now();
        
        const takerCost = pair.takerFilledPrice || pair.takerPrice;
        pair.actualCpp = takerCost + fill.price;
        pair.pnl = (1.0 - pair.actualCpp) * Math.min(pair.takerFilledSize || 0, fill.size);
        
        console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
        console.log(`[PairTracker] 🔴 ${pair.id} EMERGENCY HEDGED`);
        console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${takerCost.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    EMERGENCY: ${fill.size} ${pair.makerSide} @ $${fill.price.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    CPP: $${pair.actualCpp.toFixed(3)} | P&L: ${pair.pnl >= 0 ? '+' : ''}$${pair.pnl.toFixed(2)}`);
        console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
        
        // Log emergency hedge event
        logPairEvent({
          pairId: pair.id,
          eventType: 'pair_emergency',
          marketSlug: market.slug,
          asset: market.asset,
          takerSide: pair.takerSide,
          takerPrice: pair.takerFilledPrice || pair.takerPrice,
          takerSize: pair.takerFilledSize || pair.takerSize,
          makerSide: pair.makerSide,
          makerPrice: fill.price,
          makerSize: fill.size,
          fillPrice: fill.price,
          fillSize: fill.size,
          cpp: pair.actualCpp,
          pnl: pair.pnl,
          status: 'EMERGENCY_HEDGED',
        }).catch(() => {});
        
        return { pairUpdated: true, pair };
      }
    }
    
    console.log(`[PairTracker] ⚠️ No matching pair found for fill`);
    return { pairUpdated: false };
  }
  
  /**
   * Trigger emergency hedge for a pair (Binance reversal detected)
   */
  async triggerEmergencyHedge(
    pair: PendingPair,
    market: V35Market,
    currentAsk: number
  ): Promise<{ success: boolean; error?: string }> {
    if (pair.status !== 'WAITING_HEDGE') {
      return { success: false, error: 'wrong_status' };
    }
    
    const config = getV35Config();
    const takerCost = pair.takerFilledPrice || pair.takerPrice;
    const projectedCpp = takerCost + currentAsk;
    
    if (projectedCpp > this.config.emergencyMaxCpp) {
      console.log(`[PairTracker] ⚠️ Emergency CPP too high: $${projectedCpp.toFixed(3)} > $${this.config.emergencyMaxCpp.toFixed(2)}`);
      return { success: false, error: `emergency_cpp_too_high: ${projectedCpp.toFixed(3)}` };
    }
    
    // Cancel the maker limit order first
    if (pair.makerOrderId) {
      try {
        await cancelOrder(pair.makerOrderId);
        console.log(`[PairTracker] 🗑️ Cancelled maker order: ${pair.makerOrderId.slice(0, 8)}...`);
      } catch (err) {
        console.warn(`[PairTracker] Failed to cancel maker:`, err);
      }
    }
    
    // Place emergency order
    const tokenId = pair.makerSide === 'UP' ? market.upTokenId : market.downTokenId;
    const emergencyPrice = currentAsk + this.config.emergencyTakerOffset;
    const size = pair.takerFilledSize || pair.takerSize;
    
    console.log(`[PairTracker] 🛑 EMERGENCY HEDGE: ${pair.id}`);
    console.log(`[PairTracker]    ${size} ${pair.makerSide} @ $${emergencyPrice.toFixed(3)}`);
    console.log(`[PairTracker]    Projected CPP: $${projectedCpp.toFixed(3)}`);
    
    if (config.dryRun) {
      return { success: false, error: 'dry_run' };
    }
    
    try {
      const result = await placeOrder({
        tokenId,
        side: 'BUY',
        price: emergencyPrice,
        size,
        orderType: 'GTC',
      });
      
      if (!result.success || !result.orderId) {
        console.log(`[PairTracker] ❌ Emergency hedge failed: ${result.error}`);
        return { success: false, error: result.error || 'emergency_failed' };
      }
      
      registerOurOrderId(result.orderId);
      pair.emergencyOrderId = result.orderId;
      pair.updatedAt = Date.now();
      
      console.log(`[PairTracker] ✓ Emergency order placed: ${result.orderId.slice(0, 8)}...`);
      
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'EMERGENCY_HEDGE',
        blockedSide: pair.makerSide,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide: pair.takerSide,
        reason: `Pair ${pair.id}: Emergency @ $${emergencyPrice.toFixed(3)}, CPP $${projectedCpp.toFixed(3)}`,
      }).catch(() => {});
      
      return { success: true };
      
    } catch (err: any) {
      console.error(`[PairTracker] Error placing emergency hedge:`, err?.message);
      return { success: false, error: err?.message };
    }
  }
  
  /**
   * Check for stale pairs that need cleanup
   */
  async checkTimeouts(_market: V35Market): Promise<void> {
    const now = Date.now();
    const PENDING_ENTRY_TIMEOUT_MS = 60_000;
    
    for (const pair of this.pairs.values()) {
      if (pair.status === 'PENDING_ENTRY') {
        const age = now - pair.createdAt;
        
        if (age > PENDING_ENTRY_TIMEOUT_MS) {
          console.log(`[PairTracker] 🗑️ Cleaning stale PENDING_ENTRY: ${pair.id} (age: ${Math.round(age / 1000)}s)`);
          
          if (pair.takerOrderId) {
            try {
              await cancelOrder(pair.takerOrderId);
              console.log(`[PairTracker]    ✓ Cancelled stale taker order`);
            } catch (err) {
              console.log(`[PairTracker]    ⚠️ Could not cancel (already expired?)`);
            }
          }
          
          pair.status = 'CANCELLED';
          pair.updatedAt = now;
        }
      }
    }
  }
  
  // =========================================================================
  // V36.10: DYNAMIC CPP ESCALATION
  // =========================================================================
  // As time passes, we RAISE the maker order price to guarantee hedging.
  // This trades some profit for certainty - a $0.02 profit is better than
  // a $0.30+ loss from an unhedged reversal.
  // =========================================================================
  
  /**
   * Get the current escalated CPP target for a pair based on how long it's been waiting
   */
  private getEscalatedCpp(pair: PendingPair): number {
    if (!pair.takerFilledAt) return this.config.targetCpp;
    
    const waitingMs = Date.now() - pair.takerFilledAt;
    
    // Find the highest CPP threshold we've passed
    let escalatedCpp = this.config.targetCpp;
    for (const step of CPP_ESCALATION_SCHEDULE) {
      if (waitingMs >= step.afterMs) {
        escalatedCpp = step.maxCpp;
      } else {
        break;
      }
    }
    
    return escalatedCpp;
  }
  
  /**
   * V36.10: Check and replace maker orders with higher prices as time passes
   * 
   * This is the core of the CPP escalation strategy:
   * 1. Check each WAITING_HEDGE pair's age
   * 2. Calculate what CPP level we should be at
   * 3. If our current maker price is too low, cancel and replace with higher price
   */
  async checkCppEscalation(market: V35Market): Promise<{ 
    checked: number; 
    escalated: number; 
    errors: string[] 
  }> {
    const config = getV35Config();
    const errors: string[] = [];
    let checked = 0;
    let escalated = 0;
    
    for (const pair of this.pairs.values()) {
      // Only check WAITING_HEDGE pairs with a maker order for this market
      if (pair.status !== 'WAITING_HEDGE') continue;
      if (pair.marketSlug !== market.slug) continue;
      if (!pair.makerOrderId) continue;
      if (!pair.takerFilledAt) continue;
      
      checked++;
      
      const takerCost = pair.takerFilledPrice || pair.takerPrice;
      const currentMakerPrice = pair.makerPrice;
      const currentCpp = takerCost + currentMakerPrice;
      
      // What CPP should we be at now?
      const escalatedCpp = this.getEscalatedCpp(pair);
      const newMakerPrice = escalatedCpp - takerCost;
      
      // Skip if we don't need to escalate yet
      // (current CPP is already at or above escalated level)
      if (currentCpp >= escalatedCpp - 0.005) continue;  // 0.5ct tolerance
      
      // Skip if new maker price would be unreasonable
      if (newMakerPrice < 0.05 || newMakerPrice > 0.95) continue;
      
      const waitingMs = Date.now() - pair.takerFilledAt;
      const waitingSec = Math.round(waitingMs / 1000);
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] 📈 V36.10: CPP ESCALATION - ${pair.id}`);
      console.log(`[PairTracker]    Waiting: ${waitingSec}s`);
      console.log(`[PairTracker]    Current: MAKER @ $${currentMakerPrice.toFixed(3)} → CPP $${currentCpp.toFixed(3)}`);
      console.log(`[PairTracker]    Target:  MAKER @ $${newMakerPrice.toFixed(3)} → CPP $${escalatedCpp.toFixed(3)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      if (config.dryRun) {
        console.log(`[PairTracker] 🚫 DRY RUN: Would escalate maker price`);
        continue;
      }
      
      // Cancel the existing maker order
      try {
        await cancelOrder(pair.makerOrderId);
        console.log(`[PairTracker] 🗑️ Cancelled old maker: ${pair.makerOrderId.slice(0, 12)}...`);
      } catch (err: any) {
        console.warn(`[PairTracker] ⚠️ Cancel failed (may already be filled):`, err?.message);
        // Continue anyway - the order might have filled
        continue;
      }
      
      // Place new maker order at higher price
      const makerTokenId = pair.makerSide === 'UP' ? market.upTokenId : market.downTokenId;
      const makerSize = pair.makerSize || pair.takerFilledSize || pair.takerSize;
      
      try {
        const result = await placeOrder({
          tokenId: makerTokenId,
          side: 'BUY',
          price: newMakerPrice,
          size: makerSize,
          orderType: 'GTC',
        });
        
        if (!result.success || !result.orderId) {
          const errorMsg = `Escalation failed for ${pair.id}: ${result.error}`;
          errors.push(errorMsg);
          console.log(`[PairTracker] ❌ ${errorMsg}`);
          // Mark as needing attention
          pair.makerPlaced = false;
          continue;
        }
        
        // Update pair with new order
        registerOurOrderId(result.orderId);
        pair.makerOrderId = result.orderId;
        pair.makerPrice = newMakerPrice;
        pair.updatedAt = Date.now();
        
        escalated++;
        console.log(`[PairTracker] ✅ Escalated maker: ${result.orderId.slice(0, 12)}... @ $${newMakerPrice.toFixed(3)}`);
        
        // Log the escalation event
        logPairEvent({
          pairId: pair.id,
          eventType: 'pair_cpp_escalated',
          marketSlug: market.slug,
          asset: market.asset,
          takerSide: pair.takerSide,
          takerPrice: takerCost,
          takerSize: pair.takerFilledSize || pair.takerSize,
          makerSide: pair.makerSide,
          makerPrice: newMakerPrice,
          makerSize: makerSize,
          cpp: escalatedCpp,
          waitingSeconds: waitingSec,
          previousCpp: currentCpp,
          previousMakerPrice: currentMakerPrice,
          status: 'WAITING_HEDGE',
        }).catch(() => {});
        
      } catch (err: any) {
        const errorMsg = `Escalation order failed for ${pair.id}: ${err?.message}`;
        errors.push(errorMsg);
        console.error(`[PairTracker] ❌ ${errorMsg}`);
      }
    }
    
    return { checked, escalated, errors };
  }
  
  // =========================================================================
  // V36.4.3: FILL AUDIT FALLBACK
  // =========================================================================
  // This method polls the API for fills on WAITING_HEDGE pairs.
  // If a maker fill was missed by WebSocket, we detect and persist it here.
  // =========================================================================
  
  async auditMakerFills(market: V35Market): Promise<{ audited: number; found: number }> {
    const now = Date.now();
    const AUDIT_DELAY_MS = 5_000; // Wait 5s before auditing (give WS time first)
    
    let audited = 0;
    let found = 0;
    
    for (const pair of this.pairs.values()) {
      // Only audit WAITING_HEDGE pairs with a maker order
      if (pair.status !== 'WAITING_HEDGE') continue;
      if (pair.marketSlug !== market.slug) continue;
      if (!pair.makerOrderId) continue;
      
      // Wait at least AUDIT_DELAY_MS since maker was placed
      const timeSincePlaced = now - pair.updatedAt;
      if (timeSincePlaced < AUDIT_DELAY_MS) continue;
      
      audited++;
      
      try {
        const fillInfo = await getOrderFillInfo(pair.makerOrderId);
        
        if (!fillInfo.success) {
          console.log(`[PairTracker] 🔍 Audit ${pair.id}: API check failed: ${fillInfo.error}`);
          continue;
        }
        
        if (fillInfo.status === 'filled' || fillInfo.status === 'partial') {
          const filledSize = fillInfo.filledSize || 0;
          
          if (filledSize > 0) {
            found++;
            console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
            console.log(`[PairTracker] 🔔 V36.4.3 AUDIT FOUND MISSED FILL!`);
            console.log(`[PairTracker]    Pair: ${pair.id}`);
            console.log(`[PairTracker]    Order: ${pair.makerOrderId.slice(0, 12)}...`);
            console.log(`[PairTracker]    Size: ${filledSize} (original: ${fillInfo.originalSize})`);
            console.log(`[PairTracker]    Status: ${fillInfo.status}`);
            console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
            
            // Update pair status
            pair.makerFilledAt = now;
            pair.makerFilledPrice = pair.makerPrice;
            pair.makerFilledSize = filledSize;
            pair.status = 'HEDGED';
            pair.updatedAt = now;
            
            // Calculate CPP and PnL
            const takerCost = pair.takerFilledPrice || pair.takerPrice;
            pair.actualCpp = takerCost + pair.makerPrice;
            pair.pnl = (1.0 - pair.actualCpp) * Math.min(pair.takerFilledSize || 0, filledSize);
            
            // Persist fill to database (WebSocket missed it)
            const fill: V35Fill = {
              orderId: pair.makerOrderId,
              tokenId: pair.makerSide === 'UP' ? market.upTokenId : market.downTokenId,
              side: pair.makerSide,
              price: pair.makerPrice,
              size: filledSize,
              timestamp: new Date(),
              marketSlug: market.slug,
              asset: market.asset,
            };
            
            saveV35Fill(fill).catch((err) => {
              console.error(`[PairTracker] Failed to save audited fill:`, err);
            });
            
            // Log pair event
            logPairEvent({
              pairId: pair.id,
              eventType: 'pair_hedged',
              marketSlug: market.slug,
              asset: market.asset,
              takerSide: pair.takerSide,
              takerPrice: pair.takerFilledPrice || pair.takerPrice,
              takerSize: pair.takerFilledSize || pair.takerSize,
              makerSide: pair.makerSide,
              makerPrice: pair.makerPrice,
              makerSize: filledSize,
              fillPrice: pair.makerPrice,
              fillSize: filledSize,
              cpp: pair.actualCpp,
              pnl: pair.pnl,
              status: 'HEDGED_VIA_AUDIT',
            }).catch(() => {});
          }
        }
      } catch (err: any) {
        console.error(`[PairTracker] Audit error for ${pair.id}:`, err?.message);
      }
    }
    
    if (audited > 0) {
      console.log(`[PairTracker] 🔍 Audited ${audited} WAITING_HEDGE pairs, found ${found} missed fills`);
    }
    
    return { audited, found };
  }
  
  /**
   * Get summary statistics
   */
  getStats(): {
    totalPairs: number;
    activePairs: number;
    completedPairs: number;
    totalPnl: number;
    avgCpp: number;
  } {
    const all = Array.from(this.pairs.values());
    const completed = all.filter(p => p.status === 'HEDGED' || p.status === 'EMERGENCY_HEDGED');
    const active = all.filter(p => p.status === 'PENDING_ENTRY' || p.status === 'WAITING_HEDGE');
    
    const totalPnl = completed.reduce((sum, p) => sum + (p.pnl || 0), 0);
    const avgCpp = completed.length > 0
      ? completed.reduce((sum, p) => sum + (p.actualCpp || 0), 0) / completed.length
      : 0;
    
    return {
      totalPairs: all.length,
      activePairs: active.length,
      completedPairs: completed.length,
      totalPnl,
      avgCpp,
    };
  }
  
  /**
   * Clean up completed pairs older than 5 minutes
   */
  cleanup(): void {
    const cutoff = Date.now() - 5 * 60 * 1000;
    
    for (const [id, pair] of this.pairs.entries()) {
      if (
        (pair.status === 'HEDGED' || pair.status === 'EMERGENCY_HEDGED' || pair.status === 'CANCELLED') &&
        pair.updatedAt < cutoff
      ) {
        this.pairs.delete(id);
      }
    }
  }
  
  /**
   * Reset all pairs (for new market cycle)
   */
  reset(): void {
    this.pairs.clear();
    this.pairCounter = 0;
    this.marketStartTimes.clear();
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let pairTrackerInstance: PairTracker | null = null;

export function getPairTracker(): PairTracker {
  if (!pairTrackerInstance) {
    pairTrackerInstance = new PairTracker();
  }
  return pairTrackerInstance;
}

export function resetPairTracker(): void {
  if (pairTrackerInstance) {
    pairTrackerInstance.reset();
  }
  pairTrackerInstance = null;
}
