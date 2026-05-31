#!/bin/bash
# Backup ANONIMIZADO de la DB CRM-ISEIE para preproducción.
# - Reemplaza emails reales por hash MD5 + @anon.local
# - Reemplaza teléfonos por sus últimos 4 dígitos + ceros adelante
# - Nombres → "Usuario N"
# - Custom_fields con info personal → null
#
# Output: ./backups/db_anon_YYYYMMDD_HHMM.dump (formato pg_dump -Fc)
#
# Uso: bash Claude/scripts/backup_db_anon.sh [DB_HOST] [DB_NAME]
#   default: localhost crm_iseie_preprod
#
# ⚠️ NO correr contra producción. Apunta SOLO a una DB de preprod.

set -e
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAMP=$(date +%Y%m%d_%H%M)
OUT_DIR="$REPO_ROOT/backups"
OUT_FILE="$OUT_DIR/db_anon_${STAMP}.dump"

DB_HOST="${1:-localhost}"
DB_NAME="${2:-crm_iseie_preprod}"
DB_USER="${PGUSER:-crm_iseie_user}"

# Safety: refuse to run against known prod hostnames
if [[ "$DB_HOST" == "72.60.90.135" ]] || [[ "$DB_NAME" == "crm_iseie" ]]; then
  echo "⛔ REFUSED: este script no debe correr contra producción."
  echo "   Host: $DB_HOST  DB: $DB_NAME"
  echo "   Crea primero una DB de preprod (createdb crm_iseie_preprod) y pasala como arg."
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "→ Source DB: $DB_USER@$DB_HOST/$DB_NAME"
echo "→ Output:    $OUT_FILE"
echo ""

# 1) Crear DB temporal "anon" como copia
TMP_DB="${DB_NAME}_anon_tmp_$$"
echo "→ Creando DB temporal: $TMP_DB"
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "CREATE DATABASE $TMP_DB TEMPLATE $DB_NAME;"

# 2) Anonimizar en la copia
echo "→ Anonimizando emails / teléfonos / nombres..."
psql -h "$DB_HOST" -U "$DB_USER" -d "$TMP_DB" <<'SQL'
-- Emails: hash MD5
UPDATE leads SET email = MD5(email) || '@anon.local' WHERE email IS NOT NULL;
UPDATE users SET email = MD5(email) || '@anon.local' WHERE email IS NOT NULL;

-- Teléfonos: dejar solo últimos 4 dígitos (relleno con ceros adelante)
UPDATE leads SET telefono = LPAD(RIGHT(regexp_replace(telefono, '[^0-9]', '', 'g'), 4), 10, '0')
  WHERE telefono IS NOT NULL;

-- Nombres → Usuario N
UPDATE leads SET nombre = 'Usuario ' || id WHERE nombre NOT ILIKE 'an%nimo%';
UPDATE users SET nombre = 'Gestor ' || id;

-- Notas (PII libre) → vacío
UPDATE leads SET notas = NULL WHERE notas IS NOT NULL;

-- Custom fields: limpiar campos sensibles
UPDATE leads SET custom_fields = custom_fields
  - 'observacion' - 'nombres_alt' - 'emails_alt' - 'telefonos_alt'
  - 'cetlat_id' - 'asesora_csv' - 'tecnico_csv'
  WHERE custom_fields IS NOT NULL;

-- Lead interactions: nota → "(anonimizado)"
UPDATE lead_interactions SET nota = '(anonimizado)';

-- Passwords → hash dummy
UPDATE users SET password_hash = '$2b$12$DummyHashForPreprodTestingOnly0000000000000000';
SQL

# 3) Dump de la DB anonimizada
echo "→ Generando pg_dump..."
pg_dump -h "$DB_HOST" -U "$DB_USER" -Fc -d "$TMP_DB" -f "$OUT_FILE"

# 4) Cleanup DB temporal
echo "→ Borrando DB temporal..."
psql -h "$DB_HOST" -U "$DB_USER" -d postgres -c "DROP DATABASE $TMP_DB;"

SIZE=$(du -h "$OUT_FILE" | cut -f1)
echo ""
echo "✅ Backup anonimizado: $OUT_FILE ($SIZE)"
echo ""
echo "Restore:"
echo "  createdb crm_iseie_test"
echo "  pg_restore -d crm_iseie_test $OUT_FILE"
