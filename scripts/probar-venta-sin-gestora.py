# -*- coding: utf-8 -*-
"""Comprueba la venta sin gestora de punta a punta, contra la base de pruebas.

Cuatro cosas, y las cuatro importan:

  1. La venta normal SIGUE asignandose (no se ha roto lo de siempre).
  2. La venta sin gestora se queda sin responsable Y sin vendedora.
  3. NO avanza el reparto: el siguiente prospecto de verdad le toca a quien le
     tocaba. Si esto falla, cada venta de mostrador saltaria el turno de una
     gestora en silencio.
  4. El permiso manda: quien no lo tiene no puede, aunque mande el dato a mano.

Todo lo que crea se borra al final.

    python scripts/probar-venta-sin-gestora.py [multicrm-staging|iseie-staging]
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
import { createSale } from './src/modules/sales/sales.service.js';
import { resolvePermission } from './src/modules/permissions/permissions.service.js';
import { query } from './src/shared/config/db.js';

const marca = `ZZ-PRUEBA-${Date.now()}`;
const creados = [];

// Un proyecto con gestoras de verdad, para que el reparto tenga a quien darle.
const { rows: proys } = await query(`
  SELECT p.id, p.nombre, count(*)::int AS gestoras
    FROM projects p
    JOIN user_projects up ON up.project_id = p.id AND up.active
    JOIN users u ON u.id = up.user_id AND u.active AND u.role IN ('gestor','admin')
   WHERE p.active AND NOT COALESCE(p.es_prueba, false)
   GROUP BY p.id, p.nombre HAVING count(*) >= 2
   ORDER BY count(*) DESC LIMIT 1`);
if (!proys.length) { console.log('no hay proyecto con dos gestoras: no se puede probar'); process.exit(0); }
const proy = proys[0];
const { rows: prod } = await query(
  'SELECT id FROM products WHERE project_id = $1 AND active LIMIT 1', [proy.id]);
if (!prod.length) { console.log('el proyecto no tiene productos'); process.exit(0); }
console.log(`proyecto de prueba: ${proy.nombre} (${proy.gestoras} gestoras)\n`);

const turno = async () => (await query(
  'SELECT last_assigned_index FROM project_queue_state WHERE project_id = $1',
  [proy.id])).rows[0]?.last_assigned_index;

const base = {
  project_id: proy.id, producto_interes_id: prod[0].id,
  importe_total: 10, importe_pagado: 10, metodo_pago: 'transferencia',
  fecha_pago: new Date().toISOString().slice(0, 10),
};
const admin = { userId: 1, role: 'superadmin', customRoleId: null };

// ── 1 · La venta de siempre: tiene que seguir teniendo duena.
const antes = await turno();
const v1 = await createSale({ ...base, nombre: `${marca}-normal`, email: `${marca}@x.test` }, admin);
creados.push(v1);
const r1 = (await query(
  'SELECT l.responsable_id, c.vendedora_id FROM conversions c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1',
  [v1.sale_id])).rows[0];
console.log(`1 · venta normal ....... responsable=${r1.responsable_id ?? 'NINGUNO'}  ${r1.responsable_id ? 'OK' : 'MAL: deberia tener'}`);

// ── 2 y 3 · La venta sin gestora.
const medio = await turno();
const v2 = await createSale({ ...base, nombre: `${marca}-sin-gestora`, sin_gestora: true }, admin);
creados.push(v2);
const r2 = (await query(
  'SELECT l.responsable_id, c.vendedora_id FROM conversions c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1',
  [v2.sale_id])).rows[0];
const despues = await turno();
console.log(`2 · sin gestora ........ responsable=${r2.responsable_id ?? 'NINGUNO'} vendedora=${r2.vendedora_id ?? 'NINGUNA'}  ${r2.responsable_id === null && r2.vendedora_id === null ? 'OK' : 'MAL: no deberia tener'}`);
console.log(`3 · el turno del reparto  antes=${medio} despues=${despues}  ${medio === despues ? 'NO se movio, OK' : 'SE MOVIO: MAL'}`);

// ── 4 · El permiso.
const { rows: roles } = await query(
  "SELECT DISTINCT role FROM users WHERE active ORDER BY role");
for (const { role } of roles) {
  const { rows: u } = await query(
    'SELECT id, custom_role_id FROM users WHERE role = $1 AND active LIMIT 1', [role]);
  const puede = await resolvePermission(u[0].id, role, u[0].custom_role_id ?? null,
    'conversions', 'sin_gestora');
  const esperado = role === 'admin' || role === 'superadmin';
  console.log(`4 · ${role.padEnd(12)} puede=${String(puede).padEnd(5)} ${Boolean(puede) === esperado ? 'OK' : (puede ? 'MAL: no deberia' : 'MAL: deberia')}`);
}

// ── Limpieza.
for (const v of creados) {
  await query('DELETE FROM conversion_payments WHERE conversion_id = $1', [v.sale_id]);
  await query('DELETE FROM conversions WHERE id = $1', [v.sale_id]);
  await query('DELETE FROM lead_steps WHERE lead_id = $1', [v.lead_id]);
  await query('DELETE FROM lead_status_history WHERE lead_id = $1', [v.lead_id]);
  await query('DELETE FROM lead_interactions WHERE lead_id = $1', [v.lead_id]);
  await query('DELETE FROM leads WHERE id = $1', [v.lead_id]);
}
const { rows: quedan } = await query(
  'SELECT count(*)::int AS n FROM leads WHERE nombre LIKE $1', [`${marca}%`]);
console.log(`\nlimpieza: quedan ${quedan[0].n} de prueba (tiene que ser 0)`);
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
with sftp.open("/tmp/_probar_vsg.mjs", "w") as f:
    f.write(JS)
sftp.close()
_, o, e = c.exec_command(
    "cd %s && sudo -n cp /tmp/_probar_vsg.mjs ./_vsg.mjs && "
    "sudo -n %s ./_vsg.mjs 2>&1; sudo -n rm -f ./_vsg.mjs" % (ruta, node), timeout=600)
salida = (o.read() + e.read()).decode("utf8", "replace")
print("\n".join(l for l in salida.split("\n")
                if "DeprecationWarning" not in l and "trace-deprecation" not in l))
