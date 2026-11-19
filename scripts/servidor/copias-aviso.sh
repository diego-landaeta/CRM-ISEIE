#!/usr/bin/env bash
#
# Aviso cuando falla la copia diaria (#634). Lo lanza systemd por OnFailure= de crm-copias.service.
#
# Siempre lo deja en el journal con prioridad «err» (journalctl -p err -t crm-copias).
# Si /etc/crm-copias/aviso.env trae AVISO_BREVO_API_KEY y AVISO_PARA, manda además un correo por
# la API de Brevo con las últimas líneas del registro. La clave no pasa por la línea de órdenes
# (la vería cualquiera con `ps`): Python la lee del entorno.
#
#   AVISO_BREVO_API_KEY   clave de Brevo, solo en /etc/crm-copias/aviso.env (600 root). Mejor una propia.
#   AVISO_PARA            destinatarios, separados por comas.
#   AVISO_DE              remitente verificado en Brevo (sin él no se manda el correo).
#   COPIAS_REGISTRO       el registro a adjuntar (por defecto /var/log/crm-copias.log).
set -uo pipefail

# Desde systemd ya vienen por EnvironmentFile=; desde cron, se leen aquí.
if [ -z "${AVISO_BREVO_API_KEY:-}" ] && [ -r /etc/crm-copias/aviso.env ]; then
  set -a; . /etc/crm-copias/aviso.env; set +a
fi
export AVISO_BREVO_API_KEY="${AVISO_BREVO_API_KEY:-}" AVISO_PARA="${AVISO_PARA:-}" AVISO_DE="${AVISO_DE:-}"

REGISTRO="${COPIAS_REGISTRO:-/var/log/crm-copias.log}"
HOST="$(hostname)"
ULTIMAS="$(tail -n 40 "$REGISTRO" 2>/dev/null || echo "(no se puede leer $REGISTRO)")"

logger -p user.err -t crm-copias "La copia diaria de las bases ha FALLADO en $HOST. Mira $REGISTRO."

if [ -z "${AVISO_BREVO_API_KEY:-}" ] || [ -z "${AVISO_PARA:-}" ] || [ -z "${AVISO_DE:-}" ]; then
  logger -p user.warning -t crm-copias "Sin AVISO_BREVO_API_KEY/AVISO_PARA/AVISO_DE: el fallo solo queda en el journal."
  exit 0
fi

ASUNTO="[$HOST] Ha fallado la copia diaria de las bases" CUERPO="$ULTIMAS" python3 - <<'PY'
import json, os, sys, urllib.request
para = [{"email": e.strip()} for e in os.environ["AVISO_PARA"].split(",") if e.strip()]
datos = {
    "sender": {"name": "Copias ISEIE", "email": os.environ["AVISO_DE"]},
    "to": para,
    "subject": os.environ["ASUNTO"],
    "textContent": "La copia diaria ha fallado. Últimas líneas del registro:\n\n" + os.environ["CUERPO"],
}
req = urllib.request.Request(
    "https://api.brevo.com/v3/smtp/email",
    data=json.dumps(datos).encode(),
    headers={"api-key": os.environ["AVISO_BREVO_API_KEY"], "content-type": "application/json", "accept": "application/json"},
)
try:
    urllib.request.urlopen(req, timeout=20).read()
except Exception as e:  # el error no lleva la clave
    print(f"no se ha podido mandar el correo: {e}", file=sys.stderr)
    sys.exit(1)
PY
