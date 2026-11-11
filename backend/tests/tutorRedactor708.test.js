import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import { query } from '../src/shared/config/db.js';
import { verifyToken } from '../src/shared/middleware/auth.js';
import { errorHandler } from '../src/shared/middleware/errorHandler.js';
import { rutaDeRolCerrado } from '../src/shared/utils/roles.js';
import { ROLES_FIJOS, ACCIONES } from '../src/modules/permissions/catalogo.js';
import { SYSTEM_ROLE_DEFAULTS } from '../src/modules/permissions/permissions.defaults.js';
import { resolverPermisos } from '../src/modules/permissions/resolver.js';
import { esUsuarioColaborador } from '../src/modules/facturas-colaborador/facturas-colaborador.model.js';
import leads from '../src/modules/leads/index.js';
import conversions from '../src/modules/conversions/index.js';
import accounting from '../src/modules/accounting/index.js';
import invoices from '../src/modules/invoices/index.js';
import tasks from '../src/modules/tasks/index.js';
import consultas from '../src/modules/consultas/index.js';
import tutores from '../src/modules/tutores/index.js';
import facturasColaborador from '../src/modules/facturas-colaborador/index.js';

/**
 * CRM#708 · El rol «Tutor redactor»: hace los cursos y responde en Moodle.
 *
 * Lo que pide la issue:
 *   · existe y se puede dar (está en el catálogo, en Roles y en la ficha);
 *   · entra y ve su tablero, su factura del mes y Consultas/Mis cursos;
 *   · prospectos, ventas y finanzas: 403, y lo niega el SERVIDOR;
 *   · puede tener ficha de colaborador para subir su factura.
 */

const LO_SUYO = [
  'tasks.view_own', 'tasks.create', 'tasks.edit',
  'facturas_colaborador.subir',
  'tutores.mis_cursos', 'consultas.atender',
];

describe('#708 · el rol en el catálogo', () => {
  it('es un rol fijo, con nombre y una frase (sale en Roles y en la ficha)', () => {
    const r = ROLES_FIJOS.find((x) => x.clave === 'tutor_redactor');
    expect(r).toBeTruthy();
    expect(r.nombre).toBe('Tutor redactor');
    expect(r.descripcion).toMatch(/Moodle/);
  });

  it('de serie trae su tablero, su factura, sus consultas y sus cursos, y nada más', () => {
    const suyas = Object.entries(SYSTEM_ROLE_DEFAULTS.tutor_redactor).filter(([, v]) => v).map(([k]) => k).sort();
    expect(suyas).toEqual([...LO_SUYO].sort());
  });

  it('nada de prospectos, ventas ni finanzas, ni WhatsApp ni MCP aunque se le dé', () => {
    const { mapa } = resolverPermisos({ role: 'tutor_redactor', excepciones: { 'whatsapp.usar': true, 'mcp.usar': true } });
    expect(mapa['whatsapp.usar']).toBe(false);
    expect(mapa['mcp.usar']).toBe(false);
    const prohibidas = ACCIONES.filter((x) => /^(leads|ventas|conversions|facturas|accounting|expenses|commissions|payroll|stripe)\./.test(x.clave));
    expect(prohibidas.filter((x) => mapa[x.clave]).map((x) => x.clave)).toEqual([]);
  });
});

describe('#708 · el corte del servidor (verifyToken)', () => {
  const redactor = { userId: 1, role: 'tutor_redactor', roles_extra: [] };
  const pasa = async (user, url) => {
    let error = null;
    const req = { headers: { authorization: `Bearer ${jwt.sign(user, process.env.JWT_SECRET)}` }, originalUrl: url };
    await verifyToken(req, {}, (e) => { error = e || null; });
    return error ? error.statusCode : 'ok';
  };

  it('prospectos, ventas, facturas y finanzas: 403, aunque la ruta solo pida token', async () => {
    for (const url of ['/api/leads', '/api/conversions?projectId=1', '/api/sales/resumen', '/api/ventas/resumen',
      '/api/invoices', '/api/accounting/income', '/api/products', '/api/whatsapp/sin-leer',
      '/api/facturas-colaborador/colaboradores', '/api/facturas-colaborador/facturas', '/api/users']) {
      expect(await pasa(redactor, url), url).toBe(403);
    }
  });

  it('lo suyo sí: su tablero, su factura, sus consultas y sus cursos', async () => {
    for (const url of ['/api/auth/me', '/api/tasks', '/api/tasks/historial', '/api/facturas-colaborador/mias',
      '/api/consultas/mias', '/api/tutores/colaboraciones', '/api/notifications', '/api/users/mis-avisos',
      '/api/permissions/system-defaults']) {
      expect(await pasa(redactor, url), url).toBe('ok');
    }
  });

  it('quien además tiene otro rol sin lista cerrada no se recorta; el tutor y el colaborador, igual que antes', () => {
    expect(rutaDeRolCerrado({ role: 'gestor', roles_extra: ['tutor_redactor'] }, '/api/leads')).toBeNull();
    expect(rutaDeRolCerrado({ role: 'tutor', roles_extra: [] }, '/api/facturas-colaborador/mias')).toBe(false);
    expect(rutaDeRolCerrado({ role: 'colaborador', roles_extra: [] }, '/api/consultas/mias')).toBe(false);
  });
});

// ─── Contra la base: un redactor de verdad ──────────────────────────────────
const marca = `t708${Date.now()}`;
const ids = { users: [] };
let hayBase = true;
let porQueNo = null;
let redactorId = null;

beforeAll(async () => {
  try {
    const { rows } = await query(
      `INSERT INTO users (nombre, email, password_hash, role, active)
       VALUES ($1, $2, 'x', 'tutor_redactor', true) RETURNING id`,
      [`Redactor ${marca}`, `redactor.${marca}@test.local`]);
    redactorId = Number(rows[0].id);
    ids.users.push(redactorId);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const sql of ['DELETE FROM activity_log WHERE user_id = ANY($1::int[])', 'DELETE FROM users WHERE id = ANY($1::int[])']) {
    try { await query(sql, [ids.users]); } catch { /* sigue limpiando */ }
  }
});

describe('#708 · un redactor de verdad (API)', () => {
  const app = express();
  app.use(express.json());
  for (const m of [leads, conversions, accounting, invoices, tasks, consultas, tutores, facturasColaborador]) app.use(m.prefix, m.router);
  app.use(errorHandler);
  const get = (u) => supertest(app).get(u).set('Authorization', `Bearer ${jwt.sign({ userId: redactorId, role: 'tutor_redactor', roles_extra: [] }, process.env.JWT_SECRET)}`);

  it('hay base (el ENUM user_role admite «tutor_redactor»: migración 277)', () => {
    expect(hayBase, porQueNo || '').toBe(true);
  });

  it('entra a su tablero, a su factura, a sus consultas y a sus cursos', async () => {
    if (!hayBase) return;
    for (const url of ['/api/tasks', '/api/facturas-colaborador/mias', '/api/consultas/mias', '/api/tutores/colaboraciones']) {
      const r = await get(url);
      expect(r.status, `${url}: ${JSON.stringify(r.body)}`).toBe(200);
    }
  });

  it('prospectos, ventas y finanzas: 403', async () => {
    if (!hayBase) return;
    for (const url of ['/api/leads', '/api/conversions', '/api/accounting/income', '/api/invoices', '/api/consultas']) {
      const r = await get(url);
      expect(r.status, url).toBe(403);
    }
  });

  it('puede tener ficha de colaborador para su factura del mes', async () => {
    if (!hayBase) return;
    expect(await esUsuarioColaborador(redactorId)).toBe(true);
  });
});
