// ============================================================
// V35 TYPES
// ============================================================

export type V35Asset = 'BTC' | 'ETH' | 'SOL' | 'XRP';
export type V35Side = 'UP' | 'DOWN';

// ============================================================
// Market Data
// ============================================================

export interface V35Market {
  slug: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  asset: V35Asset;
  expiry: Date;
  
  // V36.8.0: Strike price for dynamic margin calculation
  strikePrice?: number;
  
  // Orderbook state
  upBestBid: number;
  upBestAsk: number;
  downBestBid: number;
  downBestAsk: number;
  
  // Inventory
  upQty: number;
  downQty: number;
  upCost: number;
  downCost: number;
  
  // Active orders (orderId -> order details)
  upOrders: Map<string, V35Order>;
  downOrders: Map<string, V35Order>;
  
  // Stats
  upFills: number;
  downFills: number;
  
  // Timestamps
  addedAt: Date;
  lastUpdated: Date;
}

export interface V35Order {
  orderId: string;
  price: number;
  size: number;
  side: V35Side;
  placedAt: Date;
}

// ============================================================
// Fill Events
// ============================================================

export type V35FillType = 'MAKER' | 'TAKER';

export interface V35Fill {
  orderId: string;
  tokenId: string;
  side: V35Side;
  price: number;
  size: number;
  timestamp: Date;
  marketSlug: string;
  asset: V35Asset | string;
  fillType?: V35FillType;  // V36.8.0: Track whether this was a maker or taker fill
  tradeId?: string;        // V37.2.3: Unique trade ID for duplicate prevention
}

// ============================================================
// Quote Generation
// ============================================================

export interface V35Quote {
  price: number;
  size: number;
}

// ============================================================
// Status & Metrics
// ============================================================

export interface V35MarketMetrics {
  slug: string;
  asset: V35Asset;
  upQty: number;
  downQty: number;
  upCost: number;
  downCost: number;
  paired: number;
  unpaired: number;
  skew: number;
  combinedCost: number;
  lockedProfit: number;
  avgUpPrice: number;
  avgDownPrice: number;
  upFills: number;
  downFills: number;
  secondsToExpiry: number;
}

export interface V35PortfolioMetrics {
  totalUpQty: number;
  totalDownQty: number;
  totalCost: number;
  totalPaired: number;
  totalUnpaired: number;
  totalLockedProfit: number;
  marketCount: number;
  exposureUsedPct: number;
  marketsAtImbalanceLimit: number;
}

export interface V35Status {
  running: boolean;
  paused: boolean;
  mode: string;
  dryRun: boolean;
  marketsCount: number;
  portfolio: V35PortfolioMetrics;
  markets: V35MarketMetrics[];
}

// ============================================================
// Orderbook Depth (for logging)
// ============================================================

export interface V35OrderbookLevel {
  price: number;
  size: number;
}

export interface V35OrderbookSnapshot {
  ts: number;
  marketSlug: string;
  asset: V35Asset;
  upBestBid: number | null;
  upBestAsk: number | null;
  downBestBid: number | null;
  downBestAsk: number | null;
  combinedAsk: number | null;
  combinedMid: number | null;
  edge: number | null;
  upBids: V35OrderbookLevel[];
  upAsks: V35OrderbookLevel[];
  downBids: V35OrderbookLevel[];
  downAsks: V35OrderbookLevel[];
  spotPrice: number | null;
  strikePrice: number | null;
  secondsToExpiry: number | null;
}

// ============================================================
// Market Helpers
// ============================================================

export function createEmptyMarket(
  slug: string,
  conditionId: string,
  upTokenId: string,
  downTokenId: string,
  asset: V35Asset,
  expiry: Date,
  strikePrice?: number  // V36.8.1: Add strike price parameter
): V35Market {
  return {
    slug,
    conditionId,
    upTokenId,
    downTokenId,
    asset,
    expiry,
    strikePrice,  // V36.8.1: Pass through strike price
    upBestBid: 0,
    upBestAsk: 1,
    downBestBid: 0,
    downBestAsk: 1,
    upQty: 0,
    downQty: 0,
    upCost: 0,
    downCost: 0,
    upOrders: new Map(),
    downOrders: new Map(),
    upFills: 0,
    downFills: 0,
    addedAt: new Date(),
    lastUpdated: new Date(),
  };
}

export function calculateMarketMetrics(market: V35Market): V35MarketMetrics {
  const skew = market.upQty - market.downQty;
  const paired = Math.min(market.upQty, market.downQty);
  const unpaired = Math.abs(skew);
  
  const avgUpPrice = market.upQty > 0 ? market.upCost / market.upQty : 0;
  const avgDownPrice = market.downQty > 0 ? market.downCost / market.downQty : 0;
  
  const combinedCost = (market.upQty > 0 && market.downQty > 0)
    ? avgUpPrice + avgDownPrice
    : 0;
  
  const lockedProfit = (combinedCost > 0 && combinedCost < 1.0)
    ? paired * (1.0 - combinedCost)
    : 0;
  
  const secondsToExpiry = Math.max(0, (market.expiry.getTime() - Date.now()) / 1000);
  
  return {
    slug: market.slug,
    asset: market.asset,
    upQty: market.upQty,
    downQty: market.downQty,
    upCost: market.upCost,
    downCost: market.downCost,
    paired,
    unpaired,
    skew,
    combinedCost,
    lockedProfit,
    avgUpPrice,
    avgDownPrice,
    upFills: market.upFills,
    downFills: market.downFills,
    secondsToExpiry,
  };
}
