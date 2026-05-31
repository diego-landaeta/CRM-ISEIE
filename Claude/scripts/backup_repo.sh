#!/bin/bash
# Backup del repo CRM-ISEIE para preproducción/testing.
# Genera ./backups/repo_YYYYMMDD_HHMM.tgz con todo excepto node_modules, dist, .env.
#
# Uso: bash Claude/scripts/backup_repo.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP=$(date +%Y%m%d_%H%M)
OUT_DIR="$REPO_ROOT/backups"
OUT_FILE="$OUT_DIR/repo_${STAMP}.tgz"

mkdir -p "$OUT_DIR"

echo "→ Repo root: $REPO_ROOT"
echo "→ Output:    $OUT_FILE"
echo ""

cd "$(dirname "$REPO_ROOT")"
REPO_NAME="$(basename "$REPO_ROOT")"

tar -czf "$OUT_FILE" \
  --exclude="$REPO_NAME/node_modules" \
  --exclude="$REPO_NAME/backend/node_modules" \
  --exclude="$REPO_NAME/frontend/node_modules" \
  --exclude="$REPO_NAME/frontend/dist" \
  --exclude="$REPO_NAME/frontend/.vite" \
  --exclude="$REPO_NAME/backups" \
  --exclude="$REPO_NAME/**/.env" \
  --exclude="$REPO_NAME/**/.env.local" \
  --exclude="$REPO_NAME/**/.env.production" \
  --exclude="$REPO_NAME/**/*.log" \
  "$REPO_NAME"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo "✅ Backup creado: $OUT_FILE ($SIZE)"
echo ""
echo "Restore en preprod:"
echo "  tar -xzf $OUT_FILE -C ~/test/"
echo "  cd ~/test/$REPO_NAME/backend && npm install && cp .env.example .env"
echo "  cd ../frontend && npm install"
