#!/usr/bin/env bash
#
# Deploy whatever is on GitHub's main to the multising VM:
#
#     git push && deploy/deploy.sh
#
# The site is static and Caddy serves public/ straight out of the VM's
# checkout (bind-mounted read-only by multising's docker-compose.vm.yml), so a
# deploy is a pull: nothing to build, nothing to restart. As with multising,
# the VM pulls rather than being pushed at, so `git log -1` there is the
# honest answer to "what is live".

set -euo pipefail

TARGET="${TARGET:-multising}"

echo "[INFO] deploying to $TARGET"

ssh "$TARGET" 'set -euo pipefail
    cd ~/unsure-calc
    git pull --ff-only
    echo "[INFO] now at $(git log -1 --format="%h %s")"
    deploy/verify.sh'

echo "[OK] deployed"
