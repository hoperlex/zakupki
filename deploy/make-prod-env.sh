#!/usr/bin/env bash
#
# Generate a production env file for the VPS by combining prod config with the
# SECRETS taken from a source .env — WITHOUT printing any secret value to the
# terminal (only a line count is shown). See deploy/SECURITY.md.
#
# Usage:  deploy/make-prod-env.sh [SOURCE_ENV] [OUT_FILE]
#   SOURCE_ENV default: .env
#   OUT_FILE   default: deploy/.env.production.out  (gitignored; scp to the VPS)
#
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${1:-.env}"
OUT="${2:-deploy/.env.production.out}"
[ -r "$SRC" ] || { echo "ERROR: source env '$SRC' not found/readable" >&2; exit 1; }

# read a single key's value from SRC without echoing it
getv() { grep -E "^$1=" "$SRC" | head -1 | cut -d= -f2-; }

DB=$(getv DATABASE_URL)
JA=$(getv JWT_ACCESS_SECRET)
JR=$(getv JWT_REFRESH_SECRET)
SMTP_HOST=$(getv SMTP_HOST); SMTP_PORT=$(getv SMTP_PORT)
SMTP_USER=$(getv SMTP_USER); SMTP_PASS=$(getv SMTP_PASS)
INN=$(getv INN_LOOKUP_TOKEN)

[ -n "$DB" ] || { echo "ERROR: DATABASE_URL missing in $SRC" >&2; exit 1; }
[ -n "$JA" ] || { echo "ERROR: JWT_ACCESS_SECRET missing in $SRC" >&2; exit 1; }
[ -n "$JR" ] || { echo "ERROR: JWT_REFRESH_SECRET missing in $SRC" >&2; exit 1; }

umask 077
{
  echo "NODE_ENV=production"
  echo "API_HOST=0.0.0.0"
  echo "API_PORT=3000"
  echo "TRUST_PROXY=true"
  echo "WEB_ORIGIN=https://zak.su10.ru"
  echo "PUBLIC_WEB_URL=https://zak.su10.ru"
  echo "DATABASE_URL=$DB"
  echo "DATABASE_SSL_CA=/app/certs/yandex-root.crt"
  echo "JWT_ACCESS_SECRET=$JA"
  echo "JWT_REFRESH_SECRET=$JR"
  echo "ACCESS_TOKEN_TTL=900"
  echo "REFRESH_TOKEN_TTL=1209600"
  echo "STORAGE_DRIVER=local"
  echo "STORAGE_ROOT=/var/lib/zakupki/storage"
  echo "SMTP_HOST=$SMTP_HOST"
  echo "SMTP_PORT=$SMTP_PORT"
  echo "SMTP_USER=$SMTP_USER"
  echo "SMTP_PASS=$SMTP_PASS"
  echo "MAIL_FROM=tenders@su10.ru"
  echo "INN_LOOKUP_TOKEN=$INN"
} > "$OUT"
chmod 600 "$OUT"
echo "wrote $OUT ($(wc -l < "$OUT") lines) — values NOT displayed, chmod 600."
echo "Next: scp it to the VPS as /opt/portals/zakupki/.env.production (secret-safe)."
