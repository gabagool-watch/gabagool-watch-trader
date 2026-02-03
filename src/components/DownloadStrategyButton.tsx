import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileCode, Loader2 } from 'lucide-react';
import JSZip from 'jszip';

// V35 Strategy files - complete set for expert review
const V35_STRATEGY_FILES = [
  // V35 Core
  { folder: 'v35', name: 'index.ts', path: 'local-runner/src/v35/index.ts' },
  { folder: 'v35', name: 'runner.ts', path: 'local-runner/src/v35/runner.ts' },
  { folder: 'v35', name: 'config.ts', path: 'local-runner/src/v35/config.ts' },
  { folder: 'v35', name: 'types.ts', path: 'local-runner/src/v35/types.ts' },
  { folder: 'v35', name: 'utils.ts', path: 'local-runner/src/v35/utils.ts' },
  
  // V35 Market & Pricing
  { folder: 'v35', name: 'market-discovery.ts', path: 'local-runner/src/v35/market-discovery.ts' },
  { folder: 'v35', name: 'market-pricing.ts', path: 'local-runner/src/v35/market-pricing.ts' },
  { folder: 'v35', name: 'quoting-engine.ts', path: 'local-runner/src/v35/quoting-engine.ts' },
  { folder: 'v35', name: 'v36-quoting-engine.ts', path: 'local-runner/src/v35/v36-quoting-engine.ts' },
  
  // V35 Order & Position Management
  { folder: 'v35', name: 'order-manager.ts', path: 'local-runner/src/v35/order-manager.ts' },
  { folder: 'v35', name: 'hedge-manager.ts', path: 'local-runner/src/v35/hedge-manager.ts' },
  { folder: 'v35', name: 'pair-tracker.ts', path: 'local-runner/src/v35/pair-tracker.ts' },
  { folder: 'v35', name: 'fill-tracker.ts', path: 'local-runner/src/v35/fill-tracker.ts' },
  { folder: 'v35', name: 'fill-sync-tracker.ts', path: 'local-runner/src/v35/fill-sync-tracker.ts' },
  
  // V35 Risk & Safety
  { folder: 'v35', name: 'circuit-breaker.ts', path: 'local-runner/src/v35/circuit-breaker.ts' },
  { folder: 'v35', name: 'reversal-detector.ts', path: 'local-runner/src/v35/reversal-detector.ts' },
  { folder: 'v35', name: 'proactive-rebalancer.ts', path: 'local-runner/src/v35/proactive-rebalancer.ts' },
  { folder: 'v35', name: 'emergency-recovery.ts', path: 'local-runner/src/v35/emergency-recovery.ts' },
  { folder: 'v35', name: 'expiry-snapshot.ts', path: 'local-runner/src/v35/expiry-snapshot.ts' },
  
  // V35 Data & Feeds
  { folder: 'v35', name: 'backend.ts', path: 'local-runner/src/v35/backend.ts' },
  { folder: 'v35', name: 'binance-feed.ts', path: 'local-runner/src/v35/binance-feed.ts' },
  { folder: 'v35', name: 'combined-book.ts', path: 'local-runner/src/v35/combined-book.ts' },
  { folder: 'v35', name: 'depth-parser.ts', path: 'local-runner/src/v35/depth-parser.ts' },
  { folder: 'v35', name: 'user-ws.ts', path: 'local-runner/src/v35/user-ws.ts' },
  
  // Core shared modules
  { folder: 'core', name: 'hard-invariants.ts', path: 'local-runner/src/hard-invariants.ts' },
  { folder: 'core', name: 'inventory-risk.ts', path: 'local-runner/src/inventory-risk.ts' },
  { folder: 'core', name: 'price-guard.ts', path: 'local-runner/src/price-guard.ts' },
  { folder: 'core', name: 'burst-limiter.ts', path: 'local-runner/src/burst-limiter.ts' },
  { folder: 'core', name: 'order-rate-limiter.ts', path: 'local-runner/src/order-rate-limiter.ts' },
  { folder: 'core', name: 'sell-policy.ts', path: 'local-runner/src/sell-policy.ts' },
  { folder: 'core', name: 'hedge-priority.ts', path: 'local-runner/src/hedge-priority.ts' },
  { folder: 'core', name: 'hedge-escalator.ts', path: 'local-runner/src/hedge-escalator.ts' },
  { folder: 'core', name: 'exposure-ledger.ts', path: 'local-runner/src/exposure-ledger.ts' },
  { folder: 'core', name: 'accounting-ledger.ts', path: 'local-runner/src/accounting-ledger.ts' },
  { folder: 'core', name: 'position-cache.ts', path: 'local-runner/src/position-cache.ts' },
  { folder: 'core', name: 'positions-sync.ts', path: 'local-runner/src/positions-sync.ts' },
  { folder: 'core', name: 'market-state-manager.ts', path: 'local-runner/src/market-state-manager.ts' },
  { folder: 'core', name: 'market-mutex.ts', path: 'local-runner/src/market-mutex.ts' },
  { folder: 'core', name: 'config.ts', path: 'local-runner/src/config.ts' },
  { folder: 'core', name: 'resolved-config.ts', path: 'local-runner/src/resolved-config.ts' },
  { folder: 'core', name: 'polymarket.ts', path: 'local-runner/src/polymarket.ts' },
  { folder: 'core', name: 'backend.ts', path: 'local-runner/src/backend.ts' },
  { folder: 'core', name: 'authManager.ts', path: 'local-runner/src/authManager.ts' },
  { folder: 'core', name: 'chain.ts', path: 'local-runner/src/chain.ts' },
  { folder: 'core', name: 'telemetry.ts', path: 'local-runner/src/telemetry.ts' },
  { folder: 'core', name: 'logger.ts', path: 'local-runner/src/logger.ts' },
  
  // Documentation
  { folder: 'docs', name: 'v8-strategy.md', path: 'local-runner/docs/v8-strategy.md' },
  { folder: 'docs', name: 'strategy-spec-v7-revC.md', path: 'local-runner/docs/strategy-spec-v7-revC.md' },
  { folder: 'docs', name: 'revC4-hard-invariants-fix-request.txt', path: 'local-runner/docs/revC4-hard-invariants-fix-request.txt' },
  { folder: 'docs', name: 'revC4.1-concurrency-burst-halt.txt', path: 'local-runner/docs/revC4.1-concurrency-burst-halt.txt' },
  { folder: 'docs', name: 'revC4.2-pnl-accounting-sell-policy.txt', path: 'local-runner/docs/revC4.2-pnl-accounting-sell-policy.txt' },
];

export function DownloadStrategyButton() {
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const downloadStrategy = async () => {
    setIsDownloading(true);
    setError(null);
    
    try {
      const zip = new JSZip();
      const rootFolder = zip.folder('polymarket-strategy-v35-review');
      
      if (!rootFolder) throw new Error('Failed to create zip folder');

      // Create subfolders
      const v35Folder = rootFolder.folder('v35');
      const coreFolder = rootFolder.folder('core');
      const docsFolder = rootFolder.folder('docs');

      // Fetch all strategy files in parallel
      const fileContents = await Promise.all(
        V35_STRATEGY_FILES.map(async (file) => {
          try {
            const response = await fetch(`/${file.path}`, {
              headers: { 'Accept': 'text/plain' }
            });
            if (!response.ok) {
              console.warn(`Could not fetch ${file.path}: ${response.status}`);
              return { ...file, content: `// File not available in production build\n// Path: ${file.path}` };
            }
            const content = await response.text();
            return { ...file, content };
          } catch (err) {
            console.warn(`Error fetching ${file.path}:`, err);
            return { ...file, content: `// File not available\n// Path: ${file.path}` };
          }
        })
      );

      // Add files to appropriate folders
      for (const file of fileContents) {
        const folder = file.folder === 'v35' ? v35Folder :
                       file.folder === 'docs' ? docsFolder : coreFolder;
        folder?.file(file.name, file.content);
      }

      // Add comprehensive README for expert review
      const readme = `# Polymarket Trading Strategy V35 - Expert Review Package
Generated: ${new Date().toISOString()}

## Overview

This package contains the complete V35 passive market-making strategy for Polymarket 15-minute UP/DOWN markets.
The strategy provides liquidity on both sides and profits from the bid-ask spread while managing inventory risk.

## Architecture

### V35 - Passive Market Maker
The main strategy that quotes on both sides of UP/DOWN markets:

**Core Engine:**
- \`v35/runner.ts\`: Main trading loop with market rotation
- \`v35/quoting-engine.ts\`: Calculates fair prices and generates quotes
- \`v35/v36-quoting-engine.ts\`: Enhanced quoting with reversal detection
- \`v35/config.ts\`: V35-specific configuration
- \`v35/types.ts\`: TypeScript type definitions

**Market & Pricing:**
- \`v35/market-discovery.ts\`: Discovers active UP/DOWN markets
- \`v35/market-pricing.ts\`: Fair value calculation based on spot vs strike
- \`v35/binance-feed.ts\`: Real-time spot price feed from Binance
- \`v35/combined-book.ts\`: Aggregated orderbook from multiple sources
- \`v35/depth-parser.ts\`: Orderbook depth parsing and analysis

**Position Management:**
- \`v35/order-manager.ts\`: Order placement and lifecycle management
- \`v35/hedge-manager.ts\`: Inventory hedging when positions become imbalanced
- \`v35/pair-tracker.ts\`: Tracks paired UP+DOWN positions (locked profit)
- \`v35/fill-tracker.ts\`: Tracks fills and updates positions
- \`v35/fill-sync-tracker.ts\`: Syncs fills with database

**Risk & Safety:**
- \`v35/circuit-breaker.ts\`: Halts trading on anomalies
- \`v35/reversal-detector.ts\`: Detects price reversals (crossing strike)
- \`v35/proactive-rebalancer.ts\`: Rebalances inventory before expiry
- \`v35/emergency-recovery.ts\`: Recovery from error states
- \`v35/expiry-snapshot.ts\`: Captures state at market expiry

### Core Shared Modules

**Risk Management:**
- \`core/hard-invariants.ts\`: Position caps, freeze rules, CPP limits
- \`core/inventory-risk.ts\`: Inventory skew management
- \`core/price-guard.ts\`: Price validation and sanity checks
- \`core/exposure-ledger.ts\`: Tracks USD exposure per market

**Order Execution:**
- \`core/order-rate-limiter.ts\`: Rate limiting per market/token
- \`core/burst-limiter.ts\`: Burst protection to avoid API blocks
- \`core/sell-policy.ts\`: When and how to exit positions

**Position Tracking:**
- \`core/position-cache.ts\`: In-memory position state
- \`core/positions-sync.ts\`: Syncs with Polymarket API
- \`core/market-state-manager.ts\`: Market lifecycle states
- \`core/accounting-ledger.ts\`: P&L tracking

**Infrastructure:**
- \`core/polymarket.ts\`: CLOB API wrapper
- \`core/backend.ts\`: Supabase backend integration
- \`core/authManager.ts\`: API authentication
- \`core/chain.ts\`: Blockchain interaction
- \`core/telemetry.ts\`: Metrics and logging

## Key Concepts

### Passive Market Making
The bot places limit orders on both UP and DOWN sides, earning the spread when both fill.
Unlike aggressive strategies, it waits for others to take liquidity.

### Fair Value Calculation
When spot price is near strike, fair value for UP/DOWN is ~50/50.
The bot adjusts quotes based on:
- Distance from strike price
- Time remaining until expiry
- Current inventory imbalance

### Paired Positions
When holding both UP and DOWN shares, the outcome is guaranteed:
- Paired shares: locked profit = 1.00 - (avgUp + avgDown)
- Unpaired shares: at-risk inventory

### Reversal Detection
When spot price crosses the strike, the expected winner changes.
The bot needs to manage unpaired inventory during reversals.

## Configuration

Key parameters in \`v35/config.ts\`:
- Quote width and depth
- Maximum position sizes
- Hedge thresholds
- Circuit breaker conditions

## Files Structure

\`\`\`
├── v35/           # V35 Passive Market Maker (24 files)
├── core/          # Shared infrastructure (20 files)
└── docs/          # Strategy documentation (5 files)
\`\`\`

## Questions for Review

1. Is the quoting engine calculating fair values correctly?
2. How does the bot handle high-reversal (choppy) markets?
3. Are the hedge triggers appropriately timed?
4. Is inventory risk being managed effectively?
5. Are there race conditions in the order/fill flow?
6. How can performance in 5+ crossing markets be improved?

## Recent Findings

Analysis of last 24 hours shows:
- 0-2 crossings: 66-100% win rate
- 3-4 crossings: 62-67% win rate  
- 5+ crossings: 47% win rate (major loss driver)

The strategy needs improvement for choppy/ranging markets.

---
Package Version: V35
Generated: ${new Date().toISOString()}
`;
      rootFolder.file('README.md', readme);

      const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `polymarket-strategy-v35-review-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading strategy:', err);
      setError('Download failed');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Button
      onClick={downloadStrategy}
      disabled={isDownloading}
      variant="outline"
      size="sm"
      className="font-mono text-xs"
      title={error || undefined}
    >
      {isDownloading ? (
        <Loader2 className="w-3 h-3 mr-2 animate-spin" />
      ) : (
        <FileCode className="w-3 h-3 mr-2" />
      )}
      {isDownloading ? 'Creating...' : 'V35 Strategy Export'}
    </Button>
  );
}
