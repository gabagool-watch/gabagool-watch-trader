import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, Bar } from 'recharts';
import { TrendingUp, TrendingDown, AlertTriangle, Activity, DollarSign } from 'lucide-react';

interface FillDataPoint {
  ts: number;
  time: string;
  outcome: 'UP' | 'DOWN';
  side: 'BUY' | 'SELL';
  price: number;
  size: number;
  up_shares: number;
  down_shares: number;
  up_cost: number;
  down_cost: number;
  unpaired: number;
  up_price?: number;
  down_price?: number;
}

interface V35ImbalanceChartProps {
  fills: Array<{
    ts: number;
    side: string;      // BUY or SELL
    outcome: string;   // UP or DOWN
    fill_price: number;
    fill_qty: number;
  }>;
  inventorySnapshots?: Array<{
    ts: number;
    up_shares: number;
    down_shares: number;
    state: string;
  }>;
  marketSlug: string;
  winner?: 'UP' | 'DOWN';
}

export function V35ImbalanceChart({ fills, inventorySnapshots, marketSlug, winner }: V35ImbalanceChartProps) {
  const chartData = useMemo(() => {
    if (!fills || fills.length === 0) return [];

    // Sort fills by timestamp
    const sortedFills = [...fills].sort((a, b) => a.ts - b.ts);
    
    let runningUp = 0;
    let runningDown = 0;
    let runningUpCost = 0;
    let runningDownCost = 0;

    const data: FillDataPoint[] = [];

    for (const fill of sortedFills) {
      // Use outcome (UP/DOWN) for categorization, side (BUY/SELL) for direction
      const outcome = (fill.outcome?.toUpperCase() || 'UP') as 'UP' | 'DOWN';
      const side = (fill.side?.toUpperCase() || 'BUY') as 'BUY' | 'SELL';
      const price = fill.fill_price;
      const size = fill.fill_qty;

      // BUY adds to position, SELL reduces position
      if (side === 'BUY') {
        if (outcome === 'UP') {
          runningUp += size;
          runningUpCost += size * price;
        } else if (outcome === 'DOWN') {
          runningDown += size;
          runningDownCost += size * price;
        }
      } else if (side === 'SELL') {
        if (outcome === 'UP') {
          runningUp -= size;
          // Reduce cost proportionally (FIFO approximation)
          const avgCost = runningUp > 0 ? runningUpCost / (runningUp + size) : price;
          runningUpCost -= size * avgCost;
          runningUpCost = Math.max(0, runningUpCost);
        } else if (outcome === 'DOWN') {
          runningDown -= size;
          const avgCost = runningDown > 0 ? runningDownCost / (runningDown + size) : price;
          runningDownCost -= size * avgCost;
          runningDownCost = Math.max(0, runningDownCost);
        }
      }

      // Ensure non-negative shares
      runningUp = Math.max(0, runningUp);
      runningDown = Math.max(0, runningDown);

      const time = new Date(fill.ts).toLocaleTimeString('nl-NL', { 
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit' 
      });

      data.push({
        ts: fill.ts,
        time,
        outcome,
        side,
        price,
        size,
        up_shares: runningUp,
        down_shares: runningDown,
        up_cost: runningUpCost,
        down_cost: runningDownCost,
        unpaired: Math.abs(runningUp - runningDown),
        up_price: outcome === 'UP' ? price : undefined,
        down_price: outcome === 'DOWN' ? price : undefined,
      });
    }

    return data;
  }, [fills]);

  // Calculate stats
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    
    const finalState = chartData[chartData.length - 1];
    const maxUnpaired = Math.max(...chartData.map(d => d.unpaired));
    // Filter by outcome (UP/DOWN), not side (BUY/SELL)
    const upFills = chartData.filter(d => d.outcome === 'UP');
    const downFills = chartData.filter(d => d.outcome === 'DOWN');
    
    const totalUpSize = upFills.reduce((sum, f) => sum + f.size, 0);
    const totalDownSize = downFills.reduce((sum, f) => sum + f.size, 0);
    
    const avgUpPrice = totalUpSize > 0 
      ? upFills.reduce((sum, f) => sum + f.price * f.size, 0) / totalUpSize
      : 0;
    const avgDownPrice = totalDownSize > 0 
      ? downFills.reduce((sum, f) => sum + f.price * f.size, 0) / totalDownSize
      : 0;
    
    const minUpPrice = upFills.length > 0 ? Math.min(...upFills.map(f => f.price)) : 0;
    const minDownPrice = downFills.length > 0 ? Math.min(...downFills.map(f => f.price)) : 0;
    
    // Total costs from final cumulative state
    const totalUpCost = finalState.up_cost;
    const totalDownCost = finalState.down_cost;
    const totalCost = totalUpCost + totalDownCost;
    
    // PnL calculation: (winning_shares × $1.00) - total_cost
    // Determine winner by which side has more shares (for display purposes)
    const bias = finalState.up_shares > finalState.down_shares ? 'UP' : 'DOWN';
    
    // If we know the winner, calculate actual PnL
    // PnL = (winning_shares × $1) - (up_cost + down_cost)
    // The winning shares get $1 each, losing shares are worthless
    let pnl = 0;
    let winningShares = 0;
    if (winner === 'UP') {
      winningShares = finalState.up_shares;
      pnl = (winningShares * 1.0) - totalCost;
    } else if (winner === 'DOWN') {
      winningShares = finalState.down_shares;
      pnl = (winningShares * 1.0) - totalCost;
    } else {
      // Unknown winner - show potential PnL for each scenario
      const pnlIfUp = (finalState.up_shares * 1.0) - totalCost;
      const pnlIfDown = (finalState.down_shares * 1.0) - totalCost;
      pnl = Math.max(pnlIfUp, pnlIfDown); // Best case
    }
    
    return {
      finalUp: finalState.up_shares,
      finalDown: finalState.down_shares,
      finalUnpaired: finalState.unpaired,
      maxUnpaired,
      totalFills: chartData.length,
      upFillCount: upFills.length,
      downFillCount: downFills.length,
      avgUpPrice,
      avgDownPrice,
      minUpPrice,
      minDownPrice,
      totalUpCost,
      totalDownCost,
      totalCost,
      pnl,
      bias,
    };
  }, [chartData, winner]);

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Share Imbalance Timeline</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-center py-8">
          Geen fill data beschikbaar
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          Share Imbalance Evolution
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{marketSlug.slice(-35)}</span>
          {winner && (
            <Badge variant={winner === stats?.bias ? 'destructive' : 'default'} className="text-xs">
              Winner: {winner}
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Final UP</div>
              <div className="font-bold text-emerald-500">{stats.finalUp.toFixed(1)} shares</div>
              <div className="text-muted-foreground">
                Cost: ${stats.totalUpCost.toFixed(2)}
              </div>
              <div className="text-muted-foreground">
                Avg: ${stats.avgUpPrice.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Final DOWN</div>
              <div className="font-bold text-rose-500">{stats.finalDown.toFixed(1)} shares</div>
              <div className="text-muted-foreground">
                Cost: ${stats.totalDownCost.toFixed(2)}
              </div>
              <div className="text-muted-foreground">
                Avg: ${stats.avgDownPrice.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Total Cost</div>
              <div className="font-bold">${stats.totalCost.toFixed(2)}</div>
              <div className="text-muted-foreground">
                UP: ${stats.totalUpCost.toFixed(2)} + DOWN: ${stats.totalDownCost.toFixed(2)}
              </div>
            </div>
            <div className={`rounded-lg p-2 ${stats.pnl >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
              <div className="text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                P&L {winner ? `(${winner} won)` : '(best case)'}
              </div>
              <div className={`font-bold text-lg ${stats.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(2)}
              </div>
              <div className="text-muted-foreground text-[10px]">
                = ({winner || stats.bias} × $1) - ${stats.totalCost.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Imbalance</div>
              <div className={`font-bold ${stats.maxUnpaired >= 100 ? 'text-destructive' : stats.maxUnpaired >= 50 ? 'text-warning' : ''}`}>
                {stats.finalUnpaired.toFixed(1)} unpaired
              </div>
              <div className="text-muted-foreground">
                Max: {stats.maxUnpaired.toFixed(1)} | {stats.totalFills} fills
              </div>
            </div>
          </div>
        )}

        {/* Main chart: UP vs DOWN shares over time */}
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="upGradientImb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="downGradientImb" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis 
                yAxisId="shares"
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
                domain={[0, 'dataMax + 20']}
                label={{ value: 'Shares', angle: -90, position: 'insideLeft', fontSize: 10 }}
              />
              <YAxis 
                yAxisId="price"
                orientation="right"
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
                domain={[0, 1]}
                tickFormatter={(v) => `$${v.toFixed(2)}`}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload as FillDataPoint;
                  return (
                    <div className="bg-popover border rounded-lg p-3 shadow-lg text-xs">
                      <div className="font-medium mb-1">{data.time}</div>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className={data.outcome === 'UP' ? 'bg-emerald-500/10' : 'bg-rose-500/10'}>
                          {data.outcome} {data.side}: {data.size.toFixed(1)} @ ${data.price.toFixed(2)}
                        </Badge>
                      </div>
                      <div className="space-y-1 pt-1 border-t">
                        <div className="flex justify-between">
                          <span className="text-emerald-500">UP shares:</span>
                          <span className="font-mono">{data.up_shares.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-rose-500">DOWN shares:</span>
                          <span className="font-mono">{data.down_shares.toFixed(1)}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t">
                          <span className="text-warning">Unpaired:</span>
                          <span className={`font-mono font-bold ${data.unpaired >= 100 ? 'text-destructive' : ''}`}>
                            {data.unpaired.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              {/* Reference lines for imbalance thresholds */}
              <ReferenceLine yAxisId="shares" y={100} stroke="#ef4444" strokeDasharray="3 3" />
              <ReferenceLine yAxisId="shares" y={50} stroke="#f59e0b" strokeDasharray="3 3" />
              
              <Area 
                yAxisId="shares"
                type="stepAfter" 
                dataKey="up_shares" 
                stroke="#10b981" 
                fill="url(#upGradientImb)" 
                strokeWidth={2}
                name="UP Shares"
              />
              <Area 
                yAxisId="shares"
                type="stepAfter" 
                dataKey="down_shares" 
                stroke="#f43f5e" 
                fill="url(#downGradientImb)" 
                strokeWidth={2}
                name="DOWN Shares"
              />
              {/* Price scatter for each fill */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="up_price"
                stroke="#10b981"
                strokeWidth={0}
                dot={{ r: 3, fill: '#10b981' }}
                connectNulls={false}
                name="UP Price"
              />
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="down_price"
                stroke="#f43f5e"
                strokeWidth={0}
                dot={{ r: 3, fill: '#f43f5e' }}
                connectNulls={false}
                name="DOWN Price"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Unpaired/Imbalance chart */}
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="unpairedGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="time" 
                tick={{ fontSize: 9 }} 
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis 
                tick={{ fontSize: 9 }} 
                tickLine={false}
                axisLine={false}
                domain={[0, 'dataMax + 10']}
                label={{ value: 'Imbalance', angle: -90, position: 'insideLeft', fontSize: 9 }}
              />
              <Tooltip 
                formatter={(value: number) => [value.toFixed(1), 'Unpaired']}
              />
              <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Critical', fontSize: 9, fill: '#ef4444' }} />
              <ReferenceLine y={50} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Warning', fontSize: 9, fill: '#f59e0b' }} />
              <Area 
                type="stepAfter" 
                dataKey="unpaired" 
                stroke="#f59e0b" 
                fill="url(#unpairedGradient)" 
                strokeWidth={2}
                name="Unpaired"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 text-xs justify-center pt-2 border-t">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-emerald-500" />
            <span>UP shares/prices</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-rose-500" />
            <span>DOWN shares/prices</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-warning" />
            <span>Unpaired/Imbalance</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-0 border-t-2 border-dashed border-destructive" />
            <span>Critical threshold</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
