// ============================================================
// V37 PAIR TRACKER - SHARED MAKER APPROACH
// ============================================================
// Version: V37.1.0 - "Shared Maker"
//
// STRATEGY:
// 1. Place 1 LARGE maker order at cheap side (100 shares @ 1c)
// 2. Every 5 seconds: buy expensive side as TAKER (3-97c only)
// 3. Multiple takers hedge against the same maker order
// 4. Max 10 takers per market
//
// PRICE GUARD: Only trade when expensive side is 3-97c
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

export interface TakerEntry {
  id: string;
  takerOrderId: string;
  takerSide: V35Side;
  takerPrice: number;
  takerSize: number;
  takerFilledAt: number;
  createdAt: number;
}

export interface SharedMaker {
  marketSlug: string;
  asset: V35Asset;
  conditionId: string;
  
  // The maker order
  makerSide: V35Side;
  makerPrice: number;
  makerSize: number;
  makerOrderId?: string;
  makerFilledSize: number;
  
  // Takers that hedge against this maker
  takers: TakerEntry[];
  totalTakerShares: number;
  
  // Status
  status: 'ACTIVE' | 'FILLED' | 'EXPIRED' | 'CANCELLED';
  createdAt: number;
  updatedAt: number;
}

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
  maxTakersPerMarket: number;        // Max takers hedging against one maker
  sharedMakerSize: number;           // Size of shared maker order (e.g., 100)
  sharedMakerPrice: number;          // Price for shared maker (e.g., 0.01 = 1c)
  targetMargin: number;              // Target margin (default 5c = 0.05)
  minSharesPerTaker: number;         // Minimum shares per taker
  maxSharesPerTaker: number;         // Maximum shares per taker
  pairCooldownMs: number;            // Interval between new takers
  minExpensivePrice: number;         // Min price for expensive side (3c)
  maxExpensivePrice: number;         // Max price for expensive side (97c)
}

const DEFAULT_CONFIG: PairTrackerConfig = {
  maxTakersPerMarket: 10,            // Max 10 takers per shared maker
  sharedMakerSize: 100,              // 100 shares @ 1c maker
  sharedMakerPrice: 0.01,            // 1c maker price
  targetMargin: 0.05,                // 5c margin = 95c CPP
  minSharesPerTaker: 5,
  maxSharesPerTaker: 20,
  pairCooldownMs: 5_000,             // 5 seconds between takers
  minExpensivePrice: 0.03,           // 3c minimum
  maxExpensivePrice: 0.97,           // 97c maximum
};

// ============================================================
// PAIR TRACKER CLASS - SHARED MAKER VERSION
// ============================================================

export class PairTracker {
  private config: PairTrackerConfig;
  private sharedMakers: Map<string, SharedMaker> = new Map();
  private pairs: Map<string, PendingPair> = new Map();
  private pairCounter = 0;
  private lastTakerOpenedAt: number = 0;
  
  constructor(config: Partial<PairTrackerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
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
  // SHARED MAKER MANAGEMENT
  // ============================================================
  
  /**
   * Get or create shared maker for a market
   */
  getSharedMaker(marketSlug: string): SharedMaker | undefined {
    return this.sharedMakers.get(marketSlug);
  }
  
  /**
   * Check if we need to place a shared maker order
   */
  needsSharedMaker(marketSlug: string): boolean {
    const existing = this.sharedMakers.get(marketSlug);
    if (!existing) return true;
    if (existing.status === 'FILLED' || existing.status === 'EXPIRED' || existing.status === 'CANCELLED') return true;
    return false;
  }
  
  /**
   * Place the shared maker order (100 shares @ 1c on cheap side)
   */
  async placeSharedMaker(
    market: V35Market,
    cheapSide: V35Side
  ): Promise<{ success: boolean; orderId?: string; error?: string }> {
    const config = getV35Config();
    
    // Only BTC for now
    if (market.asset !== 'BTC') {
      return { success: false, error: 'only_btc' };
    }
    
    // Check if we already have an active maker
    const existing = this.sharedMakers.get(market.slug);
    if (existing && existing.status === 'ACTIVE') {
      console.log(`[PairTracker] Already have active maker for ${market.slug}`);
      return { success: true, orderId: existing.makerOrderId };
    }
    
    const makerTokenId = cheapSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 📝 PLACING SHARED MAKER`);
    console.log(`[PairTracker]    ${this.config.sharedMakerSize} ${cheapSide} @ $${this.config.sharedMakerPrice.toFixed(2)}`);
    console.log(`[PairTracker]    Market: ${market.slug.slice(-30)}`);
    console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
    
    if (config.dryRun) {
      console.log(`[PairTracker] [DRY RUN] Would place shared maker`);
      return { success: false, error: 'dry_run' };
    }
    
    try {
      const makerResult = await placeOrder({
        tokenId: makerTokenId,
        side: 'BUY',
        price: this.config.sharedMakerPrice,
        size: this.config.sharedMakerSize,
        orderType: 'GTC',
      });
      
      if (!makerResult.success || !makerResult.orderId) {
        console.log(`[PairTracker] ❌ Shared maker failed: ${makerResult.error}`);
        return { success: false, error: makerResult.error || 'maker_failed' };
      }
      
      registerOurOrderId(makerResult.orderId);
      
      // Create shared maker object
      const sharedMaker: SharedMaker = {
        marketSlug: market.slug,
        asset: market.asset,
        conditionId: market.conditionId,
        makerSide: cheapSide,
        makerPrice: this.config.sharedMakerPrice,
        makerSize: this.config.sharedMakerSize,
        makerOrderId: makerResult.orderId,
        makerFilledSize: 0,
        takers: [],
        totalTakerShares: 0,
        status: 'ACTIVE',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      
      this.sharedMakers.set(market.slug, sharedMaker);
      
      console.log(`[PairTracker] ✅ Shared maker placed: ${makerResult.orderId}`);
      
      return { success: true, orderId: makerResult.orderId };
      
    } catch (err: any) {
      console.error(`[PairTracker] Error placing shared maker:`, err?.message);
      return { success: false, error: err?.message };
    }
  }
  
  // ============================================================
  // TAKER MANAGEMENT
  // ============================================================
  
  /**
   * Check if we can open a new taker
   */
  canOpenNewTaker(marketSlug: string): boolean {
    // Check cooldown
    const timeSinceLastTaker = Date.now() - this.lastTakerOpenedAt;
    if (timeSinceLastTaker < this.config.pairCooldownMs) {
      const remaining = Math.ceil((this.config.pairCooldownMs - timeSinceLastTaker) / 1000);
      console.log(`[PairTracker] ⏳ Cooldown: ${remaining}s remaining`);
      return false;
    }
    
    // Check if we have an active shared maker
    const sharedMaker = this.sharedMakers.get(marketSlug);
    if (!sharedMaker || sharedMaker.status !== 'ACTIVE') {
      console.log(`[PairTracker] 🛑 No active shared maker for ${marketSlug.slice(-30)}`);
      return false;
    }
    
    // Check max takers
    if (sharedMaker.takers.length >= this.config.maxTakersPerMarket) {
      console.log(`[PairTracker] 🛑 Max takers: ${sharedMaker.takers.length}/${this.config.maxTakersPerMarket}`);
      return false;
    }
    
    // Check if taker shares would exceed maker capacity
    const remainingMakerCapacity = sharedMaker.makerSize - sharedMaker.totalTakerShares;
    if (remainingMakerCapacity < this.config.minSharesPerTaker) {
      console.log(`[PairTracker] 🛑 Maker capacity exhausted: ${remainingMakerCapacity} shares left`);
      return false;
    }
    
    console.log(`[PairTracker] ✅ Can open: ${sharedMaker.takers.length}/${this.config.maxTakersPerMarket} takers, ${remainingMakerCapacity} maker capacity`);
    return true;
  }
  
  /**
   * Open a new taker that hedges against the shared maker
   */
  async openTaker(
    market: V35Market,
    expensiveSide: V35Side,
    size: number
  ): Promise<{ success: boolean; pairId?: string; error?: string }> {
    const config = getV35Config();
    
    // Only BTC for now
    if (market.asset !== 'BTC') {
      return { success: false, error: 'only_btc' };
    }
    
    // Get expensive price
    const expensiveAsk = expensiveSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    
    // PRICE GUARD: Check 3-97c range
    if (!this.isPriceAcceptable(expensiveAsk)) {
      console.log(`[PairTracker] 🛑 PRICE GUARD: ${expensiveSide} @ $${expensiveAsk.toFixed(2)} outside 3-97c range`);
      return { success: false, error: 'price_outside_range' };
    }
    
    // Check if we can open
    if (!this.canOpenNewTaker(market.slug)) {
      return { success: false, error: 'cooldown_or_max_takers' };
    }
    
    // Set cooldown immediately
    this.lastTakerOpenedAt = Date.now();
    
    // Get shared maker
    const sharedMaker = this.sharedMakers.get(market.slug)!;
    
    // Clamp size to remaining maker capacity
    const remainingCapacity = sharedMaker.makerSize - sharedMaker.totalTakerShares;
    size = Math.max(this.config.minSharesPerTaker, Math.min(size, this.config.maxSharesPerTaker, remainingCapacity));
    
    // Ensure $1 minimum order value
    const MIN_ORDER_VALUE = 1.00;
    const takerOrderValue = size * expensiveAsk;
    if (takerOrderValue < MIN_ORDER_VALUE) {
      size = Math.ceil(MIN_ORDER_VALUE / expensiveAsk);
      console.log(`[PairTracker] 📈 Adjusted size for $1 min: ${size} shares`);
    }
    
    // Create pair ID
    const pairId = `pair_${Date.now()}_${++this.pairCounter}`;
    const cheapSide: V35Side = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    
    console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
    console.log(`[PairTracker] 🟠 OPENING TAKER ${pairId}`);
    console.log(`[PairTracker]    TAKER: ${size} ${expensiveSide} @ ~$${expensiveAsk.toFixed(2)}`);
    console.log(`[PairTracker]    SHARED MAKER: ${sharedMaker.makerSize} ${cheapSide} @ $${sharedMaker.makerPrice.toFixed(2)}`);
    console.log(`[PairTracker]    TARGET CPP: $${(expensiveAsk + sharedMaker.makerPrice).toFixed(2)}`);
    console.log(`[PairTracker] ════════════════════════════════════════════════════\n`);
    
    if (config.dryRun) {
      console.log(`[PairTracker] [DRY RUN] Would open taker`);
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
      makerPrice: sharedMaker.makerPrice,
      makerSize: size,
      makerOrderId: sharedMaker.makerOrderId,
      
      status: 'PENDING_ENTRY',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      targetCpp: expensiveAsk + sharedMaker.makerPrice,
    };
    
    this.pairs.set(pairId, pair);
    
    // Get token ID
    const takerTokenId = expensiveSide === 'UP' ? market.upTokenId : market.downTokenId;
    
    // =========================================================================
    // PLACE TAKER (FOK)
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
      pair.status = 'WAITING_HEDGE';
      pair.updatedAt = Date.now();
      
      // Add to shared maker's takers list
      sharedMaker.takers.push({
        id: pairId,
        takerOrderId: takerResult.orderId,
        takerSide: expensiveSide,
        takerPrice: filledPrice,
        takerSize: filledSize,
        takerFilledAt: Date.now(),
        createdAt: Date.now(),
      });
      sharedMaker.totalTakerShares += filledSize;
      sharedMaker.updatedAt = Date.now();
      
      console.log(`[PairTracker] ✅ TAKER FILLED: ${filledSize} @ $${filledPrice.toFixed(3)}`);
      console.log(`[PairTracker]    Total takers: ${sharedMaker.takers.length}, Total shares: ${sharedMaker.totalTakerShares}`);
      
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
      
      console.log(`\n[PairTracker] ════════════════════════════════════════════════════`);
      console.log(`[PairTracker] ✅ TAKER OPENED: ${pairId}`);
      console.log(`[PairTracker]    TAKER: ${filledSize} ${expensiveSide} @ $${filledPrice.toFixed(3)} ✓`);
      console.log(`[PairTracker]    SHARED MAKER: ${sharedMaker.makerSize} ${cheapSide} @ $${sharedMaker.makerPrice.toFixed(3)}`);
      console.log(`[PairTracker]    PROJECTED CPP: $${(filledPrice + sharedMaker.makerPrice).toFixed(3)}`);
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
        makerPrice: sharedMaker.makerPrice,
        makerSize: filledSize,
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
  // BACKWARD COMPATIBLE: openPair delegates to openTaker
  // ============================================================
  
  async openPair(
    market: V35Market,
    expensiveSide: V35Side,
    size: number
  ): Promise<{ success: boolean; pairId?: string; error?: string }> {
    // First ensure we have a shared maker
    const cheapSide: V35Side = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    if (this.needsSharedMaker(market.slug)) {
      const makerResult = await this.placeSharedMaker(market, cheapSide);
      if (!makerResult.success) {
        return { success: false, error: `shared_maker_failed: ${makerResult.error}` };
      }
    }
    
    // Then open taker
    return this.openTaker(market, expensiveSide, size);
  }
  
  // ============================================================
  // FILL HANDLING
  // ============================================================
  
  /**
   * Handle a fill from WebSocket
   * Marks pairs as HEDGED when maker fills
   */
  onFill(fill: V35Fill): void {
    // Check if this is a maker fill for any shared maker
    for (const [marketSlug, sharedMaker] of this.sharedMakers) {
      if (sharedMaker.makerOrderId === fill.orderId && sharedMaker.status === 'ACTIVE') {
        // Maker filled!
        sharedMaker.makerFilledSize += fill.size;
        sharedMaker.updatedAt = Date.now();
        
        console.log(`[PairTracker] 📥 MAKER FILL: ${fill.size} ${sharedMaker.makerSide} @ $${fill.price.toFixed(3)}`);
        console.log(`[PairTracker]    Total maker filled: ${sharedMaker.makerFilledSize}/${sharedMaker.makerSize}`);
        
        // Save maker fill
        saveV35Fill({
          orderId: fill.orderId,
          tokenId: fill.tokenId,
          side: sharedMaker.makerSide,
          price: fill.price,
          size: fill.size,
          timestamp: new Date(),
          marketSlug: sharedMaker.marketSlug,
          asset: sharedMaker.asset,
          fillType: 'MAKER',
        }).catch(err => console.error('[PairTracker] Failed to save maker fill:', err));
        
        // Update pairs that are waiting for this hedge
        this.updatePairsWithMakerFill(marketSlug, fill);
        
        // Check if maker is fully filled
        if (sharedMaker.makerFilledSize >= sharedMaker.makerSize) {
          sharedMaker.status = 'FILLED';
          console.log(`[PairTracker] ✅ Shared maker fully filled`);
        }
        
        return;
      }
    }
    
    // Legacy: check individual pairs
    const pair = Array.from(this.pairs.values()).find(p => 
      p.makerOrderId === fill.orderId && p.status === 'WAITING_HEDGE'
    );
    
    if (!pair) return;
    
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
    pair.pnl = pairedShares - totalCost;
    
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
  
  /**
   * Update pairs when shared maker gets filled
   */
  private updatePairsWithMakerFill(marketSlug: string, fill: V35Fill): void {
    const sharedMaker = this.sharedMakers.get(marketSlug);
    if (!sharedMaker) return;
    
    // Find all waiting pairs for this market
    const waitingPairs = Array.from(this.pairs.values()).filter(p => 
      p.marketSlug === marketSlug && 
      p.status === 'WAITING_HEDGE' &&
      p.makerOrderId === fill.orderId
    );
    
    // Distribute filled shares among waiting pairs (FIFO)
    let remainingFillSize = fill.size;
    
    for (const pair of waitingPairs) {
      if (remainingFillSize <= 0) break;
      
      const neededSize = (pair.takerFilledSize || 0) - (pair.makerFilledSize || 0);
      if (neededSize <= 0) continue;
      
      const fillForPair = Math.min(neededSize, remainingFillSize);
      pair.makerFilledAt = Date.now();
      pair.makerFilledPrice = fill.price;
      pair.makerFilledSize = (pair.makerFilledSize || 0) + fillForPair;
      remainingFillSize -= fillForPair;
      
      // Calculate P&L
      const takerCost = (pair.takerFilledPrice || 0) * (pair.takerFilledSize || 0);
      const makerCost = (pair.makerFilledPrice || 0) * pair.makerFilledSize;
      const totalCost = takerCost + makerCost;
      const pairedShares = Math.min(pair.takerFilledSize || 0, pair.makerFilledSize);
      
      pair.actualCpp = totalCost / pairedShares;
      pair.pnl = pairedShares - totalCost;
      
      // Check if fully hedged
      if (pair.makerFilledSize >= (pair.takerFilledSize || 0)) {
        pair.status = 'HEDGED';
        pair.updatedAt = Date.now();
        
        console.log(`[PairTracker] ✅ ${pair.id} HEDGED via shared maker | CPP: $${pair.actualCpp?.toFixed(3)}`);
        
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
    
    // Also reset shared maker
    const sharedMaker = this.sharedMakers.get(marketSlug);
    if (sharedMaker) {
      sharedMaker.status = 'EXPIRED';
      this.sharedMakers.delete(marketSlug);
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
    
    // Cancel shared maker
    const sharedMaker = this.sharedMakers.get(marketSlug);
    if (sharedMaker && sharedMaker.makerOrderId && sharedMaker.status === 'ACTIVE') {
      try {
        await cancelOrder(sharedMaker.makerOrderId);
        sharedMaker.status = 'CANCELLED';
        cancelled++;
      } catch (err) {
        console.error(`[PairTracker] Failed to cancel shared maker:`, err);
      }
    }
    
    // Cancel individual pairs
    const waitingPairs = this.getMarketPairs(marketSlug)
      .filter(p => p.status === 'WAITING_HEDGE' && p.makerOrderId);
    
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
   * Get summary stats for a market
   */
  getMarketSummary(marketSlug: string): {
    waiting: number;
    hedged: number;
    totalTakerShares: number;
    totalMakerShares: number;
    sharedMakerStatus?: string;
  } {
    const pairs = this.getMarketPairs(marketSlug);
    const sharedMaker = this.sharedMakers.get(marketSlug);
    
    return {
      waiting: pairs.filter(p => p.status === 'WAITING_HEDGE').length,
      hedged: pairs.filter(p => p.status === 'HEDGED').length,
      totalTakerShares: pairs.reduce((sum, p) => sum + (p.takerFilledSize || 0), 0),
      totalMakerShares: sharedMaker?.makerFilledSize || pairs.reduce((sum, p) => sum + (p.makerFilledSize || 0), 0),
      sharedMakerStatus: sharedMaker?.status,
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
    activeSharedMakers: number;
  } {
    const allPairs = this.getAllPairs();
    const waiting = allPairs.filter(p => p.status === 'WAITING_HEDGE');
    const hedged = allPairs.filter(p => p.status === 'HEDGED');
    const activeSharedMakers = Array.from(this.sharedMakers.values()).filter(m => m.status === 'ACTIVE').length;
    
    return {
      totalPairs: allPairs.length,
      waitingPairs: waiting.length,
      hedgedPairs: hedged.length,
      totalTakerShares: allPairs.reduce((sum, p) => sum + (p.takerFilledSize || 0), 0),
      totalMakerShares: allPairs.reduce((sum, p) => sum + (p.makerFilledSize || 0), 0),
      totalPnl: hedged.reduce((sum, p) => sum + (p.pnl || 0), 0),
      activeSharedMakers,
    };
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
    
    // Also cleanup old shared makers
    for (const [marketSlug, sharedMaker] of this.sharedMakers) {
      if (
        (sharedMaker.status === 'FILLED' || sharedMaker.status === 'EXPIRED' || sharedMaker.status === 'CANCELLED') &&
        (now - sharedMaker.updatedAt) > CLEANUP_AGE_MS
      ) {
        this.sharedMakers.delete(marketSlug);
        console.log(`[PairTracker] 🧹 Cleaned up old shared maker: ${marketSlug.slice(-30)}`);
      }
    }
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
