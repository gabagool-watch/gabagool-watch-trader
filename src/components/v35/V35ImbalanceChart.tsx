import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line } from 'recharts';
import { Activity, DollarSign, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface InventoryDataPoint {
  ts: number;
  time: string;
  up_shares: number;
  down_shares: number;
  avg_up_cost: number | null;
  avg_down_cost: number | null;
  pair_cost: number | null;
  state: string;
  unpaired: number;
}

interface V35ImbalanceChartProps {
  inventorySnapshots: Array<{
    ts: number;
    up_shares: number;
    down_shares: number;
    avg_up_cost?: number | null;
    avg_down_cost?: number | null;
    pair_cost?: number | null;
    state: string;
  }>;
  marketSlug: string;
  winner?: 'UP' | 'DOWN';
  groundTruth?: {
    api_up_qty: number;
    api_down_qty: number;
    total_cost: number;
    predicted_pnl: number;
  };
  // Legacy props for backwards compatibility
  fills?: Array<{
    ts: number;
    side: string;
    outcome: string;
    fill_price: number;
    fill_qty: number;
  }>;
  // Sync ID for synchronized tooltips across charts
  syncId?: string;
  // Start timestamp for synchronized time axis (from parent)
  startTs?: number;
}

export function V35ImbalanceChart({ inventorySnapshots, marketSlug, winner, groundTruth, fills, syncId, startTs: externalStartTs }: V35ImbalanceChartProps) {
  const chartData = useMemo(() => {
    // Use inventory snapshots as the primary data source (reliable position state)
    if (!inventorySnapshots || inventorySnapshots.length === 0) {
      // Fallback: if no inventory data but we have fills, show a warning
      if (fills && fills.length > 0) {
        return { data: [], warning: 'Geen inventory snapshots - fills data kan onbetrouwbaar zijn' };
      }
      return { data: [], warning: null };
    }

    // Sort by timestamp
    const sortedSnapshots = [...inventorySnapshots].sort((a, b) => a.ts - b.ts);
    
    // Use external startTs if provided (for synchronized time axis), otherwise calculate from first snapshot
    const firstTs = sortedSnapshots[0].ts;
    // If externalStartTs is provided, use it. Otherwise round down to nearest 15 minutes
    const windowStartMs = externalStartTs ?? Math.floor(firstTs / (15 * 60 * 1000)) * (15 * 60 * 1000);
    
    // Cap by final API quantities when available.
    // Some historical snapshot rows contain reconciliation outliers (thousands of shares)
    // that do NOT match the final verified holdings.
    const capUp = Number.isFinite(groundTruth?.api_up_qty as number)
      ? (groundTruth!.api_up_qty ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;
    const capDown = Number.isFinite(groundTruth?.api_down_qty as number)
      ? (groundTruth!.api_down_qty ?? Number.POSITIVE_INFINITY)
      : Number.POSITIVE_INFINITY;

    let outlierCount = 0;

    // Track running maximum to ensure monotonic increase
    // The bot only buys, so shares should never decrease
    // Decreases in inventory_snapshots are from API reconciliation, not actual sells
    let runningMaxUp = 0;
    let runningMaxDown = 0;
    
    const data: InventoryDataPoint[] = sortedSnapshots.map(snapshot => {
      const rawUp = snapshot.up_shares || 0;
      const rawDown = snapshot.down_shares || 0;
      
      // Detect outliers vs ground truth (when present)
      if (rawUp > capUp + 0.0001 || rawDown > capDown + 0.0001) outlierCount += 1;

      // Use running maximum to ensure monotonic increase
      // This filters out API reconciliation dips, and clamping removes reconciliation outliers.
      runningMaxUp = Math.min(capUp, Math.max(runningMaxUp, rawUp));
      runningMaxDown = Math.min(capDown, Math.max(runningMaxDown, rawDown));
      
      // Calculate elapsed time within the 15-minute window
      const elapsedMs = snapshot.ts - windowStartMs;
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
      const timeLabel = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
      
      return {
        ts: snapshot.ts,
        time: timeLabel,
        up_shares: runningMaxUp,
        down_shares: runningMaxDown,
        avg_up_cost: snapshot.avg_up_cost,
        avg_down_cost: snapshot.avg_down_cost,
        pair_cost: snapshot.pair_cost,
        state: snapshot.state,
        unpaired: Math.abs(runningMaxUp - runningMaxDown),
      };
    });

    const warning = outlierCount > 0
      ? `⚠️ ${outlierCount} outlier snapshots gekapt naar API-eindstand`
      : null;

    return { data, warning };
  }, [inventorySnapshots, fills, groundTruth, externalStartTs]);

  // Calculate stats from inventory data
  const stats = useMemo(() => {
    if (chartData.data.length === 0) return null;
    
    const finalState = chartData.data[chartData.data.length - 1];
    const maxUnpaired = Math.max(...chartData.data.map(d => d.unpaired));
    const paired = Math.min(finalState.up_shares, finalState.down_shares);
    
    // Use ground truth if available (from Polymarket API)
    const finalUp = groundTruth?.api_up_qty ?? finalState.up_shares;
    const finalDown = groundTruth?.api_down_qty ?? finalState.down_shares;
    const totalCost = groundTruth?.total_cost ?? 
      ((finalState.avg_up_cost || 0) * finalState.up_shares + 
       (finalState.avg_down_cost || 0) * finalState.down_shares);
    
    // Calculate PnL
    let pnl = groundTruth?.predicted_pnl ?? 0;
    if (!groundTruth && winner) {
      const winningShares = winner === 'UP' ? finalUp : finalDown;
      pnl = (winningShares * 1.0) - totalCost;
    }
    
    // CPP from final state or calculate
    const cpp = finalState.pair_cost ?? 
      ((finalState.avg_up_cost || 0) + (finalState.avg_down_cost || 0));
    
    const bias = finalUp > finalDown ? 'UP' : 'DOWN';
    
    return {
      finalUp,
      finalDown,
      finalUnpaired: Math.abs(finalUp - finalDown),
      maxUnpaired,
      paired,
      totalSnapshots: chartData.data.length,
      avgUpCost: finalState.avg_up_cost,
      avgDownCost: finalState.avg_down_cost,
      cpp,
      totalCost,
      pnl,
      bias,
      hasGroundTruth: !!groundTruth,
    };
  }, [chartData.data, winner, groundTruth]);

  // State color helper
  const getStateColor = (state: string) => {
    switch (state) {
      case 'CRITICAL': return 'text-destructive';
      case 'WARNING': return 'text-warning';
      case 'BALANCED': return 'text-emerald-500';
      default: return 'text-muted-foreground';
    }
  };

  if (chartData.data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Position Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-warning" />
          <p className="text-muted-foreground">
            {chartData.warning || 'Geen inventory snapshots beschikbaar voor deze market'}
          </p>
          {fills && fills.length > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              ⚠️ {fills.length} fills gevonden, maar deze data kan onbetrouwbaar zijn
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4" />
          Position Timeline (Inventory Snapshots)
        </CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs">{marketSlug.slice(-35)}</span>
          {winner && (
            <Badge variant={winner === stats?.bias ? 'default' : 'destructive'} className="text-xs">
              Winner: {winner}
            </Badge>
          )}
          {stats?.hasGroundTruth && (
            <Badge variant="outline" className="text-xs bg-emerald-500/10">
              ✓ API Verified
            </Badge>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-emerald-500" />
                Final UP
              </div>
              <div className="font-bold text-emerald-500">{stats.finalUp.toFixed(1)} shares</div>
              {stats.avgUpCost && (
                <div className="text-muted-foreground">
                  Avg: ${stats.avgUpCost.toFixed(3)}
                </div>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-rose-500" />
                Final DOWN
              </div>
              <div className="font-bold text-rose-500">{stats.finalDown.toFixed(1)} shares</div>
              {stats.avgDownCost && (
                <div className="text-muted-foreground">
                  Avg: ${stats.avgDownCost.toFixed(3)}
                </div>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Paired / CPP</div>
              <div className="font-bold">{stats.paired.toFixed(1)} pairs</div>
              <div className={`text-muted-foreground ${stats.cpp < 1 ? 'text-emerald-500' : 'text-rose-500'}`}>
                CPP: ${stats.cpp.toFixed(3)}
              </div>
            </div>
            <div className={`rounded-lg p-2 ${stats.pnl >= 0 ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`}>
              <div className="text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                P&L {winner ? `(${winner})` : '(predicted)'}
              </div>
              <div className={`font-bold text-lg ${stats.pnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                {stats.pnl >= 0 ? '+' : ''}${stats.pnl.toFixed(2)}
              </div>
              <div className="text-muted-foreground text-[10px]">
                Cost: ${stats.totalCost.toFixed(2)}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-2">
              <div className="text-muted-foreground">Imbalance</div>
              <div className={`font-bold ${stats.maxUnpaired >= 100 ? 'text-destructive' : stats.maxUnpaired >= 50 ? 'text-warning' : ''}`}>
                {stats.finalUnpaired.toFixed(1)} unpaired
              </div>
              <div className="text-muted-foreground">
                Max: {stats.maxUnpaired.toFixed(1)} | {stats.totalSnapshots} pts
              </div>
            </div>
          </div>
        )}

        {/* Main chart: UP vs DOWN shares over time */}
        <div className="h-[250px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData.data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} syncId={syncId}>
              <defs>
                <linearGradient id="upGradientInv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="downGradientInv" x1="0" y1="0" x2="0" y2="1">
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
                yAxisId="cost"
                orientation="right"
                tick={{ fontSize: 10 }} 
                tickLine={false}
                axisLine={false}
                domain={[0, 1.5]}
                tickFormatter={(v) => `$${v.toFixed(2)}`}
              />
              <Tooltip 
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const data = payload[0].payload as InventoryDataPoint;
                  return (
                    <div className="bg-popover border rounded-lg p-3 shadow-lg text-xs">
                      <div className="font-medium mb-1">{data.time}</div>
                      <Badge variant="outline" className={getStateColor(data.state)}>
                        {data.state}
                      </Badge>
                      <div className="space-y-1 pt-2 mt-2 border-t">
                        <div className="flex justify-between gap-4">
                          <span className="text-emerald-500">UP:</span>
                          <span className="font-mono">{data.up_shares.toFixed(1)} @ ${(data.avg_up_cost || 0).toFixed(3)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-rose-500">DOWN:</span>
                          <span className="font-mono">{data.down_shares.toFixed(1)} @ ${(data.avg_down_cost || 0).toFixed(3)}</span>
                        </div>
                        {data.pair_cost !== null && (
                          <div className="flex justify-between gap-4 pt-1 border-t">
                            <span>CPP:</span>
                            <span className={`font-mono font-bold ${data.pair_cost < 1 ? 'text-emerald-500' : 'text-rose-500'}`}>
                              ${data.pair_cost.toFixed(3)}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between gap-4">
                          <span className="text-warning">Unpaired:</span>
                          <span className={`font-mono ${data.unpaired >= 100 ? 'text-destructive font-bold' : ''}`}>
                            {data.unpaired.toFixed(1)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                }}
              />
              
              <Area 
                yAxisId="shares"
                type="stepAfter" 
                dataKey="up_shares" 
                stroke="#10b981" 
                fill="url(#upGradientInv)" 
                strokeWidth={2}
                name="UP Shares"
              />
              <Area 
                yAxisId="shares"
                type="stepAfter" 
                dataKey="down_shares" 
                stroke="#f43f5e" 
                fill="url(#downGradientInv)" 
                strokeWidth={2}
                name="DOWN Shares"
              />
              {/* CPP line */}
              <Line
                yAxisId="cost"
                type="stepAfter"
                dataKey="pair_cost"
                stroke="#8b5cf6"
                strokeWidth={2}
                dot={false}
                name="CPP"
                connectNulls
              />
              {/* Reference line for CPP = 1.00 (breakeven) */}
              <ReferenceLine yAxisId="cost" y={1} stroke="#8b5cf6" strokeDasharray="3 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Unpaired/Imbalance chart */}
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData.data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }} syncId={syncId}>
              <defs>
                <linearGradient id="unpairedGradientInv" x1="0" y1="0" x2="0" y2="1">
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
                fill="url(#unpairedGradientInv)" 
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
            <span>UP shares</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-rose-500" />
            <span>DOWN shares</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-violet-500" />
            <span>CPP (cost per pair)</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-warning" />
            <span>Imbalance</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 h-0 border-t-2 border-dashed border-violet-500" />
            <span>CPP = $1.00</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
