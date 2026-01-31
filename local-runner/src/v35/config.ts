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

export const V35_VERSION = 'V36.4.3';
export const V35_CODENAME = 'Fill Audit Fallback - Zero Data Loss';

export type V35Mode = 'test' | 'moderate' | 'production';

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
  
  // HEDGE PARAMETERS - V36.4.0: TARGET 0.95 CPP, 1 PAIR AT A TIME
  enableActiveHedge: true,
  maxHedgeSlippage: 0.10,           // Accept up to 10¢ slippage for hedge
  hedgeTimeoutMs: 2000,             // 2 second timeout
  minEdgeAfterHedge: -0.05,         // Max 5% loss for hedge
  maxCombinedCost: 0.95,            // Target 5% profit ($0.95 combined)
  maxCombinedCostEmergency: 1.00,   // Emergency: break-even max
  maxExpensiveBias: 1.50,           // Expensive side can have 50% more shares
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
  
  // HEDGE PARAMETERS - V35.10.0 CONTINUOUS HEDGE
  enableActiveHedge: true,
  maxHedgeSlippage: 0.08,
  hedgeTimeoutMs: 2000,
  minEdgeAfterHedge: -0.15,
  maxCombinedCost: 1.02,
  maxCombinedCostEmergency: 1.15,
  maxExpensiveBias: 1.50,
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
  
  // HEDGE PARAMETERS - V35.10.0 CONTINUOUS HEDGE
  enableActiveHedge: true,
  maxHedgeSlippage: 0.08,
  hedgeTimeoutMs: 2000,
  minEdgeAfterHedge: -0.15,
  maxCombinedCost: 1.02,
  maxCombinedCostEmergency: 1.15,
  maxExpensiveBias: 1.50,
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
