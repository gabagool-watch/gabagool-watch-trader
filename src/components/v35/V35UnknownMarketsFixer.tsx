import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, RefreshCw, CheckCircle, AlertTriangle, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';

interface UnknownMarket {
  slug: string;
  asset: string;
  event_start_time: string;
  event_end_time: string;
  open_price: number | null;
  close_price: number | null;
  result: string;
}

export function V35UnknownMarketsFixer() {
  const queryClient = useQueryClient();

  // Fetch unknown markets that DON'T have oracle data (need manual fix)
  const { data: unknownMarkets, isLoading, refetch } = useQuery({
    queryKey: ['unknown-markets-manual'],
    queryFn: async () => {
      // First get all UNKNOWN markets
      const { data: markets, error } = await supabase
        .from('market_history')
        .select('slug, asset, event_start_time, event_end_time, open_price, close_price, result')
        .eq('result', 'UNKNOWN')
        .order('event_end_time', { ascending: false })
        .limit(100);

      if (error) throw error;
      if (!markets || markets.length === 0) return [];

      // Check which ones have oracle data
      const marketsNeedingManualFix: UnknownMarket[] = [];
      
      for (const market of markets) {
        const { data: oracleData } = await supabase
          .from('strike_prices')
          .select('open_price, close_price')
          .eq('market_slug', market.slug)
          .maybeSingle();
        
        // Only include if NO oracle data available
        if (!oracleData?.open_price || !oracleData?.close_price) {
          marketsNeedingManualFix.push(market as UnknownMarket);
        }
      }

      return marketsNeedingManualFix;
    },
    refetchInterval: 60000, // Check every minute
  });

  // Manual fix mutation
  const manualFixMutation = useMutation({
    mutationFn: async ({ slug, result }: { slug: string; result: 'UP' | 'DOWN' }) => {
      const { error } = await supabase
        .from('market_history')
        .update({
          result,
          updated_at: new Date().toISOString()
        })
        .eq('slug', slug);

      if (error) throw error;
      return { success: true, result };
    },
    onSuccess: (data, variables) => {
      toast.success(`Market ${variables.slug} set to ${variables.result}`);
      queryClient.invalidateQueries({ queryKey: ['unknown-markets-manual'] });
    },
    onError: (error) => {
      toast.error(`Manual fix failed: ${(error as Error).message}`);
    }
  });

  const getPolymarketUrl = (slug: string) => {
    return `https://polymarket.com/event/${slug}`;
  };

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleString('nl-NL', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Manual Fix Required
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!unknownMarkets || unknownMarkets.length === 0) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-500" />
              Manual Fix Required
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Geen markets die handmatig gefixt moeten worden 🎉</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Manual Fix Required
            <Badge variant="secondary" className="ml-2">{unknownMarkets.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Deze markets hebben geen oracle data - check Polymarket en kies UP of DOWN
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {unknownMarkets.map((market) => (
          <div
            key={market.slug}
            className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border border-border/30"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs">
                  {market.asset}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatTime(market.event_end_time)}
                </span>
              </div>
              <div className="text-sm font-mono truncate mt-1">
                {market.slug}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-4">
              <Button
                size="sm"
                variant="outline"
                className="text-green-600 border-green-600/50 hover:bg-green-600/10"
                onClick={() => manualFixMutation.mutate({ slug: market.slug, result: 'UP' })}
                disabled={manualFixMutation.isPending}
              >
                <ArrowUp className="h-4 w-4 mr-1" />
                UP
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 border-red-600/50 hover:bg-red-600/10"
                onClick={() => manualFixMutation.mutate({ slug: market.slug, result: 'DOWN' })}
                disabled={manualFixMutation.isPending}
              >
                <ArrowDown className="h-4 w-4 mr-1" />
                DOWN
              </Button>
              <a
                href={getPolymarketUrl(market.slug)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground p-2"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
