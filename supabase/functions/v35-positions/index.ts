import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;

// Cache for orderbook prices to avoid repeated calls
const orderbookPriceCache = new Map<string, { bestBid: number; bestAsk: number; fetchedAt: number }>();

/**
 * Fetch live orderbook price for a token ID from Polymarket CLOB
 */
async function fetchOrderbookPrice(tokenId: string): Promise<{ bestBid: number; bestAsk: number }> {
  // Check cache (valid for 5 seconds)
  const cached = orderbookPriceCache.get(tokenId);
  if (cached && Date.now() - cached.fetchedAt < 5000) {
    return { bestBid: cached.bestBid, bestAsk: cached.bestAsk };
  }

  try {
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${encodeURIComponent(tokenId)}`, {
      headers: { Accept: 'application/json' },
    });
    
    if (!res.ok) {
      console.log(`⚠️ Orderbook fetch failed for ${tokenId.slice(0, 12)}...: ${res.status}`);
      return { bestBid: 0, bestAsk: 0 };
    }

    const book = await res.json();
    const bids = book?.bids ?? [];
    const asks = book?.asks ?? [];
    
    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
    
    // Cache result
    orderbookPriceCache.set(tokenId, { bestBid, bestAsk, fetchedAt: Date.now() });
    
    return { bestBid, bestAsk };
  } catch (e) {
    console.error(`❌ Error fetching orderbook for ${tokenId.slice(0, 12)}...:`, e);
    return { bestBid: 0, bestAsk: 0 };
  }
}
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function normalizeWalletAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase();
}

interface PolymarketPosition {
  asset: string;
  conditionId: string;
  market: string;
  outcome: string;
  outcomeIndex: number;
  size: number;
  avgPrice: number;
  initialValue: number;
  currentValue: number;
  curPrice: number;
  eventSlug?: string;
  tokenId?: string; // Token ID for orderbook lookup
}

interface MarketPosition {
  market_slug: string;
  asset: string;
  polymarket_up_qty: number;
  polymarket_up_avg: number;
  polymarket_down_qty: number;
  polymarket_down_avg: number;
  live_up_price: number;
  live_down_price: number;
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  total_cost: number;
  current_value: number;
  unrealized_pnl: number;
}

interface ExpiredMarketPnL {
  market_slug: string;
  asset: string;
  up_qty: number;
  down_qty: number;
  up_cost: number;
  down_cost: number;
  paired: number;
  combined_cost: number;
  realized_pnl: number;
  expired_at: Date;
}

async function fetchPolymarketPositions(walletAddress: string): Promise<PolymarketPosition[]> {
  const positions: PolymarketPosition[] = [];
  let cursor: string | null = null;
  let pageCount = 0;
  const maxPages = 10;

  console.log(`📊 Fetching Polymarket positions for ${walletAddress.slice(0, 10)}...`);

  while (pageCount < maxPages) {
    pageCount++;
    let url = `https://data-api.polymarket.com/positions?user=${walletAddress}&sizeThreshold=0&limit=500`;
    if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        console.error(`❌ Positions API error: HTTP ${response.status}`);
        break;
      }

      const data = await response.json();
      
      let items: any[];
      let nextCursor: string | null = null;

      if (Array.isArray(data)) {
        items = data;
      } else if (data.positions && Array.isArray(data.positions)) {
        items = data.positions;
        nextCursor = data.next_cursor || data.nextCursor || null;
      } else {
        break;
      }

      for (const p of items) {
        if (p.size > 0) {
          positions.push({
            asset: p.asset || '',
            conditionId: p.conditionId || '',
            market: p.title || p.market || '',
            outcome: p.outcome || (p.outcomeIndex === 0 ? 'Yes' : 'No'),
            outcomeIndex: p.outcomeIndex || 0,
            size: parseFloat(p.size) || 0,
            avgPrice: parseFloat(p.avgPrice) || 0,
            initialValue: parseFloat(p.initialValue) || 0,
            currentValue: parseFloat(p.currentValue) || 0,
            curPrice: parseFloat(p.curPrice) || 0,
            eventSlug: p.eventSlug || p.slug || undefined,
            tokenId: p.tokenId || undefined, // Capture token ID for orderbook lookup
          });
        }
      }

      console.log(`   Page ${pageCount}: ${items.length} items, ${positions.length} total`);

      if (!nextCursor || nextCursor === cursor || items.length === 0) break;
      cursor = nextCursor;
    } catch (e) {
      console.error(`❌ Error fetching positions:`, e);
      break;
    }
  }

  console.log(`   ✅ Fetched ${positions.length} total positions`);
  return positions;
}

async function getBotWalletAddress(supabase: any): Promise<string | null> {
  const { data, error } = await supabase
    .from('bot_config')
    .select('polymarket_address')
    .not('polymarket_address', 'is', null)
    .limit(1);

  if (error) {
    console.error('❌ Error reading bot_config.polymarket_address:', error);
    return null;
  }

  // data is an array, get first item
  const row = Array.isArray(data) && data.length > 0 ? data[0] : null;
  return normalizeWalletAddress(row?.polymarket_address);
}

/**
 * Calculate realized PnL from EXPIRED markets using v35_fills database.
 * This covers markets where the runner stopped before calling saveV35Settlement.
 */
async function calculateRealizedPnLFromFills(
  supabase: any, 
  walletAddress: string
): Promise<{ markets: ExpiredMarketPnL[]; totalRealizedPnL: number }> {
  const now = Date.now();
  
  // Get all fills for this wallet, grouped by market
  const { data: fills, error } = await supabase
    .from('v35_fills')
    .select('market_slug, asset, side, price, size')
    .eq('wallet_address', walletAddress.toLowerCase());

  if (error) {
    console.error('❌ Error fetching fills for realized PnL:', error);
    return { markets: [], totalRealizedPnL: 0 };
  }

  if (!fills || fills.length === 0) {
    return { markets: [], totalRealizedPnL: 0 };
  }

  // Group fills by market
  const marketFills = new Map<string, { 
    asset: string;
    upQty: number; upCost: number;
    downQty: number; downCost: number;
  }>();

  for (const fill of fills) {
    const slug = fill.market_slug || '';
    if (!slug) continue;

    if (!marketFills.has(slug)) {
      marketFills.set(slug, {
        asset: fill.asset || 'UNKNOWN',
        upQty: 0, upCost: 0,
        downQty: 0, downCost: 0,
      });
    }

    const m = marketFills.get(slug)!;
    const side = (fill.side || '').toUpperCase();
    const price = parseFloat(fill.price) || 0;
    const size = parseFloat(fill.size) || 0;

    // Classify fills: UP/YES → upQty, DOWN/NO → downQty
    if (side === 'UP' || side === 'YES') {
      m.upQty += size;
      m.upCost += size * price;
    } else if (side === 'DOWN' || side === 'NO') {
      m.downQty += size;
      m.downCost += size * price;
    }
    // Ignore other sides (e.g., 'BUY'/'SELL' without directional info)
  }

  // Calculate realized PnL for EXPIRED markets only
  const expiredMarkets: ExpiredMarketPnL[] = [];
  let totalRealizedPnL = 0;

  for (const [slug, m] of marketFills.entries()) {
    // Parse epoch from slug
    const match = slug.match(/(\d{10})$/);
    if (!match) continue;
    
    const epochMs = parseInt(match[1]) * 1000;
    const expiryMs = epochMs + 15 * 60 * 1000;
    
    // Only count EXPIRED markets
    if (expiryMs >= now) continue;

    const upAvg = m.upQty > 0 ? m.upCost / m.upQty : 0;
    const downAvg = m.downQty > 0 ? m.downCost / m.downQty : 0;
    const paired = Math.min(m.upQty, m.downQty);
    const combinedCost = upAvg + downAvg;
    
    // Realized PnL = paired * (1 - combined_cost)
    // This is the guaranteed profit from paired positions
    const realizedPnL = paired > 0 && combinedCost < 1 
      ? paired * (1 - combinedCost) 
      : 0;

    if (realizedPnL > 0 || paired > 0) {
      expiredMarkets.push({
        market_slug: slug,
        asset: m.asset,
        up_qty: m.upQty,
        down_qty: m.downQty,
        up_cost: m.upCost,
        down_cost: m.downCost,
        paired,
        combined_cost: combinedCost,
        realized_pnl: realizedPnL,
        expired_at: new Date(expiryMs),
      });
      totalRealizedPnL += realizedPnL;
    }
  }

  // Sort by most recent
  expiredMarkets.sort((a, b) => b.expired_at.getTime() - a.expired_at.getTime());

  console.log(`💰 Calculated realized PnL from ${expiredMarkets.length} expired markets: $${totalRealizedPnL.toFixed(2)}`);
  
  return { markets: expiredMarkets, totalRealizedPnL };
}

function is15mCryptoMarket(position: PolymarketPosition): boolean {
  const market = position.market.toLowerCase();
  const slug = (position.eventSlug || '').toLowerCase();
  
  const has15m = market.includes('15m') || 
                 market.includes('15 min') ||
                 market.includes(':00am-') ||
                 market.includes(':15am-') ||
                 market.includes(':30am-') ||
                 market.includes(':45am-') ||
                 market.includes(':00pm-') ||
                 market.includes(':15pm-') ||
                 market.includes(':30pm-') ||
                 market.includes(':45pm-');
  
  const hasCrypto = market.includes('btc') || 
                    market.includes('bitcoin') ||
                    market.includes('eth') || 
                    market.includes('ethereum') ||
                    market.includes('sol') || 
                    market.includes('solana') ||
                    market.includes('xrp') ||
                    slug.includes('btc') ||
                    slug.includes('eth') ||
                    slug.includes('sol') ||
                    slug.includes('xrp');
  
  return has15m && hasCrypto;
}

function getMarketEpochFromSlug(slug: string): number | null {
  const match = slug.match(/(\d{10})$/);
  if (!match) return null;
  return parseInt(match[1]) * 1000;
}

function isMarketLive(position: PolymarketPosition): boolean {
  const slug = position.eventSlug || '';
  const epoch = getMarketEpochFromSlug(slug);
  if (!epoch) {
    console.log(`   ⚠️ Cannot parse epoch from slug: ${slug}, excluding`);
    return false;
  }
  const expiryMs = epoch + 15 * 60 * 1000;
  const now = Date.now();
  const isLive = expiryMs > now;
  if (!isLive) {
    console.log(`   🔴 EXPIRED market excluded: ${slug} (expired ${Math.round((now - expiryMs) / 1000)}s ago)`);
  }
  return isLive;
}

function extractMarketSlug(position: PolymarketPosition): string {
  if (position.eventSlug) return position.eventSlug;
  return position.market.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
}

function extractAsset(position: PolymarketPosition): string {
  // Check both market title AND eventSlug for asset identification
  const market = position.market.toLowerCase();
  const slug = (position.eventSlug || '').toLowerCase();
  const combined = market + ' ' + slug;
  
  // BTC variants
  if (combined.includes('btc') || combined.includes('bitcoin') || combined.includes('btcusd')) return 'BTC';
  // ETH variants  
  if (combined.includes('eth') || combined.includes('ethereum') || combined.includes('ethusd')) return 'ETH';
  // SOL variants
  if (combined.includes('sol') || combined.includes('solana') || combined.includes('solusd')) return 'SOL';
  // XRP variants
  if (combined.includes('xrp') || combined.includes('ripple') || combined.includes('xrpusd')) return 'XRP';
  
  // Fallback: try to extract from slug pattern like "btc-updown-15m-xxx"
  if (slug.startsWith('btc-')) return 'BTC';
  if (slug.startsWith('eth-')) return 'ETH';
  if (slug.startsWith('sol-')) return 'SOL';
  if (slug.startsWith('xrp-')) return 'XRP';
  
  console.log(`⚠️ Could not identify asset from: market="${position.market}", slug="${position.eventSlug}"`);
  return 'UNKNOWN';
}

function isUpOutcome(position: PolymarketPosition): boolean {
  const outcome = position.outcome.toLowerCase();
  return outcome === 'yes' || outcome === 'up' || position.outcomeIndex === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const walletAddress = await getBotWalletAddress(supabase);
    if (!walletAddress) {
      return new Response(JSON.stringify({
        success: false,
        error: 'No polymarket_address configured in bot_config',
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch LIVE positions from Polymarket
    const allPositions = await fetchPolymarketPositions(walletAddress);
    const positions15m = allPositions
      .filter(is15mCryptoMarket)
      .filter(isMarketLive);
    
    console.log(`📈 Found ${positions15m.length} LIVE 15-min crypto positions (filtered from ${allPositions.length} total)`);

    // 2. Calculate REALIZED PnL from expired markets (database)
    const { markets: expiredMarkets, totalRealizedPnL } = await calculateRealizedPnLFromFills(
      supabase, 
      walletAddress
    );

    // 3. Group live Polymarket positions by market slug
    const polymarketByMarket = new Map<string, { 
      upQty: number; upCost: number; upAvg: number;
      downQty: number; downCost: number; downAvg: number;
      upCurPrice: number; downCurPrice: number;
      upCurrentValue: number; downCurrentValue: number;
      upTokenId: string; downTokenId: string;
      asset: string;
    }>();

    for (const pos of positions15m) {
      const slug = extractMarketSlug(pos);
      const asset = extractAsset(pos);
      const isUp = isUpOutcome(pos);
      
      if (!polymarketByMarket.has(slug)) {
        polymarketByMarket.set(slug, {
          upQty: 0, upCost: 0, upAvg: 0,
          downQty: 0, downCost: 0, downAvg: 0,
          upCurPrice: 0, downCurPrice: 0,
          upCurrentValue: 0, downCurrentValue: 0,
          upTokenId: '', downTokenId: '',
          asset,
        });
      }
      
      const m = polymarketByMarket.get(slug)!;
      if (isUp) {
        m.upQty += pos.size;
        m.upCost += pos.size * pos.avgPrice;
        m.upCurPrice = pos.curPrice;
        m.upCurrentValue += pos.currentValue;
        if (pos.tokenId) m.upTokenId = pos.tokenId;
      } else {
        m.downQty += pos.size;
        m.downCost += pos.size * pos.avgPrice;
        m.downCurPrice = pos.curPrice;
        m.downCurrentValue += pos.currentValue;
        if (pos.tokenId) m.downTokenId = pos.tokenId;
      }
    }

    for (const m of polymarketByMarket.values()) {
      m.upAvg = m.upQty > 0 ? m.upCost / m.upQty : 0;
      m.downAvg = m.downQty > 0 ? m.downCost / m.downQty : 0;
    }

    // Fetch live orderbook prices for sides with curPrice = 0
    // This happens when we only have position on one side
    const orderbookFetches: Promise<void>[] = [];
    for (const [slug, pm] of polymarketByMarket.entries()) {
      // If we have UP position but no DOWN curPrice, and we have a tokenId to look up
      if (pm.upQty > 0 && pm.downCurPrice === 0 && pm.upTokenId) {
        // We need to find the DOWN token ID - it's typically the complement
        // For now, we'll try to derive it from the strike_prices table or market metadata
      }
      
      // If we have DOWN position but no UP curPrice
      if (pm.downQty > 0 && pm.upCurPrice === 0 && pm.downTokenId) {
        // Similar logic
      }
    }

    // Fetch missing prices from get-market-tokens for active markets
    for (const [slug, pm] of polymarketByMarket.entries()) {
      // Only fetch if we're missing a price and have an imbalance
      const hasMissingPrice = (pm.upQty > 0 && pm.downCurPrice === 0) || 
                              (pm.downQty > 0 && pm.upCurPrice === 0);
      if (!hasMissingPrice) continue;

      orderbookFetches.push((async () => {
        try {
          // Call our own get-market-tokens function to get both token IDs
          const marketRes = await fetch(`${SUPABASE_URL}/functions/v1/get-market-tokens`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({ slug }),
          });

          if (!marketRes.ok) {
            console.log(`⚠️ get-market-tokens failed for ${slug}: ${marketRes.status}`);
            return;
          }

          const marketData = await marketRes.json();
          const upTokenId = marketData.upTokenId;
          const downTokenId = marketData.downTokenId;

          // Fetch orderbook for the missing side
          if (pm.upQty > 0 && pm.downCurPrice === 0 && downTokenId) {
            const { bestBid } = await fetchOrderbookPrice(downTokenId);
            if (bestBid > 0) {
              pm.downCurPrice = bestBid;
              console.log(`📊 Fetched DOWN price for ${slug}: $${bestBid.toFixed(3)}`);
            }
          }
          
          if (pm.downQty > 0 && pm.upCurPrice === 0 && upTokenId) {
            const { bestBid } = await fetchOrderbookPrice(upTokenId);
            if (bestBid > 0) {
              pm.upCurPrice = bestBid;
              console.log(`📊 Fetched UP price for ${slug}: $${bestBid.toFixed(3)}`);
            }
          }
        } catch (e) {
          console.error(`❌ Error fetching market tokens for ${slug}:`, e);
        }
      })());
    }

    // Wait for all orderbook fetches to complete
    await Promise.all(orderbookFetches);

    // 4. Build result from live Polymarket data
    const result: MarketPosition[] = [];

    for (const [slug, pm] of polymarketByMarket.entries()) {
      const polymarket_up_qty = pm.upQty || 0;
      const polymarket_down_qty = pm.downQty || 0;

      const paired = Math.min(polymarket_up_qty, polymarket_down_qty);
      const unpaired = Math.abs(polymarket_up_qty - polymarket_down_qty);
      
      const upAvg = pm.upAvg || 0;
      const downAvg = pm.downAvg || 0;
      const combined_cost = upAvg + downAvg;
      const locked_profit = combined_cost < 1 && paired > 0 ? paired * (1 - combined_cost) : 0;

      const upCost = polymarket_up_qty * pm.upAvg;
      const downCost = polymarket_down_qty * pm.downAvg;
      const total_cost = upCost + downCost;
      
      const upCurrentValue = pm.upCurrentValue || (polymarket_up_qty * pm.upCurPrice);
      const downCurrentValue = pm.downCurrentValue || (polymarket_down_qty * pm.downCurPrice);
      const current_value = upCurrentValue + downCurrentValue;
      
      const unrealized_pnl = current_value - total_cost;

      result.push({
        market_slug: slug,
        asset: pm.asset || 'UNKNOWN',
        polymarket_up_qty,
        polymarket_up_avg: pm.upAvg,
        polymarket_down_qty,
        polymarket_down_avg: pm.downAvg,
        live_up_price: pm.upCurPrice,
        live_down_price: pm.downCurPrice,
        paired,
        unpaired,
        combined_cost,
        locked_profit,
        total_cost,
        current_value,
        unrealized_pnl,
      });
    }

    result.sort((a, b) => b.market_slug.localeCompare(a.market_slug));

    console.log(`✅ Built ${result.length} live positions + ${expiredMarkets.length} expired markets`);

    return new Response(JSON.stringify({
      success: true,
      wallet_used: walletAddress,
      positions: result,
      summary: {
        total_markets: result.length,
        total_paired: result.reduce((s, p) => s + p.paired, 0),
        total_unpaired: result.reduce((s, p) => s + p.unpaired, 0),
        total_locked_profit: result.reduce((s, p) => s + p.locked_profit, 0),
        total_cost: result.reduce((s, p) => s + p.total_cost, 0),
        total_current_value: result.reduce((s, p) => s + p.current_value, 0),
        total_unrealized_pnl: result.reduce((s, p) => s + p.unrealized_pnl, 0),
        // NEW: Realized PnL from expired markets
        total_realized_pnl: totalRealizedPnL,
        expired_markets_count: expiredMarkets.length,
      },
      // NEW: Include expired markets for detailed view
      expired_markets: expiredMarkets.slice(0, 50), // Limit to 50 most recent
      polymarket_raw: positions15m.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});