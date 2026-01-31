import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useChainlinkRealtime } from '@/hooks/useChainlinkRealtime';
import { useStrikePrices } from '@/hooks/useStrikePrices';
import { useIsMobile } from '@/hooks/use-mobile';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { 
  Activity, 
  TrendingUp, 
  TrendingDown, 
  Target,
  Wifi,
  WifiOff,
  Zap,
  Scale,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface PositionSummary {
  upQty: number;
  downQty: number;
  imbalance: number;
  trailingSide: 'UP' | 'DOWN' | null;
}

interface ActiveMarket {
  slug: string;
  asset: string;
  strikePrice: number | null;
  startTs: number;
  endTs: number;
}

function extractActiveMarkets(strikePrices: Record<string, number>): ActiveMarket[] {
  const now = Date.now();
  const markets: ActiveMarket[] = [];
  
  for (const [slug, strike] of Object.entries(strikePrices)) {
    const match = slug.match(/([a-z]+)-updown-15m-(\d{10})$/i);
    if (!match) continue;
    
    const asset = match[1].toUpperCase();
    const startTs = parseInt(match[2]) * 1000;
    const endTs = startTs + 15 * 60 * 1000;
    
    // Include markets that are currently live OR just ended (within 5 min grace)
    // A market is "live" if: startTs <= now < endTs
    if (now >= startTs && now < endTs + 5 * 60 * 1000) {
      markets.push({ slug, asset, strikePrice: strike, endTs, startTs });
    }
  }
  
  // Sort by startTs descending - most recent market first
  // This ensures we always show the CURRENT market, not an older one
  return markets.sort((a, b) => b.startTs - a.startTs);
}

export function V35LivePriceHeader() {
  const { btcPrice, isConnected, updateCount, lastUpdate } = useChainlinkRealtime(true);
  const { strikePrices, isLoading: strikesLoading } = useStrikePrices();
  const [tick, setTick] = useState(0);
  const isMobile = useIsMobile();
  
  // Fetch live positions for share imbalance
  const { data: positionData } = useQuery<PositionSummary>({
    queryKey: ['v35-position-summary'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('v35-positions');
      if (error || !data?.positions?.length) {
        return { upQty: 0, downQty: 0, imbalance: 0, trailingSide: null };
      }
      // Sum all positions
      let upQty = 0, downQty = 0;
      for (const pos of data.positions) {
        upQty += pos.polymarket_up_qty || 0;
        downQty += pos.polymarket_down_qty || 0;
      }
      const imbalance = Math.abs(upQty - downQty);
      const trailingSide = upQty < downQty ? 'UP' : downQty < upQty ? 'DOWN' : null;
      return { upQty, downQty, imbalance, trailingSide };
    },
    refetchInterval: 5000,
  });
  
  // Force re-render every 100ms for smooth price updates
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 100);
    return () => clearInterval(interval);
  }, []);
  
  const isStale = lastUpdate ? Date.now() - lastUpdate.getTime() > 10000 : true;
  
  // Get active markets with strike prices
  const activeMarkets = extractActiveMarkets(strikePrices);
  const btcMarket = activeMarkets.find(m => m.asset === 'BTC');
  
  const strikePrice = btcMarket?.strikePrice;
  const delta = btcPrice && strikePrice ? btcPrice - strikePrice : null;
  const deltaPct = delta && strikePrice ? (delta / strikePrice) * 100 : null;
  
  // Mobile layout
  if (isMobile) {
    return (
      <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-primary/5">
        <CardContent className="py-3 px-3">
          {/* Row 1: Connection + BTC Price */}
          <div className="flex items-center justify-between gap-2 mb-3">
            {isConnected ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 text-xs px-2 py-0.5">
                <Wifi className="h-3 w-3 mr-1" />
                Live
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-xs">
                <WifiOff className="h-3 w-3 mr-1" />
                ...
              </Badge>
            )}
            <div className={`text-xl font-bold font-mono tabular-nums ${!isStale ? '' : 'text-muted-foreground'}`}>
              {btcPrice ? `$${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '---'}
            </div>
          </div>
          
          {/* Row 2: Strike + Delta + Predicted */}
          {strikePrice && (
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div>
                <div className="text-[10px] text-muted-foreground">Strike</div>
                <div className="text-sm font-bold font-mono text-primary">
                  ${strikePrice.toLocaleString('en-US', { minimumFractionDigits: 0 })}
                </div>
              </div>
              {delta !== null && (
                <div>
                  <div className="text-[10px] text-muted-foreground">Delta</div>
                  <div className={`text-sm font-bold font-mono flex items-center justify-center gap-0.5 ${
                    delta >= 0 ? 'text-emerald-500' : 'text-rose-500'
                  }`}>
                    {delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {delta >= 0 ? '+' : ''}{delta.toFixed(0)}
                  </div>
                </div>
              )}
              {delta !== null && (
                <div>
                  <div className="text-[10px] text-muted-foreground">Predicted</div>
                  <Badge 
                    className={`text-xs px-2 py-0 ${
                      delta >= 0 
                        ? 'bg-emerald-500/90 text-white' 
                        : 'bg-rose-500/90 text-white'
                    }`}
                  >
                    {delta >= 0 ? 'UP' : 'DOWN'}
                  </Badge>
                </div>
              )}
            </div>
          )}
          
          {/* Row 3: Shares if present */}
          {positionData && (positionData.upQty > 0 || positionData.downQty > 0) && (
            <div className="flex items-center justify-center gap-3 text-xs border-t border-border/30 pt-2">
              <span className="text-emerald-500 font-mono flex items-center gap-0.5">
                <ArrowUp className="h-3 w-3" />
                {positionData.upQty.toFixed(0)}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="text-rose-500 font-mono flex items-center gap-0.5">
                <ArrowDown className="h-3 w-3" />
                {positionData.downQty.toFixed(0)}
              </span>
              {positionData.trailingSide && positionData.imbalance >= 5 && (
                <span className={`${positionData.imbalance >= 15 ? 'text-destructive' : 'text-muted-foreground'}`}>
                  ({positionData.trailingSide} -{positionData.imbalance.toFixed(0)})
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Desktop layout (original)
  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 via-background to-primary/5">
      <CardContent className="py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          {/* Connection Status */}
          <div className="flex items-center gap-2">
            {isConnected ? (
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30">
                <Wifi className="h-3 w-3 mr-1" />
                Chainlink Live
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                <WifiOff className="h-3 w-3 mr-1" />
                Connecting...
              </Badge>
            )}
            <span className="text-xs text-muted-foreground">
              {updateCount.toLocaleString()} updates
            </span>
          </div>
          
          {/* BTC Price */}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                <Activity className={`h-3 w-3 ${!isStale ? 'text-emerald-500 animate-pulse' : 'text-muted-foreground'}`} />
                BTC Spot
              </div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${!isStale ? '' : 'text-muted-foreground'}`}>
                {btcPrice ? `$${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '---'}
              </div>
            </div>
            
            {/* Strike Price */}
            {strikePrice && (
              <div className="text-center border-l border-border/50 pl-6">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  Strike
                </div>
                <div className="text-2xl font-bold font-mono tabular-nums text-primary">
                  ${strikePrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            )}
            
            {/* Delta */}
            {delta !== null && (
              <div className="text-center border-l border-border/50 pl-6">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                  <Zap className="h-3 w-3" />
                  Delta
                </div>
                <div className={`text-2xl font-bold font-mono tabular-nums flex items-center gap-1 ${
                  delta >= 0 ? 'text-emerald-500' : 'text-rose-500'
                }`}>
                  {delta >= 0 ? (
                    <TrendingUp className="h-5 w-5" />
                  ) : (
                    <TrendingDown className="h-5 w-5" />
                  )}
                  {delta >= 0 ? '+' : ''}{delta.toFixed(2)}
                </div>
              </div>
            )}
            
            {/* Predicted Outcome */}
            {delta !== null && (
              <div className="text-center border-l border-border/50 pl-6">
                <div className="text-xs text-muted-foreground mb-0.5">Predicted</div>
                <Badge 
                  className={`text-lg px-3 py-1 ${
                    delta >= 0 
                      ? 'bg-emerald-500/90 text-white' 
                      : 'bg-rose-500/90 text-white'
                  }`}
                >
                  {delta >= 0 ? 'UP' : 'DOWN'}
                </Badge>
              </div>
            )}
            
            {/* Share Imbalance */}
            {positionData && (positionData.upQty > 0 || positionData.downQty > 0) && (
              <div className="text-center border-l border-border/50 pl-6">
                <div className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                  <Scale className="h-3 w-3" />
                  Shares
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-500 font-mono text-sm flex items-center gap-0.5">
                    <ArrowUp className="h-3 w-3" />
                    {positionData.upQty.toFixed(0)}
                  </span>
                  <span className="text-muted-foreground">/</span>
                  <span className="text-rose-500 font-mono text-sm flex items-center gap-0.5">
                    <ArrowDown className="h-3 w-3" />
                    {positionData.downQty.toFixed(0)}
                  </span>
                </div>
                {positionData.trailingSide && positionData.imbalance >= 5 && (
                  <div className={`text-xs mt-0.5 ${positionData.imbalance >= 15 ? 'text-destructive animate-pulse' : positionData.imbalance >= 10 ? 'text-warning' : 'text-muted-foreground'}`}>
                    {positionData.trailingSide} trailing by {positionData.imbalance.toFixed(0)}
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Delta Percentage */}
          {deltaPct !== null && (
            <div className={`text-right ${deltaPct >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
              <div className="text-xs text-muted-foreground mb-0.5">Move</div>
              <div className="text-lg font-bold font-mono">
                {deltaPct >= 0 ? '+' : ''}{deltaPct.toFixed(3)}%
              </div>
            </div>
          )}
        </div>
        
        {/* Active Markets Row */}
        {activeMarkets.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/30">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Activity className="h-3 w-3" />
              Active Markets
            </div>
            <div className="flex flex-wrap gap-2">
              {activeMarkets.slice(0, 4).map((market) => {
                const now = Date.now();
                const isLive = now < market.endTs;
                const secsLeft = Math.max(0, Math.floor((market.endTs - now) / 1000));
                const mins = Math.floor(secsLeft / 60);
                const secs = secsLeft % 60;
                
                return (
                  <div 
                    key={market.slug}
                    className={`px-3 py-1.5 rounded-lg border text-xs font-mono ${
                      isLive 
                        ? 'bg-primary/10 border-primary/30 text-primary' 
                        : 'bg-muted/30 border-border/50 text-muted-foreground'
                    }`}
                  >
                    <span className="font-semibold">{market.asset}</span>
                    <span className="mx-2 text-muted-foreground">|</span>
                    <span>Strike: ${market.strikePrice?.toLocaleString() || '?'}</span>
                    {isLive && (
                      <>
                        <span className="mx-2 text-muted-foreground">|</span>
                        <span className={secsLeft < 120 ? 'text-destructive animate-pulse' : ''}>
                          {mins}:{secs.toString().padStart(2, '0')}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
