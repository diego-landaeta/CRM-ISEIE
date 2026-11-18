#!/bin/sh
# Genera local_crm-<versión>.zip con la carpeta raíz «crm»: es lo que pide el
# instalador de Moodle (sin el prefijo «local_», o lo rechaza). Ver README.md.
#
# Tiene que ser un ZIP de verdad. En Git Bash, `tar` es GNU tar, que con -a no
# escribe ZIP: deja un .tar con nombre .zip y Moodle responde «The file provided is
# not a valid plugin ZIP package» (pasó en el ensayo del 05/11/2026). Por eso:
# zip si está; si no, el tar de Windows (bsdtar, que sí escribe ZIP).
set -e
cd "$(dirname "$0")"

# La clave pública de PRUEBAS LOCALES (crm/classes/claves.php) no puede llegar a un campus
# de verdad: con ella, el campus instalaría solo cualquier versión firmada con la privada de
# pruebas, que no está guardada como la de producción (revisión de la #689). Se reconoce por
# un trozo de la propia clave (no por el comentario, que se puede borrar dejando la clave).
# Para un ZIP de pruebas a sabiendas: PERMITIR_CLAVE_PRUEBAS=1 sh empaquetar.sh
HUELLA_CLAVE_PRUEBAS='jE0Exco15LQBg6uWbwn4'
if grep -q "$HUELLA_CLAVE_PRUEBAS" crm/classes/claves.php; then
  if [ "${PERMITIR_CLAVE_PRUEBAS:-}" != "1" ]; then
    echo "No se empaqueta: crm/classes/claves.php lleva todavía la clave pública de PRUEBAS LOCALES." >&2
    echo "Pon la pública de producción (README.md, «La clave de firma») o, si es un ZIP solo" >&2
    echo "para probar en local, repite con PERMITIR_CLAVE_PRUEBAS=1." >&2
    exit 1
  fi
  echo "AVISO: ZIP con la clave de PRUEBAS LOCALES (PERMITIR_CLAVE_PRUEBAS=1). No es para un campus de verdad." >&2
fi

version=$(sed -n "s/.*release *= *'\([^']*\)'.*/\1/p" crm/version.php)
salida="local_crm-${version}.zip"
rm -f "$salida"
if command -v zip >/dev/null 2>&1; then
  zip -qr "$salida" crm -x '*.DS_Store'
elif [ -x "${SYSTEMROOT:-/c/Windows}/System32/tar.exe" ] || [ -x /c/Windows/System32/tar.exe ]; then
  bsdtar="${SYSTEMROOT:-C:/Windows}/System32/tar.exe"
  [ -x "$bsdtar" ] || bsdtar=/c/Windows/System32/tar.exe
  "$bsdtar" -a -c -f "$salida" crm
else
  echo "Hace falta «zip» (o, en Windows, su tar.exe) para generar el ZIP." >&2
  exit 1
fi
# Comprobación: un ZIP empieza por «PK».
[ "$(head -c 2 "$salida")" = "PK" ] || { echo "«$salida» no es un ZIP" >&2; exit 1; }
echo "$salida"
