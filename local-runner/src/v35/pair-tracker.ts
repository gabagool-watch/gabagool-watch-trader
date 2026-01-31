// ============================================================
// V36 PAIR TRACKER - INDEPENDENT PAIR LIFECYCLE MANAGEMENT
// ============================================================
// Version: V36.3.6 - "Market Expiry Reset"
//
// V36.3.1 CRITICAL FIX:
// - Set makerPlaced=true BEFORE async placeOrder call
// - This prevents race conditions where REST + WebSocket both try to place
// - If order fails, we reset makerPlaced=false to allow retry
//
// V36.3.0 CRITICAL FIX:
// - MAKER ORDER IS PLACED ONLY ONCE - in openPair() after taker fill
// - onFill() now only tracks fills, does NOT place maker orders
// - This prevents the double-ordering bug that wiped the account
//
// CORE CONCEPT:
// Each trade is an INDEPENDENT "Pair" with its own lifecycle:
// 1. TAKER entry on expensive (winning) side - MARKET ORDER (FOK)
// 2. MAKER limit order on cheap (losing) side - placed IMMEDIATELY after taker
// 3. Settlement OR Emergency Hedge if reversal detected
// ============================================================

import type { V35Market, V35Side, V35Asset, V35Fill } from './types.js';
import { placeOrder, cancelOrder, getOpenOrders } from '../polymarket.js';
import { getBinanceFeed } from './binance-feed.js';
import { logV35GuardEvent, logPairEvent } from './backend.js';
import { getV35Config } from './config.js';
// CRITICAL: Register our order IDs so fills are recognized as ours!
import { registerOurOrderId } from './user-ws.js';

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
  targetCpp: number;                 // Target combined cost (e.g., 0.95)
  emergencyMaxCpp: number;           // Max combined cost for emergency hedge
  emergencyTakerOffset: number;      // Offset above ask for emergency (e.g., 0.005)
  minSharesPerPair: number;          // Minimum shares per pair
  maxSharesPerPair: number;          // Maximum shares per pair
  startupDelayMs: number;            // Wait after market open before first pair
  pairCooldownMs: number;            // V36.3.1: Cooldown between opening new pairs
}

const DEFAULT_CONFIG: PairTrackerConfig = {
  maxPendingPairs: 1,               // V36.4.0: 1 pair at a time - fully hedge before next
  targetCpp: 0.95,
  emergencyMaxCpp: 1.05,
  emergencyTakerOffset: 0.005,
  minSharesPerPair: 5,
  maxSharesPerPair: 20,
  startupDelayMs: 60_000,            // 1 MINUTE observation period
  pairCooldownMs: 20_000,            // V36.3.4: 20 seconds between new pairs
};

// ============================================================
// PAIR TRACKER CLASS
// ============================================================

export class PairTracker {
  private config: PairTrackerConfig;
  private pairs: Map<string, PendingPair> = new Map();
  private pairCounter = 0;
  private marketStartTimes: Map<string, number> = new Map();
  private lastPairOpenedAt: number = 0;  // V36.3.1: Track last pair open time
  
  constructor(config: Partial<PairTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
    
    // V36.3.8 CRITICAL: Block if too many WAITING_HEDGE pairs!
    // These are takers that filled but makers haven't → unhedged exposure!
    // Max 3 waiting pairs allowed - if more, we MUST wait for makers to fill
    const MAX_WAITING_HEDGE = 3;
    if (waiting >= MAX_WAITING_HEDGE) {
      console.log(`[PairTracker] 🚨 V36.3.8 BLOCK: ${waiting} pairs WAITING_HEDGE (max ${MAX_WAITING_HEDGE}) - too much unhedged exposure!`);
      console.log(`[PairTracker]    💡 Waiting for maker orders to fill before opening more pairs`);
      return false;
    }
    
    if (count >= this.config.maxPendingPairs) {
      console.log(`[PairTracker] 🛑 Max pairs reached: ${count}/${this.config.maxPendingPairs} (pending=${pending}, waiting=${waiting})`);
      return false;
    }
    
    console.log(`[PairTracker] ✅ Can open pair: ${count}/${this.config.maxPendingPairs} (pending=${pending}, waiting=${waiting})`);
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
    // MINIMUM ORDER VALUE CHECK ($1.00)
    // =========================================================================
    const MIN_ORDER_VALUE = 1.00;
    const MAX_ORDER_VALUE = 1.05;
    
    const takerOrderValue = size * expensiveAsk;
    const makerOrderValue = size * cheapAsk;
    
    if (takerOrderValue < MIN_ORDER_VALUE || makerOrderValue < MIN_ORDER_VALUE) {
      const minSharesForTaker = Math.ceil(MIN_ORDER_VALUE / expensiveAsk);
      const minSharesForMaker = Math.ceil(MIN_ORDER_VALUE / cheapAsk);
      const requiredSize = Math.max(minSharesForTaker, minSharesForMaker);
      
      if (requiredSize > this.config.maxSharesPerPair) {
        console.log(`[PairTracker] ⚠️ Cannot meet $1 minimum: need ${requiredSize} shares but max is ${this.config.maxSharesPerPair}`);
        size = this.config.maxSharesPerPair;
      } else {
        console.log(`[PairTracker] 📈 Adjusting size for $1 minimum: ${size} → ${requiredSize} shares`);
        size = requiredSize;
      }
    }
    
    const adjustedMakerValue = size * cheapAsk;
    if (adjustedMakerValue > MAX_ORDER_VALUE && cheapAsk < 0.10) {
      const cappedSize = Math.floor(MAX_ORDER_VALUE / cheapAsk);
      if (cappedSize >= Math.ceil(MIN_ORDER_VALUE / expensiveAsk)) {
        console.log(`[PairTracker] 📉 Capping size to limit cheap side exposure: ${size} → ${cappedSize} shares`);
        size = cappedSize;
      }
    }
    
    // V36.3.3: Block taker orders above $0.95 - no profit margin possible
    const MAX_TAKER_PRICE = 0.95;
    if (expensiveAsk > MAX_TAKER_PRICE) {
      console.log(`[PairTracker] 🚫 Expensive side @ $${expensiveAsk.toFixed(3)} > $${MAX_TAKER_PRICE.toFixed(2)} cap - no edge`);
      return { success: false, error: 'expensive_side_above_cap' };
    }
    
    // =========================================================================
    // V36.3.8 CRITICAL: PRE-CHECK MAKER VIABILITY!
    // =========================================================================
    // Before placing taker, verify that the maker price is ACHIEVABLE.
    // If makerPrice < cheapAsk (market ask for cheap side), the maker will
    // NEVER fill because we'd be bidding below the market.
    // 
    // This was the ROOT CAUSE of losses: takers filled @ $0.87, but
    // maker @ $0.08 couldn't fill when cheap ask was $0.27!
    // =========================================================================
    const projectedMakerPrice = this.config.targetCpp - expensiveAsk;
    
    // Maker must be at least $0.05 (Polymarket minimum)
    if (projectedMakerPrice < 0.05) {
      console.log(`[PairTracker] 🚫 V36.3.8 Maker price too low: $${projectedMakerPrice.toFixed(3)} < $0.05 minimum`);
      return { success: false, error: 'maker_price_below_minimum' };
    }
    
    // V36.3.8: Check if maker can realistically fill
    // If cheapAsk is significantly above our maker bid, it won't fill
    const MAKER_FILL_BUFFER = 0.03; // Allow 3¢ buffer for spread movement
    if (cheapAsk > projectedMakerPrice + MAKER_FILL_BUFFER) {
      console.log(`[PairTracker] 🚫 V36.3.8 Maker UNLIKELY to fill!`);
      console.log(`[PairTracker]    Maker bid: $${projectedMakerPrice.toFixed(3)} | Cheap ask: $${cheapAsk.toFixed(3)}`);
      console.log(`[PairTracker]    Gap: ${((cheapAsk - projectedMakerPrice) * 100).toFixed(1)}¢ > ${(MAKER_FILL_BUFFER * 100).toFixed(0)}¢ buffer`);
      console.log(`[PairTracker]    💡 Waiting for better conditions (lower cheap ask or higher expensive ask)`);
      return { success: false, error: 'maker_unlikely_to_fill' };
    }
    
    console.log(`[PairTracker] ✓ V36.3.8 Maker viable: bid $${projectedMakerPrice.toFixed(3)} vs ask $${cheapAsk.toFixed(3)}`)
    
    // Create pair ID
    const pairId = `pair_${Date.now()}_${++this.pairCounter}`;
    
    // Get token ID for taker
    const takerTokenId = expensiveSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 🎯 PAIR ${pairId} OPENED`);
    console.log(`[PairTracker]    TAKER: ${size} ${expensiveSide} @ ~$${expensiveAsk.toFixed(2)}¢`);
    console.log(`[PairTracker]    MAKER: ${size} ${cheapSide} @ ~$${projectedMakerPrice.toFixed(2)}¢ (target)`);
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
        
        console.log(`[PairTracker] ✅ ${pairId} TAKER FILLED: ${filledSize} @ $${filledPrice.toFixed(2)}`);
        
        // Log taker fill event
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
        
        // Update pair state
        pair.takerFilledAt = Date.now();
        pair.takerFilledPrice = filledPrice;
        pair.takerFilledSize = filledSize;
        
        // Calculate and place maker
        const makerPlaceResult = await this.placeMakerOrder(pair, market, filledPrice, filledSize);
        
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
    
    console.log(`[PairTracker] 📝 Placing MAKER: ${pair.makerSide} @ $${clampedMakerPrice.toFixed(3)}`);
    console.log(`[PairTracker]    Calculation: $${this.config.targetCpp.toFixed(2)} - $${takerFilledPrice.toFixed(3)} = $${makerPrice.toFixed(3)}`);
    
    try {
      const makerResult = await placeOrder({
        tokenId: makerTokenId,
        side: 'BUY',
        price: clampedMakerPrice,
        size: takerFilledSize,
        orderType: 'GTC',
      });
      
      if (!makerResult.success || !makerResult.orderId) {
        console.log(`[PairTracker] ❌ Maker order failed: ${makerResult.error}`);
        pair.makerPlaced = false; // Release lock on failure
        return { success: false, error: makerResult.error || 'maker_failed' };
      }
      
      // Register order ID for WebSocket
      registerOurOrderId(makerResult.orderId);
      
      // Update pair state (makerPlaced already true)
      pair.makerOrderId = makerResult.orderId;
      pair.makerPrice = clampedMakerPrice;
      pair.status = 'WAITING_HEDGE';
      pair.updatedAt = Date.now();
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] 📝 ${pair.id} MAKER PLACED`);
      console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${takerFilledPrice.toFixed(2)} (filled)`);
      console.log(`[PairTracker]    MAKER: ${takerFilledSize} ${pair.makerSide} @ $${clampedMakerPrice.toFixed(2)} (open)`);
      console.log(`[PairTracker]    PROJECTED CPP: $${(takerFilledPrice + clampedMakerPrice).toFixed(3)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      // Log pair event to database
      logPairEvent({
        pairId: pair.id,
        eventType: 'pair_maker_placed',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: pair.takerSide,
        takerPrice: takerFilledPrice,
        takerSize: takerFilledSize,
        makerSide: pair.makerSide,
        makerPrice: clampedMakerPrice,
        makerSize: takerFilledSize,
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
      const isTakerMatch = 
        pair.status === 'PENDING_ENTRY' &&
        pair.takerSide === fill.side &&
        !pair.takerFilledAt &&
        (pair.takerOrderId === fill.orderId || !pair.takerOrderId);
      
      if (isTakerMatch) {
        console.log(`[PairTracker] 🎯 WebSocket taker fill detected for ${pair.id}`);
        
        // Update taker fill info
        if (fill.orderId) pair.takerOrderId = fill.orderId;
        pair.takerFilledAt = Date.now();
        pair.takerFilledPrice = fill.price;
        pair.takerFilledSize = fill.size;
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
          pair.status = 'WAITING_HEDGE';
        }
        
        return { pairUpdated: true, pair };
      }
      
      // =========================================================================
      // MAKER FILL TRACKING
      // =========================================================================
      if (pair.makerOrderId === fill.orderId && pair.status === 'WAITING_HEDGE') {
        pair.makerFilledAt = Date.now();
        pair.makerFilledPrice = fill.price;
        pair.makerFilledSize = fill.size;
        pair.status = 'HEDGED';
        pair.updatedAt = Date.now();
        
        // Calculate actual CPP
        const takerCost = pair.takerFilledPrice || pair.takerPrice;
        pair.actualCpp = takerCost + fill.price;
        pair.pnl = (1.0 - pair.actualCpp) * Math.min(pair.takerFilledSize || 0, fill.size);
        
        console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
        console.log(`[PairTracker] ✅ ${pair.id} HEDGED - COMPLETE!`);
        console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${takerCost.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    MAKER: ${fill.size} ${pair.makerSide} @ $${fill.price.toFixed(2)} (filled)`);
        console.log(`[PairTracker]    CPP: $${pair.actualCpp.toFixed(3)} | P&L: ${pair.pnl >= 0 ? '+' : ''}$${pair.pnl.toFixed(2)}`);
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
        console.log(`[PairTracker] 🛑 ${pair.id} EMERGENCY HEDGED`);
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
