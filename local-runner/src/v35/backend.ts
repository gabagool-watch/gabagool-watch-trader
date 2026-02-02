// ============================================================
// V35 BACKEND LOGGING
// ============================================================
// Persists fills, positions, heartbeats, and orderbook snapshots
// to the database. Uses the runner-proxy for all database operations.
// ============================================================

import { config } from '../config.js';
import { V35_VERSION } from './config.js';
import type { V35Market, V35Fill, V35MarketMetrics, V35PortfolioMetrics, V35OrderbookSnapshot } from './types.js';

// NOTE: Keep this in sync with runner.ts VERSION for deployment verification.
const VERSION = V35_VERSION;

async function callProxy<T>(action: string, data?: Record<string, unknown>): Promise<T> {
  const response = await fetch(config.backend.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Runner-Secret': config.backend.secret,
    },
    body: JSON.stringify({ action, data }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error ${response.status}: ${text}`);
  }

  return response.json();
}

// ============================================================
// HEARTBEAT
// ============================================================

export interface V35HeartbeatData {
  runnerId: string;
  mode: string;
  dryRun: boolean;
  marketsCount: number;
  totalPaired: number;
  totalUnpaired: number;
  totalLockedProfit: number;
  balance: number;
}

export async function sendV35Heartbeat(data: V35HeartbeatData): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('heartbeat', {
      heartbeat: {
        runner_id: data.runnerId,
        runner_type: 'v35',
        last_heartbeat: new Date().toISOString(),
        status: 'online',
        markets_count: data.marketsCount,
        positions_count: Math.floor(data.totalPaired),
        trades_count: Math.floor(data.totalPaired + data.totalUnpaired),
        balance: data.balance,
        version: VERSION,
        metadata: {
          mode: data.mode,
          dry_run: data.dryRun,
          locked_profit: data.totalLockedProfit,
        },
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Heartbeat failed:', err?.message);
    return false;
  }
}

// ============================================================
// FILL LOGGING
// ============================================================

export async function saveV35Fill(fill: V35Fill): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-v35-fill', {
      fill: {
        order_id: fill.orderId,
        token_id: fill.tokenId,
        side: fill.side,
        price: fill.price,
        size: fill.size,
        timestamp: fill.timestamp.toISOString(),
        market_slug: fill.marketSlug,
        asset: fill.asset,
        fill_type: 'MAKER', // V35 always places maker orders
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save fill failed:', err?.message);
    return false;
  }
}

// ============================================================
// POSITION SNAPSHOT
// ============================================================

export async function saveV35PositionSnapshot(
  market: V35Market,
  metrics: V35MarketMetrics
): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-v35-position', {
      position: {
        market_slug: market.slug,
        asset: market.asset,
        up_qty: metrics.upQty,
        down_qty: metrics.downQty,
        up_cost: metrics.upCost,
        down_cost: metrics.downCost,
        paired: metrics.paired,
        unpaired: metrics.unpaired,
        combined_cost: metrics.combinedCost,
        locked_profit: metrics.lockedProfit,
        seconds_to_expiry: metrics.secondsToExpiry,
        timestamp: new Date().toISOString(),
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save position snapshot failed:', err?.message);
    return false;
  }
}

// ============================================================
// SETTLEMENT LOGGING
// ============================================================

export interface V35SettlementData {
  marketSlug: string;
  asset: string;
  upQty: number;
  downQty: number;
  upCost: number;
  downCost: number;
  paired: number;
  unpaired: number;
  combinedCost: number;
  lockedProfit: number;
  winningSide: 'UP' | 'DOWN' | null;
  pnl: number;
}

export async function saveV35Settlement(data: V35SettlementData): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-v35-settlement', {
      settlement: {
        market_slug: data.marketSlug,
        asset: data.asset,
        up_qty: data.upQty,
        down_qty: data.downQty,
        up_cost: data.upCost,
        down_cost: data.downCost,
        paired: data.paired,
        unpaired: data.unpaired,
        combined_cost: data.combinedCost,
        locked_profit: data.lockedProfit,
        winning_side: data.winningSide,
        pnl: data.pnl,
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save settlement failed:', err?.message);
    return false;
  }
}

// ============================================================
// ORDERBOOK SNAPSHOT LOGGING
// ============================================================

export async function saveV35OrderbookSnapshot(snapshot: V35OrderbookSnapshot): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-v35-orderbook-snapshot', {
      snapshot: {
        ts: snapshot.ts,
        market_slug: snapshot.marketSlug,
        asset: snapshot.asset,
        up_best_bid: snapshot.upBestBid,
        up_best_ask: snapshot.upBestAsk,
        down_best_bid: snapshot.downBestBid,
        down_best_ask: snapshot.downBestAsk,
        combined_ask: snapshot.combinedAsk,
        combined_mid: snapshot.combinedMid,
        edge: snapshot.edge,
        up_bids: snapshot.upBids,
        up_asks: snapshot.upAsks,
        down_bids: snapshot.downBids,
        down_asks: snapshot.downAsks,
        spot_price: snapshot.spotPrice,
        strike_price: snapshot.strikePrice,
        seconds_to_expiry: snapshot.secondsToExpiry,
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save orderbook snapshot failed:', err?.message);
    return false;
  }
}

// Batch save multiple snapshots at once (more efficient)
export async function saveV35OrderbookSnapshots(snapshots: V35OrderbookSnapshot[]): Promise<boolean> {
  if (snapshots.length === 0) return true;
  
  try {
    const result = await callProxy<{ success: boolean; count: number }>('save-v35-orderbook-snapshots', {
      snapshots: snapshots.map(s => ({
        ts: s.ts,
        market_slug: s.marketSlug,
        asset: s.asset,
        up_best_bid: s.upBestBid,
        up_best_ask: s.upBestAsk,
        down_best_bid: s.downBestBid,
        down_best_ask: s.downBestAsk,
        combined_ask: s.combinedAsk,
        combined_mid: s.combinedMid,
        edge: s.edge,
        up_bids: s.upBids,
        up_asks: s.upAsks,
        down_bids: s.downBids,
        down_asks: s.downAsks,
        spot_price: s.spotPrice,
        strike_price: s.strikePrice,
        seconds_to_expiry: s.secondsToExpiry,
      })),
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save orderbook snapshots failed:', err?.message);
    return false;
  }
}

// ============================================================
// GUARD EVENT LOGGING
// ============================================================

export interface V35GuardEvent {
  marketSlug: string;
  asset: string;
  guardType: 'BALANCE_GUARD' | 'GAP_GUARD';
  blockedSide: 'UP' | 'DOWN';
  upQty: number;
  downQty: number;
  expensiveSide: 'UP' | 'DOWN';
  reason: string;
}

export async function logV35GuardEvent(event: V35GuardEvent): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-bot-event', {
      event: {
        event_type: 'guard',
        asset: event.asset,
        market_id: event.marketSlug,
        reason_code: event.guardType,
        ts: Date.now(),
        data: {
          blocked_side: event.blockedSide,
          up_qty: event.upQty,
          down_qty: event.downQty,
          expensive_side: event.expensiveSide,
          reason: event.reason,
        },
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Log guard event failed:', err?.message);
    return false;
  }
}

// ============================================================
// PAIR EVENT LOGGING (V36.4.0)
// ============================================================

export interface V35PairEvent {
  pairId: string;
  eventType: 'pair_opened' | 'pair_taker_filled' | 'pair_maker_placed' | 'pair_maker_filled' | 'pair_hedged' | 'pair_emergency' | 'pair_expired' | 'pair_blocked';
  marketSlug: string;
  asset: string;
  takerSide: 'UP' | 'DOWN';
  takerPrice: number;
  takerSize: number;
  makerSide: 'UP' | 'DOWN';
  makerPrice: number;
  makerSize: number;
  fillPrice?: number;
  fillSize?: number;
  cpp?: number;
  pnl?: number;
  status: string;
}

export async function logPairEvent(event: V35PairEvent): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-bot-event', {
      event: {
        event_type: event.eventType,
        asset: event.asset,
        market_id: event.marketSlug,
        reason_code: event.status,
        ts: Date.now(),
        data: {
          pair_id: event.pairId,
          taker_side: event.takerSide,
          taker_price: event.takerPrice,
          taker_size: event.takerSize,
          maker_side: event.makerSide,
          maker_price: event.makerPrice,
          maker_size: event.makerSize,
          fill_price: event.fillPrice,
          fill_size: event.fillSize,
          cpp: event.cpp,
          pnl: event.pnl,
        },
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Log pair event failed:', err?.message);
    return false;
  }
}

// ============================================================
// INVENTORY SNAPSHOT LOGGING
// ============================================================

export interface V35InventorySnapshot {
  marketSlug: string;
  asset: string;
  upShares: number;
  downShares: number;
  avgUpCost: number | null;
  avgDownCost: number | null;
  pairedShares?: number;
  unpairedShares?: number;
  unpairedNotionalUsd?: number;
  pairCost?: number | null;
  combinedCost?: number | null;  // V36.3.7: Alias for pairCost
  state: string;  // V36.3.7: More flexible states
  triggerType: 'FILL' | 'HEDGE' | 'SYNC' | 'CYCLE' | 'TICK';  // V36.3.7: Added TICK
}

export async function saveV35InventorySnapshot(snapshot: V35InventorySnapshot): Promise<boolean> {
  try {
    // V36.3.7: Calculate derived fields if not provided
    const paired = snapshot.pairedShares ?? Math.min(snapshot.upShares, snapshot.downShares);
    const unpaired = snapshot.unpairedShares ?? Math.abs(snapshot.upShares - snapshot.downShares);
    const avgUp = snapshot.avgUpCost ?? 0;
    const avgDown = snapshot.avgDownCost ?? 0;
    const pairCost = snapshot.pairCost ?? snapshot.combinedCost ?? ((avgUp > 0 && avgDown > 0) ? avgUp + avgDown : null);
    const unpairedNotional = snapshot.unpairedNotionalUsd ?? (unpaired * Math.max(avgUp, avgDown));
    
    const result = await callProxy<{ success: boolean }>('save-inventory-snapshot', {
      snapshot: {
        ts: Date.now(),
        market_id: snapshot.marketSlug,
        asset: snapshot.asset,
        up_shares: snapshot.upShares,
        down_shares: snapshot.downShares,
        avg_up_cost: snapshot.avgUpCost,
        avg_down_cost: snapshot.avgDownCost,
        paired_shares: paired,
        unpaired_shares: unpaired,
        unpaired_notional_usd: unpairedNotional,
        pair_cost: pairCost,
        state: snapshot.state,
        trigger_type: snapshot.triggerType,
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save inventory snapshot failed:', err?.message);
    return false;
  }
}

// ============================================================
// EXPIRY SNAPSHOT LOGGING
// ============================================================

export interface V35ExpirySnapshotData {
  marketSlug: string;
  asset: string;
  expiryTime: string;
  snapshotTime: string;
  secondsBeforeExpiry: number;
  apiUpQty: number;
  apiDownQty: number;
  apiUpCost: number;
  apiDownCost: number;
  localUpQty: number;
  localDownQty: number;
  localUpCost: number;
  localDownCost: number;
  paired: number;
  unpaired: number;
  combinedCost: number;
  lockedProfit: number;
  avgUpPrice: number;
  avgDownPrice: number;
  upBestBid: number | null;
  upBestAsk: number | null;
  downBestBid: number | null;
  downBestAsk: number | null;
  combinedAsk: number | null;
  upOrdersCount: number;
  downOrdersCount: number;
  wasImbalanced: boolean;
  imbalanceRatio: number | null;
  // NEW: Correct PnL calculation fields
  totalCost: number;
  predictedWinningSide: 'UP' | 'DOWN' | null;
  predictedFinalValue: number;
  predictedPnl: number;
  // NEW: Crossing analysis
  crossingCount: number | null;
  spotPrice: number | null;
  strikePrice: number | null;
}

export async function saveV35ExpirySnapshot(data: V35ExpirySnapshotData): Promise<boolean> {
  try {
    const result = await callProxy<{ success: boolean }>('save-v35-expiry-snapshot', {
      snapshot: {
        market_slug: data.marketSlug,
        asset: data.asset,
        expiry_time: data.expiryTime,
        snapshot_time: data.snapshotTime,
        seconds_before_expiry: data.secondsBeforeExpiry,
        api_up_qty: data.apiUpQty,
        api_down_qty: data.apiDownQty,
        api_up_cost: data.apiUpCost,
        api_down_cost: data.apiDownCost,
        local_up_qty: data.localUpQty,
        local_down_qty: data.localDownQty,
        local_up_cost: data.localUpCost,
        local_down_cost: data.localDownCost,
        paired: data.paired,
        unpaired: data.unpaired,
        combined_cost: data.combinedCost,
        locked_profit: data.lockedProfit,
        avg_up_price: data.avgUpPrice,
        avg_down_price: data.avgDownPrice,
        up_best_bid: data.upBestBid,
        up_best_ask: data.upBestAsk,
        down_best_bid: data.downBestBid,
        down_best_ask: data.downBestAsk,
        combined_ask: data.combinedAsk,
        up_orders_count: data.upOrdersCount,
        down_orders_count: data.downOrdersCount,
        was_imbalanced: data.wasImbalanced,
        imbalance_ratio: data.imbalanceRatio,
        // NEW: Correct PnL calculation
        total_cost: data.totalCost,
        predicted_winning_side: data.predictedWinningSide,
        predicted_final_value: data.predictedFinalValue,
        predicted_pnl: data.predictedPnl,
        // NEW: Crossing analysis
        crossing_count: data.crossingCount,
        spot_price: data.spotPrice,
        strike_price: data.strikePrice,
      },
    });
    return result.success;
  } catch (err: any) {
    console.error('[V35Backend] Save expiry snapshot failed:', err?.message);
    return false;
  }
}

// ============================================================
// OFFLINE NOTIFICATION
// ============================================================

export async function sendV35Offline(runnerId: string): Promise<void> {
  try {
    await callProxy('offline', { runner_id: runnerId });
  } catch (err: any) {
    console.error('[V35Backend] Offline notification failed:', err?.message);
  }
}

// ============================================================
// PRICE TICK LOGGING
// ============================================================

export type V35PriceTickRow = {
  market_slug: string;
  asset: string;
  ts: number;
  spot_price: number;
  up_best_bid?: number | null;
  up_best_ask?: number | null;
  down_best_bid?: number | null;
  down_best_ask?: number | null;
  strike_price?: number | null;
  run_id?: string | null;
};

// Batch insert (preferred): one proxy call per asset tick.
export async function saveV35PriceTicks(ticks: V35PriceTickRow[]): Promise<boolean> {
  if (ticks.length === 0) return true;
  try {
    const result = await callProxy<{ success: boolean; count?: number }>('save-v35-price-tick', {
      ticks,
    });
    return result.success;
  } catch {
    // Silent fail - ticks are high-volume; caller should rate-limit logging if needed.
    return false;
  }
}

// Convenience wrapper
export async function saveV35PriceTick(tick: V35PriceTickRow): Promise<boolean> {
  return saveV35PriceTicks([tick]);
}
