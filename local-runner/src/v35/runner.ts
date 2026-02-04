// ============================================================
// V37 RUNNER - BACK TO BASICS
// ============================================================
// Version: V37.0.0 - "Back to Basics"
//
// SUPER SIMPLE STRATEGY:
// 1. Every 5 seconds: buy expensive side as TAKER
// 2. Immediately place MAKER limit at: 100 - takerPrice - 5c
// 3. Max 10 pairs open (WAITING_HEDGE status)
// 4. No reversals, no guards, no complexity
//
// That's it. Simple market making.
// ============================================================

import '../config.js'; // Load env first
import WebSocket from 'ws';
import os from 'os';
import { 
  getV35Config, 
  loadV35Config, 
  setV35ConfigOverrides,
  printV35Config,
  V35_VERSION,
  V35_CODENAME,
  type V35Mode 
} from './config.js';
import type { 
  V35Market, 
  V35MarketMetrics, 
  V35PortfolioMetrics,
  V35Asset,
  V35Fill,
  V35Quote,
} from './types.js';
import { createEmptyMarket, calculateMarketMetrics } from './types.js';
import { QuotingEngine } from './quoting-engine.js';
import { getV35SidePricing } from './market-pricing.js';
import { discoverMarkets, filterByAssets } from './market-discovery.js';
import { syncOrders, cancelAllOrders, updateOrderbook, reconcileOrders, cancelSideOrders } from './order-manager.js';
import { processFillWithHedge, processFillInventoryOnly, logMarketFillStats } from './fill-tracker.js';
import { getHedgeManager, resetHedgeManager } from './hedge-manager.js';
import { getCircuitBreaker, initCircuitBreaker, resetCircuitBreaker } from './circuit-breaker.js';
import { getProactiveRebalancer, resetProactiveRebalancer } from './proactive-rebalancer.js';
import { getEmergencyRecovery, resetEmergencyRecovery, analyzeRecovery, setRecoveryConfig } from './emergency-recovery.js';
import { sendV35Heartbeat, sendV35Offline, saveV35Settlement, saveV35Fill, saveV35OrderbookSnapshots, saveV35InventorySnapshot, saveV35ExpirySnapshot, saveV35PriceTicks, type V35InventorySnapshot, type V35ExpirySnapshotData, type V35PriceTickRow } from './backend.js';
import type { V35OrderbookSnapshot } from './types.js';
// V36: Import new depth-aware modules
import { getV36QuotingEngine, resetV36QuotingEngine } from './v36-quoting-engine.js';
import { parseBookEvent, type ParsedDepth } from './depth-parser.js';
import { buildCombinedBook, logCombinedBook } from './combined-book.js';
// V36.1: Pair-based market making with Binance stop-loss
import { getPairTracker, resetPairTracker } from './pair-tracker.js';
import { getReversalDetector, resetReversalDetector } from './reversal-detector.js';
// Expiry snapshot scheduler - captures market state exactly 1 second before expiry
import { scheduleExpirySnapshot, cancelExpirySnapshot, cancelAllExpirySnapshots, setSnapshotCallback } from './expiry-snapshot.js';
import { ensureValidCredentials, getBalance, getOpenOrders } from '../polymarket.js';
import { checkVpnRequired } from '../vpn-check.js';
import { acquireLeaseOrHalt, releaseLease, renewLease } from '../runner-lease.js';
import { setRunnerIdentity } from '../order-guard.js';
import { startBinanceFeed, stopBinanceFeed, getBinanceFeed, setPriceTickCallback } from './binance-feed.js';
import { startUserWebSocket, stopUserWebSocket, setTokenToMarketMap, isUserWsConnected, clearOrderIds, getOrderTrackingStats, registerOurOrderIds } from './user-ws.js';
// CRITICAL: Position cache for real-time position sync from Polymarket API
import { 
  startPositionCache, 
  stopPositionCache, 
  getCachedPosition, 
  forceRefresh as refreshPositionCache,
  registerMarketForCache,
  unregisterMarketFromCache,
} from '../position-cache.js';
// Auto-claim redeemer for winning positions
import { startAutoClaimLoop, stopAutoClaimLoop } from '../redeemer.js';
// CRITICAL V36.4.0: Exposure ledger for hard caps
import { syncPosition as syncPositionToLedger, clearMarket as clearLedgerMarket, getEffectiveExposure } from '../exposure-ledger.js';
// CRITICAL: Price feed logger for real-time Chainlink RTDS data (strike price accuracy)
import { startPriceFeedLogger, stopPriceFeedLogger, getPriceFeedLoggerStats } from '../price-feed-ws-logger.js';

// ============================================================
// CONSTANTS
// ============================================================

const VERSION = V35_VERSION;
const RUNNER_ID = process.env.RUNNER_ID || `v35-${os.hostname()}`;
const RUN_ID = `v35_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

// ============================================================
// STATE
// ============================================================

const markets = new Map<string, V35Market>();
const tokenToMarket = new Map<string, { slug: string; side: 'UP' | 'DOWN' }>();
let quotingEngine: QuotingEngine;
let running = false;
let paused = false;
let balance = 0;
let clobSocket: WebSocket | null = null;

// V36: Full orderbook depth storage per token
const orderbookDepth = new Map<string, ParsedDepth>();

// Orderbook snapshot buffer (batched logging)
const orderbookBuffer: V35OrderbookSnapshot[] = [];
const ORDERBOOK_LOG_INTERVAL_MS = 5000; // Flush every 5 seconds
const MAX_ORDERBOOK_BUFFER = 100; // Max before force flush

// Order reconciliation timing
let lastReconcileTime = 0;
const RECONCILE_INTERVAL_MS = 30_000; // Reconcile with Polymarket API every 30s

// ============================================================
// LOGGING HELPERS
// ============================================================

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function logError(msg: string, err?: any): void {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ❌ ${msg}`, err?.message || err || '');
}

// ============================================================
// ORDERBOOK SNAPSHOT LOGGING
// ============================================================

function queueOrderbookSnapshot(market: V35Market): void {
  const now = Date.now();
  const secondsToExpiry = Math.max(0, (market.expiry.getTime() - now) / 1000);
  
  // Calculate combined metrics
  const combinedAsk = (market.upBestAsk > 0 && market.downBestAsk > 0)
    ? market.upBestAsk + market.downBestAsk
    : null;
  const combinedMid = (market.upBestBid > 0 && market.downBestBid > 0 && 
                       market.upBestAsk > 0 && market.downBestAsk > 0)
    ? ((market.upBestBid + market.upBestAsk) / 2 + (market.downBestBid + market.downBestAsk) / 2)
    : null;
  const edge = combinedAsk && combinedAsk < 1.0 ? 1.0 - combinedAsk : null;
  
  // V36: Get full depth data from cache
  const upDepth = orderbookDepth.get(market.upTokenId);
  const downDepth = orderbookDepth.get(market.downTokenId);
  
  // Extract top 5 levels for logging
  const topN = 5;
  const upBids = upDepth?.bids.slice(0, topN) ?? [];
  const upAsks = upDepth?.asks.slice(0, topN) ?? [];
  const downBids = downDepth?.bids.slice(0, topN) ?? [];
  const downAsks = downDepth?.asks.slice(0, topN) ?? [];
  
  const snapshot: V35OrderbookSnapshot = {
    ts: now,
    marketSlug: market.slug,
    asset: market.asset,
    upBestBid: market.upBestBid || null,
    upBestAsk: market.upBestAsk || null,
    downBestBid: market.downBestBid || null,
    downBestAsk: market.downBestAsk || null,
    combinedAsk,
    combinedMid,
    edge,
    // V36: Now with actual depth data!
    upBids,
    upAsks,
    downBids,
    downAsks,
    spotPrice: null, // TODO: integrate Chainlink feed
    strikePrice: null, // TODO: parse from market slug
    secondsToExpiry: Math.round(secondsToExpiry),
  };
  
  orderbookBuffer.push(snapshot);
  
  // Force flush if buffer is full
  if (orderbookBuffer.length >= MAX_ORDERBOOK_BUFFER) {
    flushOrderbookBuffer().catch(err => logError('Force flush failed:', err));
  }
}

async function flushOrderbookBuffer(): Promise<void> {
  if (orderbookBuffer.length === 0) return;
  
  const snapshots = [...orderbookBuffer];
  orderbookBuffer.length = 0; // Clear buffer
  
  const success = await saveV35OrderbookSnapshots(snapshots);
  if (success) {
    log(`📊 Flushed ${snapshots.length} orderbook snapshots`);
  }
}

// ============================================================
// WEBSOCKET MANAGEMENT
// ============================================================

function buildTokenMap(): void {
  tokenToMarket.clear();
  for (const market of markets.values()) {
    tokenToMarket.set(market.upTokenId, { slug: market.slug, side: 'UP' });
    tokenToMarket.set(market.downTokenId, { slug: market.slug, side: 'DOWN' });
  }
  
  // Also update the User WebSocket token map for fill tracking
  const userWsMap = new Map<string, { slug: string; side: 'UP' | 'DOWN'; asset: string }>();
  for (const market of markets.values()) {
    userWsMap.set(market.upTokenId, { slug: market.slug, side: 'UP', asset: market.asset });
    userWsMap.set(market.downTokenId, { slug: market.slug, side: 'DOWN', asset: market.asset });
  }
  setTokenToMarketMap(userWsMap);
}

function connectToClob(): void {
  const tokenIds = Array.from(tokenToMarket.keys());
  if (tokenIds.length === 0) {
    log('⚠️ No tokens to subscribe');
    return;
  }

  log(`🔌 Connecting to CLOB with ${tokenIds.length} tokens...`);
  // IMPORTANT:
  // Use a local socket reference inside event handlers.
  // Otherwise, if connectToClob() is called again while the previous socket is still CONNECTING,
  // the previous socket's 'open' handler may fire but attempt to send on the NEW global clobSocket
  // (still CONNECTING) -> "WebSocket is not open: readyState 0".
  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
  clobSocket = ws;

  ws.on('open', () => {
    // Ignore stale sockets
    if (ws !== clobSocket) {
      try { ws.close(); } catch {}
      return;
    }

    log('✅ Connected to Polymarket CLOB WebSocket');
    try {
      ws.send(JSON.stringify({ type: 'market', assets_ids: tokenIds }));
    } catch (err) {
      logError('CLOB subscribe send failed:', err);
    }
  });

  ws.on('message', (data: WebSocket.Data) => {
    try {
      const event = JSON.parse(data.toString());
      processWsEvent(event);
    } catch {}
  });

  ws.on('error', (error) => {
    logError('CLOB WebSocket error:', error);
  });

  ws.on('close', () => {
    // Only the currently-active socket should trigger reconnect logic
    if (ws !== clobSocket) return;

    log('🔌 CLOB disconnected, reconnecting in 5s...');
    setTimeout(() => {
      if (running) connectToClob();
    }, 5000);
  });
}

function processWsEvent(data: any): void {
  const eventType = data.event_type;

  if (eventType === 'book') {
    const assetId = data.asset_id;
    const marketInfo = tokenToMarket.get(assetId);
    if (!marketInfo) return;

    const market = markets.get(marketInfo.slug);
    if (!market) return;

    const rawAsks = (data.asks || []) as any[];
    const rawBids = (data.bids || []) as any[];

    // =========================================================================
    // V36: PARSE FULL ORDERBOOK DEPTH (not just top-of-book)
    // =========================================================================
    const depth = parseBookEvent({
      event_type: 'book',
      asset_id: assetId,
      bids: rawBids,
      asks: rawAsks,
    });
    
    // Store full depth for later analysis
    orderbookDepth.set(assetId, depth);
    
    // Update V36 quoting engine with full depth
    const v36Engine = getV36QuotingEngine();
    v36Engine.updateDepth(market.slug, marketInfo.side, rawBids, rawAsks);
    
    // Also update market best bid/ask for backwards compatibility
    if (marketInfo.side === 'UP') {
      if (depth.bestBid > 0) market.upBestBid = depth.bestBid;
      if (depth.bestAsk < 1) market.upBestAsk = depth.bestAsk;
    } else {
      if (depth.bestBid > 0) market.downBestBid = depth.bestBid;
      if (depth.bestAsk < 1) market.downBestAsk = depth.bestAsk;
    }
    market.lastUpdated = new Date();
    
    // Log depth summary periodically (every ~10 updates)
    if (Math.random() < 0.1) {
      const bidLevels = depth.bids.length;
      const askLevels = depth.asks.length;
      log(`📚 DEPTH ${marketInfo.side}: ${bidLevels} bids / ${askLevels} asks | Best: $${depth.bestBid.toFixed(2)}/$${depth.bestAsk.toFixed(2)} | Total: ${depth.bidDepth.toFixed(0)}/${depth.askDepth.toFixed(0)} shares`);
    }
  }

  // IMPORTANT: Do NOT infer fills from the public market WebSocket.
  // We persist fills exclusively from the authenticated User WebSocket to prevent
  // double-counting (same fill arriving via multiple channels) and DB duplication.
  //
  // The public feed can still be useful for generic market telemetry, but it should
  // not drive our own fill/inventory accounting.
}

// ============================================================
// FILL HANDLER (from User WebSocket) - WITH PAIR TRACKING
// ============================================================

/**
 * Handle fills received from the authenticated User WebSocket
 * V37: Simplified - just update pair tracker
 */
async function handleFillFromUserWs(fill: V35Fill): Promise<void> {
  const market = markets.get(fill.marketSlug);
  if (!market) {
    log(`⚠️ Fill for unknown market: ${fill.marketSlug}`);
    return;
  }

  log(`🎯 [UserWS] FILL: ${fill.side} ${fill.size.toFixed(0)} @ $${fill.price.toFixed(2)} in ${fill.marketSlug.slice(-25)}`);
  
  // V37: Update pair tracker with the fill
  const pairTracker = getPairTracker();
  pairTracker.onFill(fill);
  
  // Update local inventory tracking
  const processed = processFillInventoryOnly(fill, market);
  
  if (processed) {
    // Persist fill to database
    saveV35Fill(fill).catch(err => {
      logError('Failed to save fill:', err);
    });
    
    // Remove the filled order from our tracking (if we know about it)
    const currentOrders = fill.side === 'UP' ? market.upOrders : market.downOrders;
    if (fill.orderId && currentOrders.has(fill.orderId)) {
      currentOrders.delete(fill.orderId);
    }
    
    // V35.3.1: Log inventory snapshot after each fill cycle
    const unpaired = Math.abs(market.upQty - market.downQty);
    const paired = Math.min(market.upQty, market.downQty);
    const avgUp = market.upQty > 0 ? market.upCost / market.upQty : null;
    const avgDown = market.downQty > 0 ? market.downCost / market.downQty : null;
    const pairCost = (avgUp !== null && avgDown !== null) ? avgUp + avgDown : null;
    
    // Determine state based on imbalance
    let state: 'BALANCED' | 'WARNING' | 'CRITICAL' = 'BALANCED';
    if (unpaired >= 35) state = 'CRITICAL';
    else if (unpaired >= 20) state = 'WARNING';
    
    const snapshot: V35InventorySnapshot = {
      marketSlug: market.slug,
      asset: market.asset,
      upShares: market.upQty,
      downShares: market.downQty,
      avgUpCost: avgUp,
      avgDownCost: avgDown,
      pairedShares: paired,
      unpairedShares: unpaired,
      unpairedNotionalUsd: unpaired * 0.50, // Rough estimate at midpoint
      pairCost,
      state,
      triggerType: 'FILL',
    };
    
    saveV35InventorySnapshot(snapshot).catch(err => {
      logError('Failed to save inventory snapshot:', err);
    });
  }
}

// ============================================================
// MARKET MANAGEMENT
// ============================================================

async function refreshMarkets(forceSearch: boolean = false): Promise<void> {
  const config = getV35Config();
  
  // Check if we have room for more markets
  // V36.11.0: Allow forceSearch to bypass this check (used after market expiry)
  if (!forceSearch && markets.size >= config.maxMarkets) {
    log(`📊 At max markets (${markets.size}/${config.maxMarkets})`);
    return;
  }
  
  // Discover new markets - use stopBeforeExpirySec directly (no extra margin)
  // The market processing loop will handle the stop-before-expiry logic
  const minExpiry = config.stopBeforeExpirySec;
  log(`🔍 Searching for markets with >= ${minExpiry}s to expiry...`);
  const discovered = await discoverMarkets(minExpiry);
  log(`📋 Discovery returned ${discovered.length} markets`);
  
  const assets: V35Asset[] = ['BTC']; // Only BTC allowed
  const filtered = filterByAssets(discovered, assets);
  log(`🎯 After BTC filter: ${filtered.length} markets`);
  
  if (filtered.length === 0) {
    log(`⚠️ No BTC markets found! Available assets: ${discovered.map(m => m.asset).join(', ')}`);
  }
  
  let added = 0;
  // Add new markets (up to max)
  for (const m of filtered) {
    if (markets.size >= config.maxMarkets) {
      log(`📊 Skipping ${m.slug}: at max markets`);
      break;
    }
    if (markets.has(m.slug)) {
      // V36.8.1: Update strike price if we didn't have it before
      const existingMarket = markets.get(m.slug)!;
      if (!existingMarket.strikePrice && m.strikePrice) {
        existingMarket.strikePrice = m.strikePrice;
        log(`📊 Updated strike price for ${m.slug}: $${m.strikePrice.toFixed(2)}`);
      }
      continue;
    }
    
    const market = createEmptyMarket(
      m.slug,
      m.conditionId,
      m.upTokenId,
      m.downTokenId,
      m.asset,
      m.expiry,
      m.strikePrice  // V36.8.1: Pass strike price from discovery
    );
    
    // CRITICAL: Register market with position cache for real-time position tracking
    registerMarketForCache(m.slug, m.conditionId, m.upTokenId, m.downTokenId);
    
    // CRITICAL V35.1.2: Check if we have PRE-EXISTING positions in this market
    // This happens when runner restarts mid-market
    const existingPos = getCachedPosition(m.slug);
    if (existingPos) {
      const existingImbalance = Math.abs(existingPos.upShares - existingPos.downShares);
      if (existingImbalance >= config.maxUnpairedShares) {
        log(`🚨 REFUSING TO TRADE ${m.slug}: Pre-existing imbalance of ${existingImbalance.toFixed(1)} shares > max ${config.maxUnpairedShares}`);
        log(`   UP: ${existingPos.upShares.toFixed(1)}, DOWN: ${existingPos.downShares.toFixed(1)}`);
        log(`   ⚠️ Close this position manually before the bot will trade this market`);
        continue; // Skip this market entirely
      }
      // Sync existing positions to internal state
      market.upQty = existingPos.upShares;
      market.downQty = existingPos.downShares;
      market.upCost = existingPos.upCost;
      market.downCost = existingPos.downCost;
      log(`📊 Synced existing position for ${m.slug}: UP=${existingPos.upShares.toFixed(1)} DOWN=${existingPos.downShares.toFixed(1)}`);
      
      // CRITICAL V36.4.0: SYNC EXPOSURE LEDGER!
      // Without this, the 100-share caps are completely ignored because the ledger thinks position is 0/0
      syncPositionToLedger(m.conditionId, m.asset as V35Asset, existingPos.upShares, existingPos.downShares);
      log(`🔒 Synced exposure ledger: UP=${existingPos.upShares.toFixed(1)} DOWN=${existingPos.downShares.toFixed(1)}`);
    }
    
    markets.set(m.slug, market);
    
    // V35.7.0: Schedule expiry snapshot for this market (1 second before expiry)
    scheduleExpirySnapshot(market);
    
    log(`➕ Added market: ${m.slug} (${m.asset}, expires ${m.expiry.toISOString()})`);
    added++;
  }
  
  // Rebuild token map and reconnect if new markets were added
  if (added > 0) {
    buildTokenMap();

    // IMPORTANT: On restarts we lose local order maps, but remote open orders may still exist.
    // Reconcile immediately after adding markets so syncOrders doesn't place duplicates.
    if (!config.dryRun) {
      try {
        log('🔄 Reconcile after market discovery (prevent order stacking)...');
        const { cleaned, added: remoteAdded } = await reconcileOrders(markets, config.dryRun);
        lastReconcileTime = Date.now();
        if (cleaned > 0 || remoteAdded > 0) {
          log(`🔄 Discovery reconcile: cleaned=${cleaned} added=${remoteAdded}`);
        }
      } catch (err: any) {
        logError('Discovery reconcile failed (will retry in main loop):', err);
      }
    }

    // Reconnect WS with new tokens
    if (clobSocket) {
      clobSocket.close();
    }
    connectToClob();
  }
}

/**
 * V36.11.0: Cleanup expired markets and immediately search for new ones
 * CRITICAL FIX: Returns true if markets were removed (triggers immediate refresh)
 */
async function cleanupExpiredMarkets(): Promise<boolean> {
  const now = Date.now();
  const circuitBreaker = getCircuitBreaker();
  const pairTracker = getPairTracker();
  let removed = 0;
  
  for (const [slug, market] of markets.entries()) {
    if (market.expiry.getTime() < now) {
      // Market expired - log settlement
      const metrics = calculateMarketMetrics(market);
      
      log(`🏁 SETTLED ${slug.slice(-35)}`);
      log(`   Paired: ${metrics.paired.toFixed(0)} | Combined: $${metrics.combinedCost.toFixed(3)} | Locked: $${metrics.lockedProfit.toFixed(2)}`);
      
      // V36.1: Log pair tracker stats for this market before cleanup
      const pairStats = pairTracker.getStats();
      if (pairStats.completedPairs > 0) {
        log(`   📦 Pairs: ${pairStats.completedPairs} completed | P&L: $${pairStats.totalPnl.toFixed(2)} | Avg CPP: $${pairStats.avgCpp.toFixed(3)}`);
      }
      
      // V36.3.6: CRITICAL - Reset all pairs for this expired market!
      // This prevents stale pairs from blocking new trades in the next cycle
      const resetResult = pairTracker.resetMarketPairs(slug);
      if (resetResult.reset > 0) {
        log(`   🔄 Reset ${resetResult.reset} stale pairs for expired market`);
      }
      
      // V35.4.0: Clear any ban for this market (it's expired, we'll get a new one)
      circuitBreaker.clearMarketBan(slug);
      
      // Determine winning side (we don't know actual outcome, so log as unknown)
      saveV35Settlement({
        marketSlug: slug,
        asset: market.asset,
        upQty: market.upQty,
        downQty: market.downQty,
        upCost: market.upCost,
        downCost: market.downCost,
        paired: metrics.paired,
        unpaired: metrics.unpaired,
        combinedCost: metrics.combinedCost,
        lockedProfit: metrics.lockedProfit,
        winningSide: null, // Unknown at expiry time
        pnl: metrics.lockedProfit, // Best estimate
      }).catch(() => {});
      
      // Remove from token map
      tokenToMarket.delete(market.upTokenId);
      tokenToMarket.delete(market.downTokenId);
      
      // CRITICAL: Unregister from position cache
      unregisterMarketFromCache(market.conditionId, market.upTokenId, market.downTokenId);
      
      // CRITICAL V36.4.0: Clear exposure ledger for this market
      // Without this, stale data persists and affects future cap checks
      clearLedgerMarket(market.conditionId, market.asset);
      
      // V35.7.0: Cancel any pending expiry snapshot (though it should have fired already)
      cancelExpirySnapshot(slug);
      
      markets.delete(slug);
      removed++;
    }
  }
  
  // V36.1: Clean up completed pairs (older than 5 minutes)
  pairTracker.cleanup();
  
  if (removed > 0) {
    log(`🗑️ Removed ${removed} expired markets`);
    
    // V35.4.0: Check if circuit breaker can be fully reset (no more banned markets)
    const bannedMarkets = circuitBreaker.getBannedMarkets();
    if (bannedMarkets.length === 0 && circuitBreaker.isTripped()) {
      log(`✅ All banned markets expired - circuit breaker auto-reset`);
      circuitBreaker.reset();
    }
    
    // V36.11.0: CRITICAL - Immediately search for the next market!
    // Don't wait for the 60s refresh interval
    log(`🔄 V36.11.0: Market expired - immediately searching for next market...`);
    await refreshMarkets(true); // forceSearch=true bypasses maxMarkets check
  }
  
  return removed > 0;
}

// ============================================================
// MARKET PROCESSING - V35.3.0 CIRCUIT BREAKER INTEGRATED
// ============================================================

async function processMarket(market: V35Market): Promise<void> {
  const config = getV35Config();
  const circuitBreaker = getCircuitBreaker();
  const now = Date.now();
  const secondsToExpiry = (market.expiry.getTime() - now) / 1000;
  
  // =========================================================================
  // V35.4.0: CHECK IF THIS SPECIFIC MARKET IS BANNED
  // =========================================================================
  // If this market is banned, skip it and wait for next cycle
  // Other markets can still trade normally
  // =========================================================================
  if (circuitBreaker.isMarketBanned(market.slug)) {
    log(`⏭️ SKIPPING banned market: ${market.slug.slice(-25)}`);
    log(`   → Waiting for market to expire, then next cycle starts fresh`);
    await cancelAllOrders(market, config.dryRun);
    return;
  }
  
  // =========================================================================
  // V35.8.1: AUTHORITATIVE POSITION SYNC - API IS GROUND TRUTH
  // =========================================================================
  // CRITICAL FIX V35.8.1: The sync was not firing because lastFetchedAtMs was
  // being checked incorrectly. Now we ALWAYS sync if we have cached data.
  // 
  // The position cache refreshes every 1 second from Polymarket API.
  // If we have ANY cached data, it's more accurate than local state.
  // =========================================================================
  const cachedPos = getCachedPosition(market.slug);
  
  // V35.8.1: Log cache status for debugging
  const cacheAge = cachedPos ? (Date.now() - cachedPos.lastFetchedAtMs) : -1;
  
  if (cachedPos) {
    const localUp = market.upQty;
    const localDown = market.downQty;
    const apiUp = cachedPos.upShares;
    const apiDown = cachedPos.downShares;
    
    const driftUp = Math.abs(localUp - apiUp);
    const driftDown = Math.abs(localDown - apiDown);
    
    // V35.8.1: Log cache state every 30 seconds for debugging
    const shouldLogCacheState = Math.random() < 0.03; // ~3% of calls = roughly every 30s at 1s intervals
    if (shouldLogCacheState || driftUp > 1 || driftDown > 1) {
      log(`🔄 POSITION STATE: Local (UP=${localUp.toFixed(1)} DOWN=${localDown.toFixed(1)}) | API (UP=${apiUp.toFixed(1)} DOWN=${apiDown.toFixed(1)}) | Cache age: ${cacheAge}ms`);
    }
    
    // ALWAYS sync to API values if there's ANY drift - Polymarket is ground truth
    // This fixes both under-counting (missed fills) AND over-counting (duplicate fills)
    if (driftUp > 0.5) {
      log(`📊 SYNC UP: ${localUp.toFixed(1)} → ${apiUp.toFixed(1)} (drift=${driftUp.toFixed(1)})`);
      market.upQty = apiUp;
      market.upCost = cachedPos.upCost;
    }
    if (driftDown > 0.5) {
      log(`📊 SYNC DOWN: ${localDown.toFixed(1)} → ${apiDown.toFixed(1)} (drift=${driftDown.toFixed(1)})`);
      market.downQty = apiDown;
      market.downCost = cachedPos.downCost;
    }
    
    // CRITICAL V36.4.0: SYNC EXPOSURE LEDGER EVERY CYCLE!
    // Without this, the 100-share caps are ignored because ledger drifts from reality
    // This ensures caps are enforced based on ACTUAL Polymarket positions, not stale local state
    syncPositionToLedger(market.conditionId, market.asset, apiUp, apiDown);
  } else {
    // V35.8.1: Log when cache is not available
    log(`⚠️ No cached position for ${market.slug.slice(-25)} - using local state`);
  }
  
  // =========================================================================
  // V36.2.3: CIRCUIT BREAKER - DISABLED IN PAIR-BASED MODE
  // =========================================================================
  // In V36 pair-based mode, the PairTracker manages its own exposure.
  // The legacy circuit breaker interferes by:
  // 1. Blocking trades when UP > DOWN (which is EXPECTED in pair mode!)
  // 2. Calling the disabled rebalancer
  // 3. Logging useless BALANCE_GUARD events
  //
  // DISABLED: Skip circuit breaker checks entirely in pair-based mode.
  // The PairTracker enforces its own limits (maxPendingPairs).
  // =========================================================================
  // const safetyCheck = await circuitBreaker.checkMarket(market, config.dryRun);
  const safetyCheck = { shouldStop: false, shouldBlockUp: false, shouldBlockDown: false, reason: null };
  
  // Stop quoting if too close to expiry
  if (secondsToExpiry < config.stopBeforeExpirySec) {
    log(`⏱️ ${market.slug.slice(-25)}: STOP (${secondsToExpiry.toFixed(0)}s to expiry)`);
    await cancelAllOrders(market, config.dryRun);
    return;
  }
  
  // =========================================================================
  // V36.2: PROACTIVE REBALANCER - DISABLED IN PAIR-BASED MODE
  // =========================================================================
  // In V36.2 pair-based mode, the PairTracker handles ALL entries.
  // The ProactiveRebalancer would buy on the "lagging" side independently,
  // creating untracked exposure and breaking the pair invariant (UP >= DOWN).
  // 
  // DISABLED: Do not run proactive rebalancer in pair-based mode.
  // =========================================================================
  const rebalanceResult = { attempted: false, hedged: false } as any;
  // const rebalancer = getProactiveRebalancer();
  // const rebalanceResult = await rebalancer.checkAndRebalance(market);
  
  if (rebalanceResult.attempted && rebalanceResult.hedged) {
    log(`🔄 PROACTIVE HEDGE: ${rebalanceResult.hedgeQty?.toFixed(0)} ${rebalanceResult.hedgeSide} @ $${rebalanceResult.hedgePrice?.toFixed(3)}`);

    // IMPORTANT:
    // The rebalancer mutates `market` in-place when it confirms a fill.
    // Double-applying here would exaggerate imbalance and trigger more unwanted rebalances.
    if (!rebalanceResult.stateUpdated) {
      // Backwards-compatibility fallback (older rebalancer versions)
      if (rebalanceResult.hedgeSide === 'UP') {
        market.upQty += rebalanceResult.hedgeQty || 0;
        market.upCost += (rebalanceResult.hedgeQty || 0) * (rebalanceResult.hedgePrice || 0);
      } else if (rebalanceResult.hedgeSide === 'DOWN') {
        market.downQty += rebalanceResult.hedgeQty || 0;
        market.downCost += (rebalanceResult.hedgeQty || 0) * (rebalanceResult.hedgePrice || 0);
      }
    }
    // Re-check circuit breaker after hedging - DISABLED in V36.2.3
    // const recheckSafety = await circuitBreaker.checkMarket(market, config.dryRun);
    // if (!recheckSafety.shouldStop && safetyCheck.shouldStop) {
    //   log(`✅ CIRCUIT BREAKER RECOVERED after proactive hedge!`);
    // }
  }
  
  // =========================================================================
  // V36.2: EMERGENCY RECOVERY - DISABLED IN PAIR-BASED MODE
  // =========================================================================
  // In V36.2 pair-based mode, emergency hedging is handled by the PairTracker
  // via Binance reversal detection. The legacy emergency recovery would buy
  // on the "lagging" side independently, breaking the pair invariant.
  // 
  // DISABLED: Do not run emergency recovery in pair-based mode.
  // =========================================================================
  // const unpaired = Math.abs(market.upQty - market.downQty);
  // if (!rebalanceResult.hedged && unpaired >= 20) {
  //   const emergencyRecovery = getEmergencyRecovery();
  //   const recoveryResult = await emergencyRecovery.checkAndRecover(market);
  //   ...
  // }
  
  // V36.2.3: Circuit breaker halt check DISABLED - pair tracker manages exposure
  // if (safetyCheck.shouldStop && !rebalanceResult.hedged) {
  //   log(`🚨 ${market.slug.slice(-25)}: CIRCUIT BREAKER HALT - ${safetyCheck.reason}`);
  //   log(`   💡 Proactive rebalancer checked - hedge not yet viable`);
  //   return; // Do not place new quotes, but we tried to hedge
  // }
  
  // Update orderbook
  await updateOrderbook(market, config.dryRun);
  
  // Queue orderbook snapshot for logging
  queueOrderbookSnapshot(market);
  
  // =========================================================================
  // V36.3.7: LOG INVENTORY SNAPSHOT EVERY TICK
  // =========================================================================
  // Log inventory snapshot on every tick (not just after fills) so the dashboard
  // can show real-time position accumulation and bot decision-making.
  // =========================================================================
  const unpaired = Math.abs(market.upQty - market.downQty);
  const paired = Math.min(market.upQty, market.downQty);
  const avgUp = market.upQty > 0 ? market.upCost / market.upQty : 0;
  const avgDown = market.downQty > 0 ? market.downCost / market.downQty : 0;
  const cpp = (market.upQty > 0 && market.downQty > 0) ? avgUp + avgDown : 0;
  
  let inventoryState = 'FLAT';
  if (paired > 0 && unpaired < 5) inventoryState = 'PAIRED';
  else if (paired > 0 && unpaired >= 5) inventoryState = 'IMBALANCED';
  else if (unpaired >= 20) inventoryState = 'WARNING';
  else if (unpaired >= 50) inventoryState = 'CRITICAL';
  
  const tickSnapshot: V35InventorySnapshot = {
    marketSlug: market.slug,
    asset: market.asset,
    upShares: market.upQty,
    downShares: market.downQty,
    avgUpCost: avgUp,
    avgDownCost: avgDown,
    combinedCost: cpp,
    state: inventoryState,
    triggerType: 'TICK',
  };
  
  saveV35InventorySnapshot(tickSnapshot).catch(err => {
    // Silent fail - we log many ticks, don't spam errors
  });
  
  // =========================================================================
  // V37: SIMPLE PAIR OPENING - NO REVERSALS, NO GUARDS, NO COMPLEXITY
  // =========================================================================
  const pairTracker = getPairTracker();
  
  // Log pair stats
  const waitingPairs = pairTracker.getWaitingPairs().length;
  log(`   📦 V37 Pairs: ${waitingPairs}/10 WAITING_HEDGE`);
  
  // Calculate metrics
  const metrics = calculateMarketMetrics(market);
  
  // Log status
  const binanceFeed = getBinanceFeed();
  const momentum = binanceFeed?.getMomentum(market.asset) || 0;
  const trend = binanceFeed?.getTrendDirection(market.asset) || 'FLAT';
  const trendIndicator = trend === 'UP' ? '📈' : trend === 'DOWN' ? '📉' : '➡️';
  
  log(
    `📊 ${market.slug.slice(-25)} | ` +
    `UP:${metrics.upQty.toFixed(0)} DOWN:${metrics.downQty.toFixed(0)} | ` +
    `Cost:$${(metrics.upCost + metrics.downCost).toFixed(0)} | ` +
    `CPP:$${metrics.combinedCost.toFixed(3)} | ` +
    `${trendIndicator}${momentum.toFixed(2)}%`
  );
  
  // =========================================================================
  // V37: SIMPLE PAIR OPENING
  // =========================================================================
  // Every tick: try to open a pair
  // - Buy expensive side as TAKER
  // - Place MAKER at 100 - takerPrice - 5c
  // =========================================================================
  if (!paused && market.asset === 'BTC') {
    // Determine expensive side based on current asks
    const upAsk = market.upBestAsk || 1;
    const downAsk = market.downBestAsk || 1;
    const expensiveSide: 'UP' | 'DOWN' = downAsk > upAsk ? 'DOWN' : 'UP';
    const cheapSide: 'UP' | 'DOWN' = expensiveSide === 'UP' ? 'DOWN' : 'UP';
    
    // Get prices for logging
    const takerPrice = expensiveSide === 'UP' ? upAsk : downAsk;
    const makerPrice = 1.00 - takerPrice - 0.05; // 5c margin
    
    log(`   📊 V37 Analysis:`);
    log(`      TAKER ${expensiveSide} @ ~$${takerPrice.toFixed(3)}`);
    log(`      MAKER ${cheapSide} @ ~$${makerPrice.toFixed(3)} (100 - ${takerPrice.toFixed(2)} - 5c)`);
    log(`      TARGET CPP: $0.95`);
    
    // Try to open a pair (respects 5s cooldown + max 10 pairs)
    if (pairTracker.canOpenNewPair()) {
      const pairSize = 10; // Fixed 10 shares per pair
      
      log(`   🎯 V37: Opening pair...`);
      
      const pairResult = await pairTracker.openPair(market, expensiveSide, pairSize);
      
      if (pairResult.success) {
        log(`   ✅ Pair ${pairResult.pairId} opened!`);
      } else {
        log(`   ⚠️ Pair failed: ${pairResult.error}`);
      }
    } else {
      log(`   ⏸️ Waiting (cooldown or max pairs)`);
    }
  }
}

// ============================================================
// PORTFOLIO SUMMARY
// ============================================================

function getPortfolioMetrics(): V35PortfolioMetrics {
  const config = getV35Config();
  
  let totalUpQty = 0;
  let totalDownQty = 0;
  let totalCost = 0;
  let totalPaired = 0;
  let totalUnpaired = 0;
  let totalLockedProfit = 0;
  let marketsAtLimit = 0;
  
  for (const market of markets.values()) {
    const metrics = calculateMarketMetrics(market);
    totalUpQty += metrics.upQty;
    totalDownQty += metrics.downQty;
    totalCost += metrics.upCost + metrics.downCost;
    totalPaired += metrics.paired;
    totalUnpaired += metrics.unpaired;
    totalLockedProfit += metrics.lockedProfit;
    
    if (metrics.unpaired >= config.maxUnpairedImbalance * 0.9) {
      marketsAtLimit++;
    }
  }
  
  return {
    totalUpQty,
    totalDownQty,
    totalCost,
    totalPaired,
    totalUnpaired,
    totalLockedProfit,
    marketCount: markets.size,
    exposureUsedPct: config.maxTotalExposure > 0 
      ? (totalCost / config.maxTotalExposure) * 100 
      : 0,
    marketsAtImbalanceLimit: marketsAtLimit,
  };
}

function logPortfolioSummary(): void {
  if (markets.size === 0) return;
  
  const p = getPortfolioMetrics();
  const config = getV35Config();
  
  log(
    `📈 PORTFOLIO | ` +
    `Markets:${p.marketCount} | ` +
    `Paired:${p.totalPaired.toFixed(0)} | ` +
    `Exposure:${p.exposureUsedPct.toFixed(0)}% | ` +
    `Locked:$${p.totalLockedProfit.toFixed(2)}`
  );
}

// ============================================================
// HEARTBEAT
// ============================================================

async function sendHeartbeat(): Promise<void> {
  const config = getV35Config();
  const p = getPortfolioMetrics();
  
  try {
    // Update balance
    const balanceResult = await getBalance();
    if (typeof balanceResult.balance === 'number') {
      balance = balanceResult.balance;
    }
  } catch {
    // Ignore balance errors
  }
  
  // V35.3.2: Log order tracking stats to verify filtering is working
  const orderStats = getOrderTrackingStats();
  if (orderStats.fillsReceived > 0) {
    const rejectPct = orderStats.fillsRejected > 0 
      ? ((orderStats.fillsRejected / orderStats.fillsReceived) * 100).toFixed(0)
      : '0';
    log(`🔐 Order Filter Stats: ${orderStats.trackedOrders} tracked | Accepted: ${orderStats.fillsAccepted} | Rejected: ${orderStats.fillsRejected} (${rejectPct}% from other traders)`);
  }
  
  await sendV35Heartbeat({
    runnerId: RUN_ID,
    mode: config.mode,
    dryRun: config.dryRun,
    marketsCount: p.marketCount,
    totalPaired: p.totalPaired,
    totalUnpaired: p.totalUnpaired,
    totalLockedProfit: p.totalLockedProfit,
    balance,
  });
}

// ============================================================
// MAIN LOOP
// ============================================================

// Track last balance check time
let lastBalanceCheckTime = 0;
const BALANCE_CHECK_INTERVAL_MS = 60_000; // Check balance every 60 seconds
const MIN_BALANCE_REQUIRED = 5; // Minimum $5 USDC to operate

async function mainLoop(): Promise<void> {
  const config = getV35Config();
  
  while (running) {
    try {
      // Check total exposure
      const p = getPortfolioMetrics();
      if (p.totalCost >= config.maxTotalExposure) {
        log(`⚠️ MAX TOTAL EXPOSURE REACHED: $${p.totalCost.toFixed(0)}`);
      }
      
      const now = Date.now();
      
      // =================================================================
      // PERIODIC BALANCE CHECK - Pause if insufficient funds
      // =================================================================
      if (now - lastBalanceCheckTime > BALANCE_CHECK_INTERVAL_MS && !config.dryRun) {
        try {
          const balanceResult = await getBalance();
          if (typeof balanceResult.balance === 'number') {
            balance = balanceResult.balance;
            
            // Auto-pause if balance too low
            if (balance < MIN_BALANCE_REQUIRED && !paused) {
              log(`⚠️ INSUFFICIENT BALANCE: $${balance.toFixed(2)} < $${MIN_BALANCE_REQUIRED} minimum`);
              log(`   PAUSING trading. Add USDC to resume.`);
              paused = true;
            }
            // Auto-resume if balance recovered
            else if (balance >= MIN_BALANCE_REQUIRED && paused) {
              log(`✅ Balance recovered: $${balance.toFixed(2)} — RESUMING trading`);
              paused = false;
            }
          } else if (balanceResult.error) {
            log(`⚠️ Balance check error: ${balanceResult.error}`);
          }
        } catch (err: any) {
          log(`⚠️ Balance check failed: ${err?.message}`);
        }
        lastBalanceCheckTime = now;
      }
      
      // =================================================================
      // ORDER RECONCILIATION - Sync local tracking with Polymarket API
      // Runs every 30 seconds to prevent order stacking from missed fills
      // =================================================================
      if (now - lastReconcileTime > RECONCILE_INTERVAL_MS && !config.dryRun) {
        log('🔄 Running order reconciliation...');
        const { cleaned, added } = await reconcileOrders(markets, config.dryRun);
        lastReconcileTime = now;
        if (cleaned > 0 || added > 0) {
          log(`🔄 Reconciliation complete: ${cleaned} stale orders cleaned, ${added} missing orders added`);
        }
      }
      
      // Process each market
      for (const market of markets.values()) {
        await processMarket(market);
      }
      
      // Cleanup expired markets (V36.11.0: now async - triggers immediate refresh if market expired)
      await cleanupExpiredMarkets();
      
      // Log portfolio summary
      logPortfolioSummary();
      
      // Wait for next cycle
      await sleep(config.refreshIntervalMs);
      
    } catch (err: any) {
      logError('Main loop error:', err);
      await sleep(10000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// CONTROL METHODS
// ============================================================

function pause(): void {
  paused = true;
  log('⏸️ PAUSED - Cancelling all orders...');
  
  const config = getV35Config();
  for (const market of markets.values()) {
    cancelAllOrders(market, config.dryRun).catch(() => {});
  }
}

function resume(): void {
  paused = false;
  log('▶️ RESUMED - Quoting active');
}

async function stop(): Promise<void> {
  log('🛑 STOPPING...');
  running = false;
  
  // Close WebSockets
  if (clobSocket) {
    clobSocket.close();
    clobSocket = null;
  }
  
  // Stop User WebSocket
  stopUserWebSocket();
  
  // Stop Binance feed
  stopBinanceFeed();
  
  // Stop position cache
  stopPositionCache();
  
  // V35.7.0: Cancel all scheduled expiry snapshots
  cancelAllExpirySnapshots();
  
  const config = getV35Config();
  for (const market of markets.values()) {
    await cancelAllOrders(market, config.dryRun);
  }
  
  // Release runner lease
  await releaseLease(RUNNER_ID);
  
  await sendV35Offline(RUN_ID);
  log('🛑 STOPPED');
}

// ============================================================
// STARTUP
// ============================================================

async function main(): Promise<void> {
  console.log('\n' + '='.repeat(65));
  console.log(`  V35 PASSIVE DUAL-OUTCOME MARKET MAKER — ${VERSION}`);
  console.log('='.repeat(65) + '\n');
  
  // Load config from environment
  const mode = (process.env.V35_MODE || 'safe') as V35Mode;
  loadV35Config(mode);
  
  // Apply overrides from environment
  if (process.env.V35_DRY_RUN === 'true') {
    setV35ConfigOverrides({ dryRun: true });
  }
  if (process.env.V35_MAX_MARKETS) {
    setV35ConfigOverrides({ maxMarkets: parseInt(process.env.V35_MAX_MARKETS, 10) });
  }
  
  const config = getV35Config();
  printV35Config(config);
  
  if (config.dryRun) {
    log('🧪 DRY RUN MODE - No real orders will be placed');
  }
  
  // Set runner identity for order-guard (authorizes V35 to place orders)
  setRunnerIdentity('v35');
  
  // VPN check (exits if VPN not connected)
  await checkVpnRequired();
  
  // Acquire exclusive runner lease (prevents multiple runners)
  const forceLease = process.env.FORCE_LEASE === '1' || process.env.FORCE_TAKEOVER === '1';
  if (forceLease) {
    log('⚡ FORCE_LEASE detected - will override existing lease');
  }
  log('🔒 Acquiring exclusive runner lease...');
  const leaseAcquired = await acquireLeaseOrHalt(RUNNER_ID, forceLease);
  if (!leaseAcquired) {
    logError('Another runner holds the lease. Use FORCE_LEASE=1 to override.');
    process.exit(1);
  }
  log('✅ Exclusive runner lease acquired');
  
  // Validate credentials
  if (!config.dryRun) {
    log('🔐 Validating API credentials...');
    const credsOk = await ensureValidCredentials();
    if (!credsOk) {
      logError('Credential validation failed - exiting');
      await releaseLease(RUNNER_ID);
      process.exit(1);
    }
    log('✅ Credentials validated');
    
    // Get initial balance
    const balanceResult = await getBalance();
    if (typeof balanceResult.balance === 'number') {
      balance = balanceResult.balance;
      log(`💰 Balance: $${balance.toFixed(2)}`);
      
      // CRITICAL: Pause if balance is too low to place any orders
      const MIN_BALANCE_REQUIRED = 5; // Minimum $5 USDC to operate
      if (balance < MIN_BALANCE_REQUIRED) {
        log(`⚠️ INSUFFICIENT BALANCE: $${balance.toFixed(2)} < $${MIN_BALANCE_REQUIRED} minimum`);
        log(`   The bot will start PAUSED. Add USDC to resume trading.`);
        paused = true;
      }
    } else if (balanceResult.error) {
      logError(`Balance check failed: ${balanceResult.error}`);
    }
  }
  
  // Initialize quoting engine
  quotingEngine = new QuotingEngine();
  
  // V35.7.0: Configure expiry snapshot callback to persist to database
  // V35.8.3: Added correct PnL calculation fields
  setSnapshotCallback((snapshot) => {
    // Convert to backend format and save
    const snapshotData: V35ExpirySnapshotData = {
      marketSlug: snapshot.marketSlug,
      asset: snapshot.asset,
      expiryTime: snapshot.expiryTime,
      snapshotTime: snapshot.snapshotTime,
      secondsBeforeExpiry: snapshot.secondsBeforeExpiry,
      apiUpQty: snapshot.apiUpQty,
      apiDownQty: snapshot.apiDownQty,
      apiUpCost: snapshot.apiUpCost,
      apiDownCost: snapshot.apiDownCost,
      localUpQty: snapshot.localUpQty,
      localDownQty: snapshot.localDownQty,
      localUpCost: snapshot.localUpCost,
      localDownCost: snapshot.localDownCost,
      paired: snapshot.paired,
      unpaired: snapshot.unpaired,
      combinedCost: snapshot.combinedCost,
      lockedProfit: snapshot.lockedProfit,
      avgUpPrice: snapshot.avgUpPrice,
      avgDownPrice: snapshot.avgDownPrice,
      upBestBid: snapshot.upBestBid,
      upBestAsk: snapshot.upBestAsk,
      downBestBid: snapshot.downBestBid,
      downBestAsk: snapshot.downBestAsk,
      combinedAsk: snapshot.combinedAsk,
      upOrdersCount: snapshot.upOrdersCount,
      downOrdersCount: snapshot.downOrdersCount,
      wasImbalanced: snapshot.wasImbalanced,
      imbalanceRatio: snapshot.imbalanceRatio,
      // NEW: Correct PnL calculation
      totalCost: snapshot.totalCost,
      predictedWinningSide: snapshot.predictedWinningSide,
      predictedFinalValue: snapshot.predictedFinalValue,
      predictedPnl: snapshot.predictedPnl,
      // NEW: Crossing analysis
      crossingCount: snapshot.crossingCount,
      spotPrice: snapshot.spotPrice,
      strikePrice: snapshot.strikePrice,
    };
    saveV35ExpirySnapshot(snapshotData).catch(err => {
      logError('Failed to save expiry snapshot:', err);
    });
  });
  log('📸 Expiry snapshot scheduler configured');

  // Wire HedgeManager -> immediate order cancellations when hedging is not viable / fails.
  // This prevents runaway one-sided inventory accumulation between market loop ticks.
  const hedgeManager = getHedgeManager();
  hedgeManager.on('cancelSide', async ({ marketSlug, side }: { marketSlug: string; side: 'UP' | 'DOWN' }) => {
    const m = markets.get(marketSlug);
    if (!m) return;
    const cfg = getV35Config();
    log(`🛑 [HedgeManager] cancelSide: cancelling ${side} orders for ${marketSlug.slice(-25)}`);
    try {
      await cancelSideOrders(m, side, cfg.dryRun);
    } catch (err: any) {
      logError(`[HedgeManager] cancelSideOrders failed (${side})`, err);
    }
  });
  
  // =========================================================
  // PRICE TICK LOGGING (for v35_price_ticks chart)
  // =========================================================
  // We log Binance spot price (throttled inside binance-feed) but persist it per-market.
  // This is independent of the momentum filter (which only changes decisioning).
  let lastPriceTickSaveErrorAt = 0;
  setPriceTickCallback((asset, price, ts) => {
    const ticks: V35PriceTickRow[] = [];
    for (const m of markets.values()) {
      if (m.asset !== asset) continue;
      ticks.push({
        market_slug: m.slug,
        asset,
        ts,
        spot_price: price,
        up_best_bid: m.upBestBid ? m.upBestBid : null,
        up_best_ask: m.upBestAsk ? m.upBestAsk : null,
        down_best_bid: m.downBestBid ? m.downBestBid : null,
        down_best_ask: m.downBestAsk ? m.downBestAsk : null,
        strike_price: m.strikePrice ?? null,  // V36.8.1: Use market's strike price
        run_id: RUN_ID,
      });
    }

    if (ticks.length === 0) return;

    saveV35PriceTicks(ticks)
      .then((ok) => {
        if (!ok) {
          const now = Date.now();
          if (now - lastPriceTickSaveErrorAt > 60_000) {
            lastPriceTickSaveErrorAt = now;
            logError('[PriceTicks] save failed (rate-limited)');
          }
        }
      })
      .catch(() => {
        const now = Date.now();
        if (now - lastPriceTickSaveErrorAt > 60_000) {
          lastPriceTickSaveErrorAt = now;
          logError('[PriceTicks] save threw (rate-limited)');
        }
      });
  });
  log('📊 Price tick logging enabled (Binance, every 5s per asset)');

  // Start Binance price feed (used for both momentum filter + price tick logging)
  log(
    config.enableMomentumFilter
      ? '📊 Starting Binance price feed (momentum filter + ticks)...'
      : '📊 Starting Binance price feed (ticks only; momentum filter disabled)...'
  );
  startBinanceFeed();
  // Give it a moment to connect
  await sleep(2000);
  
  // CRITICAL: Start price feed logger for Chainlink RTDS data
  // This logs real-time oracle prices to realtime_price_logs table
  // Required for accurate strike price determination in chainlink-price-collector
  log('📡 Starting price feed logger (Chainlink RTDS + Polymarket)...');
  startPriceFeedLogger();
  await sleep(1000);
  
  // =========================================================================
  // V35.1.2: CRITICAL STARTUP SEQUENCE
  // 1. Start position cache FIRST
  // 2. Wait for initial fetch to complete
  // 3. Only THEN discover markets (so we know pre-existing exposure)
  // =========================================================================
  log('🔄 Starting position cache (Polymarket API position sync)...');
  startPositionCache();
  // Give cache time to complete initial fetch - CRITICAL for position validation
  log('⏳ Waiting for position cache initial fetch (2s)...');
  await sleep(2000);
  
  // Now discover markets - the discovery will check pre-existing positions
  log('🔍 Discovering markets (will validate pre-existing positions)...');
  await refreshMarkets();
  log(`📊 Found ${markets.size} markets to trade (markets with excessive imbalance are excluded)`);
  
  if (markets.size === 0) {
    log('⚠️ No tradeable markets found. This could mean:');
    log('   - No active 15-min markets exist right now');
    log('   - All markets have pre-existing imbalance > maxUnpaired');
    log('   - Will retry on next market refresh cycle');
  }
  
  // Build token map and connect to WebSockets
  buildTokenMap();

  // CRITICAL STARTUP HYGIENE:
  // If the runner restarts, remote orders can still be open while our local maps are empty.
  // Reconciling BEFORE the first processMarket() prevents duplicating the entire grid.
  if (!config.dryRun && tokenToMarket.size > 0) {
    try {
      log('🔄 Initial order reconciliation (startup, prevent order stacking)...');
      const { cleaned, added } = await reconcileOrders(markets, config.dryRun);
      lastReconcileTime = Date.now();
      if (cleaned > 0 || added > 0) {
        log(`🔄 Startup reconcile: cleaned=${cleaned} added=${added}`);
      }
    } catch (err: any) {
      // If reconciliation fails, it's safer to PAUSE than to potentially place a duplicate full grid.
      paused = true;
      logError('Startup reconciliation FAILED — PAUSING to avoid order stacking. Fix network/API and resume.', err);
    }
  }

  if (tokenToMarket.size > 0 && !config.dryRun) {
    // Connect to public CLOB WebSocket for orderbook updates
    connectToClob();
    
    // Start authenticated User WebSocket for reliable fill tracking
    log('🔐 Starting authenticated User WebSocket for fill tracking...');
    startUserWebSocket(handleFillFromUserWs);
  }
  
  // Start running
  running = true;
  
  // Set up intervals
  const marketRefreshInterval = setInterval(() => {
    refreshMarkets().catch(err => logError('Market refresh failed:', err));
  }, 60000); // Every minute
  
  const heartbeatInterval = setInterval(() => {
    sendHeartbeat().catch(err => logError('Heartbeat failed:', err));
  }, 10000); // Every 10 seconds
  
  // Renew lease every 30 seconds
  const leaseRenewInterval = setInterval(() => {
    renewLease(RUNNER_ID).catch(err => logError('Lease renewal failed:', err));
  }, 30000);
  
  // Flush orderbook snapshots every 5 seconds
  const orderbookFlushInterval = setInterval(() => {
    flushOrderbookBuffer().catch(err => logError('Orderbook flush failed:', err));
  }, ORDERBOOK_LOG_INTERVAL_MS);
  
  // V35.10.1: Start auto-claim loop for winning positions (every 5 minutes)
  if (!config.dryRun) {
    log('💰 Starting auto-claim loop for winning positions (every 5 min)...');
    startAutoClaimLoop(5 * 60 * 1000);
  }
  
  // Handle shutdown
  const shutdown = async () => {
    console.log('\n');
    clearInterval(marketRefreshInterval);
    clearInterval(heartbeatInterval);
    clearInterval(leaseRenewInterval);
    clearInterval(orderbookFlushInterval);
    // Stop auto-claim loop
    stopAutoClaimLoop();
    // Stop price feed logger
    stopPriceFeedLogger();
    // Final flush before shutdown
    await flushOrderbookBuffer();
    await stop();
    process.exit(0);
  };
  
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  // Initial heartbeat
  await sendHeartbeat();
  
  // Run main loop
  log('🚀 Starting main loop...');
  await mainLoop();
}

// ============================================================
// ENTRY POINT
// ============================================================

main().catch(async (err) => {
  logError('Fatal error:', err);
  await releaseLease(RUNNER_ID);
  process.exit(1);
});
