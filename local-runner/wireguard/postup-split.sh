#!/bin/bash
# =============================================================================
# SPLIT TUNNEL: Only Polymarket traffic goes through VPN
# All other traffic (Binance, Supabase, etc.) uses normal internet
# =============================================================================
set -euo pipefail

WG_IF="wg0"

# Detect default WAN route (Docker bridge)
WAN_GW="$(ip route show default 2>/dev/null | awk '/default/ {print $3; exit}')"
WAN_IF="$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')"

# Detect endpoint from wireguard runtime state
ENDPOINT="$(wg show "$WG_IF" endpoints 2>/dev/null | awk 'NR==1 {print $2}')"
ENDPOINT_HOST="${ENDPOINT%:*}"
ENDPOINT_PORT="${ENDPOINT##*:}"

# Resolve endpoint to IP if needed
ENDPOINT_IP="$ENDPOINT_HOST"
if [[ -n "${ENDPOINT_HOST:-}" ]] && ! [[ "$ENDPOINT_HOST" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
  ENDPOINT_IP="$(getent ahostsv4 "$ENDPOINT_HOST" 2>/dev/null | awk 'NR==1 {print $1}')"
fi

echo "[postup-split] WG_IF=$WG_IF WAN_IF=${WAN_IF:-?} WAN_GW=${WAN_GW:-?} ENDPOINT=${ENDPOINT:-?}"

# Route WireGuard endpoint over WAN so the tunnel stays up
if [[ -n "${ENDPOINT_IP:-}" ]] && [[ -n "${WAN_GW:-}" ]] && [[ -n "${WAN_IF:-}" ]]; then
  ip route replace "$ENDPOINT_IP/32" via "$WAN_GW" dev "$WAN_IF" || true
fi

# =============================================================================
# POLYMARKET IPs - Route these through the VPN
# =============================================================================
# Resolve Polymarket domains and route them via VPN
POLYMARKET_DOMAINS=(
  "clob.polymarket.com"
  "gamma-api.polymarket.com"
  "relayer.polymarket.com"
  "polymarket.com"
  "strapi-matic.poly.market"
  "data-api.polymarket.com"
)

echo "[postup-split] Resolving Polymarket domains..."

for domain in "${POLYMARKET_DOMAINS[@]}"; do
  # Get all IPs for the domain
  ips=$(getent ahostsv4 "$domain" 2>/dev/null | awk '{print $1}' | sort -u || true)
  for ip in $ips; do
    if [[ -n "$ip" ]]; then
      echo "[postup-split] Routing $domain ($ip) via VPN"
      ip route replace "$ip/32" dev "$WG_IF" || true
    fi
  done
done

# Also route Cloudflare IPs that Polymarket uses (common ranges)
# Polymarket is behind Cloudflare, so we route their common ranges
CLOUDFLARE_POLYMARKET_RANGES=(
  "104.18.0.0/16"
  "104.19.0.0/16"
  "172.67.0.0/16"
)

for range in "${CLOUDFLARE_POLYMARKET_RANGES[@]}"; do
  echo "[postup-split] Routing Cloudflare range $range via VPN"
  ip route replace "$range" dev "$WG_IF" || true
done

# =============================================================================
# IPTABLES: Allow all traffic (no kill-switch for non-VPN traffic)
# =============================================================================
# Reset to permissive policies
iptables -P OUTPUT ACCEPT
iptables -P FORWARD ACCEPT
iptables -P INPUT ACCEPT

# NAT for traffic going through VPN
iptables -t nat -D POSTROUTING -o "$WG_IF" -j MASQUERADE 2>/dev/null || true
iptables -t nat -A POSTROUTING -o "$WG_IF" -j MASQUERADE

echo "[postup-split] Split tunnel applied: Polymarket via VPN, rest via normal internet."
