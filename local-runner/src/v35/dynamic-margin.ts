// ============================================================
// V36.8.0 DYNAMIC MARGIN ENGINE
// ============================================================
// Combines two margin systems:
// 1. Delta Margin: Base margin from spot-strike price difference
// 2. Volatility Scaling: Adjust margin based on ATR (volatility)
//
// High volatility = smaller margin (market moves to you faster)
// Low volatility = full margin (need to wait for movement)
// ============================================================

import { getBinanceFeed, type V35Asset } from './binance-feed.js';
import { getV35Config, type V35Config } from './config.js';

export type VolatilityRegime = 'LOW' | 'MEDIUM' | 'HIGH';

export interface DynamicMarginResult {
  baseMargin: number;          // Margin from delta bucket
  volatilityMultiplier: number; // 0.5 - 1.0 based on ATR
  finalMargin: number;          // baseMargin * volatilityMultiplier (clamped to min)
  deltaAbsolute: number;        // |spot - strike| in absolute $
  deltaBucket: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  volatilityRegime: VolatilityRegime;
  atrPercent: number;           // Current ATR as percentage
}

/**
 * Get delta bucket based on |spot - strike| difference
 * This determines the BASE margin before volatility scaling
 */
function getDeltaBucket(deltaAbsolute: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW' {
  // Delta thresholds in absolute $ (e.g., BTC at $100k)
  // HIGH: delta > $500 → 10¢ margin
  // MEDIUM: delta > $200 → 7¢ margin
  // LOW: delta > $50 → 5¢ margin
  // VERY_LOW: delta ≤ $50 → 3¢ margin
  
  if (deltaAbsolute > 500) return 'HIGH';
  if (deltaAbsolute > 200) return 'MEDIUM';
  if (deltaAbsolute > 50) return 'LOW';
  return 'VERY_LOW';
}

/**
 * Get base margin in $ for a delta bucket
 */
function getBaseMarginForBucket(bucket: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW'): number {
  const config = getV35Config();
  const margins = config.volatilityMargin?.deltaMargins || {
    high: 0.10,
    medium: 0.07,
    low: 0.05,
    veryLow: 0.03,
  };
  
  switch (bucket) {
    case 'HIGH': return margins.high;
    case 'MEDIUM': return margins.medium;
    case 'LOW': return margins.low;
    case 'VERY_LOW': return margins.veryLow;
  }
}

/**
 * Get volatility multiplier based on ATR regime
 * HIGH volatility = smaller margin (0.5x) = fills faster
 * LOW volatility = full margin (1.0x)
 */
function getVolatilityMultiplier(regime: VolatilityRegime): number {
  const config = getV35Config();
  const multipliers = config.volatilityMargin?.volatilityMultipliers || {
    low: 1.0,
    medium: 0.7,
    high: 0.5,
  };
  
  switch (regime) {
    case 'LOW': return multipliers.low;
    case 'MEDIUM': return multipliers.medium;
    case 'HIGH': return multipliers.high;
  }
}

/**
 * Main function: Calculate dynamic margin for a given market
 * 
 * @param asset - BTC, ETH, SOL, XRP
 * @param strikePrice - Strike price of the prediction market
 * @returns DynamicMarginResult with final margin and all components
 */
export function calculateDynamicMargin(
  asset: V35Asset,
  strikePrice: number
): DynamicMarginResult {
  const config = getV35Config();
  const feed = getBinanceFeed();
  
  // Get current spot price from Binance feed
  const spotPrice = feed.getPrice(asset);
  
  // Calculate absolute delta
  const deltaAbsolute = Math.abs(spotPrice - strikePrice);
  
  // Get delta bucket and base margin
  const deltaBucket = getDeltaBucket(deltaAbsolute);
  const baseMargin = getBaseMarginForBucket(deltaBucket);
  
  // Get volatility regime and multiplier
  const atrPercent = feed.getATR(asset);
  const volatilityRegime = feed.getVolatilityRegime(asset);
  const volatilityMultiplier = getVolatilityMultiplier(volatilityRegime);
  
  // Calculate final margin with minimum floor
  const minMargin = config.volatilityMargin?.minMargin || 0.02;
  const rawFinalMargin = baseMargin * volatilityMultiplier;
  const finalMargin = Math.max(minMargin, Math.round(rawFinalMargin * 100) / 100);
  
  return {
    baseMargin,
    volatilityMultiplier,
    finalMargin,
    deltaAbsolute,
    deltaBucket,
    volatilityRegime,
    atrPercent,
  };
}

/**
 * Check if volatility-based margin is enabled
 */
export function isVolatilityMarginEnabled(): boolean {
  const config = getV35Config();
  return config.volatilityMargin?.enabled ?? true;
}

/**
 * Get a human-readable summary for logging
 */
export function getMarginSummary(result: DynamicMarginResult): string {
  return `delta=$${result.deltaAbsolute.toFixed(0)} (${result.deltaBucket}) → ` +
         `base=${(result.baseMargin * 100).toFixed(0)}¢ × ` +
         `vol=${result.volatilityMultiplier.toFixed(2)} (${result.volatilityRegime}, ATR=${result.atrPercent.toFixed(3)}%) → ` +
         `final=${(result.finalMargin * 100).toFixed(1)}¢`;
}
