#!/usr/bin/env bash
# SUSTITUIDO por scripts/servidor/copia-base.sh (#361, gemela de CRM#634). Guía: docs/copias-de-la-base.md.
#
# Este script copiaba solo crm_iseie, dejaba el volcado legible por cualquier usuario del VPS y se
# instalaba con `crontab -`, que borra el crontab entero (en este VPS lleva tareas de otras apps).
# Se deja para que nada que lo llame se rompa: ahora delega en el nuevo con los valores de ISEIE.
set -euo pipefail
echo "AVISO: scripts/backup-db.sh está sustituido por scripts/servidor/copia-base.sh (docs/copias-de-la-base.md)" >&2
export COPIAS_BASES="${COPIAS_BASES:-crm_iseie crm_iseie_staging}"
export COPIAS_DIR="${COPIAS_DIR:-/var/backups/crm-iseie/base}"
exec "$(dirname "${BASH_SOURCE[0]}")/servidor/copia-base.sh" "$@"
