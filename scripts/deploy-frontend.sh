#!/usr/bin/env bash
# Deploy atómico del frontend de CRM-ISEIE al VPS.
#
# Estrategia:
#   1. npm run build local.
#   2. tar el dist/.
#   3. scp al VPS a /tmp/.
#   4. En el VPS: extraer en directorio staging, luego intercambio atómico
#      con /var/www/crm-iseie/ (rm -rf solo del directorio viejo, no de
#      /var/www/ ni otras apps).
#   5. chown www-data.
#
# Esto evita la acumulación de assets viejos (hashes obsoletos) en
# /var/www/crm-iseie/assets/ que sucedía con el método anterior (tar -xzf
# encima del directorio existente).
#
# Uso:
#   ./scripts/deploy-frontend.sh

set -euo pipefail

VPS_USER="root"
VPS_HOST="72.60.90.135"
VPS_DIR="/var/www/crm-iseie"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)/frontend"

cd "$LOCAL_DIR"

echo "→ Build frontend ($(date +%H:%M:%S))"
npm run build

echo "→ Empaquetando dist/"
tar -czf /tmp/crm-iseie-fe.tar.gz -C dist .

echo "→ SCP a $VPS_HOST"
scp /tmp/crm-iseie-fe.tar.gz "$VPS_USER@$VPS_HOST:/tmp/crm-iseie-fe.tar.gz"

echo "→ Intercambio atómico en el VPS"
ssh "$VPS_USER@$VPS_HOST" bash <<'REMOTE'
set -euo pipefail
STAGING="/var/www/crm-iseie-new"
LIVE="/var/www/crm-iseie"
BACKUP="/var/www/crm-iseie-prev"

rm -rf "$STAGING"
mkdir -p "$STAGING"
tar -xzf /tmp/crm-iseie-fe.tar.gz -C "$STAGING"
chown -R www-data:www-data "$STAGING"

# Intercambio atómico: live → backup, staging → live.
if [ -d "$LIVE" ]; then
  rm -rf "$BACKUP"
  mv "$LIVE" "$BACKUP"
fi
mv "$STAGING" "$LIVE"

echo "  ✓ Bundle live: $(ls $LIVE/assets/index-*.js 2>/dev/null | head -1)"
echo "  ✓ Tamaño: $(du -sh $LIVE | cut -f1)"
echo "  ✓ Backup previo: $BACKUP"
REMOTE

echo "→ Smoke test"
curl -sS -o /dev/null -w "  /: HTTP %{http_code}\n" https://crm.iseie.com/
curl -sS -o /dev/null -w "  /api/health: HTTP %{http_code}\n" https://crm.iseie.com/api/health
echo
echo "✓ Deploy frontend completado."
