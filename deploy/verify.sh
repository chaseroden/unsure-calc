#!/usr/bin/env bash
#
# Is calc.wizbiz.ooo serving this checkout? Run on the VM from anywhere;
# deploy.sh runs it after every pull.
#
# It asks Caddy directly (--resolve to 127.0.0.1), so it tests the server and
# its certificate rather than DNS, and compares what comes back with the files
# on disk. A mismatch means Caddy is serving something other than this
# checkout: the bind mount in multising's docker-compose.vm.yml is missing or
# stale (recreate the caddy container), or the site block is not in its
# Caddyfile.

set -euo pipefail

HOST="${HOST:-calc.wizbiz.ooo}"
cd "$(dirname "$0")/.."

fail() {
    echo "[FAIL] $*" >&2
    echo "[INFO] logs:  docker logs --tail=50 caddy" >&2
    exit 1
}

# "" is the index page; the module is there to catch a half-updated mount.
for path in "" engine/evaluate.js; do
    file="public/${path:-index.html}"
    served="$(curl -fsS --max-time 10 --resolve "$HOST:443:127.0.0.1" "https://$HOST/$path" | sha256sum)" ||
        fail "no answer from https://$HOST/$path (no certificate yet, or no site block?)"
    [ "$served" = "$(sha256sum < "$file")" ] || fail "https://$HOST/$path is not $file from this checkout"
done

echo "[OK]   $HOST serving $(git log -1 --format='%h %s')"
