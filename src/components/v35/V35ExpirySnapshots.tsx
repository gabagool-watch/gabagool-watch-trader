import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format } from "date-fns";
import { Camera, TrendingUp, AlertTriangle, LineChart } from "lucide-react";
import { V35ImbalanceChart } from "./V35ImbalanceChart";
import { V35MarketPriceChart } from "./V35MarketPriceChart";
import { V35FillsChart } from "./V35FillsChart";

interface ExpirySnapshot {
  id: string;
  market_slug: string;
  asset: string;
  expiry_time: string;
  snapshot_time: string;
  seconds_before_expiry: number;
  api_up_qty: number;
  api_down_qty: number;
  api_up_cost: number;
  api_down_cost: number;
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  total_cost: number;
  predicted_winning_side: string | null;
  predicted_final_value: number;
  predicted_pnl: number;
  was_imbalanced: boolean;
  imbalance_ratio: number | null;
  crossing_count: number | null;
  spot_price: number | null;
  strike_price: number | null;
  created_at: string;
}

export function V35ExpirySnapshots() {
  const [selectedMarket, setSelectedMarket] = useState<ExpirySnapshot | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const { data: snapshots, isLoading, error } = useQuery({
    queryKey: ["v35-expiry-snapshots"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v35_expiry_snapshots")
        .select("*")
        .order("expiry_time", { ascending: false })
        .limit(100); // Fetch more for better averages

      if (error) throw error;
      return data as ExpirySnapshot[];
    },
    refetchInterval: 30000,
  });

  // Calculate P&L for a snapshot
  const calculatePnL = (snapshot: ExpirySnapshot): number => {
    const totalCost = snapshot.total_cost || (snapshot.api_up_cost + snapshot.api_down_cost);
    const winner = snapshot.predicted_winning_side;
    if (!winner) return 0;
    const winningShares = winner === 'UP' ? snapshot.api_up_qty : snapshot.api_down_qty;
    return (winningShares * 1.0) - totalCost;
  };

  // Calculate average P&L for different time windows
  const calculateTimeWindowStats = (hours: number) => {
    if (!snapshots || snapshots.length === 0) return { avgPnl: 0, count: 0, wins: 0, losses: 0 };
    
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const filtered = snapshots.filter(s => 
      new Date(s.expiry_time) > cutoff && 
      s.total_cost > 0 &&
      s.predicted_winning_side
    );
    
    if (filtered.length === 0) return { avgPnl: 0, count: 0, wins: 0, losses: 0 };
    
    const pnls = filtered.map(s => calculatePnL(s));
    const totalPnl = pnls.reduce((sum, pnl) => sum + pnl, 0);
    const wins = pnls.filter(p => p > 0).length;
    const losses = pnls.filter(p => p < 0).length;
    
    return {
      avgPnl: totalPnl / filtered.length,
      totalPnl,
      count: filtered.length,
      wins,
      losses,
      winRate: filtered.length > 0 ? (wins / filtered.length) * 100 : 0
    };
  };

  const stats1h = calculateTimeWindowStats(1);
  const stats4h = calculateTimeWindowStats(4);
  const stats12h = calculateTimeWindowStats(12);
  const stats24h = calculateTimeWindowStats(24);

  // Fetch inventory snapshots for selected market - reliable position timeline from runner
  const { data: inventorySnapshots, isLoading: inventoryLoading } = useQuery({
    queryKey: ["v35-inventory-snapshots", selectedMarket?.market_slug],
    queryFn: async () => {
      if (!selectedMarket?.market_slug) return [];
      
      // Extract market_id pattern from slug (e.g., "btc-updown-15m-1769865300")
      const slugParts = selectedMarket.market_slug.match(/(\d{10,})$/);
      const marketIdSuffix = slugParts ? slugParts[1] : selectedMarket.market_slug;
      
      const { data, error } = await supabase
        .from("inventory_snapshots")
        .select("ts, up_shares, down_shares, avg_up_cost, avg_down_cost, pair_cost, state")
        .or(`market_id.like.%${marketIdSuffix}%,market_id.eq.${selectedMarket.market_slug}`)
        .order("ts", { ascending: true });

      if (error) throw error;
      
      return (data || []).map(s => ({
        ts: s.ts,
        up_shares: s.up_shares || 0,
        down_shares: s.down_shares || 0,
        avg_up_cost: s.avg_up_cost,
        avg_down_cost: s.avg_down_cost,
        pair_cost: s.pair_cost,
        state: s.state || 'UNKNOWN',
      }));
    },
    enabled: !!selectedMarket?.market_slug,
  });

  const openChart = (snapshot: ExpirySnapshot) => {
    setSelectedMarket(snapshot);
    setIsModalOpen(true);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Market Expiry Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-muted-foreground">Loading snapshots...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Market Expiry Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-destructive">Error loading snapshots: {String(error)}</div>
        </CardContent>
      </Card>
    );
  }

  // Calculate summary stats
  const totalSnapshots = snapshots?.length || 0;
  const totalLockedProfit = snapshots?.reduce((sum, s) => sum + (s.locked_profit || 0), 0) || 0;
  const imbalancedCount = snapshots?.filter(s => s.was_imbalanced).length || 0;
  const avgCPP = snapshots && snapshots.length > 0
    ? snapshots.reduce((sum, s) => sum + (s.combined_cost || 0), 0) / snapshots.length
    : 0;
  const highCrossingCount = snapshots?.filter(s => s.crossing_count !== null && s.crossing_count >= 3).length || 0;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Market Expiry Snapshots
          </CardTitle>
          
          {/* P&L Averages per time window */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            <div className={`rounded-lg p-3 ${stats1h.totalPnl >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
              <div className="text-xs text-muted-foreground">Laatste 1 uur</div>
              <div className={`font-bold ${stats1h.totalPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                {stats1h.totalPnl >= 0 ? "+" : ""}${stats1h.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats1h.count} markets • {stats1h.winRate.toFixed(0)}% WR
              </div>
            </div>
            <div className={`rounded-lg p-3 ${stats4h.totalPnl >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
              <div className="text-xs text-muted-foreground">Laatste 4 uur</div>
              <div className={`font-bold ${stats4h.totalPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                {stats4h.totalPnl >= 0 ? "+" : ""}${stats4h.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats4h.count} markets • {stats4h.winRate.toFixed(0)}% WR
              </div>
            </div>
            <div className={`rounded-lg p-3 ${stats12h.totalPnl >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
              <div className="text-xs text-muted-foreground">Laatste 12 uur</div>
              <div className={`font-bold ${stats12h.totalPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                {stats12h.totalPnl >= 0 ? "+" : ""}${stats12h.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats12h.count} markets • {stats12h.winRate.toFixed(0)}% WR
              </div>
            </div>
            <div className={`rounded-lg p-3 ${stats24h.totalPnl >= 0 ? "bg-primary/10" : "bg-destructive/10"}`}>
              <div className="text-xs text-muted-foreground">Laatste 24 uur</div>
              <div className={`font-bold ${stats24h.totalPnl >= 0 ? "text-primary" : "text-destructive"}`}>
                {stats24h.totalPnl >= 0 ? "+" : ""}${stats24h.totalPnl.toFixed(2)}
              </div>
              <div className="text-xs text-muted-foreground">
                {stats24h.count} markets • {stats24h.winRate.toFixed(0)}% WR • Avg ${stats24h.avgPnl.toFixed(2)}/bet
              </div>
            </div>
          </div>
          
          <div className="flex gap-4 text-sm text-muted-foreground mt-3">
            <span>📊 {totalSnapshots} snapshots</span>
            <span>💰 ${totalLockedProfit.toFixed(2)} locked profit</span>
            <span>📈 Avg CPP: ${avgCPP.toFixed(4)}</span>
            <span className={imbalancedCount > 0 ? "text-warning" : ""}>
              ⚠️ {imbalancedCount} imbalanced
            </span>
            <span className={highCrossingCount > 0 ? "text-orange-500" : ""}>
              🔄 {highCrossingCount} high crossing (≥3)
            </span>
          </div>
        </CardHeader>
        <CardContent>
          {!snapshots || snapshots.length === 0 ? (
            <div className="text-muted-foreground text-center py-8">
              No expiry snapshots yet. Snapshots are captured 1 second before each market expires.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Expiry Time</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Asset</TableHead>
                    <TableHead className="text-right">UP</TableHead>
                    <TableHead className="text-right">DOWN</TableHead>
                    <TableHead className="text-right">UP Cost</TableHead>
                    <TableHead className="text-right">DOWN Cost</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                    <TableHead>Winner</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead className="text-center">Crossings</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((snapshot) => {
                    // Calculate correct PnL: (winning_shares × $1) - (up_cost + down_cost)
                    const upCost = snapshot.api_up_cost || 0;
                    const downCost = snapshot.api_down_cost || 0;
                    const totalCost = snapshot.total_cost || (upCost + downCost);
                    const winner = snapshot.predicted_winning_side;
                    
                    let winningShares = 0;
                    if (winner === 'UP') {
                      winningShares = snapshot.api_up_qty;
                    } else if (winner === 'DOWN') {
                      winningShares = snapshot.api_down_qty;
                    }
                    
                    // PnL = (winning_shares × $1) - total_cost
                    const pnl = winner 
                      ? (winningShares * 1.0) - totalCost
                      : snapshot.predicted_pnl || 0;
                    
                    const isProfitable = pnl > 0;

                    return (
                      <TableRow key={snapshot.id}>
                        <TableCell className="font-mono text-xs">
                          {format(new Date(snapshot.expiry_time), "MMM dd HH:mm")}
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[150px] truncate">
                          {snapshot.market_slug.slice(-25)}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{snapshot.asset}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {snapshot.api_up_qty.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {snapshot.api_down_qty.toFixed(1)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-emerald-500">
                          ${upCost.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-rose-500">
                          ${downCost.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium">
                          ${totalCost.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          {winner ? (
                            <Badge 
                              variant="outline" 
                              className={winner === 'UP' 
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' 
                                : 'bg-rose-500/10 text-rose-600 border-rose-500/30'}
                            >
                              {winner === 'UP' ? (
                                <TrendingUp className="h-3 w-3 mr-1" />
                              ) : (
                                <AlertTriangle className="h-3 w-3 mr-1" />
                              )}
                              {winner} ({winningShares.toFixed(0)}×$1)
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Unknown</Badge>
                          )}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-bold ${isProfitable ? "text-primary" : "text-destructive"}`}>
                          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-center">
                          {snapshot.crossing_count !== null ? (
                            <Badge 
                              variant="outline" 
                              className={snapshot.crossing_count >= 3 
                                ? 'bg-orange-500/10 text-orange-600 border-orange-500/30' 
                                : snapshot.crossing_count >= 1 
                                  ? 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30'
                                  : 'bg-muted/50 text-muted-foreground'}
                            >
                              🔄 {snapshot.crossing_count}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {snapshot.was_imbalanced ? (
                            <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                              <AlertTriangle className="h-3 w-3" />
                              {snapshot.unpaired.toFixed(0)} unpaired
                            </Badge>
                          ) : isProfitable ? (
                            <Badge className="flex items-center gap-1 w-fit bg-primary text-primary-foreground">
                              <TrendingUp className="h-3 w-3" />
                              Profit
                            </Badge>
                          ) : (
                            <Badge variant="destructive">Loss</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openChart(snapshot)}
                            title="View imbalance timeline"
                          >
                            <LineChart className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Imbalance Chart Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LineChart className="h-5 w-5" />
              Position Timeline - {selectedMarket?.market_slug?.slice(-30)}
            </DialogTitle>
          </DialogHeader>
          
          {/* All charts synchronized with same syncId */}
          {selectedMarket && (() => {
            const startTs = new Date(selectedMarket.expiry_time).getTime() - 15 * 60 * 1000;
            const endTs = new Date(selectedMarket.expiry_time).getTime();
            const syncId = `v35-chart-${selectedMarket.market_slug}`;
            
            return (
              <div className="space-y-4">
                {/* Market Price Chart - shows price movement relative to strike */}
                <V35MarketPriceChart
                  asset={selectedMarket.asset}
                  marketSlug={selectedMarket.market_slug}
                  startTs={startTs}
                  endTs={endTs}
                  syncId={syncId}
                />
                
                {/* Fills Chart - shows orders and fills timeline */}
                <V35FillsChart
                  marketSlug={selectedMarket.market_slug}
                  startTs={startTs}
                  endTs={endTs}
                  syncId={syncId}
                />
                
                {/* Imbalance Chart - shows position buildup */}
                {inventoryLoading ? (
                  <div className="py-8 text-center text-muted-foreground">Loading position timeline...</div>
                ) : inventorySnapshots && inventorySnapshots.length > 0 ? (
                  <V35ImbalanceChart
                    inventorySnapshots={inventorySnapshots}
                    marketSlug={selectedMarket.market_slug}
                    winner={selectedMarket.predicted_winning_side as 'UP' | 'DOWN' | undefined}
                    groundTruth={{
                      api_up_qty: selectedMarket.api_up_qty,
                      api_down_qty: selectedMarket.api_down_qty,
                      total_cost: selectedMarket.total_cost || 0,
                      predicted_pnl: selectedMarket.predicted_pnl || 0,
                    }}
                    syncId={syncId}
                  />
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    No inventory snapshots found for this market
                  </div>
                )}
              </div>
            );
          })()}
          
          {/* Quick stats for selected market - THESE ARE THE CORRECT VALUES FROM POLYMARKET API */}
          {selectedMarket && (() => {
            const upCost = selectedMarket.api_up_cost || 0;
            const downCost = selectedMarket.api_down_cost || 0;
            const totalCost = selectedMarket.total_cost || (upCost + downCost);
            const winner = selectedMarket.predicted_winning_side;
            const winningShares = winner === 'UP' ? selectedMarket.api_up_qty : 
                                  winner === 'DOWN' ? selectedMarket.api_down_qty : 0;
            const pnl = winner ? (winningShares * 1.0) - totalCost : selectedMarket.predicted_pnl || 0;
            
            return (
              <div className="mt-4 space-y-3">
                
                <div className="grid grid-cols-6 gap-3 text-sm">
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">UP Shares (API)</div>
                    <div className="font-bold text-emerald-600">{selectedMarket.api_up_qty.toFixed(1)}</div>
                    <div className="text-muted-foreground text-xs">Cost: ${upCost.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">DOWN Shares (API)</div>
                    <div className="font-bold text-rose-600">{selectedMarket.api_down_qty.toFixed(1)}</div>
                    <div className="text-muted-foreground text-xs">Cost: ${downCost.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">Total Cost</div>
                    <div className="font-bold">${totalCost.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-3">
                    <div className="text-muted-foreground text-xs">Unpaired</div>
                    <div className={`font-bold ${selectedMarket.unpaired > 50 ? "text-destructive" : "text-warning"}`}>
                      {selectedMarket.unpaired.toFixed(1)}
                    </div>
                  </div>
                  <div className={`rounded-lg p-3 ${selectedMarket.crossing_count !== null && selectedMarket.crossing_count >= 3 ? "bg-orange-500/10" : "bg-muted/50"}`}>
                    <div className="text-muted-foreground text-xs">Crossings</div>
                    <div className={`font-bold ${selectedMarket.crossing_count !== null && selectedMarket.crossing_count >= 3 ? "text-orange-600" : ""}`}>
                      🔄 {selectedMarket.crossing_count ?? '—'}
                    </div>
                    {selectedMarket.strike_price && (
                      <div className="text-muted-foreground text-[10px]">
                        Strike: ${selectedMarket.strike_price.toLocaleString()}
                      </div>
                    )}
                  </div>
                  <div className={`rounded-lg p-3 ${pnl >= 0 ? "bg-emerald-500/10" : "bg-rose-500/10"}`}>
                    <div className="text-muted-foreground text-xs">P&L {winner ? `(${winner} won)` : ''}</div>
                    <div className={`font-bold ${pnl >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                      {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}
                    </div>
                    <div className="text-muted-foreground text-[10px]">
                      = ({winningShares.toFixed(0)} × $1) - ${totalCost.toFixed(2)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );
}
