// Equipos iniciales del tablero de Tareas en CRM-ISEIE (Diego, 26/10/2026).
// Gemelo del guion del día de producción del 360 (allí, CEDIA e ICTESS).
//
//   cd backend && MODO=ver node scripts/equipos-tareas-iniciales.mjs       (no toca nada: dice lo que haría)
//   cd backend && MODO=aplicar node scripts/equipos-tareas-iniciales.mjs   (lo hace)
//
// Va DESPUÉS de la migración 235 y del código de los equipos. Se puede pasar
// dos veces: lo que ya está, se deja.
//
//   1. Copia JSON de los permisos por persona de Tareas de los encargados
//      (en /var/backups/crm-iseie, o en COPIAS=<carpeta>).
//   2. En la empresa ISEIE (invoice_issuers «ISEIE…», la 6), «Desarrollo y SEO» y
//      «Temarios», cada uno con «Encargado» (nivel 2) y «Miembro» (nivel 1).
//   3. «Desarrollo y SEO»: encargados Ángel CEDIA, Ruth, Julián, Eduardo, Jesús y
//      Diego; miembros Pedro, Ángel ISEIE, César, Gustavo, Jonathan, Diana y Hugo.
//      «Temarios», vacío (ahí irá la gente de temarios que diga Diego).
//   4. A los encargados se les QUITAN las excepciones por persona tasks.assign y
//      tasks.view_all (se dieron el 26/10 por la tarde): con «Asignar» delegarían
//      en todos, como un admin, en vez de hacia abajo por su cargo.
//
// Va por CORREO, no por id: los ids de staging y de producción no son los mismos.
// Quien no está (o no es de la empresa) sale como AVISO y no entra.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';

const { query } = await import('../src/shared/config/db.js');
const eq = await import('../src/modules/tasks/tasks.equipos.model.js');
const perm = await import('../src/modules/permissions/permissions.model.js');

const APLICAR = process.env.MODO === 'aplicar';
const COPIAS = process.env.COPIAS || '/var/backups/crm-iseie';

// Una persona puede tener dos correos (el de Ángel ISEIE cambió el 26/10).
const ENCARGADOS = [
  ['Ángel (CEDIA)', 'nangelm.dev@gmail.com'],
  ['Ruth', 'ruthsanch22@gmail.com'],
  ['Julián', 'julian180808@gmail.com'],
  ['Eduardo', 'ravelcoin@gmail.com'],
  ['Jesús', 'jesusrodriguezacevedo1@gmail.com'],
  ['Diego', 'diego.landaeta.seo@gmail.com'],
];
const MIEMBROS = [
  ['Pedro', 'plbn1000@gmail.com'],
  ['Ángel (ISEIE)', 'angeljoseloretoh@hotmail.com', 'angejosehernandez14@gmail.com'],
  ['César', 'cesarmch2003@gmail.com'],
  ['Gustavo', 'alexuneg77@gmail.com'],
  ['Jonathan', 'colabminecraft94@gmail.com'],
  ['Diana', 'dianazieg2015@gmail.com'],
  ['Hugo', 'contrerashugo447@gmail.com'],
];
const EQUIPOS = [
  { name: 'Desarrollo y SEO', color: 'blue', sort_order: 1 },
  { name: 'Temarios', color: 'purple', sort_order: 2 },
];

const log = (s) => console.log(`R ${s}`);

if (!(await eq.existeEquipos())) { console.log('PARADO: falta la migración 235 (tasks.team_id)'); process.exit(1); }

const { rows: empresas } = await query(
  `SELECT id, razon_social FROM invoice_issuers WHERE razon_social ILIKE 'ISEIE%' ORDER BY id`);
if (empresas.length !== 1) { console.log(`PARADO: esperaba UNA empresa ISEIE y hay ${empresas.length}`); process.exit(1); }
const empresa = empresas[0];
log(`empresa ${empresa.id} · ${empresa.razon_social} · ${APLICAR ? 'APLICAR' : 'solo ver'}`);

async function persona([nombre, ...correos]) {
  const { rows } = await query(
    'SELECT id, nombre, role::text AS role FROM users WHERE lower(email) = ANY($1::text[]) AND active ORDER BY id',
    [correos.map((c) => c.toLowerCase())]);
  if (!rows.length) { console.log(`AVISO no está (o no está activo): ${nombre} <${correos.join(' / ')}>`); return null; }
  return { ...rows[0], etiqueta: nombre };
}
const encargados = (await Promise.all(ENCARGADOS.map(persona))).filter(Boolean);
const miembros = (await Promise.all(MIEMBROS.map(persona))).filter(Boolean);
const diego = encargados.find((u) => u.etiqueta === 'Diego');

// 1. Copia de las excepciones de Tareas de los encargados, antes de tocarlas.
const { rows: excepciones } = await query(
  `SELECT * FROM user_permission_overrides WHERE user_id = ANY($1::int[]) AND resource = 'tasks' ORDER BY user_id, action`,
  [encargados.map((u) => u.id)]);
log(`excepciones de Tareas de los encargados: ${JSON.stringify(excepciones.map((o) => `${o.user_id}:${o.action}=${o.allowed}`))}`);
if (APLICAR) {
  fs.mkdirSync(COPIAS, { recursive: true });
  const f = path.join(COPIAS, `equipos-tareas-antes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify({ empresa, excepciones }, null, 1));
  log(`copia ${f}`);
}

// 2 y 3. Los equipos y quién está en cada uno.
const ya = await eq.listarEquipos({ issuerIds: [empresa.id], incluirArchivados: true });
for (const def of EQUIPOS) {
  let t = ya.find((x) => x.name.toLowerCase() === def.name.toLowerCase());
  if (t) log(`ya existe «${def.name}» (${t.id})${t.is_active ? '' : ' ARCHIVADO: no lo toco'}`);
  else {
    log(`${APLICAR ? 'creo' : 'crearía'} «${def.name}» con Encargado (2) y Miembro (1)`);
    if (APLICAR) t = await eq.crearEquipo({ issuer_id: empresa.id, ...def, created_by: diego?.id ?? null });
  }
  if (def.name !== 'Desarrollo y SEO' || !t || !t.is_active) continue;
  const cargo = Object.fromEntries(t.cargos.map((c) => [c.name, c.id]));
  if (!cargo.Encargado || !cargo.Miembro) { console.log(`AVISO «${def.name}» no tiene los cargos Encargado y Miembro: no meto a nadie`); continue; }
  const poner = [...encargados.map((u) => [u, 'Encargado']), ...miembros.map((u) => [u, 'Miembro'])];
  for (const [u, c] of poner) {
    if (!(await eq.esDeLaEmpresa(t.id, u.id))) { console.log(`AVISO ${u.etiqueta} (${u.id}) no es de la empresa ${empresa.id}: no entra`); continue; }
    log(`${APLICAR ? 'pongo' : 'pondría'} a ${u.etiqueta} (${u.id}, ${u.role}) de ${c}`);
    if (APLICAR) await eq.ponerMiembro(t.id, u.id, cargo[c], diego?.id ?? null);
  }
}

// 4. Fuera «Asignar» y «Ver todas» por persona a los encargados: delegan por su cargo.
const quitar = excepciones.filter((o) => ['assign', 'view_all'].includes(o.action));
for (const o of quitar) {
  if (APLICAR) await perm.setUserOverride(o.user_id, 'tasks', o.action, null);
}
log(`${APLICAR ? 'quitadas' : 'se quitarían'} ${quitar.length} excepciones: ${JSON.stringify(quitar.map((o) => `${o.user_id}:${o.action}=${o.allowed}`))}`);
// A los miembros no se les toca nada, pero si alguno tiene «Asignar» o «Ver todas»
// por persona, que se vea: delegaría en todos como un encargado sin nivel.
const { rows: deMiembros } = await query(
  `SELECT user_id, action FROM user_permission_overrides
    WHERE user_id = ANY($1::int[]) AND resource = 'tasks' AND action IN ('assign', 'view_all') AND allowed`,
  [miembros.map((u) => u.id)]);
for (const o of deMiembros) console.log(`AVISO el miembro ${o.user_id} tiene tasks.${o.action} por persona (no lo quito)`);
process.exit(0);
