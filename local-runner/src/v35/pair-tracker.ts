// ============================================================
// V37 PAIR TRACKER - PER-PAIR MAKER APPROACH
// ============================================================
// Version: V37.6.1 - "Startup Delay + Smart Maker"
//
// STRATEGY:
// 1. WAIT 60 seconds from market start before trading (14 min window)
// 2. Every 5 seconds: check if expensive side is 3-97c
// 3. Buy expensive side as TAKER (FOK)
// 4. Check if "free" shares exist on cheap side (unpaired excess)
// 5. If free shares < taker size: Place MAKER for the DIFFERENCE only
// 6. Max 10 concurrent open pairs
//
// V37.6.0: SMART MAKER PLACEMENT
// - Tracks "free" shares = cheapQty - expensiveQty (excess on cheap side)
// - Free shares are automatically paired with new taker buys
// - Only places maker orders when there's a SHORTAGE on cheap side
// - Respects $1 minimum order value for makers
//
// Example flow:
// 1. Buy 10 UP @ 90c → Must hedge with 20 DOWN @ 5c ($1 min)
// 2. Now: UP=10, DOWN=20 → 10 "free" DOWN shares
// 3. Next: Buy 10 UP → Use the 10 free DOWN, NO MAKER NEEDED
// 4. Now: UP=20, DOWN=20 → 0 free shares (all paired)
//
// PRICE GUARD: Only trade when expensive side is 3-97c
// MIN ORDER: $1 minimum for both taker AND maker
// ============================================================

import type { V35Market, V35Side, V35Asset, V35Fill } from './types.js';
import { placeOrder, cancelOrder, getOrderById } from '../polymarket.js';
import { logPairEvent, saveV35Fill } from './backend.js';
import { getV35Config } from './config.js';
import { registerOurOrderId } from './user-ws.js';
import { calculateDynamicMargin, isVolatilityMarginEnabled, getMarginSummary } from './dynamic-margin.js';
import { getHotConfig, type HotReloadConfig } from './hot-reload.js';

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
  
  // Escalation (V36 feature - optional)
  escalationAttempts?: number;
  lastEscalationAt?: number;
}

export interface PairTrackerConfig {
  maxOpenPairs: number;              // Max concurrent open pairs
  targetMargin: number;              // Target margin (default 5c = 0.05)
  minSharesPerTaker: number;         // Minimum shares per taker
  maxSharesPerTaker: number;         // Maximum shares per taker
  pairCooldownMs: number;            // Interval between new pairs
  minExpensivePrice: number;         // Min price for expensive side (3c)
  maxExpensivePrice: number;         // Max price for expensive side (97c)
  
  // Toggles for optional features
  enableEscalationHedge: boolean;    // V36 escalation hedge (timeout → reprice)
  enableVolatilityMargin: boolean;   // V36 volatility-based margin adjustment
  
  // Escalation settings (only used if enableEscalationHedge = true)
  escalationTimeoutMs: number;       // Time before repricing maker
  maxEscalationAttempts: number;     // Max reprice attempts
  escalationPriceIncrement: number;  // Price increment per attempt
  
  // Fill audit settings
  fillAuditIntervalMs: number;       // How often to poll REST API for missed fills
}

const DEFAULT_CONFIG: PairTrackerConfig = {
  maxOpenPairs: 10,                  // Max 10 concurrent pairs
   targetMargin: 0.06,                // 6c margin = 94c CPP
  minSharesPerTaker: 5,
  maxSharesPerTaker: 20,
  pairCooldownMs: 5_000,             // 5 seconds between pairs
  minExpensivePrice: 0.03,           // 3c minimum
  maxExpensivePrice: 0.97,           // 97c maximum
  
  // Feature toggles - both OFF by default for V37 simplicity
  enableEscalationHedge: false,
  enableVolatilityMargin: false,
  
  // Escalation settings (for when enabled)
  escalationTimeoutMs: 30_000,       // 30s before repricing
  maxEscalationAttempts: 3,
  escalationPriceIncrement: 0.02,    // 2c per attempt
  
  // Fill audit
  fillAuditIntervalMs: 5_000,        // Check every 5s
};

// Startup delay: wait 60 seconds from market start before trading
const STARTUP_DELAY_MS = 60_000;

// Minimum order value per Polymarket CLOB rules
const MIN_ORDER_VALUE_USD = 1.00;

// ============================================================
// PAIR TRACKER CLASS
// ============================================================

export class PairTracker {
  private config: PairTrackerConfig;
  private pairs: Map<string, PendingPair> = new Map();
  private pairCounter = 0;
  private lastPairOpenedAt: number = 0;
  private lastFillAuditAt: number = 0;
  
  constructor(config: Partial<PairTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  // ============================================================
  // HOT-RELOAD CONFIG UPDATE
  // ============================================================
  
  /**
   * Update config from hot-reload system (live updates from database)
   */
  updateFromHotConfig(hotConfig: HotReloadConfig): void {
    console.log(`[PairTracker] Applying hot-reload config v${hotConfig.config_version}`);
    
    this.config = {
      ...this.config,
      maxOpenPairs: hotConfig.pair_limit,
      targetMargin: 1.00 - hotConfig.cpp_target, // CPP 0.95 → margin 0.05
      minSharesPerTaker: hotConfig.min_lot_shares,
      maxSharesPerTaker: hotConfig.base_lot_shares * 2,
      minExpensivePrice: hotConfig.price_guard_min,
      maxExpensivePrice: hotConfig.price_guard_max,
      enableEscalationHedge: hotConfig.enable_escalation_hedge,
      enableVolatilityMargin: hotConfig.enable_volatility_margin,
      escalationTimeoutMs: hotConfig.escalation_timeout_ms,
      escalationPriceIncrement: hotConfig.escalation_reprice_ticks * 0.01,
      fillAuditIntervalMs: hotConfig.fill_audit_interval_ms,
    };
    
    console.log(`[PairTracker] Config updated: pairLimit=${this.config.maxOpenPairs}, margin=${(this.config.targetMargin * 100).toFixed(1)}¢, priceGuard=${this.config.minExpensivePrice}-${this.config.maxExpensivePrice}`);
  }
  
  // ============================================================
  // PRICE GUARD
  // ============================================================
  
  /**
   * Check if price is within acceptable range (3-97c)
   */
  isPriceAcceptable(price: number): boolean {
    return price >= this.config.minExpensivePrice && price <= this.config.maxExpensivePrice;
  }
  
  // ============================================================
  // MARGIN CALCULATION
  // ============================================================
  
  /**
   * Calculate maker price based on taker price and margin
   * With optional volatility adjustment
   */
  calculateMakerPrice(
    takerPrice: number, 
    asset: V35Asset, 
    strikePrice?: number
  ): { makerPrice: number; marginUsed: number; volatilityInfo?: string } {
    let marginUsed = this.config.targetMargin;
    let volatilityInfo: string | undefined;
    
    // Apply volatility scaling if enabled
    if (this.config.enableVolatilityMargin && strikePrice) {
      try {
        const marginResult = calculateDynamicMargin(asset, strikePrice);
        marginUsed = marginResult.finalMargin;
        volatilityInfo = getMarginSummary(marginResult);
      } catch (err) {
        console.log(`[PairTracker] Volatility margin error, using default: ${err}`);
      }
    }
    
    // makerPrice = 100c - takerPrice - margin
    // e.g., taker @ 90c, margin 5c → maker @ 5c
    const makerPrice = Math.max(0.01, 1.00 - takerPrice - marginUsed);
    
    // Round to 2 decimals
    const roundedMakerPrice = Math.round(makerPrice * 100) / 100;
    
    return { makerPrice: roundedMakerPrice, marginUsed, volatilityInfo };
  }
  
  // ============================================================
  // PAIR MANAGEMENT
  // ============================================================
  
  /**
   * V37.6.0: Get "free" shares on cheap side that can be used for pairing
   * 
   * FREE SHARES = cheapQty - expensiveQty (the excess on cheap side)
   * 
   * Example:
   * - UP=10, DOWN=20 → freeDown = 20-10 = 10 (these can pair with next UP buys)
   * - UP=20, DOWN=20 → freeDown = 0 (all paired, need new maker)
   * - UP=30, DOWN=20 → freeDown = 0, freeUp = 10 (imbalanced the other way)
   */
  getFreeSharesOnCheapSide(market: V35Market, cheapSide: V35Side): number {
    const cheapQty = cheapSide === 'UP' ? market.upQty : market.downQty;
    const expensiveQty = cheapSide === 'UP' ? market.downQty : market.upQty;
    
    // Also count pending makers that haven't filled yet (they're "reserved")
    const pendingMakerShares = Array.from(this.pairs.values())
      .filter(p => 
        p.marketSlug === market.slug && 
        p.status === 'WAITING_HEDGE' &&
        p.makerSide === cheapSide
      )
      .reduce((sum, p) => sum + (p.makerSize - (p.makerFilledSize || 0)), 0);
    
    // Effective cheap side = current positions + pending makers
    const effectiveCheapQty = cheapQty + pendingMakerShares;
    
    // Free shares = excess on cheap side (can be used for new pairs)
    const freeShares = Math.max(0, effectiveCheapQty - expensiveQty);
    
    console.log(`[PairTracker] 📊 FREE SHARES: ${cheapSide}=${effectiveCheapQty.toFixed(0)} (pos=${cheapQty.toFixed(0)} + pending=${pendingMakerShares.toFixed(0)}) - expensive=${expensiveQty.toFixed(0)} → ${freeShares.toFixed(0)} free`);
    
    return freeShares;
  }
  
  /**
   * Get remaining capacity on cheap side (max 100 per side)
   * Returns how many MORE shares can be added to cheap side
   */
  getRemainingCapacity(market: V35Market, cheapSide: V35Side): number {
    const cheapQty = cheapSide === 'UP' ? market.upQty : market.downQty;
    
    // Count pending makers
    const pendingMakerShares = Array.from(this.pairs.values())
      .filter(p => 
        p.marketSlug === market.slug && 
        p.status === 'WAITING_HEDGE' &&
        p.makerSide === cheapSide
      )
      .reduce((sum, p) => sum + (p.makerSize - (p.makerFilledSize || 0)), 0);
    
    const effectiveCheapQty = cheapQty + pendingMakerShares;
    const maxPerSide = 100;
    const remaining = Math.max(0, maxPerSide - effectiveCheapQty);
    
    return remaining;
  }
  
  /**
   * Check if we can open a new pair
   */
  canOpenNewPair(): boolean {
    // Check cooldown
    const timeSinceLastPair = Date.now() - this.lastPairOpenedAt;
    if (timeSinceLastPair < this.config.pairCooldownMs) {
      const remaining = Math.ceil((this.config.pairCooldownMs - timeSinceLastPair) / 1000);
      console.log(`[PairTracker] ⏳ Cooldown: ${remaining}s remaining`);
      return false;
    }
    
    // Check max open pairs
    const activePairs = this.getActivePairs();
    if (activePairs.length >= this.config.maxOpenPairs) {
      console.log(`[PairTracker] 🛑 Max pairs: ${activePairs.length}/${this.config.maxOpenPairs}`);
      return false;
    }
    
    console.log(`[PairTracker] ✅ Can open: ${activePairs.length}/${this.config.maxOpenPairs} pairs`);
    return true;
  }
  
  /**
   * Calculate size ensuring $1 minimum order value
   */
  calculateOrderSize(baseSize: number, price: number): number {
    const orderValue = baseSize * price;
    if (orderValue >= MIN_ORDER_VALUE_USD) {
      return baseSize;
    }
    // Scale up to meet minimum
    const minSize = Math.ceil(MIN_ORDER_VALUE_USD / price);
    console.log(`[PairTracker] 📈 Size scaled for $1 min: ${baseSize} → ${minSize} @ $${price.toFixed(2)}`);
    return minSize;
  }
  
  /**
   * Open a new pair: buy expensive side as taker, optionally place maker on cheap side
   * 
   * V37.6.0: SMART MAKER PLACEMENT
   * - Check how many "free" shares exist on cheap side (excess that can pair with new takers)
   * - If free >= taker size: NO new maker needed, those shares will pair automatically
   * - If free < taker size: Place maker for the DIFFERENCE only
   * 
   * Example:
   * 1. UP=10, DOWN=20 (10 free DOWN) → Buy 10 UP, no maker needed
   * 2. UP=20, DOWN=20 (0 free) → Buy 10 UP, place maker for 20 DOWN @ 5c ($1 min)
   * 3. UP=25, DOWN=40 (15 free DOWN) → Buy 10 UP, no maker needed
   */
  async openPair(
    market: V35Market,
    expensiveSide: V35Side,
    baseSize: number,
    strikePrice?: number
  ): Promise<{ success: boolean; pairId?: string; error?: string }> {
    const config = getV35Config();
    
    // Only BTC for now
    if (market.asset !== 'BTC') {
      return { success: false, error: 'only_btc' };
    }
    
    // =========================================================================
    // V37.6.1: STARTUP DELAY - Wait 60s from market start before trading
    // =========================================================================
    const marketStartTime = market.eventStartTime?.getTime?.() || market.eventStartTime;
    const now = Date.now();
    const elapsedSinceStart = now - marketStartTime;
    
    if (elapsedSinceStart < STARTUP_DELAY_MS) {
      const waitSeconds = Math.ceil((STARTUP_DELAY_MS - elapsedSinceStart) / 1000);
      console.log(`[PairTracker] ⏳ STARTUP DELAY: ${waitSeconds}s remaining (trading starts at T+60s)`);
      return { success: false, error: 'startup_delay' };
    }
    
    // Determine sides early
    const cheapSide: V35Side = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    
    // Get expensive price
    const expensiveAsk = expensiveSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    
    // PRICE GUARD: Check BOTH sides are within 3-97c range
    if (!this.isPriceAcceptable(expensiveAsk)) {
      console.log(`[PairTracker] 🛑 PRICE GUARD: ${expensiveSide} @ $${expensiveAsk.toFixed(2)} outside 3-97c range`);
      return { success: false, error: 'price_outside_range' };
    }
    
    // Calculate cheap side price to check it too
    const preliminaryMakerPrice = Math.max(0.01, 1.00 - expensiveAsk - this.config.targetMargin);
    if (!this.isPriceAcceptable(preliminaryMakerPrice)) {
      console.log(`[PairTracker] 🛑 PRICE GUARD: Maker ${cheapSide} would be $${preliminaryMakerPrice.toFixed(2)} outside 3-97c range`);
      return { success: false, error: 'maker_price_outside_range' };
    }
    
    // =========================================================================
    // V37.6.0: CHECK FREE SHARES + REMAINING CAPACITY
    // =========================================================================
    const freeShares = this.getFreeSharesOnCheapSide(market, cheapSide);
    const remainingCapacity = this.getRemainingCapacity(market, cheapSide);
    
    console.log(`[PairTracker] 📊 FREE: ${freeShares.toFixed(0)} ${cheapSide} | REMAINING CAP: ${remainingCapacity.toFixed(0)}`);
    
    // Check if we can open (cooldown + max pairs)
    if (!this.canOpenNewPair()) {
      return { success: false, error: 'cooldown_or_max_pairs' };
    }
    
    // Set cooldown immediately
    this.lastPairOpenedAt = Date.now();
    
    // Calculate maker price with optional volatility adjustment
    const { makerPrice, marginUsed, volatilityInfo } = this.calculateMakerPrice(
      expensiveAsk, 
      market.asset,
      strikePrice
    );
    
    // Calculate taker size (respecting $1 minimum)
    let takerSize = this.calculateOrderSize(baseSize, expensiveAsk);
    
    // =========================================================================
    // V37.6.0: CALCULATE REQUIRED MAKER SIZE
    // =========================================================================
    // Only need to place maker for shares NOT covered by free shares
    // =========================================================================
    let requiredMakerShares = Math.max(0, takerSize - freeShares);
    let actualMakerSize = 0;
    let needsMaker = false;
    
    if (requiredMakerShares > 0) {
      // Need to place maker - calculate size with $1 minimum
      actualMakerSize = this.calculateOrderSize(requiredMakerShares, makerPrice);
      needsMaker = true;
      
      // Check if we have capacity for the maker
      if (actualMakerSize > remainingCapacity) {
        if (remainingCapacity <= 0) {
          console.log(`[PairTracker] 🛑 NO CAPACITY: ${cheapSide} side is full (100 shares)`);
          return { success: false, error: 'no_capacity' };
        }
        // Clamp to remaining capacity
        actualMakerSize = remainingCapacity;
        console.log(`[PairTracker] ⚠️ CLAMPING maker to ${actualMakerSize} (capacity limit)`);
        
        // Recalculate how many takers we can actually do
        // Total cheap shares available = freeShares + actualMakerSize
        const totalCheapAvailable = freeShares + actualMakerSize;
        if (takerSize > totalCheapAvailable) {
          takerSize = Math.floor(totalCheapAvailable);
          console.log(`[PairTracker] ⚠️ CLAMPING taker to ${takerSize} (matching capacity)`);
        }
      }
    } else {
      // Enough free shares - no maker needed!
      console.log(`[PairTracker] ✨ FREE SHARES: ${freeShares.toFixed(0)} >= ${takerSize} needed → NO MAKER NEEDED`);
    }
    
    // Ensure taker still meets minimum order value
    const takerOrderValue = takerSize * expensiveAsk;
    if (takerOrderValue < MIN_ORDER_VALUE_USD) {
      console.log(`[PairTracker] 🛑 TAKER TOO SMALL: $${takerOrderValue.toFixed(2)} < $${MIN_ORDER_VALUE_USD}`);
      return { success: false, error: 'taker_order_too_small' };
    }
    
    // Create pair ID
    const pairId = `pair_${Date.now()}_${++this.pairCounter}`;
    const targetCpp = expensiveAsk + (needsMaker ? makerPrice : 0);
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 🟠 OPENING ${pairId}`);
    console.log(`[PairTracker]    TAKER: ${takerSize} ${expensiveSide} @ ~$${expensiveAsk.toFixed(2)}`);
    if (needsMaker) {
      console.log(`[PairTracker]    MAKER: ${actualMakerSize} ${cheapSide} @ $${makerPrice.toFixed(2)} (margin: ${(marginUsed * 100).toFixed(0)}c)`);
      console.log(`[PairTracker]    TARGET CPP: $${targetCpp.toFixed(2)}`);
    } else {
      console.log(`[PairTracker]    MAKER: SKIPPED (${freeShares.toFixed(0)} free ${cheapSide} shares available)`);
      console.log(`[PairTracker]    MODE: INSTANT PAIR (using existing inventory)`);
    }
    if (volatilityInfo) {
      console.log(`[PairTracker]    VOLATILITY: ${volatilityInfo}`);
    }
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
      takerSize,
      
      makerSide: cheapSide,
      makerPrice: needsMaker ? makerPrice : 0,
      makerSize: actualMakerSize,
      
      status: 'PENDING_ENTRY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCpp,
      
      escalationAttempts: 0,
    };
    
    this.pairs.set(pairId, pair);
    
    // Get token IDs
    const takerTokenId = expensiveSide === 'UP' ? market.upTokenId : market.downTokenId;
    const makerTokenId = cheapSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    // =========================================================================
    // STEP 1: PLACE TAKER (FOK)
    // =========================================================================
    try {
      const takerPriceWithBuffer = Math.min(0.99, expensiveAsk + 0.02); // Small buffer
      console.log(`[PairTracker] 🚀 TAKER: ${takerSize} ${expensiveSide} @ $${takerPriceWithBuffer.toFixed(3)} (FOK)`);
      
      const takerResult = await placeOrder({
        tokenId: takerTokenId,
        side: 'BUY',
        price: takerPriceWithBuffer,
        size: takerSize,
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
      
      const filledSize = takerResult.filledSize || takerSize;
      const filledPrice = takerResult.avgPrice || expensiveAsk;
      
      pair.takerFilledAt = Date.now();
      pair.takerFilledPrice = filledPrice;
      pair.takerFilledSize = filledSize;
      pair.updatedAt = Date.now();
      
      console.log(`[PairTracker] ✅ TAKER FILLED: ${filledSize} @ $${filledPrice.toFixed(3)}`);
      
      // Save taker fill to database (V36 feature)
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
      
    } catch (err: any) {
      console.error(`[PairTracker] Taker error:`, err?.message);
      this.pairs.delete(pairId);
      return { success: false, error: err?.message };
    }
    
    // =========================================================================
    // STEP 2: PLACE MAKER (GTC) - ONLY IF NEEDED
    // =========================================================================
    if (!needsMaker) {
      // No maker needed - mark as already hedged (using free shares)
      pair.status = 'HEDGED';
      pair.makerFilledAt = Date.now();
      pair.makerFilledPrice = 0; // No cost for using free shares
      pair.makerFilledSize = 0;
      pair.actualCpp = pair.takerFilledPrice; // Only paid for taker
      pair.pnl = pair.takerFilledSize! * (1 - pair.actualCpp); // Profit = shares * (1 - cpp)
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ INSTANT PAIR: ${pairId}`);
      console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${pair.takerFilledPrice?.toFixed(3)} ✓`);
      console.log(`[PairTracker]    MAKER: FREE (used existing ${cheapSide} inventory)`);
      console.log(`[PairTracker]    CPP: $${pair.actualCpp?.toFixed(3)} | P&L: $${pair.pnl?.toFixed(2)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      logPairEvent({
        pairId,
        eventType: 'pair_instant_hedged',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: pair.takerSide,
        takerPrice: pair.takerFilledPrice || 0,
        takerSize: pair.takerFilledSize || 0,
        makerSide: cheapSide,
        makerPrice: 0,
        makerSize: 0,
        cpp: pair.actualCpp,
        pnl: pair.pnl,
        status: 'HEDGED',
        note: `Used ${freeShares.toFixed(0)} free ${cheapSide} shares`,
      }).catch(() => {});
      
      return { success: true, pairId };
    }
    
    // Need to place maker
    try {
      // Recalculate maker size based on actual taker fill
      const actualTakerFilled = pair.takerFilledSize!;
      const requiredMakerForTaker = Math.max(0, actualTakerFilled - freeShares);
      const finalMakerSize = this.calculateOrderSize(requiredMakerForTaker, makerPrice);
      pair.makerSize = finalMakerSize;
      
      console.log(`[PairTracker] 📝 MAKER: ${finalMakerSize} ${cheapSide} @ $${makerPrice.toFixed(3)} (GTC)`);
      
      const makerResult = await placeOrder({
        tokenId: makerTokenId,
        side: 'BUY',
        price: makerPrice,
        size: finalMakerSize,
        orderType: 'GTC',
      });
      
      if (!makerResult.success || !makerResult.orderId) {
        console.log(`[PairTracker] ⚠️ Maker failed: ${makerResult.error}`);
        // Don't delete pair - taker is filled, we need to track this!
        pair.status = 'WAITING_HEDGE';
        return { success: true, pairId, error: `maker_failed: ${makerResult.error}` };
      }
      
      registerOurOrderId(makerResult.orderId);
      pair.makerOrderId = makerResult.orderId;
      pair.status = 'WAITING_HEDGE';
      pair.updatedAt = Date.now();
      
      // Update target CPP with actual prices
      pair.targetCpp = (pair.takerFilledPrice || 0) + makerPrice;
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ PAIR OPENED: ${pairId}`);
      console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${pair.takerFilledPrice?.toFixed(3)} ✓`);
      console.log(`[PairTracker]    MAKER: ${finalMakerSize} ${cheapSide} @ $${makerPrice.toFixed(3)} (open)`);
      console.log(`[PairTracker]    PROJECTED CPP: $${pair.targetCpp.toFixed(3)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
      // Log to database
      logPairEvent({
        pairId,
        eventType: 'pair_opened',
        marketSlug: market.slug,
        asset: market.asset,
        takerSide: pair.takerSide,
        takerPrice: pair.takerFilledPrice || 0,
        takerSize: pair.takerFilledSize || 0,
        makerSide: cheapSide,
        makerPrice,
        makerSize: finalMakerSize,
        status: 'WAITING_HEDGE',
      }).catch(() => {});
      
      return { success: true, pairId };
      
    } catch (err: any) {
      console.error(`[PairTracker] Maker error:`, err?.message);
      pair.status = 'WAITING_HEDGE';
      return { success: true, pairId, error: err?.message };
    }
  }
  
  // ============================================================
  // FILL HANDLING
  // ============================================================
  
  /**
   * Handle a fill from WebSocket or REST API
   */
  onFill(fill: V35Fill): void {
    // Find pair where this fill matches the maker order
    const pair = Array.from(this.pairs.values()).find(p => 
      p.makerOrderId === fill.orderId && p.status === 'WAITING_HEDGE'
    );
    
    if (!pair) return;
    
    // Maker filled!
    pair.makerFilledAt = Date.now();
    pair.makerFilledPrice = fill.price;
    pair.makerFilledSize = (pair.makerFilledSize || 0) + fill.size;
    pair.updatedAt = Date.now();
    
    console.log(`[PairTracker] 📥 MAKER FILL: ${fill.size} ${pair.makerSide} @ $${fill.price.toFixed(3)}`);
    
    // Save maker fill to database
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
    
    // Calculate P&L
    const takerCost = (pair.takerFilledPrice || 0) * (pair.takerFilledSize || 0);
    const makerCost = (pair.makerFilledPrice || 0) * pair.makerFilledSize;
    const totalCost = takerCost + makerCost;
    const pairedShares = Math.min(pair.takerFilledSize || 0, pair.makerFilledSize);
    
    if (pairedShares > 0) {
      pair.actualCpp = totalCost / pairedShares;
      pair.pnl = pairedShares - totalCost; // 1 share pair pays out $1
    }
    
    // Check if fully hedged
    if (pair.makerFilledSize >= (pair.takerFilledSize || 0)) {
      pair.status = 'HEDGED';
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ ${pair.id} FULLY HEDGED`);
      console.log(`[PairTracker]    TAKER: ${pair.takerFilledSize} ${pair.takerSide} @ $${pair.takerFilledPrice?.toFixed(3)}`);
      console.log(`[PairTracker]    MAKER: ${pair.makerFilledSize} ${pair.makerSide} @ $${pair.makerFilledPrice?.toFixed(3)}`);
      console.log(`[PairTracker]    CPP: $${pair.actualCpp?.toFixed(3)} | P&L: $${pair.pnl?.toFixed(2)}`);
      console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
      
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
  // FILL AUDIT (V36 FEATURE) - Poll REST API for missed fills
  // ============================================================
  
  /**
   * Audit waiting pairs for fills that WebSocket may have missed
   */
  async auditMakerFills(): Promise<void> {
    const now = Date.now();
    
    // Throttle audit calls
    if (now - this.lastFillAuditAt < this.config.fillAuditIntervalMs) {
      return;
    }
    this.lastFillAuditAt = now;
    
    const waitingPairs = this.getWaitingPairs().filter(p => 
      p.makerOrderId && 
      (now - p.createdAt) > 5000 // Only audit pairs older than 5s
    );
    
    if (waitingPairs.length === 0) return;
    
    for (const pair of waitingPairs) {
      try {
        const orderInfo = await getOrderById(pair.makerOrderId!);
        if (!orderInfo) continue;
        
        const sizeMatched = parseFloat(orderInfo.size_matched || '0');
        const currentMakerFilled = pair.makerFilledSize || 0;
        
        if (sizeMatched > currentMakerFilled) {
          // Found fill that WebSocket missed!
          const missedFillSize = sizeMatched - currentMakerFilled;
          const price = parseFloat(orderInfo.price || '0');
          
          console.log(`[PairTracker] 🔍 AUDIT: Found missed fill for ${pair.id}: ${missedFillSize} @ $${price.toFixed(3)}`);
          
          // Simulate the fill
          this.onFill({
            orderId: pair.makerOrderId!,
            tokenId: '', // Not needed for internal matching
            side: pair.makerSide,
            price,
            size: missedFillSize,
            timestamp: new Date(),
            marketSlug: pair.marketSlug,
            asset: pair.asset,
          });
        }
      } catch (err) {
        // Silently continue - audit is best-effort
      }
    }
  }
  
  // ============================================================
  // ESCALATION HEDGE (V36 FEATURE - OPTIONAL)
  // ============================================================
  
  /**
   * Check and escalate stale waiting pairs (reprice maker orders)
   * Only runs if enableEscalationHedge = true
   */
  async escalateStalePairs(): Promise<void> {
    if (!this.config.enableEscalationHedge) return;
    
    const now = Date.now();
    const stalePairs = this.getWaitingPairs().filter(p => {
      const age = now - (p.lastEscalationAt || p.createdAt);
      const attempts = p.escalationAttempts || 0;
      return age > this.config.escalationTimeoutMs && 
             attempts < this.config.maxEscalationAttempts &&
             p.makerOrderId;
    });
    
    for (const pair of stalePairs) {
      try {
        // Cancel old maker order
        await cancelOrder(pair.makerOrderId!);
        
        // Calculate new price with escalation
        const attempts = (pair.escalationAttempts || 0) + 1;
        const newPrice = pair.makerPrice + (attempts * this.config.escalationPriceIncrement);
        
        console.log(`[PairTracker] 📈 ESCALATING ${pair.id}: $${pair.makerPrice.toFixed(2)} → $${newPrice.toFixed(2)} (attempt ${attempts})`);
        
        // Place new maker order at higher price
        // Note: This would need the tokenId which we don't store - for now just log
        pair.escalationAttempts = attempts;
        pair.lastEscalationAt = now;
        pair.makerPrice = newPrice;
        pair.updatedAt = now;
        
        // In full implementation: place new order and update makerOrderId
        
      } catch (err) {
        console.error(`[PairTracker] Escalation error for ${pair.id}:`, err);
      }
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
        
        logPairEvent({
          pairId: pair.id,
          eventType: 'pair_expired',
          marketSlug: pair.marketSlug,
          asset: pair.asset,
          takerSide: pair.takerSide,
          takerPrice: pair.takerFilledPrice || 0,
          takerSize: pair.takerFilledSize || 0,
          makerSide: pair.makerSide,
          makerPrice: pair.makerFilledPrice || 0,
          makerSize: pair.makerFilledSize || 0,
          cpp: pair.actualCpp,
          pnl: pair.pnl,
          status: 'EXPIRED',
        }).catch(() => {});
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
    let cancelled = 0;
    
    const waitingPairs = this.getMarketPairs(marketSlug)
      .filter(p => p.status === 'WAITING_HEDGE' && p.makerOrderId);
    
    for (const pair of waitingPairs) {
      try {
        await cancelOrder(pair.makerOrderId!);
        pair.status = 'CANCELLED';
        pair.updatedAt = Date.now();
        cancelled++;
      } catch (err) {
        console.error(`[PairTracker] Failed to cancel ${pair.makerOrderId}:`, err);
      }
    }
    
    return cancelled;
  }
  
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
  // GETTERS
  // ============================================================
  
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
  
  /**
   * Get summary for a market
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
  
  // ============================================================
  // CONFIGURATION
  // ============================================================
  
  /**
   * Update config at runtime
   */
  updateConfig(newConfig: Partial<PairTrackerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log(`[PairTracker] Config updated`);
  }
  
  /**
   * Get current config
   */
  getConfig(): PairTrackerConfig {
    return { ...this.config };
  }
  
  // ============================================================
  // LEGACY COMPATIBILITY STUBS
  // ============================================================
  
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
