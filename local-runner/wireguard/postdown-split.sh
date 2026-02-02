#!/bin/bash
# =============================================================================
# SPLIT TUNNEL CLEANUP
# =============================================================================
set -euo pipefail

WG_IF="wg0"

# Remove Polymarket-specific routes (ignore errors)
POLYMARKET_DOMAINS=(
  "clob.polymarket.com"
  "gamma-api.polymarket.com"
  "relayer.polymarket.com"
  "polymarket.com"
  "strapi-matic.poly.market"
  "data-api.polymarket.com"
)

for domain in "${POLYMARKET_DOMAINS[@]}"; do
  ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
  for ip in $ips; do
    if [[ -n "$ip" ]]; then
      ip route del "$ip/32" dev "$WG_IF" 2>/dev/null || true
    fi
  done
done

# Remove Cloudflare ranges
CLOUDFLARE_POLYMARKET_RANGES=(
  "104.18.0.0/16"
  "104.19.0.0/16"
  "172.67.0.0/16"
)

for range in "${CLOUDFLARE_POLYMARKET_RANGES[@]}"; do
  ip route del "$range" dev "$WG_IF" 2>/dev/null || true
done

# Reset iptables policies
iptables -P OUTPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P INPUT ACCEPT

# Remove NAT
iptables -t nat -D POSTROUTING -o "$WG_IF" -j MASQUERADE 2>/dev/null || true

echo "[postdown-split] Split tunnel routes removed."
