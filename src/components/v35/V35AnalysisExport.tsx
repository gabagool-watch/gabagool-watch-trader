/**
 * V35 Analysis Export - Download enriched data for expert analysis
 * Includes crossing count calculation and all trading data
 */

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Download, Loader2, FileJson, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface PriceTick {
  ts: number;
  spot_price: number;
  market_slug: string;
  up_best_bid: number;
  up_best_ask: number;
  down_best_bid: number;
  down_best_ask: number;
}

interface ExpirySnapshot {
  id: string;
  market_slug: string;
  asset: string;
  expiry_time: string;
  snapshot_time: string;
  api_up_qty: number;
  api_down_qty: number;
  api_up_cost: number;
  api_down_cost: number;
  paired: number;
  unpaired: number;
  combined_cost: number;
  locked_profit: number;
  avg_up_price: number;
  avg_down_price: number;
  up_best_bid: number;
  up_best_ask: number;
  down_best_bid: number;
  down_best_ask: number;
  was_imbalanced: boolean;
  imbalance_ratio: number;
  total_cost: number;
  predicted_winning_side: string | null;
  predicted_pnl: number;
  spot_price: number | null;
  strike_price: number | null;
}

interface Fill {
  id: string;
  market_slug: string;
  asset: string;
  side: string;
  size: number;
  price: number;
  order_id: string;
  created_at: string;
  fill_key?: string;
  fill_ts?: string;
  fill_type?: string;
  token_id?: string;
  wallet_address?: string;
}

// Calculate crossing count for a market
function calculateCrossingCount(ticks: PriceTick[], strikePrice: number): number {
  if (ticks.length < 2 || !strikePrice) return 0;
  
  let crossings = 0;
  let prevSide = ticks[0].spot_price >= strikePrice ? 'UP' : 'DOWN';
  
  for (let i = 1; i < ticks.length; i++) {
    const currentSide = ticks[i].spot_price >= strikePrice ? 'UP' : 'DOWN';
    if (currentSide !== prevSide) {
      crossings++;
      prevSide = currentSide;
    }
  }
  
  return crossings;
}

// Calculate price volatility stats
function calculatePriceStats(ticks: PriceTick[]) {
  if (ticks.length < 2) return { min: 0, max: 0, range: 0, volatility: 0 };
  
  const prices = ticks.map(t => t.spot_price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min;
  
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / prices.length;
  const volatility = Math.sqrt(variance);
  
  return { min, max, range, volatility };
}

export function V35AnalysisExport() {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');

  const handleExport = async () => {
    setLoading(true);
    setProgress('Fetching snapshots...');

    try {
      const hours = 30;
      const cutoffTime = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

      // Fetch all data in parallel
      setProgress('Fetching all data...');
      const [snapshotsRes, fillsRes, ticksRes, settlementsRes] = await Promise.all([
        supabase
          .from('v35_expiry_snapshots')
          .select('*')
          .gte('snapshot_time', cutoffTime)
          .order('snapshot_time', { ascending: true }),
        supabase
          .from('v35_fills')
          .select('*')
          .gte('created_at', cutoffTime)
          .order('created_at', { ascending: true }),
        supabase
          .from('v35_price_ticks')
          .select('ts, spot_price, market_slug, up_best_bid, up_best_ask, down_best_bid, down_best_ask, created_at')
          .gte('created_at', cutoffTime)
          .order('ts', { ascending: true }),
        supabase
          .from('v35_settlements')
          .select('*')
          .gte('created_at', cutoffTime)
          .order('created_at', { ascending: true }),
      ]);

      const snapshots = (snapshotsRes.data || []) as ExpirySnapshot[];
      const fills = (fillsRes.data || []) as Fill[];
      const allTicks = (ticksRes.data || []) as PriceTick[];
      const settlements = settlementsRes.data || [];

      setProgress(`Processing ${snapshots.length} snapshots, ${allTicks.length} ticks...`);

      // Group ticks by market
      const ticksByMarket = new Map<string, PriceTick[]>();
      for (const tick of allTicks) {
        const existing = ticksByMarket.get(tick.market_slug) || [];
        existing.push(tick);
        ticksByMarket.set(tick.market_slug, existing);
      }

      // Enrich snapshots with crossing data
      const enrichedSnapshots = snapshots.map(snapshot => {
        const marketTicks = ticksByMarket.get(snapshot.market_slug) || [];
        
        // Get first tick's spot_price as strike estimate if not available
        const strikePrice = snapshot.strike_price || (marketTicks.length > 0 ? marketTicks[0].spot_price : null);
        
        const crossingCount = strikePrice ? calculateCrossingCount(marketTicks, strikePrice) : null;
        const priceStats = calculatePriceStats(marketTicks);
        
        // Determine actual winning side based on final spot vs strike
        const finalSpot = marketTicks.length > 0 ? marketTicks[marketTicks.length - 1].spot_price : null;
        const actualWinningSide = strikePrice && finalSpot 
          ? (finalSpot >= strikePrice ? 'UP' : 'DOWN')
          : null;
        
        return {
          ...snapshot,
          calculated_strike_price: strikePrice,
          crossing_count: crossingCount,
          tick_count: marketTicks.length,
          price_min: priceStats.min,
          price_max: priceStats.max,
          price_range: priceStats.range,
          price_volatility: Math.round(priceStats.volatility * 100) / 100,
          final_spot_price: finalSpot,
          actual_winning_side: actualWinningSide,
        };
      });

      // Calculate summary
      const activeBets = enrichedSnapshots.filter(s => (s.api_up_qty || 0) > 0 || (s.api_down_qty || 0) > 0);
      
      const summary = {
        export_time: new Date().toISOString(),
        hours_exported: hours,
        cutoff_time: cutoffTime,
        total_snapshots: enrichedSnapshots.length,
        active_bets: activeBets.length,
        total_fills: fills.length,
        total_price_ticks: allTicks.length,
        total_settlements: settlements.length,
        unique_markets: new Set(enrichedSnapshots.map(s => s.market_slug)).size,
        
        // P&L summary (only active bets)
        total_pnl: Math.round(activeBets.reduce((sum, s) => sum + (s.predicted_pnl || 0), 0) * 100) / 100,
        winning_bets: activeBets.filter(s => (s.predicted_pnl || 0) > 0).length,
        losing_bets: activeBets.filter(s => (s.predicted_pnl || 0) < 0).length,
        breakeven_bets: activeBets.filter(s => s.predicted_pnl === 0).length,
        
        // Crossing distribution
        crossing_distribution: {} as Record<string, number>,
        crossing_winrates: {} as Record<string, { total: number; wins: number; losses: number; pnl: number; winrate: number }>,
      };

      // Calculate crossing stats
      for (let i = 0; i <= 6; i++) {
        const bucket = i === 6 ? '6+' : i.toString();
        const bets = activeBets.filter(s => {
          const cc = s.crossing_count ?? 0;
          return i === 6 ? cc >= 6 : cc === i;
        });
        
        summary.crossing_distribution[bucket] = bets.length;
        
        const wins = bets.filter(b => (b.predicted_pnl || 0) > 0).length;
        const losses = bets.filter(b => (b.predicted_pnl || 0) < 0).length;
        const pnl = bets.reduce((sum, b) => sum + (b.predicted_pnl || 0), 0);
        const total = wins + losses;
        
        summary.crossing_winrates[bucket] = {
          total: bets.length,
          wins,
          losses,
          pnl: Math.round(pnl * 100) / 100,
          winrate: total > 0 ? Math.round((wins / total) * 1000) / 10 : 0,
        };
      }

      // Prepare export data
      const exportData = {
        summary,
        expiry_snapshots: enrichedSnapshots,
        fills,
        settlements,
        // Group price ticks by market for analysis
        price_ticks_by_market: Object.fromEntries(ticksByMarket),
      };

      setProgress('Preparing download...');
      
      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `v35-analysis-export-${hours}h-${new Date().toISOString().slice(0, 16).replace(':', '-')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`Export complete: ${(jsonString.length / 1024 / 1024).toFixed(2)} MB`);
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Export failed: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileJson className="h-5 w-5" />
          Analysis Export (30h)
        </CardTitle>
        <CardDescription>
          Download all trading data with calculated crossing counts for expert analysis
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground space-y-1">
          <p><strong>Includes:</strong></p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li>All expiry snapshots with enriched crossing data</li>
            <li>Price ticks grouped by market (for custom analysis)</li>
            <li>All fills and settlements</li>
            <li>Summary statistics &amp; crossing winrates</li>
          </ul>
        </div>

        <div className="flex items-center gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-xs text-amber-600 dark:text-amber-400">
            File can be large (5-20 MB). Contains all price ticks for accurate crossing analysis.
          </p>
        </div>

        <Button 
          onClick={handleExport} 
          disabled={loading}
          className="w-full"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {progress || 'Exporting...'}
            </>
          ) : (
            <>
              <Download className="mr-2 h-4 w-4" />
              Download Analysis Export (JSON)
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
