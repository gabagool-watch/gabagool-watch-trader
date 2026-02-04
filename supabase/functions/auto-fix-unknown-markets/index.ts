import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('[AutoFix] Starting auto-fix for unknown markets...');

    // Fetch all UNKNOWN markets
    const { data: unknownMarkets, error: fetchError } = await supabase
      .from('market_history')
      .select('slug')
      .eq('result', 'UNKNOWN')
      .limit(100);

    if (fetchError) {
      console.error('[AutoFix] Error fetching unknown markets:', fetchError);
      throw fetchError;
    }

    if (!unknownMarkets || unknownMarkets.length === 0) {
      console.log('[AutoFix] No unknown markets found');
      return new Response(
        JSON.stringify({ success: true, fixed: 0, message: 'No unknown markets' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[AutoFix] Found ${unknownMarkets.length} unknown markets`);

    let fixedCount = 0;
    const fixedMarkets: string[] = [];
    const unfixableMarkets: string[] = [];

    for (const market of unknownMarkets) {
      // Check strike_prices for oracle data
      const { data: oracleData } = await supabase
        .from('strike_prices')
        .select('open_price, close_price')
        .eq('market_slug', market.slug)
        .maybeSingle();

      if (oracleData?.open_price && oracleData?.close_price) {
        const result = oracleData.close_price > oracleData.open_price ? 'UP' : 'DOWN';

        const { error: updateError } = await supabase
          .from('market_history')
          .update({
            open_price: oracleData.open_price,
            close_price: oracleData.close_price,
            result,
            updated_at: new Date().toISOString(),
          })
          .eq('slug', market.slug);

        if (!updateError) {
          fixedCount++;
          fixedMarkets.push(`${market.slug} → ${result}`);
          console.log(`[AutoFix] Fixed ${market.slug} → ${result}`);
        } else {
          console.error(`[AutoFix] Error updating ${market.slug}:`, updateError);
        }
      } else {
        unfixableMarkets.push(market.slug);
      }
    }

    console.log(`[AutoFix] Complete. Fixed: ${fixedCount}, Unfixable: ${unfixableMarkets.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        fixed: fixedCount,
        fixedMarkets,
        unfixable: unfixableMarkets.length,
        unfixableMarkets,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    console.error('[AutoFix] Error:', errorMessage);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
