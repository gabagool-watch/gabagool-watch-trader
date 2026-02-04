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
      // Export: Price Ticks (last 7 days) - ALL ticks, no limit
      const allTicks: Array<{
        timestamp_ms: number
        market_slug: string
        spot_price: number
        up_best_bid: number
        up_best_ask: number
        down_best_bid: number
        down_best_ask: number
      }> = []
      
      let offset = 0
      const batchSize = 10000
      
      while (true) {
        const { data, error } = await supabase
          .from('v35_price_ticks')
          .select('ts, market_slug, spot_price, up_best_bid, up_best_ask, down_best_bid, down_best_ask')
          .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
          .order('ts', { ascending: true })
          .range(offset, offset + batchSize - 1)

        if (error) throw error
        if (!data || data.length === 0) break

        for (const row of data) {
          allTicks.push({
            timestamp_ms: row.ts,
            market_slug: row.market_slug,
            spot_price: row.spot_price,
            up_best_bid: row.up_best_bid,
            up_best_ask: row.up_best_ask,
            down_best_bid: row.down_best_bid,
            down_best_ask: row.down_best_ask,
          })
        }

        console.log(`[data-export] price-ticks: fetched ${offset + data.length} rows`)
        
        if (data.length < batchSize) break
        offset += batchSize
      }

      console.log(`[data-export] price-ticks: ${allTicks.length} total rows`)

      if (format === 'csv') {
        const headers = ['timestamp_ms', 'market_slug', 'spot_price', 'up_best_bid', 'up_best_ask', 'down_best_bid', 'down_best_ask']
        const csvRows = [
          headers.join(','),
          ...allTicks.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        return new Response(csvRows.join('\n'), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="price-ticks-7d.csv"',
          },
        })
      }

      return new Response(JSON.stringify(allTicks, null, 2), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Content-Disposition': 'attachment; filename="price-ticks-7d.json"',
        },
      })

    } else if (exportType === 'market-windows') {
      // First, get all unique market_slugs from expiry snapshots
      const { data: snapshots, error: snapshotError } = await supabase
        .from('v35_expiry_snapshots')
        .select('market_slug, expiry_time, predicted_winning_side')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('expiry_time', { ascending: true })

      if (snapshotError) throw snapshotError

      const marketSlugs = [...new Set((snapshots || []).map(s => s.market_slug))]
      console.log(`[data-export] market-windows: ${marketSlugs.length} unique markets`)

      // For each market, get the first and last tick to determine strike and settlement
      const exportData: Array<{
        market_slug: string
        start_time: string
        expiry_time: string
        strike_price: number | null
        settlement_price: number | null
        winning_side: string | null
      }> = []

      for (const snapshot of (snapshots || [])) {
        const expiryTime = new Date(snapshot.expiry_time)
        const startTime = new Date(expiryTime.getTime() - 15 * 60 * 1000)

        // Get first tick (strike price)
        const { data: firstTick } = await supabase
          .from('v35_price_ticks')
          .select('spot_price, ts')
          .eq('market_slug', snapshot.market_slug)
          .order('ts', { ascending: true })
          .limit(1)
          .single()

        // Get last tick (settlement price)
        const { data: lastTick } = await supabase
          .from('v35_price_ticks')
          .select('spot_price, ts')
          .eq('market_slug', snapshot.market_slug)
          .order('ts', { ascending: false })
          .limit(1)
          .single()

        exportData.push({
          market_slug: snapshot.market_slug,
          start_time: startTime.toISOString(),
          expiry_time: snapshot.expiry_time,
          strike_price: firstTick?.spot_price ?? null,
          settlement_price: lastTick?.spot_price ?? null,
          winning_side: snapshot.predicted_winning_side,
        })
      }

      console.log(`[data-export] market-windows: ${exportData.length} rows with calculated prices`)

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
