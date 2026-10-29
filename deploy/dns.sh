#!/usr/bin/env bash
#
# Point calc.wizbiz.ooo at the multising Linode, whose Caddy serves this site.
# Run from debussy (or anywhere with an authenticated linode-cli).
#
# Safe to re-run, and it has to be re-run after the multising VM is rebuilt:
# a replacement VM gets a new address, and multising's provision.sh only
# repoints its own record.

set -euo pipefail

LABEL="${LABEL:-multising}"
DOMAIN="${DOMAIN:-wizbiz.ooo}"
SUBDOMAIN="${SUBDOMAIN:-calc}"
FQDN="$SUBDOMAIN.$DOMAIN"

lin() { linode-cli --suppress-warnings "$@"; }

IP="$(lin linodes list --json | jq -r --arg l "$LABEL" \
    '.[] | select(.label == $l) | .ipv4[0]' | head -1)"
[ -n "$IP" ] || { echo "[ERR] no linode labelled $LABEL"; exit 1; }

DOMAIN_ID="$(lin domains list --json | jq -r --arg d "$DOMAIN" \
    '.[] | select(.domain == $d) | .id' | head -1)"
[ -n "$DOMAIN_ID" ] || { echo "[ERR] no DNS zone for $DOMAIN (multising's provision.sh creates it)"; exit 1; }

REC_ID="$(lin domains records-list "$DOMAIN_ID" --json | jq -r --arg n "$SUBDOMAIN" \
    '.[] | select(.type == "A" and .name == $n) | .id' | head -1)"

if [ -n "$REC_ID" ]; then
    echo "[INFO] pointing $FQDN at $IP"
    lin domains records-update "$DOMAIN_ID" "$REC_ID" --target "$IP" --ttl_sec 300 > /dev/null
else
    echo "[INFO] creating $FQDN -> $IP"
    lin domains records-create "$DOMAIN_ID" --type A --name "$SUBDOMAIN" \
        --target "$IP" --ttl_sec 300 > /dev/null
fi

echo "[OK] $FQDN -> $IP"
echo "[INFO] Linode publishes zone changes on a schedule (minutes, up to ~15)."
echo "       Caddy retries the certificate on its own once it resolves. Watch:"
echo "         dig +short A $FQDN @ns1.linode.com"
