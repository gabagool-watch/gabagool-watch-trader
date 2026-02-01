// ============================================================
// V35 EXPIRY SNAPSHOT SCHEDULER
// ============================================================
// Captures market state exactly 1 second before expiry (e.g., 12:59:59)
// This ensures we have an accurate historical record of each 15-minute
// market's final state, independent of when cleanupExpiredMarkets() runs.
// ============================================================

import type { V35Market, V35MarketMetrics, V35Asset } from './types.js';
import { calculateMarketMetrics } from './types.js';
import { getCachedPosition } from '../position-cache.js';
import { getBinanceFeed } from './binance-feed.js';

// ============================================================
// TYPES
// ============================================================

export interface V35ExpirySnapshot {
  // Identification
  marketSlug: string;
  asset: V35Asset;
  expiryTime: string; // ISO timestamp of market expiry
  snapshotTime: string; // ISO timestamp when snapshot was taken
  secondsBeforeExpiry: number;
  
  // Position state (from Polymarket API - ground truth)
  apiUpQty: number;
  apiDownQty: number;
  apiUpCost: number;
  apiDownCost: number;
  
  // Local state (for comparison/debugging)
  localUpQty: number;
  localDownQty: number;
  localUpCost: number;
  localDownCost: number;
  
  // Calculated metrics - CORRECTED FORMULA
  paired: number;
  unpaired: number;
  avgUpPrice: number;
  avgDownPrice: number;
  
  // PnL calculation (correct formula):
  // totalCost = (upQty × avgUpPrice) + (downQty × avgDownPrice)
  // finalValue = winningShares × $1.00 (loser = $0)
  // realizedPnl = finalValue - totalCost
  totalCost: number;           // What we paid for all shares
  predictedWinningSide: 'UP' | 'DOWN' | null;  // Based on 99¢ price
  predictedFinalValue: number; // Winning shares × $1.00
  predictedPnl: number;        // finalValue - totalCost
  
  // Legacy field for backwards compatibility
  combinedCost: number;        // avgUp + avgDown (for paired shares)
  lockedProfit: number;        // DEPRECATED - use predictedPnl instead
  
  // Orderbook state at snapshot time
  upBestBid: number | null;
  upBestAsk: number | null;
  downBestBid: number | null;
  downBestAsk: number | null;
  combinedAsk: number | null;
  
  // Order counts
  upOrdersCount: number;
  downOrdersCount: number;
  
  // State flags
  wasImbalanced: boolean;
  imbalanceRatio: number | null;
  
  // Price crossing analysis
  crossingCount: number | null;   // How many times spot crossed strike
  spotPrice: number | null;       // Spot price at snapshot time
  strikePrice: number | null;     // Strike price from market slug
}

// ============================================================
// SCHEDULED SNAPSHOT MANAGER
// ============================================================

// Track scheduled timeouts per market
const scheduledSnapshots = new Map<string, NodeJS.Timeout>();

// Callback for when snapshot is captured
type SnapshotCallback = (snapshot: V35ExpirySnapshot) => void;
let onSnapshotCallback: SnapshotCallback | null = null;

/**
 * Set the callback function that will be called when a snapshot is captured
 */
export function setSnapshotCallback(callback: SnapshotCallback): void {
  onSnapshotCallback = callback;
}

/**
 * Schedule a snapshot to be taken 1 second before market expiry
 */
export function scheduleExpirySnapshot(market: V35Market): void {
  const slug = market.slug;
  
  // Cancel any existing scheduled snapshot for this market
  if (scheduledSnapshots.has(slug)) {
    clearTimeout(scheduledSnapshots.get(slug)!);
    scheduledSnapshots.delete(slug);
  }
  
  const now = Date.now();
  const expiryMs = market.expiry.getTime();
  const snapshotTime = expiryMs - 1000; // 1 second before expiry
  const delayMs = snapshotTime - now;
  
  // Only schedule if there's time left
  if (delayMs <= 0) {
    console.log(`[ExpirySnapshot] Market ${slug.slice(-25)} already expired, skipping schedule`);
    return;
  }
  
  console.log(`[ExpirySnapshot] Scheduled snapshot for ${slug.slice(-25)} in ${(delayMs / 1000).toFixed(0)}s`);
  
  const timeout = setTimeout(() => {
    captureSnapshot(market);
    scheduledSnapshots.delete(slug);
  }, delayMs);
  
  scheduledSnapshots.set(slug, timeout);
}

/**
 * Cancel a scheduled snapshot for a market
 */
export function cancelExpirySnapshot(slug: string): void {
  if (scheduledSnapshots.has(slug)) {
    clearTimeout(scheduledSnapshots.get(slug)!);
    scheduledSnapshots.delete(slug);
    console.log(`[ExpirySnapshot] Cancelled snapshot for ${slug.slice(-25)}`);
  }
}

/**
 * Cancel all scheduled snapshots
 */
export function cancelAllExpirySnapshots(): void {
  for (const [slug, timeout] of scheduledSnapshots.entries()) {
    clearTimeout(timeout);
    console.log(`[ExpirySnapshot] Cancelled snapshot for ${slug.slice(-25)}`);
  }
  scheduledSnapshots.clear();
}

/**
 * Get count of scheduled snapshots
 */
export function getScheduledSnapshotCount(): number {
  return scheduledSnapshots.size;
}

// ============================================================
// SNAPSHOT CAPTURE
// ============================================================

/**
 * Capture the market state snapshot
 * Called exactly 1 second before market expiry
 */
function captureSnapshot(market: V35Market): void {
  const now = new Date();
  const secondsBeforeExpiry = (market.expiry.getTime() - now.getTime()) / 1000;
  
  console.log(`📸 [ExpirySnapshot] Capturing final state for ${market.slug.slice(-25)} (${secondsBeforeExpiry.toFixed(1)}s before expiry)`);
  
  // Get ground truth from Polymarket API
  const apiPosition = getCachedPosition(market.slug);
  
  // Use API values if available, otherwise fall back to local
  const apiUpQty = apiPosition?.upShares ?? market.upQty;
  const apiDownQty = apiPosition?.downShares ?? market.downQty;
  const apiUpCost = apiPosition?.upCost ?? market.upCost;
  const apiDownCost = apiPosition?.downCost ?? market.downCost;
  
  // Calculate average prices
  const avgUpPrice = apiUpQty > 0 ? apiUpCost / apiUpQty : 0;
  const avgDownPrice = apiDownQty > 0 ? apiDownCost / apiDownQty : 0;
  
  // CORRECT PnL FORMULA:
  // Step 1: Calculate total cost (what we paid)
  const totalCost = apiUpCost + apiDownCost;
  
  // Step 2: Determine winning side from orderbook prices
  // In the last second, winning side has 99¢ bid, losing side has 1¢ bid
  const upBid = market.upBestBid > 0 ? market.upBestBid : null;
  const downBid = market.downBestBid > 0 ? market.downBestBid : null;
  
  let predictedWinningSide: 'UP' | 'DOWN' | null = null;
  if (upBid !== null && downBid !== null) {
    if (upBid >= 0.90) {
      predictedWinningSide = 'UP';
    } else if (downBid >= 0.90) {
      predictedWinningSide = 'DOWN';
    }
  }
  
  // Step 3: Calculate final value (winning shares × $1.00, losing = $0)
  let predictedFinalValue = 0;
  if (predictedWinningSide === 'UP') {
    predictedFinalValue = apiUpQty * 1.0;  // UP wins, DOWN = $0
  } else if (predictedWinningSide === 'DOWN') {
    predictedFinalValue = apiDownQty * 1.0;  // DOWN wins, UP = $0
  }
  
  // Step 4: Calculate PnL = value - costs
  const predictedPnl = predictedFinalValue - totalCost;
  
  // Legacy metrics for backwards compatibility
  const paired = Math.min(apiUpQty, apiDownQty);
  const unpaired = Math.abs(apiUpQty - apiDownQty);
  const combinedCost = (apiUpQty > 0 && apiDownQty > 0) ? avgUpPrice + avgDownPrice : 0;
  const lockedProfit = (combinedCost > 0 && combinedCost < 1.0) ? paired * (1.0 - combinedCost) : 0;
  
  // Calculate imbalance ratio
  const minQty = Math.min(apiUpQty, apiDownQty);
  const maxQty = Math.max(apiUpQty, apiDownQty);
  const imbalanceRatio = minQty > 0 ? maxQty / minQty : null;
  
  // Orderbook state
  const combinedAsk = (market.upBestAsk > 0 && market.downBestAsk > 0)
    ? market.upBestAsk + market.downBestAsk
    : null;
  
  // ============================================================
  // CROSSING ANALYSIS - How many times did spot cross strike?
  // ============================================================
  const binanceFeed = getBinanceFeed();
  const currentSpotPrice = binanceFeed.getPrice(market.asset);
  
  // Parse strike price from market slug (e.g., "btc-updown-15m-1769865300" -> last 10 digits is expiry, strike is in slug too)
  // Strike format varies - try to extract from slug or use a default based on asset
  let strikePrice: number | null = null;
  
  // Try to parse strike from market slug format
  // Common formats: "btc-updown-97500-15m-..." or check if numeric values exist
  const slugParts = market.slug.split('-');
  for (const part of slugParts) {
    const numVal = parseFloat(part);
    // Strike prices are typically: BTC 90000-110000, ETH 3000-4000, SOL 150-250, XRP 2-4
    if (!isNaN(numVal)) {
      if (market.asset === 'BTC' && numVal >= 50000 && numVal <= 200000) {
        strikePrice = numVal;
        break;
      } else if (market.asset === 'ETH' && numVal >= 2000 && numVal <= 10000) {
        strikePrice = numVal;
        break;
      } else if (market.asset === 'SOL' && numVal >= 50 && numVal <= 500) {
        strikePrice = numVal;
        break;
      } else if (market.asset === 'XRP' && numVal >= 0.5 && numVal <= 10) {
        strikePrice = numVal;
        break;
      }
    }
  }
  
  // Calculate crossings if we have a valid strike price
  let crossingCount: number | null = null;
  if (strikePrice !== null) {
    const crossingResult = binanceFeed.countStrikeCrossings(market.asset, strikePrice, 15 * 60 * 1000);
    crossingCount = crossingResult.crossingCount;
  }
  
  const snapshot: V35ExpirySnapshot = {
    marketSlug: market.slug,
    asset: market.asset,
    expiryTime: market.expiry.toISOString(),
    snapshotTime: now.toISOString(),
    secondsBeforeExpiry,
    
    // API ground truth
    apiUpQty,
    apiDownQty,
    apiUpCost,
    apiDownCost,
    
    // Local state for comparison
    localUpQty: market.upQty,
    localDownQty: market.downQty,
    localUpCost: market.upCost,
    localDownCost: market.downCost,
    
    // Calculated metrics - CORRECT FORMULA
    paired,
    unpaired,
    avgUpPrice,
    avgDownPrice,
    
    // PnL calculation
    totalCost,
    predictedWinningSide,
    predictedFinalValue,
    predictedPnl,
    
    // Legacy (backwards compat)
    combinedCost,
    lockedProfit,
    
    // Orderbook
    upBestBid: upBid,
    upBestAsk: market.upBestAsk > 0 && market.upBestAsk < 1 ? market.upBestAsk : null,
    downBestBid: downBid,
    downBestAsk: market.downBestAsk > 0 && market.downBestAsk < 1 ? market.downBestAsk : null,
    combinedAsk,
    
    // Orders
    upOrdersCount: market.upOrders.size,
    downOrdersCount: market.downOrders.size,
    
    // Flags
    wasImbalanced: unpaired >= 10,
    imbalanceRatio,
    
    // Price crossing analysis
    crossingCount,
    spotPrice: currentSpotPrice > 0 ? currentSpotPrice : null,
    strikePrice,
  };
  
  // Log summary with CORRECT PnL and crossing info
  const pnlEmoji = predictedPnl >= 0 ? '✅' : '❌';
  const winnerStr = predictedWinningSide ?? 'UNKNOWN';
  const crossingStr = crossingCount !== null ? ` | 🔄 ${crossingCount} crossings` : '';
  console.log(`📸 [ExpirySnapshot] ${market.slug.slice(-25)}:`);
  console.log(`   📊 Position: UP=${apiUpQty.toFixed(1)} ($${apiUpCost.toFixed(2)}) | DOWN=${apiDownQty.toFixed(1)} ($${apiDownCost.toFixed(2)})`);
  console.log(`   💰 Total Cost: $${totalCost.toFixed(2)}`);
  console.log(`   🎯 Predicted Winner: ${winnerStr} → Value: $${predictedFinalValue.toFixed(2)}${crossingStr}`);
  console.log(`   ${pnlEmoji} Predicted PnL: $${predictedPnl >= 0 ? '+' : ''}${predictedPnl.toFixed(2)}`);
  if (unpaired >= 5) {
    console.log(`   ⚠️ Unpaired: ${unpaired.toFixed(1)} shares (ratio: ${imbalanceRatio?.toFixed(1) ?? 'N/A'}:1)`);
  }
  if (crossingCount !== null && crossingCount >= 3) {
    console.log(`   🚨 HIGH REVERSAL RISK: ${crossingCount} crossings detected!`);
  }
  
  // Call the callback to persist
  if (onSnapshotCallback) {
    onSnapshotCallback(snapshot);
  }
}
