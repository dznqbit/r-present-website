#!/usr/bin/env bash
# Update the admin on the Pi to the latest main and restart it.
# Run on the Pi:  /srv/r-present/repo/devops/pi/deploy.sh
set -euo pipefail
export PATH=/opt/node/bin:$PATH
REPO=/srv/r-present/repo

cd "$REPO"
git pull --ff-only

echo "== website deps (astro sync, prettier, preview builds)"
(cd apps/r-present-website && npm ci --no-audit --no-fund)

echo "== backend"
(cd apps/r-present-admin-backend && npm ci --no-audit --no-fund && npm run build)

echo "== admin SPA"
(cd apps/r-present-admin && npm ci --no-audit --no-fund && npm run build)

sudo systemctl restart r-present-admin-backend
echo "Deployed $(git rev-parse --short HEAD)"
