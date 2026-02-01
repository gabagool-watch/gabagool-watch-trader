import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

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

interface StrikeInfo {
  strikePrice: number | null;
  source: string;
}

export function V35MarketPriceChart({ asset, marketSlug, startTs, endTs }: V35MarketPriceChartProps) {
  // Fetch price data for this window
  const { data: prices, isLoading: pricesLoading, error: pricesError } = useQuery({
    queryKey: ['v35-market-prices', asset, startTs, endTs],
    queryFn: async () => {
      // Fetch prices from 1 minute before to 1 minute after window
      const startSec = Math.floor(startTs / 1000) - 60;
      const endSec = Math.floor(endTs / 1000) + 60;

      const { data, error } = await supabase
        .from('chainlink_prices')
        .select('chainlink_timestamp, price')
        .eq('asset', asset)
        .gte('chainlink_timestamp', startSec)
        .lte('chainlink_timestamp', endSec)
        .order('chainlink_timestamp', { ascending: true });

      if (error) throw error;

      // Transform to chart format with relative time
      return (data || []).map(p => {
        const ts = p.chainlink_timestamp * 1000;
        const relMs = ts - startTs;
        const relSec = Math.floor(relMs / 1000);
        const minutes = Math.floor(relSec / 60);
        const seconds = Math.abs(relSec % 60);
        const relativeTime = relSec < 0 
          ? `-${Math.abs(minutes)}:${seconds.toString().padStart(2, '0')}`
          : `${minutes}:${seconds.toString().padStart(2, '0')}`;

        return {
          ts,
          price: p.price,
          relativeTime,
        } as PricePoint;
      });
    },
    staleTime: 10000,
    refetchInterval: 15000, // Refresh every 15s for live markets
  });

  // Fetch strike price from decision_snapshots or fill_logs
  const { data: strikeInfo } = useQuery<StrikeInfo>({
    queryKey: ['v35-strike-price', marketSlug],
    queryFn: async () => {
      // Try decision_snapshots first (most reliable for active markets)
      // Note: decision_snapshots might not have strike_price, so try fill_logs
      const { data: fillData, error: fillError } = await supabase
        .from('fill_logs')
        .select('strike_price')
        .eq('market_id', marketSlug)
        .not('strike_price', 'is', null)
        .order('ts', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!fillError && fillData?.strike_price) {
        return { strikePrice: fillData.strike_price, source: 'fill_logs' };
      }

      // Fallback: try to get from decision_snapshots via spot_price at window start
      // Parse market ID for timestamp
      const match = marketSlug.match(/(\d{10})$/);
      if (match) {
        const windowStartSec = parseInt(match[1]);
        // Get the spot price closest to window start
        const { data: priceData } = await supabase
          .from('chainlink_prices')
          .select('price')
          .eq('asset', marketSlug.split('-')[0].toUpperCase())
          .gte('chainlink_timestamp', windowStartSec - 5)
          .lte('chainlink_timestamp', windowStartSec + 5)
          .order('chainlink_timestamp', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (priceData?.price) {
          return { strikePrice: priceData.price, source: 'window_start' };
        }
      }

      return { strikePrice: null, source: 'none' };
    },
    staleTime: 60000,
  });

  const strikePrice = strikeInfo?.strikePrice;

  if (pricesLoading) {
    return <Skeleton className="h-32 w-full rounded-lg" />;
  }

  if (pricesError || !prices || prices.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground text-xs bg-muted/20 rounded-lg">
        <AlertCircle className="h-4 w-4 mr-2" />
        No price data for this window
      </div>
    );
  }

  // Calculate chart bounds
  const allPrices = prices.map(p => p.price);
  if (strikePrice) allPrices.push(strikePrice);
  
  const minPrice = Math.min(...allPrices);
  const maxPrice = Math.max(...allPrices);
  const padding = (maxPrice - minPrice) * 0.1 || maxPrice * 0.01;

  // Find current price (last in range that's before now)
  const now = Date.now();
  const currentPricePoint = prices.filter(p => p.ts <= now).pop();
  const currentPrice = currentPricePoint?.price;

  // Determine if UP or DOWN is winning
  const isUpWinning = currentPrice && strikePrice ? currentPrice > strikePrice : null;

  return (
    <div className="space-y-2">
      {/* Strike price header */}
      {strikePrice && (
        <div className="flex items-center justify-between text-xs px-1">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Price to Beat:</span>
            <span className="font-mono font-bold">${strikePrice.toLocaleString()}</span>
          </div>
          {currentPrice && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Current:</span>
              <span className={`font-mono font-bold flex items-center gap-1 ${
                isUpWinning ? 'text-emerald-500' : 'text-rose-500'
              }`}>
                {isUpWinning ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                ${currentPrice.toLocaleString()}
              </span>
              <span className={`text-xs ${isUpWinning ? 'text-emerald-500' : 'text-rose-500'}`}>
                ({isUpWinning ? '+' : ''}{((currentPrice - strikePrice) / strikePrice * 100).toFixed(2)}%)
              </span>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={prices} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis 
              dataKey="relativeTime"
              fontSize={9}
              stroke="hsl(var(--muted-foreground))"
              tick={{ fill: 'hsl(var(--muted-foreground))' }}
              interval="preserveStartEnd"
              tickCount={5}
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
            
            {/* Window boundaries */}
            <ReferenceLine 
              x="0:00" 
              stroke="hsl(var(--muted-foreground))" 
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <ReferenceLine 
              x="15:00" 
              stroke="hsl(var(--muted-foreground))" 
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            
            {/* Strike price line */}
            {strikePrice && (
              <ReferenceLine 
                y={strikePrice} 
                stroke="hsl(var(--primary))" 
                strokeDasharray="5 5"
                strokeWidth={2}
                label={{ 
                  value: `Strike: $${strikePrice.toLocaleString()}`, 
                  position: 'right', 
                  fontSize: 9,
                  fill: 'hsl(var(--primary))'
                }}
              />
            )}
            
            {/* Price line */}
            <Line 
              type="monotone" 
              dataKey="price" 
              stroke={isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : isUpWinning === false ? 'hsl(346.8, 77.2%, 49.8%)' : 'hsl(var(--primary))'}
              dot={false}
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-primary rounded" style={{ borderStyle: 'dashed' }} />
          <span>Strike Price</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 rounded" style={{ backgroundColor: isUpWinning ? 'hsl(142.1, 76.2%, 36.3%)' : 'hsl(346.8, 77.2%, 49.8%)' }} />
          <span>{asset} Price</span>
        </div>
      </div>
    </div>
  );
}
