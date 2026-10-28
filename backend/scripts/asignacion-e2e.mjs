// Uso, en el servidor y dentro del backend de un STAGING (nunca en producción):
//   node scripts/asignacion-e2e.mjs
// Fase 3.1 de CRM#513: la asignación por actividad de punta a punta en un staging (también WhatsApp, fase 5).
// Lo que recibe cada escenario va a httpbin.org (receptor público de pruebas) y solo lleva datos inventados.
// Todo lo que crea lleva «[E2E]» o «asig-e2e» y se borra al final, falle lo que falle.
import 'dotenv/config';
import jwt from 'jsonwebtoken';
const { query } = await import('../src/shared/config/db.js');
// Crea y borra leads y actividad: solo en una base de pruebas.
const { rows: [{ base }] } = await query('SELECT current_database() AS base');
if (['crm_prod_db', 'crm_iseie'].includes(base)) { console.log(`R PARADO: ${base} es producción`); process.exit(1); }
const { gestoresDelReparto } = await import('../src/modules/leads/reparto.js');
const { activasEntre, cuentasDe, elegir } = await import('../src/modules/asignacion/asignacion.actividad.js');

const API = `http://127.0.0.1:${process.env.PORT}/api`;
const SELLO = Date.now();
let bien = 0, mal = 0;
const R = (s) => console.log('R ' + s);
const ok = (cond, s) => { if (cond) { bien++; console.log('OK ' + s); } else { mal++; console.log('MAL ' + s); } };
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const limpiar = { leads: new Set(), interacciones: [], estados: [], actividad: [], lead_prueba: null, config: null };

const { rows: [sa] } = await query(`SELECT id, email FROM users WHERE role = 'superadmin' AND active ORDER BY id LIMIT 1`);
const tok = jwt.sign({ userId: sa.id, email: sa.email, role: 'superadmin', roles_extra: [], customRoleId: null }, process.env.JWT_SECRET, { expiresIn: '15m' });
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };
const pedir = async (m, ruta, body, hh = H) => {
  const t0 = Date.now();
  const r = await fetch(API + ruta, { method: m, headers: hh, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})), ms: Date.now() - t0 };
};

// El campus: activo, sin configuración, con al menos dos personas en el reparto y ninguna activa ahora.
const ej = (sql, p) => query(sql, p);
const { rows: proyectos } = await query(`SELECT p.id, p.nombre FROM projects p WHERE p.active
  AND NOT EXISTS (SELECT 1 FROM asignacion_destinos d WHERE d.project_id = p.id) ORDER BY p.id`);
let campus = null, gente = [];
for (const p of proyectos) {
  const g = await gestoresDelReparto(ej, p.id);
  if (g.length < 2) continue;
  const act = await activasEntre(g.map((x) => x.id), 15);
  if (act.size) continue;
  campus = p; gente = g; break;
}
if (!campus) { R('PARADO: ningún campus con dos personas en el reparto y nadie activo'); process.exit(1); }
const [G1, G2] = gente.map((g) => ({ id: Number(g.id), nombre: g.nombre }));
R(`campus ${campus.nombre} (#${campus.id}) · reparto: ${gente.map((g) => `${g.nombre} #${g.id}`).join(', ')}`);

const entrada = (clave, cuerpo) => pedir('POST', '/asignacion/entrada', cuerpo, { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' });
const formulario = (letra) => ({
  uid: `asig-e2e-${SELLO}-${letra}`,
  nombre: `[E2E] Cliente ${letra}`,
  email: `asig-e2e-${SELLO}-${letra.toLowerCase()}@ejemplo.com`,
  telefono: `+3460000${String(SELLO).slice(-4)}${letra.charCodeAt(0) % 10}`,
  notas: 'Formulario de prueba de la asignación por actividad',
  landing_url: 'https://ejemplo.com/curso-prueba?utm_source=e2e',
  original: { asunto: `Nuevo formulario del Curso de Prueba ${letra}`, html: `<p>Nombre: [E2E] Cliente ${letra}</p>`, texto: `Nombre: [E2E] Cliente ${letra}`, remitente: 'no-contestar@ejemplo.com' },
});
// Lo que el escenario recibió: httpbin devuelve el cuerpo y el CRM guarda los primeros 1000 caracteres.
const envioDe = async (decisionId) => {
  for (let i = 0; i < 20; i++) {
    const { rows: [d] } = await query(`SELECT estado, http_status, respuesta, error, destino_tipo, escenario, lead_id FROM asignacion_decisiones WHERE id = $1`, [decisionId]);
    if (d && ['enviado', 'fallido'].includes(d.estado)) {
      // El eco viene recortado: del campo «data» (el cuerpo tal cual se mandó) se queda el principio.
      const i = String(d.respuesta || '').indexOf('"data": "');
      const crudo = i < 0 ? '' : d.respuesta.slice(i + 9).replace(/\\"/g, '"');
      return { ...d, crudo };
    }
    await esperar(1000);
  }
  return { estado: 'sin terminar' };
};
const actividad = async (uid, accion = 'prueba_e2e') => {
  const { rows: [r] } = await query(`INSERT INTO actividad_crm (user_id, accion, ruta) VALUES ($1, $2, '/e2e') RETURNING id`, [uid, accion]);
  limpiar.actividad.push(r.id);
};

try {
  // ── Configuración: los dos escenarios a un receptor de pruebas, distinto para cada uno.
  const c = await pedir('POST', '/asignacion', {
    nombre: '[E2E] asignación por actividad', ambito: 'campus', project_id: campus.id, ventana_min: 15,
    escenario1: { tipo: 'webhook', valor: 'https://httpbin.org/anything/escenario1' },
    escenario2: { tipo: 'webhook', valor: 'https://httpbin.org/anything/escenario2' },
  });
  ok(c.s === 201, `configuración creada (${c.s} ${c.j.error || ''})`);
  if (c.s !== 201) throw new Error('sin configuración');
  limpiar.config = c.j.data.id;
  const clave = c.j.data.clave;
  ok(String(clave).startsWith('asig_'), 'la clave se enseña una vez al crearla');

  // ── A · Nadie activo → escenario 1, sin crear el lead.
  const fA = formulario('A');
  const a = await entrada(clave, fA);
  ok(a.s === 200 && a.j.data?.escenario === 1 && !a.j.data?.gestora && !a.j.data?.lead_id,
    `A · nadie activo → escenario 1 sin lead (${a.s} · ${a.j.data?.motivo || a.j.error})`);
  ok(a.ms < 2000, `A · contesta en ${a.ms} ms (< 2 s)`);
  const { rows: [nA] } = await query(`SELECT COUNT(*)::int AS n FROM leads WHERE email = $1`, [fA.email]);
  ok(nA.n === 0, `A · el CRM no ha creado el lead (${nA.n})`);
  const eA = await envioDe(a.j.data?.decision_id);
  ok(eA.estado === 'enviado' && eA.http_status === 200, `A · entregado al escenario 1 (${eA.estado} · http ${eA.http_status} ${eA.error || ''})`);
  ok(eA.crudo.includes('"evento":"lead.asignacion","escenario":1') && eA.crudo.includes('"gestora":null')
    && eA.crudo.includes(`"nombre":"${fA.nombre}"`) && eA.crudo.includes(`"email":"${fA.email}"`),
    'A · el escenario 1 recibe los campos del formulario, sin gestora');

  // ── B · Lo que NO cuenta: una nota corta, una nota repetida, un cambio de estado deshecho.
  const { rows: [lp] } = await query(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, '[E2E] lead para actividad', $2) RETURNING id`,
    [campus.id, `asig-e2e-${SELLO}-actividad@ejemplo.com`]);
  limpiar.lead_prueba = lp.id; limpiar.leads.add(lp.id);
  const nota = async (uid, texto, haceMin = 0) => {
    const { rows: [r] } = await query(`INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, created_at)
      VALUES ($1, 'nota', $2, $3, NOW() - make_interval(mins => $4::int)) RETURNING id`, [lp.id, texto, uid, haceMin]);
    limpiar.interacciones.push(r.id);
  };
  await nota(G1.id, 'Llamar luego');                                           // 12 caracteres
  await nota(G2.id, 'Le he dejado un mensaje de voz al cliente', 24 * 60);     // ayer
  await nota(G2.id, 'Le he dejado un mensaje de voz al cliente');              // la misma hoy
  const { rows: [par] } = await query(`SELECT status_anterior, status_nuevo FROM lead_status_history
    WHERE status_anterior IS NOT NULL AND status_anterior <> status_nuevo LIMIT 1`);
  if (par) {
    for (const [de, a2, hace] of [[par.status_anterior, par.status_nuevo, 6], [par.status_nuevo, par.status_anterior, 3]]) {
      const { rows: [r] } = await query(`INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by, changed_at)
        VALUES ($1, $2, $3, $4, NOW() - make_interval(mins => $5::int)) RETURNING id`, [lp.id, de, a2, G1.id, hace]);
      limpiar.estados.push(r.id);
    }
  }
  const act0 = await activasEntre([G1.id, G2.id], 15);
  ok(act0.size === 0, `B · nota corta, nota repetida y estado deshecho no cuentan (activas: ${act0.size})`);
  const b = await entrada(clave, formulario('B'));
  ok(b.j.data?.escenario === 1, `B · sigue yendo al escenario 1 (${b.j.data?.motivo})`);

  // ── C · Una gestora activa → el CRM crea el lead con ella y va al escenario 2.
  await nota(G1.id, 'Hablado con la alumna, quiere la beca del 30 %');
  const fC = formulario('C');
  const cc = await entrada(clave, fC);
  ok(cc.s === 200 && cc.j.data?.escenario === 2 && cc.j.data?.gestora?.id === G1.id && cc.j.data?.lead_id,
    `C · ${G1.nombre} activa → escenario 2 con ella (${cc.j.data?.motivo || cc.j.error})`);
  ok(cc.ms < 2000, `C · contesta en ${cc.ms} ms (< 2 s)`);
  if (cc.j.data?.lead_id) limpiar.leads.add(cc.j.data.lead_id);
  const { rows: [lC] } = await query(`SELECT id, responsable_id, project_id FROM leads WHERE email = $1 AND deleted_at IS NULL`, [fC.email]);
  ok(lC && Number(lC.responsable_id) === G1.id && Number(lC.project_id) === campus.id, `C · el lead #${lC?.id} es de ${G1.nombre} y de su campus`);
  const eC = await envioDe(cc.j.data?.decision_id);
  ok(eC.estado === 'enviado' && eC.http_status === 200, `C · entregado al escenario 2 (${eC.estado} · http ${eC.http_status} ${eC.error || ''})`);
  ok(eC.crudo.includes('"escenario":2') && eC.crudo.includes(`"lead_id":${lC?.id}`) && eC.crudo.includes(`"gestora":{"id":${G1.id},`)
    , 'C · el escenario 2 recibe el lead y la gestora');  // los planos (responsable_*) van detrás y el eco los corta; los cubre la prueba de construirPayload
  ok(eC.crudo.includes(`"nombre":"${fC.nombre}"`) && eC.crudo.includes(`"telefono":"${fC.telefono}"`), 'C · y los campos del formulario tal cual');
  R(`C · así le llega: ${eC.crudo.slice(0, 420)}…`);

  // ── D · Make reintenta el mismo formulario → la misma respuesta, ni lead ni envío nuevos.
  const d = await entrada(clave, fC);
  ok(d.j.data?.decision_id === cc.j.data?.decision_id && d.j.data?.lead_id === cc.j.data?.lead_id, 'D · el mismo uid devuelve la misma decisión');
  const { rows: [nC] } = await query(`SELECT COUNT(*)::int AS n FROM leads WHERE email = $1`, [fC.email]);
  const { rows: [dC] } = await query(`SELECT COUNT(*)::int AS n FROM asignacion_decisiones WHERE uid = $1`, [fC.uid]);
  ok(nC.n === 1 && dC.n === 1, `D · sin duplicados (${nC.n} lead, ${dC.n} decisión)`);

  // ── E · Las dos activas → le toca a quien tenga menos hoy, luego menos en total, luego el turno.
  await actividad(G2.id);
  const cuentas = await cuentasDe([G1.id, G2.id], campus.id);
  const esperada = elegir([G1.id, G2.id], cuentas).elegida;
  const fE = formulario('E');
  const e = await entrada(clave, fE);
  if (e.j.data?.lead_id) limpiar.leads.add(e.j.data.lead_id);
  const nom = (id) => (id === G1.id ? G1.nombre : G2.nombre);
  R(`E · cuentas: ${[G1, G2].map((g) => `${g.nombre} ${cuentas.get(g.id).hoy} hoy / ${cuentas.get(g.id).total} total`).join(' · ')}`);
  ok(e.j.data?.escenario === 2 && e.j.data?.gestora?.id === esperada.id, `E · desempate → ${nom(esperada.id)} (${e.j.data?.motivo})`);
  // Y el siguiente, ya con ese lead contado.
  const cuentas2 = await cuentasDe([G1.id, G2.id], campus.id);
  const esperada2 = elegir([G1.id, G2.id], cuentas2).elegida;
  const f = await entrada(clave, formulario('F'));
  if (f.j.data?.lead_id) limpiar.leads.add(f.j.data.lead_id);
  ok(f.j.data?.gestora?.id === esperada2.id, `E · el siguiente → ${nom(esperada2.id)} (${f.j.data?.motivo})`);
  const { rows: [reg] } = await query(`SELECT motivo FROM asignacion_decisiones WHERE id = $1`, [e.j.data?.decision_id]);
  ok(reg?.motivo?.activas?.length === 2 && reg?.motivo?.candidatas?.length === gente.length, 'E · el registro guarda candidatas, activas y el porqué');

  // ── F · Apagada → escenario 1 aunque haya activas.
  const off = await pedir('PATCH', `/asignacion/${limpiar.config}`, { activo: false });
  ok(off.s === 200, `F · apagar (${off.s} ${off.j.error || ''})`);
  const fF = formulario('G');
  const g = await entrada(clave, fF);
  ok(g.j.data?.escenario === 1 && !g.j.data?.lead_id, `F · apagada → escenario 1 sin lead (${g.j.data?.motivo})`);
  await pedir('PATCH', `/asignacion/${limpiar.config}`, { activo: true });

  // ── G · Lo que Make tiene que tratar como «el CRM no contesta» → escenario 1.
  const k1 = await entrada('asig_clave_que_no_existe', formulario('H'));
  ok(k1.s === 401, `G · clave mala → ${k1.s}`);
  const k2 = await pedir('POST', '/asignacion/entrada', formulario('I'), { 'Content-Type': 'application/json' });
  ok(k2.s === 401, `G · sin clave → ${k2.s}`);
  const sinUid = formulario('J'); delete sinUid.uid;
  const k3 = await entrada(clave, sinUid);
  ok(k3.s === 400, `G · sin uid → ${k3.s} (${k3.j.error})`);
  const sinNombre = formulario('K'); delete sinNombre.nombre;
  const k4 = await entrada(clave, sinNombre);
  R(`G · sin nombre → ${k4.s} (${k4.j.error || 'escenario ' + k4.j.data?.escenario})`);
  if (k4.j.data?.lead_id) limpiar.leads.add(k4.j.data.lead_id);

  // ── H · El registro, como lo ve la pantalla.
  const r = await pedir('GET', `/asignacion/decisiones?destino_id=${limpiar.config}`);
  const n1 = (r.j.data || []).filter((x) => x.escenario === 1).length, n2 = (r.j.data || []).filter((x) => x.escenario === 2).length;
  ok(r.s === 200 && n1 >= 3 && n2 >= 3, `H · el registro enseña ${n1} al escenario 1 y ${n2} al 2`);

  // ── W · WhatsApp (fase 5): lo que manda desde el móvil con su número conectado.
  await query(`DELETE FROM actividad_crm WHERE id = ANY($1::bigint[])`, [limpiar.actividad]);
  await query(`DELETE FROM lead_interactions WHERE id = ANY($1::int[])`, [limpiar.interacciones]);
  ok((await activasEntre([G1.id, G2.id], 15)).size === 0, 'W · sin actividad otra vez');
  const conv = async (uid, jid) => (await query(`INSERT INTO wa_conversaciones (instancia, jid, telefono, project_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`e2e-u${uid}`, jid, '+34699' + String(SELLO).slice(-6), campus.id])).rows[0].id;
  const historial = await conv(G1.id, `e2e${SELLO}h@s.whatsapp.net`);
  await query(`INSERT INTO wa_mensajes (conversacion_id, direccion, texto, ts) VALUES ($1, 'saliente', 'hola', NOW() - INTERVAL '3 days')`, [historial]);
  ok((await entrada(clave, formulario('W'))).j.data?.escenario === 1, 'W · el historial al emparejar no la hace activa');
  const movil = await conv(G2.id, `e2e${SELLO}m@s.whatsapp.net`);
  await query(`INSERT INTO wa_mensajes (conversacion_id, direccion, texto, ts) VALUES ($1, 'saliente', 'Hola, te escribo por el curso', NOW())`, [movil]);
  const w = await entrada(clave, formulario('X'));
  if (w.j.data?.lead_id) limpiar.leads.add(w.j.data.lead_id);
  ok(w.j.data?.escenario === 2 && w.j.data?.gestora?.id === G2.id, `W · un WhatsApp desde su móvil → ${G2.nombre} (${w.j.data?.motivo})`);
  const antes = (await cuentasDe([G1.id], campus.id)).get(G1.id).hoy;
  const abierta = await conv(G1.id, `e2e${SELLO}a@s.whatsapp.net`);
  await query(`INSERT INTO wa_mensajes (conversacion_id, direccion, texto, ts) VALUES ($1, 'entrante', 'Hola, quiero información', NOW())`, [abierta]);
  const desp = (await cuentasDe([G1.id], campus.id)).get(G1.id);
  ok(desp.hoy === antes + 1 && desp.whatsapp === 1, `W · una conversación que le abren hoy cuenta (${antes} → ${desp.hoy} hoy, ${desp.whatsapp} por WhatsApp)`);
  const wd = await fetch(`${API}/w/data/${campus.id}.json`).then((r) => r.json()).catch(() => ({}));
  R(`W · widget del campus: ${wd.enabled ? `encendido, da ${wd.gestoras?.length} gestora(s)` : 'apagado en este campus'}`);
} catch (err) {
  mal++; console.log('MAL excepción: ' + err.message);
} finally {
  // Limpieza: los leads creados (y lo que cuelga de ellos), la actividad inventada, las decisiones y la configuración.
  const { rows: creados } = await query(`SELECT id FROM leads WHERE email LIKE $1`, [`asig-e2e-${SELLO}-%`]);
  creados.forEach((x) => limpiar.leads.add(x.id));
  const ids = [...limpiar.leads];
  try {
    if (limpiar.actividad.length) await query(`DELETE FROM actividad_crm WHERE id = ANY($1::bigint[])`, [limpiar.actividad]);
    await query(`DELETE FROM wa_conversaciones WHERE instancia LIKE 'e2e-u%' AND jid LIKE $1`, [`e2e${SELLO}%`]);
    if (limpiar.interacciones.length) await query(`DELETE FROM lead_interactions WHERE id = ANY($1::int[])`, [limpiar.interacciones]);
    if (limpiar.estados.length) await query(`DELETE FROM lead_status_history WHERE id = ANY($1::int[])`, [limpiar.estados]);
    if (ids.length) {
      const av = await query(`DELETE FROM admin_notifications WHERE (metadata->>'lead_id')::int = ANY($1::int[]) OR title LIKE 'Nuevo prospecto: [E2E]%'`, [ids])
        .catch((e) => { R('AVISO notificaciones: ' + e.message); return { rowCount: 0 }; });
      R(`limpieza: ${av.rowCount} avisos de «nuevo prospecto»`);
      await query(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids]);
    }
    if (limpiar.config) {
      await query(`DELETE FROM asignacion_decisiones WHERE destino_id = $1`, [limpiar.config]);
      const b = await pedir('DELETE', `/asignacion/${limpiar.config}`);
      R(`limpieza: ${ids.length} leads, ${limpiar.actividad.length} acciones, configuración ${b.s}`);
    }
    const { rows: [resto] } = await query(`SELECT (SELECT COUNT(*) FROM leads WHERE email LIKE $1)::int AS leads,
      (SELECT COUNT(*) FROM asignacion_decisiones WHERE uid LIKE $2)::int AS decisiones`, [`asig-e2e-${SELLO}-%`, `asig-e2e-${SELLO}-%`]);
    ok(resto.leads === 0 && resto.decisiones === 0, `limpio (quedan ${resto.leads} leads y ${resto.decisiones} decisiones de la prueba)`);
  } catch (err) { R('AVISO limpieza: ' + err.message); }
  R(`RESULTADO ${bien} bien · ${mal} mal`);
  process.exit(mal ? 1 : 0);
}
