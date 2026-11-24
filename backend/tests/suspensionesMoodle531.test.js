import {
  describe, it, expect, beforeAll, afterAll, afterEach, vi,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';
import webhook from '../src/modules/consultas/consultas.webhook.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { firmar } from '../src/modules/consultas/consultas.plugin.js';
import { motivoDe, leadDelAlumno } from '../src/modules/consultas/consultas.estadoAlumno.js';
import { estadoAlumnoSchema } from '../src/modules/consultas/consultas.validation.js';
import { suspensionesDelAlumno, estadoDelCampus } from '../src/modules/leads/suspensiones-moodle.js';
import { findAll } from '../src/modules/leads/lead.model.js';
import { TIPOS } from '../src/modules/notifications/tipos.js';
import { suspensionesMoodleActivas } from '../src/shared/config/soloEnPruebas.js';

/**
 * Suspensiones y reactivaciones de Moodle en el CRM (gemela de MultiCRM #531, plugin 1.13.0),
 * contra la base de verdad (la local desechable) y por la ruta de verdad, firmada:
 *
 *   · firma: sin ella o con otra clave, 401; con el interruptor apagado, 400 (el plugin no
 *     reintenta) y no se apunta nada;
 *   · idempotencia: el mismo `cambio_id` dos veces es UNA fila y UNA campana;
 *   · identificación: la ficha con su correo en ese campus (o con una venta en él);
 *   · motivo: cuota vencida, cobro fallido de Stripe, «sin motivo» y, al reactivar, «pagó el …»;
 *   · la ficha (estado e historial) y el filtro «Suspendidos» de Clientes;
 *   · la campana a la gestora (y, sin ficha, a administración del campus).
 *
 *   npx vitest run tests/suspensionesMoodle531.test.js
 */

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const marca = `t531${Date.now()}`;
const SECRETO = 'secreto-del-plugin-531';
const ids = { users: [], projects: [], leads: [] };
let hayBase = true;
let porQueNo = null;

const app = express();
app.use('/api/moodle-avisos', webhook);
app.use(errorHandler);
const api = supertest(app);

function avisar(projectId, cuerpo, { clave = SECRETO, firma = true } = {}) {
  const crudo = JSON.stringify(cuerpo);
  const r = api.post(`/api/moodle-avisos/${projectId}`).set('Content-Type', 'application/json');
  if (firma) r.set('X-Crm-Firma', firmar(Buffer.from(crudo), clave, Math.floor(Date.now() / 1000)));
  return r.send(crudo);
}

let cambioN = 0;
const ahora = () => Math.floor(Date.now() / 1000);
function aviso({ email, suspendido = true, ambito = 'cuenta', curso = null, fecha = ahora(), cambio = null, moodleId = 4 }) {
  cambioN += 1;
  return {
    evento: 'estado_alumno',
    sitio: 'https://campus.test',
    estado: { cambio_id: cambio || `${marca}c${cambioN}`.padEnd(16, '0'), ambito, suspendido, fecha, via: 'ws' },
    alumno: { id: moodleId, nombre: 'Pedro Prueba', email, personal: false },
    curso,
  };
}

async function crearUsuario(role) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, true) RETURNING id`,
    [`${role} ${ids.users.length} ${marca}`, `${role}.${ids.users.length}.${marca}@test.local`, role]);
  ids.users.push(Number(rows[0].id));
  return Number(rows[0].id);
}

async function crearCampus(nombre) {
  const n = ids.projects.length;
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}-${n}`, `k-${marca}-${n}`]);
  const p = Number(rows[0].id);
  ids.projects.push(p);
  const s = encrypt(SECRETO);
  await query(
    `INSERT INTO moodle_plugin_campus (project_id, secreto_cifrado, secreto_iv, secreto_tag, activo) VALUES ($1, $2, $3, $4, true)`,
    [p, s.encrypted, s.iv, s.authTag]);
  return p;
}

async function crearLead(projectId, email, responsableId = null) {
  const { rows } = await query(
    `INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [projectId, `Alumno ${marca}`, email, responsableId]);
  ids.leads.push(Number(rows[0].id));
  return Number(rows[0].id);
}

async function venta(leadId, projectId, { total = 300 } = {}) {
  const { rows } = await query(
    `INSERT INTO conversions (lead_id, project_id, importe_total, producto_contratado) VALUES ($1, $2, $3, 'Curso') RETURNING id`,
    [leadId, projectId, total]);
  return Number(rows[0].id);
}

const filas = (projectId) => query('SELECT * FROM moodle_estado_alumno WHERE project_id = $1 ORDER BY id', [projectId]).then((r) => r.rows);
const campanas = (tipo, leadId) => query(
  `SELECT * FROM admin_notifications WHERE type = $1 AND (metadata->>'lead_id')::int = $2`, [tipo, leadId]).then((r) => r.rows);

beforeAll(async () => {
  try {
    const { rows: [r] } = await query(`SELECT to_regclass('public.moodle_estado_alumno') IS NOT NULL AS hay`);
    if (!r.hay) throw new Error('Falta la migración 333.');
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterEach(() => { vi.unstubAllEnvs(); });

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM moodle_estado_alumno WHERE project_id = ANY($1::int[])', [ids.projects]],
    [`DELETE FROM admin_notifications WHERE (metadata->>'project_id')::int = ANY($1::int[])`, [ids.projects]],
    ['DELETE FROM stripe_payments WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM conversions WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]],
    ['DELETE FROM moodle_plugin_campus WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

// ─── Sin base ────────────────────────────────────────────────────────────────

describe('#531 · el motivo (motivoDe, sin base)', () => {
  it('al suspender: cobro fallido antes que cuota vencida, antes que pendiente; si no, «sin motivo»', () => {
    const todo = {
      cobroFallido: { fecha: '12/11/2026', importe: 49, moneda: 'EUR' },
      cuotasVencidas: { cuantas: 2, desde: '01/11/2026' },
      ventaPendiente: { cuantas: 1, desde: null },
    };
    expect(motivoDe(todo, { suspendido: true })).toEqual({ motivo: 'cobro_fallido', texto: 'Cobro fallido en Stripe el 12/11/2026 (49,00 EUR)' });
    expect(motivoDe({ ...todo, cobroFallido: null }, { suspendido: true }).texto).toBe('2 cuotas vencidas sin pagar desde el 01/11/2026');
    expect(motivoDe({ ventaPendiente: { cuantas: 1, desde: '05/11/2026' } }, { suspendido: true }))
      .toEqual({ motivo: 'pendiente_vencido', texto: 'Venta con pago pendiente desde el 05/11/2026' });
    expect(motivoDe({}, { suspendido: true }).motivo).toBe('sin_motivo');
  });
  it('al reactivar: «pagó el …» con un cobro reciente; si no, «sin cobro reciente»', () => {
    expect(motivoDe({ ultimoCobro: { fecha: '20/11/2026' } }, { suspendido: false }))
      .toEqual({ motivo: 'pago', texto: 'Pagó el 20/11/2026' });
    expect(motivoDe({ cuotasVencidas: { cuantas: 1, desde: 'x' } }, { suspendido: false }).motivo).toBe('reactivado');
  });
});

describe('#531 · el esquema del aviso', () => {
  it('acepta lo que manda el plugin y pide el curso en una matrícula', () => {
    expect(estadoAlumnoSchema.safeParse(aviso({ email: 'a@b.c' })).success).toBe(true);
    expect(estadoAlumnoSchema.safeParse(aviso({ email: 'a@b.c', ambito: 'curso', curso: { id: 2, nombre: 'C' } })).success).toBe(true);
    expect(estadoAlumnoSchema.safeParse(aviso({ email: 'a@b.c', ambito: 'curso' })).success).toBe(false);
    expect(estadoAlumnoSchema.safeParse({ ...aviso({ email: 'a@b.c' }), estado: { ...aviso({ email: 'x' }).estado, cambio_id: "x'; DROP" } }).success).toBe(false);
  });
  it('estado del campus: lo último de cada cosa manda', () => {
    const e = estadoDelCampus(1, 'C', [
      { ambito: 'cuenta', suspendido: false, fecha: '2026-11-20T10:00:00Z', motivo: 'pago', motivoTexto: 'R' },
      { ambito: 'curso', curso: { id: 2, nombre: 'K' }, suspendido: true, fecha: '2026-11-19T10:00:00Z', motivo: 'cuota_vencida', motivoTexto: 'Cuota' },
    ]);
    expect(e).toMatchObject({ estado: 'suspendido', cuenta: false, cursos: [{ id: 2, nombre: 'K' }], motivo: 'cuota_vencida' });
  });
  it('los tipos de campana nuevos están en el mapa', () => {
    expect(TIPOS.moodle_alumno_suspendido?.clase).toBe('accion');
    expect(TIPOS.moodle_alumno_reactivado?.clase).toBe('aviso');
  });
  it('el interruptor: en producción, apagado salvo con los dos encendidos', () => {
    expect(suspensionesMoodleActivas({ NODE_ENV: 'production' })).toBe(false);
    expect(suspensionesMoodleActivas({ NODE_ENV: 'production', SUSPENSIONES_MOODLE_EN_PRODUCCION: '1' })).toBe(false);
    expect(suspensionesMoodleActivas({ NODE_ENV: 'production', SUSPENSIONES_MOODLE_EN_PRODUCCION: '1', PLUGIN_MOODLE_EN_PRODUCCION: '1' })).toBe(true);
    expect(suspensionesMoodleActivas({ NODE_ENV: 'production', CRM_BASE_URL: 'https://x/staging' })).toBe(true);
  });
});

// ─── Con base ────────────────────────────────────────────────────────────────

describe('hay base', () => {
  it('con la migración 333', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('#531 · recibir el aviso', () => {
  it('sin firma o con otra clave, 401 y nada apuntado', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Firma');
    expect((await avisar(p, aviso({ email: 'x@test.local' }), { firma: false })).status).toBe(401);
    expect((await avisar(p, aviso({ email: 'x@test.local' }), { clave: 'otra' })).status).toBe(401);
    expect(await filas(p)).toHaveLength(0);
  });

  it('con el interruptor apagado (producción sin aprobar), 400 EVENTO_NO_ADMITIDO y nada apuntado', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Apagado');
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CRM_BASE_URL', 'https://crm.test/crm');
    vi.stubEnv('PLUGIN_MOODLE_EN_PRODUCCION', '1');
    vi.stubEnv('SUSPENSIONES_MOODLE_EN_PRODUCCION', '0');
    const r = await avisar(p, aviso({ email: 'x@test.local' }));
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('EVENTO_NO_ADMITIDO');
    expect(await filas(p)).toHaveLength(0);
  });

  it('suspende con una cuota vencida: identifica la ficha, motivo «cuota vencida», UNA fila y UNA campana aunque llegue dos veces', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Cuota');
    const gestora = await crearUsuario('gestor');
    const email = `pedro.${marca}@test.local`;
    const lead = await crearLead(p, email, gestora);
    const v = await venta(lead, p);
    await query(`INSERT INTO conversion_installments (conversion_id, numero, importe_previsto, fecha_vencimiento)
                 VALUES ($1, 1, 100, CURRENT_DATE - 20), ($1, 2, 100, CURRENT_DATE + 10)`, [v]);

    const a = aviso({ email: email.toUpperCase() });
    const r1 = await avisar(p, a);
    expect(r1.status).toBe(200);
    expect(r1.body.data).toMatchObject({ resultado: 'apuntado', leadId: lead, motivo: 'cuota_vencida' });
    const r2 = await avisar(p, a);
    expect(r2.body.data.resultado).toBe('repetido');

    const f = await filas(p);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ lead_id: lead, ambito: 'cuenta', suspendido: true, via: 'ws', motivo: 'cuota_vencida' });
    expect(f[0].motivo_texto).toMatch(/^Cuota vencida sin pagar desde el \d\d\/\d\d\/\d{4}$/);

    const c = await campanas('moodle_alumno_suspendido', lead);
    expect(c).toHaveLength(1);
    expect(c[0].target_user_ids.map(Number)).toEqual([gestora]);
    expect(c[0].link_path).toBe(`/clients/${lead}`);
    expect(c[0].message).toMatch(/Cuota vencida/);
  });

  it('cobro fallido de Stripe; después, reactivado con «pagó el …»; la ficha y el filtro lo siguen', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Stripe');
    const gestora = await crearUsuario('gestor');
    const email = `ana.${marca}@test.local`;
    const lead = await crearLead(p, email, gestora);
    const v = await venta(lead, p, { total: 49 });
    await query(`INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at)
                 VALUES ($1, $2, 'charge', 'failed', 49, 'eur', $3, NOW() - INTERVAL '2 days')`, [p, `ch_${marca}_f`, email]);

    const s = await avisar(p, aviso({ email, ambito: 'curso', curso: { id: 2, nombre: 'Curso de prueba' }, fecha: ahora() - 60 }));
    expect(s.body.data.motivo).toBe('cobro_fallido');
    let ficha = await suspensionesDelAlumno(lead);
    expect(ficha.suspendido).toBe(true);
    expect(ficha.campus[0]).toMatchObject({ projectId: p, estado: 'suspendido', cuenta: false, cursos: [{ id: 2, nombre: 'Curso de prueba' }] });
    expect(ficha.campus[0].motivoTexto).toMatch(/^Cobro fallido en Stripe el .* \(49,00 EUR\)$/);

    const lista = await findAll({ projectIds: [p], conConversion: true, suspendidoMoodle: true, page: 1, limit: 50 });
    expect(lista.leads.map((l) => Number(l.id))).toEqual([lead]);
    expect(lista.leads[0].suspendido_moodle).toBe(true);

    // Paga y Make le reactiva la matrícula.
    await query(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 49, CURRENT_DATE)`, [v]);
    const r = await avisar(p, aviso({ email, ambito: 'curso', curso: { id: 2, nombre: 'Curso de prueba' }, suspendido: false }));
    expect(r.body.data.motivo).toBe('pago');
    ficha = await suspensionesDelAlumno(lead);
    expect(ficha.suspendido).toBe(false);
    expect(ficha.campus[0].estado).toBe('reactivado');
    expect(ficha.campus[0].motivoTexto).toMatch(/^Pagó el \d\d\/\d\d\/\d{4}$/);
    expect(ficha.historial.map((h) => h.suspendido)).toEqual([false, true]);
    expect(await campanas('moodle_alumno_reactivado', lead)).toHaveLength(1);

    const despues = await findAll({ projectIds: [p], conConversion: true, suspendidoMoodle: true, page: 1, limit: 50 });
    expect(despues.leads).toHaveLength(0);
  });

  it('la ficha con una venta en el campus gana a otra del mismo correo; sin ficha, se apunta igual y avisa a administración', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Ident');
    const otro = await crearCampus('Otro');
    const email = `luis.${marca}@test.local`;
    await crearLead(otro, email); // de otro campus y sin venta aquí: no es
    const conVenta = await crearLead(otro, email);
    await venta(conVenta, p);
    expect((await leadDelAlumno(p, ` ${email.toUpperCase()} `))?.id).toBe(conVenta);

    const admin = await crearUsuario('admin');
    await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [admin, p]);
    const r = await avisar(p, aviso({ email: `nadie.${marca}@test.local` }));
    expect(r.body.data).toMatchObject({ resultado: 'apuntado', leadId: null, motivo: 'sin_motivo' });
    const { rows } = await query(
      `SELECT * FROM admin_notifications WHERE type = 'moodle_alumno_suspendido' AND (metadata->>'project_id')::int = $1`, [p]);
    expect(rows).toHaveLength(1);
    expect(rows[0].target_user_ids.map(Number)).toContain(admin);
    expect(rows[0].message).toMatch(/sin ficha en el CRM/);
  });

  it('la lista sigue igual con los demás filtros (estado, sin «Clientes»)', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Lista');
    const lead = await crearLead(p, `lista.${marca}@test.local`);
    const r = await findAll({ projectId: p, status: 'por_contactar', page: 1, limit: 5 });
    expect(r.leads.map((l) => Number(l.id))).toEqual([lead]);
    expect(r.leads[0]).not.toHaveProperty('suspendido_moodle');
  });

  it('en la ficha, solo los campus de quien mira', async () => {
    if (!hayBase) return;
    const p = await crearCampus('Mio');
    const email = `eva.${marca}@test.local`;
    const lead = await crearLead(p, email);
    await avisar(p, aviso({ email }));
    expect((await suspensionesDelAlumno(lead, { campusPermitidos: [p] })).campus).toHaveLength(1);
    const ajena = await suspensionesDelAlumno(lead, { campusPermitidos: [-1] });
    expect(ajena.campus).toHaveLength(0);
    expect(ajena.historial).toHaveLength(0);
  });
});
