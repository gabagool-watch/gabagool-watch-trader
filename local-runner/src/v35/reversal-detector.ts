// ============================================================
// V36 REVERSAL DETECTOR - TWO-STAGE DETECTION
// ============================================================
// Version: V36.9.0 - "Binance Signal + Share Price Trigger"
//
// V36.9.0 REDESIGN:
// ================================================================
// Previous: Binance $30 move = immediate emergency hedge trigger
// Problem: Binance move doesn't always correlate to share price impact
//
// NEW TWO-STAGE APPROACH:
// STAGE 1: BINANCE SIGNAL → ALERT MODE
//   - Binance moves $30+ against our position
//   - No action yet, just heightened awareness
//   - Alert mode lasts 30 seconds
//
// STAGE 2: SHARE PRICE REVERSAL → TRIGGER
//   - Monitor Polymarket share prices while in alert mode
//   - Trigger when expensive side crosses toward 50c (delta → 0)
//   - This confirms the reversal actually impacted our position
//
// ACTIONS ON CONFIRMED REVERSAL:
//   - +3 extra pair capacity (already in V36.6)
//   - Immediately capitalize on new expensive side
//   - Emergency hedge existing pairs if CPP allows
// ================================================================

import { getBinanceFeed, type V35Asset } from './binance-feed.js';
import { getPairTracker, type PendingPair } from './pair-tracker.js';
import type { V35Market, V35Side } from './types.js';
import { logV35GuardEvent } from './backend.js';

// ============================================================
// CONFIGURATION
// ============================================================

export interface ReversalDetectorConfig {
  // Stage 1: Binance signal threshold (absolute USD)
  binanceSignalThresholdUsd: number;    // e.g., 30 = $30 move triggers ALERT
  
  // Time window to detect Binance signal (ms)
  binanceWindowMs: number;               // e.g., 2000 = 2 seconds
  
  // Stage 2: Share price reversal threshold
  shareReversalThresholdCents: number;   // e.g., 15 = expensive side drops 15c
  deltaFlipThreshold: number;            // e.g., 0.52 = trigger when price nears 50c
  
  // How often to check (ms)
  checkIntervalMs: number;
  
  // How long alert mode stays active (ms)
  alertModeDurationMs: number;
  
  // Cooldown after triggering reversal action (ms)
  cooldownAfterReversalMs: number;
}

const DEFAULT_CONFIG: ReversalDetectorConfig = {
  binanceSignalThresholdUsd: 30,         // $30 Binance move = ALERT
  binanceWindowMs: 2000,                  // Within 2 seconds
  shareReversalThresholdCents: 15,        // 15c drop on expensive side
  deltaFlipThreshold: 0.52,               // When expensive side drops below 52c
  checkIntervalMs: 100,                   // Check every 100ms
  alertModeDurationMs: 30_000,            // Alert mode lasts 30 seconds
  cooldownAfterReversalMs: 5000,
};

// ============================================================
// ALERT STATE
// ============================================================

interface AlertState {
  activatedAt: number;
  asset: V35Asset;
  marketSlug: string;
  binancePriceAtAlert: number;
  binanceDirection: 'UP' | 'DOWN';        // Direction Binance moved
  expensiveSideAtAlert: V35Side;          // Which side was expensive when alert started
  expensivePriceAtAlert: number;          // Price of expensive side when alert started
}

// ============================================================
// REVERSAL DETECTOR CLASS
// ============================================================

export class ReversalDetector {
  private config: ReversalDetectorConfig;
  private lastCheckMs = 0;
  private lastReversalMs = 0;
  
  // Stage 1: Binance price history for signal detection
  private priceHistory: Map<V35Asset, { price: number; ts: number }[]> = new Map();
  
  // Stage 1: Alert states per market
  private alertStates: Map<string, AlertState> = new Map();
  
  // Stage 2: Confirmed reversals (for +3 capacity boost)
  private confirmedReversals: Map<string, { confirmedAt: number; asset: V35Asset }> = new Map();
  private reversalActiveWindowMs = 30_000;
  
  constructor(config: Partial<ReversalDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }
  
  /**
   * Main check function - runs both stages
   */
  async checkForReversals(market: V35Market): Promise<{
    alertTriggered: boolean;
    reversalConfirmed: boolean;
    emergencyTriggered: boolean;
    reason?: string;
  }> {
    const now = Date.now();
    
    // Rate limit checks
    if (now - this.lastCheckMs < this.config.checkIntervalMs) {
      return { alertTriggered: false, reversalConfirmed: false, emergencyTriggered: false };
    }
    this.lastCheckMs = now;
    
    // Clean up expired alerts
    this.cleanupExpiredAlerts();
    
    // =========================================================================
    // STAGE 1: CHECK FOR BINANCE SIGNAL → ALERT MODE
    // =========================================================================
    const alertResult = await this.checkBinanceSignal(market);
    
    // =========================================================================
    // STAGE 2: IF IN ALERT MODE, CHECK FOR SHARE PRICE REVERSAL
    // =========================================================================
    const alertState = this.alertStates.get(market.slug);
    let reversalResult = { reversalConfirmed: false, emergencyTriggered: false, reason: undefined as string | undefined };
    
    if (alertState) {
      reversalResult = await this.checkSharePriceReversal(market, alertState);
    }
    
    return {
      alertTriggered: alertResult.alertTriggered,
      reversalConfirmed: reversalResult.reversalConfirmed,
      emergencyTriggered: reversalResult.emergencyTriggered,
      reason: reversalResult.reason || alertResult.reason,
    };
  }
  
  /**
   * STAGE 1: Check Binance for $30 move → activate ALERT MODE
   */
  private async checkBinanceSignal(market: V35Market): Promise<{
    alertTriggered: boolean;
    reason?: string;
  }> {
    const now = Date.now();
    
    // Skip if already in alert mode for this market
    if (this.alertStates.has(market.slug)) {
      return { alertTriggered: false, reason: 'already_in_alert' };
    }
    
    // Get Binance feed
    const binance = getBinanceFeed();
    if (!binance.isHealthy()) {
      return { alertTriggered: false, reason: 'binance_unhealthy' };
    }
    
    const currentPrice = binance.getPrice(market.asset);
    if (!currentPrice) {
      return { alertTriggered: false, reason: 'no_binance_price' };
    }
    
    // Update price history
    const history = this.priceHistory.get(market.asset) || [];
    history.push({ price: currentPrice, ts: now });
    
    // Keep only last 5 seconds of history
    const cutoff = now - 5000;
    const filteredHistory = history.filter(h => h.ts > cutoff);
    this.priceHistory.set(market.asset, filteredHistory);
    
    // Find prices from 1-2 seconds ago
    const windowStart = now - this.config.binanceWindowMs;
    const oldPrices = filteredHistory.filter(h => h.ts >= windowStart - 500 && h.ts <= windowStart + 500);
    
    if (oldPrices.length === 0) {
      return { alertTriggered: false, reason: 'no_history' };
    }
    
    // Calculate price change
    const oldestPrice = oldPrices[0].price;
    const priceChange = currentPrice - oldestPrice;
    const absPriceChange = Math.abs(priceChange);
    
    // Check if move exceeds threshold
    if (absPriceChange < this.config.binanceSignalThresholdUsd) {
      return { alertTriggered: false };
    }
    
    // Determine current expensive side
    const expensiveSide: V35Side = market.upBestAsk > market.downBestAsk ? 'UP' : 'DOWN';
    const expensivePrice = expensiveSide === 'UP' ? market.upBestAsk : market.downBestAsk;
    
    // Check if we have pending pairs that could be affected
    const pairTracker = getPairTracker();
    const activePairs = pairTracker.getMarketPairs(market.slug)
      .filter(p => p.status === 'WAITING_HEDGE');
    
    // Activate ALERT MODE
    const alertState: AlertState = {
      activatedAt: now,
      asset: market.asset,
      marketSlug: market.slug,
      binancePriceAtAlert: currentPrice,
      binanceDirection: priceChange > 0 ? 'UP' : 'DOWN',
      expensiveSideAtAlert: expensiveSide,
      expensivePriceAtAlert: expensivePrice,
    };
    
    this.alertStates.set(market.slug, alertState);
    
    const direction = priceChange > 0 ? '📈 UP' : '📉 DOWN';
    console.log(`\n[ReversalDetector] ════════════════════════════════════════════════════`);
    console.log(`[ReversalDetector] 🚨 STAGE 1: ALERT MODE ACTIVATED`);
    console.log(`[ReversalDetector]    Market: ${market.slug.slice(-30)}`);
    console.log(`[ReversalDetector]    Binance: $${oldestPrice.toFixed(0)} → $${currentPrice.toFixed(0)} (${direction} $${absPriceChange.toFixed(0)})`);
    console.log(`[ReversalDetector]    Expensive side: ${expensiveSide} @ ${(expensivePrice * 100).toFixed(0)}c`);
    console.log(`[ReversalDetector]    Active pairs: ${activePairs.length}`);
    console.log(`[ReversalDetector]    ⏱️ Watching for share price reversal for 30s...`);
    console.log(`[ReversalDetector] ════════════════════════════════════════════════════\n`);
    
    // Log event
    logV35GuardEvent({
      marketSlug: market.slug,
      asset: market.asset,
      guardType: 'ALERT_MODE_ACTIVATED',
      blockedSide: null,
      upQty: market.upQty,
      downQty: market.downQty,
      expensiveSide,
      reason: `Binance ${direction} $${absPriceChange.toFixed(0)} - watching for share price reversal`,
    }).catch(() => {});
    
    return { alertTriggered: true };
  }
  
  /**
   * STAGE 2: Check Polymarket share prices for actual reversal
   */
  private async checkSharePriceReversal(
    market: V35Market,
    alertState: AlertState
  ): Promise<{
    reversalConfirmed: boolean;
    emergencyTriggered: boolean;
    reason?: string;
  }> {
    const now = Date.now();
    
    // Cooldown check
    if (now - this.lastReversalMs < this.config.cooldownAfterReversalMs) {
      return { reversalConfirmed: false, emergencyTriggered: false, reason: 'reversal_cooldown' };
    }
    
    // Get current share prices
    const currentExpensivePrice = alertState.expensiveSideAtAlert === 'UP' 
      ? market.upBestAsk 
      : market.downBestAsk;
    
    const priceDrop = alertState.expensivePriceAtAlert - currentExpensivePrice;
    const priceDropCents = priceDrop * 100;
    
    // Check reversal conditions:
    // 1. Expensive side dropped significantly (>15c)
    // 2. OR expensive side is now near/below 50c (delta flip)
    const significantDrop = priceDropCents >= this.config.shareReversalThresholdCents;
    const nearFlip = currentExpensivePrice <= this.config.deltaFlipThreshold;
    
    if (!significantDrop && !nearFlip) {
      // No reversal yet, keep watching
      return { reversalConfirmed: false, emergencyTriggered: false };
    }
    
    // =========================================================================
    // REVERSAL CONFIRMED!
    // =========================================================================
    this.lastReversalMs = now;
    
    // Mark reversal as active (enables +3 pair capacity)
    this.confirmedReversals.set(market.slug, { confirmedAt: now, asset: market.asset });
    
    // Remove from alert mode
    this.alertStates.delete(market.slug);
    
    const triggerReason = significantDrop 
      ? `${alertState.expensiveSideAtAlert} dropped ${priceDropCents.toFixed(0)}c` 
      : `${alertState.expensiveSideAtAlert} near flip @ ${(currentExpensivePrice * 100).toFixed(0)}c`;
    
    console.log(`\n[ReversalDetector] ════════════════════════════════════════════════════`);
    console.log(`[ReversalDetector] ⚡ STAGE 2: REVERSAL CONFIRMED!`);
    console.log(`[ReversalDetector]    Market: ${market.slug.slice(-30)}`);
    console.log(`[ReversalDetector]    Trigger: ${triggerReason}`);
    console.log(`[ReversalDetector]    ${alertState.expensiveSideAtAlert}: ${(alertState.expensivePriceAtAlert * 100).toFixed(0)}c → ${(currentExpensivePrice * 100).toFixed(0)}c`);
    console.log(`[ReversalDetector]    🔓 +3 PAIR CAPACITY ENABLED for 30s`);
    console.log(`[ReversalDetector]    💡 Capitalize on new expensive side immediately!`);
    console.log(`[ReversalDetector] ════════════════════════════════════════════════════\n`);
    
    // Log event
    logV35GuardEvent({
      marketSlug: market.slug,
      asset: market.asset,
      guardType: 'REVERSAL_CONFIRMED',
      blockedSide: null,
      upQty: market.upQty,
      downQty: market.downQty,
      expensiveSide: alertState.expensiveSideAtAlert,
      reason: triggerReason,
    }).catch(() => {});
    
    // =========================================================================
    // EMERGENCY HEDGE FOR EXISTING PAIRS
    // =========================================================================
    const pairTracker = getPairTracker();
    const waitingPairs = pairTracker.getMarketPairs(market.slug)
      .filter(p => p.status === 'WAITING_HEDGE' && p.takerSide === alertState.expensiveSideAtAlert);
    
    let emergencyTriggered = false;
    
    for (const pair of waitingPairs) {
      // Get current ask for the maker side (now the expensive side!)
      const makerAsk = pair.makerSide === 'UP' ? market.upBestAsk : market.downBestAsk;
      
      // Check if emergency hedge is viable (CPP check)
      const result = await pairTracker.triggerEmergencyHedge(pair, market, makerAsk);
      
      if (result.success) {
        console.log(`[ReversalDetector] ✅ Emergency hedge triggered for ${pair.id}`);
        emergencyTriggered = true;
      } else {
        console.log(`[ReversalDetector] ⚠️ Emergency hedge skipped for ${pair.id}: ${result.error}`);
      }
    }
    
    return { reversalConfirmed: true, emergencyTriggered };
  }
  
  /**
   * Clean up expired alert states
   */
  private cleanupExpiredAlerts(): void {
    const now = Date.now();
    
    for (const [slug, state] of this.alertStates.entries()) {
      if (now - state.activatedAt > this.config.alertModeDurationMs) {
        console.log(`[ReversalDetector] ⏱️ Alert expired for ${slug.slice(-30)} (no reversal detected)`);
        this.alertStates.delete(slug);
      }
    }
  }
  
  /**
   * Check if any reversal is currently active (for extra pair capacity)
   * A reversal stays "active" for 30 seconds after confirmation.
   */
  isReversalActive(): boolean {
    const now = Date.now();
    
    // Clean up expired reversals
    for (const [slug, info] of this.confirmedReversals.entries()) {
      if (now - info.confirmedAt > this.reversalActiveWindowMs) {
        this.confirmedReversals.delete(slug);
        console.log(`[ReversalDetector] 🔒 Reversal capacity expired for ${slug.slice(-30)} - returning to normal`);
      }
    }
    
    return this.confirmedReversals.size > 0;
  }
  
  /**
   * Check if a specific market is in alert mode
   */
  isInAlertMode(marketSlug: string): boolean {
    return this.alertStates.has(marketSlug);
  }
  
  /**
   * Get alert state for a market (if any)
   */
  getAlertState(marketSlug: string): AlertState | undefined {
    return this.alertStates.get(marketSlug);
  }
  
  /**
   * Get count of active reversals
   */
  getActiveReversalCount(): number {
    this.isReversalActive(); // Trigger cleanup
    return this.confirmedReversals.size;
  }
  
  /**
   * Get count of markets in alert mode
   */
  getAlertModeCount(): number {
    this.cleanupExpiredAlerts();
    return this.alertStates.size;
  }
  
  /**
   * Get status summary
   */
  getStatus(): {
    lastCheckMs: number;
    lastReversalMs: number;
    alertModeMarkets: number;
    activeReversals: number;
    priceHistorySize: Record<string, number>;
  } {
    const priceHistorySize: Record<string, number> = {};
    
    for (const [asset, history] of this.priceHistory.entries()) {
      priceHistorySize[asset] = history.length;
    }
    
    return {
      lastCheckMs: this.lastCheckMs,
      lastReversalMs: this.lastReversalMs,
      alertModeMarkets: this.getAlertModeCount(),
      activeReversals: this.getActiveReversalCount(),
      priceHistorySize,
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
    this.lastReversalMs = 0;
    this.priceHistory.clear();
    this.alertStates.clear();
    this.confirmedReversals.clear();
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
