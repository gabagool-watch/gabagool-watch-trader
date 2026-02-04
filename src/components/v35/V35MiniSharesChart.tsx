import { useMemo } from 'react';
import { Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line } from 'recharts';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface V35MiniSharesChartProps {
  marketSlug: string;
  startTs: number;
  endTs: number;
}

interface InventorySnapshot {
  ts: number;
  up_shares: number;
  down_shares: number;
  pair_cost: number | null;
}

export function V35MiniSharesChart({ marketSlug, startTs, endTs }: V35MiniSharesChartProps) {
  // Fetch inventory snapshots for this market
  const { data: inventorySnapshots, isLoading } = useQuery({
    queryKey: ['v35-mini-inventory', marketSlug],
    queryFn: async () => {
      // Extract market_id pattern from slug (e.g., "btc-updown-15m-1769865300")
      const slugParts = marketSlug.match(/(\d{10,})$/);
      const marketIdSuffix = slugParts ? slugParts[1] : marketSlug;
      
      const { data, error } = await supabase
        .from('inventory_snapshots')
        .select('ts, up_shares, down_shares, pair_cost')
        .or(`market_id.like.%${marketIdSuffix}%,market_id.eq.${marketSlug}`)
        .order('ts', { ascending: true });

      if (error) throw error;
      return (data || []) as InventorySnapshot[];
    },
    refetchInterval: 5000,
  });

  const chartData = useMemo(() => {
    if (!inventorySnapshots || inventorySnapshots.length === 0) return [];
    
    // Use running maximum to filter reconciliation noise
    let runningMaxUp = 0;
    let runningMaxDown = 0;
    
    return inventorySnapshots.map(snapshot => {
      runningMaxUp = Math.max(runningMaxUp, snapshot.up_shares || 0);
      runningMaxDown = Math.max(runningMaxDown, snapshot.down_shares || 0);
      
      // Calculate relative time (MM:SS from market start)
      const relativeMs = snapshot.ts - startTs;
      const elapsedMinutes = Math.floor(relativeMs / 60000);
      const elapsedSeconds = Math.floor((relativeMs % 60000) / 1000);
      const relativeTime = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
      
      return {
        ts: snapshot.ts,
        relativeTime,
        up: runningMaxUp,
        down: runningMaxDown,
        cpp: snapshot.pair_cost,
        unpaired: Math.abs(runningMaxUp - runningMaxDown),
      };
    });
  }, [inventorySnapshots, startTs]);

  // Calculate final stats
  const finalStats = useMemo(() => {
    if (chartData.length === 0) return null;
    const last = chartData[chartData.length - 1];
    return {
      up: last.up,
      down: last.down,
      unpaired: last.unpaired,
      cpp: last.cpp,
    };
  }, [chartData]);

  if (isLoading || chartData.length === 0) {
    return (
      <div className="h-[80px] flex items-center justify-center text-xs text-muted-foreground">
        {isLoading ? 'Laden...' : 'Geen inventory data'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Mini legend */}
      <div className="flex items-center justify-between text-[10px]">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">UP: {finalStats?.up.toFixed(0)}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-rose-500" />
            <span className="text-muted-foreground">DOWN: {finalStats?.down.toFixed(0)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {finalStats?.cpp && (
            <span className={`font-mono ${finalStats.cpp < 1 ? 'text-primary' : 'text-destructive'}`}>
              CPP: {(finalStats.cpp * 100).toFixed(0)}¢
            </span>
          )}
        </div>
      </div>
      
      {/* Chart */}
      <div className="h-[60px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
            <defs>
              <linearGradient id="upGradientMini" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-2))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--chart-2))" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="downGradientMini" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="hsl(var(--chart-1))" stopOpacity={0.3} />
                <stop offset="95%" stopColor="hsl(var(--chart-1))" stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <XAxis 
              dataKey="relativeTime" 
              tick={false}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              tick={false}
              axisLine={false}
              tickLine={false}
              domain={[0, 'dataMax + 5']}
            />
            <Tooltip 
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg p-2 shadow-lg text-[10px]">
                    <div className="font-medium mb-1">{data.relativeTime}</div>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-500">UP: {data.up.toFixed(0)}</span>
                      <span className="text-rose-500">DOWN: {data.down.toFixed(0)}</span>
                      {data.cpp && (
                        <span className={data.cpp < 1 ? 'text-primary' : 'text-destructive'}>
                          CPP: {(data.cpp * 100).toFixed(0)}¢
                        </span>
                      )}
                    </div>
                  </div>
                );
              }}
            />
            <Area 
              type="stepAfter" 
              dataKey="up" 
              stroke="hsl(var(--chart-2))" 
              fill="url(#upGradientMini)" 
              strokeWidth={1.5}
            />
            <Area 
              type="stepAfter" 
              dataKey="down" 
              stroke="hsl(var(--chart-1))" 
              fill="url(#downGradientMini)" 
              strokeWidth={1.5}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
