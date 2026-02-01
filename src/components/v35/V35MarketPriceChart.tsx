import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, TrendingUp, TrendingDown, Info } from 'lucide-react';

interface V35MarketPriceChartProps {
  asset: string;
  marketSlug: string;
  startTs: number; // Window start timestamp in ms
  endTs: number;   // Window end timestamp in ms
}

interface PricePoint {
  ts: number;
  price: number;
  relativeTime: string; // MM:SS format
}

interface StrikePriceData {
  strikePrice: number;
  openPrice: number;
  closePrice: number | null;
  source: string;
}

export function V35MarketPriceChart({ asset, marketSlug, startTs, endTs }: V35MarketPriceChartProps) {
  // Fetch strike price data with open/close prices
  const { data: strikeData, isLoading, error } = useQuery<StrikePriceData | null>({
    queryKey: ['v35-strike-data', marketSlug],
    queryFn: async () => {
      // Get strike price record which includes open/close prices
      const { data, error } = await supabase
        .from('strike_prices')
        .select('strike_price, open_price, close_price, source')
        .eq('market_slug', marketSlug)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      return {
        strikePrice: data.strike_price,
        openPrice: data.open_price ?? data.strike_price,
        closePrice: data.close_price,
        source: data.source ?? 'unknown',
      };
    },
    staleTime: 30000,
    refetchInterval: 15000,
  });

  // Check if market is still live
  const isLive = Date.now() < endTs;
  const strikePrice = strikeData?.strikePrice;
  const openPrice = strikeData?.openPrice;
  const closePrice = strikeData?.closePrice;

  // Determine winner based on close price (or current estimate)
  const finalPrice = closePrice ?? openPrice;
  const isUpWinning = finalPrice && strikePrice ? finalPrice > strikePrice : null;

  if (isLoading) {
    return <Skeleton className="h-32 w-full rounded-lg" />;
  }

  if (error || !strikeData) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground text-xs bg-muted/20 rounded-lg">
        <AlertCircle className="h-4 w-4 mr-2" />
        No price data for this window
      </div>
    );
  }

  // Create simple 2-point chart data (start → end)
  const chartData: PricePoint[] = [];
  
  // Start point (open price)
  chartData.push({
    ts: startTs,
    price: openPrice!,
    relativeTime: '0:00',
  });

  // If we have a close price, add intermediate points for visual effect
  if (closePrice && closePrice !== openPrice) {
    // Add midpoint
    const midPrice = (openPrice! + closePrice) / 2;
    chartData.push({
      ts: startTs + (endTs - startTs) / 2,
      price: midPrice,
      relativeTime: '7:30',
    });
  }

  // End point
  if (closePrice) {
    chartData.push({
      ts: endTs,
      price: closePrice,
      relativeTime: '15:00',
    });
  } else if (isLive) {
    // For live markets, show current position trending toward strike
    chartData.push({
      ts: Date.now(),
      price: openPrice!,
      relativeTime: `${Math.floor((Date.now() - startTs) / 60000)}:${String(Math.floor(((Date.now() - startTs) / 1000) % 60)).padStart(2, '0')}`,
    });
  }

  // Calculate chart bounds
  const allPrices = chartData.map(p => p.price);
  if (strikePrice) allPrices.push(strikePrice);
  
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const padding = (maxPrice - minPrice) * 0.15 || maxPrice * 0.01;

  // Delta from strike
  const deltaPercent = finalPrice && strikePrice 
    ? ((finalPrice - strikePrice) / strikePrice * 100)
    : 0;

  return (
    <div className="space-y-2">
      {/* Price header with strike and delta */}
      <div className="flex items-center justify-between text-xs px-1 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Strike:</span>
          <span className="font-mono font-bold">${strikePrice?.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Open:</span>
          <span className="font-mono">${openPrice?.toLocaleString()}</span>
        </div>
        {closePrice ? (
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Close:</span>
            <span className={`font-mono font-bold flex items-center gap-1 ${
              isUpWinning ? 'text-emerald-500' : 'text-rose-500'
            }`}>
              {isUpWinning ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
              ${closePrice.toLocaleString()}
            </span>
            <span className={`text-xs ${isUpWinning ? 'text-emerald-500' : 'text-rose-500'}`}>
              ({deltaPercent >= 0 ? '+' : ''}{deltaPercent.toFixed(3)}%)
            </span>
          </div>
        ) : isLive ? (
          <div className="flex items-center gap-1 text-yellow-500">
            <Info className="h-3 w-3" />
            <span>Live - awaiting close</span>
          </div>
        ) : null}
      </div>

      {/* Simple visualization showing strike vs price movement */}
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis 
              dataKey="relativeTime"
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
            />
            <YAxis 
              domain={[minPrice - padding, maxPrice + padding]}
              tickFormatter={(v) => `$${v.toLocaleString()}`}
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              width={65}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--card))', 
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '11px',
              }}
              labelFormatter={(label) => `Time: ${label}`}
              formatter={(value: number) => [`$${value.toLocaleString()}`, asset]}
            />
            
            {/* Strike price line */}
            <ReferenceLine 
              y={strikePrice} 
              stroke="hsl(var(--primary))" 
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{ 
                value: 'Strike', 
                position: 'right', 
                fontSize: 9,
                fill: 'hsl(var(--primary))'
              }}
            />
            
            {/* Price line */}
            <Line 
              type="monotone" 
              dataKey="price" 
              stroke={isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : isUpWinning === false ? 'hsl(346.8, 77.2%, 49.8%)' : 'hsl(var(--primary))'}
              dot={{ r: 4, fill: isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : 'hsl(346.8, 77.2%, 49.8%)' }}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend with data source */}
      <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <div className="w-4 h-0.5 bg-primary rounded" style={{ borderStyle: 'dashed' }} />
            <span>Strike</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : 'hsl(346.8, 77.2%, 49.8%)' }} />
            <span>{asset}</span>
          </div>
        </div>
        <span className="opacity-50">Source: {strikeData.source}</span>
      </div>
    </div>
  );
}
