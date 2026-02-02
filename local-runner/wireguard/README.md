# WireGuard Configuration for Mullvad VPN

## Two Modes Available

### 1. **Full VPN Mode** (Original - Kill Switch)
All traffic goes through VPN. If VPN drops, nothing works.
- Use: `postup.sh` / `postdown.sh`

### 2. **Split Tunnel Mode** (NEW - Recommended)
Only Polymarket traffic goes through VPN. Everything else (Binance, Supabase, other apps) uses normal internet.
- Use: `postup-split.sh` / `postdown-split.sh`

---

## Setup Instructions

1. **Get your Mullvad WireGuard config**
   - Log into https://mullvad.net/account
   - Go to WireGuard configuration
   - Generate/download a config for your chosen location

2. **Place the config file**
   Create: `local-runner/wireguard/wg_confs/wg0.conf`

3. **Choose your mode** in `wg0.conf`:

   **For Split Tunnel (recommended):**
   ```ini
   [Interface]
   PrivateKey = YOUR_PRIVATE_KEY_HERE
   Address = 10.x.x.x/32
   DNS = 1.1.1.1
   PostUp = /config/postup-split.sh
   PostDown = /config/postdown-split.sh

   [Peer]
   PublicKey = MULLVAD_SERVER_PUBLIC_KEY
   AllowedIPs = 0.0.0.0/0
   Endpoint = MULLVAD_SERVER:51820
   ```

   **For Full VPN (strict kill-switch):**
   ```ini
   [Interface]
   PostUp = /config/postup.sh
   PostDown = /config/postdown.sh
   ```

---

## Split Tunnel Details

The split tunnel routes **only these domains** through VPN:
- `clob.polymarket.com`
- `gamma-api.polymarket.com`
- `relayer.polymarket.com`
- `polymarket.com`
- `strapi-matic.poly.market`
- `data-api.polymarket.com`
- Cloudflare IP ranges: `104.18.0.0/16`, `104.19.0.0/16`, `172.67.0.0/16`

**Everything else** (Binance WebSocket, Supabase, Chainlink, your other apps) goes through normal internet = **lower latency!**

---

## Verification

**Check which IP Polymarket sees:**
```bash
docker exec wg curl -s https://am.i.mullvad.net/json | jq .
```

**Check Binance uses normal internet (not VPN):**
```bash
docker exec trading-bot curl -s https://api.ipify.org
```

---

## Manual Claim Testing (inside container)

You must run test scripts **inside the `trading-bot` container** to use the VPN:
```bash
# SSH into VPS, then:
docker exec -it trading-bot sh

# Inside container:
npx tsx scripts/test-relayer-redeem-v2.ts <conditionId>
```

Or as a one-liner from the host:
```bash
docker exec -it trading-bot npx tsx scripts/test-relayer-redeem-v2.ts <conditionId>
```

---

## Troubleshooting

1. **Check WireGuard is connected:**
   ```bash
   docker exec wg wg show
   ```

2. **Check routing table:**
   ```bash
   docker exec wg ip route
   ```

3. **Test Polymarket connectivity:**
   ```bash
   docker exec wg curl -s https://clob.polymarket.com/health
   ```

---

## Important Notes

- **Never commit** your actual `wg0.conf` with private keys!
- Split tunnel removes the kill-switch for non-Polymarket traffic
- If Polymarket adds new domains/IPs, update `postup-split.sh`
