import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChainlinkTick {
  symbol: string;
  timestamp: number; // milliseconds
  value: number;
}

interface MarketToTrack {
  slug: string;
  asset: 'BTC' | 'ETH' | 'SOL' | 'XRP';
  eventStartTime: number; // seconds (Unix)
  eventEndTime: number; // seconds (Unix)
  needsOpenPrice: boolean;
  needsClosePrice: boolean;
}

// Chainlink feed IDs for Polygon (verified from data.chain.link)
const CHAINLINK_FEEDS: Record<string, string> = {
  'BTC': '0xc907E116054Ad103354f2D350FD2514433D57F6f', // BTC/USD on Polygon
  'ETH': '0xF9680D99D6C9589e2a93a78A04A279e509205945', // ETH/USD on Polygon
  'SOL': '0x10C8264C0935b3B9870013e057f330Ff3e9C56dC', // SOL/USD on Polygon (verified)
  'XRP': '0x785ba89291f676b5386652eB12b30cF361020694', // XRP/USD on Polygon (verified)
};

// Parse timestamp from market slug like btc-updown-15m-1766485800
function parseTimestampFromSlug(slug: string): number | null {
  const match = slug.match(/(\d{10})$/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

// Binance symbols for assets
const BINANCE_SYMBOLS: Record<string, string> = {
  'BTC': 'BTCUSDT',
  'ETH': 'ETHUSDT',
  'SOL': 'SOLUSDT',
  'XRP': 'XRPUSDT',
};

// Fetch historical Chainlink price via Alchemy API (more accurate than Binance)
// Uses eth_call with block number to get historical price at specific block
async function fetchChainlinkHistoricalPrice(asset: string, targetTimestampMs: number): Promise<{ price: number; timestamp: number; source: string } | null> {
  const feedAddress = CHAINLINK_FEEDS[asset];
  if (!feedAddress) return null;

  const alchemyApiKey = Deno.env.get('ALCHEMY_POLYGON_API_KEY');
  if (!alchemyApiKey) {
    console.log(`[chainlink_historical] No Alchemy API key configured`);
    return null;
  }

  try {
    // Step 1: Find the block number closest to the target timestamp
    // Polygon has ~2 second blocks, so we estimate the block number
    const targetTimestampSec = Math.floor(targetTimestampMs / 1000);
    
    // Get current block to estimate
    const currentBlockRes = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1
      })
    });
    
    if (!currentBlockRes.ok) {
      console.log(`[chainlink_historical] Failed to get current block: ${currentBlockRes.status}`);
      return null;
    }
    
    const currentBlockData = await currentBlockRes.json();
    const currentBlock = parseInt(currentBlockData.result, 16);
    
    // Get current block timestamp
    const currentBlockInfoRes = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBlockByNumber',
        params: [currentBlockData.result, false],
        id: 1
      })
    });
    
    if (!currentBlockInfoRes.ok) {
      console.log(`[chainlink_historical] Failed to get block info: ${currentBlockInfoRes.status}`);
      return null;
    }
    
    const currentBlockInfo = await currentBlockInfoRes.json();
    const currentTimestamp = parseInt(currentBlockInfo.result.timestamp, 16);
    
    // Estimate target block (~2 sec per block on Polygon)
    const secondsDiff = currentTimestamp - targetTimestampSec;
    const blocksDiff = Math.floor(secondsDiff / 2);
    const targetBlock = Math.max(1, currentBlock - blocksDiff);
    
    console.log(`[chainlink_historical] Target block estimate: ${targetBlock} (current: ${currentBlock}, diff: ${blocksDiff} blocks)`);
    
    // Step 2: Query Chainlink at that historical block
    const data = '0xfeaf968c'; // latestRoundData()
    
    const response = await fetch(`https://polygon-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: feedAddress,
          data: data
        }, `0x${targetBlock.toString(16)}`],
        id: 1
      })
    });

    if (!response.ok) {
      console.log(`[chainlink_historical] RPC error: ${response.status}`);
      return null;
    }

    const result = await response.json();
    if (result.error) {
      console.log(`[chainlink_historical] RPC error:`, result.error);
      return null;
    }

    // Parse the response - each value is 32 bytes (64 hex chars)
    const hex = result.result.slice(2); // remove 0x
    const answerHex = hex.slice(64, 128); // second 32-byte slot (answer)
    const updatedAtHex = hex.slice(192, 256); // fourth 32-byte slot (updatedAt)
    
    const answer = BigInt('0x' + answerHex);
    const updatedAt = Number(BigInt('0x' + updatedAtHex));
    
    // Chainlink uses 8 decimals for most feeds
    const price = Number(answer) / 1e8;
    
    console.log(`[chainlink_historical] ${asset} price at block ${targetBlock}: $${price.toFixed(6)} (updatedAt: ${new Date(updatedAt * 1000).toISOString()})`);
    return { price, timestamp: updatedAt * 1000, source: 'chainlink_historical' };
  } catch (e) {
    console.error(`[chainlink_historical] Error fetching ${asset}:`, e);
    return null;
  }
}

// Fetch historical Binance price at exact timestamp using klines (candles)
// Returns the OPEN price of the 1-minute candle that started at the given timestamp
// This is used as a fallback when Chainlink historical data is not available
async function fetchBinanceHistoricalPrice(asset: string, timestampMs: number): Promise<{ price: number; timestamp: number } | null> {
  const symbol = BINANCE_SYMBOLS[asset];
  if (!symbol) return null;

  try {
    // Get the 1-minute kline that starts at the exact timestamp
    const response = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&startTime=${timestampMs}&limit=1`
    );
    if (!response.ok) {
      console.log(`[binance] API error: ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    if (!data || data.length === 0) {
      console.log(`[binance] No kline data for ${asset} at ${new Date(timestampMs).toISOString()}`);
      return null;
    }
    
    // Kline format: [openTime, open, high, low, close, volume, closeTime, ...]
    const kline = data[0];
    const openTime = kline[0];
    const openPrice = parseFloat(kline[1]);
    
    console.log(`[binance] ${asset} historical price at ${new Date(openTime).toISOString()}: $${openPrice.toFixed(6)}`);
    return {
      price: openPrice,
      timestamp: openTime,
    };
  } catch (e) {
    console.error(`[binance] Error fetching historical ${asset}:`, e);
    return null;
  }
}

// Fetch the EXACT Chainlink Data Streams price from our realtime_price_logs table
// This is the SAME source Polymarket uses for "Price to Beat"
async function fetchChainlinkRtdsPrice(
  supabase: any,
  asset: string, 
  targetTimestampMs: number
): Promise<{ price: number; timestamp: number } | null> {
  try {
    // Get the chainlink_rtds tick closest to the target timestamp (within ±2 seconds)
    const { data, error } = await supabase
      .from('realtime_price_logs')
      .select('price, raw_timestamp')
      .eq('source', 'chainlink_rtds')
      .eq('asset', asset)
      .gte('raw_timestamp', targetTimestampMs - 2000)
      .lte('raw_timestamp', targetTimestampMs + 2000)
      .order('raw_timestamp', { ascending: true })
      .limit(1);
    
    if (error) {
      console.log(`[chainlink_rtds] DB error for ${asset}:`, error.message);
      return null;
    }
    
    if (data && data.length > 0) {
      const tick = data[0];
      console.log(`[chainlink_rtds] ${asset} price at ${new Date(tick.raw_timestamp).toISOString()}: $${tick.price.toFixed(6)}`);
      return {
        price: tick.price,
        timestamp: tick.raw_timestamp,
      };
    }
    
    console.log(`[chainlink_rtds] No tick found for ${asset} near ${new Date(targetTimestampMs).toISOString()}`);
    return null;
  } catch (e) {
    console.error(`[chainlink_rtds] Error fetching ${asset}:`, e);
    return null;
  }
}

// Fetch current price from Polymarket API (for close prices, less accurate for strikes)
async function fetchPolymarketApiPrice(asset: string): Promise<{ price: number; timestamp: number } | null> {
  try {
    // Try to get current price from Chainlink directly - more accurate than Polymarket API
    const clPrice = await fetchChainlinkPrice(asset);
    if (clPrice) {
      return clPrice;
    }
    return null;
  } catch (e) {
    console.error(`[polymarket_api] Error fetching ${asset}:`, e);
    return null;
  }
}
async function fetchChainlinkPrice(asset: string): Promise<{ price: number; timestamp: number } | null> {
  const feedAddress = CHAINLINK_FEEDS[asset];
  if (!feedAddress) {
    console.log(`[chainlink] No feed for ${asset}`);
    return null;
  }

  try {
    // ABI for latestRoundData: returns (roundId, answer, startedAt, updatedAt, answeredInRound)
    const data = '0xfeaf968c'; // function signature for latestRoundData()
    
    const response = await fetch('https://polygon-rpc.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{
          to: feedAddress,
          data: data
        }, 'latest'],
        id: 1
      })
    });

    if (!response.ok) {
      console.log(`[chainlink] RPC error: ${response.status}`);
      return null;
    }

    const result = await response.json();
    if (result.error) {
      console.log(`[chainlink] RPC error:`, result.error);
      return null;
    }

    // Parse the response - each value is 32 bytes (64 hex chars)
    const hex = result.result.slice(2); // remove 0x
    const answerHex = hex.slice(64, 128); // second 32-byte slot (answer)
    const updatedAtHex = hex.slice(192, 256); // fourth 32-byte slot (updatedAt)
    
    const answer = BigInt('0x' + answerHex);
    const updatedAt = Number(BigInt('0x' + updatedAtHex));
    
    // Chainlink uses 8 decimals for most feeds
    const price = Number(answer) / 1e8;
    
    console.log(`[chainlink] ${asset} price: $${price.toFixed(6)} at ${new Date(updatedAt * 1000).toISOString()}`);
    return { price, timestamp: updatedAt * 1000 };
  } catch (e) {
    console.error(`[chainlink] Error fetching ${asset}:`, e);
    return null;
  }
}

// Get current price from best available source (for close prices)
async function getCurrentPrice(asset: string): Promise<{ price: number; timestamp: number; source: string } | null> {
  // Try Polymarket API first
  const pmPrice = await fetchPolymarketApiPrice(asset);
  if (pmPrice) {
    return { ...pmPrice, source: 'polymarket_api' };
  }
  
  // Fallback to direct Chainlink RPC
  const clPrice = await fetchChainlinkPrice(asset);
  if (clPrice) {
    return { ...clPrice, source: 'chainlink_rpc' };
  }
  
  return null;
}

// Generate all active 15m market slugs deterministically based on time
function generateActiveMarketSlugs(): string[] {
  const now = Math.floor(Date.now() / 1000);
  const intervalSecs = 15 * 60; // 15 minutes
  const currentIntervalStart = Math.floor(now / intervalSecs) * intervalSecs;
  
  const slugs: string[] = [];
  
  // Check current interval, previous interval, and 2 intervals back (and 3 for late close prices)
  for (const offset of [0, -1, -2, -3]) {
    const intervalTs = currentIntervalStart + (offset * intervalSecs);
    
    // Include all V26 assets: BTC, ETH, SOL, XRP
    for (const asset of ['btc', 'eth', 'sol', 'xrp']) {
      slugs.push(`${asset}-updown-15m-${intervalTs}`);
    }
  }
  
  console.log(`Generated ${slugs.length} deterministic slugs for all assets (BTC, ETH, SOL, XRP)`);
  return slugs;
}

// Get markets that need prices based on deterministic slug generation
async function getMarketsNeedingPrices(supabase: any): Promise<MarketToTrack[]> {
  const now = Date.now();
  const slugs = generateActiveMarketSlugs();
  
  interface ExistingPrice {
    market_slug: string;
    open_price: number | null;
    open_timestamp: number | null;
    close_price: number | null;
    close_timestamp: number | null;
    quality: string | null;
  }
  
  const { data: existingPrices, error } = await supabase
    .from('strike_prices')
    .select('market_slug, open_price, open_timestamp, close_price, close_timestamp, quality')
    .in('market_slug', slugs);
  
  if (error) {
    console.error('Error fetching existing prices:', error);
  }
  
  const priceMap = new Map<string, ExistingPrice>((existingPrices || []).map((p: ExistingPrice) => [p.market_slug, p]));
  
  const marketsNeeding: MarketToTrack[] = [];
  
  for (const slug of slugs) {
    const eventStartTime = parseTimestampFromSlug(slug);
    if (!eventStartTime) continue;
    
    const eventEndTime = eventStartTime + 15 * 60;
    const eventStartMs = eventStartTime * 1000;
    const eventEndMs = eventEndTime * 1000;
    
    // Extended collection windows (15 minutes instead of 10 for more reliability)
    const openWindowEnd = eventStartMs + 15 * 60 * 1000;
    const closeWindowEnd = eventEndMs + 15 * 60 * 1000;
    
    const existing = priceMap.get(slug);
    const hasOpenPrice = existing?.open_price != null;
    const hasClosePrice = existing?.close_price != null;
    
    // Need open price if market started and within window
    const needsOpenPrice = !hasOpenPrice && now >= eventStartMs && now <= openWindowEnd;
    
    // Need close price if market ended and within window
    const needsClosePrice = !hasClosePrice && now >= eventEndMs && now <= closeWindowEnd;
    
    if (needsOpenPrice || needsClosePrice) {
      const slugLower = slug.toLowerCase();
      const asset: 'BTC' | 'ETH' | 'SOL' | 'XRP' = 
        slugLower.includes('btc') ? 'BTC' : 
        slugLower.includes('sol') ? 'SOL' :
        slugLower.includes('xrp') ? 'XRP' : 'ETH';
      
      marketsNeeding.push({
        slug,
        asset,
        eventStartTime,
        eventEndTime,
        needsOpenPrice,
        needsClosePrice
      });
      
      console.log(`[${asset}] Market ${slug}: start=${new Date(eventStartMs).toISOString()}, end=${new Date(eventEndMs).toISOString()}, needsOpen=${needsOpenPrice}, needsClose=${needsClosePrice}`);
    }
  }
  
  console.log(`Total: ${marketsNeeding.length} markets need prices (${marketsNeeding.filter(m => m.needsOpenPrice).length} open, ${marketsNeeding.filter(m => m.needsClosePrice).length} close)`);
  return marketsNeeding;
}

// Determine quality based on time difference
function determineQuality(tickTimestamp: number, targetTimeMs: number): string {
  const diffMs = Math.abs(tickTimestamp - targetTimeMs);
  if (diffMs <= 5000) return 'exact';
  if (diffMs <= 60000) return 'late';
  return 'estimated';
}

// Store strike prices in database using best available price source
// Priority for OPEN prices: chainlink_rtds from realtime_price_logs (EXACT Polymarket "Price to Beat")
// Priority for CLOSE prices: Polymarket API > Chainlink RPC (current price)
async function storePrices(
  supabase: any, 
  markets: MarketToTrack[]
): Promise<{ openStored: number; closeStored: number }> {
  let openStored = 0;
  let closeStored = 0;
  
  // Fetch current prices for all needed assets (for close prices)
  const assetsNeeded = [...new Set(markets.map(m => m.asset))];
  const currentPrices: Record<string, { price: number; timestamp: number; source: string }> = {};
  
  for (const asset of assetsNeeded) {
    const result = await getCurrentPrice(asset);
    if (result) {
      currentPrices[asset] = result;
    }
  }
  
  const now = Date.now();
  
  for (const market of markets) {
    // Get existing data to preserve
    const { data: existing } = await supabase
      .from('strike_prices')
      .select('*')
      .eq('market_slug', market.slug)
      .maybeSingle();
    
    const updates: any = {
      market_slug: market.slug,
      asset: market.asset,
      event_start_time: new Date(market.eventStartTime * 1000).toISOString(),
    };
    
    // Preserve existing prices
    if (existing?.open_price) {
      updates.open_price = existing.open_price;
      updates.open_timestamp = existing.open_timestamp;
      updates.strike_price = existing.strike_price || existing.open_price;
      updates.quality = existing.quality;
      updates.source = existing.source;
    }
    if (existing?.close_price) {
      updates.close_price = existing.close_price;
      updates.close_timestamp = existing.close_timestamp;
    }
    
    // Handle open price - USE chainlink_rtds from realtime_price_logs (EXACT "Price to Beat")
    // Fallback order: 1) RTDS logs, 2) Chainlink historical via Alchemy, 3) Binance klines
    if (market.needsOpenPrice && !existing?.open_price) {
      const targetOpenTimeMs = market.eventStartTime * 1000;
      const timeSinceStart = now - targetOpenTimeMs;
      
      // Only try to get open price if we're within 15 minutes of start
      if (timeSinceStart >= 0 && timeSinceStart <= 15 * 60 * 1000) {
        let foundPrice = false;
        
        // PRIMARY: Get exact chainlink_rtds price from our logged ticks
        const chainlinkRtdsPrice = await fetchChainlinkRtdsPrice(supabase, market.asset, targetOpenTimeMs);
        
        if (chainlinkRtdsPrice) {
          updates.open_price = Math.round(chainlinkRtdsPrice.price * 1000000) / 1000000;
          updates.open_timestamp = chainlinkRtdsPrice.timestamp;
          updates.strike_price = updates.open_price;
          updates.source = 'chainlink_rtds';
          updates.quality = determineQuality(chainlinkRtdsPrice.timestamp, targetOpenTimeMs);
          updates.chainlink_timestamp = Math.floor(chainlinkRtdsPrice.timestamp / 1000);
          openStored++;
          foundPrice = true;
          console.log(`✅ Open price for ${market.slug}: $${updates.open_price} (source: chainlink_rtds, quality: ${updates.quality})`);
        }
        
        // SECONDARY: Try Chainlink historical via Alchemy (more accurate than Binance)
        if (!foundPrice) {
          const chainlinkHistorical = await fetchChainlinkHistoricalPrice(market.asset, targetOpenTimeMs);
          if (chainlinkHistorical) {
            updates.open_price = Math.round(chainlinkHistorical.price * 1000000) / 1000000;
            updates.open_timestamp = chainlinkHistorical.timestamp;
            updates.strike_price = updates.open_price;
            updates.source = 'chainlink_historical';
            // Chainlink on-chain updates every ~20-60 seconds, so mark as 'late' not 'exact'
            updates.quality = 'late';
            updates.chainlink_timestamp = Math.floor(chainlinkHistorical.timestamp / 1000);
            openStored++;
            foundPrice = true;
            console.log(`⚠️ Open price for ${market.slug}: $${updates.open_price} (source: chainlink_historical, quality: late)`);
          }
        }
        
        // TERTIARY: Binance historical klines as last resort
        if (!foundPrice) {
          const binancePrice = await fetchBinanceHistoricalPrice(market.asset, targetOpenTimeMs);
          if (binancePrice) {
            updates.open_price = Math.round(binancePrice.price * 1000000) / 1000000;
            updates.open_timestamp = binancePrice.timestamp;
            updates.strike_price = updates.open_price;
            updates.source = 'binance_historical';
            updates.quality = 'estimated';
            updates.chainlink_timestamp = Math.floor(binancePrice.timestamp / 1000);
            openStored++;
            foundPrice = true;
            console.log(`⚠️ Open price for ${market.slug}: $${updates.open_price} (source: binance_historical, quality: estimated)`);
          }
        }
        
        // FINAL FALLBACK: Current price (least accurate)
        if (!foundPrice) {
          const priceData = currentPrices[market.asset];
          if (priceData) {
            updates.open_price = Math.round(priceData.price * 1000000) / 1000000;
            updates.open_timestamp = now;
            updates.strike_price = updates.open_price;
            updates.source = priceData.source + '_fallback';
            updates.quality = 'estimated';
            updates.chainlink_timestamp = Math.floor(now / 1000);
            openStored++;
            console.log(`❌ Open price for ${market.slug}: $${updates.open_price} (FALLBACK: ${priceData.source}, no historical data available)`);
          }
        }
      }
    }
    
    // Handle close price - use current price
    if (market.needsClosePrice && !existing?.close_price) {
      const targetCloseTime = market.eventEndTime * 1000;
      const timeSinceEnd = now - targetCloseTime;
      
      if (timeSinceEnd >= 0 && timeSinceEnd <= 10 * 60 * 1000) { // 0-10 minutes after end
        const priceData = currentPrices[market.asset];
        if (priceData) {
          updates.close_price = Math.round(priceData.price * 1000000) / 1000000;
          updates.close_timestamp = priceData.timestamp;
          updates.chainlink_timestamp = Math.floor(priceData.timestamp / 1000);
          closeStored++;
          console.log(`✅ Close price for ${market.slug}: $${updates.close_price}`);
        }
      }
    }
    
    // Only upsert if we have something to store
    if (updates.open_price || updates.close_price) {
      const { error } = await supabase
        .from('strike_prices')
        .upsert(updates, { onConflict: 'market_slug' });
      
      if (error) {
        console.error(`Error storing price for ${market.slug}:`, error);
      }
    }
  }
  
  return { openStored, closeStored };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('=== Starting Chainlink price collector (RPC-based) ===');
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // 1. Get markets that need prices
    const marketsNeeding = await getMarketsNeedingPrices(supabase);
    console.log(`Found ${marketsNeeding.length} markets needing prices`);
    
    if (marketsNeeding.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No markets need prices right now',
        marketsProcessed: 0,
        openPricesStored: 0,
        closePricesStored: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // 2. Fetch prices and store them
    const { openStored, closeStored } = await storePrices(supabase, marketsNeeding);
    
    // 3. Return summary
    return new Response(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString(),
      marketsNeeding: marketsNeeding.length,
      marketsProcessed: marketsNeeding.map(m => ({
        slug: m.slug,
        asset: m.asset,
        eventStartTime: new Date(m.eventStartTime * 1000).toISOString(),
        eventEndTime: new Date(m.eventEndTime * 1000).toISOString(),
        needsOpenPrice: m.needsOpenPrice,
        needsClosePrice: m.needsClosePrice
      })),
      openPricesStored: openStored,
      closePricesStored: closeStored
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    
  } catch (error) {
    console.error('Error in chainlink-price-collector:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
