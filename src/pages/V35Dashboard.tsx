import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useV35Realtime } from '@/hooks/useV35Realtime';
import { useIsMobile } from '@/hooks/use-mobile';
import { MainNav } from '@/components/MainNav';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { V35LogViewer, V35FillsTable, V35ExportButton, V35StrategyPDFExport, V35OpenPositions, V35LivePriceHeader, V35DecisionLog, V35ExpirySnapshots, V35MarketPnLTable, V35PairLog, V35PairFillTimeTable, V35AnalysisExport } from '@/components/v35';
import { toast } from 'sonner';
import { 
  Activity, 
  TrendingUp, 
  DollarSign, 
  BarChart3, 
  Clock, 
  Zap,
  Target,
  Scale,
  CircleDot,
  CheckCircle2,
  XCircle,
  ScrollText,
  Power,
  AlertTriangle,
  Brain,
  ChevronDown,
  Layers
} from 'lucide-react';

interface RunnerHeartbeat {
  id: string;
  runner_id: string;
  runner_type: string;
  last_heartbeat: string;
  status: string;
  markets_count: number;
  positions_count: number;
  trades_count?: number;
  version?: string;
  mode?: string;
  dry_run?: boolean;
  balance?: number;
  total_locked_profit?: number;
  total_unpaired?: number;
  metadata?: {
    mode?: string;
    dry_run?: boolean;
    locked_profit?: number;
  };
}

interface V35Settlement {
  id: string;
  market_slug: string;
  asset: string;
  paired: number;
  combined_cost: number;
  locked_profit: number;
  pnl: number;
  created_at: string;
}

const TAB_OPTIONS = [
  { value: 'pairs', label: 'Pairs', icon: Layers },
  { value: 'pnl', label: 'P&L', icon: DollarSign },
  { value: 'decisions', label: 'Decisions', icon: Brain },
  { value: 'positions', label: 'Positions', icon: Scale },
  { value: 'snapshots', label: 'Expiry Snapshots', icon: Clock },
  { value: 'overview', label: 'Overview', icon: BarChart3 },
  { value: 'logs', label: 'Event Log', icon: ScrollText },
  { value: 'fills', label: 'Fills', icon: Zap },
];

export default function V35Dashboard() {
  const [isOnline, setIsOnline] = useState(false);
  const [lastSeen, setLastSeen] = useState<Date | null>(null);
  const [activeTab, setActiveTab] = useState('pairs');
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Enable realtime subscriptions
  useV35Realtime();

  // Fetch bot config (strategy_enabled)
  const { data: botConfig } = useQuery({
    queryKey: ['bot-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_config')
        .select('strategy_enabled')
        .eq('id', '00000000-0000-0000-0000-000000000001')
        .maybeSingle();
      
      if (error) return { strategy_enabled: false };
      return data ?? { strategy_enabled: false };
    },
    refetchInterval: 5000,
  });

  // Kill switch mutation
  const killMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from('bot_config')
        .update({ strategy_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', '00000000-0000-0000-0000-000000000001');
      
      if (error) throw error;
      return enabled;
    },
    onSuccess: (enabled) => {
      queryClient.invalidateQueries({ queryKey: ['bot-config'] });
      if (enabled) {
        toast.success('Bot geactiveerd', { description: 'Strategy is nu actief' });
      } else {
        toast.warning('Bot gestopt!', { description: 'Alle orders worden geannuleerd' });
      }
    },
    onError: (error) => {
      toast.error('Kill switch mislukt', { description: String(error) });
    },
  });

  const isStrategyEnabled = botConfig?.strategy_enabled ?? false;

  // Fetch runner heartbeat
  const { data: heartbeat } = useQuery({
    queryKey: ['v35-heartbeat'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('runner_heartbeats')
        .select('*')
        .eq('runner_type', 'v35')
        .order('last_heartbeat', { ascending: false })
        .limit(1)
        .single();
      
      if (error) return null;
      return data as unknown as RunnerHeartbeat;
    },
    refetchInterval: 5000,
  });

  // Fetch recent settlements
  const { data: settlements } = useQuery({
    queryKey: ['v35-settlements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v35_settlements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      
      if (error) return [];
      return data as V35Settlement[];
    },
    refetchInterval: 30000,
  });

  // Check if runner is online
  useEffect(() => {
    if (heartbeat?.last_heartbeat) {
      const lastHb = new Date(heartbeat.last_heartbeat);
      setLastSeen(lastHb);
      const diffMs = Date.now() - lastHb.getTime();
      setIsOnline(diffMs < 30000); // Online if heartbeat < 30s ago
    }
  }, [heartbeat]);

  const totalPnL = settlements?.reduce((sum, s) => sum + (s.pnl || 0), 0) || 0;
  const totalPaired = settlements?.reduce((sum, s) => sum + (s.paired || 0), 0) || 0;
  const avgCombinedCost = settlements?.length 
    ? settlements.reduce((sum, s) => sum + (s.combined_cost || 0), 0) / settlements.length 
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center">
          <MainNav />
        </div>
      </header>

      <main className="container py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">V35 Market Maker</h1>
            <p className="text-muted-foreground">
              Passive Dual-Outcome Strategy for 15-min Options
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Kill Switch */}
            <Button
              variant={isStrategyEnabled ? "destructive" : "default"}
              size="sm"
              onClick={() => killMutation.mutate(!isStrategyEnabled)}
              disabled={killMutation.isPending}
              className={isStrategyEnabled ? "bg-destructive hover:bg-destructive/90" : "bg-primary hover:bg-primary/90"}
            >
              {killMutation.isPending ? (
                <Activity className="w-4 h-4 mr-1 animate-spin" />
              ) : isStrategyEnabled ? (
                <AlertTriangle className="w-4 h-4 mr-1" />
              ) : (
                <Power className="w-4 h-4 mr-1" />
              )}
              {isStrategyEnabled ? 'STOP BOT' : 'START BOT'}
            </Button>
            
            <V35StrategyPDFExport />
            <V35ExportButton />
            {heartbeat?.dry_run && (
              <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30">
                DRY RUN
              </Badge>
            )}
            <Badge 
              variant={isOnline ? "default" : "secondary"}
              className={isOnline ? "bg-primary" : "bg-muted"}
            >
              {isOnline ? (
                <>
                  <Activity className="w-3 h-3 mr-1 animate-pulse" />
                  Online
                </>
              ) : (
                <>
                  <XCircle className="w-3 h-3 mr-1" />
                  Offline
                </>
              )}
            </Badge>
          </div>
        </div>

        {/* Live Price Header */}
        <V35LivePriceHeader />

        {/* Status Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Markets</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{heartbeat?.markets_count || 0}</div>
              <p className="text-xs text-muted-foreground">
                Mode: {heartbeat?.mode || 'unknown'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Paired Shares</CardTitle>
              <Scale className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{heartbeat?.positions_count?.toLocaleString() || 0}</div>
              <p className="text-xs text-muted-foreground">
                Unpaired: {heartbeat?.total_unpaired?.toLocaleString() || 0}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Locked Profit</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                ${(heartbeat?.metadata?.locked_profit ?? heartbeat?.total_locked_profit ?? 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                Pre-settlement guaranteed
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Balance</CardTitle>
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${(heartbeat?.balance || 0).toFixed(2)}
              </div>
              <p className="text-xs text-muted-foreground">
                Available USDC
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Strategy Explanation */}
        <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-background">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              How V35 Works
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CircleDot className="h-4 w-4 text-primary" />
                1. Place Grid Orders
              </div>
              <p className="text-xs text-muted-foreground">
                Post BUY limit orders on both UP and DOWN outcomes at prices from $0.35 to $0.50
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Scale className="h-4 w-4 text-primary" />
                2. Accumulate Both Sides
              </div>
              <p className="text-xs text-muted-foreground">
                When retail traders hit our orders, we accumulate shares on both UP and DOWN
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                3. Settlement Profit
              </div>
              <p className="text-xs text-muted-foreground">
                At expiry: one side = $1.00, other = $0.00. If combined cost &lt; $1.00 → profit!
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Tabs for Positions, Settlements, Logs, Fills, Snapshots */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
          {/* Mobile: Dropdown selector */}
          {isMobile ? (
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full bg-background">
                <SelectValue>
                  {(() => {
                    const tab = TAB_OPTIONS.find(t => t.value === activeTab);
                    if (!tab) return 'Select...';
                    const Icon = tab.icon;
                    return (
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </span>
                    );
                  })()}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="bg-background z-50">
                {TAB_OPTIONS.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <SelectItem key={tab.value} value={tab.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          ) : (
            /* Desktop: Regular tabs */
            <TabsList>
              {TAB_OPTIONS.map((tab) => {
                const Icon = tab.icon;
                return (
                  <TabsTrigger key={tab.value} value={tab.value}>
                    <Icon className="h-4 w-4 mr-2" />
                    {tab.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          )}

          <TabsContent value="pairs">
            <div className="space-y-6">
              <V35PairLog />
              <V35PairFillTimeTable />
            </div>
          </TabsContent>

          <TabsContent value="pnl">
            <V35MarketPnLTable />
          </TabsContent>

          <TabsContent value="decisions">
            <V35DecisionLog />
          </TabsContent>

          <TabsContent value="positions">
            <V35OpenPositions />
          </TabsContent>

          <TabsContent value="snapshots">
            <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
              <V35ExpirySnapshots />
              <V35AnalysisExport />
            </div>
          </TabsContent>

          <TabsContent value="overview">
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Recent Settlements */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Recent Settlements
                  </CardTitle>
                  <CardDescription>
                    Completed markets and their P&L
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {settlements && settlements.length > 0 ? (
                    <div className="space-y-3">
                      {settlements.slice(0, 8).map((s) => (
                        <div key={s.id} className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline">{s.asset}</Badge>
                            <div>
                              <p className="text-sm font-medium truncate max-w-[200px]">
                                {s.market_slug?.slice(-30) || 'Unknown'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Paired: {s.paired} | Cost: ${s.combined_cost?.toFixed(3)}
                              </p>
                            </div>
                          </div>
                          <div className={`text-sm font-bold ${s.pnl >= 0 ? 'text-primary' : 'text-destructive'}`}>
                            {s.pnl >= 0 ? '+' : ''}${s.pnl?.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No settlements yet</p>
                      <p className="text-xs">Markets will appear here after expiry</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Performance Summary */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Performance Summary
                  </CardTitle>
                  <CardDescription>
                    Aggregate statistics from settlements
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total Realized P&L</span>
                      <span className={`font-bold ${totalPnL >= 0 ? 'text-primary' : 'text-destructive'}`}>
                        {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
                      </span>
                    </div>
                    <Separator />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total Paired Shares</span>
                      <span className="font-medium">{totalPaired.toLocaleString()}</span>
                    </div>
                    <Separator />
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Avg Combined Cost</span>
                      <span className="font-medium">${avgCombinedCost.toFixed(3)}</span>
                    </div>
                    <Progress 
                      value={avgCombinedCost * 100} 
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground text-right">
                      Target: &lt; $1.00 (currently {avgCombinedCost < 1 ? '✅' : '⚠️'})
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Settlements Count</span>
                      <span className="font-medium">{settlements?.length || 0}</span>
                    </div>
                    <Separator />
                  </div>

                  <div className="pt-2 text-center">
                    <p className="text-xs text-muted-foreground">
                      Last heartbeat: {lastSeen ? lastSeen.toLocaleTimeString() : 'Never'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="logs">
            <V35LogViewer />
          </TabsContent>

          <TabsContent value="fills">
            <V35FillsTable />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
