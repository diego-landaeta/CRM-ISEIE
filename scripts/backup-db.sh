#!/usr/bin/env bash
# Backup nocturno de la DB crm_iseie.
# - pg_dump comprimido (.sql.gz) a /var/backups/crm-iseie/
# - retención: 14 días
# - si R2 está configurado y rclone/awscli existen, sube copia off-site
#
# Instalación en el VPS (cron):
#   chmod +x /opt/crm-iseie/scripts/backup-db.sh
#   echo "0 3 * * * /opt/crm-iseie/scripts/backup-db.sh >> /var/log/crm-iseie-backup.log 2>&1" | crontab -
#
# Ejecución manual: bash scripts/backup-db.sh

set -euo pipefail

BACKUP_DIR="/var/backups/crm-iseie"
RETENTION_DAYS=14
DB_NAME="crm_iseie"
DB_USER="crm_iseie_user"
DATE=$(date +%Y%m%d_%H%M%S)
FILE="${BACKUP_DIR}/crm_iseie_${DATE}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# pg_dump como el usuario postgres (acceso peer auth) o usando .pgpass si
# está configurado. Comprimimos al vuelo para ahorrar disco.
echo "[$(date +'%Y-%m-%d %H:%M:%S')] Backup → ${FILE}"
if command -v pg_dump >/dev/null 2>&1; then
  sudo -u postgres pg_dump --no-owner --no-acl --clean --if-exists "${DB_NAME}" | gzip -9 > "${FILE}"
else
  echo "ERROR: pg_dump no disponible"
  exit 1
fi

# Verificar que el dump no está vacío
SIZE=$(stat -c%s "${FILE}" 2>/dev/null || stat -f%z "${FILE}" 2>/dev/null)
if [ "${SIZE}" -lt 10240 ]; then
  echo "ERROR: backup demasiado pequeño (${SIZE} bytes), abortando"
  rm -f "${FILE}"
  exit 1
fi
echo "  ✓ Tamaño: $(numfmt --to=iec ${SIZE} 2>/dev/null || echo ${SIZE} bytes)"

# Limpieza: borrar backups más antiguos de RETENTION_DAYS
find "${BACKUP_DIR}" -name "crm_iseie_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete
KEPT=$(ls -1 "${BACKUP_DIR}"/crm_iseie_*.sql.gz 2>/dev/null | wc -l)
echo "  ✓ Backups retenidos: ${KEPT} (últimos ${RETENTION_DAYS} días)"

# Off-site opcional: R2 vía rclone si está configurado con remote "r2-crm"
if command -v rclone >/dev/null 2>&1 && rclone listremotes 2>/dev/null | grep -q "^r2-crm:"; then
  echo "  → Subiendo a R2 (rclone)…"
  rclone copy "${FILE}" "r2-crm:crm-iseie-backups/$(date +%Y/%m)/" --quiet
  echo "  ✓ Subido off-site"
fi

echo "[$(date +'%Y-%m-%d %H:%M:%S')] Backup completado"
