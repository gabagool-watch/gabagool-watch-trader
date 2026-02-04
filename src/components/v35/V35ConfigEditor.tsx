import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { RefreshCw, Save, Settings, Shield, Timer, Zap, TrendingUp, AlertTriangle } from 'lucide-react';

const CONFIG_ROW_ID = '00000000-0000-0000-0000-000000000001';

interface BotConfig {
  // Trading Parameters
  cpp_target: number;
  price_guard_min: number;
  price_guard_max: number;
  pair_limit: number;
  base_lot_shares: number;
  min_lot_shares: number;
  opening_max_price: number;
  
  // Feature Toggles
  strategy_enabled: boolean;
  enable_escalation_hedge: boolean;
  enable_volatility_margin: boolean;
  enable_fill_audit: boolean;
  
  // Risk Limits
  max_shares_per_side: number;
  max_total_shares_per_market: number;
  max_notional_per_market: number;
  max_notional_per_trade: number;
  global_max_notional: number;
  
  // Timing
  stop_new_trades_sec: number;
  hedge_timeout_sec: number;
  hedge_must_by_sec: number;
  
  // Escalation
  escalation_timeout_ms: number;
  escalation_reprice_ticks: number;
  
  // Volatility
  volatility_atr_period: number;
  volatility_margin_multiplier: number;
  
  // Rate Limiting
  min_order_interval_ms: number;
  cloudflare_backoff_ms: number;
  fill_audit_interval_ms: number;
  config_reload_interval_ms: number;
  
  // Assets
  trade_assets: string[];
  
  // VPN
  vpn_required: boolean;
  vpn_endpoint: string | null;
  
  // Meta
  config_version: number;
  updated_at: string | null;
}

const DEFAULT_CONFIG: BotConfig = {
  cpp_target: 0.95,
  price_guard_min: 0.03,
  price_guard_max: 0.97,
  pair_limit: 10,
  base_lot_shares: 25,
  min_lot_shares: 5,
  opening_max_price: 0.52,
  strategy_enabled: true,
  enable_escalation_hedge: false,
  enable_volatility_margin: false,
  enable_fill_audit: true,
  max_shares_per_side: 100,
  max_total_shares_per_market: 200,
  max_notional_per_market: 150,
  max_notional_per_trade: 20,
  global_max_notional: 500,
  stop_new_trades_sec: 30,
  hedge_timeout_sec: 12,
  hedge_must_by_sec: 60,
  escalation_timeout_ms: 5000,
  escalation_reprice_ticks: 2,
  volatility_atr_period: 14,
  volatility_margin_multiplier: 1.5,
  min_order_interval_ms: 1500,
  cloudflare_backoff_ms: 60000,
  fill_audit_interval_ms: 30000,
  config_reload_interval_ms: 30000,
  trade_assets: ['BTC', 'ETH', 'SOL', 'XRP'],
  vpn_required: true,
  vpn_endpoint: null,
  config_version: 1,
  updated_at: null,
};

export function V35ConfigEditor() {
  const [config, setConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [originalConfig, setOriginalConfig] = useState<BotConfig>(DEFAULT_CONFIG);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  const fetchConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('bot_config')
        .select('*')
        .eq('id', CONFIG_ROW_ID)
        .single();

      if (error) throw error;

      if (data) {
        const loadedConfig: BotConfig = {
          cpp_target: data.cpp_target ?? DEFAULT_CONFIG.cpp_target,
          price_guard_min: data.price_guard_min ?? DEFAULT_CONFIG.price_guard_min,
          price_guard_max: data.price_guard_max ?? DEFAULT_CONFIG.price_guard_max,
          pair_limit: data.pair_limit ?? DEFAULT_CONFIG.pair_limit,
          base_lot_shares: data.base_lot_shares ?? DEFAULT_CONFIG.base_lot_shares,
          min_lot_shares: data.min_lot_shares ?? DEFAULT_CONFIG.min_lot_shares,
          opening_max_price: data.opening_max_price ?? DEFAULT_CONFIG.opening_max_price,
          strategy_enabled: data.strategy_enabled ?? DEFAULT_CONFIG.strategy_enabled,
          enable_escalation_hedge: data.enable_escalation_hedge ?? DEFAULT_CONFIG.enable_escalation_hedge,
          enable_volatility_margin: data.enable_volatility_margin ?? DEFAULT_CONFIG.enable_volatility_margin,
          enable_fill_audit: data.enable_fill_audit ?? DEFAULT_CONFIG.enable_fill_audit,
          max_shares_per_side: data.max_shares_per_side ?? DEFAULT_CONFIG.max_shares_per_side,
          max_total_shares_per_market: data.max_total_shares_per_market ?? DEFAULT_CONFIG.max_total_shares_per_market,
          max_notional_per_market: data.max_notional_per_market ?? DEFAULT_CONFIG.max_notional_per_market,
          max_notional_per_trade: data.max_notional_per_trade ?? DEFAULT_CONFIG.max_notional_per_trade,
          global_max_notional: data.global_max_notional ?? DEFAULT_CONFIG.global_max_notional,
          stop_new_trades_sec: data.stop_new_trades_sec ?? DEFAULT_CONFIG.stop_new_trades_sec,
          hedge_timeout_sec: data.hedge_timeout_sec ?? DEFAULT_CONFIG.hedge_timeout_sec,
          hedge_must_by_sec: data.hedge_must_by_sec ?? DEFAULT_CONFIG.hedge_must_by_sec,
          escalation_timeout_ms: data.escalation_timeout_ms ?? DEFAULT_CONFIG.escalation_timeout_ms,
          escalation_reprice_ticks: data.escalation_reprice_ticks ?? DEFAULT_CONFIG.escalation_reprice_ticks,
          volatility_atr_period: data.volatility_atr_period ?? DEFAULT_CONFIG.volatility_atr_period,
          volatility_margin_multiplier: data.volatility_margin_multiplier ?? DEFAULT_CONFIG.volatility_margin_multiplier,
          min_order_interval_ms: data.min_order_interval_ms ?? DEFAULT_CONFIG.min_order_interval_ms,
          cloudflare_backoff_ms: data.cloudflare_backoff_ms ?? DEFAULT_CONFIG.cloudflare_backoff_ms,
          fill_audit_interval_ms: data.fill_audit_interval_ms ?? DEFAULT_CONFIG.fill_audit_interval_ms,
          config_reload_interval_ms: data.config_reload_interval_ms ?? DEFAULT_CONFIG.config_reload_interval_ms,
          trade_assets: data.trade_assets ?? DEFAULT_CONFIG.trade_assets,
          vpn_required: data.vpn_required ?? DEFAULT_CONFIG.vpn_required,
          vpn_endpoint: data.vpn_endpoint ?? DEFAULT_CONFIG.vpn_endpoint,
          config_version: data.config_version ?? DEFAULT_CONFIG.config_version,
          updated_at: data.updated_at,
        };
        setConfig(loadedConfig);
        setOriginalConfig(loadedConfig);
      }
    } catch (err) {
      console.error('Failed to fetch config:', err);
      toast.error('Failed to load configuration');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  useEffect(() => {
    const changed = JSON.stringify(config) !== JSON.stringify(originalConfig);
    setHasChanges(changed);
  }, [config, originalConfig]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('bot_config')
        .update({
          ...config,
          config_version: (config.config_version || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', CONFIG_ROW_ID);

      if (error) throw error;

      toast.success('Configuration saved! Runner will pick up changes within 30 seconds.');
      await fetchConfig();
    } catch (err) {
      console.error('Failed to save config:', err);
      toast.error('Failed to save configuration');
    } finally {
      setIsSaving(false);
    }
  };

  const updateConfig = <K extends keyof BotConfig>(key: K, value: BotConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateAssets = (asset: string, enabled: boolean) => {
    setConfig(prev => {
      const current = prev.trade_assets || [];
      if (enabled && !current.includes(asset)) {
        return { ...prev, trade_assets: [...current, asset] };
      } else if (!enabled) {
        return { ...prev, trade_assets: current.filter(a => a !== asset) };
      }
      return prev;
    });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            V37 Strategy Configuration
          </CardTitle>
          <CardDescription>
            Hot-reload enabled • Changes apply within {config.config_reload_interval_ms / 1000}s
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={config.strategy_enabled ? 'default' : 'secondary'}>
            {config.strategy_enabled ? 'Strategy Active' : 'Strategy Paused'}
          </Badge>
          <Badge variant="outline">v{config.config_version}</Badge>
          {hasChanges && (
            <Badge variant="destructive">Unsaved Changes</Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        <Tabs defaultValue="trading" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="trading">Trading</TabsTrigger>
            <TabsTrigger value="features">Features</TabsTrigger>
            <TabsTrigger value="risk">Risk Limits</TabsTrigger>
            <TabsTrigger value="timing">Timing</TabsTrigger>
            <TabsTrigger value="advanced">Advanced</TabsTrigger>
          </TabsList>

          {/* Trading Tab */}
          <TabsContent value="trading" className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {/* CPP Target */}
              <div className="space-y-2">
                <Label htmlFor="cpp_target" className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  CPP Target
                </Label>
                <Input
                  id="cpp_target"
                  type="number"
                  step="0.01"
                  min="0.80"
                  max="1.00"
                  value={config.cpp_target}
                  onChange={e => updateConfig('cpp_target', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Target cost per pair. 0.95 = 5¢ profit margin
                </p>
              </div>

              {/* Opening Max Price */}
              <div className="space-y-2">
                <Label htmlFor="opening_max_price">Opening Max Price</Label>
                <Input
                  id="opening_max_price"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="0.99"
                  value={config.opening_max_price}
                  onChange={e => updateConfig('opening_max_price', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Max price for opening taker position
                </p>
              </div>

              {/* Price Guard Min */}
              <div className="space-y-2">
                <Label htmlFor="price_guard_min" className="flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Price Guard Min
                </Label>
                <Input
                  id="price_guard_min"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="0.50"
                  value={config.price_guard_min}
                  onChange={e => updateConfig('price_guard_min', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum price for entries (e.g., 0.03 = 3¢)
                </p>
              </div>

              {/* Price Guard Max */}
              <div className="space-y-2">
                <Label htmlFor="price_guard_max">Price Guard Max</Label>
                <Input
                  id="price_guard_max"
                  type="number"
                  step="0.01"
                  min="0.50"
                  max="0.99"
                  value={config.price_guard_max}
                  onChange={e => updateConfig('price_guard_max', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum price for entries (e.g., 0.97 = 97¢)
                </p>
              </div>

              {/* Pair Limit */}
              <div className="space-y-2">
                <Label htmlFor="pair_limit">Pair Limit per Market</Label>
                <Input
                  id="pair_limit"
                  type="number"
                  step="1"
                  min="1"
                  max="50"
                  value={config.pair_limit}
                  onChange={e => updateConfig('pair_limit', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum concurrent pairs per market
                </p>
              </div>

              {/* Base Lot Shares */}
              <div className="space-y-2">
                <Label htmlFor="base_lot_shares">Base Lot Size (shares)</Label>
                <Input
                  id="base_lot_shares"
                  type="number"
                  step="5"
                  min="5"
                  max="200"
                  value={config.base_lot_shares}
                  onChange={e => updateConfig('base_lot_shares', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Default order size in shares
                </p>
              </div>
            </div>

            <Separator />

            {/* Asset Selection */}
            <div className="space-y-3">
              <Label>Active Assets</Label>
              <div className="flex flex-wrap gap-3">
                {['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA'].map(asset => (
                  <div key={asset} className="flex items-center gap-2">
                    <Switch
                      id={`asset-${asset}`}
                      checked={config.trade_assets?.includes(asset) ?? false}
                      onCheckedChange={checked => updateAssets(asset, checked)}
                    />
                    <Label htmlFor={`asset-${asset}`}>{asset}</Label>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* Features Tab */}
          <TabsContent value="features" className="space-y-6">
            <div className="space-y-4">
              {/* Strategy Enabled */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Strategy Enabled
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Master switch - disabling pauses all trading
                  </p>
                </div>
                <Switch
                  checked={config.strategy_enabled}
                  onCheckedChange={checked => updateConfig('strategy_enabled', checked)}
                />
              </div>

              {/* Escalation Hedge */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Escalation Hedge
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Reprice maker after timeout if not filled
                  </p>
                </div>
                <Switch
                  checked={config.enable_escalation_hedge}
                  onCheckedChange={checked => updateConfig('enable_escalation_hedge', checked)}
                />
              </div>

              {/* Volatility Margin */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Volatility Margin</Label>
                  <p className="text-sm text-muted-foreground">
                    Adjust margin based on ATR volatility
                  </p>
                </div>
                <Switch
                  checked={config.enable_volatility_margin}
                  onCheckedChange={checked => updateConfig('enable_volatility_margin', checked)}
                />
              </div>

              {/* Fill Audit */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">Fill Audit</Label>
                  <p className="text-sm text-muted-foreground">
                    Poll REST API for missed WebSocket fills
                  </p>
                </div>
                <Switch
                  checked={config.enable_fill_audit}
                  onCheckedChange={checked => updateConfig('enable_fill_audit', checked)}
                />
              </div>

              {/* VPN Required */}
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="space-y-0.5">
                  <Label className="text-base">VPN Required</Label>
                  <p className="text-sm text-muted-foreground">
                    Block trading if VPN check fails
                  </p>
                </div>
                <Switch
                  checked={config.vpn_required}
                  onCheckedChange={checked => updateConfig('vpn_required', checked)}
                />
              </div>
            </div>
          </TabsContent>

          {/* Risk Limits Tab */}
          <TabsContent value="risk" className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="max_shares_per_side">Max Shares Per Side</Label>
                <Input
                  id="max_shares_per_side"
                  type="number"
                  step="10"
                  min="10"
                  max="1000"
                  value={config.max_shares_per_side}
                  onChange={e => updateConfig('max_shares_per_side', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Hard cap on UP or DOWN shares per market
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_total_shares_per_market">Max Total Shares</Label>
                <Input
                  id="max_total_shares_per_market"
                  type="number"
                  step="10"
                  min="20"
                  max="2000"
                  value={config.max_total_shares_per_market}
                  onChange={e => updateConfig('max_total_shares_per_market', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Max total shares (UP + DOWN) per market
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_notional_per_trade">Max $ Per Trade</Label>
                <Input
                  id="max_notional_per_trade"
                  type="number"
                  step="5"
                  min="1"
                  max="500"
                  value={config.max_notional_per_trade}
                  onChange={e => updateConfig('max_notional_per_trade', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Maximum notional per single order
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="max_notional_per_market">Max $ Per Market</Label>
                <Input
                  id="max_notional_per_market"
                  type="number"
                  step="10"
                  min="10"
                  max="1000"
                  value={config.max_notional_per_market}
                  onChange={e => updateConfig('max_notional_per_market', parseFloat(e.target.value))}
                />
              </div>

              <div className="space-y-2 col-span-2">
                <Label htmlFor="global_max_notional">Global Max Notional ($)</Label>
                <Input
                  id="global_max_notional"
                  type="number"
                  step="50"
                  min="50"
                  max="10000"
                  value={config.global_max_notional}
                  onChange={e => updateConfig('global_max_notional', parseFloat(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Total exposure limit across all markets
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Timing Tab */}
          <TabsContent value="timing" className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="stop_new_trades_sec" className="flex items-center gap-2">
                  <Timer className="h-4 w-4" />
                  Stop New Trades (sec)
                </Label>
                <Input
                  id="stop_new_trades_sec"
                  type="number"
                  step="5"
                  min="10"
                  max="120"
                  value={config.stop_new_trades_sec}
                  onChange={e => updateConfig('stop_new_trades_sec', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  No new pairs when less than this time remaining
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hedge_timeout_sec">Hedge Timeout (sec)</Label>
                <Input
                  id="hedge_timeout_sec"
                  type="number"
                  step="1"
                  min="5"
                  max="60"
                  value={config.hedge_timeout_sec}
                  onChange={e => updateConfig('hedge_timeout_sec', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Force hedge after this time one-sided
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="hedge_must_by_sec">Hedge Must By (sec)</Label>
                <Input
                  id="hedge_must_by_sec"
                  type="number"
                  step="5"
                  min="30"
                  max="180"
                  value={config.hedge_must_by_sec}
                  onChange={e => updateConfig('hedge_must_by_sec', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Must be fully hedged by this time remaining
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalation_timeout_ms">Escalation Timeout (ms)</Label>
                <Input
                  id="escalation_timeout_ms"
                  type="number"
                  step="1000"
                  min="1000"
                  max="30000"
                  value={config.escalation_timeout_ms}
                  onChange={e => updateConfig('escalation_timeout_ms', parseInt(e.target.value))}
                  disabled={!config.enable_escalation_hedge}
                />
                <p className="text-xs text-muted-foreground">
                  Time before repricing unfilled maker
                </p>
              </div>
            </div>
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="min_order_interval_ms">Min Order Interval (ms)</Label>
                <Input
                  id="min_order_interval_ms"
                  type="number"
                  step="100"
                  min="500"
                  max="10000"
                  value={config.min_order_interval_ms}
                  onChange={e => updateConfig('min_order_interval_ms', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Minimum time between orders (rate limit)
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cloudflare_backoff_ms">Cloudflare Backoff (ms)</Label>
                <Input
                  id="cloudflare_backoff_ms"
                  type="number"
                  step="5000"
                  min="10000"
                  max="300000"
                  value={config.cloudflare_backoff_ms}
                  onChange={e => updateConfig('cloudflare_backoff_ms', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  Backoff time when Cloudflare blocks
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="fill_audit_interval_ms">Fill Audit Interval (ms)</Label>
                <Input
                  id="fill_audit_interval_ms"
                  type="number"
                  step="5000"
                  min="10000"
                  max="120000"
                  value={config.fill_audit_interval_ms}
                  onChange={e => updateConfig('fill_audit_interval_ms', parseInt(e.target.value))}
                  disabled={!config.enable_fill_audit}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="config_reload_interval_ms">Config Reload Interval (ms)</Label>
                <Input
                  id="config_reload_interval_ms"
                  type="number"
                  step="5000"
                  min="10000"
                  max="120000"
                  value={config.config_reload_interval_ms}
                  onChange={e => updateConfig('config_reload_interval_ms', parseInt(e.target.value))}
                />
                <p className="text-xs text-muted-foreground">
                  How often runner checks for config updates
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="volatility_atr_period">Volatility ATR Period</Label>
                <Input
                  id="volatility_atr_period"
                  type="number"
                  step="1"
                  min="5"
                  max="50"
                  value={config.volatility_atr_period}
                  onChange={e => updateConfig('volatility_atr_period', parseInt(e.target.value))}
                  disabled={!config.enable_volatility_margin}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="volatility_margin_multiplier">Volatility Margin Multiplier</Label>
                <Input
                  id="volatility_margin_multiplier"
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="3.0"
                  value={config.volatility_margin_multiplier}
                  onChange={e => updateConfig('volatility_margin_multiplier', parseFloat(e.target.value))}
                  disabled={!config.enable_volatility_margin}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="min_lot_shares">Min Lot Shares</Label>
                <Input
                  id="min_lot_shares"
                  type="number"
                  step="1"
                  min="1"
                  max="100"
                  value={config.min_lot_shares}
                  onChange={e => updateConfig('min_lot_shares', parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="escalation_reprice_ticks">Escalation Reprice Ticks</Label>
                <Input
                  id="escalation_reprice_ticks"
                  type="number"
                  step="1"
                  min="1"
                  max="10"
                  value={config.escalation_reprice_ticks}
                  onChange={e => updateConfig('escalation_reprice_ticks', parseInt(e.target.value))}
                  disabled={!config.enable_escalation_hedge}
                />
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="vpn_endpoint">VPN Endpoint Override</Label>
              <Input
                id="vpn_endpoint"
                type="text"
                placeholder="Optional: IP or hostname to verify"
                value={config.vpn_endpoint || ''}
                onChange={e => updateConfig('vpn_endpoint', e.target.value || null)}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Save Button */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t">
          <div className="text-sm text-muted-foreground">
            {config.updated_at && (
              <span>Last updated: {new Date(config.updated_at).toLocaleString()}</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              onClick={fetchConfig}
              disabled={isLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button 
              onClick={handleSave}
              disabled={isSaving || !hasChanges}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
