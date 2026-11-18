#!/usr/bin/env bash
#
# Copia diaria de las bases del servidor, con rotación (7 diarias + 4 semanales) y copia fuera
# del VPS. Tarea #634 (gemela CRM-ISEIE#361).
#
# EL PROBLEMA QUE RESUELVE
#   Hasta ahora solo había las copias a mano de antes de cada versión, en el mismo disco y en una
#   carpeta que cualquier usuario del sistema podía leer y borrar (777). Si el disco o el VPS se
#   pierden, se pierde el CRM entero, y entre versión y versión pueden pasar semanas sin copia.
#   La base del WhatsApp (Docker) y la SQLite de las apps no tenían ninguna copia.
#
# QUIÉN LO EJECUTA
#   root, desde el timer de systemd `crm-copias.timer` (scripts/servidor/systemd/). Como root:
#   - los `pg_dump` de las bases locales se lanzan como `postgres` (PG_COMO), que entra por socket
#     sin contraseña, y su salida la escribe root: los ficheros quedan root:root 600;
#   - la SQLite se lee como el dueño del fichero, para no dejarle un -wal/-shm de root que la app
#     ya no podría abrir.
#   Instalación y restauración en docs/copias-de-la-base.md.
#
# QUÉ COPIA (al menos una de las tres listas)
#   COPIAS_BASES       bases del Postgres local, separadas por espacios («crm_prod_db crm_test_db»).
#                      `pg_dump -Fc`, comprobado con `pg_restore --list`.  → <base>-AAAAMMDD-HHMMSS.dump
#   COPIAS_DOCKER_PG   bases de Postgres dentro de un contenedor, «contenedor:base»
#                      («contenedor:base»). `pg_dump -Fc` dentro del contenedor (con su
#                      POSTGRES_USER) y comprobado allí mismo.        → docker-<contenedor>-<base>-….dump
#   COPIAS_SQLITE      ficheros SQLite, «nombre=/ruta/al.db» («app=/ruta/a/la.db»).
#                      Copia en caliente con la API de backup de SQLite (lo mismo que `.backup`, sin
#                      necesitar el programa sqlite3), comprimida y comprobada con `integrity_check`.
#                                                                     → sqlite-<nombre>-….sqlite.gz
#   Las rutas no pueden llevar espacios.
#
# POR CADA COPIA
#   1. Vuelca a un fichero temporal con umask 077: la carpeta queda en 700 y el fichero en 600.
#   2. Lo comprueba. Un volcado vacío o roto NO cuenta como copia y se borra.
#   3. Solo si es bueno: lo renombra, lo sube fuera si hay destino y, si no hay una copia semanal
#      de los últimos 7 días, lo enlaza también en semanales/ (enlace duro: no ocupa el doble).
#   4. Deja las COPIAS_DIARIAS más nuevas y las COPIAS_SEMANALES más nuevas, por número y no por
#      fecha. Si el volcado de hoy ha fallado NO borra nada: un fallo que dure semanas no se lleva
#      las últimas copias buenas.
#
# OTRAS VARIABLES
#   COPIAS_DIR            carpeta de las copias (por defecto /var/backups/crm/base).
#   COPIAS_DIARIAS        cuántas diarias se guardan por fuente (7). COPIAS_DIAS, el nombre antiguo, vale igual.
#   COPIAS_SEMANALES      cuántas semanales se guardan por fuente (4).
#   COPIAS_MIN_LIBRE_MB   si queda menos espacio libre, no copia y falla (2048): mejor un aviso que llenar el disco.
#   COPIAS_REMOTO         destino de rclone fuera del VPS, p. ej. «r2-copias:crm-copias/360». Vacío = solo
#                         en local (lo dice en el registro, para que no pase desapercibido).
#   PG_COMO               usuario con el que se lanza pg_dump. Por defecto `postgres` si se ejecuta como
#                         root y el propio usuario si no (así funcionaba antes, desde el cron de postgres).
#   PG_DUMP, PG_RESTORE, DOCKER, PYTHON, RCLONE   rutas de los programas (por defecto, los del PATH).
#
# Sale con 1 si alguna copia no se ha podido hacer o subir: el servicio de systemd queda en
# «failed» y lanza el aviso (crm-copias-aviso.service). Al final deja ESTADO en la carpeta con
# la última línea de resultado, para quien quiera vigilarlo desde fuera.
set -euo pipefail
umask 077

BASES="${COPIAS_BASES:-}"
DOCKER_PG="${COPIAS_DOCKER_PG:-}"
SQLITES="${COPIAS_SQLITE:-}"
DIR="${COPIAS_DIR:-/var/backups/crm/base}"
DIARIAS="${COPIAS_DIARIAS:-${COPIAS_DIAS:-7}}"
SEMANALES="${COPIAS_SEMANALES:-4}"
MIN_LIBRE_MB="${COPIAS_MIN_LIBRE_MB:-2048}"
REMOTO="${COPIAS_REMOTO:-}"
PG_DUMP="${PG_DUMP:-pg_dump}"
PG_RESTORE="${PG_RESTORE:-pg_restore}"
DOCKER="${DOCKER:-docker}"
PYTHON="${PYTHON:-python3}"
RCLONE="${RCLONE:-rclone}"
if [ -z "${PG_COMO+x}" ]; then
  if [ "$(id -u)" -eq 0 ]; then PG_COMO=postgres; else PG_COMO=""; fi
fi
SELLO="$(date +%Y%m%d-%H%M%S)"
SEM="$DIR/semanales"

registro() { printf '%s %s\n' "$(date '+%F %T')" "$*"; }

[ -n "$BASES$DOCKER_PG$SQLITES" ] || {
  registro "ERROR: falta COPIAS_BASES (o COPIAS_DOCKER_PG / COPIAS_SQLITE): no hay nada que copiar"; exit 2; }
case "$DIARIAS$SEMANALES$MIN_LIBRE_MB" in
  *[!0-9]*) registro "ERROR: COPIAS_DIARIAS, COPIAS_SEMANALES y COPIAS_MIN_LIBRE_MB tienen que ser números"; exit 2 ;;
esac
[ "$DIARIAS" -ge 1 ] || { registro "ERROR: COPIAS_DIARIAS tiene que ser al menos 1"; exit 2; }

mkdir -p "$DIR" "$SEM"
chmod 700 "$DIR" "$SEM"
# Las copias que ya hubiera (de antes de este script) también se cierran.
find "$DIR" -maxdepth 2 -type f \( -name '*.dump' -o -name '*.sqlite.gz' \) -exec chmod 600 {} +

libre_mb="$(df -Pm "$DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$libre_mb" ] && [ "$libre_mb" -lt "$MIN_LIBRE_MB" ] 2>/dev/null; then
  registro "ERROR: quedan ${libre_mb} MB libres en $DIR (mínimo $MIN_LIBRE_MB). No se copia nada para no llenar el disco."
  printf '%s ERROR sin espacio (%s MB)\n' "$(date '+%F %T')" "$libre_mb" > "$DIR/ESTADO"
  exit 1
fi

[ -n "$REMOTO" ] || registro "AVISO: sin COPIAS_REMOTO, las copias se quedan solo en este disco"

# Lanza un programa como otro usuario (solo si hace falta).
como() {
  local usuario="$1"; shift
  if [ -n "$usuario" ] && [ "$usuario" != "$(id -un)" ]; then runuser -u "$usuario" -- "$@"; else "$@"; fi
}

# --- Volcar (a la salida estándar) y comprobar (el fichero ya escrito), por tipo de fuente ---
# volcar_<tipo> <args...> · comprobar_<tipo> <fichero> <args...>

volcar_pg()    { como "$PG_COMO" "$PG_DUMP" -Fc --no-owner --no-privileges "$1"; }
comprobar_pg() { "$PG_RESTORE" --list "$1" > /dev/null; }

# Dentro del contenedor, con su propio usuario y su pg_dump (la misma versión que su servidor).
volcar_docker()    { "$DOCKER" exec "$1" sh -c 'exec pg_dump -U "$POSTGRES_USER" -Fc --no-owner --no-privileges "$1"' sh "$2"; }
comprobar_docker() { "$DOCKER" exec -i "$2" pg_restore --list < "$1" > /dev/null; }

# API de backup de SQLite: copia coherente aunque la app esté escribiendo (modo WAL incluido).
# mode=rw: si el fichero no existe falla, en vez de crear una base vacía en su sitio.
PY_VOLCAR='
import sqlite3, sys, urllib.parse
src = sqlite3.connect("file:" + urllib.parse.quote(sys.argv[1]) + "?mode=rw", uri=True)
dst = sqlite3.connect(":memory:")
src.backup(dst)
src.close()
sys.stdout.buffer.write(dst.serialize())
'
PY_COMPROBAR='
import sqlite3, sys
datos = sys.stdin.buffer.read()
if not datos.startswith(b"SQLite format 3\x00"):
    sys.exit(1)
# Una base en modo WAL no se abre en memoria: para comprobarla, se marca como de diario clásico
# (bytes 18-19 de la cabecera). Solo aquí; la copia guardada queda tal cual.
datos = bytearray(datos)
if datos[18] == 2:
    datos[18] = datos[19] = 1
db = sqlite3.connect(":memory:")
db.deserialize(datos)
sys.exit(0 if db.execute("pragma integrity_check").fetchone()[0] == "ok" else 1)
'
volcar_sqlite() {
  local ruta="$1" dueno=""
  [ -f "$ruta" ] || { echo "no existe $ruta" >&2; return 1; }
  if [ "$(id -u)" -eq 0 ]; then dueno="$(stat -c %U "$ruta")"; fi
  como "$dueno" "$PYTHON" -c "$PY_VOLCAR" "$ruta" | gzip -c
}
comprobar_sqlite() { gzip -dc "$1" | "$PYTHON" -c "$PY_COMPROBAR"; }

# --- Rotación, semanal y subida ---

# Deja las <guardar> más nuevas de <nombre> en <carpeta>, por el sello del nombre. Solo toca los
# ficheros con el nombre que pone este script (<nombre>-AAAAMMDD-HHMMSS.<ext>): los volcados a
# mano («crm_prod_db-antes-…») no encajan y no se tocan.
rotar() {
  local carpeta="$1" nombre="$2" ext="$3" guardar="$4"
  find "$carpeta" -maxdepth 1 -type f -name "${nombre}-[0-9]*-[0-9]*.${ext}" -printf '%f\n' \
    | sort -r | tail -n +"$((guardar + 1))" \
    | while read -r f; do rm -f -- "$carpeta/$f"; registro "borrada $carpeta/$f (se guardan $guardar)"; done
}

subir() {
  local fichero="$1" destino="$2" nombre="$3" ext="$4" dias="$5"
  if "$RCLONE" copyto "$fichero" "$destino/$(basename "$fichero")"; then
    registro "OK $nombre subida a $destino"
    "$RCLONE" delete "$destino" --max-depth 1 --min-age "${dias}d" --include "${nombre}-*.${ext}" \
      || registro "AVISO $nombre: no se han podido borrar las copias viejas de $destino"
  else
    registro "ERROR $nombre: no se ha podido subir a $destino (la copia local sí está)"
    return 1
  fi
}

fallos=0
copiar() {  # copiar <nombre> <ext> <tipo> <args del tipo...>
  local nombre="$1" ext="$2" tipo="$3"; shift 3
  local final="$DIR/${nombre}-${SELLO}.${ext}"
  local parcial="$final.parcial"

  if "volcar_$tipo" "$@" > "$parcial" && [ -s "$parcial" ] && "comprobar_$tipo" "$parcial" "$@"; then
    chmod 600 "$parcial"
    mv "$parcial" "$final"
    registro "OK $nombre → $final ($(du -h "$final" | cut -f1))"
  else
    rm -f "$parcial"
    registro "ERROR $nombre: el volcado ha fallado o no se puede leer. No se borra ninguna copia anterior."
    fallos=$((fallos + 1))
    return 0
  fi

  if [ -n "$REMOTO" ]; then
    subir "$final" "$REMOTO" "$nombre" "$ext" "$DIARIAS" || fallos=$((fallos + 1))
  fi

  # Semanal: si no hay ninguna de los últimos 7 días, la de hoy lo es.
  if [ -z "$(find "$SEM" -maxdepth 1 -type f -name "${nombre}-[0-9]*-[0-9]*.${ext}" -mtime -7 -print -quit)" ]; then
    ln "$final" "$SEM/" 2>/dev/null || cp -p "$final" "$SEM/"
    registro "semanal $nombre → $SEM/$(basename "$final")"
    if [ -n "$REMOTO" ]; then
      subir "$SEM/$(basename "$final")" "$REMOTO/semanales" "$nombre" "$ext" "$((SEMANALES * 7))" || fallos=$((fallos + 1))
    fi
    rotar "$SEM" "$nombre" "$ext" "$SEMANALES"
  fi

  rotar "$DIR" "$nombre" "$ext" "$DIARIAS"
}

for base in $BASES; do
  copiar "$base" dump pg "$base"
done

for item in $DOCKER_PG; do
  contenedor="${item%%:*}"; base="${item#*:}"
  if [ "$contenedor" = "$item" ] || [ -z "$base" ] || [ -z "$contenedor" ]; then
    registro "ERROR: «$item» en COPIAS_DOCKER_PG tiene que ser contenedor:base"; fallos=$((fallos + 1)); continue
  fi
  copiar "docker-${contenedor}-${base}" dump docker "$contenedor" "$base"
done

for item in $SQLITES; do
  nombre="${item%%=*}"; ruta="${item#*=}"
  if [ "$nombre" = "$item" ] || [ -z "$ruta" ] || [ -z "$nombre" ]; then
    registro "ERROR: «$item» en COPIAS_SQLITE tiene que ser nombre=/ruta/al.db"; fallos=$((fallos + 1)); continue
  fi
  copiar "sqlite-${nombre}" sqlite.gz sqlite "$ruta"
done

if [ "$fallos" -eq 0 ]; then
  printf '%s OK\n' "$(date '+%F %T')" > "$DIR/ESTADO"
else
  printf '%s ERROR %s fallo(s)\n' "$(date '+%F %T')" "$fallos" > "$DIR/ESTADO"
  exit 1
fi
