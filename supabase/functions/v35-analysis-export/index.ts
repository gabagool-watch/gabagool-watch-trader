import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface PriceTick {
  ts: number;
  spot_price: number;
  market_slug: string;
}

interface ExpirySnapshot {
  id: string;
  market_slug: string;
  asset: string;
  expiry_time: string;
  snapshot_time: string;
  api_up_qty: number;
  api_down_qty: number;
  api_up_cost: number;
  api_down_cost: number;
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  avg_up_price: number;
  avg_down_price: number;
  up_best_bid: number;
  up_best_ask: number;
  down_best_bid: number;
  down_best_ask: number;
  was_imbalanced: boolean;
  imbalance_ratio: number;
  predicted_winning_side: string;
  predicted_pnl: number;
  spot_price: number;
  strike_price: number;
}

// Calculate crossing count for a market
function calculateCrossingCount(ticks: PriceTick[], strikePrice: number): number {
  if (ticks.length < 2 || !strikePrice) return 0;
  
  let crossings = 0;
  let prevSide = ticks[0].spot_price >= strikePrice ? 'UP' : 'DOWN';
  
  for (let i = 1; i < ticks.length; i++) {
    const currentSide = ticks[i].spot_price >= strikePrice ? 'UP' : 'DOWN';
    if (currentSide !== prevSide) {
      crossings++;
      prevSide = currentSide;
    }
  }
  
  return crossings;
}

// Calculate price volatility stats
function calculatePriceStats(ticks: PriceTick[]) {
  if (ticks.length < 2) return { min: 0, max: 0, range: 0, volatility: 0 };
  
  const prices = ticks.map(t => t.spot_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  
  // Calculate standard deviation
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const volatility = Math.sqrt(variance);
  
  return { min, max, range, volatility };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const url = new URL(req.url);
    const hoursParam = url.searchParams.get('hours') || '30';
    const hours = parseInt(hoursParam, 10);
    
    const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    
    console.log(`[v35-analysis-export] Exporting data from last ${hours} hours (since ${cutoffTime})`);

    // Fetch all data in parallel
    const [snapshotsRes, fillsRes, ticksRes, settlementsRes] = await Promise.all([
      supabase
        .from('v35_expiry_snapshots')
        .select('*')
        .gte('snapshot_time', cutoffTime)
        .order('snapshot_time', { ascending: true }),
      supabase
        .from('v35_fills')
        .select('*')
        .gte('created_at', cutoffTime)
        .order('created_at', { ascending: true }),
      supabase
        .from('v35_price_ticks')
        .select('ts, spot_price, market_slug, up_best_bid, up_best_ask, down_best_bid, down_best_ask, created_at')
        .gte('created_at', cutoffTime)
        .order('ts', { ascending: true }),
      supabase
        .from('v35_settlements')
        .select('*')
        .gte('created_at', cutoffTime)
        .order('created_at', { ascending: true }),
    ]);

    const snapshots = (snapshotsRes.data || []) as ExpirySnapshot[];
    const fills = fillsRes.data || [];
    const allTicks = (ticksRes.data || []) as PriceTick[];
    const settlements = settlementsRes.data || [];

    console.log(`[v35-analysis-export] Fetched: ${snapshots.length} snapshots, ${fills.length} fills, ${allTicks.length} ticks, ${settlements.length} settlements`);

    // Group ticks by market for crossing analysis
    const ticksByMarket = new Map<string, PriceTick[]>();
    for (const tick of allTicks) {
      const existing = ticksByMarket.get(tick.market_slug) || [];
      existing.push(tick);
      ticksByMarket.set(tick.market_slug, existing);
    }

    // Enrich snapshots with crossing data
    const enrichedSnapshots = snapshots.map(snapshot => {
      const marketTicks = ticksByMarket.get(snapshot.market_slug) || [];
      
      // Get first tick's spot_price as strike estimate if not available
      const strikePrice = snapshot.strike_price || (marketTicks.length > 0 ? marketTicks[0].spot_price : null);
      
      const crossingCount = strikePrice ? calculateCrossingCount(marketTicks, strikePrice) : null;
      const priceStats = calculatePriceStats(marketTicks);
      
      // Determine actual winning side based on final spot vs strike
      const finalSpot = marketTicks.length > 0 ? marketTicks[marketTicks.length - 1].spot_price : null;
      const actualWinningSide = strikePrice && finalSpot 
        ? (finalSpot >= strikePrice ? 'UP' : 'DOWN')
        : null;
      
      return {
        ...snapshot,
        calculated_strike_price: strikePrice,
        crossing_count: crossingCount,
        tick_count: marketTicks.length,
        price_min: priceStats.min,
        price_max: priceStats.max,
        price_range: priceStats.range,
        price_volatility: priceStats.volatility,
        final_spot_price: finalSpot,
        actual_winning_side: actualWinningSide,
      };
    });

    // Calculate summary statistics
    const summary = {
      export_time: new Date().toISOString(),
      hours_exported: hours,
      cutoff_time: cutoffTime,
      total_snapshots: enrichedSnapshots.length,
      total_fills: fills.length,
      total_price_ticks: allTicks.length,
      total_settlements: settlements.length,
      unique_markets: new Set(enrichedSnapshots.map(s => s.market_slug)).size,
      
      // P&L summary
      total_pnl: enrichedSnapshots.reduce((sum, s) => sum + (s.predicted_pnl || 0), 0),
      winning_bets: enrichedSnapshots.filter(s => (s.predicted_pnl || 0) > 0).length,
      losing_bets: enrichedSnapshots.filter(s => (s.predicted_pnl || 0) < 0).length,
      breakeven_bets: enrichedSnapshots.filter(s => s.predicted_pnl === 0).length,
      
      // Crossing analysis
      crossing_distribution: {
        '0': enrichedSnapshots.filter(s => s.crossing_count === 0).length,
        '1': enrichedSnapshots.filter(s => s.crossing_count === 1).length,
        '2': enrichedSnapshots.filter(s => s.crossing_count === 2).length,
        '3': enrichedSnapshots.filter(s => s.crossing_count === 3).length,
        '4': enrichedSnapshots.filter(s => s.crossing_count === 4).length,
        '5+': enrichedSnapshots.filter(s => (s.crossing_count || 0) >= 5).length,
      },
      
      // Crossing winrates
      crossing_winrates: {} as Record<string, { wins: number; losses: number; pnl: number; winrate: number }>,
    };

    // Calculate winrates per crossing bucket
    for (let i = 0; i <= 5; i++) {
      const bucket = i === 5 ? '5+' : i.toString();
      const bets = enrichedSnapshots.filter(s => 
        i === 5 ? (s.crossing_count || 0) >= 5 : s.crossing_count === i
      );
      const wins = bets.filter(b => (b.predicted_pnl || 0) > 0).length;
      const losses = bets.filter(b => (b.predicted_pnl || 0) < 0).length;
      const pnl = bets.reduce((sum, b) => sum + (b.predicted_pnl || 0), 0);
      const total = wins + losses;
      
      summary.crossing_winrates[bucket] = {
        wins,
        losses,
        pnl: Math.round(pnl * 100) / 100,
        winrate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
      };
    }

    // Prepare export data
    const exportData = {
      summary,
      expiry_snapshots: enrichedSnapshots,
      fills,
      settlements,
      // Include sampled price ticks (every 10th tick to reduce size)
      price_ticks_sampled: allTicks.filter((_, i) => i % 10 === 0).map(t => ({
        ts: t.ts,
        market_slug: t.market_slug,
        spot_price: t.spot_price,
      })),
      // Full price ticks grouped by market for detailed analysis
      price_ticks_by_market: Object.fromEntries(ticksByMarket),
    };

    const jsonString = JSON.stringify(exportData, null, 2);
    
    console.log(`[v35-analysis-export] Export complete: ${(jsonString.length / 1024).toFixed(1)} KB`);

    return new Response(jsonString, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="v35-analysis-export-${hours}h-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[v35-analysis-export] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
