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
        .limit(50);

      if (error) throw error;
      return data as ExpirySnapshot[];
    },
    refetchInterval: 30000,
  });

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

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Market Expiry Snapshots
          </CardTitle>
          <div className="flex gap-4 text-sm text-muted-foreground">
            <span>📊 {totalSnapshots} snapshots</span>
            <span>💰 ${totalLockedProfit.toFixed(2)} locked profit</span>
            <span>📈 Avg CPP: ${avgCPP.toFixed(4)}</span>
            <span className={imbalancedCount > 0 ? "text-warning" : ""}>
              ⚠️ {imbalancedCount} imbalanced
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
          
          {inventoryLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading position timeline...</div>
          ) : inventorySnapshots && inventorySnapshots.length > 0 ? (
            <V35ImbalanceChart
              inventorySnapshots={inventorySnapshots}
              marketSlug={selectedMarket?.market_slug || ""}
              winner={selectedMarket?.predicted_winning_side as 'UP' | 'DOWN' | undefined}
              groundTruth={selectedMarket ? {
                api_up_qty: selectedMarket.api_up_qty,
                api_down_qty: selectedMarket.api_down_qty,
                total_cost: selectedMarket.total_cost || 0,
                predicted_pnl: selectedMarket.predicted_pnl || 0,
              } : undefined}
            />
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No inventory snapshots found for this market
            </div>
          )}
          
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
                
                <div className="grid grid-cols-5 gap-3 text-sm">
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
