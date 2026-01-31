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
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  was_imbalanced: boolean;
  imbalance_ratio: number | null;
  pnl?: number;
  winner?: string;
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

  // Fetch fills for selected market
  const { data: marketFills, isLoading: fillsLoading } = useQuery({
    queryKey: ["v35-market-fills", selectedMarket?.market_slug],
    queryFn: async () => {
      if (!selectedMarket?.market_slug) return [];
      
      const { data, error } = await supabase
        .from("v35_fills")
        .select("fill_ts, side, price, size")
        .eq("market_slug", selectedMarket.market_slug)
        .order("fill_ts", { ascending: true });

      if (error) throw error;
      
      // Note: In v35_fills, 'side' is already the outcome (UP/DOWN), not the trade direction
      return (data || []).map(f => ({
        ts: new Date(f.fill_ts).getTime(),
        side: 'BUY', // For now assume all fills are buys (position building)
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
                    <TableHead className="text-right">Paired</TableHead>
                    <TableHead className="text-right">CPP</TableHead>
                    <TableHead className="text-right">P&L</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {snapshots.map((snapshot) => {
                    const isProfitable = snapshot.combined_cost > 0 && snapshot.combined_cost < 1.0;
                    const profitPct = isProfitable ? ((1 - snapshot.combined_cost) * 100).toFixed(1) : "0";
                    const pnl = snapshot.pnl ?? snapshot.locked_profit;

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
                        <TableCell className="text-right font-mono">
                          {snapshot.paired.toFixed(0)}
                        </TableCell>
                        <TableCell className={`text-right font-mono ${isProfitable ? "text-primary" : "text-destructive"}`}>
                          ${snapshot.combined_cost.toFixed(4)}
                        </TableCell>
                        <TableCell className={`text-right font-mono font-bold ${pnl >= 0 ? "text-primary" : "text-destructive"}`}>
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
                              +{profitPct}%
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Break-even</Badge>
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
              winner={selectedMarket?.winner as 'UP' | 'DOWN' | undefined}
            />
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              No fills found for this market
            </div>
          )}
          
          {/* Quick stats for selected market */}
          {selectedMarket && (
            <div className="mt-4 grid grid-cols-4 gap-3 text-sm">
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-muted-foreground text-xs">UP Shares</div>
                <div className="font-bold text-primary">{selectedMarket.api_up_qty.toFixed(1)}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-muted-foreground text-xs">DOWN Shares</div>
                <div className="font-bold text-destructive">{selectedMarket.api_down_qty.toFixed(1)}</div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-muted-foreground text-xs">Unpaired</div>
                <div className={`font-bold ${selectedMarket.unpaired > 50 ? "text-destructive" : "text-warning"}`}>
                  {selectedMarket.unpaired.toFixed(1)}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-3">
                <div className="text-muted-foreground text-xs">P&L</div>
                <div className={`font-bold ${(selectedMarket.pnl ?? 0) >= 0 ? "text-primary" : "text-destructive"}`}>
                  {(selectedMarket.pnl ?? 0) >= 0 ? "+" : ""}${(selectedMarket.pnl ?? selectedMarket.locked_profit).toFixed(2)}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
