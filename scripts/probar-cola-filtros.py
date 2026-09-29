# -*- coding: utf-8 -*-
"""Comprueba los filtros nuevos de la cola del dia: buscador, formacion y fechas.

Cada filtro tiene que DEVOLVER MENOS que sin el y nunca mas, y el buscador tiene
que encontrar a alguien que este mas alla de la primera pagina --si busca solo
en las 100 filas que se ven, dira «no esta» de quien si esta--.

    python scripts/probar-cola-filtros.py [multicrm-staging|iseie-staging]
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

const ids = (await query("SELECT id FROM projects WHERE active ORDER BY id")).rows.map(r => r.id);
const base = { projectIds: ids, asesoraId: null, limite: 100 };

const sinNada = await colaDelDia({ ...base, limite: 1 });
console.log(`sin filtros ................. ${sinNada.total}`);

// ── El buscador. Se coge a alguien de la ULTIMA pagina a proposito.
const todas = [];
for (let p = 1; p * 100 - 100 < sinNada.total; p++) {
  const r = await colaDelDia({ ...base, desplazamiento: (p - 1) * 100 });
  todas.push(...r.filas);
}
console.log(`paginando entero ............ ${todas.length} filas, ${new Set(todas.map(f => f.lead_id)).size} personas distintas`);

const lejos = todas[todas.length - 1];
if (lejos && lejos.lead_nombre) {
  const trozo = String(lejos.lead_nombre).trim().split(/\s+/)[0];
  const r = await colaDelDia({ ...base, busca: trozo, limite: 200 });
  const esta = r.filas.some(f => f.lead_id === lejos.lead_id);
  console.log(`buscar «${trozo}» (fila ${todas.length}, pag. ${Math.ceil(todas.length / 100)}) -> ${r.total} · ${esta ? 'LA ENCUENTRA' : 'NO LA ENCUENTRA'}`);
}

const nadie = await colaDelDia({ ...base, busca: 'zzzznoexiste', limite: 1 });
console.log(`buscar algo que no existe ... ${nadie.total} (tiene que ser 0)`);

// ── La formacion.
const prod = todas.find(f => f.producto);
if (prod) {
  const pid = (await query(
    "SELECT producto_interes_id AS id FROM leads WHERE id = $1", [prod.lead_id])).rows[0].id;
  const r = await colaDelDia({ ...base, productoId: pid, limite: 1 });
  console.log(`formacion «${String(prod.producto).slice(0, 34)}» -> ${r.total} de ${sinNada.total} ${r.total <= sinNada.total ? 'OK' : 'MAL'}`);
} else {
  console.log('formacion ................... nadie de la cola tiene formacion puesta');
}

// ── Las fechas.
//
// OJO con como se comprueba. Contar sobre la lista paginada NO vale: la cola da
// una fila POR PERSONA --su paso mas urgente-- asi que quien tenga el paso 1
// antes de la fecha y el paso 2 dentro no se ve en esa cuenta y si tiene que
// salir en el filtro. Se compara contra la base, que es lo que manda.
const fechas = todas.map(f => f.fecha_prevista).sort();
const personasDesde = async (d) => (await query(`
  SELECT count(DISTINCT ls.lead_id)::int AS n
    FROM lead_steps ls
    JOIN leads l ON l.id = ls.lead_id
   WHERE l.deleted_at IS NULL
     AND ls.estado = 'pendiente'
     AND ls.fecha_prevista <= CURRENT_DATE
     AND ls.fecha_prevista >= $2::date
     AND l.status NOT IN ('convertido','no_interesado')
     AND ls.project_id = ANY($1::int[])
     AND (SELECT count(*) FROM lead_interactions li
           WHERE li.lead_id = l.id AND li.tipo <> 'nota') < ls.orden`,
  [ids, d])).rows[0].n;

if (fechas.length) {
  const medio = fechas[Math.floor(fechas.length / 2)];
  const r = await colaDelDia({ ...base, desde: medio, limite: 1 });
  const enBase = await personasDesde(medio);
  console.log(`desde ${medio} .......... ${r.total} · la base dice ${enBase} · ${r.total === enBase ? 'CUADRA' : 'NO CUADRA'}`);
  const rr = await colaDelDia({ ...base, desde: fechas[0], hasta: medio, limite: 1 });
  console.log(`del ${fechas[0]} al ${medio} -> ${rr.total} · ${rr.total <= sinNada.total ? 'no pasa del total, OK' : 'MAL'}`);
}

// ── Una fecha inventada no puede colarse.
const malo = await colaDelDia({ ...base, desde: 'ayer por la tarde', limite: 1 });
console.log(`desde «ayer por la tarde» ... ${malo.total} (igual que sin filtro: ${malo.total === sinNada.total ? 'bien' : 'MAL'})`);
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
with sftp.open("/tmp/_probar_filtros.mjs", "w") as f:
    f.write(JS)
sftp.close()
_, o, e = c.exec_command(
    "cd %s && sudo -n cp /tmp/_probar_filtros.mjs ./_pf.mjs && "
    "sudo -n %s ./_pf.mjs 2>&1; sudo -n rm -f ./_pf.mjs" % (ruta, node), timeout=600)
salida = (o.read() + e.read()).decode("utf8", "replace")
print("\n".join(l for l in salida.split("\n")
                if "DeprecationWarning" not in l and "trace-deprecation" not in l))
