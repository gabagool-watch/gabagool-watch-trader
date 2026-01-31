import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { Layers, RefreshCw, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { format } from 'date-fns';

interface PairEvent {
  id: string;
  pairId: string;
  asset: string;
  marketSlug: string;
  takerSide: string;
  takerPrice: number;
  takerSize: number;
  takerStatus: 'pending' | 'filled' | 'failed' | 'blocked';
  makerSide: string;
  makerPrice: number;
  makerSize: number;
  makerStatus: 'pending' | 'open' | 'filled' | 'failed' | 'blocked';
  cpp?: number;
  pnl?: number;
  createdAt: number;
  updatedAt: number;
}

const DEFAULT_LIMIT = 50;

export function V35PairLog() {
  const [pairs, setPairs] = useState<PairEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchPairs = async () => {
    setIsLoading(true);
    
    try {
      // Fetch pair-related events from bot_events
      const { data, error } = await supabase
        .from('bot_events')
        .select('*')
        .in('event_type', ['pair_opened', 'pair_taker_filled', 'pair_maker_placed', 'pair_maker_filled', 'pair_hedged', 'pair_emergency', 'pair_blocked'])
        .order('ts', { ascending: false })
        .limit(200);

      if (error) {
        console.error('[V35PairLog] Failed to fetch:', error);
        return;
      }

      // Group events by pair_id
      const pairMap = new Map<string, PairEvent>();
      
      for (const event of data || []) {
        const eventData = event.data as Record<string, unknown> | null;
        const pairId = eventData?.pair_id as string || eventData?.pairId as string;
        
        if (!pairId) continue;
        
        if (!pairMap.has(pairId)) {
          pairMap.set(pairId, {
            id: event.id,
            pairId,
            asset: event.asset,
            marketSlug: event.market_id || '',
            takerSide: eventData?.taker_side as string || eventData?.takerSide as string || 'UP',
            takerPrice: (eventData?.taker_price as number) || (eventData?.takerPrice as number) || 0,
            takerSize: (eventData?.taker_size as number) || (eventData?.takerSize as number) || 0,
            takerStatus: 'pending',
            makerSide: eventData?.maker_side as string || eventData?.makerSide as string || 'DOWN',
            makerPrice: (eventData?.maker_price as number) || (eventData?.makerPrice as number) || 0,
            makerSize: (eventData?.maker_size as number) || (eventData?.makerSize as number) || 0,
            makerStatus: 'pending',
            createdAt: event.ts,
            updatedAt: event.ts,
          });
        }
        
        const pair = pairMap.get(pairId)!;
        
        // Update pair based on event type
        switch (event.event_type) {
          case 'pair_opened':
          case 'pair_taker_filled':
            pair.takerStatus = 'filled';
            pair.takerPrice = (eventData?.fill_price as number) || (eventData?.fillPrice as number) || pair.takerPrice;
            pair.takerSize = (eventData?.fill_size as number) || (eventData?.fillSize as number) || pair.takerSize;
            break;
          case 'pair_maker_placed':
            pair.makerStatus = 'open';
            pair.makerPrice = (eventData?.maker_price as number) || (eventData?.makerPrice as number) || pair.makerPrice;
            break;
          case 'pair_maker_filled':
          case 'pair_hedged':
            pair.makerStatus = 'filled';
            pair.makerPrice = (eventData?.fill_price as number) || (eventData?.fillPrice as number) || pair.makerPrice;
            pair.makerSize = (eventData?.fill_size as number) || (eventData?.fillSize as number) || pair.makerSize;
            pair.cpp = (eventData?.cpp as number) || (eventData?.combined_cost as number);
            pair.pnl = (eventData?.pnl as number);
            break;
          case 'pair_emergency':
            pair.makerStatus = 'filled';
            pair.cpp = (eventData?.cpp as number);
            break;
          case 'pair_blocked':
            pair.takerStatus = 'blocked';
            pair.makerStatus = 'blocked';
            break;
        }
        
        pair.updatedAt = Math.max(pair.updatedAt, event.ts);
      }
      
      // Convert to array and sort by creation time
      const pairList = Array.from(pairMap.values())
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, DEFAULT_LIMIT);
      
      setPairs(pairList);
    } catch (err) {
      console.error('[V35PairLog] Error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPairs();
    
    // Subscribe to realtime updates
    const channel = supabase
      .channel('v35-pairs-realtime')
      .on(
        'postgres_changes',
        { 
          event: 'INSERT', 
          schema: 'public', 
          table: 'bot_events',
        },
        (payload) => {
          const event = payload.new as Record<string, unknown>;
          const eventType = event.event_type as string;
          
          if (['pair_opened', 'pair_taker_filled', 'pair_maker_placed', 'pair_maker_filled', 'pair_hedged', 'pair_emergency', 'pair_blocked'].includes(eventType)) {
            fetchPairs();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'filled':
        return <Badge className="bg-emerald-500/20 text-emerald-400 text-[10px] px-1">FILLED</Badge>;
      case 'open':
        return <Badge className="bg-amber-500/20 text-amber-400 text-[10px] px-1">OPEN</Badge>;
      case 'pending':
        return <Badge className="bg-slate-500/20 text-slate-400 text-[10px] px-1">PENDING</Badge>;
      case 'failed':
        return <Badge className="bg-red-500/20 text-red-400 text-[10px] px-1">FAILED</Badge>;
      case 'blocked':
        return <Badge className="bg-red-500/20 text-red-400 text-[10px] px-1">BLOCKED</Badge>;
      default:
        return <Badge className="bg-slate-500/20 text-slate-400 text-[10px] px-1">{status.toUpperCase()}</Badge>;
    }
  };

  const getPairStatusIcon = (pair: PairEvent) => {
    if (pair.takerStatus === 'blocked' || pair.makerStatus === 'blocked') {
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    }
    if (pair.takerStatus === 'filled' && pair.makerStatus === 'filled') {
      return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
    }
    if (pair.makerStatus === 'open') {
      return <Clock className="h-4 w-4 text-amber-400" />;
    }
    if (pair.takerStatus === 'failed' || pair.makerStatus === 'failed') {
      return <AlertTriangle className="h-4 w-4 text-red-400" />;
    }
    return <Clock className="h-4 w-4 text-slate-400" />;
  };

  const formatShortPairId = (pairId: string) => {
    // Extract counter from pair_1234567890_1 → #1
    const match = pairId.match(/_(\d+)$/);
    return match ? `#${match[1]}` : pairId.slice(0, 8);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Pair Tracker
            <Badge variant="outline" className="text-xs">
              {pairs.length} pairs
            </Badge>
          </CardTitle>
          
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchPairs}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <ScrollArea className="h-[400px]">
          <div className="p-2 space-y-1 font-mono text-xs">
            {pairs.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                No pairs yet. Start the V36 runner to see trades.
              </div>
            ) : (
              pairs.map((pair) => (
                <div 
                  key={pair.pairId}
                  className="flex flex-col gap-1 p-2 rounded bg-muted/30 hover:bg-muted/50 border border-border/50"
                >
                  {/* Header row with pair ID and status */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getPairStatusIcon(pair)}
                      <span className="font-bold text-primary">
                        {formatShortPairId(pair.pairId)}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1">
                        {pair.asset}
                      </Badge>
                      <span className="text-muted-foreground">
                        {format(new Date(pair.createdAt), 'HH:mm:ss')}
                      </span>
                    </div>
                    
                    {pair.cpp && (
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">CPP:</span>
                        <span className={pair.cpp < 1 ? 'text-emerald-400' : 'text-red-400'}>
                          ${pair.cpp.toFixed(3)}
                        </span>
                        {pair.pnl !== undefined && (
                          <span className={pair.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            ({pair.pnl >= 0 ? '+' : ''}{pair.pnl.toFixed(2)}%)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  
                  {/* Trade details row */}
                  <div className="flex items-center gap-3 text-[11px] pl-6">
                    {/* Taker side */}
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">TAKER:</span>
                      <span className={pair.takerSide === 'UP' ? 'text-cyan-400' : 'text-orange-400'}>
                        {pair.takerSize.toFixed(0)} {pair.takerSide}
                      </span>
                      <span className="text-muted-foreground">@</span>
                      <span>${pair.takerPrice.toFixed(2)}</span>
                      {getStatusBadge(pair.takerStatus)}
                    </div>
                    
                    <span className="text-muted-foreground">v</span>
                    
                    {/* Maker side */}
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground">MAKER:</span>
                      <span className={pair.makerSide === 'UP' ? 'text-cyan-400' : 'text-orange-400'}>
                        {pair.makerSize.toFixed(0)} {pair.makerSide}
                      </span>
                      <span className="text-muted-foreground">@</span>
                      <span>${pair.makerPrice.toFixed(2)}</span>
                      {getStatusBadge(pair.makerStatus)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
