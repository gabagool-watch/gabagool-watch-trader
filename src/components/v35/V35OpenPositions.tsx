import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Scale, 
  AlertTriangle, 
  CheckCircle,
  CheckCircle2, 
  RefreshCw, 
  TrendingUp, 
  TrendingDown,
  Clock,
  Zap,
  DollarSign,
  Target,
  Timer,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  ChevronDown,
  Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState } from 'react';
import { V35FillTimeline } from './V35FillTimeline';
import { V35MarketPriceChart } from './V35MarketPriceChart';
import { V35MiniSharesChart } from './V35MiniSharesChart';

// =========================================================================
// STRATEGY LIMITS (must match local-runner/src/v35/config.ts V35.4.5)
// =========================================================================
const STRATEGY_LIMITS = {
  skewThreshold: 10,       // Warning level - shares before alert
  criticalThreshold: 15,   // Critical level - cancel leading side
  maxUnpairedShares: 20,   // ABSOLUTE HARD STOP - tighter!
  maxImbalanceRatio: 2.0,  // Max ratio UP:DOWN or DOWN:UP
};

type HealthStatus = 'OK' | 'WARNING' | 'CRITICAL';

function getPositionHealth(unpaired: number, upQty: number, downQty: number): { 
  status: HealthStatus; 
  reason: string;
  icon: typeof ShieldCheck;
  colorClass: string;
} {
  const ratio = upQty > 0 && downQty > 0 
    ? Math.max(upQty / downQty, downQty / upQty) 
    : (upQty > 0 || downQty > 0 ? Infinity : 1);
  
  // ABSOLUTE HARD STOP at 20
  if (unpaired >= STRATEGY_LIMITS.maxUnpairedShares) {
    return { 
      status: 'CRITICAL', 
      reason: `HALT! Unpaired ${unpaired.toFixed(0)} ≥ ${STRATEGY_LIMITS.maxUnpairedShares} absolute max`,
      icon: ShieldX,
      colorClass: 'text-destructive'
    };
  }
  
  // Critical at 15
  if (unpaired >= STRATEGY_LIMITS.criticalThreshold) {
    return { 
      status: 'CRITICAL', 
      reason: `Critical: Unpaired ${unpaired.toFixed(0)} ≥ ${STRATEGY_LIMITS.criticalThreshold}`,
      icon: ShieldX,
      colorClass: 'text-destructive'
    };
  }
  
  if (ratio > STRATEGY_LIMITS.maxImbalanceRatio && (upQty > 10 || downQty > 10)) {
    return { 
      status: 'CRITICAL', 
      reason: `Ratio ${ratio.toFixed(1)}:1 > ${STRATEGY_LIMITS.maxImbalanceRatio}:1 max`,
      icon: ShieldX,
      colorClass: 'text-destructive'
    };
  }
  
  // Warning at 10
  if (unpaired >= STRATEGY_LIMITS.skewThreshold) {
    return { 
      status: 'WARNING', 
      reason: `Unpaired ${unpaired.toFixed(0)} ≥ ${STRATEGY_LIMITS.skewThreshold} threshold`,
      icon: ShieldAlert,
      colorClass: 'text-warning'
    };
  }
  
  return { 
    status: 'OK', 
    reason: 'Within strategy limits',
    icon: ShieldCheck,
    colorClass: 'text-primary'
  };
}

interface MarketPosition {
  market_slug: string;
  asset: string;
  // Polymarket data (ground truth)
  polymarket_up_qty: number;
  polymarket_up_avg: number;
  polymarket_down_qty: number;
  polymarket_down_avg: number;
  live_up_price: number;
  live_down_price: number;
  // Derived metrics (from Polymarket only)
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  total_cost: number;
  current_value: number;
  unrealized_pnl: number;
}

interface ExpiredMarket {
  market_slug: string;
  asset: string;
  up_qty: number;
  down_qty: number;
  up_cost: number;
  down_cost: number;
  paired: number;
  combined_cost: number;
  realized_pnl: number;
  expired_at: string;
}

interface PositionsResponse {
  success: boolean;
  wallet_used?: string;
  positions: MarketPosition[];
  summary: {
    total_markets: number;
    total_paired: number;
    total_unpaired: number;
    total_locked_profit: number;
    total_cost: number;
    total_current_value: number;
    total_unrealized_pnl: number;
    // NEW: Realized PnL from expired markets
    total_realized_pnl?: number;
    expired_markets_count?: number;
  };
  expired_markets?: ExpiredMarket[];
  polymarket_raw: number;
}

function shortWallet(addr?: string): string | null {
  if (!addr) return null;
  const a = addr.trim();
  if (a.length < 10) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

interface MarketTimeInfo {
  startTs: number;
  endTs: number;
  startTime: string;
  endTime: string;
  isLive: boolean;
  isExpired: boolean;
  isFuture: boolean;
  secondsRemaining: number;
  percentComplete: number;
}

function parseMarketTime(slug: string): MarketTimeInfo | null {
  const match = slug.match(/(\d{10})$/);
  if (!match) return null;
  
  const startTs = parseInt(match[1]) * 1000;
  const endTs = startTs + 15 * 60 * 1000;
  const now = Date.now();
  
  const formatTime = (d: Date) => {
    const h = d.getUTCHours();
    const m = d.getUTCMinutes();
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };
  
  const isLive = now >= startTs && now < endTs;
  const isExpired = now >= endTs;
  const isFuture = now < startTs;
  const secondsRemaining = Math.max(0, Math.floor((endTs - now) / 1000));
  const percentComplete = isLive ? Math.min(100, ((now - startTs) / (endTs - startTs)) * 100) : (isExpired ? 100 : 0);
  
  return {
    startTs,
    endTs,
    startTime: formatTime(new Date(startTs)),
    endTime: formatTime(new Date(endTs)),
    isLive,
    isExpired,
    isFuture,
    secondsRemaining,
    percentComplete,
  };
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getMarketTitle(asset: string, timeInfo: MarketTimeInfo | null): string {
  if (!timeInfo) return `${asset} 15m Market`;
  return `Will ${asset} go UP or DOWN by ${timeInfo.endTime} UTC?`;
}

function CountdownTimer({ endTs }: { endTs: number }) {
  const [secondsLeft, setSecondsLeft] = useState(() => Math.max(0, Math.floor((endTs - Date.now()) / 1000)));
  
  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((endTs - Date.now()) / 1000));
      setSecondsLeft(remaining);
    }, 1000);
    return () => clearInterval(interval);
  }, [endTs]);
  
  const isUrgent = secondsLeft < 120;
  
  return (
    <div className={`flex items-center gap-1.5 font-mono text-sm ${isUrgent ? 'text-destructive animate-pulse' : 'text-muted-foreground'}`}>
      <Timer className="h-3.5 w-3.5" />
      {formatCountdown(secondsLeft)}
    </div>
  );
}

export function V35OpenPositions() {
  const { data, isLoading, error, refetch, isFetching } = useQuery<PositionsResponse>({
    queryKey: ['v35-polymarket-positions'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('v35-positions');
      if (error) throw error;
      return data as PositionsResponse;
    },
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Live Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Scale className="h-5 w-5" />
            Live Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-destructive">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2" />
            Error loading positions
          </div>
        </CardContent>
      </Card>
    );
  }

  const positions = data?.positions || [];
  const summary = data?.summary;
  const walletUsed = shortWallet(data?.wallet_used);

  // Filter only markets with actual positions
  const activePositions = positions.filter(p => 
    p.polymarket_up_qty > 0 || p.polymarket_down_qty > 0
  );

  // Sort: live markets first, then by timestamp descending
  const sortedPositions = [...activePositions].sort((a, b) => {
    const timeA = parseMarketTime(a.market_slug);
    const timeB = parseMarketTime(b.market_slug);
    if (timeA?.isLive && !timeB?.isLive) return -1;
    if (!timeA?.isLive && timeB?.isLive) return 1;
    return (timeB?.startTs || 0) - (timeA?.startTs || 0);
  });

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5 text-primary" />
              Open Positions
            </CardTitle>
            <CardDescription className="mt-1">
              Live data from Polymarket
              {walletUsed && <span className="ml-1 font-mono text-xs">({walletUsed})</span>}
            </CardDescription>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Critical Alerts */}
        {(() => {
          const criticalMarkets = activePositions.filter(p => {
            const health = getPositionHealth(p.unpaired, p.polymarket_up_qty, p.polymarket_down_qty);
            return health.status === 'CRITICAL';
          });
          const warningMarkets = activePositions.filter(p => {
            const health = getPositionHealth(p.unpaired, p.polymarket_up_qty, p.polymarket_down_qty);
            return health.status === 'WARNING';
          });
          
          if (criticalMarkets.length > 0) {
            return (
              <Alert variant="destructive" className="border-destructive/50 bg-destructive/10">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Kritieke Imbalance Gedetecteerd!</AlertTitle>
                <AlertDescription>
                  {criticalMarkets.length} market(s) overschrijden de strategie limieten. 
                  Bot moet orders cancellen op de leading side.
                </AlertDescription>
              </Alert>
            );
          }
          
          if (warningMarkets.length > 0) {
            return (
              <Alert className="border-warning/50 bg-warning/10">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <AlertTitle className="text-warning">Imbalance Waarschuwing</AlertTitle>
                <AlertDescription>
                  {warningMarkets.length} market(s) naderen de strategie limieten (≥{STRATEGY_LIMITS.skewThreshold} unpaired).
                </AlertDescription>
              </Alert>
            );
          }
          
          return null;
        })()}

        {/* Strategy Limits Reference - Updated for V35.4.5 */}
        <div className="grid grid-cols-3 gap-2 p-3 bg-muted/20 rounded-lg border border-border/50">
          <div className="flex items-center gap-2 text-xs">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span className="text-muted-foreground">OK:</span>
            <span className="font-mono">&lt;{STRATEGY_LIMITS.skewThreshold}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <span className="text-muted-foreground">Warn:</span>
            <span className="font-mono">≥{STRATEGY_LIMITS.skewThreshold}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <ShieldX className="h-4 w-4 text-destructive" />
            <span className="text-muted-foreground">Crit:</span>
            <span className="font-mono">≥{STRATEGY_LIMITS.criticalThreshold}</span>
          </div>
        </div>

        {/* Summary Stats - Polymarket style */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-muted/30 rounded-xl p-4 text-center">
              <Target className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">{summary.total_markets}</div>
              <div className="text-xs text-muted-foreground">Markets</div>
            </div>
            <div className="bg-muted/30 rounded-xl p-4 text-center">
              <Scale className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">{summary.total_paired.toFixed(0)}</div>
              <div className="text-xs text-muted-foreground">Paired</div>
            </div>
            {/* Unpaired with color coding */}
            {(() => {
              const worstHealth = activePositions.reduce((worst, p) => {
                const h = getPositionHealth(p.unpaired, p.polymarket_up_qty, p.polymarket_down_qty);
                if (h.status === 'CRITICAL') return 'CRITICAL';
                if (h.status === 'WARNING' && worst !== 'CRITICAL') return 'WARNING';
                return worst;
              }, 'OK' as HealthStatus);
              
              const bgClass = worstHealth === 'CRITICAL' 
                ? 'bg-destructive/10 border border-destructive/30' 
                : worstHealth === 'WARNING' 
                  ? 'bg-warning/10 border border-warning/30' 
                  : 'bg-muted/30';
              const textClass = worstHealth === 'CRITICAL' 
                ? 'text-destructive' 
                : worstHealth === 'WARNING' 
                  ? 'text-warning' 
                  : '';
              
              return (
                <div className={`rounded-xl p-4 text-center ${bgClass}`}>
                  <Zap className={`h-5 w-5 mx-auto mb-2 ${textClass || 'text-muted-foreground'}`} />
                  <div className={`text-2xl font-bold ${textClass}`}>{summary.total_unpaired.toFixed(0)}</div>
                  <div className="text-xs text-muted-foreground">Unpaired</div>
                </div>
              );
            })()}
            <div className="bg-muted/30 rounded-xl p-4 text-center">
              <DollarSign className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <div className="text-2xl font-bold">${summary.total_cost?.toFixed(2) || '0.00'}</div>
              <div className="text-xs text-muted-foreground">Total Cost</div>
            </div>
            <div className={`rounded-xl p-4 text-center border ${(summary.total_unrealized_pnl || 0) >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-destructive/10 border-destructive/30'}`}>
              <TrendingUp className={`h-5 w-5 mx-auto mb-2 ${(summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-destructive'}`} />
              <div className={`text-2xl font-bold ${(summary.total_unrealized_pnl || 0) >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                {(summary.total_unrealized_pnl || 0) >= 0 ? '+' : ''}${(summary.total_unrealized_pnl || 0).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">Unrealized P&L</div>
            </div>
            {/* Realized PnL from expired markets */}
            <div className={`rounded-xl p-4 text-center border ${(summary.total_realized_pnl || 0) > 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-muted/30 border-border/50'}`}>
              <CheckCircle2 className={`h-5 w-5 mx-auto mb-2 ${(summary.total_realized_pnl || 0) > 0 ? 'text-emerald-500' : 'text-muted-foreground'}`} />
              <div className={`text-2xl font-bold ${(summary.total_realized_pnl || 0) > 0 ? 'text-emerald-500' : ''}`}>
                +${(summary.total_realized_pnl || 0).toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                Realized P&L ({summary.expired_markets_count || 0} markets)
              </div>
            </div>
            <div className="bg-primary/10 rounded-xl p-4 text-center border border-primary/20">
              <DollarSign className="h-5 w-5 mx-auto mb-2 text-primary" />
              <div className="text-2xl font-bold text-primary">
                ${summary.total_locked_profit.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">Locked Profit</div>
            </div>
          </div>
        )}

        {/* Markets List */}
        {sortedPositions.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No active positions</p>
            <p className="text-sm">Positions will appear here when the bot opens trades</p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedPositions.map((pos) => {
              const timeInfo = parseMarketTime(pos.market_slug);
              const title = getMarketTitle(pos.asset, timeInfo);
              const health = getPositionHealth(pos.unpaired, pos.polymarket_up_qty, pos.polymarket_down_qty);
              const HealthIcon = health.icon;
              
              const upCost = pos.polymarket_up_qty * pos.polymarket_up_avg;
              const downCost = pos.polymarket_down_qty * pos.polymarket_down_avg;
              const totalCost = upCost + downCost;
              const upPct = totalCost > 0 ? (upCost / totalCost) * 100 : 50;
              
              return (
                <div 
                  key={pos.market_slug} 
                  className={`rounded-xl border overflow-hidden transition-all ${
                    health.status === 'CRITICAL'
                      ? 'border-destructive/50 bg-gradient-to-br from-destructive/10 to-background shadow-lg shadow-destructive/10'
                      : health.status === 'WARNING'
                        ? 'border-warning/50 bg-gradient-to-br from-warning/5 to-background'
                        : timeInfo?.isLive 
                          ? 'border-primary/50 bg-gradient-to-br from-primary/5 to-background shadow-lg shadow-primary/5' 
                          : 'border-border/50 bg-card'
                  }`}
                >
                  {/* Market Header - Polymarket style */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge 
                            variant="outline" 
                            className={`font-bold ${
                              pos.asset === 'BTC' ? 'bg-orange-500/10 text-orange-500 border-orange-500/30' :
                              pos.asset === 'ETH' ? 'bg-blue-500/10 text-blue-500 border-blue-500/30' :
                              'bg-muted text-muted-foreground'
                            }`}
                          >
                            {pos.asset}
                          </Badge>
                          {/* Health Status Badge */}
                          <Badge 
                            variant={health.status === 'OK' ? 'outline' : 'default'}
                            className={`${
                              health.status === 'CRITICAL' 
                                ? 'bg-destructive text-destructive-foreground animate-pulse' 
                                : health.status === 'WARNING'
                                  ? 'bg-warning text-warning-foreground'
                                  : 'bg-primary/10 text-primary border-primary/30'
                            }`}
                          >
                            <HealthIcon className="h-3 w-3 mr-1" />
                            {health.status}
                          </Badge>
                          {timeInfo?.isLive && health.status === 'OK' && (
                            <Badge className="bg-primary text-primary-foreground animate-pulse">
                              <Zap className="h-3 w-3 mr-1" />
                              LIVE
                            </Badge>
                          )}
                          {timeInfo?.isExpired && (
                            <Badge variant="secondary">
                              <Clock className="h-3 w-3 mr-1" />
                              Settling
                            </Badge>
                          )}
                        </div>
                        <h3 className="font-semibold text-base leading-snug">
                          {title}
                        </h3>
                        {/* Health reason + time info */}
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-xs">
                          {health.status !== 'OK' && (
                            <span className={health.colorClass}>{health.reason}</span>
                          )}
                          {timeInfo && (
                            <>
                              <span className="text-muted-foreground">{timeInfo.startTime} → {timeInfo.endTime} UTC</span>
                              {timeInfo.isLive && (
                                <CountdownTimer endTs={timeInfo.endTs} />
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Locked Profit Badge */}
                      {pos.locked_profit > 0 && (
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground mb-0.5">Locked</div>
                          <div className="text-lg font-bold text-primary">
                            +${pos.locked_profit.toFixed(2)}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Progress Bar - Visual ratio of UP vs DOWN */}
                  {pos.paired > 0 && (
                    <div className="px-4 pb-3">
                      <div className="h-2 rounded-full overflow-hidden bg-muted flex">
                        <div 
                          className="bg-emerald-500 transition-all duration-500" 
                          style={{ width: `${upPct}%` }}
                        />
                        <div 
                          className="bg-rose-500 transition-all duration-500" 
                          style={{ width: `${100 - upPct}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Positions Grid - Two columns */}
                  <div className="grid grid-cols-2 divide-x divide-border/50">
                    {/* UP Position */}
                    <div className="p-4 bg-emerald-500/5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <TrendingUp className="h-4 w-4 text-emerald-500" />
                        </div>
                        <div>
                          <div className="font-semibold text-emerald-600 dark:text-emerald-400">UP</div>
                          <div className="text-xs text-muted-foreground">Yes outcome</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Shares</span>
                          <span className="font-mono font-medium">{pos.polymarket_up_qty.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Avg Price</span>
                          <span className="font-mono font-medium">{(pos.polymarket_up_avg * 100).toFixed(1)}¢</span>
                        </div>
                        {pos.live_up_price > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Live Price</span>
                            <span className="font-mono font-medium text-emerald-500">{(pos.live_up_price * 100).toFixed(1)}¢</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm pt-2 border-t border-border/50">
                          <span className="text-muted-foreground">Cost</span>
                          <span className="font-mono font-bold">${upCost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* DOWN Position */}
                    <div className="p-4 bg-rose-500/5">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="w-8 h-8 rounded-full bg-rose-500/20 flex items-center justify-center">
                          <TrendingDown className="h-4 w-4 text-rose-500" />
                        </div>
                        <div>
                          <div className="font-semibold text-rose-600 dark:text-rose-400">DOWN</div>
                          <div className="text-xs text-muted-foreground">No outcome</div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Shares</span>
                          <span className="font-mono font-medium">{pos.polymarket_down_qty.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Avg Price</span>
                          <span className="font-mono font-medium">{(pos.polymarket_down_avg * 100).toFixed(1)}¢</span>
                        </div>
                        {pos.live_down_price > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Live Price</span>
                            <span className="font-mono font-medium text-rose-500">{(pos.live_down_price * 100).toFixed(1)}¢</span>
                          </div>
                        )}
                        <div className="flex justify-between text-sm pt-2 border-t border-border/50">
                          <span className="text-muted-foreground">Cost</span>
                          <span className="font-mono font-bold">${downCost.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-4 py-3 bg-muted/20 border-t border-border/50 space-y-2">
                    {/* Totals row */}
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Total Cost:</span>
                          <span className="font-mono font-bold">${pos.total_cost?.toFixed(2) || totalCost.toFixed(2)}</span>
                        </div>
                        {(pos.unrealized_pnl !== undefined && pos.unrealized_pnl !== 0) && (
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className={`h-3.5 w-3.5 ${pos.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-destructive'}`} />
                            <span className="text-muted-foreground">Unrealized:</span>
                            <span className={`font-mono font-bold ${pos.unrealized_pnl >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                              {pos.unrealized_pnl >= 0 ? '+' : ''}${pos.unrealized_pnl.toFixed(2)}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">CPP:</span>
                        <span className={`font-mono font-bold ${
                          pos.combined_cost < 1 ? 'text-primary' : 'text-destructive'
                        }`}>
                          {(pos.combined_cost * 100).toFixed(1)}¢
                        </span>
                      </div>
                    </div>
                    
                    {/* Paired/Unpaired row */}
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                          <span className="text-muted-foreground">Paired:</span>
                          <span className="font-mono font-medium">{pos.paired.toFixed(0)}</span>
                        </div>
                        {pos.unpaired > 0 && (
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className={`h-3.5 w-3.5 ${health.colorClass}`} />
                            <span className="text-muted-foreground">Unpaired:</span>
                            <span className={`font-mono font-medium ${health.status !== 'OK' ? health.colorClass : ''}`}>
                              {pos.unpaired.toFixed(0)}
                              <span className="text-muted-foreground">/{STRATEGY_LIMITS.maxUnpairedShares}</span>
                            </span>
                            {/* Progress bar for unpaired */}
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all ${
                                  health.status === 'CRITICAL' ? 'bg-destructive' :
                                  health.status === 'WARNING' ? 'bg-warning' : 'bg-primary'
                                }`}
                                style={{ width: `${Math.min(100, (pos.unpaired / STRATEGY_LIMITS.maxUnpairedShares) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                      {pos.locked_profit > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Locked:</span>
                          <span className="font-mono font-bold text-primary">
                            +${pos.locked_profit.toFixed(2)}
                          </span>
                        </div>
                      )}
                    </div>
                    
                    {/* P&L Scenarios */}
                    {(pos.paired > 0 || pos.unpaired > 0) && (() => {
                      const pairedProfit = pos.paired * (1 - pos.combined_cost);
                      const excessUp = pos.polymarket_up_qty - pos.polymarket_down_qty;
                      const excessDown = pos.polymarket_down_qty - pos.polymarket_up_qty;
                      
                      // If UP wins: unpaired UP shares pay $1, unpaired DOWN = $0
                      // If DOWN wins: unpaired DOWN shares pay $1, unpaired UP = $0
                      const unpairedUpCost = excessUp > 0 ? excessUp * pos.polymarket_up_avg : 0;
                      const unpairedDownCost = excessDown > 0 ? excessDown * pos.polymarket_down_avg : 0;
                      
                      // If UP wins: paired profit + (unpaired UP * $1 - cost) 
                      const pnlIfUpWins = pairedProfit + (excessUp > 0 ? (excessUp * 1 - unpairedUpCost) : -unpairedDownCost);
                      // If DOWN wins: paired profit + (unpaired DOWN * $1 - cost)
                      const pnlIfDownWins = pairedProfit + (excessDown > 0 ? (excessDown * 1 - unpairedDownCost) : -unpairedUpCost);
                      
                      return (
                        <div className="flex items-center justify-between text-xs pt-2 border-t border-border/30">
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="h-3 w-3 text-emerald-500" />
                            <span className="text-muted-foreground">If UP wins:</span>
                            <span className={`font-mono font-bold ${pnlIfUpWins >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                              {pnlIfUpWins >= 0 ? '+' : ''}${pnlIfUpWins.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <TrendingDown className="h-3 w-3 text-rose-500" />
                            <span className="text-muted-foreground">If DOWN wins:</span>
                            <span className={`font-mono font-bold ${pnlIfDownWins >= 0 ? 'text-emerald-500' : 'text-destructive'}`}>
                              {pnlIfDownWins >= 0 ? '+' : ''}${pnlIfDownWins.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  
                  {/* Price Chart - shows asset price vs strike */}
                  {timeInfo && (
                    <div className="px-4 py-3 bg-muted/10 border-t border-border/50">
                      <V35MarketPriceChart 
                        asset={pos.asset}
                        marketSlug={pos.market_slug}
                        startTs={timeInfo.startTs}
                        endTs={timeInfo.endTs}
                      />
                    </div>
                  )}
                  
                  {/* Shares Progression Chart - shows UP/DOWN over time */}
                  {timeInfo && (
                    <div className="px-4 py-3 bg-muted/10 border-t border-border/50">
                      <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        Shares Progression
                      </div>
                      <V35MiniSharesChart 
                        marketSlug={pos.market_slug}
                        startTs={timeInfo.startTs}
                        endTs={timeInfo.endTs}
                      />
                    </div>
                  )}
                  
                  {/* Timeline for LIVE markets */}
                  {timeInfo?.isLive && (
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="w-full rounded-none border-t border-border/50 gap-2"
                        >
                          <Activity className="h-4 w-4" />
                          Toon Fill Timeline
                          <ChevronDown className="h-4 w-4 ml-auto transition-transform duration-200 group-data-[state=open]:rotate-180" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="p-4 bg-muted/10">
                        <V35FillTimeline marketSlug={pos.market_slug} asset={pos.asset} />
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Expired Markets Section */}
        {data?.expired_markets && data.expired_markets.length > 0 && (
          <div className="mt-8 pt-6 border-t border-border/50">
            <h3 className="flex items-center gap-2 text-lg font-semibold mb-4">
              <Clock className="h-5 w-5 text-muted-foreground" />
              Afgelopen Markets ({data.expired_markets.length})
            </h3>
            <div className="space-y-3">
              {data.expired_markets.map((market) => {
                const paired = Math.min(market.up_qty, market.down_qty);
                const unpaired = Math.abs(market.up_qty - market.down_qty);
                const totalCost = market.up_cost + market.down_cost;
                const pairedCost = paired * market.combined_cost;
                const pairedProfit = paired * (1 - market.combined_cost);
                const isProfitable = market.combined_cost < 1;
                
                // Extract time from slug
                const match = market.market_slug.match(/(\d{10})$/);
                const expiredTime = match 
                  ? new Date(parseInt(match[1]) * 1000 + 15 * 60 * 1000).toLocaleString('nl-NL', {
                      hour: '2-digit',
                      minute: '2-digit',
                      day: '2-digit',
                      month: 'short'
                    })
                  : market.expired_at;

                return (
                  <div 
                    key={market.market_slug}
                    className={`rounded-lg border p-4 ${
                      isProfitable 
                        ? 'bg-emerald-500/5 border-emerald-500/20' 
                        : 'bg-destructive/5 border-destructive/20'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="font-mono">
                          {market.asset}
                        </Badge>
                        <span className="text-sm text-muted-foreground font-mono">
                          {expiredTime}
                        </span>
                        <Badge variant="secondary" className="text-xs">
                          Expired
                        </Badge>
                      </div>
                      <div className={`font-bold ${isProfitable ? 'text-emerald-500' : 'text-destructive'}`}>
                        {market.realized_pnl > 0 ? '+' : ''}${market.realized_pnl.toFixed(2)}
                        {market.realized_pnl === 0 && isProfitable && (
                          <span className="text-xs text-muted-foreground ml-1">(pending claim)</span>
                        )}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">UP:</span>
                        <span className="ml-1 font-mono">{market.up_qty.toFixed(1)}</span>
                        <span className="text-xs text-muted-foreground ml-1">(${market.up_cost.toFixed(2)})</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">DOWN:</span>
                        <span className="ml-1 font-mono">{market.down_qty.toFixed(1)}</span>
                        <span className="text-xs text-muted-foreground ml-1">(${market.down_cost.toFixed(2)})</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Paired:</span>
                        <span className="ml-1 font-mono">{paired.toFixed(1)}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">CPP:</span>
                        <span className={`ml-1 font-mono font-bold ${isProfitable ? 'text-emerald-500' : 'text-destructive'}`}>
                          {(market.combined_cost * 100).toFixed(1)}¢
                        </span>
                      </div>
                    </div>
                    
                    {unpaired > 0 && (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <AlertTriangle className="h-3 w-3 inline mr-1" />
                        {unpaired.toFixed(1)} unpaired shares (exposed to outcome)
                      </div>
                    )}
                    
                    {/* Expected profit calculation */}
                    {isProfitable && paired > 0 && (
                      <div className="mt-2 pt-2 border-t border-border/30 text-xs">
                        <span className="text-muted-foreground">Expected paired profit:</span>
                        <span className="ml-1 font-mono text-emerald-500">
                          +${pairedProfit.toFixed(2)}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          ({paired.toFixed(0)} × ${(1 - market.combined_cost).toFixed(3)})
                        </span>
                      </div>
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
