import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { Timer, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PairTiming {
  pairId: string;
  takerFilledTs: number;
  makerFilledTs: number | null;
  fillTimeMs: number | null;
  status: 'hedged' | 'waiting' | 'blocked';
}

interface TimeBucket {
  range: string;
  count: number;
  percentage: number;
  pairIds: string[];
}

export function V35PairFillTimeTable() {
  const [pairTimings, setPairTimings] = useState<PairTiming[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPairTimings = async () => {
    setIsLoading(true);
    
    try {
      const { data, error } = await supabase
        .from('bot_events')
        .select('*')
        .in('event_type', ['pair_taker_filled', 'pair_hedged', 'pair_maker_placed', 'pair_blocked'])
        .order('ts', { ascending: false })
        .limit(500);

      if (error) {
        console.error('[V35PairFillTimeTable] Failed to fetch:', error);
        return;
      }

      // Group events by pair_id
      const pairMap = new Map<string, { takerTs?: number; hedgedTs?: number; status: 'hedged' | 'waiting' | 'blocked' }>();
      
      for (const event of data || []) {
        const eventData = event.data as Record<string, unknown> | null;
        const pairId = eventData?.pair_id as string;
        
        if (!pairId || pairId.startsWith('blocked_')) continue;
        
        if (!pairMap.has(pairId)) {
          pairMap.set(pairId, { status: 'waiting' });
        }
        
        const pair = pairMap.get(pairId)!;
        
        if (event.event_type === 'pair_taker_filled') {
          pair.takerTs = event.ts;
        } else if (event.event_type === 'pair_hedged') {
          pair.hedgedTs = event.ts;
          pair.status = 'hedged';
        } else if (event.event_type === 'pair_blocked') {
          pair.status = 'blocked';
        }
      }
      
      // Convert to array with timing calculations
      const timings: PairTiming[] = [];
      
      for (const [pairId, pair] of pairMap.entries()) {
        if (pair.takerTs) {
          const fillTimeMs = pair.hedgedTs ? pair.hedgedTs - pair.takerTs : null;
          timings.push({
            pairId,
            takerFilledTs: pair.takerTs,
            makerFilledTs: pair.hedgedTs || null,
            fillTimeMs,
            status: pair.status,
          });
        }
      }
      
      // Sort by taker fill time (newest first)
      timings.sort((a, b) => b.takerFilledTs - a.takerFilledTs);
      
      setPairTimings(timings);
    } catch (err) {
      console.error('[V35PairFillTimeTable] Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPairTimings();
  }, []);

  // Calculate time buckets
  const timeBuckets = useMemo(() => {
    const hedgedPairs = pairTimings.filter(p => p.status === 'hedged' && p.fillTimeMs !== null);
    const total = hedgedPairs.length;
    
    if (total === 0) return [];
    
    const buckets: { min: number; max: number; label: string }[] = [
      { min: 0, max: 1000, label: '< 1s' },
      { min: 1000, max: 2000, label: '1-2s' },
      { min: 2000, max: 3000, label: '2-3s' },
      { min: 3000, max: 5000, label: '3-5s' },
      { min: 5000, max: 10000, label: '5-10s' },
      { min: 10000, max: 30000, label: '10-30s' },
      { min: 30000, max: 60000, label: '30-60s' },
      { min: 60000, max: 120000, label: '1-2m' },
      { min: 120000, max: 300000, label: '2-5m' },
      { min: 300000, max: Infinity, label: '> 5m' },
    ];
    
    const result: TimeBucket[] = [];
    
    for (const bucket of buckets) {
      const matchingPairs = hedgedPairs.filter(
        p => p.fillTimeMs! >= bucket.min && p.fillTimeMs! < bucket.max
      );
      
      if (matchingPairs.length > 0) {
        result.push({
          range: bucket.label,
          count: matchingPairs.length,
          percentage: (matchingPairs.length / total) * 100,
          pairIds: matchingPairs.map(p => p.pairId),
        });
      }
    }
    
    return result;
  }, [pairTimings]);

  // Summary stats
  const stats = useMemo(() => {
    const hedgedPairs = pairTimings.filter(p => p.status === 'hedged' && p.fillTimeMs !== null);
    const waitingPairs = pairTimings.filter(p => p.status === 'waiting');
    
    if (hedgedPairs.length === 0) {
      return {
        avgFillTime: 0,
        medianFillTime: 0,
        minFillTime: 0,
        maxFillTime: 0,
        hedgedCount: 0,
        waitingCount: waitingPairs.length,
      };
    }
    
    const fillTimes = hedgedPairs.map(p => p.fillTimeMs!).sort((a, b) => a - b);
    const sum = fillTimes.reduce((acc, t) => acc + t, 0);
    const median = fillTimes[Math.floor(fillTimes.length / 2)];
    
    return {
      avgFillTime: sum / fillTimes.length,
      medianFillTime: median,
      minFillTime: fillTimes[0],
      maxFillTime: fillTimes[fillTimes.length - 1],
      hedgedCount: hedgedPairs.length,
      waitingCount: waitingPairs.length,
    };
  }, [pairTimings]);

  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Timer className="h-5 w-5" />
            Maker Fill Time Distribution
            <Badge variant="outline" className="text-xs">
              {stats.hedgedCount} hedged
            </Badge>
            {stats.waitingCount > 0 && (
              <Badge className="bg-amber-500/20 text-amber-400 text-xs">
                {stats.waitingCount} waiting
              </Badge>
            )}
          </CardTitle>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchPairTimings}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2 text-xs font-mono">
          <div className="bg-muted/30 p-2 rounded">
            <div className="text-muted-foreground">Avg</div>
            <div className="text-primary font-bold">{formatTime(stats.avgFillTime)}</div>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <div className="text-muted-foreground">Median</div>
            <div className="text-primary font-bold">{formatTime(stats.medianFillTime)}</div>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <div className="text-muted-foreground">Min</div>
            <div className="text-emerald-400 font-bold">{formatTime(stats.minFillTime)}</div>
          </div>
          <div className="bg-muted/30 p-2 rounded">
            <div className="text-muted-foreground">Max</div>
            <div className="text-amber-400 font-bold">{formatTime(stats.maxFillTime)}</div>
          </div>
        </div>
        
        {/* Time distribution table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Time</TableHead>
              <TableHead className="w-16 text-right">Count</TableHead>
              <TableHead className="w-20 text-right">%</TableHead>
              <TableHead>Distribution</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {timeBuckets.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  No completed pairs yet
                </TableCell>
              </TableRow>
            ) : (
              timeBuckets.map((bucket) => (
                <TableRow key={bucket.range}>
                  <TableCell className="font-mono text-xs">{bucket.range}</TableCell>
                  <TableCell className="text-right font-mono text-xs">{bucket.count}</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    {bucket.percentage.toFixed(1)}%
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div 
                        className="h-4 bg-primary/60 rounded"
                        style={{ width: `${Math.max(bucket.percentage, 2)}%` }}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
