import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  TrendingUp, 
  TrendingDown, 
  Clock,
  Activity,
  AlertTriangle,
  ShieldAlert,
  ShieldX,
  ArrowRightLeft,
  RefreshCw,
  Target,
  CheckCircle2,
  XCircle,
  Zap
} from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Scatter, ComposedChart } from 'recharts';

interface TimelineEntry {
  ts: number;
  iso: string;
  event_type: 'fill' | 'guard' | 'hedge_attempt' | 'hedge_success' | 'hedge_failed' | 'proactive_hedge_attempt' | 'proactive_hedge_success' | 'decision';
  side?: 'UP' | 'DOWN';
  price?: number;
  size?: number;
  guard_type?: string;
  reason?: string;
  up_qty: number;
  down_qty: number;
  unpaired: number;
  combined_cost?: number;
  edge?: number;
}

interface V35FillTimelineProps {
  marketSlug?: string;
  asset?: string;
}

export function V35FillTimeline({ marketSlug, asset }: V35FillTimelineProps) {
  // Fetch fills - use fill_ts for ordering (correct column name)
  const { data: fills, isLoading: fillsLoading } = useQuery({
    queryKey: ['v35-fills-timeline', marketSlug],
    queryFn: async () => {
      let query = supabase
        .from('v35_fills')
        .select('*')
        .order('fill_ts', { ascending: true, nullsFirst: false });
      
      if (marketSlug) {
        query = query.eq('market_slug', marketSlug);
      }
      
      // Limit to last 100 fills if no market specified
      if (!marketSlug) {
        query = query.limit(100);
      }
      
      const { data, error } = await query;
      
      if (error) {
        console.error('[V35FillTimeline] Fills query error:', error);
        throw error;
      }
      return data || [];
    },
  });

  // Fetch bot events (guards, hedges, decisions) for this market
  const { data: botEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['v35-bot-events-timeline', marketSlug],
    queryFn: async () => {
      let query = supabase
        .from('bot_events')
        .select('*')
        .in('event_type', [
          'guard', 
          'hedge_attempt', 
          'hedge_success', 
          'hedge_failed',
          'proactive_hedge_attempt',
          'proactive_hedge_success',
          'hedge_viability'
        ])
        .order('ts', { ascending: true });
      
      if (marketSlug) {
        // Try to match market_id or data->marketSlug
        const marketSuffix = marketSlug.split('-').slice(-1)[0];
        query = query.or(`market_id.ilike.%${marketSuffix}%,data->>marketSlug.ilike.%${marketSuffix}%`);
      }
      
      // Limit to recent events
      query = query.limit(200);
      
      const { data, error } = await query;
      
      if (error) {
        console.error('[V35FillTimeline] Events query error:', error);
        return [];
      }
      return data || [];
    },
  });

  if (fillsLoading || eventsLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Event Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[200px] w-full" />
        </CardContent>
      </Card>
    );
  }

  // Build timeline entries
  const timeline: TimelineEntry[] = [];
  let runningUpQty = 0;
  let runningDownQty = 0;
  let runningUpCost = 0;
  let runningDownCost = 0;

  // Process fills
  for (const fill of fills || []) {
    const side = (fill.side?.toUpperCase() || fill.fill_type?.toUpperCase()) as 'UP' | 'DOWN';
    const size = Number(fill.size) || 0;
    const price = Number(fill.price) || 0;
    const fillTs = fill.fill_ts ? new Date(fill.fill_ts).getTime() : new Date(fill.created_at).getTime();

    if (side === 'UP') {
      runningUpQty += size;
      runningUpCost += size * price;
    } else if (side === 'DOWN') {
      runningDownQty += size;
      runningDownCost += size * price;
    }

    const paired = Math.min(runningUpQty, runningDownQty);
    const avgUp = runningUpQty > 0 ? runningUpCost / runningUpQty : 0;
    const avgDown = runningDownQty > 0 ? runningDownCost / runningDownQty : 0;
    const combinedCost = paired > 0 ? avgUp + avgDown : 0;
    const edge = combinedCost > 0 && combinedCost < 1 ? (1 - combinedCost) * 100 : 0;

    timeline.push({
      ts: fillTs,
      iso: new Date(fillTs).toISOString(),
      event_type: 'fill',
      side,
      price,
      size,
      up_qty: runningUpQty,
      down_qty: runningDownQty,
      unpaired: Math.abs(runningUpQty - runningDownQty),
      combined_cost: combinedCost,
      edge,
    });
  }

  // Add bot events (guards, hedges, decisions)
  for (const event of botEvents || []) {
    const data = event.data as Record<string, unknown> | null;
    const eventType = event.event_type as TimelineEntry['event_type'];
    
    // Extract quantities from event data
    const upQty = (data?.upQty as number) || (data?.up_qty as number) || 0;
    const downQty = (data?.downQty as number) || (data?.down_qty as number) || 0;
    
    timeline.push({
      ts: event.ts,
      iso: new Date(event.ts).toISOString(),
      event_type: eventType,
      guard_type: (data?.guardType as string) || undefined,
      reason: (data?.reason as string) || (data?.blockedSide as string) || event.reason_code || undefined,
      side: (data?.hedge_side as 'UP' | 'DOWN') || (data?.blockedSide as 'UP' | 'DOWN') || undefined,
      price: (data?.hedge_price as number) || (data?.max_price as number) || undefined,
      size: (data?.hedge_qty as number) || (data?.filled_qty as number) || undefined,
      up_qty: upQty,
      down_qty: downQty,
      unpaired: Math.abs(upQty - downQty),
      combined_cost: (data?.combined_cost as number) || (data?.projected_combined as number) || undefined,
      edge: (data?.edge as number) || (data?.projected_edge as number) ? ((data?.edge || data?.projected_edge) as number) * 100 : undefined,
    });
  }

  // Sort by timestamp
  timeline.sort((a, b) => a.ts - b.ts);

  // Prepare chart data
  const chartData = timeline.map((entry, idx) => ({
    idx,
    time: new Date(entry.ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    up: entry.up_qty,
    down: entry.down_qty,
    unpaired: entry.unpaired,
    eventType: entry.event_type,
    isEvent: entry.event_type !== 'fill',
  }));

  const getEventIcon = (entry: TimelineEntry) => {
    switch (entry.event_type) {
      case 'fill':
        return entry.side === 'UP' 
          ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
          : <TrendingDown className="h-3.5 w-3.5 text-rose-500" />;
      case 'guard':
        switch (entry.guard_type) {
          case 'CHEAP_SIDE_SKIP':
            return <ArrowRightLeft className="h-3.5 w-3.5 text-warning" />;
          case 'BURST_CAP':
            return <ShieldAlert className="h-3.5 w-3.5 text-warning" />;
          case 'EMERGENCY_STOP':
            return <ShieldX className="h-3.5 w-3.5 text-destructive" />;
          default:
            return <AlertTriangle className="h-3.5 w-3.5 text-warning" />;
        }
      case 'hedge_attempt':
      case 'proactive_hedge_attempt':
        return <Target className="h-3.5 w-3.5 text-blue-500" />;
      case 'hedge_success':
      case 'proactive_hedge_success':
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'hedge_failed':
        return <XCircle className="h-3.5 w-3.5 text-destructive" />;
      default:
        return <Zap className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const getEventLabel = (entry: TimelineEntry) => {
    switch (entry.event_type) {
      case 'fill':
        return entry.side || 'FILL';
      case 'guard':
        return entry.guard_type || 'GUARD';
      case 'hedge_attempt':
        return 'HEDGE →';
      case 'proactive_hedge_attempt':
        return 'REBAL →';
      case 'hedge_success':
        return 'HEDGE ✓';
      case 'proactive_hedge_success':
        return 'REBAL ✓';
      case 'hedge_failed':
        return 'HEDGE ✗';
      default:
        return entry.event_type.toUpperCase();
    }
  };

  const getEventBadgeClass = (entry: TimelineEntry) => {
    switch (entry.event_type) {
      case 'fill':
        return entry.side === 'UP' 
          ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
          : 'bg-rose-500/10 text-rose-500 border-rose-500/30';
      case 'guard':
        return 'bg-warning/10 text-warning border-warning/30';
      case 'hedge_attempt':
      case 'proactive_hedge_attempt':
        return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
      case 'hedge_success':
      case 'proactive_hedge_success':
        return 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30';
      case 'hedge_failed':
        return 'bg-destructive/10 text-destructive border-destructive/30';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const fillCount = timeline.filter(e => e.event_type === 'fill').length;
  const eventCount = timeline.filter(e => e.event_type !== 'fill').length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Chronologische Timeline
        </CardTitle>
        <CardDescription className="flex items-center gap-4">
          <span>{fillCount} fills</span>
          <span>{eventCount} events/decisions</span>
          {marketSlug && <span className="font-mono text-xs">{marketSlug}</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Chart */}
        {chartData.length > 0 && (
          <div className="h-[200px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }} syncId="v35-market-sync">
                <defs>
                  <linearGradient id="upGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="downGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="time" 
                  tick={{ fontSize: 10 }} 
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  tick={{ fontSize: 10 }} 
                  tickLine={false}
                  axisLine={false}
                  domain={[0, 'dataMax + 10']}
                />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const data = payload[0].payload;
                    return (
                      <div className="bg-popover border rounded-lg p-3 shadow-lg text-sm">
                        <div className="font-medium mb-1">{data.time}</div>
                        <div className="text-xs text-muted-foreground mb-2">{data.eventType}</div>
                        <div className="flex items-center gap-2 text-emerald-500">
                          <TrendingUp className="h-3 w-3" />
                          UP: {data.up?.toFixed(1) || 0}
                        </div>
                        <div className="flex items-center gap-2 text-rose-500">
                          <TrendingDown className="h-3 w-3" />
                          DOWN: {data.down?.toFixed(1) || 0}
                        </div>
                        <div className="flex items-center gap-2 text-warning mt-1 pt-1 border-t">
                          <AlertTriangle className="h-3 w-3" />
                          Unpaired: {data.unpaired?.toFixed(1) || 0}
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Max 20', fontSize: 10, fill: '#ef4444' }} />
                <ReferenceLine y={15} stroke="#f59e0b" strokeDasharray="3 3" label={{ value: 'Crit 15', fontSize: 10, fill: '#f59e0b' }} />
                <ReferenceLine y={10} stroke="#3b82f6" strokeDasharray="3 3" label={{ value: 'Warn 10', fontSize: 10, fill: '#3b82f6' }} />
                <Area 
                  type="stepAfter" 
                  dataKey="up" 
                  stroke="#10b981" 
                  fill="url(#upGradient)" 
                  strokeWidth={2}
                  name="UP"
                />
                <Area 
                  type="stepAfter" 
                  dataKey="down" 
                  stroke="#f43f5e" 
                  fill="url(#downGradient)" 
                  strokeWidth={2}
                  name="DOWN"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Table */}
        {timeline.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Geen events gevonden</p>
            <p className="text-xs mt-1">Wacht op fills of beslissingen van de runner</p>
          </div>
        ) : (
          <div className="max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[90px]">Tijd</TableHead>
                  <TableHead className="w-[120px]">Event</TableHead>
                  <TableHead className="text-right">Size</TableHead>
                  <TableHead className="text-right">Prijs</TableHead>
                  <TableHead className="text-right">UP</TableHead>
                  <TableHead className="text-right">DOWN</TableHead>
                  <TableHead className="text-right">Gap</TableHead>
                  <TableHead className="w-[180px]">Details</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {timeline.slice().reverse().map((entry, idx) => (
                  <TableRow 
                    key={idx}
                    className={
                      entry.event_type === 'guard' ? 'bg-warning/5' :
                      entry.event_type === 'hedge_failed' ? 'bg-destructive/5' :
                      entry.event_type.includes('success') ? 'bg-emerald-500/5' :
                      entry.event_type.includes('attempt') ? 'bg-blue-500/5' :
                      ''
                    }
                  >
                    <TableCell className="font-mono text-xs">
                      {new Date(entry.ts).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant="outline" 
                        className={getEventBadgeClass(entry)}
                      >
                        {getEventIcon(entry)}
                        <span className="ml-1">{getEventLabel(entry)}</span>
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.size ? entry.size.toFixed(1) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.price ? `${(entry.price * 100).toFixed(1)}¢` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-emerald-500">
                      {entry.up_qty > 0 ? entry.up_qty.toFixed(1) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-rose-500">
                      {entry.down_qty > 0 ? entry.down_qty.toFixed(1) : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {entry.unpaired > 0 ? (
                        <span className={`font-mono font-bold ${
                          entry.unpaired >= 20 ? 'text-destructive' :
                          entry.unpaired >= 15 ? 'text-destructive' :
                          entry.unpaired >= 10 ? 'text-warning' : ''
                        }`}>
                          {entry.unpaired.toFixed(1)}
                        </span>
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground truncate max-w-[180px]" title={entry.reason || entry.guard_type || ''}>
                      {entry.edge ? `Edge: ${entry.edge.toFixed(1)}%` : ''}
                      {entry.combined_cost ? ` CC: $${entry.combined_cost.toFixed(3)}` : ''}
                      {entry.reason ? ` ${entry.reason.slice(0, 30)}` : ''}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
