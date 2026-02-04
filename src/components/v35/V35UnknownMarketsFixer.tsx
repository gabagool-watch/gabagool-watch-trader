import { useState } from 'react';
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
  const [fixingSlug, setFixingSlug] = useState<string | null>(null);

  // Fetch unknown markets
  const { data: unknownMarkets, isLoading, refetch } = useQuery({
    queryKey: ['unknown-markets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('market_history')
        .select('slug, asset, event_start_time, event_end_time, open_price, close_price, result')
        .eq('result', 'UNKNOWN')
        .order('event_end_time', { ascending: false })
        .limit(50);

      if (error) throw error;
      return data as UnknownMarket[];
    },
    refetchInterval: 30000,
  });

  // Try auto-fix mutation
  const autoFixMutation = useMutation({
    mutationFn: async (slug: string) => {
      // First check strike_prices table for oracle data
      const { data: oracleData } = await supabase
        .from('strike_prices')
        .select('open_price, close_price, strike_price')
        .eq('market_slug', slug)
        .maybeSingle();

      if (oracleData?.open_price && oracleData?.close_price) {
        const result = oracleData.close_price > oracleData.open_price ? 'UP' : 'DOWN';
        
        // Update market_history
        const { error } = await supabase
          .from('market_history')
          .update({
            open_price: oracleData.open_price,
            close_price: oracleData.close_price,
            result,
            updated_at: new Date().toISOString()
          })
          .eq('slug', slug);

        if (error) throw error;
        return { success: true, result, autoFixed: true };
      }

      return { success: false, autoFixed: false };
    },
    onSuccess: (data, slug) => {
      if (data.autoFixed) {
        toast.success(`Market ${slug} auto-fixed: ${data.result}`);
        queryClient.invalidateQueries({ queryKey: ['unknown-markets'] });
      }
    },
    onError: (error) => {
      toast.error(`Auto-fix failed: ${error.message}`);
    }
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
      queryClient.invalidateQueries({ queryKey: ['unknown-markets'] });
      setFixingSlug(null);
    },
    onError: (error) => {
      toast.error(`Manual fix failed: ${error.message}`);
    }
  });

  const handleAutoFix = async (slug: string) => {
    setFixingSlug(slug);
    const result = await autoFixMutation.mutateAsync(slug);
    if (!result.autoFixed) {
      // Keep fixingSlug set to show manual buttons
    } else {
      setFixingSlug(null);
    }
  };

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
            Unknown Markets
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
              Unknown Markets
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">No unknown markets 🎉</div>
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
            Fix Unknown Markets
            <Badge variant="secondary" className="ml-2">{unknownMarkets.length}</Badge>
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
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
              {market.open_price && (
                <div className="text-xs text-muted-foreground mt-1">
                  Open: ${market.open_price.toFixed(2)}
                  {market.close_price && ` → Close: $${market.close_price.toFixed(2)}`}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 ml-4">
              {fixingSlug === market.slug ? (
                <>
                  {/* Show manual fix buttons */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-green-500 border-green-500/50 hover:bg-green-500/10"
                    onClick={() => manualFixMutation.mutate({ slug: market.slug, result: 'UP' })}
                    disabled={manualFixMutation.isPending}
                  >
                    <ArrowUp className="h-4 w-4 mr-1" />
                    UP
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-500 border-red-500/50 hover:bg-red-500/10"
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
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleAutoFix(market.slug)}
                    disabled={autoFixMutation.isPending && fixingSlug === market.slug}
                  >
                    {autoFixMutation.isPending && fixingSlug === market.slug ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      'Fix'
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
