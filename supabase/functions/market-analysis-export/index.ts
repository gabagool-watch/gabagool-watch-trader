import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MarketAnalysisRow {
  market_slug: string;
  start_time: string;
  price_at_start: number | null;
  winning_side: string | null;
  up_ask_at_1min: number | null;
  down_ask_at_1min: number | null;
  data_source: string;
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
    const daysParam = url.searchParams.get('days') || '30';
    const days = parseInt(daysParam, 10);
    const asset = url.searchParams.get('asset') || 'BTC';

    console.log(`[market-analysis-export] Exporting ${asset} markets from last ${days} days`);

    // Step 1: Get all markets from market_history with winning_side and strike price
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    
    const { data: markets, error: marketsError } = await supabase
      .from('market_history')
      .select('slug, event_start_time, strike_price, open_price, result')
      .eq('asset', asset)
      .gte('event_start_time', cutoff)
      .not('event_start_time', 'is', null)
      .order('event_start_time', { ascending: false });

    if (marketsError) {
      console.error('[market-analysis-export] Error fetching markets:', marketsError);
      throw marketsError;
    }

    console.log(`[market-analysis-export] Found ${markets?.length || 0} markets in market_history`);

    // Step 2: Get 1-minute orderbook data from v35_price_ticks
    const { data: v35Ticks, error: v35Error } = await supabase
      .from('v35_price_ticks')
      .select('market_slug, created_at, up_best_ask, down_best_ask, spot_price')
      .eq('asset', asset)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true });

    if (v35Error) {
      console.error('[market-analysis-export] Error fetching v35_price_ticks:', v35Error);
    }

    console.log(`[market-analysis-export] Found ${v35Ticks?.length || 0} v35_price_ticks`);

    // Step 3: Get paper_price_snapshots as fallback
    const { data: paperTicks, error: paperError } = await supabase
      .from('paper_price_snapshots')
      .select('market_slug, created_at, up_best_ask, down_best_ask, binance_price, strike_price')
      .eq('asset', asset)
      .order('created_at', { ascending: true });

    if (paperError) {
      console.error('[market-analysis-export] Error fetching paper_price_snapshots:', paperError);
    }

    console.log(`[market-analysis-export] Found ${paperTicks?.length || 0} paper_price_snapshots`);

    // Build lookup maps for 1-minute data
    // For each market, find the tick closest to 60 seconds after start
    const v35TicksByMarket = new Map<string, typeof v35Ticks>();
    for (const tick of (v35Ticks || [])) {
      const existing = v35TicksByMarket.get(tick.market_slug) || [];
      existing.push(tick);
      v35TicksByMarket.set(tick.market_slug, existing);
    }

    const paperTicksByMarket = new Map<string, typeof paperTicks>();
    for (const tick of (paperTicks || [])) {
      const existing = paperTicksByMarket.get(tick.market_slug) || [];
      existing.push(tick);
      paperTicksByMarket.set(tick.market_slug, existing);
    }

    // Helper: find tick at approximately 1 minute after start
    function findTickAt1Min(ticks: { created_at: string; up_best_ask: number; down_best_ask: number }[] | undefined, startTime: Date): { up_ask: number | null; down_ask: number | null } | null {
      if (!ticks || ticks.length === 0) return null;

      const targetTime = new Date(startTime.getTime() + 60 * 1000); // 1 minute after start
      const minTime = new Date(startTime.getTime() + 50 * 1000);    // 50 seconds
      const maxTime = new Date(startTime.getTime() + 90 * 1000);    // 90 seconds

      // Find ticks in the window
      const ticksInWindow = ticks.filter(t => {
        const tickTime = new Date(t.created_at);
        return tickTime >= minTime && tickTime <= maxTime;
      });

      if (ticksInWindow.length === 0) return null;

      // Find the one closest to 60 seconds
      let closest = ticksInWindow[0];
      let closestDiff = Math.abs(new Date(closest.created_at).getTime() - targetTime.getTime());

      for (const tick of ticksInWindow) {
        const diff = Math.abs(new Date(tick.created_at).getTime() - targetTime.getTime());
        if (diff < closestDiff) {
          closest = tick;
          closestDiff = diff;
        }
      }

      return {
        up_ask: closest.up_best_ask,
        down_ask: closest.down_best_ask
      };
    }

    // Build the result
    const results: MarketAnalysisRow[] = [];

    for (const market of (markets || [])) {
      const startTime = new Date(market.event_start_time);
      
      // Try v35_price_ticks first
      const v35TicksForMarket = v35TicksByMarket.get(market.slug) || undefined;
      const v35Tick = findTickAt1Min(v35TicksForMarket, startTime);
      
      // Fallback to paper_price_snapshots
      const paperTicksForMarket = paperTicksByMarket.get(market.slug) || undefined;
      const paperTick = v35Tick ? null : findTickAt1Min(paperTicksForMarket, startTime);

      const oneMinData = v35Tick || paperTick;

      results.push({
        market_slug: market.slug,
        start_time: market.event_start_time,
        price_at_start: market.strike_price || market.open_price || null,
        winning_side: market.result || null,
        up_ask_at_1min: oneMinData?.up_ask || null,
        down_ask_at_1min: oneMinData?.down_ask || null,
        data_source: v35Tick ? 'v35_price_ticks' : (paperTick ? 'paper_price_snapshots' : 'none')
      });
    }

    // Summary stats
    const withComplete = results.filter(r => r.price_at_start && r.winning_side && r.up_ask_at_1min && r.down_ask_at_1min);
    const withPriceOnly = results.filter(r => r.price_at_start && r.winning_side);
    
    const summary = {
      export_time: new Date().toISOString(),
      days_exported: days,
      asset,
      total_markets: results.length,
      markets_with_1min_data: results.filter(r => r.up_ask_at_1min !== null).length,
      markets_with_complete_data: withComplete.length,
      markets_with_price_and_result: withPriceOnly.length,
      data_sources: {
        v35_price_ticks: results.filter(r => r.data_source === 'v35_price_ticks').length,
        paper_price_snapshots: results.filter(r => r.data_source === 'paper_price_snapshots').length,
        none: results.filter(r => r.data_source === 'none').length,
      }
    };

    console.log(`[market-analysis-export] Summary:`, summary);

    // Format as CSV for easy import
    const format = url.searchParams.get('format') || 'json';
    
    if (format === 'csv') {
      const csvHeader = 'market_slug,start_time,price_at_start,winning_side,up_ask_at_1min,down_ask_at_1min,data_source\n';
      const csvRows = results.map(r => 
        `${r.market_slug},${r.start_time},${r.price_at_start || ''},${r.winning_side || ''},${r.up_ask_at_1min || ''},${r.down_ask_at_1min || ''},${r.data_source}`
      ).join('\n');

      return new Response(csvHeader + csvRows, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="market-analysis-${asset}-${days}d.csv"`,
        },
      });
    }

    const exportData = {
      summary,
      markets: results,
    };

    return new Response(JSON.stringify(exportData, null, 2), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="market-analysis-${asset}-${days}d.json"`,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[market-analysis-export] Error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
