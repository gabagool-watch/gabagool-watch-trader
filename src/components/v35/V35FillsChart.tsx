/**
 * V35 Fills Chart - Synchronized chart showing orders and fills timeline
 * Uses same syncId as V35MarketPriceChart for synchronized hover
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { 
  ComposedChart, 
  Bar, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid,
  Legend,
  ReferenceLine,
  Cell
} from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, Zap } from 'lucide-react';

interface V35FillsChartProps {
  marketSlug: string;
  startTs: number; // Window start timestamp in ms
  endTs: number;   // Window end timestamp in ms
  syncId?: string; // For synchronized tooltip/crosshair
}

interface Fill {
  id: string;
  side: string;
  price: number;
  size: number;
  fill_type: string | null;
  fill_ts: string | null;
  created_at: string;
}

interface ChartPoint {
  relativeTime: string;
  relativeMs: number;
  upBuySize: number;
  upBuyPrice: number | null;
  downBuySize: number;
  downBuyPrice: number | null;
  upSellSize: number;
  upSellPrice: number | null;
  downSellSize: number;
  downSellPrice: number | null;
  fillType: string | null;
}

export function V35FillsChart({ marketSlug, startTs, endTs, syncId }: V35FillsChartProps) {
  // Use provided syncId or generate one based on market
  const effectiveSyncId = syncId || `v35-chart-${marketSlug}`;
  
  // Fetch fills for this market
  const { data: fills, isLoading, error } = useQuery<Fill[]>({
    queryKey: ['v35-fills-chart', marketSlug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v35_fills')
        .select('id, side, price, size, fill_type, fill_ts, created_at')
        .eq('market_slug', marketSlug)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return (data || []) as Fill[];
    },
    staleTime: 30000,
  });

  // Transform fills to chart data with 30-second buckets
  const chartData = useMemo(() => {
    if (!fills || fills.length === 0) return [];

    const bucketSize = 30000; // 30 second buckets
    const buckets = new Map<number, {
      upBuySize: number;
      upBuyPrices: number[];
      downBuySize: number;
      downBuyPrices: number[];
      upSellSize: number;
      upSellPrices: number[];
      downSellSize: number;
      downSellPrices: number[];
      fillTypes: Set<string>;
    }>();

    // Group fills into time buckets
    for (const fill of fills) {
      const fillTime = fill.fill_ts 
        ? new Date(fill.fill_ts).getTime() 
        : new Date(fill.created_at).getTime();
      
      // Skip fills outside our window
      if (fillTime < startTs || fillTime > endTs) continue;
      
      const bucketKey = Math.floor((fillTime - startTs) / bucketSize) * bucketSize;
      
      if (!buckets.has(bucketKey)) {
        buckets.set(bucketKey, {
          upBuySize: 0,
          upBuyPrices: [],
          downBuySize: 0,
          downBuyPrices: [],
          upSellSize: 0,
          upSellPrices: [],
          downSellSize: 0,
          downSellPrices: [],
          fillTypes: new Set(),
        });
      }
      
      const bucket = buckets.get(bucketKey)!;
      const isUp = fill.side.toUpperCase().includes('UP');
      const isBuy = fill.side.toUpperCase().includes('BUY');
      
      if (isUp && isBuy) {
        bucket.upBuySize += fill.size;
        bucket.upBuyPrices.push(fill.price);
      } else if (!isUp && isBuy) {
        bucket.downBuySize += fill.size;
        bucket.downBuyPrices.push(fill.price);
      } else if (isUp && !isBuy) {
        bucket.upSellSize += fill.size;
        bucket.upSellPrices.push(fill.price);
      } else {
        bucket.downSellSize += fill.size;
        bucket.downSellPrices.push(fill.price);
      }
      
      if (fill.fill_type) bucket.fillTypes.add(fill.fill_type);
    }

    // Convert buckets to chart points
    const points: ChartPoint[] = [];
    const sortedKeys = Array.from(buckets.keys()).sort((a, b) => a - b);
    
    for (const relativeMs of sortedKeys) {
      const bucket = buckets.get(relativeMs)!;
      const minutes = Math.floor(relativeMs / 60000);
      const seconds = Math.floor((relativeMs % 60000) / 1000);
      
      const avgPrice = (prices: number[]) => 
        prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
      
      points.push({
        relativeTime: `${minutes}:${seconds.toString().padStart(2, '0')}`,
        relativeMs,
        upBuySize: bucket.upBuySize,
        upBuyPrice: avgPrice(bucket.upBuyPrices),
        downBuySize: bucket.downBuySize,
        downBuyPrice: avgPrice(bucket.downBuyPrices),
        upSellSize: bucket.upSellSize,
        upSellPrice: avgPrice(bucket.upSellPrices),
        downSellSize: bucket.downSellSize,
        downSellPrice: avgPrice(bucket.downSellPrices),
        fillType: Array.from(bucket.fillTypes).join(', ') || null,
      });
    }

    return points;
  }, [fills, startTs, endTs]);

  // Summary stats
  const stats = useMemo(() => {
    if (!fills) return { totalFills: 0, upBuys: 0, downBuys: 0, upSells: 0, downSells: 0 };
    
    let upBuys = 0, downBuys = 0, upSells = 0, downSells = 0;
    for (const fill of fills) {
      const isUp = fill.side.toUpperCase().includes('UP');
      const isBuy = fill.side.toUpperCase().includes('BUY');
      
      if (isUp && isBuy) upBuys += fill.size;
      else if (!isUp && isBuy) downBuys += fill.size;
      else if (isUp && !isBuy) upSells += fill.size;
      else downSells += fill.size;
    }
    
    return { totalFills: fills.length, upBuys, downBuys, upSells, downSells };
  }, [fills]);

  if (isLoading) {
    return <Skeleton className="h-32 w-full rounded-lg" />;
  }

  if (error || !fills || fills.length === 0) {
    return (
      <div className="h-32 flex flex-col items-center justify-center text-muted-foreground text-xs bg-muted/20 rounded-lg gap-2">
        <AlertCircle className="h-5 w-5" />
        <span>Geen fills voor deze market</span>
      </div>
    );
  }

  // Max size for Y-axis
  const maxSize = Math.max(
    ...chartData.map(p => Math.max(p.upBuySize, p.downBuySize, p.upSellSize, p.downSellSize)),
    1
  );

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Fills Timeline</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="text-emerald-500">↑ UP: {stats.upBuys.toFixed(0)} buy / {stats.upSells.toFixed(0)} sell</span>
          <span className="text-rose-500">↓ DOWN: {stats.downBuys.toFixed(0)} buy / {stats.downSells.toFixed(0)} sell</span>
        </div>
      </div>

      {/* Fills bar chart */}
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart 
            data={chartData} 
            margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            syncId={effectiveSyncId}
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
              domain={[0, Math.ceil(maxSize * 1.1)]}
              tickFormatter={(v) => `${v}`}
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              width={35}
              label={{ value: 'Shares', angle: -90, position: 'insideLeft', fontSize: 9, fill: 'hsl(var(--muted-foreground))' }}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '11px',
              }}
              formatter={(value: number, name: string) => {
                const labels: Record<string, string> = {
                  upBuySize: 'UP Buy',
                  downBuySize: 'DOWN Buy',
                  upSellSize: 'UP Sell',
                  downSellSize: 'DOWN Sell',
                };
                return [value > 0 ? `${value.toFixed(1)} shares` : '—', labels[name] || name];
              }}
            />
            <Legend 
              wrapperStyle={{ fontSize: '9px' }}
              formatter={(value) => {
                const labels: Record<string, string> = {
                  upBuySize: 'UP Buy',
                  downBuySize: 'DOWN Buy',
                  upSellSize: 'UP Sell',
                  downSellSize: 'DOWN Sell',
                };
                return labels[value] || value;
              }}
            />
            
            {/* Stacked bars for buys */}
            <Bar 
              dataKey="upBuySize" 
              stackId="buys"
              fill="hsl(142.1, 76.2%, 36.3%)"
              name="upBuySize"
              radius={[2, 2, 0, 0]}
            />
            <Bar 
              dataKey="downBuySize" 
              stackId="buys"
              fill="hsl(346.8, 77.2%, 49.8%)"
              name="downBuySize"
              radius={[2, 2, 0, 0]}
            />
            
            {/* Separate bars for sells (negative direction or different stack) */}
            <Bar 
              dataKey="upSellSize" 
              stackId="sells"
              fill="hsl(142.1, 76.2%, 56.3%)"
              name="upSellSize"
              radius={[2, 2, 0, 0]}
              opacity={0.6}
            />
            <Bar 
              dataKey="downSellSize" 
              stackId="sells"
              fill="hsl(346.8, 77.2%, 69.8%)"
              name="downSellSize"
              radius={[2, 2, 0, 0]}
              opacity={0.6}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <span>{stats.totalFills} fills total</span>
        <span className="opacity-50">30s buckets</span>
      </div>
    </div>
  );
}
