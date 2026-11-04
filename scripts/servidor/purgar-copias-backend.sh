#!/usr/bin/env bash
#
# Purga las copias del backend de los despliegues (un .tgz por subida). Tarea #634 (gemela CRM-ISEIE#361).
#
# EL PROBLEMA QUE RESUELVE
#   En el VPS del 360 hay 8 GB de .tgz de despliegues y el disco está al 88 %. Nadie los borra.
#
# QUÉ HACE
#   Busca en la carpeta que se le pasa los .tgz / .tar.gz de más de DIAS días (por defecto 30) y
#   SIEMPRE conserva los CONSERVAR más recientes (por defecto 5), aunque sean viejos: si un mes no
#   hay despliegues, no se queda sin ninguna copia para volver atrás.
#   No toca otros ficheros (los volcados .dump de la base van aparte, con copia-base.sh).
#
# SIN --si ES UNA SIMULACIÓN: dice qué borraría y cuánto ocupa, y no borra nada.
#
#   ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm            # simulación
#   ./scripts/servidor/purgar-copias-backend.sh /var/backups/crm --si       # de verdad
set -euo pipefail

CARPETA="${1:-}"
SI=0
[ "${2:-}" = "--si" ] && SI=1
DIAS="${DIAS:-30}"
CONSERVAR="${CONSERVAR:-5}"

[ -n "$CARPETA" ] && [ -d "$CARPETA" ] || { echo "Uso: $0 <carpeta-de-copias> [--si]"; exit 2; }
case "$DIAS$CONSERVAR" in *[!0-9]*) echo "DIAS y CONSERVAR tienen que ser números"; exit 2 ;; esac

# Todas las copias del backend, de la más nueva a la más vieja.
mapfile -t copias < <(find "$CARPETA" -maxdepth 1 -type f \( -name '*.tgz' -o -name '*.tar.gz' \) -printf '%T@ %p\n' \
  | sort -rn | cut -d' ' -f2-)

limite=$(( $(date +%s) - DIAS * 86400 ))
a_borrar=()
for i in "${!copias[@]}"; do
  [ "$i" -lt "$CONSERVAR" ] && continue
  [ "$(stat -c %Y "${copias[$i]}")" -lt "$limite" ] && a_borrar+=("${copias[$i]}")
done

echo "Copias del backend: ${#copias[@]} · se conservan las $CONSERVAR más nuevas · más de $DIAS días: ${#a_borrar[@]}"
[ "${#a_borrar[@]}" -gt 0 ] || { echo "Nada que borrar."; exit 0; }
printf '  %s\n' "${a_borrar[@]}"
echo "Ocupan: $(du -ch "${a_borrar[@]}" | tail -1 | cut -f1)"

if [ "$SI" -ne 1 ]; then
  echo "Simulación: no se ha borrado nada. Repite con --si para borrarlas."
  exit 0
fi
rm -f -- "${a_borrar[@]}"
echo "Borradas ${#a_borrar[@]} copias."
