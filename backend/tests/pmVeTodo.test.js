import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «El project manager ve todo» (Diego, 04/11).
 *
 * Trae de serie cada acción de VER, y solo de ver. Su alcance no cambia: ve lo
 * de SUS campus. Aquí, un project manager de un campus de CEDIA:
 *
 *   · abre cada pantalla de solo lectura de su campus (200);
 *   · la de otra empresa le da 403 (el campus en la dirección) o 404 (una ficha
 *     por su id), y las listas no traen nada de ella;
 *   · no puede crear, editar, borrar, enviar ni pagar (403);
 *   · no se lleva secretos: el de Make ni el token de un webhook.
 *
 *   npx vitest run tests/pmVeTodo.test.js
 */

process.env.LOG_LEVEL = 'silent';
const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { SYSTEM_ROLE_DEFAULTS } = await import('../src/modules/permissions/permissions.defaults.js');
const { ACCIONES, POR_CLAVE } = await import('../src/modules/permissions/catalogo.js');
const MODULOS = ['make', 'accounts-payable', 'payroll', 'status', 'registro', 'users', 'webhook-tokens',
  'expenses', 'commissions', 'accounting', 'permissions', 'credentials', 'whatsapp'];
const modulos = await Promise.all(MODULOS.map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `PMV${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], issuers: [], leads: [] };
let PSIKO; let ICT; let PM; let GESTORA_ICT;
const suyo = {}; const ajeno = {};

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, metodo, ruta, body) => request[metodo](ruta).set(como(u)).send(body);

beforeAll(async () => {
  const empresa = async (n) => { const e = await one('INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id', [`${MARCA} ${n}`, `B${n}${Date.now().toString().slice(-6)}`]); ids.issuers.push(e.id); return e.id; };
  const campus = async (n, issuer) => { const p = await one('INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id', [`${MARCA} ${n}`, `${MARCA.toLowerCase()}-${n}`, `${MARCA}-k-${n}`, issuer]); ids.projects.push(p.id); return p.id; };
  PSIKO = await campus('psiko', await empresa('cedia'));
  ICT = await campus('ict', await empresa('ictess'));
  const persona = async (n, role, suyos) => {
    const u = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', $3) RETURNING id, role', [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    for (const c of suyos) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
    return u;
  };
  PM = await persona('pm', 'project_manager', [PSIKO]);
  const gestoraPsiko = await persona('gestora-psiko', 'gestor', [PSIKO]);
  GESTORA_ICT = await persona('gestora-ict', 'gestor', [ICT]);

  // Lo mismo en cada campus: Make (con una entrega), una cuenta por pagar, una
  // nómina, un correo y un cambio en la ficha de un prospecto.
  for (const [c, a, gestora] of [[PSIKO, suyo, gestoraPsiko], [ICT, ajeno, GESTORA_ICT]]) {
    a.make = (await one('INSERT INTO make_webhooks (project_id, slug, label, secret) VALUES ($1, $2, $3, $4) RETURNING id',
      [c, `${MARCA.toLowerCase()}-${c}`, `${MARCA} make ${c}`, `secreto-${MARCA}-${c}`])).id;
    await q('INSERT INTO make_webhook_deliveries (webhook_id, result, payload) VALUES ($1, \'accepted\', $2)', [a.make, { email: `alumno${c}@${MARCA.toLowerCase()}.test` }]);
    a.payable = (await one('INSERT INTO accounts_payable (project_id, proveedor, concepto, importe_total) VALUES ($1, $2, \'x\', 100) RETURNING id', [c, `${MARCA} prov ${c}`])).id;
    a.periodo = (await one('INSERT INTO payroll_periods (project_id, user_id, periodo_year, periodo_month) VALUES ($1, $2, 2026, 11) RETURNING id', [c, gestora.id])).id;
    a.correo = (await one('INSERT INTO email_envios (destinatarios, asunto, project_id, estado) VALUES ($1, $2, $3, \'enviado\') RETURNING id',
      [`cliente${c}@${MARCA.toLowerCase()}.test`, `${MARCA} correo ${c}`, c])).id;
    const l = await one('INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id', [c, `${MARCA} lead ${c}`, `lead${c}@${MARCA.toLowerCase()}.test`]);
    ids.leads.push(l.id);
    await q('INSERT INTO lead_audit_log (lead_id, field_name, old_value, new_value, changed_at) VALUES ($1, \'email\', \'a\', \'b\', NOW())', [l.id]);
  }
  suyo.token = `tok${MARCA}${PSIKO}`;
  await q('INSERT INTO project_webhook_tokens (project_id, kind, token) VALUES ($1, \'leads\', $2)', [PSIKO, suyo.token]);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM make_webhook_deliveries WHERE webhook_id IN (SELECT id FROM make_webhooks WHERE project_id = ANY($1))', [ids.projects]);
  for (const t of ['make_webhooks', 'accounts_payable', 'payroll_periods', 'project_webhook_tokens']) await q(`DELETE FROM ${t} WHERE project_id = ANY($1)`, [ids.projects]);
  await q('DELETE FROM email_envios WHERE asunto LIKE $1', [`${MARCA}%`]);
  await q('DELETE FROM lead_audit_log WHERE lead_id = ANY($1)', [ids.leads]);
  await q('DELETE FROM leads WHERE id = ANY($1)', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1)', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1)', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1)', [ids.projects]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1)', [ids.issuers]);
});

// Lo que Diego dio el 04/11: las de ver que no tenía. Ninguna otra.
const GANADAS = [
  'ventas.view_equipo', 'make.view', 'webhooks.view', 'meta_ads.view', 'woocommerce.view', 'consultas.view',
  'accounting.view', 'accounting.por_cobrar', 'expenses.view', 'accounts_payable.view', 'commissions.view', 'payroll.view',
  'facturas_colaborador.ver_todas', 'integrations.view', 'reports.view', 'reports.dinero', 'reports.puesto_ajeno',
  'matriculas.view', 'diplomas.view', 'diplomas.view_emisiones', 'certifex_consultas.view', 'connectors.view', 'moodle.view',
  'webhooks_salientes.view', 'novedades.envios', 'registro.view', 'status.view', 'leads.spam',
  'credentials.view', 'documents.auditar', 'users.view', 'roles.view', 'whatsapp.banco',
];

describe('el project manager ve todo, de serie (Diego, 04/11)', () => {
  const pm = SYSTEM_ROLE_DEFAULTS.project_manager;

  it('trae cada acción de ver que se le dio', () => {
    expect(GANADAS.filter((k) => pm[k] !== true)).toEqual([]);
  });

  it('y ninguna de crear, editar, borrar, enviar, revelar, pagar ni lo que no es de nadie', () => {
    const PROHIBIDAS = /^(create|edit|delete|delete_cualquiera|restaurar|assign|registrar|metas|upload|sync|pedidos|gestionar|liquidar|ajustes|contrasena|cambiar_correo|cambiar_estado|emit|aprobar|avisar|revocar|imprenta|reglas|pagar|anular|revelar|sistema|conectar|todas|supervisar|enviar|sincronizar|excepciones|empresas|aviso_correo|configurar|configurar_pasos|replanificar|numeracion|personalizar|importar|generar|export|cola|emitir|emitir_borrador|editar_fechas|editar_baremo|reparto|devoluciones|sin_gestora|subir|manage|manage_teams|close|forma_avisos|plantillas_compartidas)$/;
    const ganadasNoDeVer = GANADAS.filter((k) => PROHIBIDAS.test(POR_CLAVE[k].accion));
    expect(ganadasNoDeVer).toEqual([]);
    // Lo que solo tiene el superadmin (NADIE), tampoco.
    const deNadie = ACCIONES.filter((x) => x.roles.length === 0 && pm[x.clave]).map((x) => x.clave);
    expect(deNadie).toEqual([]);
    // Y lo de escribir que ya miraba el servidor sigue cerrado.
    for (const k of ['make.create', 'accounts_payable.edit', 'payroll.edit', 'users.edit', 'users.create', 'roles.edit',
      'credentials.edit', 'commissions.pagar', 'facturas_colaborador.pagar', 'whatsapp.supervisar',
      'webhooks.edit', 'status.edit', 'leads.spam_resolver', 'expenses.create']) {
      expect([k, pm[k]]).toEqual([k, false]);
    }
  });
});

describe('las pantallas de solo lectura, de su campus', () => {
  it('abre cada una (200)', async () => {
    const RUTAS = [
      `/api/make-webhooks?projectId=${PSIKO}`, `/api/make-webhooks/${suyo.make}`, `/api/make-webhooks/${suyo.make}/deliveries`,
      `/api/accounts-payable?projectId=${PSIKO}`, `/api/accounts-payable/${suyo.payable}`,
      `/api/payroll/periods?projectId=${PSIKO}`, `/api/payroll/periods/${suyo.periodo}`,
      `/api/expenses?projectId=${PSIKO}`, `/api/commissions?projectId=${PSIKO}`, `/api/accounting/dashboard?projectId=${PSIKO}`,
      '/api/status/correos', '/api/status/piezas', '/api/registro', '/api/users', '/api/users/availability',
      `/api/users/${PM.id}`, '/api/permissions/roles', '/api/credentials', `/api/webhook-tokens?projectId=${PSIKO}`,
      '/api/whatsapp/banco',
    ];
    const mal = [];
    for (const r of RUTAS) {
      const res = await pedir(PM, 'get', r);
      if (res.status !== 200) mal.push(`${r}: ${res.status} ${res.body?.code || ''}`);
    }
    expect(mal).toEqual([]);
  });

  it('el secreto de Make y el token del webhook no viajan a quien solo los ve', async () => {
    const make = await pedir(PM, 'get', `/api/make-webhooks/${suyo.make}`);
    expect(make.body.data.id).toBe(suyo.make);
    expect(make.body.data.secret).toBeUndefined();
    const tokens = await pedir(PM, 'get', `/api/webhook-tokens?projectId=${PSIKO}`);
    expect(tokens.body.data.length).toBe(1);
    expect(tokens.body.data[0].token).not.toBe(suyo.token);
    expect(tokens.body.data[0].token_oculto).toBe(true);
  });
});

describe('lo de otra empresa, no', () => {
  it('el campus ajeno en la dirección: 403', async () => {
    const mal = [];
    for (const r of [`/api/make-webhooks?projectId=${ICT}`, `/api/accounts-payable?projectId=${ICT}`, `/api/payroll/periods?projectId=${ICT}`,
      `/api/expenses?projectId=${ICT}`, `/api/commissions?projectId=${ICT}`, `/api/accounting/dashboard?projectId=${ICT}`,
      `/api/webhook-tokens?projectId=${ICT}`]) {
      const res = await pedir(PM, 'get', r);
      if (res.status !== 403) mal.push(`${r}: ${res.status}`);
    }
    expect(mal).toEqual([]);
  });

  it('una ficha ajena por su id: 404, como si no existiera', async () => {
    const mal = [];
    for (const r of [`/api/make-webhooks/${ajeno.make}`, `/api/make-webhooks/${ajeno.make}/deliveries`,
      `/api/accounts-payable/${ajeno.payable}`, `/api/payroll/periods/${ajeno.periodo}`,
      `/api/users/${GESTORA_ICT.id}`, `/api/users/${GESTORA_ICT.id}/availability-blocks`]) {
      const res = await pedir(PM, 'get', r);
      if (res.status !== 404) mal.push(`${r}: ${res.status}`);
    }
    expect(mal).toEqual([]);
  });

  it('las listas sin campus no traen nada de la otra empresa', async () => {
    const texto = async (r) => JSON.stringify((await pedir(PM, 'get', r)).body);
    const status = await texto('/api/status/correos?limit=200');
    expect(status).toContain(`${MARCA} correo ${PSIKO}`);
    expect(status).not.toContain(`${MARCA} correo ${ICT}`);
    const registro = await texto('/api/registro?limite=500');
    expect(registro).toContain(`${MARCA} lead ${PSIKO}`);
    expect(registro).not.toContain(`${MARCA} lead ${ICT}`);
    const usuarios = await texto('/api/users?limit=100');
    expect(usuarios).toContain(`${MARCA} gestora-psiko`);
    expect(usuarios).not.toContain(`${MARCA} gestora-ict`);
    const disponibilidad = await texto('/api/users/availability');
    expect(disponibilidad).not.toContain(`${MARCA} gestora-ict`);
  });

  it('el super admin sigue viéndolo todo', async () => {
    const su = await one('INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, \'x\', \'superadmin\') RETURNING id, role', [`${MARCA} super`, `super@${MARCA.toLowerCase()}.test`]);
    ids.users.push(su.id);
    expect((await pedir(su, 'get', `/api/make-webhooks/${ajeno.make}`)).body.data.secret).toBe(`secreto-${MARCA}-${ICT}`);
    expect(JSON.stringify((await pedir(su, 'get', '/api/status/correos?limit=200')).body)).toContain(`${MARCA} correo ${ICT}`);
    expect(JSON.stringify((await pedir(su, 'get', '/api/registro?limite=500')).body)).toContain(`${MARCA} lead ${ICT}`);
  });
});

describe('ver no es tocar', () => {
  it('crear, editar, borrar o pagar: 403', async () => {
    const mal = [];
    for (const [m, r, body] of [
      ['post', '/api/make-webhooks', { project_id: PSIKO, label: 'x' }],
      ['patch', `/api/make-webhooks/${suyo.make}`, { label: 'x' }],
      ['post', `/api/make-webhooks/${suyo.make}/rotate-secret`],
      ['post', '/api/accounts-payable', { project_id: PSIKO, proveedor: 'x', concepto: 'x', importe_total: 1 }],
      ['delete', `/api/accounts-payable/${suyo.payable}`],
      ['post', `/api/accounts-payable/${suyo.payable}/payments`, { importe: 1 }],
      ['put', '/api/payroll/plans', { project_id: PSIKO }],
      ['post', '/api/status/incidents', { titulo: 'x' }],
      ['patch', `/api/users/${GESTORA_ICT.id}`, { nombre: 'x' }],
      ['post', '/api/users', { nombre: 'x', email: `x@${MARCA.toLowerCase()}.test`, role: 'gestor' }],
      ['post', '/api/webhook-tokens', { project_id: PSIKO, kind: 'leads' }],
    ]) {
      const res = await pedir(PM, m, r, body);
      if (res.status !== 403) mal.push(`${m.toUpperCase()} ${r}: ${res.status}`);
    }
    expect(mal).toEqual([]);
  });
});
