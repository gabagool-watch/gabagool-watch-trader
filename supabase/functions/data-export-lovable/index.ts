import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const exportType = url.searchParams.get('type') || 'price-ticks'
    const format = url.searchParams.get('format') || 'json'

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log(`[data-export] type=${exportType}, format=${format}`)

    if (exportType === 'price-ticks') {
      // Export 1: Price Ticks (last 7 days)
      const { data, error } = await supabase
        .from('v35_price_ticks')
        .select('ts, market_slug, spot_price, strike_price, up_best_bid, up_best_ask, down_best_bid, down_best_ask')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('ts', { ascending: true })

      if (error) throw error

      const exportData = (data || []).map(row => ({
        timestamp_ms: row.ts,
        market_slug: row.market_slug,
        spot_price: row.spot_price,
        strike_price: row.strike_price,
        up_best_bid: row.up_best_bid,
        up_best_ask: row.up_best_ask,
        down_best_bid: row.down_best_bid,
        down_best_ask: row.down_best_ask,
      }))

      console.log(`[data-export] price-ticks: ${exportData.length} rows`)

      if (format === 'csv') {
        const headers = ['timestamp_ms', 'market_slug', 'spot_price', 'strike_price', 'up_best_bid', 'up_best_ask', 'down_best_bid', 'down_best_ask']
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        return new Response(csvRows.join('\n'), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="price-ticks-7d.csv"',
          },
        })
      }

      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="price-ticks-7d.json"',
        },
      })

    } else if (exportType === 'market-windows') {
      // Export 2: Market Windows (last 7 days)
      const { data, error } = await supabase
        .from('v35_expiry_snapshots')
        .select('market_slug, expiry_time, strike_price, spot_price, predicted_winning_side')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('expiry_time', { ascending: true })

      if (error) throw error

      const exportData = (data || []).map(row => {
        const expiryTime = new Date(row.expiry_time)
        const startTime = new Date(expiryTime.getTime() - 15 * 60 * 1000) // 15 min before expiry
        return {
          market_slug: row.market_slug,
          start_time: startTime.toISOString(),
          expiry_time: row.expiry_time,
          strike_price: row.strike_price,
          settlement_price: row.spot_price,
          winning_side: row.predicted_winning_side,
        }
      })

      console.log(`[data-export] market-windows: ${exportData.length} rows`)

      if (format === 'csv') {
        const headers = ['market_slug', 'start_time', 'expiry_time', 'strike_price', 'settlement_price', 'winning_side']
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        return new Response(csvRows.join('\n'), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="market-windows-7d.csv"',
          },
        })
      }

      return new Response(JSON.stringify(exportData, null, 2), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="market-windows-7d.json"',
        },
      })
    }

    return new Response(JSON.stringify({ error: 'Invalid export type. Use: price-ticks or market-windows' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('[data-export] Error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
