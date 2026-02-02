import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface V35MarketPriceChartProps {
  asset: string;
  marketSlug: string;
  startTs: number; // Window start timestamp in ms
  endTs: number;   // Window end timestamp in ms
  targetCpp?: number; // Target CPP (default 0.95) - used for "price to beat" line
}

interface PriceTick {
  ts: number;
  spot_price: number;
  up_best_bid: number | null;
  up_best_ask: number | null;
  down_best_bid: number | null;
  down_best_ask: number | null;
  strike_price: number | null;
}

interface ChartPoint {
  relativeTime: string;
  relativeMs: number;
  spot: number;
  upMid: number | null;
  downMid: number | null;
  strike: number | null;
}

export function V35MarketPriceChart({ asset, marketSlug, startTs, endTs, targetCpp = 0.95 }: V35MarketPriceChartProps) {
  const isLive = Date.now() < endTs && Date.now() >= startTs;
  
  // Price to beat: if each side averages this, the pair totals targetCpp
  const priceToBeat = targetCpp / 2;
  const [liveData, setLiveData] = useState<PriceTick[]>([]);
  
  // Unique syncId for synchronized tooltip/crosshair across charts in this component
  const syncId = useMemo(() => `v35-chart-${marketSlug}`, [marketSlug]);
  
  // Fetch historical ticks from database
  const { data: historicalTicks, isLoading, error } = useQuery<PriceTick[]>({
    queryKey: ['v35-price-ticks', marketSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v35_price_ticks')
        .select('ts, spot_price, up_best_bid, up_best_ask, down_best_bid, down_best_ask, strike_price')
        .eq('market_slug', marketSlug)
        .gte('ts', startTs)
        .lte('ts', endTs)
        .order('ts', { ascending: true })
        .limit(1000);

      if (error) throw error;
      return (data || []) as PriceTick[];
    },
    staleTime: isLive ? 5000 : 60000,
    refetchInterval: isLive ? 5000 : false,
  });

  // Fetch strike price from strike_prices table
  const { data: strikePriceData } = useQuery({
    queryKey: ['strike-price', marketSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('strike_prices')
        .select('strike_price')
        .eq('market_slug', marketSlug)
        .maybeSingle();
      
      if (error) throw error;
      return data?.strike_price as number | null;
    },
    staleTime: 60000,
  });

  // Subscribe to realtime updates for live markets
  useEffect(() => {
    if (!isLive) return;

    const channel = supabase
      .channel(`v35-price-ticks-${marketSlug}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'v35_price_ticks',
          filter: `market_slug=eq.${marketSlug}`,
        },
        (payload) => {
          const tick = payload.new as PriceTick;
          setLiveData((prev) => [...prev.slice(-200), tick]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketSlug, isLive]);

  // Merge historical + live data
  const allTicks = useMemo(() => {
    const historical = historicalTicks || [];
    const combined = [...historical, ...liveData];
    
    // Deduplicate by ts
    const seen = new Set<number>();
    return combined.filter((t) => {
      if (seen.has(t.ts)) return false;
      seen.add(t.ts);
      return true;
    }).sort((a, b) => a.ts - b.ts);
  }, [historicalTicks, liveData]);

  // Transform to chart data
  const chartData = useMemo((): ChartPoint[] => {
    return allTicks.map((tick) => {
      const relativeMs = tick.ts - startTs;
      const minutes = Math.floor(relativeMs / 60000);
      const seconds = Math.floor((relativeMs % 60000) / 1000);
      
      // Calculate mid prices for UP/DOWN
      const upMid = tick.up_best_bid != null && tick.up_best_ask != null
        ? (tick.up_best_bid + tick.up_best_ask) / 2
        : null;
      const downMid = tick.down_best_bid != null && tick.down_best_ask != null
        ? (tick.down_best_bid + tick.down_best_ask) / 2
        : null;

      return {
        relativeTime: `${minutes}:${seconds.toString().padStart(2, '0')}`,
        relativeMs,
        spot: tick.spot_price,
        upMid,
        downMid,
        strike: tick.strike_price,
      };
    });
  }, [allTicks, startTs]);

  // Get strike price - use FIRST spot price from ticks as "Price to Beat"
  // This ensures consistency: the chart shows Binance spot prices, so we use
  // the first Binance spot price as the baseline (same data source = no mismatch)
  const strikePrice = useMemo(() => {
    // Use the first tick's spot price as the "Price to Beat" (market opening price)
    // This is the same source as the chart line, so they'll always be consistent
    const firstTick = allTicks[0];
    if (firstTick?.spot_price != null) return firstTick.spot_price;
    
    // Fallback 1: strike_prices table (may have source mismatch but better than nothing)
    if (strikePriceData != null) return strikePriceData;
    
    // Fallback 2: tick data strike_price column
    const tickWithStrike = allTicks.find((t) => t.strike_price != null);
    return tickWithStrike?.strike_price ?? null;
  }, [strikePriceData, allTicks]);

  // Determine winner based on last tick
  const lastTick = allTicks[allTicks.length - 1];
  const currentSpot = lastTick?.spot_price;
  const isUpWinning = strikePrice != null && currentSpot != null ? currentSpot > strikePrice : null;
  const deltaPercent = strikePrice && currentSpot
    ? ((currentSpot - strikePrice) / strikePrice * 100)
    : 0;

  if (isLoading) {
    return <Skeleton className="h-40 w-full rounded-lg" />;
  }

  if (error || allTicks.length === 0) {
    return (
      <div className="h-40 flex flex-col items-center justify-center text-muted-foreground text-xs bg-muted/20 rounded-lg gap-2">
        <AlertCircle className="h-5 w-5" />
        <span>Geen prijsticks voor deze market</span>
        <span className="text-[10px] opacity-60">
          {marketSlug}
        </span>
      </div>
    );
  }

  // Calculate Y-axis domain (spot prices only, share prices are 0-1)
  const spotPrices = chartData.map((p) => p.spot);
  const minSpot = Math.min(...spotPrices);
  const maxSpot = Math.max(...spotPrices);
  const spotPadding = (maxSpot - minSpot) * 0.1 || maxSpot * 0.01;

  return (
    <div className="space-y-3">
      {/* Header with live badge and delta */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{asset} Price Path</span>
          {isLive && (
            <Badge variant="outline" className="text-xs bg-emerald-500/10 border-emerald-500/30 text-emerald-600">
              <Activity className="h-3 w-3 mr-1 animate-pulse" />
              Live
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {strikePrice && (
            <span className="text-muted-foreground">
              Strike: <span className="font-mono font-medium">${strikePrice.toLocaleString()}</span>
            </span>
          )}
          {currentSpot && (
            <span className={`font-mono font-medium flex items-center gap-1 ${
              isUpWinning ? 'text-emerald-500' : isUpWinning === false ? 'text-rose-500' : ''
            }`}>
              {isUpWinning ? <TrendingUp className="h-3 w-3" /> : isUpWinning === false ? <TrendingDown className="h-3 w-3" /> : null}
              ${currentSpot.toLocaleString()}
              {strikePrice && (
                <span className="text-[10px]">
                  ({deltaPercent >= 0 ? '+' : ''}{deltaPercent.toFixed(3)}%)
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Main spot price chart */}
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart 
            data={chartData} 
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            syncId={syncId}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis 
              dataKey="relativeTime"
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
            />
            <YAxis 
              domain={[minSpot - spotPadding, maxSpot + spotPadding]}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              width={70}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '11px',
              }}
              labelFormatter={(label) => `Time: ${label}`}
              formatter={(value: number, name: string) => {
                if (name === 'spot') return [`$${value.toLocaleString()}`, `${asset} Spot`];
                return [value, name];
              }}
            />
            
            {/* Strike price = Price to Beat reference line */}
            {strikePrice && (
              <ReferenceLine 
                y={strikePrice} 
                stroke="hsl(var(--warning))" 
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{ 
                  value: `Price to Beat: $${strikePrice.toLocaleString()}`, 
                  position: 'insideBottomLeft', 
                  fontSize: 10,
                  fill: 'hsl(var(--warning))'
                }}
              />
            )}
            
            {/* Spot price line */}
            <Line 
              type="monotone" 
              dataKey="spot" 
              stroke={isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : isUpWinning === false ? 'hsl(346.8, 77.2%, 49.8%)' : 'hsl(var(--primary))'}
              dot={false}
              strokeWidth={2}
              name="spot"
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Share prices chart (UP/DOWN mid) */}
      {chartData.some((p) => p.upMid != null || p.downMid != null) && (
        <>
          <div className="text-xs text-muted-foreground px-1">Share Prices (UP/DOWN mid)</div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart 
                data={chartData} 
                margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
                syncId={syncId}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis 
                  dataKey="relativeTime"
                  fontSize={9}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={[0, 1]}
                  tickFormatter={(v) => `${(v * 100).toFixed(0)}¢`}
                  fontSize={9}
                  stroke="hsl(var(--muted-foreground))"
                  tick={{ fill: 'hsl(var(--muted-foreground))' }}
                  width={35}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'hsl(var(--card))', 
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '8px',
                    fontSize: '11px',
                  }}
                  formatter={(value: number | null, name: string) => {
                    if (value === null) return ['—', name];
                    return [`${(value * 100).toFixed(1)}¢`, name === 'upMid' ? 'UP' : 'DOWN'];
                  }}
                />
                <Legend 
                  wrapperStyle={{ fontSize: '10px' }}
                  formatter={(value) => value === 'upMid' ? 'UP' : 'DOWN'}
                />
                
                {/* 50¢ reference */}
                <ReferenceLine 
                  y={0.5} 
                  stroke="hsl(var(--muted-foreground))" 
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
                
                <Line 
                  type="monotone" 
                  dataKey="upMid" 
                  stroke="hsl(142.1, 76.2%, 36.3%)"
                  dot={false}
                  strokeWidth={1.5}
                  name="upMid"
                  connectNulls
                />
                <Line 
                  type="monotone" 
                  dataKey="downMid" 
                  stroke="hsl(346.8, 77.2%, 49.8%)"
                  dot={false}
                  strokeWidth={1.5}
                  name="downMid"
                  connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}

      {/* Stats footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{allTicks.length} ticks</span>
        <span className="opacity-50">
          {new Date(startTs).toLocaleTimeString()} – {new Date(endTs).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
