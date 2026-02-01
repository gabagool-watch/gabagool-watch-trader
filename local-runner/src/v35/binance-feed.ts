// ============================================================
// V35 BINANCE PRICE FEED
// ============================================================
// Real-time price feed from Binance for momentum detection.
// Prevents quoting when market is trending (exit liquidity protection).
// ============================================================

import WebSocket from 'ws';

export type V35Asset = 'BTC' | 'ETH' | 'SOL' | 'XRP';

interface PricePoint {
  price: number;
  time: number;
}

interface MomentumState {
  currentPrice: number;
  momentum: number; // Percentage change over lookback
  direction: 'UP' | 'DOWN' | 'NEUTRAL';
  isTrending: boolean;
  lastUpdate: number;
}

const BINANCE_WS_URL = 'wss://stream.binance.com:9443/stream';

const SYMBOL_MAP: Record<V35Asset, string> = {
  BTC: 'btcusdt',
  ETH: 'ethusdt',
  SOL: 'solusdt',
  XRP: 'xrpusdt',
};

const ASSET_FROM_SYMBOL: Record<string, V35Asset> = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
  SOLUSDT: 'SOL',
  XRPUSDT: 'XRP',
};

// Callback for price tick logging
type PriceTickCallback = (asset: V35Asset, price: number, ts: number) => void;
let priceTickCallback: PriceTickCallback | null = null;

export function setPriceTickCallback(callback: PriceTickCallback): void {
  priceTickCallback = callback;
}

export class BinancePriceFeed {
  private ws: WebSocket | null = null;
  private running = false;
  
  // Price history per asset (last 15 minutes for crossing analysis)
  private priceHistory: Map<V35Asset, PricePoint[]> = new Map();
  
  // Current momentum state per asset
  private momentum: Map<V35Asset, MomentumState> = new Map();
  
  // Configuration
  private lookbackSeconds = 30; // Look back 30 seconds for momentum
  private momentumThreshold = 0.15; // 0.15% = trending
  private strongMomentumThreshold = 0.30; // 0.30% = strongly trending
  private historyMaxLength = 900; // Keep 15 minutes of history (900 seconds)
  
  // Throttle DB writes - save every 5 seconds per asset
  private lastDbWrite: Map<V35Asset, number> = new Map();
  private DB_WRITE_INTERVAL_MS = 5000;
  
  constructor() {
    // Initialize maps
    for (const asset of Object.keys(SYMBOL_MAP) as V35Asset[]) {
      this.priceHistory.set(asset, []);
      this.lastDbWrite.set(asset, 0);
      this.momentum.set(asset, {
        currentPrice: 0,
        momentum: 0,
        direction: 'NEUTRAL',
        isTrending: false,
        lastUpdate: 0,
      });
    }
  }
  
  /**
   * Start the price feed
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
    console.log('[BinanceFeed] Started');
  }
  
  /**
   * Stop the price feed
   */
  stop(): void {
    this.running = false;
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    console.log('[BinanceFeed] Stopped');
  }
  
  /**
   * Connect to Binance WebSocket
   */
  private connect(): void {
    const streams = Object.values(SYMBOL_MAP).map(s => `${s}@trade`);
    const url = `${BINANCE_WS_URL}?streams=${streams.join('/')}`;
    
    this.ws = new WebSocket(url);
    
    this.ws.on('open', () => {
      console.log('[BinanceFeed] ✅ Connected to Binance');
    });
    
    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.stream && msg.data) {
          this.handleTrade(msg.data);
        }
      } catch {}
    });
    
    this.ws.on('error', (err) => {
      console.error('[BinanceFeed] WebSocket error:', err.message);
    });
    
    this.ws.on('close', () => {
      console.log('[BinanceFeed] Disconnected');
      if (this.running) {
        setTimeout(() => this.connect(), 5000);
      }
    });
  }
  
  /**
   * Handle incoming trade data
   */
  private handleTrade(data: any): void {
    const symbol = (data.s || '').toUpperCase();
    const price = parseFloat(data.p);
    const now = Date.now();
    
    const asset = ASSET_FROM_SYMBOL[symbol];
    if (!asset || !price || !isFinite(price)) return;
    
    // Add to history
    const history = this.priceHistory.get(asset) || [];
    history.push({ price, time: now });
    
    // Trim old data (keep last 15 minutes)
    const cutoff = now - this.historyMaxLength * 1000;
    while (history.length > 0 && history[0].time < cutoff) {
      history.shift();
    }
    
    this.priceHistory.set(asset, history);
    
    // Log to database (throttled to every 5 seconds per asset)
    const lastWrite = this.lastDbWrite.get(asset) || 0;
    if (priceTickCallback && now - lastWrite >= this.DB_WRITE_INTERVAL_MS) {
      this.lastDbWrite.set(asset, now);
      priceTickCallback(asset, price, now);
    }
    
    // Update momentum calculation
    this.calculateMomentum(asset);
  }
  
  /**
   * Calculate momentum for an asset
   */
  private calculateMomentum(asset: V35Asset): void {
    const history = this.priceHistory.get(asset) || [];
    if (history.length < 5) return;
    
    const now = Date.now();
    const current = history[history.length - 1];
    
    // Find price from lookback seconds ago
    const lookbackTime = now - this.lookbackSeconds * 1000;
    let pastPrice = current.price;
    
    for (let i = 0; i < history.length; i++) {
      if (history[i].time >= lookbackTime) {
        pastPrice = history[i].price;
        break;
      }
    }
    
    // Calculate momentum as percentage
    const momentum = pastPrice > 0 
      ? ((current.price - pastPrice) / pastPrice) * 100 
      : 0;
    
    const absMomentum = Math.abs(momentum);
    const isTrending = absMomentum >= this.momentumThreshold;
    
    let direction: 'UP' | 'DOWN' | 'NEUTRAL' = 'NEUTRAL';
    if (momentum >= this.momentumThreshold) {
      direction = 'UP';
    } else if (momentum <= -this.momentumThreshold) {
      direction = 'DOWN';
    }
    
    this.momentum.set(asset, {
      currentPrice: current.price,
      momentum,
      direction,
      isTrending,
      lastUpdate: now,
    });
  }
  
  /**
   * Get current price for asset
   */
  getPrice(asset: V35Asset): number {
    return this.momentum.get(asset)?.currentPrice || 0;
  }
  
  /**
   * Get momentum percentage for asset
   */
  getMomentum(asset: V35Asset): number {
    return this.momentum.get(asset)?.momentum || 0;
  }
  
  /**
   * Get trend direction for asset
   */
  getTrendDirection(asset: V35Asset): 'UP' | 'DOWN' | 'NEUTRAL' {
    return this.momentum.get(asset)?.direction || 'NEUTRAL';
  }
  
  /**
   * Check if asset is trending
   */
  isTrending(asset: V35Asset): boolean {
    return this.momentum.get(asset)?.isTrending || false;
  }
  
  /**
   * Check if asset is strongly trending
   */
  isStronglyTrending(asset: V35Asset): boolean {
    const m = Math.abs(this.getMomentum(asset));
    return m >= this.strongMomentumThreshold;
  }
  
  /**
   * Should we quote on this side given the momentum?
   * 
   * CRITICAL LOGIC:
   * - If market trending UP: DON'T quote DOWN (we become exit liquidity)
   * - If market trending DOWN: DON'T quote UP
   * - If NEUTRAL: Quote both sides
   */
  shouldQuote(asset: V35Asset, side: 'UP' | 'DOWN'): boolean {
    const state = this.momentum.get(asset);
    if (!state) return true;
    
    // If not trending, quote both sides
    if (!state.isTrending) {
      return true;
    }
    
    // If trending UP, don't quote DOWN (we'd absorb sellers fleeing DOWN)
    if (state.direction === 'UP' && side === 'DOWN') {
      return false;
    }
    
    // If trending DOWN, don't quote UP (we'd absorb sellers fleeing UP)
    if (state.direction === 'DOWN' && side === 'UP') {
      return false;
    }
    
    return true;
  }
  
  /**
   * Get full state for logging
   */
  getState(asset: V35Asset): MomentumState | undefined {
    return this.momentum.get(asset);
  }
  
  /**
   * Get all states for logging
   */
  getAllStates(): Map<V35Asset, MomentumState> {
    return new Map(this.momentum);
  }
  
  /**
   * Update configuration
   */
  configure(options: {
    lookbackSeconds?: number;
    momentumThreshold?: number;
    strongMomentumThreshold?: number;
  }): void {
    if (options.lookbackSeconds) this.lookbackSeconds = options.lookbackSeconds;
    if (options.momentumThreshold) this.momentumThreshold = options.momentumThreshold;
    if (options.strongMomentumThreshold) this.strongMomentumThreshold = options.strongMomentumThreshold;
  }
  
  /**
   * Check if feed is connected and receiving data
   */
  isHealthy(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    
    const now = Date.now();
    // Check if we received data in last 10 seconds
    for (const state of this.momentum.values()) {
      if (state.lastUpdate > 0 && now - state.lastUpdate < 10000) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Count how many times price crossed strike price in the last N seconds
   * @param asset Asset to check
   * @param strikePrice The strike price to check crossings against
   * @param windowMs Lookback window in milliseconds (default: 15 minutes)
   * @returns Object with crossing count and prices
   */
  countStrikeCrossings(asset: V35Asset, strikePrice: number, windowMs: number = 15 * 60 * 1000): { 
    crossingCount: number; 
    startPrice: number | null;
    endPrice: number | null;
    minPrice: number | null;
    maxPrice: number | null;
  } {
    const history = this.priceHistory.get(asset) || [];
    const now = Date.now();
    const cutoff = now - windowMs;
    
    // Filter to window
    const windowPrices = history.filter(p => p.time >= cutoff);
    
    if (windowPrices.length < 2) {
      return { crossingCount: 0, startPrice: null, endPrice: null, minPrice: null, maxPrice: null };
    }
    
    let crossingCount = 0;
    let minPrice = windowPrices[0].price;
    let maxPrice = windowPrices[0].price;
    let prevAboveStrike = windowPrices[0].price > strikePrice;
    
    for (let i = 1; i < windowPrices.length; i++) {
      const price = windowPrices[i].price;
      const aboveStrike = price > strikePrice;
      
      // Count crossing when we transition above/below strike
      if (aboveStrike !== prevAboveStrike) {
        crossingCount++;
        prevAboveStrike = aboveStrike;
      }
      
      minPrice = Math.min(minPrice, price);
      maxPrice = Math.max(maxPrice, price);
    }
    
    return {
      crossingCount,
      startPrice: windowPrices[0].price,
      endPrice: windowPrices[windowPrices.length - 1].price,
      minPrice,
      maxPrice,
    };
  }
}

// Singleton instance
let feedInstance: BinancePriceFeed | null = null;

export function getBinanceFeed(): BinancePriceFeed {
  if (!feedInstance) {
    feedInstance = new BinancePriceFeed();
  }
  return feedInstance;
}

export function startBinanceFeed(): void {
  getBinanceFeed().start();
}

export function stopBinanceFeed(): void {
  if (feedInstance) {
    feedInstance.stop();
  }
}
