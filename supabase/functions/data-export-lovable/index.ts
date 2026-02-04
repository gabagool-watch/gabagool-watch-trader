import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function gzipStream(data: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(data))
      controller.close()
    }
  })
  return stream.pipeThrough(new CompressionStream('gzip'))
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

      let content: string
      let filename: string
      let contentType: string

      if (format === 'csv') {
        const headers = ['timestamp_ms', 'market_slug', 'spot_price', 'up_best_bid', 'up_best_ask', 'down_best_bid', 'down_best_ask']
        const csvRows = [
          headers.join(','),
          ...allTicks.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        content = csvRows.join('\n')
        filename = 'price-ticks-7d.csv.gz'
        contentType = 'text/csv'
      } else {
        content = JSON.stringify(allTicks)
        filename = 'price-ticks-7d.json.gz'
        contentType = 'application/json'
      }

      return new Response(gzipStream(content), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Original-Content-Type': contentType,
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

      console.log(`[data-export] market-windows: ${(snapshots || []).length} snapshots found`)

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

      let content: string
      let filename: string
      let contentType: string

      if (format === 'csv') {
        const headers = ['market_slug', 'start_time', 'expiry_time', 'strike_price', 'settlement_price', 'winning_side']
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        content = csvRows.join('\n')
        filename = 'market-windows-7d.csv.gz'
        contentType = 'text/csv'
      } else {
        content = JSON.stringify(exportData)
        filename = 'market-windows-7d.json.gz'
        contentType = 'application/json'
      }

      return new Response(gzipStream(content), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Original-Content-Type': contentType,
        },
      })

    } else if (exportType === 'first-minute-stats') {
      // Export: First Minute Stats per Market (aggregated)
      const { data: snapshots, error: snapshotError } = await supabase
        .from('v35_expiry_snapshots')
        .select('market_slug, expiry_time, predicted_winning_side')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
        .order('expiry_time', { ascending: true })

      if (snapshotError) throw snapshotError

      console.log(`[data-export] first-minute-stats: ${(snapshots || []).length} markets to analyze`)

      const exportData: Array<{
        market_slug: string
        start_time: string
        winning_side: string | null
        first_min_open_price: number | null
        first_min_close_price: number | null
        first_min_high: number | null
        first_min_low: number | null
        first_min_tick_count: number
        up_ask_at_1min: number | null
        down_ask_at_1min: number | null
      }> = []

      for (const snapshot of (snapshots || [])) {
        const expiryTime = new Date(snapshot.expiry_time)
        const startTime = new Date(expiryTime.getTime() - 15 * 60 * 1000)
        const oneMinLater = new Date(startTime.getTime() + 60 * 1000)
        
        const startMs = startTime.getTime()
        const oneMinMs = oneMinLater.getTime()

        // Get all ticks in the first minute
        const { data: firstMinTicks } = await supabase
          .from('v35_price_ticks')
          .select('spot_price, up_best_ask, down_best_ask, ts')
          .eq('market_slug', snapshot.market_slug)
          .gte('ts', startMs)
          .lte('ts', oneMinMs)
          .order('ts', { ascending: true })

        if (!firstMinTicks || firstMinTicks.length === 0) {
          exportData.push({
            market_slug: snapshot.market_slug,
            start_time: startTime.toISOString(),
            winning_side: snapshot.predicted_winning_side,
            first_min_open_price: null,
            first_min_close_price: null,
            first_min_high: null,
            first_min_low: null,
            first_min_tick_count: 0,
            up_ask_at_1min: null,
            down_ask_at_1min: null,
          })
          continue
        }

        const prices = firstMinTicks.map(t => t.spot_price).filter(p => p != null) as number[]
        const lastTick = firstMinTicks[firstMinTicks.length - 1]

        exportData.push({
          market_slug: snapshot.market_slug,
          start_time: startTime.toISOString(),
          winning_side: snapshot.predicted_winning_side,
          first_min_open_price: firstMinTicks[0].spot_price,
          first_min_close_price: lastTick.spot_price,
          first_min_high: prices.length > 0 ? Math.max(...prices) : null,
          first_min_low: prices.length > 0 ? Math.min(...prices) : null,
          first_min_tick_count: firstMinTicks.length,
          up_ask_at_1min: lastTick.up_best_ask,
          down_ask_at_1min: lastTick.down_best_ask,
        })
      }

      console.log(`[data-export] first-minute-stats: ${exportData.length} rows generated`)

      let content: string
      let filename: string
      let contentType: string

      if (format === 'csv') {
        const headers = ['market_slug', 'start_time', 'winning_side', 'first_min_open_price', 'first_min_close_price', 'first_min_high', 'first_min_low', 'first_min_tick_count', 'up_ask_at_1min', 'down_ask_at_1min']
        const csvRows = [
          headers.join(','),
          ...exportData.map(row => headers.map(h => row[h as keyof typeof row] ?? '').join(','))
        ]
        content = csvRows.join('\n')
        filename = 'first-minute-stats-7d.csv.gz'
        contentType = 'text/csv'
      } else {
        content = JSON.stringify(exportData)
        filename = 'first-minute-stats-7d.json.gz'
        contentType = 'application/json'
      }

      return new Response(gzipStream(content), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Original-Content-Type': contentType,
        },
      })
    } else if (exportType === 'market-analysis') {
      // Export: Market Analysis - Last 30 days from market_history
      // Combines: start_time, price_at_start, winning_side, up_ask_at_1min, down_ask_at_1min
      const daysParam = url.searchParams.get('days') || '30'
      const days = parseInt(daysParam, 10)
      const asset = url.searchParams.get('asset') || 'BTC'
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

      console.log(`[data-export] market-analysis: fetching ${asset} markets from last ${days} days`)

      // Get markets from market_history (has winning_side/result and strike_price)
      const { data: markets, error: marketsError } = await supabase
        .from('market_history')
        .select('slug, event_start_time, strike_price, open_price, result')
        .eq('asset', asset)
        .gte('event_start_time', cutoff)
        .not('event_start_time', 'is', null)
        .order('event_start_time', { ascending: false })

      if (marketsError) throw marketsError

      console.log(`[data-export] market-analysis: ${markets?.length || 0} markets found in market_history`)

      // Get all ticks for the period from v35_price_ticks
      const { data: v35Ticks } = await supabase
        .from('v35_price_ticks')
        .select('market_slug, created_at, ts, up_best_ask, down_best_ask, spot_price')
        .eq('asset', asset)
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })

      console.log(`[data-export] market-analysis: ${v35Ticks?.length || 0} v35_price_ticks found`)

      // Get paper_price_snapshots as fallback
      const { data: paperTicks } = await supabase
        .from('paper_price_snapshots')
        .select('market_slug, created_at, up_best_ask, down_best_ask, binance_price')
        .eq('asset', asset)
        .order('created_at', { ascending: true })

      console.log(`[data-export] market-analysis: ${paperTicks?.length || 0} paper_price_snapshots found`)

      // Build lookup maps
      const v35TicksByMarket = new Map<string, typeof v35Ticks>()
      for (const tick of (v35Ticks || [])) {
        const existing = v35TicksByMarket.get(tick.market_slug) || []
        existing.push(tick)
        v35TicksByMarket.set(tick.market_slug, existing)
      }

      const paperTicksByMarket = new Map<string, typeof paperTicks>()
      for (const tick of (paperTicks || [])) {
        const existing = paperTicksByMarket.get(tick.market_slug) || []
        existing.push(tick)
        paperTicksByMarket.set(tick.market_slug, existing)
      }

      // Helper function
      function findTickAt1Min(
        ticks: Array<{ created_at: string; up_best_ask: number; down_best_ask: number }> | undefined | null, 
        startTime: Date
      ): { up_ask: number | null; down_ask: number | null } | null {
        if (!ticks || ticks.length === 0) return null
        const targetTime = new Date(startTime.getTime() + 60 * 1000)
        const minTime = new Date(startTime.getTime() + 50 * 1000)
        const maxTime = new Date(startTime.getTime() + 90 * 1000)

        const ticksInWindow = ticks.filter(t => {
          const tickTime = new Date(t.created_at)
          return tickTime >= minTime && tickTime <= maxTime
        })

        if (ticksInWindow.length === 0) return null

        let closest = ticksInWindow[0]
        let closestDiff = Math.abs(new Date(closest.created_at).getTime() - targetTime.getTime())

        for (const tick of ticksInWindow) {
          const diff = Math.abs(new Date(tick.created_at).getTime() - targetTime.getTime())
          if (diff < closestDiff) {
            closest = tick
            closestDiff = diff
          }
        }

        return { up_ask: closest.up_best_ask, down_ask: closest.down_best_ask }
      }

      // Build result
      const results: Array<{
        market_slug: string
        start_time: string
        price_at_start: number | null
        winning_side: string | null
        up_ask_at_1min: number | null
        down_ask_at_1min: number | null
        data_source: string
      }> = []

      for (const market of (markets || [])) {
        const startTime = new Date(market.event_start_time)
        const v35TicksForMarket = v35TicksByMarket.get(market.slug) || null
        const v35Tick = findTickAt1Min(v35TicksForMarket, startTime)
        const paperTicksForMarket = paperTicksByMarket.get(market.slug) || null
        const paperTick = v35Tick ? null : findTickAt1Min(paperTicksForMarket, startTime)
        const oneMinData = v35Tick || paperTick

        results.push({
          market_slug: market.slug,
          start_time: market.event_start_time,
          price_at_start: market.strike_price || market.open_price || null,
          winning_side: market.result || null,
          up_ask_at_1min: oneMinData?.up_ask || null,
          down_ask_at_1min: oneMinData?.down_ask || null,
          data_source: v35Tick ? 'v35_price_ticks' : (paperTick ? 'paper_price_snapshots' : 'none')
        })
      }

      const summary = {
        export_time: new Date().toISOString(),
        days_exported: days,
        asset,
        total_markets: results.length,
        markets_with_1min_data: results.filter(r => r.up_ask_at_1min !== null).length,
        data_sources: {
          v35_price_ticks: results.filter(r => r.data_source === 'v35_price_ticks').length,
          paper_price_snapshots: results.filter(r => r.data_source === 'paper_price_snapshots').length,
          none: results.filter(r => r.data_source === 'none').length,
        }
      }

      console.log(`[data-export] market-analysis: summary`, summary)

      let content: string
      let filename: string

      if (format === 'csv') {
        const headers = ['market_slug', 'start_time', 'price_at_start', 'winning_side', 'up_ask_at_1min', 'down_ask_at_1min', 'data_source']
        const csvRows = [
          headers.join(','),
          ...results.map(r => headers.map(h => r[h as keyof typeof r] ?? '').join(','))
        ]
        content = csvRows.join('\n')
        filename = `market-analysis-${asset}-${days}d.csv.gz`
      } else {
        content = JSON.stringify({ summary, markets: results })
        filename = `market-analysis-${asset}-${days}d.json.gz`
      }

      return new Response(gzipStream(content), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'X-Original-Content-Type': format === 'csv' ? 'text/csv' : 'application/json',
        },
      })
    }

    return new Response(JSON.stringify({ error: 'Invalid export type. Use: price-ticks, market-windows, first-minute-stats, all, or market-analysis' }), {
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
