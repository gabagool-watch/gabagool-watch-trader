/**
 * burst-limiter.ts - v7.2.7 BURST ORDER LIMITER
 * ==============================================
 * Prevents rapid-fire order placement that can breach caps due to async ack delays.
 * 
 * REQUIREMENT (from revC4.1 spec):
 * - maxOrdersPerMinutePerMarket = 6
 * - minMsBetweenOrdersPerMarket = 2000
 * 
 * If blocked:
 * - DO NOT reservePending
 * - DO NOT place order  
 * - Log BURST_BLOCKED with reason
 */

import { saveBotEvent } from './backend.js';

// ============================================================
// CONFIGURATION
// ============================================================

export const BURST_LIMITER_CONFIG = {
  // Per-market limits
  maxOrdersPerMinutePerMarket: 12,
  minMsBetweenOrdersPerMarket: 2000,
  
  // Sliding window duration
  windowMs: 60_000, // 1 minute
  
  // Logging throttle
  logThrottleMs: 5000,
};

// ============================================================
// TYPES
// ============================================================

interface OrderTimestamp {
  ts: number;
  side: 'BUY' | 'SELL';
}

interface MarketBurstState {
  orders: OrderTimestamp[];
  lastOrderTs: number;
}

export interface BurstCheckResult {
  allowed: boolean;
  blocked: boolean;
  reason: string | null;
  ordersInWindow: number;
  msSinceLastOrder: number;
}

// ============================================================
// STATE (in-memory, keyed by "marketId:asset")
// ============================================================

const burstState = new Map<string, MarketBurstState>();
const logThrottleMap = new Map<string, number>();

function key(marketId: string, asset: string): string {
  return `${marketId}:${asset}`;
}

function getOrCreate(marketId: string, asset: string): MarketBurstState {
  const k = key(marketId, asset);
  let state = burstState.get(k);
  if (!state) {
    state = { orders: [], lastOrderTs: 0 };
    burstState.set(k, state);
  }
  return state;
}

function shouldLog(eventKey: string): boolean {
  const now = Date.now();
  const lastLog = logThrottleMap.get(eventKey) || 0;
  if (now - lastLog > BURST_LIMITER_CONFIG.logThrottleMs) {
    logThrottleMap.set(eventKey, now);
    return true;
  }
  return false;
}

// ============================================================
// BURST CHECK API
// ============================================================

/**
 * Check if an order is allowed given burst limits.
 * Call this BEFORE reservePending and BEFORE placing order.
 */
export function checkBurstLimit(params: {
  marketId: string;
  asset: string;
  side: 'BUY' | 'SELL';
  runId?: string;
}): BurstCheckResult {
  const { marketId, asset, side, runId } = params;
  const state = getOrCreate(marketId, asset);
  const now = Date.now();
  
  // Prune old orders outside window
  const cutoff = now - BURST_LIMITER_CONFIG.windowMs;
  state.orders = state.orders.filter(o => o.ts >= cutoff);
  
  const ordersInWindow = state.orders.length;
  const msSinceLastOrder = state.lastOrderTs > 0 ? now - state.lastOrderTs : Infinity;
  
  // Check order count limit
  if (ordersInWindow >= BURST_LIMITER_CONFIG.maxOrdersPerMinutePerMarket) {
    const reason = `BURST_BLOCKED: ${ordersInWindow} orders in last 60s >= limit ${BURST_LIMITER_CONFIG.maxOrdersPerMinutePerMarket}`;
    
    if (shouldLog(`burst_count_${key(marketId, asset)}`)) {
      console.log(`🚫 [BURST] ${reason} | ${asset} ${marketId.slice(-15)}`);
      
      saveBotEvent({
        event_type: 'BURST_BLOCKED',
        asset,
        market_id: marketId,
        ts: now,
        run_id: runId,
        data: {
          reason: 'ORDER_COUNT_LIMIT',
          ordersInWindow,
          maxOrders: BURST_LIMITER_CONFIG.maxOrdersPerMinutePerMarket,
          side,
        },
      }).catch(() => {});
    }
    
    return {
      allowed: false,
      blocked: true,
      reason,
      ordersInWindow,
      msSinceLastOrder,
    };
  }
  
  // Check minimum interval
  if (msSinceLastOrder < BURST_LIMITER_CONFIG.minMsBetweenOrdersPerMarket) {
    const waitMs = BURST_LIMITER_CONFIG.minMsBetweenOrdersPerMarket - msSinceLastOrder;
    const reason = `BURST_BLOCKED: only ${msSinceLastOrder}ms since last order, need ${BURST_LIMITER_CONFIG.minMsBetweenOrdersPerMarket}ms`;
    
    if (shouldLog(`burst_interval_${key(marketId, asset)}`)) {
      console.log(`🚫 [BURST] ${reason} | ${asset} ${marketId.slice(-15)}`);
      
      saveBotEvent({
        event_type: 'BURST_BLOCKED',
        asset,
        market_id: marketId,
        ts: now,
        run_id: runId,
        data: {
          reason: 'MIN_INTERVAL',
          msSinceLastOrder,
          minMsRequired: BURST_LIMITER_CONFIG.minMsBetweenOrdersPerMarket,
          waitMs,
          side,
        },
      }).catch(() => {});
    }
    
    return {
      allowed: false,
      blocked: true,
      reason,
      ordersInWindow,
      msSinceLastOrder,
    };
  }
  
  // ALLOWED
  return {
    allowed: true,
    blocked: false,
    reason: null,
    ordersInWindow,
    msSinceLastOrder,
  };
}

/**
 * Record that an order was placed.
 * Call this AFTER successful order placement.
 */
export function recordOrderPlacement(params: {
  marketId: string;
  asset: string;
  side: 'BUY' | 'SELL';
}): void {
  const { marketId, asset, side } = params;
  const state = getOrCreate(marketId, asset);
  const now = Date.now();
  
  state.orders.push({ ts: now, side });
  state.lastOrderTs = now;
  
  // Prune old to prevent memory growth
  const cutoff = now - BURST_LIMITER_CONFIG.windowMs;
  state.orders = state.orders.filter(o => o.ts >= cutoff);
}

/**
 * Clear burst state for a market (e.g., on expiry).
 */
export function clearBurstState(marketId: string, asset: string): void {
  burstState.delete(key(marketId, asset));
}

/**
 * Get burst stats for diagnostics.
 */
export function getBurstStats(): {
  marketsTracked: number;
  totalOrdersInFlight: number;
  markets: Array<{ key: string; ordersInWindow: number; msSinceLastOrder: number }>;
} {
  const now = Date.now();
  const cutoff = now - BURST_LIMITER_CONFIG.windowMs;
  const markets: Array<{ key: string; ordersInWindow: number; msSinceLastOrder: number }> = [];
  let totalOrdersInFlight = 0;
  
  for (const [k, state] of burstState) {
    const ordersInWindow = state.orders.filter(o => o.ts >= cutoff).length;
    const msSinceLastOrder = state.lastOrderTs > 0 ? now - state.lastOrderTs : -1;
    
    if (ordersInWindow > 0) {
      markets.push({ key: k, ordersInWindow, msSinceLastOrder });
      totalOrdersInFlight += ordersInWindow;
    }
  }
  
  return {
    marketsTracked: burstState.size,
    totalOrdersInFlight,
    markets,
  };
}
