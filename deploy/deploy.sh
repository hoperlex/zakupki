#!/usr/bin/env bash
#
# Controlled app deploy for zakupki on the VPS. Run from the repo root on the
# server (typically:  sudo bash deploy/deploy.sh).
#
# NON-destructive: runs db:migrate, NEVER db:reset. Infra bits (TLS cert +
# infra-nginx vhost) are a separate one-time step — see deploy/README / PLAN.md.
#
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
COMPOSE=(docker compose -f deploy/docker-compose.yml -p zakupki)

echo "==> Preflight ($ROOT)"
[ -f .env.production ]       || { echo "!! missing .env.production"; exit 1; }
[ -f certs/yandex-root.crt ] || { echo "!! missing certs/yandex-root.crt"; exit 1; }
docker network inspect edge >/dev/null 2>&1 || { echo "!! docker network 'edge' missing"; exit 1; }

echo "==> Build images"
"${COMPOSE[@]}" build

echo "==> DB migrations (SSL CA; no reset)"
"${COMPOSE[@]}" run --rm --no-deps api pnpm --filter @zakupki/db db:migrate

echo "==> Start stack"
"${COMPOSE[@]}" up -d api web

echo "==> Status"
"${COMPOSE[@]}" ps

echo "==> Health (inside api container)"
sleep 4
docker exec zakupki-api node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>r.json()).then(j=>console.log('health:',JSON.stringify(j))).catch(e=>{console.error('health failed:',e.message);process.exit(1)})"

echo "==> App deploy done. If first deploy: issue TLS cert for zak.su10.ru and"
echo "    install deploy/conf.d/zakupki.conf into /opt/infra/nginx/conf.d/ (see README)."
