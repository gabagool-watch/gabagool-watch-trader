// ============================================================
// V37 HOT-RELOAD - Live Config Updates from Database
// ============================================================
// 
// Periodically polls the database for config changes and applies
// them without requiring a runner restart.
//
// Features:
// - Version-based change detection
// - Atomic config updates
// - Callback notifications for config changes
// - Graceful error handling
// ============================================================

import { config as envConfig } from '../config.js';

// ============================================================
// TYPES
// ============================================================

export interface HotReloadConfig {
  // V37 Trading Parameters
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

type ConfigChangeCallback = (newConfig: HotReloadConfig, prevConfig: HotReloadConfig | null) => void;

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_CONFIG: HotReloadConfig = {
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
  config_version: 0,
  updated_at: null,
};

// ============================================================
// STATE
// ============================================================

let currentConfig: HotReloadConfig = { ...DEFAULT_CONFIG };
let lastConfigVersion = 0;
let reloadInterval: ReturnType<typeof setInterval> | null = null;
let configCallbacks: ConfigChangeCallback[] = [];

// ============================================================
// FETCH CONFIG FROM DATABASE
// ============================================================

async function fetchConfig(): Promise<HotReloadConfig | null> {
  try {
    const runnerProxyUrl = envConfig.backend.url;
    const secret = envConfig.backend.secret;

    if (!runnerProxyUrl || !secret) {
      return null;
    }

    // Derive get-bot-config URL from runner-proxy URL
    let url = runnerProxyUrl;
    if (runnerProxyUrl.includes('/functions/v1/')) {
      url = runnerProxyUrl.replace(/\/functions\/v1\/[^/]+$/, '/functions/v1/get-bot-config');
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'x-runner-secret': secret,
      },
    });

    if (!response.ok) {
      console.warn(`[HotReload] Config fetch failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    // Map database row to HotReloadConfig
    return {
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
      config_version: data.config_version ?? 0,
      updated_at: data.updated_at ?? null,
    };
  } catch (error) {
    console.warn(`[HotReload] Error fetching config:`, error);
    return null;
  }
}

// ============================================================
// HOT RELOAD LOGIC
// ============================================================

async function checkForUpdates(): Promise<boolean> {
  const newConfig = await fetchConfig();
  
  if (!newConfig) {
    return false;
  }
  
  // Check if version has changed
  if (newConfig.config_version > lastConfigVersion) {
    const prevConfig = lastConfigVersion > 0 ? { ...currentConfig } : null;
    
    console.log(`\n🔄 [HotReload] Config update detected: v${lastConfigVersion} → v${newConfig.config_version}`);
    
    // Log what changed
    if (prevConfig) {
      const changes: string[] = [];
      for (const key of Object.keys(newConfig) as (keyof HotReloadConfig)[]) {
        if (key === 'updated_at' || key === 'config_version') continue;
        const oldVal = prevConfig[key];
        const newVal = newConfig[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changes.push(`  • ${key}: ${JSON.stringify(oldVal)} → ${JSON.stringify(newVal)}`);
        }
      }
      if (changes.length > 0) {
        console.log('   Changes:');
        changes.forEach(c => console.log(c));
      }
    }
    
    // Update state
    lastConfigVersion = newConfig.config_version;
    currentConfig = newConfig;
    
    // Notify callbacks
    for (const callback of configCallbacks) {
      try {
        callback(newConfig, prevConfig);
      } catch (err) {
        console.error('[HotReload] Callback error:', err);
      }
    }
    
    console.log(`✅ [HotReload] Config v${newConfig.config_version} applied\n`);
    return true;
  }
  
  return false;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Start the hot-reload polling loop
 */
export async function startHotReload(): Promise<HotReloadConfig> {
  console.log('[HotReload] Starting hot-reload service...');
  
  // Initial load
  const initialConfig = await fetchConfig();
  if (initialConfig) {
    currentConfig = initialConfig;
    lastConfigVersion = initialConfig.config_version;
    console.log(`[HotReload] Loaded config v${lastConfigVersion}`);
  } else {
    console.warn('[HotReload] Using default config');
  }
  
  // Start polling
  const intervalMs = currentConfig.config_reload_interval_ms || 30000;
  reloadInterval = setInterval(async () => {
    await checkForUpdates();
  }, intervalMs);
  
  console.log(`[HotReload] Polling every ${intervalMs / 1000}s for config updates`);
  
  return currentConfig;
}

/**
 * Stop the hot-reload polling loop
 */
export function stopHotReload(): void {
  if (reloadInterval) {
    clearInterval(reloadInterval);
    reloadInterval = null;
    console.log('[HotReload] Stopped');
  }
}

/**
 * Get the current config (read-only)
 */
export function getHotConfig(): HotReloadConfig {
  return currentConfig;
}

/**
 * Force an immediate config check
 */
export async function forceConfigReload(): Promise<HotReloadConfig> {
  await checkForUpdates();
  return currentConfig;
}

/**
 * Register a callback for config changes
 */
export function onConfigChange(callback: ConfigChangeCallback): () => void {
  configCallbacks.push(callback);
  return () => {
    configCallbacks = configCallbacks.filter(cb => cb !== callback);
  };
}

/**
 * Check if strategy is enabled (quick accessor)
 */
export function isStrategyEnabled(): boolean {
  return currentConfig.strategy_enabled;
}

/**
 * Get current config version
 */
export function getConfigVersion(): number {
  return lastConfigVersion;
}
