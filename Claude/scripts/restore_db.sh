#!/bin/bash
# Restaura un dump a una DB destino (NO prod).
# Uso: bash Claude/scripts/restore_db.sh <dump_file> <target_db> [host]

set -e
DUMP_FILE="$1"
TARGET_DB="$2"
DB_HOST="${3:-localhost}"
DB_USER="${PGUSER:-postgres}"

if [ -z "$DUMP_FILE" ] || [ -z "$TARGET_DB" ]; then
  echo "Uso: bash $0 <dump_file> <target_db> [host]"
  echo "Ej:  bash $0 ./backups/db_anon_20260531_1830.dump crm_iseie_test"
  exit 1
fi

# Safety: no restaurar sobre prod
if [[ "$TARGET_DB" == "crm_iseie" ]] || [[ "$DB_HOST" == "72.60.90.135" ]]; then
  echo "⛔ REFUSED: no restaurar sobre DB de producción."
  echo "   Target: $DB_USER@$DB_HOST/$TARGET_DB"
  exit 1
fi

echo "→ Dump:       $DUMP_FILE"
echo "→ Target:     $DB_USER@$DB_HOST/$TARGET_DB"
echo ""

# Crear DB si no existe
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$TARGET_DB'" | grep -q 1 || \
  psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "CREATE DATABASE $TARGET_DB;"

# Restore
pg_restore -h "$DB_HOST" -U "$DB_USER" -d "$TARGET_DB" --clean --if-exists "$DUMP_FILE"

echo ""
echo "✅ Restore completado en $TARGET_DB"
echo ""
echo "Para conectarse:"
echo "  psql -h $DB_HOST -U $DB_USER -d $TARGET_DB"
