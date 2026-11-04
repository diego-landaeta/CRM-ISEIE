#!/usr/bin/env bash
#
# Copia diaria de las bases del CRM, con rotación y copia fuera del VPS. Tarea #634 (gemela CRM-ISEIE#361).
#
# EL PROBLEMA QUE RESUELVE
#   Hasta ahora solo había las copias a mano de antes de cada versión, en el mismo disco y en una
#   carpeta que cualquier usuario del sistema podía leer y borrar (777). Si el disco o el VPS se
#   pierden, se pierde el CRM entero, y entre versión y versión pueden pasar semanas sin copia.
#
# QUIÉN LO EJECUTA
#   El cron del usuario `postgres` (entra a la base sin contraseña, por socket). Instalación y
#   restauración en docs/copias-de-la-base.md.
#
# QUÉ HACE, POR CADA BASE
#   1. `pg_dump -Fc` a un fichero temporal, con umask 077: la carpeta queda en 700 y el fichero en 600.
#   2. Comprueba el volcado con `pg_restore --list`. Un volcado vacío o roto NO cuenta como copia.
#   3. Solo si es bueno: lo renombra a <base>-AAAAMMDD-HHMMSS.dump y, si hay destino, lo sube fuera.
#   4. Borra las copias de esa base de más de COPIAS_DIAS días. Si el volcado de hoy ha fallado NO
#      borra ninguna: así un fallo que dure dos semanas no se lleva las últimas copias buenas.
#
# VARIABLES
#   COPIAS_BASES    obligatoria: las bases, separadas por espacios («crm_prod_db crm_test_db»).
#   COPIAS_DIR      carpeta de las copias (por defecto /var/backups/crm/base).
#   COPIAS_DIAS     días que se guardan (por defecto 14).
#   COPIAS_REMOTO   destino de rclone fuera del VPS, p. ej. «r2-copias:crm-copias/360». Vacío = solo
#                   en local (lo dice en el registro, para que no pase desapercibido).
#   PG_DUMP, PG_RESTORE, RCLONE   rutas de los programas (por defecto, los del PATH).
#
# Sale con 1 si alguna base no se ha podido copiar o subir: el cron lo deja en el registro.
set -euo pipefail
umask 077

BASES="${COPIAS_BASES:-}"
DIR="${COPIAS_DIR:-/var/backups/crm/base}"
DIAS="${COPIAS_DIAS:-14}"
REMOTO="${COPIAS_REMOTO:-}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
RCLONE="${RCLONE:-rclone}"
SELLO="$(date +%Y%m%d-%H%M%S)"

registro() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

[ -n "$BASES" ] || { registro "ERROR: falta COPIAS_BASES (las bases a copiar)"; exit 2; }
case "$DIAS" in ''|*[!0-9]*) registro "ERROR: COPIAS_DIAS tiene que ser un número de días"; exit 2 ;; esac

mkdir -p "$DIR"
chmod 700 "$DIR"
# Las copias que ya hubiera (de antes de este script) también se cierran.
find "$DIR" -maxdepth 1 -type f -name '*.dump' -exec chmod 600 {} +

[ -n "$REMOTO" ] || registro "AVISO: sin COPIAS_REMOTO, las copias se quedan solo en este disco"

fallos=0
for base in $BASES; do
  final="$DIR/${base}-${SELLO}.dump"
  parcial="$final.parcial"

  if "$PG_DUMP" -Fc --no-owner --no-privileges -f "$parcial" "$base" \
     && [ -s "$parcial" ] \
     && "$PG_RESTORE" --list "$parcial" > /dev/null; then
    chmod 600 "$parcial"
    mv "$parcial" "$final"
    registro "OK $base → $final ($(du -h "$final" | cut -f1))"
  else
    rm -f "$parcial"
    registro "ERROR $base: el volcado ha fallado o no se puede leer. No se borra ninguna copia anterior."
    fallos=$((fallos + 1))
    continue
  fi

  if [ -n "$REMOTO" ]; then
    if "$RCLONE" copyto "$final" "$REMOTO/$(basename "$final")"; then
      registro "OK $base subida a $REMOTO"
      "$RCLONE" delete "$REMOTO" --min-age "${DIAS}d" --include "${base}-*.dump" \
        || registro "AVISO $base: no se han podido borrar las copias viejas de $REMOTO"
    else
      registro "ERROR $base: no se ha podido subir a $REMOTO (la copia local sí está)"
      fallos=$((fallos + 1))
    fi
  fi

  # Rotación local: solo los ficheros de esta base y con el nombre que pone este script.
  find "$DIR" -maxdepth 1 -type f -name "${base}-[0-9]*-[0-9]*.dump" -mtime +"$DIAS" -print -delete \
    | while read -r viejo; do registro "borrada $viejo (más de $DIAS días)"; done
done

[ "$fallos" -eq 0 ] || exit 1
