// ============================================================
// V36 REVERSAL DETECTOR - BINANCE-BASED STOP-LOSS
// ============================================================
// Version: V36.2.0 - "$30 Binance Trigger"
//
// CORE CONCEPT:
// Binance price feed LEADS Polymarket by a few seconds.
// When Binance shows a significant adverse move:
// 1. The "expensive" side is about to become cheap (winner → loser)
// 2. We need to EMERGENCY HEDGE before the Polymarket price updates
// 3. This prevents holding an unhedged losing position
//
// V36.2 TRIGGER CONDITIONS:
// - Binance moves $30+ in the WRONG direction in 1-2 seconds
// - We have pending pairs waiting for maker fill
// - The maker order hasn't filled yet
//
// ACTION:
// - Cancel the passive maker order
// - Place TAKER order at current ask to close position
// - Accept small loss (~2-5%) instead of full loss (50-100%)
// ============================================================

import { getBinanceFeed, type V35Asset } from './binance-feed.js';
import { getPairTracker, type PendingPair } from './pair-tracker.js';
import type { V35Market, V35Side } from './types.js';
import { logV35GuardEvent } from './backend.js';

// ============================================================
// CONFIGURATION
// ============================================================

export interface ReversalDetectorConfig {
  // V36.2: Dollar threshold for detecting reversals (absolute USD)
  reversalThresholdUsd: number;      // e.g., 30 = $30
  
  // Time window to detect the reversal (ms)
  reversalWindowMs: number;          // e.g., 2000 = 2 seconds
  
  // How often to check for reversals (ms)
  checkIntervalMs: number;
  
  // Cooldown after triggering emergency (ms)
  cooldownAfterEmergencyMs: number;
}

const DEFAULT_CONFIG: ReversalDetectorConfig = {
  reversalThresholdUsd: 30,          // $30 move triggers emergency
  reversalWindowMs: 2000,            // Within 1-2 seconds
  checkIntervalMs: 100,              // Check every 100ms for fast detection
  cooldownAfterEmergencyMs: 5000,
};

// ============================================================
// REVERSAL DETECTOR CLASS
// ============================================================

export class ReversalDetector {
  private config: ReversalDetectorConfig;
  private lastCheckMs = 0;
  private lastEmergencyMs = 0;
  // V36.2: Track price history for $30 detection
  private priceHistory: Map<V35Asset, { price: number; ts: number }[]> = new Map();
  
  // V36.6: Track active reversals per market for capacity boost
  private activeReversals: Map<string, { detectedAt: number; asset: V35Asset }> = new Map();
  private reversalActiveWindowMs = 30_000; // Reversal stays "active" for 30s
  
  constructor(config: Partial<ReversalDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Check for reversals and trigger emergency hedges if needed
   */
  async checkForReversals(market: V35Market): Promise<{
    reversalDetected: boolean;
    emergencyTriggered: boolean;
    reason?: string;
  }> {
    const now = Date.now();
    
    // Rate limit checks
    if (now - this.lastCheckMs < this.config.checkIntervalMs) {
      return { reversalDetected: false, emergencyTriggered: false };
    }
    this.lastCheckMs = now;
    
    // Cooldown after emergency
    if (now - this.lastEmergencyMs < this.config.cooldownAfterEmergencyMs) {
      return { reversalDetected: false, emergencyTriggered: false, reason: 'emergency_cooldown' };
    }
    
    // Get Binance feed
    const binance = getBinanceFeed();
    if (!binance.isHealthy()) {
      return { reversalDetected: false, emergencyTriggered: false, reason: 'binance_unhealthy' };
    }
    
    // V36.2: Get current price and update history
    const currentPrice = binance.getPrice(market.asset);
    if (!currentPrice) {
      return { reversalDetected: false, emergencyTriggered: false, reason: 'no_binance_price' };
    }
    
    // Update price history
    const history = this.priceHistory.get(market.asset) || [];
    history.push({ price: currentPrice, ts: now });
    
    // Keep only last 5 seconds of history
    const cutoff = now - 5000;
    const filteredHistory = history.filter(h => h.ts > cutoff);
    this.priceHistory.set(market.asset, filteredHistory);
    
    // Get pair tracker
    const pairTracker = getPairTracker();
    const activePairs = pairTracker.getMarketPairs(market.slug)
      .filter(p => p.status === 'WAITING_HEDGE');
    
    if (activePairs.length === 0) {
      return { reversalDetected: false, emergencyTriggered: false, reason: 'no_pending_pairs' };
    }
    
    // Check each pending pair for reversal risk
    for (const pair of activePairs) {
      const reversalResult = await this.checkPairReversal(pair, market, currentPrice, filteredHistory);
      
      if (reversalResult.emergencyTriggered) {
        this.lastEmergencyMs = now;
        return reversalResult;
      }
    }
    
    return { reversalDetected: false, emergencyTriggered: false };
  }
  
  /**
   * Check if a specific pair needs emergency hedging
   * V36.2: Check for $30 move in 1-2 seconds
   */
  private async checkPairReversal(
    pair: PendingPair,
    market: V35Market,
    currentPrice: number,
    priceHistory: { price: number; ts: number }[]
  ): Promise<{
    reversalDetected: boolean;
    emergencyTriggered: boolean;
    reason?: string;
  }> {
    const now = Date.now();
    
    // Find prices from 1-2 seconds ago
    const windowStart = now - this.config.reversalWindowMs;
    const oldPrices = priceHistory.filter(h => h.ts >= windowStart - 500 && h.ts <= windowStart + 500);
    
    if (oldPrices.length === 0) {
      return { reversalDetected: false, emergencyTriggered: false, reason: 'no_history' };
    }
    
    // Get the oldest price in our window
    const oldestPrice = oldPrices[0].price;
    const priceChange = currentPrice - oldestPrice;
    const absPriceChange = Math.abs(priceChange);
    
    // Determine which direction is BAD for our position
    // If we bought the expensive side (e.g., UP), a price DROP is bad (DOWN wins)
    // If we bought the expensive side (e.g., DOWN), a price RISE is bad (UP wins)
    const isBadMove = (pair.takerSide === 'UP' && priceChange < 0) || 
                      (pair.takerSide === 'DOWN' && priceChange > 0);
    
    // V36.2: Check if move exceeds $30 threshold AND is in bad direction
    const isReversal = isBadMove && absPriceChange >= this.config.reversalThresholdUsd;
    
    if (!isReversal) {
      return { reversalDetected: false, emergencyTriggered: false };
    }
    
    const direction = priceChange > 0 ? 'UP' : 'DOWN';
    console.log(`[ReversalDetector] 🚨 $${absPriceChange.toFixed(0)} REVERSAL DETECTED for ${pair.id}!`);
    console.log(`[ReversalDetector]    Binance: $${oldestPrice.toFixed(0)} → $${currentPrice.toFixed(0)} (${direction} $${absPriceChange.toFixed(0)} in ${this.config.reversalWindowMs}ms)`);
    console.log(`[ReversalDetector]    Our position: ${pair.takerSide} is now at risk!`);
    
    // V36.6: Mark reversal as active for this market (enables extra pair capacity)
    this.activeReversals.set(market.slug, { detectedAt: now, asset: market.asset });
    console.log(`[ReversalDetector] 🔓 V36.6: Reversal active for ${market.slug} - extra pair capacity enabled for 30s`);
    
    // Log the event
    logV35GuardEvent({
      marketSlug: market.slug,
      asset: market.asset,
      guardType: 'REVERSAL_DETECTED',
      blockedSide: pair.takerSide,
      upQty: market.upQty,
      downQty: market.downQty,
      expensiveSide: pair.takerSide,
      reason: `Binance $${absPriceChange.toFixed(0)} reversal: ${direction} in ${this.config.reversalWindowMs}ms`,
    }).catch(() => {});
    
    // Get current ask for emergency hedge
    const currentAsk = pair.makerSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    
    // Trigger emergency hedge
    const pairTracker = getPairTracker();
    const result = await pairTracker.triggerEmergencyHedge(pair, market, currentAsk);
    
    if (result.success) {
      console.log(`[ReversalDetector] ✅ Emergency hedge triggered for ${pair.id}`);
      return { reversalDetected: true, emergencyTriggered: true };
    } else {
      console.log(`[ReversalDetector] ⚠️ Emergency hedge failed: ${result.error}`);
      return { reversalDetected: true, emergencyTriggered: false, reason: result.error };
    }
  }
  
  /**
   * V36.6: Check if any reversal is currently active (for extra pair capacity)
   * A reversal stays "active" for 30 seconds after detection.
   */
  isReversalActive(): boolean {
    const now = Date.now();
    
    // Clean up expired reversals
    for (const [slug, info] of this.activeReversals.entries()) {
      if (now - info.detectedAt > this.reversalActiveWindowMs) {
        this.activeReversals.delete(slug);
        console.log(`[ReversalDetector] 🔒 V36.6: Reversal expired for ${slug} - returning to normal capacity`);
      }
    }
    
    return this.activeReversals.size > 0;
  }
  
  /**
   * V36.6: Get count of active reversals
   */
  getActiveReversalCount(): number {
    // Trigger cleanup via isReversalActive
    this.isReversalActive();
    return this.activeReversals.size;
  }
  
  /**
   * Get status summary
   */
  getStatus(): {
    lastCheckMs: number;
    lastEmergencyMs: number;
    priceHistorySize: Record<string, number>;
    activeReversals: number;
  } {
    const priceHistorySize: Record<string, number> = {};
    
    for (const [asset, history] of this.priceHistory.entries()) {
      priceHistorySize[asset] = history.length;
    }
    
    return {
      lastCheckMs: this.lastCheckMs,
      lastEmergencyMs: this.lastEmergencyMs,
      priceHistorySize,
      activeReversals: this.getActiveReversalCount(),
    };
  }
  
  /**
   * Configure thresholds
   */
  configure(config: Partial<ReversalDetectorConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * Reset state
   */
  reset(): void {
    this.lastCheckMs = 0;
    this.lastEmergencyMs = 0;
    this.priceHistory.clear();
    this.activeReversals.clear();
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

let detectorInstance: ReversalDetector | null = null;

export function getReversalDetector(): ReversalDetector {
  if (!detectorInstance) {
    detectorInstance = new ReversalDetector();
  }
  return detectorInstance;
}

export function resetReversalDetector(): void {
  if (detectorInstance) {
    detectorInstance.reset();
  }
  detectorInstance = null;
}
