import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-runner-secret',
};

const RUNNER_SECRET = Deno.env.get('RUNNER_SHARED_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const LEASE_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// Small helpers (keep runner-proxy resilient to transient network resets)
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isTransientNetworkError(err: any): boolean {
  const msg = String(err?.message || err?.details || err || '').toLowerCase();
  return (
    msg.includes('connection reset') ||
    msg.includes('sendrequest') ||
    msg.includes('connection error') ||
    msg.includes('fetch') ||
    msg.includes('timeout')
  );
}

async function insertWithRetry(
  supabase: any,
  table: string,
  rows: any[],
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<{ ok: true } | { ok: false; error: any; transient: boolean }> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;

  let lastError: any = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const { error } = await supabase.from(table).insert(rows);
    if (!error) return { ok: true };

    lastError = error;
    const transient = isTransientNetworkError(error);
    if (!transient) return { ok: false, error, transient: false };

    if (attempt < retries) {
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }

  return { ok: false, error: lastError, transient: true };
}

type Action =
  | 'get-markets'
  | 'get-trades'
  | 'save-trade'
  // V26 trades (pre-market runner)
  | 'v26-save-trade'
  | 'v26-update-trade'
  | 'v26-has-trade'
  | 'v26-get-oracle'
  | 'heartbeat'
  | 'offline'
  | 'get-pending-orders'
  | 'get-stale-orders'  // v7.4.0: Stale order cleanup
  | 'update-order'
  | 'sync-positions'
  | 'save-price-ticks'
  | 'save-snapshot-logs'
  | 'save-fill-logs'
  | 'save-settlement-logs'
  | 'save-settlement-failure'
  // v7.3.2: Runner lease actions
  | 'lease-status'
  | 'lease-claim'
  | 'lease-renew'
  | 'lease-release'
  // NEW: Observability v1 actions
  | 'save-bot-event'
  | 'save-bot-events'
  | 'save-order-lifecycle'
  | 'save-inventory-snapshot'
  | 'save-inventory-snapshots'
  | 'save-funding-snapshot'
  // v6.3.0: Skew Explainability
  | 'save-hedge-intent'
  | 'update-hedge-intent'
  // v7.5.0: Gabagool Decision Logs
  | 'save-decision-snapshot'
  | 'save-decision-snapshots'
  | 'save-account-position-snapshot'
  | 'save-state-reconciliation'
  | 'save-fill-attribution'
  | 'save-hedge-skip'
  | 'save-hedge-skip-logs'
  | 'save-mtm-snapshot'
  | 'save-gabagool-metrics'
  | 'get-v26-config'
  // V27 analytics
  | 'save-v27-evaluation'
  // Toxicity Filter v2
  | 'save-toxicity-features'
  | 'update-toxicity-outcome'
  | 'get-toxicity-history'
  // Price feed WebSocket logger
  | 'save-realtime-price-logs'
  // V35 Orderbook snapshots
  | 'save-v35-orderbook-snapshot'
  | 'save-v35-orderbook-snapshots'
  // V35 Fills and Settlements
  | 'save-v35-fill'
  | 'save-v35-position'
  | 'save-v35-settlement'
  // V35 Expiry Snapshots (precise end-of-market archiving)
  | 'save-v35-expiry-snapshot'
  // V35 Price Ticks (spot price logging for crossing analysis)
  | 'save-v35-price-tick';

interface RequestBody {
  action: Action;
  data?: Record<string, unknown>;
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Debug logging (presence/length only, not values)
    const providedSecret = req.headers.get('x-runner-secret');
    const authHeader = req.headers.get('authorization');
    
    console.log('[runner-proxy] 🔍 DEBUG Auth check:', {
      'x-runner-secret_present': !!providedSecret,
      'x-runner-secret_length': providedSecret?.length ?? 0,
      'authorization_present': !!authHeader,
      'authorization_length': authHeader?.length ?? 0,
      'env_RUNNER_SHARED_SECRET_present': !!RUNNER_SECRET,
      'env_RUNNER_SHARED_SECRET_length': RUNNER_SECRET?.length ?? 0,
      'secrets_match': providedSecret === RUNNER_SECRET,
    });
    
    // Validate secret
    if (!RUNNER_SECRET || providedSecret !== RUNNER_SECRET) {
      console.error('[runner-proxy] ❌ Invalid or missing secret - check env var RUNNER_SHARED_SECRET');
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const body: RequestBody = await req.json();
    const { action, data } = body;

    console.log(`[runner-proxy] Action: ${action}`);

    switch (action) {
      case 'get-markets': {
        // Proxy to get-market-tokens function
        // Pass v26 flag if provided (for V26 pre-market strategy)
        const v26Mode = data?.v26 === true;
        const response = await fetch(`${SUPABASE_URL}/functions/v1/get-market-tokens`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ v26: v26Mode }),
        });
        const result = await response.json();
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-trades': {
        const slugs = data?.slugs as string[] | undefined;
        if (!slugs || slugs.length === 0) {
          return new Response(JSON.stringify({ success: true, trades: [] }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // v7.2.7 FIX: Only count FILLED trades for position calculation
        // Previously this counted ALL trades including pending/cancelled, causing
        // the ledger to show inflated positions and bypassing the 100 share cap.
        //
        // CRITICAL: Only status='filled' trades represent actual positions.
        // 'pending', 'cancelled', 'failed', 'partial' should NOT be counted.
        const { data: trades, error } = await supabase
          .from('live_trades')
          .select('market_slug, outcome, shares, total')
          .in('market_slug', slugs)
          .eq('status', 'filled');

        if (error) {
          console.error('[runner-proxy] get-trades error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] get-trades: returning ${trades?.length ?? 0} FILLED trades for ${slugs.length} markets`);

        return new Response(JSON.stringify({ success: true, trades: trades || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-trade': {
        const trade = data?.trade as Record<string, unknown> | undefined;
        if (!trade) {
          return new Response(JSON.stringify({ success: false, error: 'Missing trade data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get wallet address from config to tag this trade
        const { data: config } = await supabase
          .from('bot_config')
          .select('polymarket_address')
          .single();

        // Add wallet_address to trade
        const tradeWithWallet = {
          ...trade,
          wallet_address: config?.polymarket_address || null,
        };

        const { error } = await supabase.from('live_trades').insert(tradeWithWallet);

        if (error) {
          console.error('[runner-proxy] save-trade error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Trade saved: ${trade.outcome} ${trade.shares}@${trade.price}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V26 trades (pre-market runner)
      // ============================================================
      case 'v26-save-trade': {
        const trade = data?.trade as Record<string, unknown> | undefined;
        if (!trade) {
          return new Response(JSON.stringify({ success: false, error: 'Missing trade data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: inserted, error } = await supabase
          .from('v26_trades')
          .insert(trade)
          .select('id')
          .single();

        if (error) {
          console.error('[runner-proxy] v26-save-trade error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, id: inserted?.id ?? null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'v26-update-trade': {
        const id = data?.id as string | undefined;
        const updates = data?.updates as Record<string, unknown> | undefined;

        console.log(`[runner-proxy] v26-update-trade: id=${id}, updates=${JSON.stringify(updates)}`);

        if (!id || !updates) {
          return new Response(JSON.stringify({ success: false, error: 'Missing id or updates' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('v26_trades').update(updates).eq('id', id);

        if (error) {
          console.error('[runner-proxy] v26-update-trade error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'v26-has-trade': {
        const marketId = data?.market_id as string | undefined;
        const asset = data?.asset as string | undefined;

        if (!marketId || !asset) {
          return new Response(JSON.stringify({ success: false, error: 'Missing market_id or asset' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: rows, error } = await supabase
          .from('v26_trades')
          .select('id')
          .eq('market_id', marketId)
          .eq('asset', asset)
          .limit(1);

        if (error) {
          console.error('[runner-proxy] v26-has-trade error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, exists: (rows?.length ?? 0) > 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'v26-get-oracle': {
        const marketSlug = data?.market_slug as string | undefined;
        const asset = data?.asset as string | undefined;

        if (!marketSlug || !asset) {
          return new Response(JSON.stringify({ success: false, error: 'Missing market_slug or asset' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: row, error } = await supabase
          .from('strike_prices')
          .select('market_slug, asset, strike_price, close_price, close_timestamp, quality')
          .eq('market_slug', marketSlug)
          .eq('asset', asset)
          .limit(1)
          .maybeSingle();

        if (error) {
          console.error('[runner-proxy] v26-get-oracle error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, oracle: row ?? null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'heartbeat': {
        const heartbeat = data?.heartbeat as Record<string, unknown> | undefined;
        if (!heartbeat) {
          return new Response(JSON.stringify({ success: false, error: 'Missing heartbeat data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase
          .from('runner_heartbeats')
          .upsert(heartbeat, { onConflict: 'runner_id' });

        if (error) {
          console.error('[runner-proxy] heartbeat error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'offline': {
        const runnerId = data?.runner_id as string | undefined;
        if (!runnerId) {
          return new Response(JSON.stringify({ success: false, error: 'Missing runner_id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase
          .from('runner_heartbeats')
          .update({ status: 'offline', last_heartbeat: new Date().toISOString() })
          .eq('runner_id', runnerId);

        if (error) {
          console.error('[runner-proxy] offline error:', error);
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'lease-status': {
        const { data: lease, error } = await supabase
          .from('runner_lease')
          .select('runner_id, locked_until')
          .eq('id', LEASE_ID)
          .single();

        if (error) {
          console.error('[runner-proxy] lease-status error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, lease }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'lease-claim': {
        const runnerId = data?.runner_id as string | undefined;
        const durationMsRaw = data?.lease_duration_ms;
        const durationMs = Number.isFinite(Number(durationMsRaw)) ? Number(durationMsRaw) : 60_000;
        const forceAcquire = data?.force === true; // v7.3.3: Force acquire option

        if (!runnerId) {
          return new Response(JSON.stringify({ success: false, error: 'Missing runner_id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const lockedUntilIso = new Date(now.getTime() + durationMs).toISOString();

        let updated;
        let updateError;

        if (forceAcquire) {
          // v7.3.3: Force mode - unconditionally take the lease
          console.log(`[runner-proxy] FORCE lease-claim by ${runnerId}`);
          const result = await supabase
            .from('runner_lease')
            .update({
              runner_id: runnerId,
              locked_until: lockedUntilIso,
              updated_at: nowIso,
            })
            .eq('id', LEASE_ID)
            .select('runner_id, locked_until');
          updated = result.data;
          updateError = result.error;
        } else {
          // Normal mode: atomic claim only if expired OR already ours
          const result = await supabase
            .from('runner_lease')
            .update({
              runner_id: runnerId,
              locked_until: lockedUntilIso,
              updated_at: nowIso,
            })
            .eq('id', LEASE_ID)
            .or(`locked_until.lt.${nowIso},runner_id.eq.${runnerId}`)
            .select('runner_id, locked_until');
          updated = result.data;
          updateError = result.error;
        }

        if (updateError) {
          console.error('[runner-proxy] lease-claim update error:', updateError);
          return new Response(JSON.stringify({ success: false, error: updateError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const acquired = (updated?.[0]?.runner_id === runnerId);

        if (acquired) {
          return new Response(JSON.stringify({ success: true, acquired: true, lease: updated?.[0], forced: forceAcquire }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { data: lease } = await supabase
          .from('runner_lease')
          .select('runner_id, locked_until')
          .eq('id', LEASE_ID)
          .single();

        return new Response(JSON.stringify({ success: true, acquired: false, lease }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'lease-renew': {
        const runnerId = data?.runner_id as string | undefined;
        const durationMsRaw = data?.lease_duration_ms;
        const durationMs = Number.isFinite(Number(durationMsRaw)) ? Number(durationMsRaw) : 60_000;

        if (!runnerId) {
          return new Response(JSON.stringify({ success: false, error: 'Missing runner_id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const now = new Date();
        const nowIso = now.toISOString();
        const lockedUntilIso = new Date(now.getTime() + durationMs).toISOString();

        const { data: updated, error } = await supabase
          .from('runner_lease')
          .update({
            locked_until: lockedUntilIso,
            updated_at: nowIso,
          })
          .eq('id', LEASE_ID)
          .eq('runner_id', runnerId)
          .select('runner_id, locked_until');

        if (error) {
          console.error('[runner-proxy] lease-renew error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const renewed = (updated?.[0]?.runner_id === runnerId);

        return new Response(JSON.stringify({ success: true, renewed, lease: updated?.[0] ?? null }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'lease-release': {
        const runnerId = data?.runner_id as string | undefined;
        if (!runnerId) {
          return new Response(JSON.stringify({ success: false, error: 'Missing runner_id' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const nowIso = new Date().toISOString();
        const pastIso = new Date(Date.now() - 1000).toISOString();

        const { data: updated, error } = await supabase
          .from('runner_lease')
          .update({
            runner_id: '',
            locked_until: pastIso,
            updated_at: nowIso,
          })
          .eq('id', LEASE_ID)
          .eq('runner_id', runnerId)
          .select('runner_id, locked_until');

        if (error) {
          console.error('[runner-proxy] lease-release error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const released = (updated?.length ?? 0) > 0;

        return new Response(JSON.stringify({ success: true, released }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-pending-orders': {
        // Fetch pending orders for the runner to execute
        const { data: orders, error } = await supabase
          .from('order_queue')
          .select('*')
          .eq('status', 'pending')
          .order('created_at', { ascending: true })
          .limit(10);

        if (error) {
          console.error('[runner-proxy] get-pending-orders error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Mark orders as "processing" to prevent double-execution
        if (orders && orders.length > 0) {
          const orderIds = orders.map(o => o.id);
          await supabase
            .from('order_queue')
            .update({ status: 'processing' })
            .in('id', orderIds);
          
          console.log(`[runner-proxy] ✅ Sending ${orders.length} orders to runner`);
        }

        return new Response(JSON.stringify({ success: true, orders: orders || [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // v7.4.0: Fetch stale placed orders for cleanup
      // v7.4.1: Support separate TTLs for entry vs hedge orders
      case 'get-stale-orders': {
        const entryTtlMs = (data?.ttl_ms as number) ?? 30_000; // Default 30 seconds for entry
        const hedgeTtlMs = (data?.hedge_ttl_ms as number) ?? 15_000; // Default 15 seconds for hedge
        
        const entryCutoff = new Date(Date.now() - entryTtlMs).toISOString();
        const hedgeCutoff = new Date(Date.now() - hedgeTtlMs).toISOString();
        
        // Fetch stale entry orders
        const { data: entryOrders, error: entryError } = await supabase
          .from('order_queue')
          .select('id, market_slug, asset, outcome, shares, price, order_id, intent_type, created_at, executed_at')
          .eq('status', 'placed')
          .not('order_id', 'is', null)
          .or('intent_type.is.null,intent_type.neq.HEDGE')
          .lt('executed_at', entryCutoff)
          .order('executed_at', { ascending: true })
          .limit(20);

        // Fetch stale hedge orders (more aggressive TTL)
        const { data: hedgeOrders, error: hedgeError } = await supabase
          .from('order_queue')
          .select('id, market_slug, asset, outcome, shares, price, order_id, intent_type, created_at, executed_at')
          .eq('status', 'placed')
          .eq('intent_type', 'HEDGE')
          .not('order_id', 'is', null)
          .lt('executed_at', hedgeCutoff)
          .order('executed_at', { ascending: true })
          .limit(20);

        if (entryError || hedgeError) {
          const error = entryError || hedgeError;
          console.error('[runner-proxy] get-stale-orders error:', error);
          return new Response(JSON.stringify({ success: false, error: error!.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const staleOrders = [...(entryOrders || []), ...(hedgeOrders || [])];
        console.log(`[runner-proxy] 🕐 Found ${staleOrders.length} stale orders (${entryOrders?.length || 0} entry, ${hedgeOrders?.length || 0} hedge)`);

        return new Response(JSON.stringify({ success: true, orders: staleOrders }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-order': {
        const orderId = data?.order_id as string | undefined;
        const status = data?.status as string | undefined;
        const orderResult = data?.result as Record<string, unknown> | undefined;

        if (!orderId || !status) {
          return new Response(JSON.stringify({ success: false, error: 'Missing order_id or status' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const updateData: Record<string, unknown> = {
          status,
          executed_at: new Date().toISOString(),
        };

        if (orderResult) {
          if (orderResult.order_id) updateData.order_id = orderResult.order_id;
          if (orderResult.avg_fill_price) updateData.avg_fill_price = orderResult.avg_fill_price;
          if (orderResult.error) updateData.error_message = orderResult.error;
        }

        const { error } = await supabase
          .from('order_queue')
          .update(updateData)
          .eq('id', orderId);

        if (error) {
          console.error('[runner-proxy] update-order error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Order ${orderId} updated to ${status}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'sync-positions': {
        // Sync positions from Polymarket API and reconcile with our database
        // Receives positions data from runner, updates live_trades status
        // v7.5.0: Also writes to bot_positions for dashboard real-time display
        const positions = data?.positions as Array<{
          conditionId: string;
          market: string;
          outcome: string;
          size: number;
          avgPrice: number;
          currentValue: number;
          initialValue: number;
          eventSlug?: string;
          tokenId?: string;
        }> | undefined;

        const wallet = data?.wallet as string | undefined;

        if (!positions || !wallet) {
          return new Response(JSON.stringify({ success: false, error: 'Missing positions or wallet' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 🔄 Syncing ${positions.length} positions for wallet ${wallet.slice(0, 10)}...`);

        // ========== PART 1: Write to bot_positions for dashboard ==========
        const syncedAt = new Date().toISOString();
        const positionRecords = positions
          .filter(p => p.size > 0.01) // Filter out dust positions
          .map(p => {
            const slug = p.eventSlug || p.market;
            const cost = p.initialValue;
            const value = p.currentValue;
            const pnl = value - cost;
            const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
            const currentPrice = p.size > 0 ? value / p.size : p.avgPrice;
            
            return {
              wallet_address: wallet,
              market_slug: slug,
              outcome: p.outcome.toUpperCase(),
              shares: p.size,
              avg_price: p.avgPrice,
              current_price: currentPrice,
              value: value,
              cost: cost,
              pnl: pnl,
              pnl_percent: pnlPercent,
              token_id: p.tokenId || null,
              synced_at: syncedAt,
            };
          });

        let upserted = 0;
        let deleted = 0;

        if (positionRecords.length > 0) {
          // Upsert all positions - need to do one by one since no unique constraint
          for (const record of positionRecords) {
            const { error: upsertError } = await supabase
              .from('bot_positions')
              .upsert(record, { 
                onConflict: 'wallet_address,market_slug,outcome',
                ignoreDuplicates: false 
              });
            
            if (!upsertError) {
              upserted++;
            } else {
              console.error(`[runner-proxy] bot_positions upsert error: ${upsertError.message}`);
            }
          }
          console.log(`[runner-proxy] 📊 bot_positions: ${upserted} upserted`);
        }

        // Delete stale positions (not in current sync, synced_at older than now)
        const currentSlugsOutcomes = positionRecords.map(p => `${p.market_slug}|${p.outcome}`);
        
        const { data: existingPositions } = await supabase
          .from('bot_positions')
          .select('id, market_slug, outcome')
          .eq('wallet_address', wallet);

        if (existingPositions && existingPositions.length > 0) {
          const toDelete = existingPositions.filter(ep => 
            !currentSlugsOutcomes.includes(`${ep.market_slug}|${ep.outcome}`)
          );
          
          if (toDelete.length > 0) {
            const deleteIds = toDelete.map(d => d.id);
            const { error: deleteError } = await supabase
              .from('bot_positions')
              .delete()
              .in('id', deleteIds);
            
            if (!deleteError) {
              deleted = toDelete.length;
              console.log(`[runner-proxy] 🗑️ bot_positions: ${deleted} stale deleted`);
            }
          }
        }

        // ========== PART 2: Reconcile live_trades (existing logic) ==========
        // Get recent live_trades that are pending/unknown
        const { data: pendingTrades, error: fetchError } = await supabase
          .from('live_trades')
          .select('id, market_slug, outcome, shares, status, order_id, created_at')
          .eq('wallet_address', wallet)
          .in('status', ['pending', 'unknown', 'placed'])
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

        if (fetchError) {
          console.error('[runner-proxy] sync-positions fetch error:', fetchError);
          return new Response(JSON.stringify({ success: false, error: fetchError.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Create a map of actual positions from Polymarket
        const positionMap = new Map<string, { shares: number; outcome: string }>();
        for (const p of positions) {
          const slug = p.eventSlug || p.market;
          const key = `${slug}-${p.outcome.toUpperCase()}`;
          positionMap.set(key, { shares: p.size, outcome: p.outcome });
        }

        let updated = 0;
        let cancelled = 0;

        // For each pending trade, check if it exists in actual positions
        for (const trade of (pendingTrades || [])) {
          const key = `${trade.market_slug}-${trade.outcome}`;
          const actualPosition = positionMap.get(key);

          if (actualPosition && actualPosition.shares >= trade.shares * 0.9) {
            // Position exists with enough shares - mark as filled
            const { error: updateError } = await supabase
              .from('live_trades')
              .update({ status: 'filled' })
              .eq('id', trade.id);
            
            if (!updateError) {
              updated++;
              console.log(`[runner-proxy] ✅ Confirmed fill: ${trade.outcome} ${trade.shares} on ${trade.market_slug}`);
            }
          } else {
            // No position found - likely cancelled or failed
            // Only mark as cancelled if the order is old enough (>5 min)
            const tradeAge = Date.now() - new Date(trade.created_at || 0).getTime();
            if (tradeAge > 5 * 60 * 1000) {
              const { error: updateError } = await supabase
                .from('live_trades')
                .update({ status: 'cancelled' })
                .eq('id', trade.id);
              
              if (!updateError) {
                cancelled++;
                console.log(`[runner-proxy] ❌ Marked cancelled: ${trade.outcome} ${trade.shares} on ${trade.market_slug}`);
              }
            }
          }
        }

        console.log(`[runner-proxy] 🔄 Sync complete: ${upserted} positions synced, ${updated} trades filled, ${cancelled} cancelled, ${deleted} stale removed`);

        return new Response(JSON.stringify({ 
          success: true, 
          positions_synced: upserted,
          positions_deleted: deleted,
          trades_updated: updated,
          trades_cancelled: cancelled,
          totalPositions: positions.length 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-price-ticks': {
        // Insert BTC/ETH price ticks from runner (1-second cadence)
        const ticks = data?.ticks as Array<{
          asset: string;
          price: number;
          delta: number;
          delta_percent: number;
          source: string;
        }> | undefined;

        if (!ticks || ticks.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing ticks' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('price_ticks').insert(ticks);

        if (error) {
          console.error('[runner-proxy] save-price-ticks error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: ticks.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-v27-evaluation': {
        const evaluation = data?.evaluation as Record<string, unknown> | undefined;
        if (!evaluation) {
          return new Response(JSON.stringify({ success: false, error: 'Missing evaluation' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('v27_evaluations').insert(evaluation);

        if (error) {
          console.error('[runner-proxy] save-v27-evaluation error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-snapshot-logs': {
        const logs = data?.logs as Array<Record<string, unknown>> | undefined;
        if (!logs || logs.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing logs' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rows = logs.map((l) => ({
          ts: l.ts,
          iso: l.iso,
          market_id: l.marketId,
          asset: l.asset,
          seconds_remaining: l.secondsRemaining,
          spot_price: l.spotPrice,
          strike_price: l.strikePrice,
          delta: l.delta,
          up_bid: l.upBid,
          up_ask: l.upAsk,
          up_mid: l.upMid,
          down_bid: l.downBid,
          down_ask: l.downAsk,
          down_mid: l.downMid,
          spread_up: l.spreadUp,
          spread_down: l.spreadDown,
          combined_ask: l.combinedAsk,
          combined_mid: l.combinedMid,
          cheapest_ask_plus_other_mid: l.cheapestAskPlusOtherMid,
          orderbook_ready: l.orderbookReady,  // v6.2.0
          bot_state: l.botState,
          up_shares: l.upShares,
          down_shares: l.downShares,
          avg_up_cost: l.avgUpCost,
          avg_down_cost: l.avgDownCost,
          pair_cost: l.pairCost,
          skew: l.skew,
          no_liquidity_streak: l.noLiquidityStreak,
          adverse_streak: l.adverseStreak,
        }));

        const { error } = await supabase.from('snapshot_logs').insert(rows);
        if (error) {
          console.error('[runner-proxy] save-snapshot-logs error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-fill-logs': {
        const logs = data?.logs as Array<Record<string, unknown>> | undefined;
        if (!logs || logs.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing logs' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rows = logs.map((l) => ({
          ts: l.ts,
          iso: l.iso,
          market_id: l.marketId,
          asset: l.asset,
          side: l.side,
          order_id: l.orderId,
          client_order_id: l.clientOrderId,
          fill_qty: l.fillQty,
          fill_price: l.fillPrice,
          fill_notional: l.fillNotional,
          intent: l.intent,
          seconds_remaining: l.secondsRemaining,
          spot_price: l.spotPrice,
          strike_price: l.strikePrice,
          delta: l.delta,
          hedge_lag_ms: l.hedgeLagMs,
        }));

        const { error } = await supabase.from('fill_logs').insert(rows);
        if (error) {
          console.error('[runner-proxy] save-fill-logs error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-settlement-logs': {
        const logs = data?.logs as Array<Record<string, unknown>> | undefined;
        if (!logs || logs.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing logs' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rows = logs.map((l) => ({
          ts: l.ts,
          iso: l.iso,
          market_id: l.marketId,
          asset: l.asset,
          open_ts: l.openTs,
          close_ts: l.closeTs,
          final_up_shares: l.finalUpShares,
          final_down_shares: l.finalDownShares,
          avg_up_cost: l.avgUpCost,
          avg_down_cost: l.avgDownCost,
          pair_cost: l.pairCost,
          realized_pnl: l.realizedPnL,
          winning_side: l.winningSide,
          max_delta: l.maxDelta,
          min_delta: l.minDelta,
          time_in_low: l.timeInLow,
          time_in_mid: l.timeInMid,
          time_in_high: l.timeInHigh,
          count_dislocation_95: l.countDislocation95,
          count_dislocation_97: l.countDislocation97,
          last_180s_dislocation_95: l.last180sDislocation95,
          theoretical_pnl: l.theoreticalPnL,
          fees: l.fees,                       // v6.4.0: fees_paid_usd
          total_payout_usd: l.totalPayoutUsd, // v6.4.0: total_payout_usd
        }));

        const { error } = await supabase.from('settlement_logs').insert(rows);
        if (error) {
          console.error('[runner-proxy] save-settlement-logs error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-settlement-failure': {
        // v4.4: Log settlement failure - THE critical metric
        const failure = data?.failure as {
          market_slug: string;
          asset: string;
          up_shares: number;
          down_shares: number;
          up_cost: number;
          down_cost: number;
          lost_side: string;
          lost_cost: number;
          seconds_remaining: number;
          reason: string;
          panic_hedge_attempted: boolean;
          wallet_address?: string;
        } | undefined;

        if (!failure) {
          return new Response(JSON.stringify({ success: false, error: 'Missing failure data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log('[runner-proxy] 🚨 SETTLEMENT FAILURE:', failure);

        const { error } = await supabase.from('settlement_failures').insert(failure);

        if (error) {
          console.error('[runner-proxy] save-settlement-failure error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save single bot event
      case 'save-bot-event': {
        const event = data?.event as {
          ts: number;
          run_id?: string;
          market_id?: string;
          asset: string;
          event_type: string;
          correlation_id?: string;
          reason_code?: string;
          data?: Record<string, unknown>;
        } | undefined;

        if (!event) {
          return new Response(JSON.stringify({ success: false, error: 'Missing event' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('bot_events').insert(event);
        if (error) {
          console.error('[runner-proxy] save-bot-event error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Bot event saved: ${event.event_type}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save batch bot events
      case 'save-bot-events': {
        const events = data?.events as Array<{
          ts: number;
          run_id?: string;
          market_id?: string;
          asset: string;
          event_type: string;
          correlation_id?: string;
          reason_code?: string;
          data?: Record<string, unknown>;
        }> | undefined;

        if (!events || events.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing events' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('bot_events').insert(events);
        if (error) {
          console.error('[runner-proxy] save-bot-events error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Saved ${events.length} bot events`);
        return new Response(JSON.stringify({ success: true, count: events.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save order lifecycle
      case 'save-order-lifecycle': {
        const order = data?.order as {
          client_order_id: string;
          exchange_order_id?: string;
          correlation_id?: string;
          market_id: string;
          asset: string;
          side: string;
          price: number;
          qty: number;
          status: string;
          intent_type: string;
          filled_qty?: number;
          avg_fill_price?: number;
          reserved_notional?: number;
          released_notional?: number;
          created_ts: number;
          last_update_ts: number;
        } | undefined;

        if (!order) {
          return new Response(JSON.stringify({ success: false, error: 'Missing order data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Upsert by client_order_id
        const { error } = await supabase
          .from('orders')
          .upsert(order, { onConflict: 'client_order_id' });

        if (error) {
          console.error('[runner-proxy] save-order-lifecycle error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Order lifecycle saved: ${order.client_order_id} -> ${order.status}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save inventory snapshot
      case 'save-inventory-snapshot': {
        const snapshot = data?.snapshot as {
          ts: number;
          market_id: string;
          asset: string;
          up_shares: number;
          down_shares: number;
          avg_up_cost?: number;
          avg_down_cost?: number;
          pair_cost?: number;
          unpaired_shares?: number; // v7.2.9: This is a GENERATED column - will be stripped
          unpaired_notional_usd?: number;  // v6.4.0
          paired_shares?: number;          // v6.4.0
          paired_delay_sec?: number;       // v6.4.0
          state: string;
          state_age_ms?: number;
          hedge_lag_ms?: number;
          trigger_type?: string;
        } | undefined;

        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // v7.2.9: Strip unpaired_shares - it's a GENERATED ALWAYS column
        const { unpaired_shares: _unused, ...cleanSnapshot } = snapshot;
        
        const { error } = await supabase.from('inventory_snapshots').insert(cleanSnapshot);
        if (error) {
          console.error('[runner-proxy] save-inventory-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save batch inventory snapshots
      case 'save-inventory-snapshots': {
        const snapshots = data?.snapshots as Array<{
          ts: number;
          market_id: string;
          asset: string;
          up_shares: number;
          down_shares: number;
          avg_up_cost?: number;
          avg_down_cost?: number;
          pair_cost?: number;
          unpaired_shares?: number; // v7.2.9: GENERATED column - will be stripped
          unpaired_notional_usd?: number;  // v6.4.0: unpaired exposure in USD
          paired_shares?: number;          // v6.4.0: explicit paired count
          paired_delay_sec?: number;       // v6.4.0: time to complete hedge
          state: string;
          state_age_ms?: number;
          hedge_lag_ms?: number;
          trigger_type?: string;
          skew_allowed_reason?: string;  // v6.3.0
        }> | undefined;

        if (!snapshots || snapshots.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshots' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // v7.2.9: Strip unpaired_shares from all snapshots - it's a GENERATED ALWAYS column
        const cleanSnapshots = snapshots.map(({ unpaired_shares: _unused, ...rest }) => rest);
        
        const { error } = await supabase.from('inventory_snapshots').insert(cleanSnapshots);
        if (error) {
          console.error('[runner-proxy] save-inventory-snapshots error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: snapshots.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // NEW: Observability v1 - Save funding snapshot (CRITICAL)
      case 'save-funding-snapshot': {
        const snapshot = data?.snapshot as {
          ts: number;
          balance_total: number;
          balance_available: number;
          reserved_total?: number;
          reserved_by_market?: Record<string, number>;
          allowance_remaining?: number;
          spendable?: number;
          blocked_reason?: string;
          trigger_type?: string;
        } | undefined;

        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('funding_snapshots').insert(snapshot);
        if (error) {
          console.error('[runner-proxy] save-funding-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 💰 Funding snapshot: bal=${snapshot.balance_available}/${snapshot.balance_total}, blocked=${snapshot.blocked_reason || 'NONE'}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // v6.3.0: Skew Explainability - Save hedge intent
      case 'save-hedge-intent': {
        const intent = data?.intent as {
          ts: number;
          correlation_id?: string;
          run_id?: string;
          market_id: string;
          asset: string;
          side: string;
          intent_type: string;
          intended_qty: number;
          filled_qty?: number;
          status: string;
          abort_reason?: string;
          price_at_intent?: number;
          price_at_resolution?: number;
          resolution_ts?: number;
        } | undefined;

        if (!intent) {
          return new Response(JSON.stringify({ success: false, error: 'Missing intent data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('hedge_intents').insert(intent);
        if (error) {
          console.error('[runner-proxy] save-hedge-intent error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 🎯 Hedge intent: ${intent.intent_type} ${intent.side} ${intent.intended_qty} status=${intent.status}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // v6.3.0: Skew Explainability - Update hedge intent
      case 'update-hedge-intent': {
        const correlationId = data?.correlation_id as string | undefined;
        const marketId = data?.market_id as string | undefined;
        const update = data?.update as {
          status?: string;
          filled_qty?: number;
          abort_reason?: string;
          price_at_resolution?: number;
          resolution_ts?: number;
        } | undefined;

        if (!correlationId || !marketId || !update) {
          return new Response(JSON.stringify({ success: false, error: 'Missing correlation_id, market_id or update data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase
          .from('hedge_intents')
          .update(update)
          .eq('correlation_id', correlationId)
          .eq('market_id', marketId);

        if (error) {
          console.error('[runner-proxy] update-hedge-intent error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 🔄 Hedge intent updated: ${correlationId} -> ${update.status}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // v7.5.0: Gabagool Decision Logs - Decision Snapshot
      case 'save-decision-snapshot': {
        const snapshot = data?.snapshot as Record<string, unknown> | undefined;
        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: snapshot.ts,
          run_id: snapshot.runId,
          correlation_id: snapshot.correlationId,
          market_id: snapshot.marketId,
          asset: snapshot.asset,
          window_start: snapshot.windowStart,
          seconds_remaining: snapshot.secondsRemaining,
          state: snapshot.state,
          intent: snapshot.intent,
          chosen_side: snapshot.chosenSide,
          reason_code: snapshot.reasonCode,
          projected_cpp_maker: snapshot.projectedCppMaker,
          projected_cpp_taker: snapshot.projectedCppTaker,
          cpp_paired_only: snapshot.cppPairedOnly,
          avg_up: snapshot.avgUp,
          avg_down: snapshot.avgDown,
          up_shares: snapshot.upShares,
          down_shares: snapshot.downShares,
          paired_shares: snapshot.pairedShares,
          unpaired_shares: snapshot.unpairedShares,
          best_bid_up: snapshot.bestBidUp,
          best_ask_up: snapshot.bestAskUp,
          best_bid_down: snapshot.bestBidDown,
          best_ask_down: snapshot.bestAskDown,
          depth_summary_up: snapshot.depthSummaryUp,
          depth_summary_down: snapshot.depthSummaryDown,
          book_ready_up: snapshot.bookReadyUp,
          book_ready_down: snapshot.bookReadyDown,
          guards_evaluated: snapshot.guardsEvaluated,
        };

        const { error } = await supabase.from('decision_snapshots').insert(row);
        if (error) {
          console.error('[runner-proxy] save-decision-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 📝 Decision snapshot: ${snapshot.intent} ${snapshot.chosenSide} reason=${snapshot.reasonCode}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-decision-snapshots': {
        const snapshots = data?.snapshots as Array<Record<string, unknown>> | undefined;
        if (!snapshots || snapshots.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshots' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rows = snapshots.map(s => ({
          ts: s.ts,
          run_id: s.runId,
          correlation_id: s.correlationId,
          market_id: s.marketId,
          asset: s.asset,
          window_start: s.windowStart,
          seconds_remaining: s.secondsRemaining,
          state: s.state,
          intent: s.intent,
          chosen_side: s.chosenSide,
          reason_code: s.reasonCode,
          projected_cpp_maker: s.projectedCppMaker,
          projected_cpp_taker: s.projectedCppTaker,
          cpp_paired_only: s.cppPairedOnly,
          avg_up: s.avgUp,
          avg_down: s.avgDown,
          up_shares: s.upShares,
          down_shares: s.downShares,
          paired_shares: s.pairedShares,
          unpaired_shares: s.unpairedShares,
          best_bid_up: s.bestBidUp,
          best_ask_up: s.bestAskUp,
          best_bid_down: s.bestBidDown,
          best_ask_down: s.bestAskDown,
          depth_summary_up: s.depthSummaryUp,
          depth_summary_down: s.depthSummaryDown,
          book_ready_up: s.bookReadyUp,
          book_ready_down: s.bookReadyDown,
          guards_evaluated: s.guardsEvaluated,
        }));

        const { error } = await supabase.from('decision_snapshots').insert(rows);
        if (error) {
          console.error('[runner-proxy] save-decision-snapshots error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Account Position Snapshot (canonical truth)
      case 'save-account-position-snapshot': {
        const snapshot = data?.snapshot as Record<string, unknown> | undefined;
        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: snapshot.ts,
          run_id: snapshot.runId,
          market_id: snapshot.marketId,
          account_up_shares: snapshot.accountUpShares,
          account_down_shares: snapshot.accountDownShares,
          account_avg_up: snapshot.accountAvgUp,
          account_avg_down: snapshot.accountAvgDown,
          wallet_address: snapshot.walletAddress,
          source_endpoint: snapshot.sourceEndpoint,
          source_version: snapshot.sourceVersion,
        };

        const { error } = await supabase.from('account_position_snapshots').insert(row);
        if (error) {
          console.error('[runner-proxy] save-account-position-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // State Reconciliation Result
      case 'save-state-reconciliation': {
        const result = data?.result as Record<string, unknown> | undefined;
        if (!result) {
          return new Response(JSON.stringify({ success: false, error: 'Missing result' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const deltaUp = typeof result.deltaUpShares === 'number' ? result.deltaUpShares : 0;
        const deltaDown = typeof result.deltaDownShares === 'number' ? result.deltaDownShares : 0;
        const row = {
          ts: result.ts,
          run_id: result.runId,
          market_id: result.marketId,
          local_up: result.localUpShares,
          local_down: result.localDownShares,
          account_up: result.accountUpShares,
          account_down: result.accountDownShares,
          delta_shares: Math.abs(deltaUp) + Math.abs(deltaDown),
          delta_invested: result.deltaInvested,
          reconciliation_result: result.reconciliationResult,
          action_taken: result.actionTaken,
        };

        const { error } = await supabase.from('state_reconciliation_results').insert(row);
        if (error) {
          console.error('[runner-proxy] save-state-reconciliation error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 🔄 Reconciliation: ${result.reconciliationResult} delta=${result.deltaShares}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Fill Attribution (economic truth per fill)
      case 'save-fill-attribution': {
        const attribution = data?.attribution as Record<string, unknown> | undefined;
        if (!attribution) {
          return new Response(JSON.stringify({ success: false, error: 'Missing attribution' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: attribution.ts,
          run_id: attribution.runId,
          correlation_id: attribution.correlationId,
          order_id: attribution.orderId,
          market_id: attribution.marketId,
          asset: attribution.asset,
          side: attribution.side,
          price: attribution.price,
          size: attribution.size,
          liquidity: attribution.liquidity,
          fee_paid: attribution.feePaid,
          rebate_expected: attribution.rebateExpected,
          fill_cost_gross: attribution.fillCostGross,
          fill_cost_net: attribution.fillCostNet,
          updated_avg_up: attribution.updatedAvgUp,
          updated_avg_down: attribution.updatedAvgDown,
          updated_cpp_gross: attribution.updatedCppGross,
          updated_cpp_net_expected: attribution.updatedCppNetExpected,
        };

        const { error } = await supabase.from('fill_attributions').insert(row);
        if (error) {
          console.error('[runner-proxy] save-fill-attribution error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 💰 Fill attribution: ${attribution.side} ${attribution.size}@${attribution.price} ${attribution.liquidity}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Hedge Skip Log (why NOT hedged)
      case 'save-hedge-skip': {
        const skip = data?.skip as Record<string, unknown> | undefined;
        if (!skip) {
          return new Response(JSON.stringify({ success: false, error: 'Missing skip data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: skip.ts,
          run_id: skip.runId,
          correlation_id: skip.correlationId,
          market_id: skip.marketId,
          asset: skip.asset,
          side_not_hedged: skip.sideNotHedged,
          reason_code: skip.reasonCode,
          best_bid: skip.bestBidHedgeSide,
          best_ask: skip.bestAskHedgeSide,
          projected_cpp: skip.projectedCpp,
          unpaired_shares: skip.sharesUnhedged,
          seconds_remaining: skip.secondsRemaining,
        };

        const { error } = await supabase.from('hedge_skip_logs').insert(row);
        if (error) {
          console.error('[runner-proxy] save-hedge-skip error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ⏭️ Hedge skip: ${skip.sideNotHedged} reason=${skip.reasonCode}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-hedge-skip-logs': {
        const skips = data?.skips as Array<Record<string, unknown>> | undefined;
        if (!skips || skips.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing skips' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const rows = skips.map(s => ({
          ts: s.ts,
          run_id: s.runId,
          correlation_id: s.correlationId,
          market_id: s.marketId,
          asset: s.asset,
          side_not_hedged: s.sideNotHedged,
          reason_code: s.reasonCode,
          best_bid: s.bestBidHedgeSide,
          best_ask: s.bestAskHedgeSide,
          projected_cpp: s.projectedCpp,
          unpaired_shares: s.sharesUnhedged,
          seconds_remaining: s.secondsRemaining,
        }));

        const { error } = await supabase.from('hedge_skip_logs').insert(rows);
        if (error) {
          console.error('[runner-proxy] save-hedge-skip-logs error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // MTM Snapshot (honest PnL)
      case 'save-mtm-snapshot': {
        const snapshot = data?.snapshot as Record<string, unknown> | undefined;
        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: snapshot.ts,
          run_id: snapshot.runId,
          market_id: snapshot.marketId,
          asset: snapshot.asset,
          up_mid: snapshot.upMid,
          down_mid: snapshot.downMid,
          combined_mid: snapshot.combinedMid,
          book_ready_up: snapshot.bookReadyUp,
          book_ready_down: snapshot.bookReadyDown,
          fallback_used: snapshot.fallbackUsed,
          unrealized_pnl: snapshot.unrealizedPnL,
          confidence: snapshot.confidence,
        };

        const { error } = await supabase.from('mtm_snapshots').insert(row);
        if (error) {
          console.error('[runner-proxy] save-mtm-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Gabagool Metrics
      case 'save-gabagool-metrics': {
        const metrics = data?.metrics as Record<string, unknown> | undefined;
        if (!metrics) {
          return new Response(JSON.stringify({ success: false, error: 'Missing metrics' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const row = {
          ts: metrics.ts,
          run_id: metrics.runId,
          total_paired_shares: metrics.totalPairedShares,
          paired_cpp_under_100_shares: metrics.pairedCppUnder100Shares,
          paired_cpp_under_100_pct: metrics.pairedCppUnder100Pct,
          cpp_distribution: metrics.cppDistribution,
          high_cpp_trade_count: metrics.highCppTradeCount,
          maker_fills: metrics.makerFills,
          taker_fills: metrics.takerFills,
          maker_fill_ratio: metrics.makerFillRatio,
          invariant_status: metrics.invariantStatus,
        };

        const { error } = await supabase.from('gabagool_metrics').insert(row);
        if (error) {
          console.error('[runner-proxy] save-gabagool-metrics error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 📊 Gabagool metrics: ${metrics.pairedCppUnder100Pct}% CPP<1.00, maker=${metrics.makerFillRatio}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // V26 Config - includes per-asset configurations
      case 'get-v26-config': {
        // Fetch global config and per-asset configs in parallel
        const [globalRes, assetRes] = await Promise.all([
          supabase.from('v26_config').select('*').limit(1).single(),
          supabase.from('v26_asset_config').select('*').order('asset'),
        ]);

        if (globalRes.error) {
          console.error('[runner-proxy] get-v26-config error:', globalRes.error);
          return new Response(JSON.stringify({ success: false, error: globalRes.error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const assetConfigs = assetRes.data || [];
        console.log(`[runner-proxy] 📋 V26 Config: enabled=${globalRes.data?.enabled}, assets=${assetConfigs.length}`);
        for (const ac of assetConfigs) {
          console.log(`  - ${ac.asset}: ${ac.enabled ? '✅' : '❌'} ${ac.side} ${ac.shares}@$${ac.price}`);
        }
        
        return new Response(JSON.stringify({ 
          success: true, 
          data: globalRes.data,
          assetConfigs: assetConfigs,
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // TOXICITY FILTER v2 ACTIONS
      // ============================================================

      case 'save-toxicity-features': {
        const payload = data as Record<string, unknown>;
        const { error, data: inserted } = await supabase
          .from('toxicity_features')
          .upsert({
            market_id: payload.market_id,
            market_slug: payload.market_slug,
            asset: payload.asset,
            market_start_time: payload.market_start_time,
            n_ticks: payload.n_ticks,
            max_gap_seconds: payload.max_gap_seconds,
            data_quality: payload.data_quality,
            ask_volatility: payload.ask_volatility,
            ask_change_count: payload.ask_change_count,
            min_distance_to_target: payload.min_distance_to_target,
            mean_distance_to_target: payload.mean_distance_to_target,
            time_near_target_pct: payload.time_near_target_pct,
            ask_median_early: payload.ask_median_early,
            ask_median_late: payload.ask_median_late,
            liquidity_pull_detected: payload.liquidity_pull_detected,
            spread_volatility: payload.spread_volatility,
            spread_jump_last_20s: payload.spread_jump_last_20s,
            bid_drift: payload.bid_drift,
            mid_drift: payload.mid_drift,
            toxicity_score: payload.toxicity_score,
            percentile_rank: payload.percentile_rank,
            classification: payload.classification,
            decision: payload.decision,
            confidence: payload.confidence,
            target_price: payload.target_price,
            filter_version: payload.filter_version,
            run_id: payload.run_id,
          }, { onConflict: 'market_id,asset' })
          .select('id')
          .single();

        if (error) {
          console.error('[runner-proxy] save-toxicity-features error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Saved toxicity features for ${payload.asset} ${payload.market_slug}`);
        return new Response(JSON.stringify({ success: true, id: inserted?.id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'update-toxicity-outcome': {
        const { market_id, asset, outcome, pnl, settled_at } = data as {
          market_id: string;
          asset: string;
          outcome: string;
          pnl: number;
          settled_at: string;
        };

        const { error } = await supabase
          .from('toxicity_features')
          .update({
            outcome,
            pnl,
            settled_at,
          })
          .eq('market_id', market_id)
          .eq('asset', asset);

        if (error) {
          console.error('[runner-proxy] update-toxicity-outcome error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ✅ Updated toxicity outcome: ${asset} ${market_id} -> ${outcome} ($${pnl})`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'get-toxicity-history': {
        const { asset, limit = 200 } = data as { asset?: string; limit?: number };

        let query = supabase
          .from('toxicity_features')
          .select('*')
          .not('outcome', 'is', null)
          .order('market_start_time', { ascending: false })
          .limit(limit);

        if (asset) {
          query = query.eq('asset', asset);
        }

        const { data: history, error } = await query;

        if (error) {
          console.error('[runner-proxy] get-toxicity-history error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 📊 Toxicity history: ${history?.length ?? 0} settled markets`);
        return new Response(JSON.stringify({ success: true, data: history }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // Price Feed WebSocket Logger (millisecond precision)
      // ============================================================
      case 'save-realtime-price-logs': {
        const logs = data?.logs as Array<{
          source: string;
          asset: string;
          price: number;
          raw_timestamp: number;
          received_at: number;
          // For CLOB share logs
          outcome?: 'up' | 'down';
        }> | undefined;

        if (!logs || logs.length === 0) {
          return new Response(JSON.stringify({ success: true, count: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Map to database schema
        const dbLogs = logs.map((log) => ({
          source: log.source,
          asset: log.asset,
          price: log.price,
          raw_timestamp: log.raw_timestamp,
          received_at: new Date(log.received_at).toISOString(),
          outcome: log.outcome ?? null,
        }));

        // Chunk inserts to reduce payload size + lower chance of connection resets.
        const CHUNK_SIZE = 50;
        let inserted = 0;
        let dropped = 0;
        let lastTransientError: any = null;

        for (let i = 0; i < dbLogs.length; i += CHUNK_SIZE) {
          const chunk = dbLogs.slice(i, i + CHUNK_SIZE);
          const res = await insertWithRetry(supabase, 'realtime_price_logs', chunk, {
            retries: 3,
            baseDelayMs: 250,
          });

          if (res.ok) {
            inserted += chunk.length;
            continue;
          }

          // Non-transient DB/schema error: fail hard (this is a real bug)
          if (!res.transient) {
            console.error('[runner-proxy] save-realtime-price-logs error:', res.error);
            return new Response(JSON.stringify({ success: false, error: res.error?.message || String(res.error) }), {
              status: 500,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }

          // Transient network error: best-effort drop this chunk to avoid spamming 500s.
          lastTransientError = res.error;
          dropped += chunk.length;
        }

        if (dropped > 0) {
          console.warn(
            `[runner-proxy] ⚠️ Realtime price logs: inserted=${inserted} dropped=${dropped} (transient network error)`
          );
          return new Response(
            JSON.stringify({
              success: true,
              count: inserted,
              dropped,
              transient_error: true,
              error: String(lastTransientError?.message || lastTransientError || 'transient network error'),
            }),
            {
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            }
          );
        }

        console.log(`[runner-proxy] 📊 Saved ${inserted} realtime price logs`);
        return new Response(JSON.stringify({ success: true, count: inserted }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 Orderbook Snapshots (full depth logging)
      // ============================================================
      case 'save-v35-orderbook-snapshot': {
        const snapshot = data?.snapshot as {
          ts: number;
          market_slug: string;
          asset: string;
          up_best_bid: number | null;
          up_best_ask: number | null;
          down_best_bid: number | null;
          down_best_ask: number | null;
          combined_ask: number | null;
          combined_mid: number | null;
          edge: number | null;
          up_bids: Array<{ price: number; size: number }>;
          up_asks: Array<{ price: number; size: number }>;
          down_bids: Array<{ price: number; size: number }>;
          down_asks: Array<{ price: number; size: number }>;
          spot_price: number | null;
          strike_price: number | null;
          seconds_to_expiry: number | null;
        } | undefined;

        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase
          .from('v35_orderbook_snapshots')
          .insert({
            ts: snapshot.ts,
            market_slug: snapshot.market_slug,
            asset: snapshot.asset,
            up_best_bid: snapshot.up_best_bid,
            up_best_ask: snapshot.up_best_ask,
            down_best_bid: snapshot.down_best_bid,
            down_best_ask: snapshot.down_best_ask,
            combined_ask: snapshot.combined_ask,
            combined_mid: snapshot.combined_mid,
            edge: snapshot.edge,
            up_bids: snapshot.up_bids,
            up_asks: snapshot.up_asks,
            down_bids: snapshot.down_bids,
            down_asks: snapshot.down_asks,
            spot_price: snapshot.spot_price,
            strike_price: snapshot.strike_price,
            seconds_to_expiry: snapshot.seconds_to_expiry,
          });

        if (error) {
          console.error('[runner-proxy] save-v35-orderbook-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      case 'save-v35-orderbook-snapshots': {
        const snapshots = data?.snapshots as Array<{
          ts: number;
          market_slug: string;
          asset: string;
          up_best_bid: number | null;
          up_best_ask: number | null;
          down_best_bid: number | null;
          down_best_ask: number | null;
          combined_ask: number | null;
          combined_mid: number | null;
          edge: number | null;
          up_bids: Array<{ price: number; size: number }>;
          up_asks: Array<{ price: number; size: number }>;
          down_bids: Array<{ price: number; size: number }>;
          down_asks: Array<{ price: number; size: number }>;
          spot_price: number | null;
          strike_price: number | null;
          seconds_to_expiry: number | null;
        }> | undefined;

        if (!snapshots || snapshots.length === 0) {
          return new Response(JSON.stringify({ success: true, count: 0 }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const dbRows = snapshots.map((s) => ({
          ts: s.ts,
          market_slug: s.market_slug,
          asset: s.asset,
          up_best_bid: s.up_best_bid,
          up_best_ask: s.up_best_ask,
          down_best_bid: s.down_best_bid,
          down_best_ask: s.down_best_ask,
          combined_ask: s.combined_ask,
          combined_mid: s.combined_mid,
          edge: s.edge,
          up_bids: s.up_bids,
          up_asks: s.up_asks,
          down_bids: s.down_bids,
          down_asks: s.down_asks,
          spot_price: s.spot_price,
          strike_price: s.strike_price,
          seconds_to_expiry: s.seconds_to_expiry,
        }));

        const { error } = await supabase
          .from('v35_orderbook_snapshots')
          .insert(dbRows);

        if (error) {
          console.error('[runner-proxy] save-v35-orderbook-snapshots error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 📊 Saved ${snapshots.length} V35 orderbook snapshots`);
        return new Response(JSON.stringify({ success: true, count: snapshots.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 FILLS
      // ============================================================
      case 'save-v35-fill': {
        const fill = data?.fill as Record<string, unknown> | undefined;
        if (!fill) {
          return new Response(JSON.stringify({ success: false, error: 'Missing fill data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Get wallet address from bot_config to tag this fill
        // This ensures we only store fills that belong to OUR wallet
        const { data: config } = await supabase
          .from('bot_config')
          .select('polymarket_address')
          .single();
        
        const walletAddress = config?.polymarket_address?.toLowerCase() || null;

        // CRITICAL: Reject fills if wallet is not configured
        // Per user requirement: "Reject + stop" if wallet unknown
        if (!walletAddress) {
          console.error('[runner-proxy] ❌ FATAL: polymarket_address not configured in bot_config - REJECTING FILL');
          console.error('[runner-proxy] ❌ This is a critical configuration error. The runner should be stopped.');
          return new Response(JSON.stringify({ 
            success: false, 
            error: 'FATAL: polymarket_address not configured - cannot attribute fills',
            fatal: true,
          }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Idempotency: build a deterministic key so the same fill cannot be inserted multiple times.
        // NOTE: We intentionally do not use created_at, because duplicates arrive at different times.
        const orderId = String(fill.order_id ?? '');
        const tokenId = String(fill.token_id ?? '');
        const side = String(fill.side ?? '');

        const priceNum = Number(fill.price);
        const sizeNum = Number(fill.size);
        const priceStr = Number.isFinite(priceNum) ? priceNum.toString() : String(fill.price ?? '');
        const sizeStr = Number.isFinite(sizeNum) ? sizeNum.toString() : String(fill.size ?? '');

        const marketSlug = String(fill.market_slug ?? '');
        const fillType = String(fill.fill_type ?? 'MAKER');

        const fillKey = `${orderId}|${tokenId}|${side}|${priceStr}|${sizeStr}|${marketSlug}|${fillType}`;
        
        // Robust timestamp extraction - try multiple fields with fallback to now()
        const rawTs = fill.fill_ts ?? fill.timestamp ?? fill.ts ?? fill.created_at;
        const fillTs = typeof rawTs === 'string' && rawTs.length > 0 
          ? rawTs 
          : (typeof rawTs === 'number' ? new Date(rawTs).toISOString() : new Date().toISOString());

        // Make fill inserts idempotent WITHOUT triggering DB-level duplicate-key errors.
        // This targets the existing unique constraint: UNIQUE(order_id, wallet_address, market_slug)
        // so repeated saves become ON CONFLICT DO NOTHING.
        const { error } = await supabase
          .from('v35_fills')
          .upsert(
            {
              order_id: orderId || null,
              token_id: tokenId || null,
              side,
              price: priceNum,
              size: sizeNum,
              market_slug: marketSlug,
              asset: fill.asset,
              fill_type: fillType,
              fill_ts: fillTs,
              fill_key: fillKey,
              wallet_address: walletAddress,
            },
            {
              onConflict: 'order_id,wallet_address,market_slug',
              ignoreDuplicates: true,
            }
          );

        if (error) {
          console.error('[runner-proxy] save-v35-fill error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] ⚡ Saved V35 fill: ${side} ${sizeStr}@${priceStr} (wallet: ${walletAddress?.slice(0, 10) || 'unknown'})`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 POSITION SNAPSHOTS
      // ============================================================
      case 'save-v35-position': {
        const position = data?.position as Record<string, unknown> | undefined;
        if (!position) {
          return new Response(JSON.stringify({ success: false, error: 'Missing position data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('v35_positions').insert({
          market_slug: position.market_slug,
          asset: position.asset,
          up_qty: position.up_qty,
          down_qty: position.down_qty,
          up_cost: position.up_cost,
          down_cost: position.down_cost,
          paired: position.paired,
          unpaired: position.unpaired,
          combined_cost: position.combined_cost,
          locked_profit: position.locked_profit,
          seconds_to_expiry: position.seconds_to_expiry,
          timestamp: position.timestamp,
        });

        if (error) {
          console.error('[runner-proxy] save-v35-position error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 📊 Saved V35 position snapshot: ${position.market_slug}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 SETTLEMENTS
      // ============================================================
      case 'save-v35-settlement': {
        const settlement = data?.settlement as Record<string, unknown> | undefined;
        if (!settlement) {
          return new Response(JSON.stringify({ success: false, error: 'Missing settlement data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('v35_settlements').insert({
          market_slug: settlement.market_slug,
          asset: settlement.asset,
          up_qty: settlement.up_qty,
          down_qty: settlement.down_qty,
          up_cost: settlement.up_cost,
          down_cost: settlement.down_cost,
          paired: settlement.paired,
          unpaired: settlement.unpaired,
          combined_cost: settlement.combined_cost,
          locked_profit: settlement.locked_profit,
          winning_side: settlement.winning_side,
          pnl: settlement.pnl,
          timestamp: settlement.timestamp,
        });

        if (error) {
          console.error('[runner-proxy] save-v35-settlement error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        console.log(`[runner-proxy] 💰 Saved V35 settlement: ${settlement.market_slug} PnL=${settlement.pnl}`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 EXPIRY SNAPSHOTS (Precise End-of-Market Archiving)
      // ============================================================
      case 'save-v35-expiry-snapshot': {
        const snapshot = data?.snapshot as Record<string, unknown> | undefined;
        if (!snapshot) {
          return new Response(JSON.stringify({ success: false, error: 'Missing snapshot data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        const { error } = await supabase.from('v35_expiry_snapshots').upsert({
          market_slug: snapshot.market_slug,
          asset: snapshot.asset,
          expiry_time: snapshot.expiry_time,
          snapshot_time: snapshot.snapshot_time,
          seconds_before_expiry: snapshot.seconds_before_expiry,
          api_up_qty: snapshot.api_up_qty,
          api_down_qty: snapshot.api_down_qty,
          api_up_cost: snapshot.api_up_cost,
          api_down_cost: snapshot.api_down_cost,
          local_up_qty: snapshot.local_up_qty,
          local_down_qty: snapshot.local_down_qty,
          local_up_cost: snapshot.local_up_cost,
          local_down_cost: snapshot.local_down_cost,
          paired: snapshot.paired,
          unpaired: snapshot.unpaired,
          combined_cost: snapshot.combined_cost,
          locked_profit: snapshot.locked_profit,
          avg_up_price: snapshot.avg_up_price,
          avg_down_price: snapshot.avg_down_price,
          up_best_bid: snapshot.up_best_bid,
          up_best_ask: snapshot.up_best_ask,
          down_best_bid: snapshot.down_best_bid,
          down_best_ask: snapshot.down_best_ask,
          combined_ask: snapshot.combined_ask,
          up_orders_count: snapshot.up_orders_count,
          down_orders_count: snapshot.down_orders_count,
          was_imbalanced: snapshot.was_imbalanced,
          imbalance_ratio: snapshot.imbalance_ratio,
          // NEW: Correct PnL calculation fields
          total_cost: snapshot.total_cost,
          predicted_winning_side: snapshot.predicted_winning_side,
          predicted_final_value: snapshot.predicted_final_value,
          predicted_pnl: snapshot.predicted_pnl,
          // NEW: Crossing analysis
          crossing_count: snapshot.crossing_count,
          spot_price: snapshot.spot_price,
          strike_price: snapshot.strike_price,
        }, { onConflict: 'market_slug' });

        if (error) {
          console.error('[runner-proxy] save-v35-expiry-snapshot error:', error);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Log with correct PnL
        const pnlStr = snapshot.predicted_pnl != null 
          ? `PnL=$${Number(snapshot.predicted_pnl) >= 0 ? '+' : ''}${Number(snapshot.predicted_pnl).toFixed(2)}`
          : `CPP=$${snapshot.combined_cost}`;
        console.log(`[runner-proxy] 📸 Saved V35 expiry snapshot: ${snapshot.market_slug} (${snapshot.predicted_winning_side ?? 'TBD'} wins, ${pnlStr})`);
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ============================================================
      // V35 PRICE TICKS (Spot + Share prices logging for price chart)
      // ============================================================
      case 'save-v35-price-tick': {
        // Supports single tick or batch of ticks
        const singleTick = data?.tick as {
          market_slug: string;
          asset: string;
          ts: number;
          spot_price: number;
          up_best_bid?: number;
          up_best_ask?: number;
          down_best_bid?: number;
          down_best_ask?: number;
          strike_price?: number;
          run_id?: string;
        } | undefined;

        const ticksBatch = data?.ticks as Array<{
          market_slug: string;
          asset: string;
          ts: number;
          spot_price: number;
          up_best_bid?: number;
          up_best_ask?: number;
          down_best_bid?: number;
          down_best_ask?: number;
          strike_price?: number;
          run_id?: string;
        }> | undefined;

        const ticks = ticksBatch ?? (singleTick ? [singleTick] : []);

        if (ticks.length === 0) {
          return new Response(JSON.stringify({ success: false, error: 'Missing tick(s) data' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Validate each tick
        for (const t of ticks) {
          if (!t.market_slug || !t.asset || !t.ts || t.spot_price === undefined) {
            return new Response(JSON.stringify({ success: false, error: 'Invalid tick: missing required fields' }), {
              status: 400,
              headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            });
          }
        }

        const rows = ticks.map((t) => ({
          market_slug: t.market_slug,
          asset: t.asset,
          ts: t.ts,
          spot_price: t.spot_price,
          up_best_bid: t.up_best_bid ?? null,
          up_best_ask: t.up_best_ask ?? null,
          down_best_bid: t.down_best_bid ?? null,
          down_best_ask: t.down_best_ask ?? null,
          strike_price: t.strike_price ?? null,
          run_id: t.run_id ?? null,
        }));

        const { error } = await supabase.from('v35_price_ticks').insert(rows);

        if (error) {
          console.error('[runner-proxy] save-v35-price-tick error:', error.message);
          return new Response(JSON.stringify({ success: false, error: error.message }), {
            status: 500,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        // Don't log individual ticks - too noisy
        return new Response(JSON.stringify({ success: true, count: rows.length }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      default:
        return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
    }
  } catch (error) {
    console.error('[runner-proxy] Error:', error);
    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
