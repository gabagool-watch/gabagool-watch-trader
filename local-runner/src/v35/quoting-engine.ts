// ============================================================
// V35 QUOTING ENGINE - GABAGOOL MODE
// ============================================================
// Version: V35.12.0 - "Directional Bias (Follow the Winner)"
//
// V35.12.0 CRITICAL CHANGES:
// ================================================================
// CORE INSIGHT: Gabagool ends with MORE shares in the WINNING direction.
// We were doing the opposite - accumulating cheap (losing) shares.
//
// NEW STRATEGY: FOLLOW THE MARKET
// 1. Expensive side (price > 0.50) = likely WINNER → quote AGGRESSIVELY
// 2. Cheap side (price < 0.50) = likely LOSER → quote CONSERVATIVELY
// 3. When spread > 15¢ → STOP quoting cheap side entirely
// 4. Size ratio: Quote 3x more shares on expensive side
//
// This ensures we accumulate the WINNING side, not the losing side.
// ================================================================
//
// V35.11.4 KEPT:
// - Hard 100-share cap per side
// - Effective exposure tracking
//
// CORE PRINCIPLE: Follow the winner, avoid the loser.
// ============================================================

import { getV35Config, V35_VERSION, type V35Config } from './config.js';
import type { V35Market, V35Quote, V35Side, V35Asset } from './types.js';
import { logV35GuardEvent } from './backend.js';
import { getV35SidePricing } from './market-pricing.js';
import { 
  checkCapWithEffectiveExposure, 
  getEffectiveExposure,
  EXPOSURE_CAP_CONFIG,
  type Side as LedgerSide 
} from '../exposure-ledger.js';

interface QuoteDecision {
  quotes: V35Quote[];
  blocked: boolean;
  blockReason: string | null;
}

// V35.11.4: HARD CAP - absolute maximum shares per side
const HARD_CAP_PER_SIDE = 100;

// V35.12.0: DIRECTIONAL BIAS CONFIGURATION
const DIRECTIONAL_CONFIG = {
  // Price thresholds
  expensiveThreshold: 0.50,     // Above this = likely winner
  cheapThreshold: 0.50,         // Below this = likely loser
  
  // Spread threshold to STOP quoting cheap side
  maxSpreadForCheapSide: 0.15,  // If spread > 15¢, stop quoting cheap side
  
  // Size multipliers
  expensiveSideMultiplier: 3.0, // Quote 3x more on expensive (winning) side
  cheapSideMultiplier: 0.5,     // Quote 0.5x on cheap (losing) side
  
  // Price limits for cheap side (don't buy likely losers at high prices)
  maxCheapSidePrice: 0.40,      // Don't quote cheap side above $0.40
};

// V35.10.0: Smart spread configuration
const SMART_SPREAD_CONFIG = {
  numLevels: 4,           // How many price levels to quote (4 levels = 20 shares at 5/level)
  levelStep: 0.01,        // Step between levels (1¢)
  minBidFromAsk: 0.002,   // Minimum distance from ask (0.2¢ anti-crossing margin)
};

export class QuotingEngine {
  private gridPrices: number[] = [];
  
  constructor() {
    this.updateGrid();
  }
  
  /**
   * Regenerate grid prices from current config
   * NOTE: V35.10.0 uses smart spread, but grid is kept for fallback
   */
  updateGrid(): void {
    const config = getV35Config();
    this.gridPrices = [];
    
    let price = config.gridMin;
    while (price <= config.gridMax + 0.001) {
      this.gridPrices.push(Math.round(price * 100) / 100);
      price += config.gridStep;
    }
    
    console.log(`[QuotingEngine] Grid updated: ${this.gridPrices.length} levels from $${config.gridMin} to $${config.gridMax}`);
  }
  
  /**
   * Generate quotes for one side of a market
   * V35.10.0: Uses SMART SPREAD placement near current bid
   */
  generateQuotes(side: V35Side, market: V35Market): V35Quote[] {
    const decision = this.generateQuotesWithReason(side, market);
    
    if (decision.blocked) {
      console.log(`[QuotingEngine] ⛔ ${side} blocked: ${decision.blockReason}`);
    }
    
    return decision.quotes;
  }
  
  /**
   * Generate quotes with detailed reasoning
   * V35.10.0: SMART SPREAD - quotes near current bid, not fixed grid
   */
  generateQuotesWithReason(side: V35Side, market: V35Market): QuoteDecision {
    const config = getV35Config();
    const quotes: V35Quote[] = [];
    
    const {
      expensiveSide,
      cheapSide,
      expensiveQty,
      cheapQty,
      upLivePrice,
      downLivePrice,
    } = getV35SidePricing(market);
    
    const currentQty = side === 'UP' ? market.upQty : market.downQty;
    const oppositeQty = side === 'UP' ? market.downQty : market.upQty;
    const imbalance = Math.abs(market.upQty - market.downQty);
    
    // =========================================================================
    // V36.4.0: ABSOLUTE EMERGENCY HALT - EXISTING POSITION OVER CAP
    // =========================================================================
    // If we ALREADY have more shares than the cap allows, HALT immediately.
    // This should never happen, but is a critical safety net.
    // =========================================================================
    const upSharesAlready = market.upQty;
    const downSharesAlready = market.downQty;
    
    if (upSharesAlready > HARD_CAP_PER_SIDE || downSharesAlready > HARD_CAP_PER_SIDE) {
      const reason = `🚨 EMERGENCY HALT: Position already exceeds cap! UP=${upSharesAlready.toFixed(0)} DOWN=${downSharesAlready.toFixed(0)} (max=${HARD_CAP_PER_SIDE})`;
      console.log(`[QuotingEngine] ${reason}`);
      
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'EMERGENCY_HALT_OVERCAP',
        blockedSide: side,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide,
        reason,
      }).catch(() => {});
      
      return { quotes: [], blocked: true, blockReason: reason };
    }
    
    // =========================================================================
    // V35.12.0: DIRECTIONAL BIAS - DETECT WINNER VS LOSER
    // =========================================================================
    const sidePrice = side === 'UP' ? upLivePrice : downLivePrice;
    const otherPrice = side === 'UP' ? downLivePrice : upLivePrice;
    const spread = Math.abs(sidePrice - otherPrice);
    const isExpensiveSide = side === expensiveSide;
    const isCheapSide = side === cheapSide;
    
    console.log(`[QuotingEngine] 🎯 DIRECTIONAL: ${side} price=$${sidePrice.toFixed(2)} isExpensive=${isExpensiveSide} spread=${(spread * 100).toFixed(1)}¢`);
    
    // =========================================================================
    // V35.12.0: CHEAP SIDE RESTRICTIONS (likely loser)
    // =========================================================================
    if (isCheapSide) {
      // Rule 1: Don't quote cheap side if spread is too wide (market has spoken)
      if (spread > DIRECTIONAL_CONFIG.maxSpreadForCheapSide) {
        const reason = `DIRECTIONAL: ${side} is CHEAP side, spread ${(spread * 100).toFixed(1)}¢ > ${(DIRECTIONAL_CONFIG.maxSpreadForCheapSide * 100).toFixed(0)}¢ max - SKIP`;
        console.log(`[QuotingEngine] 🚫 ${reason}`);
        
        logV35GuardEvent({
          marketSlug: market.slug,
          asset: market.asset,
          guardType: 'DIRECTIONAL_CHEAP_SKIP',
          blockedSide: side,
          upQty: market.upQty,
          downQty: market.downQty,
          expensiveSide,
          reason,
        }).catch(() => {});
        
        return { quotes: [], blocked: true, blockReason: reason };
      }
      
      // Rule 2: Don't buy cheap side at prices above threshold
      if (sidePrice > DIRECTIONAL_CONFIG.maxCheapSidePrice) {
        const reason = `DIRECTIONAL: ${side} price $${sidePrice.toFixed(2)} > $${DIRECTIONAL_CONFIG.maxCheapSidePrice.toFixed(2)} max for cheap side - SKIP`;
        console.log(`[QuotingEngine] 🚫 ${reason}`);
        
        logV35GuardEvent({
          marketSlug: market.slug,
          asset: market.asset,
          guardType: 'DIRECTIONAL_PRICE_SKIP',
          blockedSide: side,
          upQty: market.upQty,
          downQty: market.downQty,
          expensiveSide,
          reason,
        }).catch(() => {});
        
        return { quotes: [], blocked: true, blockReason: reason };
      }
    }
    
    // =========================================================================
    // V36.4.0: HARD 100-SHARE CAP CHECK - DUAL VERIFICATION
    // =========================================================================
    // Check BOTH the exposure ledger AND the actual market inventory.
    // This double-check prevents catastrophic breaches when ledger drifts from reality.
    // =========================================================================
    
    // Check 1: Exposure ledger (includes pending/open orders)
    const ledgerSide: LedgerSide = side === 'UP' ? 'UP' : 'DOWN';
    const exposure = getEffectiveExposure(market.conditionId, market.asset);
    const ledgerEffective = side === 'UP' ? exposure.effectiveUp : exposure.effectiveDown;
    
    // Check 2: ACTUAL market inventory (ground truth from Polymarket sync)
    const actualShares = side === 'UP' ? market.upQty : market.downQty;
    
    // Use the HIGHER of the two as effective shares (most conservative)
    const effectiveShares = Math.max(ledgerEffective, actualShares);
    const remainingCap = HARD_CAP_PER_SIDE - effectiveShares;
    
    // V36.4.0: EMERGENCY LOGGING when there's a large discrepancy
    const discrepancy = Math.abs(ledgerEffective - actualShares);
    if (discrepancy > 10) {
      console.log(`🚨 [QuotingEngine] LEDGER DRIFT DETECTED: ledger=${ledgerEffective.toFixed(0)} actual=${actualShares.toFixed(0)} discrepancy=${discrepancy.toFixed(0)}`);
    }
    
    console.log(`[QuotingEngine] 🔒 HARD-CAP CHECK: ${side} ledger=${ledgerEffective.toFixed(0)} actual=${actualShares.toFixed(0)} effective=${effectiveShares.toFixed(0)}/${HARD_CAP_PER_SIDE} remaining=${remainingCap.toFixed(0)}`);
    
    if (remainingCap <= 0) {
      const reason = `HARD-CAP: ${side} at ${effectiveShares.toFixed(0)}/${HARD_CAP_PER_SIDE} shares (ledger=${ledgerEffective.toFixed(0)} actual=${actualShares.toFixed(0)}) - NO MORE ORDERS`;
      console.log(`[QuotingEngine] 🚫 ${reason}`);
      
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'HARD_CAP_BLOCK',
        blockedSide: side,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide,
        reason,
      }).catch(() => {});
      
      return { quotes: [], blocked: true, blockReason: reason };
    }
    
    // =========================================================================
    // V35.11.3: STRICT BALANCE-FIRST LOGIC
    // =========================================================================
    const isBalanced = imbalance < 5;
    const trailingSide = market.upQty < market.downQty ? 'UP' : 'DOWN';
    const leadingSide = market.upQty > market.downQty ? 'UP' : 'DOWN';
    const isTrailing = !isBalanced && side === trailingSide;
    const isLeading = !isBalanced && side === leadingSide;
    
    // =========================================================================
    // V35.11.3: IMMEDIATE BLOCK ON LEADING SIDE (threshold: 5 shares)
    // =========================================================================
    const LEADING_BLOCK_THRESHOLD = 5;
    if (isLeading && imbalance >= LEADING_BLOCK_THRESHOLD) {
      const reason = `LEADING-BLOCK: ${side} leads by ${imbalance.toFixed(0)} shares (threshold: ${LEADING_BLOCK_THRESHOLD})`;
      console.log(`[QuotingEngine] 🛑 ${reason}`);
      
      logV35GuardEvent({
        marketSlug: market.slug,
        asset: market.asset,
        guardType: 'LEADING_BLOCK',
        blockedSide: side,
        upQty: market.upQty,
        downQty: market.downQty,
        expensiveSide,
        reason,
      }).catch(() => {});
      
      return { quotes: [], blocked: true, blockReason: reason };
    }
    
    // =========================================================================
    // EMERGENCY STOP AT EXTREME IMBALANCE (for both sides as safety net)
    // =========================================================================
    if (imbalance >= config.maxUnpairedShares) {
      // Only allow trailing side to quote (rebalancer will handle it)
      if (!isTrailing) {
        const reason = `EMERGENCY: ${imbalance.toFixed(0)} share imbalance >= ${config.maxUnpairedShares} max`;
        console.log(`[QuotingEngine] 🚨 ${reason} - blocking ${side}`);
        
        logV35GuardEvent({
          marketSlug: market.slug,
          asset: market.asset,
          guardType: 'EMERGENCY_STOP',
          blockedSide: side,
          upQty: market.upQty,
          downQty: market.downQty,
          expensiveSide,
          reason,
        }).catch(() => {});
        
        return { quotes: [], blocked: true, blockReason: reason };
      }
      console.log(`[QuotingEngine] 🚨 EMERGENCY but ${side} is TRAILING - allowing limited quotes`);
    }
    
    // =========================================================================
    // BURST-CAP CALCULATION
    // =========================================================================
    const existingOpenOrders = side === 'UP' ? market.upOrders : market.downOrders;
    let existingOpenQty = 0;
    for (const order of existingOpenOrders.values()) {
      existingOpenQty += order.size;
    }
    
    let maxNewOrderQty: number;
    
    if (isBalanced) {
      maxNewOrderQty = config.maxUnpairedShares - existingOpenQty;
      console.log(`[QuotingEngine] ⚖️ BALANCED: ${side} gets full budget ${maxNewOrderQty.toFixed(0)}`);
    } else if (currentQty > oppositeQty) {
      maxNewOrderQty = config.maxUnpairedShares - imbalance - existingOpenQty;
    } else {
      maxNewOrderQty = config.maxUnpairedShares + imbalance - existingOpenQty;
    }
    
    maxNewOrderQty = Math.max(0, maxNewOrderQty);
    
    console.log(`[QuotingEngine] 📊 BURST-CAP: ${side} budget=${maxNewOrderQty.toFixed(0)} (existing=${existingOpenQty.toFixed(0)}, imbalance=${imbalance.toFixed(0)})`);
    
    // =========================================================================
    // V35.11.3: STRICT BURST-CAP - NO MORE TRAILING OVERRIDE
    // =========================================================================
    // REMOVED: The "trailing override" was causing runaway imbalances!
    // It gave the trailing side too much budget, which then became leading,
    // which gave the OTHER side budget, causing an infinite feedback loop.
    //
    // NEW APPROACH: Let the REBALANCER handle catching up, not the quoting engine.
    // The quoting engine should ONLY quote when there's genuine budget available.
    // =========================================================================
    if (maxNewOrderQty < config.sharesPerLevel) {
      if (isBalanced) {
        // Only in balanced state, give both sides a small equal budget
        maxNewOrderQty = config.sharesPerLevel;  // V35.11.3: Reduced from numLevels * sharesPerLevel
        console.log(`[QuotingEngine] ⚖️ BALANCED: ${side} gets ${maxNewOrderQty.toFixed(0)} shares`);
      } else {
        // V35.11.3: NO TRAILING OVERRIDE! Budget exhausted = stop quoting.
        const reason = `BURST-CAP: ${side} budget exhausted (${maxNewOrderQty.toFixed(0)} < ${config.sharesPerLevel} min)`;
        console.log(`[QuotingEngine] 🛡️ ${reason}`);
        
        logV35GuardEvent({
          marketSlug: market.slug,
          asset: market.asset,
          guardType: 'BURST_CAP',
          blockedSide: side,
          upQty: market.upQty,
          downQty: market.downQty,
          expensiveSide,
          reason,
        }).catch(() => {});
        
        return { quotes: [], blocked: true, blockReason: reason };
      }
    }
    
    // =========================================================================
    // V35.10.0: SMART SPREAD QUOTE GENERATION
    // =========================================================================
    // Instead of fixed grid, place orders NEAR the current best bid
    // This keeps us competitive and increases fill probability
    // =========================================================================
    
    const bestBid = side === 'UP' ? market.upBestBid : market.downBestBid;
    const bestAsk = side === 'UP' ? market.upBestAsk : market.downBestAsk;
    
    // If no market data, fall back to mid-range prices
    const fallbackPrice = 0.50;
    const startingBid = bestBid > 0 ? bestBid : fallbackPrice;
    
    let totalQuotedQty = 0;
    
    // V35.11.4: Apply HARD CAP as additional constraint
    const effectiveBudget = Math.min(maxNewOrderQty, remainingCap);
    console.log(`[QuotingEngine] 📊 EFFECTIVE BUDGET: min(burstCap=${maxNewOrderQty.toFixed(0)}, hardCap=${remainingCap.toFixed(0)}) = ${effectiveBudget.toFixed(0)}`);
    
    for (let level = 0; level < SMART_SPREAD_CONFIG.numLevels; level++) {
      // Calculate price for this level (starting at best bid, stepping down)
      const levelPrice = Math.round((startingBid - (level * SMART_SPREAD_CONFIG.levelStep)) * 100) / 100;
      
      // Skip if price is too low or too high
      if (levelPrice < config.gridMin || levelPrice > config.gridMax) {
        continue;
      }
      
      // Anti-crossing check: don't bid too close to ask
      if (bestAsk > 0 && levelPrice >= bestAsk - SMART_SPREAD_CONFIG.minBidFromAsk) {
        console.log(`[QuotingEngine] ⚠️ Level ${level} ($${levelPrice.toFixed(2)}) too close to ask ($${bestAsk.toFixed(2)}), skipping`);
        continue;
      }
      
      // Calculate shares for this level
      const minSharesForNotional = Math.ceil(1.0 / levelPrice);
      let shares = Math.max(config.sharesPerLevel, minSharesForNotional);
      
      // =========================================================================
      // V35.12.0: DIRECTIONAL SIZE ADJUSTMENT
      // =========================================================================
      // Quote MORE on expensive (winning) side, LESS on cheap (losing) side
      // =========================================================================
      if (isExpensiveSide) {
        shares = Math.round(shares * DIRECTIONAL_CONFIG.expensiveSideMultiplier);
        console.log(`[QuotingEngine] 🎯 EXPENSIVE SIDE BOOST: ${side} shares=${shares} (3x)`);
      } else if (isCheapSide) {
        shares = Math.max(3, Math.round(shares * DIRECTIONAL_CONFIG.cheapSideMultiplier));
        console.log(`[QuotingEngine] ⚠️ CHEAP SIDE REDUCED: ${side} shares=${shares} (0.5x)`);
      }
      
      // V35.11.4: Check against EFFECTIVE BUDGET (includes hard cap)
      if (totalQuotedQty + shares > effectiveBudget) {
        const clampedShares = Math.floor(effectiveBudget - totalQuotedQty);
        if (clampedShares >= 3) {  // Minimum 3 shares for Polymarket
          quotes.push({ price: levelPrice, size: clampedShares });
          totalQuotedQty += clampedShares;
          console.log(`[QuotingEngine] 🔒 HARD-CAP: Clamped to ${clampedShares} shares at $${levelPrice.toFixed(2)}`);
        }
        console.log(`[QuotingEngine] 🔒 BUDGET EXHAUSTED at ${totalQuotedQty.toFixed(0)}/${effectiveBudget.toFixed(0)} shares`);
        break;
      }
      
      quotes.push({ price: levelPrice, size: shares });
      totalQuotedQty += shares;
    }
    
    if (quotes.length > 0) {
      const priceRange = quotes.length > 1 
        ? `$${quotes[quotes.length - 1].price.toFixed(2)}-$${quotes[0].price.toFixed(2)}`
        : `$${quotes[0].price.toFixed(2)}`;
      console.log(`[QuotingEngine] ✅ Generated ${quotes.length} ${side} quotes @ ${priceRange}, total=${totalQuotedQty.toFixed(0)} shares (bid=$${startingBid.toFixed(2)})`);
    }
    
    return {
      quotes,
      blocked: false,
      blockReason: null,
    };
  }
  
  /**
   * Calculate unrealized P&L for loss limit check
   */
  private calculateUnrealizedPnL(market: V35Market): number {
    const upValue = market.upQty * (market.upBestBid || 0);
    const downValue = market.downQty * (market.downBestBid || 0);
    const currentValue = upValue + downValue;
    const totalCost = market.upCost + market.downCost;
    return currentValue - totalCost;
  }
  
  /**
   * Calculate locked profit (guaranteed at settlement)
   */
  calculateLockedProfit(market: V35Market): { 
    pairedShares: number; 
    combinedCost: number; 
    lockedProfit: number;
    profitPct: number;
  } {
    const pairedShares = Math.min(market.upQty, market.downQty);
    
    if (pairedShares === 0) {
      return { pairedShares: 0, combinedCost: 0, lockedProfit: 0, profitPct: 0 };
    }
    
    const avgUpCost = market.upCost / market.upQty;
    const avgDownCost = market.downCost / market.downQty;
    const combinedCost = avgUpCost + avgDownCost;
    
    const lockedProfit = pairedShares * (1 - combinedCost);
    const profitPct = (1 - combinedCost) * 100;
    
    return { pairedShares, combinedCost, lockedProfit, profitPct };
  }
  
  /**
   * Check if a market should be actively quoted at all
   */
  shouldQuoteMarket(market: V35Market): { shouldQuote: boolean; reason: string } {
    const config = getV35Config();
    
    const pnl = this.calculateUnrealizedPnL(market);
    if (pnl < -config.maxLossPerMarket) {
      return { shouldQuote: false, reason: `Loss limit triggered: $${pnl.toFixed(2)}` };
    }
    
    if (!config.enabledAssets.includes(market.asset)) {
      return { shouldQuote: false, reason: `Asset ${market.asset} not in enabled list` };
    }
    
    return { shouldQuote: true, reason: 'OK' };
  }
  
  /**
   * Get market status summary for logging
   */
  getMarketStatus(market: V35Market): string {
    const { pairedShares, combinedCost, lockedProfit, profitPct } = this.calculateLockedProfit(market);
    const skew = market.upQty - market.downQty;
    const unpaired = Math.abs(skew);
    
    return `UP:${market.upQty.toFixed(0)} DOWN:${market.downQty.toFixed(0)} | ` +
           `Paired:${pairedShares.toFixed(0)} Unpaired:${unpaired.toFixed(0)} | ` +
           `Combined:$${combinedCost.toFixed(4)} | ` +
           `Locked:$${lockedProfit.toFixed(2)} (${profitPct.toFixed(2)}%)`;
  }
  
  /**
   * Get the current grid prices (for fallback)
   */
  getGridPrices(): number[] {
    return [...this.gridPrices];
  }
}
