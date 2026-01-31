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

interface FillData {
  ts: number;
  side: string;
  outcome: string;
  fill_price: number;
  fill_qty: number;
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

  // Fetch bot config for wallet address
  const { data: botConfig } = useQuery({
    queryKey: ["bot-config-wallet"],
    queryFn: async () => {
      const { data } = await supabase
        .from("bot_config")
        .select("polymarket_address")
        .eq("id", "00000000-0000-0000-0000-000000000001")
        .maybeSingle();
      return data;
    },
  });

  // Fetch fills for selected market - ONLY from user's wallet
  const { data: marketFills, isLoading: fillsLoading } = useQuery({
    queryKey: ["v35-market-fills", selectedMarket?.market_slug, botConfig?.polymarket_address],
    queryFn: async () => {
      if (!selectedMarket?.market_slug) return [];
      
      let query = supabase
        .from("v35_fills")
        .select("fill_ts, side, price, size, wallet_address")
        .eq("market_slug", selectedMarket.market_slug)
        .order("fill_ts", { ascending: true });
      
      // Filter by wallet if configured
      if (botConfig?.polymarket_address) {
        query = query.eq("wallet_address", botConfig.polymarket_address.toLowerCase());
      }
      
      const { data, error } = await query;

      if (error) throw error;
      
      // Note: In v35_fills, 'side' is already the outcome (UP/DOWN), not the trade direction
      return (data || []).map(f => ({
        ts: new Date(f.fill_ts).getTime(),
        side: 'BUY', // All fills are buys (position building)
        outcome: f.side || 'UP', // side is actually UP/DOWN
        fill_price: f.price,
        fill_qty: f.size,
      })) as FillData[];
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
              Fill Timeline - {selectedMarket?.market_slug?.slice(-30)}
            </DialogTitle>
          </DialogHeader>
          
          {fillsLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading fills...</div>
          ) : marketFills && marketFills.length > 0 ? (
            <V35ImbalanceChart
              fills={marketFills}
              marketSlug={selectedMarket?.market_slug || ""}
              winner={selectedMarket?.predicted_winning_side as 'UP' | 'DOWN' | undefined}
            />
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No fills found for this market
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
            
            // Check if fills data differs significantly from API data
            const fillsUpQty = marketFills?.filter(f => f.outcome === 'UP').reduce((s, f) => s + f.fill_qty, 0) || 0;
            const fillsDownQty = marketFills?.filter(f => f.outcome === 'DOWN').reduce((s, f) => s + f.fill_qty, 0) || 0;
            const fillsMatch = Math.abs(fillsUpQty - selectedMarket.api_up_qty) < 10 && 
                               Math.abs(fillsDownQty - selectedMarket.api_down_qty) < 10;
            
            return (
              <div className="mt-4 space-y-3">
                {/* Warning if fills don't match API */}
                {marketFills && marketFills.length > 0 && !fillsMatch && (
                  <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2 text-warning font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Fill data mismatch met API
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      De chart toont fills uit de database ({fillsUpQty.toFixed(0)} UP, {fillsDownQty.toFixed(0)} DOWN), 
                      maar de API snapshot toont ({selectedMarket.api_up_qty.toFixed(0)} UP, {selectedMarket.api_down_qty.toFixed(0)} DOWN).
                      De onderstaande P&L is gebaseerd op de correcte API data.
                    </div>
                  </div>
                )}
                
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
