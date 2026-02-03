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

## Wallet Types & Redemption Paths (V35.16.0)

### EOA Wallets (Direct)
When `POLYMARKET_ADDRESS` equals the signer wallet or is not set:
- Direct `CTF.redeemPositions()` calls
- Signer pays gas (MATIC)
- Works immediately

### Magic/Email Wallets (Proxy Mode)
When `POLYMARKET_ADDRESS` differs from signer AND `POLYMARKET_SIGNATURE_TYPE=1`:

**V35.16.0 Flow:**
1. **Relayer API (Primary)** - Gasless redemption via Polymarket backend
   - Requires Builder API credentials (`POLY_BUILDER_*`)
   - No gas required from signer
   - May fail if Relayer is down or deprecated

2. **proxy.proxy() Fallback** - Direct on-chain via proxy
   - ⚠️ Usually FAILS for Magic wallets (signer not authorized)
   - Only works if signer controls the proxy

3. **Manual Claim** - If both fail
   - Go to https://polymarket.com/portfolio
   - Connect wallet and click "Claim"

**Important:** For Magic/Email accounts, the exported private key is ONLY for L2 order signing, NOT for direct on-chain proxy control. The Relayer API is the only reliable automated path.

### Browser Wallets (Gnosis Safe)
When `POLYMARKET_SIGNATURE_TYPE=2`:
- Uses `safe.execTransaction()` 
- Signer must be a Safe owner

## Configuration

### Required Environment Variables
```bash
# Wallet
POLYMARKET_PRIVATE_KEY=0x...          # Signer private key
POLYMARKET_ADDRESS=0x...              # Proxy wallet address (if different from signer)
POLYMARKET_SIGNATURE_TYPE=1           # 0=EOA, 1=Magic/Email, 2=Safe

# Builder API (required for Magic wallets)
POLY_BUILDER_API_KEY=your_key
POLY_BUILDER_API_SECRET=your_secret
POLY_BUILDER_PASSPHRASE=your_passphrase

# USDC Contract
POLYMARKET_USDC_ADDRESS=0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
```

## Troubleshooting

### "Relayer HTTP 404"
The Relayer API endpoint may be deprecated or temporarily unavailable.
- The system will fall back to `proxy.proxy()` (may fail)
- If all methods fail, manual claim is required

### "execution reverted" on proxy.proxy()
This means the signer is NOT authorized to call `proxy()` on the proxy wallet.
- This is expected for Magic/Email wallets
- The Relayer API is the correct path for these wallets
- If Relayer is down, manual claim at polymarket.com is required

### "Nothing to claim"
- All positions below minimum threshold ($0.10)
- All positions already confirmed claimed
- No resolved markets with winning outcomes

### "Position wallet doesn't match signer or config proxy"
The position is held by a different wallet than configured:
1. Check your POLYMARKET_ADDRESS env variable
2. It should match the wallet shown in the API response
3. Update your config and restart

### Nonce errors
The system uses a mutex to prevent parallel claim attempts. If you see nonce errors, wait for the current claim to complete.

### RPC errors
The system automatically rotates between multiple RPC endpoints on failure with rate limit handling.

### "INSUFFICIENT_FUNDS"
The signer wallet needs MATIC for gas:
1. Check balance: `cast balance 0x6E848Dcf... --rpc-url https://polygon-rpc.com`
2. Send 0.02-0.05 MATIC to the signer address
3. Retry claim

### Magic/Email wallet claims failing
For Magic Link (email) accounts:
1. Configure Builder API credentials (required for Relayer API)
2. If Relayer fails, manual claim at https://polymarket.com/portfolio
3. Direct `proxy.proxy()` will NOT work (signer unauthorized)

### Claims stuck as "pending"
Run `npm run claim:debug` to see on-chain status vs API status. Indexer delays of 5-10 minutes are normal.
