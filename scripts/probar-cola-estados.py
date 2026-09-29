# -*- coding: utf-8 -*-
"""Comprueba el filtro de estado de la cola del dia, en los dos CRMs.

Los cinco estados tienen que sumar exactamente el total sin filtro. Si no
suman, el filtro se estaria dejando gente fuera o contandola dos veces.

    python scripts/probar-cola-estados.py [multicrm-staging|iseie-staging]
"""
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf8", errors="replace")

SCRATCH = ("C:/Users/Diego/AppData/Local/Temp/claude/"
           "c--Users-Diego-Desktop-Proyectos-Carlos-CRM-ISEIH/"
           "02c2801c-3375-4d51-9636-d374bd8ec8c9/scratchpad")
sys.path.insert(0, SCRATCH)
from conexion import conectar  # noqa: E402

JS = r'''
import 'dotenv/config';
import { colaDelDia } from './src/modules/proceso/proceso.model.js';
import { query } from './src/shared/config/db.js';

const ids = (await query(
  "SELECT id FROM projects WHERE active ORDER BY id")).rows.map(r => r.id);

const ESTADOS = ['nuevo', 'por_contactar', 'contactado', 'en_seguimiento', 'proxima_convocatoria'];
const base = await colaDelDia({ projectIds: ids, asesoraId: null, limite: 1 });
console.log(`sin filtro            total=${base.total}`);

let suma = 0;
for (const e of ESTADOS) {
  const r = await colaDelDia({ projectIds: ids, asesoraId: null, limite: 1, estado: e });
  suma += r.total;
  console.log(`estado=${e.padEnd(21)} total=${r.total}`);
}
console.log('');
console.log(`suma de los cinco: ${suma}   ·   sin filtro: ${base.total}   ·   ${suma === base.total ? 'CUADRA' : 'NO CUADRA'}`);

// Y uno inventado no puede colarse como filtro.
const malo = await colaDelDia({ projectIds: ids, asesoraId: null, limite: 1, estado: 'inventado' });
console.log(`estado inventado -> ${malo.total} (tiene que ser igual que sin filtro: ${malo.total === base.total ? 'bien' : 'MAL'})`);
process.exit(0);
'''

ENTORNOS = {
    "multicrm-staging": ("187.124.128.126", "/opt/crm/staging",
                         "/home/claude/.nvm/versions/node/v24.14.1/bin/node"),
    "iseie-staging": ("72.60.90.135", "/opt/crm-iseie-staging", "/usr/bin/node"),
}
cual = sys.argv[1] if len(sys.argv) > 1 else "multicrm-staging"
ip, ruta, node = ENTORNOS[cual]
print("=" * 62)
print(cual)
print("=" * 62)

c = conectar(ip, "claude", None)
sftp = c.open_sftp()
with sftp.open("/tmp/_probar_estados.mjs", "w") as f:
    f.write(JS)
sftp.close()
_, o, e = c.exec_command(
    "cd %s && sudo -n cp /tmp/_probar_estados.mjs ./_pe.mjs && "
    "sudo -n %s ./_pe.mjs 2>&1; sudo -n rm -f ./_pe.mjs" % (ruta, node), timeout=300)
salida = (o.read() + e.read()).decode("utf8", "replace")
print("\n".join(l for l in salida.split("\n")
                if "DeprecationWarning" not in l and "trace-deprecation" not in l))
