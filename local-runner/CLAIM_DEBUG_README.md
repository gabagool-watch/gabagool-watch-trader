# Polymarket Auto-Claim System

## Overview

The auto-claim system automatically redeems resolved Polymarket positions on-chain without requiring manual UI interaction. Claims happen permissionlessly via the ConditionalTokens contract.

## Quick Start

```bash
cd /home/deploy/app/local-runner

# Run a single claim cycle
npm run claim

# Start continuous claim loop (runs every 5 minutes)
npm run claim:loop

# Debug claim issues
npm run claim:debug
```

## Features

### ✅ Automatic Detection
- Polls for resolved markets every 5 minutes (configurable)
- Filters positions above minimum threshold ($0.10)
- Skips already-claimed positions

### ✅ On-Chain Redemption
- Direct EOA claiming via `redeemPositions()` on CTF contract
- Event-based confirmation (`PayoutRedemption` events)
- Batching support for gas efficiency

### ✅ Database Logging
All claims are logged to the `claim_logs` table:
- `market_id`, `condition_id`, `market_title`, `outcome`
- `shares_redeemed`, `usdc_received`
- `tx_hash`, `gas_used`, `gas_price_gwei`
- `status` (pending/confirmed/failed)
- `error_message`, `retry_count`

### ✅ Safety Guardrails
- Mutex lock prevents concurrent claim attempts
- Minimum threshold ($0.10) for gas efficiency
- Retry logic with exponential backoff (max 3 retries)
- Never claims before resolution
- Idempotent (safe to retry)

## Scripts

### `npm run claim`
Runs a single claim cycle immediately. Shows:
- Current claimable value
- Claim results (success/failure)
- Session statistics
- Post-claim reconciliation

### `npm run claim:loop [interval_minutes]`
Starts the continuous auto-claim loop:
```bash
npm run claim:loop        # Default 5 minute interval
npm run claim:loop 10     # 10 minute interval
npm run claim:loop 1      # 1 minute interval (aggressive)
```

### `npm run claim:debug`
Diagnoses claim issues by:
1. Listing wallet addresses (signer + proxy)
2. Fetching claimable positions from API
3. Querying on-chain claims (last hour)
4. Comparing API vs on-chain to find discrepancies
5. Running full reconciliation

## Integration with Trading Bot

The auto-claim loop is **automatically started** when you run the main trading bot:
```bash
npm run start  # Starts trader + auto-claim loop
```

The loop runs every 5 minutes in the background. On shutdown (Ctrl+C), it prints session statistics.

## Database Schema

### `claim_logs` table
```sql
id UUID PRIMARY KEY
market_id TEXT
condition_id TEXT NOT NULL
market_title TEXT
outcome TEXT
shares_redeemed NUMERIC
usdc_received NUMERIC
tx_hash TEXT
gas_used NUMERIC
gas_price_gwei NUMERIC
wallet_address TEXT NOT NULL
wallet_type TEXT (EOA/PROXY)
status TEXT (pending/confirmed/failed)
error_message TEXT
retry_count INTEGER
block_number BIGINT
created_at TIMESTAMPTZ
confirmed_at TIMESTAMPTZ
```

### `live_trade_results` columns added
```sql
claim_status TEXT (pending/claimed)
claim_tx_hash TEXT
claimed_at TIMESTAMPTZ
claim_usdc NUMERIC
```

## Understanding Discrepancies

| Issue | Icon | Meaning | Action |
|-------|------|---------|--------|
| `indexer_delay` | ⏳ | Claimed on-chain but API not updated | Wait 5-10 minutes |
| `wrong_wallet` | 👤 | Position belongs to different wallet | Cannot claim with current signer |
| `not_claimed` | ❌ | Never claimed on-chain | Bot should claim this |

## Proxy Wallet Mode

### V35.12.1 Update: Direct Proxy Wallet Claiming

Previous versions incorrectly tried to use `ProxyWalletFactory.proxy()`, but that doesn't work because it makes the factory the `msg.sender` in the CTF contract, not the proxy wallet.

**How it actually works:**
- Polymarket Magic/Email accounts use a Proxy Wallet pattern
- The proxy wallet has an `execute(address to, bytes data)` function
- Only the owner (your signer wallet) can call this function
- When you call `proxyWallet.execute(CTF, redeemPositions(...))`, the proxy wallet becomes `msg.sender` in the CTF contract
- This allows the CTF to correctly verify that the caller owns the tokens

**Wallet architecture (Magic/Email accounts):**
```
Signer (EOA) ─────► Proxy Wallet ─────► CTF Contract
    │                    │                   │
    │ calls execute()    │ becomes msg.sender│ redeems tokens
    │ pays gas           │ holds tokens      │
    └────────────────────┴───────────────────┘
```

**For Browser wallets (MetaMask, etc.):**
- These use Gnosis Safe architecture
- We call `safe.execTransaction(...)` directly on the Safe contract
- The signer must be an owner of the Safe

**If claims still fail:**
1. Verify `POLYMARKET_ADDRESS` matches your proxy wallet address (visible in Polymarket UI)
2. Ensure the signer wallet has MATIC for gas (~0.05 MATIC per claim)
3. Check that the signer is the owner of the proxy (should be automatic for Magic exports)
4. Set `POLYMARKET_SIGNATURE_TYPE=1` for Magic/Email or `=2` for Safe/Browser wallets
5. Run `npm run claim:debug` to diagnose issues

**Manual claiming (fallback):**
1. Go to https://polymarket.com/portfolio
2. Connect your wallet (same one used to trade)
3. Click "Claim" on each resolved market

## Troubleshooting

### "Nothing to claim"
- All positions below minimum threshold ($0.10)
- All positions already confirmed claimed
- No resolved markets with winning outcomes

### "Position wallet doesn't match signer or config proxy"
This means the position is held by a different wallet than expected:
1. Check your POLYMARKET_ADDRESS env variable
2. It should match the wallet shown in the API response
3. Update your config and restart

### Nonce errors
The system uses a mutex to prevent parallel claim attempts. If you see nonce errors, wait for the current claim to complete.

### RPC errors
The system automatically rotates between multiple RPC endpoints on failure with rate limit handling.

### Claims stuck as "pending"
Run `npm run claim:debug` to see on-chain status vs API status. Indexer delays of 5-10 minutes are normal.
