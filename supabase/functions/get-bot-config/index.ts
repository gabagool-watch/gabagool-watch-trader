import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-runner-secret',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Verify runner secret
    const runnerSecret = req.headers.get('x-runner-secret');
    const expectedSecret = Deno.env.get('RUNNER_SHARED_SECRET');
    
    if (!runnerSecret || runnerSecret !== expectedSecret) {
      console.error('Invalid or missing runner secret');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch bot config with all V37 fields
    const { data, error } = await supabase
      .from('bot_config')
      .select(`
        *,
        cpp_target,
        price_guard_min,
        price_guard_max,
        pair_limit,
        base_lot_shares,
        min_lot_shares,
        enable_escalation_hedge,
        enable_volatility_margin,
        enable_fill_audit,
        max_shares_per_side,
        max_total_shares_per_market,
        max_notional_per_market,
        global_max_notional,
        stop_new_trades_sec,
        hedge_timeout_sec,
        hedge_must_by_sec,
        escalation_timeout_ms,
        escalation_reprice_ticks,
        volatility_atr_period,
        volatility_margin_multiplier,
        fill_audit_interval_ms,
        config_reload_interval_ms,
        config_version,
        last_reload_requested_at
      `)
      .eq('id', '00000000-0000-0000-0000-000000000001')
      .single();

    if (error) {
      console.error('Error fetching config:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch config', details: error.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`✅ Bot config v${data?.config_version || 1} fetched successfully`);

    // Return raw bot_config row (what ResolvedConfig expects)
    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in get-bot-config:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: 'Internal server error', details: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
