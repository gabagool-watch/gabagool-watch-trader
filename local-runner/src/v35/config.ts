// ============================================================
// V35 CONFIGURATION - GABAGOOL STRATEGY
// ============================================================
// Version: V35.11.0 - "Never Ban, Always Fix"
//
// V35.11.0 CRITICAL CHANGES:
// ================================================================
// CORE PHILOSOPHY: NEVER BAN A MARKET, ALWAYS FIX THE IMBALANCE
//
// 1. PRE-TRADE CHECK: Before any fill, verify hedge is possible
//    - If hedge side ask > viability cap → BLOCK the fill side FIRST
// 2. POST-FILL BLOCK: After hedge fails, immediately block leading side
//    - Leading side stays blocked until gap < 5 shares
// 3. 30% LOSS TOLERANCE: Accept up to 30% loss to fix imbalance
//    - emergencyMaxCost = 1.30 (was 1.20)
// 4. NO MARKET BANNING: Circuit breaker never bans, only blocks leading
//    - Keeps trying to rebalance until expiry
// 5. CONTINUOUS REBALANCING: Rebalancer runs every 500ms
//    - Always buying lagging side to close gap
//
// This ensures imbalances are FIXED, not abandoned via bans.
// ============================================================

export const V35_VERSION = 'V36.8.0';
export const V35_CODENAME = 'Volatility-Scaled Margin';

export type V35Mode = 'test' | 'moderate' | 'production';

// V36.8.0: Volatility-based margin configuration
export interface VolatilityMarginConfig {
  enabled: boolean;
  
  // ATR thresholds (in percentage)
  lowVolATR: number;      // < this = LOW volatility
  highVolATR: number;     // > this = HIGH volatility
  
  // Base margins per delta bucket (in $)
  deltaMargins: {
    high: number;     // Delta > 500: 10¢
    medium: number;   // Delta > 200: 7¢
    low: number;      // Delta > 50: 5¢
    veryLow: number;  // Delta ≤ 50: 3¢
  };
  
  // Volatility multipliers (smaller = tighter margin)
  volatilityMultipliers: {
    low: number;      // Low vol: use full margin
    medium: number;   // Med vol: reduced margin
    high: number;     // High vol: minimal margin
  };
  
  // Minimum margin floor (never go below this)
  minMargin: number;
}

export interface V35Config {
  // =========================================================================
  // 🎚️ MODE SELECTOR
  // =========================================================================
  mode: V35Mode;
  
  // =========================================================================
  // 🎯 GRID PARAMETERS
  // =========================================================================
  gridMin: number;          // Lowest bid price (e.g., 0.15)
  gridMax: number;          // Highest bid price (e.g., 0.85)
  gridStep: number;         // Step between price levels (e.g., 0.05)
  
  // =========================================================================
  // 📊 SIZING PARAMETERS
  // =========================================================================
  sharesPerLevel: number;   // Shares per price level (min 3 for Polymarket)
  
  // =========================================================================
  // 🎯 HEDGE PARAMETERS (V35.1.0+)
  // =========================================================================
  enableActiveHedge: boolean;       // TRUE = gabagool style active hedging
  maxHedgeSlippage: number;         // Max extra we'll pay for hedge (e.g., 0.03)
  hedgeTimeoutMs: number;           // Timeout for hedge order
  minEdgeAfterHedge: number;        // Minimum edge after hedge (e.g., -0.02 = accept 2% loss)
  maxCombinedCost: number;          // V35.8.0: Max combined cost for hedge ($1.02 = 2% loss OK)
  maxCombinedCostEmergency: number; // V35.8.0: Max combined cost in emergency ($1.15)
  maxExpensiveBias: number;         // Max ratio expensive:cheap (e.g., 1.2 = 20% more)
  minHedgeNotional: number;         // V35.3.0: Min $ notional for hedge orders
  
  // =========================================================================
  // 🛡️ RISK LIMITS - V35.3.0 CIRCUIT BREAKER INTEGRATED
  // =========================================================================
  warnUnpairedShares: number;       // Warning threshold - block leading side
  criticalUnpairedShares: number;   // Critical - cancel all leading, prepare halt
  maxUnpairedShares: number;        // ABSOLUTE HARD STOP - trip circuit breaker
  maxUnpairedImbalance: number;     // Alias for maxUnpairedShares (compatibility)
  maxImbalanceRatio: number;        // Max ratio UP:DOWN or DOWN:UP
  maxLossPerMarket: number;         // Max $ loss per market before stopping
  maxConcurrentMarkets: number;     // Max markets to trade simultaneously
  maxMarkets: number;               // Alias for maxConcurrentMarkets
  maxNotionalPerMarket: number;     // Max $ notional per market
  maxTotalExposure: number;         // Max $ total exposure across all markets
  skewThreshold: number;            // Skew threshold for warning logs
  capitalPerMarket: number;         // $ allocated per market
  
  // =========================================================================
  // ⏱️ TIMING PARAMETERS
  // =========================================================================
  startDelayMs: number;             // Delay after market open before placing orders
  stopBeforeExpirySec: number;      // Stop quoting X seconds before expiry
  refreshIntervalMs: number;        // Milliseconds between order updates
  
  // =========================================================================
  // 🚫 FEATURES
  // =========================================================================
  enableMomentumFilter: boolean;    // MUST BE FALSE - reduces fills
  
  // =========================================================================
  // 📈 V36.8.0: VOLATILITY-BASED MARGIN
  // =========================================================================
  volatilityMargin: VolatilityMarginConfig;
  
  // =========================================================================
  // 🎯 ASSETS
  // =========================================================================
  enabledAssets: string[];          // Which assets to trade ['BTC', 'ETH']
  
  // =========================================================================
  // 🔌 API CONFIGURATION
  // =========================================================================
  clobUrl: string;
  chainId: number;
  
  // =========================================================================
  // 🧪 TESTING
  // =========================================================================
  dryRun: boolean;                  // True = no real orders (simulation)
  
  // =========================================================================
  // 📁 LOGGING
  // =========================================================================
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// =========================================================================
// PRESET CONFIGURATIONS - V35.10.0 CONTINUOUS HEDGE MODE
// =========================================================================

/**
 * TEST MODE - V35.10.0 Continuous Hedge
 * Actively balances positions at market prices
 */
export const TEST_CONFIG: V35Config = {
  mode: 'test',
  
  // Grid: 46 levels per side (2¢ step, 5-95¢)
  gridMin: 0.05,
  gridMax: 0.95,
  gridStep: 0.02,
  sharesPerLevel: 5,
  
  // HEDGE PARAMETERS - V36.11.0: AGGRESSIVE REBALANCING
  // PRIORITY: Fix imbalance ASAP - accept small losses to avoid big directional losses
  enableActiveHedge: true,
  maxHedgeSlippage: 0.12,           // Accept up to 12¢ slippage for hedge
  hedgeTimeoutMs: 1500,             // 1.5 second timeout (faster)
  minEdgeAfterHedge: -0.10,         // Max 10% loss for hedge OK
  maxCombinedCost: 0.98,            // Target: aim for 2% profit, but flexible
  maxCombinedCostEmergency: 1.05,   // Emergency: accept 5% LOSS to fix imbalance!
  maxExpensiveBias: 1.30,           // Tighter: expensive side max 30% more shares
  minHedgeNotional: 1.05,           // Just above exchange min
  
  // Risk limits - V35.10.0 (same tiers)
  warnUnpairedShares: 10,
  criticalUnpairedShares: 15,
  maxUnpairedShares: 20,
  maxUnpairedImbalance: 20,
  maxImbalanceRatio: 2.0,
  maxLossPerMarket: 25,
  maxConcurrentMarkets: 1,
  maxMarkets: 1,
  maxNotionalPerMarket: 100,
  maxTotalExposure: 150,
  skewThreshold: 8,
  capitalPerMarket: 75,
  
  // Timing
  startDelayMs: 5000,
  stopBeforeExpirySec: 30,
  refreshIntervalMs: 500,
  
  // Features
  enableMomentumFilter: false,
  
  // V36.8.0: Volatility-based margin
  volatilityMargin: {
    enabled: true,
    lowVolATR: 0.10,      // < 0.10% = LOW volatility
    highVolATR: 0.25,     // > 0.25% = HIGH volatility
    deltaMargins: {
      high: 0.10,         // Delta > 500: 10¢
      medium: 0.07,       // Delta > 200: 7¢
      low: 0.05,          // Delta > 50: 5¢
      veryLow: 0.03,      // Delta ≤ 50: 3¢
    },
    volatilityMultipliers: {
      low: 1.0,           // Low vol: use full margin
      medium: 0.7,        // Med vol: 70% of base
      high: 0.5,          // High vol: 50% of base
    },
    minMargin: 0.02,      // 2¢ absolute minimum
  },
  
  enabledAssets: ['BTC'],
  
  clobUrl: 'https://clob.polymarket.com',
  chainId: 137,
  dryRun: false,
  logLevel: 'info',
};

/**
 * MODERATE MODE - V35.10.0
 * Use after 50+ profitable markets in test mode
 */
export const MODERATE_CONFIG: V35Config = {
  mode: 'moderate',
  
  // Grid: 46 levels per side (5-95¢)
  gridMin: 0.05,
  gridMax: 0.95,
  gridStep: 0.02,
  sharesPerLevel: 5,
  
  // HEDGE PARAMETERS - V36.11.0: AGGRESSIVE REBALANCING
  enableActiveHedge: true,
  maxHedgeSlippage: 0.12,           // Accept up to 12¢ slippage
  hedgeTimeoutMs: 1500,             // 1.5s timeout
  minEdgeAfterHedge: -0.10,         // Max 10% loss OK
  maxCombinedCost: 1.00,            // Target break-even
  maxCombinedCostEmergency: 1.08,   // Emergency: accept 8% LOSS to fix!
  maxExpensiveBias: 1.30,           // Tighter ratio
  minHedgeNotional: 1.05,
  
  // Risk limits
  warnUnpairedShares: 15,
  criticalUnpairedShares: 30,
  maxUnpairedShares: 40,
  maxUnpairedImbalance: 40,
  maxImbalanceRatio: 2.0,
  maxLossPerMarket: 25,
  maxConcurrentMarkets: 3,
  maxMarkets: 3,
  maxNotionalPerMarket: 200,
  maxTotalExposure: 600,
  skewThreshold: 10,
  capitalPerMarket: 100,
  
  // Timing
  startDelayMs: 3000,
  stopBeforeExpirySec: 30,
  refreshIntervalMs: 500,
  
  // Features
  enableMomentumFilter: false,
  
  // V36.8.0: Volatility-based margin
  volatilityMargin: {
    enabled: true,
    lowVolATR: 0.10,
    highVolATR: 0.25,
    deltaMargins: {
      high: 0.10,
      medium: 0.07,
      low: 0.05,
      veryLow: 0.03,
    },
    volatilityMultipliers: {
      low: 1.0,
      medium: 0.7,
      high: 0.5,
    },
    minMargin: 0.02,
  },
  
  enabledAssets: ['BTC', 'ETH'],
  
  clobUrl: 'https://clob.polymarket.com',
  chainId: 137,
  dryRun: false,
  logLevel: 'info',
};

/**
 * PRODUCTION MODE - V35.10.0
 * Use after consistent profitability in moderate mode
 */
export const PRODUCTION_CONFIG: V35Config = {
  mode: 'production',
  
  // Grid: 46 levels per side (5-95¢)
  gridMin: 0.05,
  gridMax: 0.95,
  gridStep: 0.02,
  sharesPerLevel: 10,
  
  // HEDGE PARAMETERS - V36.11.0: AGGRESSIVE REBALANCING
  enableActiveHedge: true,
  maxHedgeSlippage: 0.12,           // Accept up to 12¢ slippage
  hedgeTimeoutMs: 1500,             // 1.5s timeout
  minEdgeAfterHedge: -0.10,         // Max 10% loss OK
  maxCombinedCost: 1.00,            // Target break-even
  maxCombinedCostEmergency: 1.08,   // Emergency: accept 8% LOSS to fix!
  maxExpensiveBias: 1.30,           // Tighter ratio
  minHedgeNotional: 1.05,
  
  // Risk limits
  warnUnpairedShares: 20,
  criticalUnpairedShares: 40,
  maxUnpairedShares: 50,
  maxUnpairedImbalance: 50,
  maxImbalanceRatio: 2.0,
  maxLossPerMarket: 50,
  maxConcurrentMarkets: 5,
  maxMarkets: 5,
  maxNotionalPerMarket: 500,
  maxTotalExposure: 2500,
  skewThreshold: 10,
  capitalPerMarket: 250,
  
  // Timing
  startDelayMs: 2000,
  stopBeforeExpirySec: 15,
  refreshIntervalMs: 500,
  
  // Features
  enableMomentumFilter: false,
  
  // V36.8.0: Volatility-based margin
  volatilityMargin: {
    enabled: true,
    lowVolATR: 0.10,
    highVolATR: 0.25,
    deltaMargins: {
      high: 0.10,
      medium: 0.07,
      low: 0.05,
      veryLow: 0.03,
    },
    volatilityMultipliers: {
      low: 1.0,
      medium: 0.7,
      high: 0.5,
    },
    minMargin: 0.02,
  },
  
  enabledAssets: ['BTC', 'ETH'],
  
  clobUrl: 'https://clob.polymarket.com',
  chainId: 137,
  dryRun: false,
  logLevel: 'info',
};

// Backwards compatibility alias
export const SAFE_CONFIG = TEST_CONFIG;

// Runtime config (can be overridden from database or environment)
let runtimeConfig: V35Config = { ...TEST_CONFIG };

export function getV35Config(): V35Config {
  return runtimeConfig;
}

export function loadV35Config(mode: V35Mode): V35Config {
  switch (mode) {
    case 'test':
      runtimeConfig = { ...TEST_CONFIG };
      break;
    case 'moderate':
      runtimeConfig = { ...MODERATE_CONFIG };
      break;
    case 'production':
      runtimeConfig = { ...PRODUCTION_CONFIG };
      break;
  }
  return runtimeConfig;
}

export function setV35ConfigOverrides(overrides: Partial<V35Config>): V35Config {
  runtimeConfig = { ...runtimeConfig, ...overrides };
  return runtimeConfig;
}

export function printV35Config(cfg: V35Config): void {
  console.log('\n' + '='.repeat(70));
  console.log(`  V35 GABAGOOL — ${cfg.mode.toUpperCase()} MODE (${V35_VERSION} "${V35_CODENAME}")`);
  console.log('='.repeat(70));
  console.log(`
  📊 GRID (passive limit orders)
     Range:           $${cfg.gridMin.toFixed(2)} - $${cfg.gridMax.toFixed(2)}
     Step:            $${cfg.gridStep.toFixed(2)}
     Levels per side: ${Math.floor((cfg.gridMax - cfg.gridMin) / cfg.gridStep) + 1}
     Shares/level:    ${cfg.sharesPerLevel}

  🎯 ACTIVE HEDGING (V35.10.0 CONTINUOUS MODE)
     Enabled:         ${cfg.enableActiveHedge ? '✅ YES' : '❌ NO'}
     Max slippage:    ${(cfg.maxHedgeSlippage * 100).toFixed(1)}¢
     Min edge:        ${(cfg.minEdgeAfterHedge * 100).toFixed(1)}%
     Max combined:    $${cfg.maxCombinedCost.toFixed(2)} (emergency: $${cfg.maxCombinedCostEmergency.toFixed(2)})
     Min notional:    $${cfg.minHedgeNotional?.toFixed(2) || '1.00'}

  📈 V36.8.0: VOLATILITY-SCALED MARGIN
     Enabled:         ${cfg.volatilityMargin?.enabled ? '✅ YES' : '❌ NO'}
     ATR thresholds:  LOW < ${(cfg.volatilityMargin?.lowVolATR || 0.10).toFixed(2)}% | HIGH > ${(cfg.volatilityMargin?.highVolATR || 0.25).toFixed(2)}%
     Delta margins:   HIGH=${(cfg.volatilityMargin?.deltaMargins?.high || 0.10) * 100}¢ MED=${(cfg.volatilityMargin?.deltaMargins?.medium || 0.07) * 100}¢ LOW=${(cfg.volatilityMargin?.deltaMargins?.low || 0.05) * 100}¢ VLOW=${(cfg.volatilityMargin?.deltaMargins?.veryLow || 0.03) * 100}¢
     Vol multipliers: LOW=${cfg.volatilityMargin?.volatilityMultipliers?.low || 1.0}x MED=${cfg.volatilityMargin?.volatilityMultipliers?.medium || 0.7}x HIGH=${cfg.volatilityMargin?.volatilityMultipliers?.high || 0.5}x
     Min margin:      ${(cfg.volatilityMargin?.minMargin || 0.02) * 100}¢

  🛡️ CIRCUIT BREAKER
     ⚠️ WARNING:      ${cfg.warnUnpairedShares} shares (block leading side)
     🔴 CRITICAL:     ${cfg.criticalUnpairedShares || cfg.maxUnpairedShares - 10} shares (cancel + prepare halt)
     🚨 ABSOLUTE:     ${cfg.maxUnpairedShares} shares (TRIP CIRCUIT BREAKER)
     Max ratio:       ${cfg.maxImbalanceRatio}:1
     Max loss/market: $${cfg.maxLossPerMarket}
     Max markets:     ${cfg.maxConcurrentMarkets}
     
  ⏱️ TIMING
     Start delay:     ${cfg.startDelayMs}ms after open
     Stop before exp: ${cfg.stopBeforeExpirySec}s
     Refresh:         ${cfg.refreshIntervalMs}ms
     
  🎯 ASSETS
     Trading:         ${cfg.enabledAssets.join(', ')}
     
  🧪 MODE
     Dry run:         ${cfg.dryRun}
`);
  console.log('='.repeat(70));
}
