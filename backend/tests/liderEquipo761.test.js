import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * El rol «Líder de equipo» (CRM-ISEIE#761 / CRM#1105, Diego 24/11/2026). La misma
 * prueba que en el 360, con el esquema de ISEIE.
 *
 * «Raquel en ISEIE no es admin como tal: maneja un equipo de personas y ve eso
 * y lo suyo, como si fuera líder de equipo con cosas de gestora.»
 *
 *   · Todo lo de una gestora: lo suyo.
 *   · Más lo de su equipo (`equipo_comercial`): prospectos, ventas, el ranking,
 *     reasignar dentro de él y verlo en los desplegables.
 *   · Nada de fuera de su equipo (403 o filtrado), aunque comparta campus.
 *   · Ninguna pantalla de administración.
 *   · Sin nadie a su cargo, lo de equipo se queda en ella sola.
 *
 * Contra la base LOCAL (docker-compose.dev.yml), con las rutas de verdad.
 *
 *   npx vitest run tests/liderEquipo761.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { alcanceComercial, alcanceDeLider, soloLoSuyo, esRolDeGestora, ROLES_DE_GESTORA } = await import('../src/shared/utils/roles.js');
const { gestoresDelReparto } = await import('../src/modules/leads/reparto.js');
const { explicarPermisos, olvidarPermisos } = await import('../src/modules/permissions/permissions.service.js');
const cat = await import('../src/modules/permissions/catalogo.js');
const { SYSTEM_ROLE_DEFAULTS } = await import('../src/modules/permissions/permissions.defaults.js');
const { createUserSchema } = await import('../src/modules/users/user.validation.js');
const modulos = await Promise.all(['users', 'leads', 'conversions', 'sales', 'reports', 'permissions', 'integrations', 'accounting', 'informe-mensual']
  .map((m) => import(`../src/modules/${m}/index.js`).then((x) => x.default)));

const app = express();
app.use(express.json());
for (const m of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `LID${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const one = async (sql, p) => (await q(sql, p))[0];
const ids = { users: [], projects: [], leads: [], ventas: [] };

let A; let LIDER; let SOLA; let G1; let G2; let FUERA; let ADMIN;
let L_LIDER; let L1; let L2; let L_FUERA; let L_SIN; let L_SOLA; let V1; let V_FUERA;

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });
const pedir = (u, ruta) => request.get(ruta).set(como(u));
const idsDe = (res) => (res.body.data || []).map((x) => Number(x.id));

// Lo que NUNCA trae de serie: administración (usuarios, roles, configuración,
// integraciones, finanzas de la empresa, facturación de la serie, MCP…).
const DE_ADMINISTRACION = [
  'users.view', 'users.create', 'users.edit', 'users.delete', 'users.excepciones', 'users.contrasena', 'users.empresas',
  'equipos.gestionar', 'roles.view', 'roles.edit',
  'projects.create', 'projects.edit', 'installation.edit', 'channels.edit', 'field_defs.edit',
  'integrations.view', 'integrations.edit', 'integrations.salud', 'credentials.view', 'credentials.edit',
  'mcp.usar', 'mcp.administrar', 'connectors.view', 'webhooks.view', 'webhooks_salientes.view', 'make.view', 'moodle.view',
  'accounting.view', 'expenses.view', 'accounts_payable.view', 'commissions.view', 'payroll.view', 'cobros_externos.view',
  'facturas.configurar', 'facturas.emitir', 'facturas.cola', 'facturas.auditoria', 'facturas_colaborador.ver_todas',
  'links_pago.ver_todos', 'links_pago.configurar', 'stripe.edit', 'conversions.sin_gestora',
  'reports.dinero', 'reports.editar_baremo', 'commissions.edit', 'commissions.pagar',
  'registro.view', 'status.view', 'tasks.view_all', 'monitask.view',
  'leads.delete', 'leads.duplicados', 'proceso.configurar_pasos', 'products.create', 'products.edit',
];

beforeAll(async () => {
  A = (await one('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
    [`${MARCA} a`, `${MARCA.toLowerCase()}-a`, `${MARCA}-k-a`])).id;
  ids.projects.push(A);

  const persona = async (n, role) => {
    const u = await one(`INSERT INTO users (nombre, email, password_hash, role, is_available) VALUES ($1, $2, 'x', $3, true) RETURNING id, role`,
      [`${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, role]);
    ids.users.push(u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, A]);
    return u;
  };
  LIDER = await persona('raquel', 'lider_equipo');   // lleva a G1 y G2
  SOLA = await persona('sola', 'lider_equipo');      // líder sin nadie a su cargo
  G1 = await persona('g1', 'gestor');
  G2 = await persona('g2', 'gestor');
  FUERA = await persona('fuera', 'gestor');          // mismo campus, otro equipo
  ADMIN = await persona('admin', 'admin');
  await q('INSERT INTO equipo_comercial (lider_id, gestora_id) VALUES ($1, $2), ($1, $3)', [LIDER.id, G1.id, G2.id]);

  const lead = async (n, responsable) => {
    const l = await one(`INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      [A, `${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, responsable]);
    ids.leads.push(l.id); return l.id;
  };
  L_LIDER = await lead('llider', LIDER.id);
  L1 = await lead('l1', G1.id);
  L2 = await lead('l2', G2.id);
  L_FUERA = await lead('lfuera', FUERA.id);
  L_SIN = await lead('lsin', null);
  L_SOLA = await lead('lsola', SOLA.id);

  const venta = async (leadId, vendedora) => {
    const v = await one(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion, vendedora_id)
                         VALUES ($1, $2, 'Curso', 100, 0, CURRENT_DATE, $3) RETURNING id`, [leadId, A, vendedora]);
    ids.ventas.push(v.id);
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE)', [v.id]);
    return v.id;
  };
  V1 = await venta(L1, G1.id);
  V_FUERA = await venta(L_FUERA, FUERA.id);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[]) OR gestora_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids.users]).catch(() => {});
  await q('DELETE FROM invoices WHERE conversion_id = ANY($1::int[])', [ids.ventas]).catch(() => {});
  await q('DELETE FROM conversion_vendedoras WHERE conversion_id = ANY($1::int[])', [ids.ventas]).catch(() => {});
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.ventas]);
  await q('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM lead_assignments_log WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM notifications WHERE target_user_ids && $1::int[]', [ids.users]).catch(() => {});
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('el rol en el catálogo', () => {
  it('sale en Roles con su nombre y su frase, y se da desde Usuarios', () => {
    const r = cat.ROLES_FIJOS.find((x) => x.clave === 'lider_equipo');
    expect(r).toMatchObject({ nombre: 'Líder de equipo' });
    expect(r.descripcion.length).toBeGreaterThan(20);
    const alta = createUserSchema.safeParse({ nombre: 'Raquel', email: 'r@x.test', role: 'lider_equipo', projectIds: [1] });
    expect(alta.success).toBe(true);
    // Como una gestora: sin campus no ve nada.
    expect(createUserSchema.safeParse({ nombre: 'Raquel', email: 'r@x.test', role: 'lider_equipo' }).success).toBe(false);
  });

  it('trae de serie todo lo de una gestora y lo de equipo', () => {
    const lider = SYSTEM_ROLE_DEFAULTS.lider_equipo;
    const deGestora = Object.entries(SYSTEM_ROLE_DEFAULTS.gestor).filter(([, v]) => v).map(([k]) => k);
    expect(deGestora.filter((k) => lider[k] !== true)).toEqual([]);
    for (const k of ['reports.puesto_ajeno', 'reports.view', 'ventas.view_equipo', 'leads.assign', 'whatsapp.supervisar', 'equipos.su_equipo',
      'conversions.reparto', 'reports.informe_mensual']) {
      expect(lider[k], k).toBe(true);
    }
    expect(cat.dependenciasRotas(lider)).toEqual([]);
  });

  it('ninguno de administración', () => {
    const lider = SYSTEM_ROLE_DEFAULTS.lider_equipo;
    expect(DE_ADMINISTRACION.filter((k) => !cat.CLAVES.has(k))).toEqual([]);
    expect(DE_ADMINISTRACION.filter((k) => lider[k] === true)).toEqual([]);
  });

  it('la base resuelve lo mismo para una persona con ese rol', async () => {
    olvidarPermisos?.(LIDER.id);
    const { mapa } = await explicarPermisos(LIDER.id);
    expect(mapa['reports.puesto_ajeno']).toBe(true);
    expect(mapa['leads.view']).toBe(true);
    expect(DE_ADMINISTRACION.filter((k) => mapa[k] === true)).toEqual([]);
  });

  it('trabaja como una gestora: su alcance, su WhatsApp y sus correos', async () => {
    expect(ROLES_DE_GESTORA).toEqual(['gestor', 'lider_equipo']);
    expect(esRolDeGestora('lider_equipo')).toBe(true);
    expect(esRolDeGestora('admin')).toBe(false);
    expect(soloLoSuyo({ role: 'lider_equipo' })).toBe(true);
    const { ROLES_CON_WHATSAPP } = await import('../src/modules/whatsapp/roles.js');
    expect(ROLES_CON_WHATSAPP).toContain('lider_equipo');
  });
});

describe('el alcance: ella y su equipo', () => {
  it('con equipo: ella primero y sus gestoras; sin equipo: ella sola, también como líder', async () => {
    expect((await alcanceComercial({ userId: LIDER.id, role: 'lider_equipo' })).sort()).toEqual([LIDER.id, G1.id, G2.id].sort());
    expect(await alcanceComercial({ userId: SOLA.id, role: 'lider_equipo' })).toEqual([SOLA.id]);
    expect(await alcanceDeLider({ userId: SOLA.id, role: 'lider_equipo' })).toEqual([SOLA.id]);
    // Una gestora sola no es líder: lo de antes no cambia.
    expect(await alcanceDeLider({ userId: G1.id, role: 'gestor' })).toBeNull();
  });

  it('prospectos: los suyos y los de su equipo; ni los de otra gestora ni los sin asignar', async () => {
    const r = await pedir(LIDER, `/api/leads?projectId=${A}&includeConverted=true&limit=100`);
    expect(r.status).toBe(200);
    expect(idsDe(r)).toEqual(expect.arrayContaining([L_LIDER, L1, L2]));
    expect(idsDe(r)).not.toContain(L_FUERA);
    expect(idsDe(r)).not.toContain(L_SIN);
    // Pedir los de una de fuera no ensancha nada.
    const r2 = await pedir(LIDER, `/api/leads?projectId=${A}&includeConverted=true&responsableId=${FUERA.id}&limit=100`);
    expect(idsDe(r2)).not.toContain(L_FUERA);
    expect((await pedir(LIDER, `/api/leads/${L_FUERA}`)).status).toBe(403);
    expect((await pedir(LIDER, `/api/leads/${L1}`)).status).toBe(200);
  });

  it('la líder sin equipo, solo lo suyo', async () => {
    const r = await pedir(SOLA, `/api/leads?projectId=${A}&includeConverted=true&limit=100`);
    expect(idsDe(r)).toEqual([L_SOLA]);
  });

  it('ventas: las de su equipo, no las de fuera', async () => {
    // Ventas por cliente (la pantalla de Ventas): un cliente por prospecto con venta.
    const r = await pedir(LIDER, `/api/ventas/por-cliente?projectId=${A}&limit=100`);
    expect(r.status).toBe(200);
    const deQuien = (r.body.data || []).map((c) => Number(c.lead_id));
    expect(deQuien).toContain(L1);
    expect(deQuien).not.toContain(L_FUERA);
    const tabla = await pedir(LIDER, `/api/ventas/gestores-stats?projectId=${A}&periodo=all`);
    expect(tabla.status).toBe(200);
    const enTabla = tabla.body.data.gestores.map((g) => Number(g.user_id));
    expect(enTabla).not.toContain(FUERA.id);
    expect(enTabla.every((id) => [LIDER.id, G1.id, G2.id].includes(id))).toBe(true);
  });

  it('«Cómo voy»: la tabla de su equipo y su puesto en él; la de una de fuera, 403', async () => {
    const r = await pedir(LIDER, `/api/informes/mi-puesto?projectId=${A}`);
    expect(r.status).toBe(200);
    expect(r.body.data.lider).toBe(true);
    const enTabla = r.body.data.tabla.map((f) => Number(f.user_id));
    expect(enTabla).toContain(G1.id);
    expect(enTabla).not.toContain(FUERA.id);
    expect(r.body.data.de).toBe(enTabla.length);
    expect(r.body.data.total).toBeNull();
    expect((await pedir(LIDER, `/api/informes/mi-puesto?projectId=${A}&gestoraId=${G1.id}`)).status).toBe(200);
    expect((await pedir(LIDER, `/api/informes/mi-puesto?projectId=${A}&gestoraId=${FUERA.id}`)).status).toBe(403);
    // Sin equipo, ni la de otra.
    expect((await pedir(SOLA, `/api/informes/mi-puesto?projectId=${A}&gestoraId=${G1.id}`)).status).toBe(403);
    // Una gestora no recibe la tabla.
    expect((await pedir(G1, `/api/informes/mi-puesto?projectId=${A}`)).body.data.tabla).toBeNull();
  });

  it('reasignar: dentro de su equipo sí; fuera, 403; repartir los sin gestora del campus, 403', async () => {
    const dentro = await request.patch(`/api/leads/${L1}/reassign`).set(como(LIDER)).send({ responsable_id: G2.id });
    expect(dentro.status).toBe(200);
    const aFuera = await request.patch(`/api/leads/${L2}/reassign`).set(como(LIDER)).send({ responsable_id: FUERA.id });
    expect(aFuera.status).toBe(403);
    const deFuera = await request.patch(`/api/leads/${L_FUERA}/reassign`).set(como(LIDER)).send({ responsable_id: G1.id });
    expect(deFuera.status).toBe(403);
    const sola = await request.patch(`/api/leads/${L_SOLA}/reassign`).set(como(SOLA)).send({ responsable_id: G1.id });
    expect(sola.status).toBe(403);
    const reparto = await request.post(`/api/leads/reassign-pending?projectId=${A}`).set(como(LIDER));
    expect(reparto.status).toBe(403);
    expect((await one('SELECT responsable_id FROM leads WHERE id = $1', [L_SIN])).responsable_id).toBeNull();
  });

  it('su equipo en los desplegables, sin la lista de Usuarios', async () => {
    const equipo = [LIDER.id, G1.id, G2.id];
    const r = await pedir(LIDER, `/api/users?limit=100&alcance=comercial&projectId=${A}`);
    expect(r.status).toBe(200);
    expect(idsDe(r).sort()).toEqual(equipo.sort());
    // Aunque no pida el alcance: solo su equipo, nunca el campus entero.
    const todos = await pedir(LIDER, `/api/users?limit=100&projectId=${A}`);
    expect(idsDe(todos)).not.toContain(FUERA.id);
    expect(idsDe(todos)).not.toContain(ADMIN.id);
    expect(idsDe(await pedir(SOLA, `/api/users?limit=100&alcance=comercial`))).toEqual([SOLA.id]);
    // Una gestora sigue sin la lista.
    expect((await pedir(G1, '/api/users?limit=100&alcance=comercial')).status).toBe(403);
    // El admin, como siempre: su campus entero.
    expect(idsDe(await pedir(ADMIN, `/api/users?limit=100&projectId=${A}`))).toContain(FUERA.id);
  });
});

describe('lo que Diego añadió el 24/11: repartir una venta y el informe mensual, de su equipo', () => {
  const repartir = (u, venta, partes) => request.put(`/api/conversions/${venta}/reparto`).set(como(u)).send({ partes });
  const mitad = (a, b) => [{ user_id: a.id, porcentaje: 50 }, { user_id: b.id, porcentaje: 50 }];

  it('reparte una venta de su equipo entre ella y su equipo; con alguien de fuera, 403', async () => {
    const r = await repartir(LIDER, V1, mitad(G1, G2));
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const conFuera = await repartir(LIDER, V1, mitad(G1, FUERA));
    expect(conFuera.status).toBe(403);
    expect(conFuera.body.code).toBe('FUERA_DE_TU_EQUIPO');
    // La venta de otra, ni tocarla.
    expect((await repartir(LIDER, V_FUERA, mitad(G1, G2))).status).toBe(403);
    // Una gestora no reparte.
    expect((await repartir(G1, V1, mitad(G1, G2))).status).toBe(403);
    // Las candidatas que le enseña la pantalla: ella y su equipo.
    const g = await pedir(LIDER, `/api/conversions/${V1}/reparto`);
    expect(g.status).toBe(200);
    const candidatas = g.body.data.candidatas.map((c) => Number(c.id));
    expect(candidatas).not.toContain(FUERA.id);
    expect(candidatas.every((id) => [LIDER.id, G1.id, G2.id].includes(id))).toBe(true);
  });

  it('deshace su reparto; uno con alguien de fuera (lo hizo administración), no', async () => {
    expect((await request.delete(`/api/conversions/${V1}/reparto`).set(como(LIDER))).status).toBe(200);
    await q(`INSERT INTO conversion_vendedoras (conversion_id, user_id, porcentaje, repartida_por_user_id)
             VALUES ($1, $2, 50, $4), ($1, $3, 50, $4)`, [V1, G1.id, FUERA.id, ADMIN.id]);
    const r = await request.delete(`/api/conversions/${V1}/reparto`).set(como(LIDER));
    expect(r.status).toBe(403);
    expect((await q('SELECT 1 FROM conversion_vendedoras WHERE conversion_id = $1', [V1])).length).toBe(2);
    await q('DELETE FROM conversion_vendedoras WHERE conversion_id = $1', [V1]);
  });

  it('el informe mensual: el de su equipo, sin las de fuera; el ZIP de la empresa, 403', async () => {
    const mes = new Date().toISOString().slice(0, 7);
    const r = await pedir(LIDER, `/api/informe-mensual?periodo=${mes}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const quienes = r.body.data.comerciales.map((c) => Number(c.id));
    expect(quienes).toContain(G1.id);
    expect(quienes).not.toContain(FUERA.id);
    // La admin sin equipo ve a todas.
    const admin = await pedir(ADMIN, `/api/informe-mensual?periodo=${mes}`);
    expect(admin.body.data.comerciales.map((c) => Number(c.id))).toContain(FUERA.id);
    expect((await pedir(LIDER, `/api/informe-mensual/zip?periodo=${mes}&issuerId=1`)).status).toBe(403);
    // Una gestora no lo ve.
    expect((await pedir(G1, `/api/informe-mensual?periodo=${mes}`)).status).toBe(403);
  });
});

describe('nada de administración', () => {
  it('Usuarios, Roles, Integraciones y Finanzas de la empresa: 403', async () => {
    const rutas = [
      `/api/users/${G1.id}`,
      '/api/users/roles-asignables',
      '/api/users/availability',
      `/api/users/${LIDER.id}/equipo-comercial`,
      '/api/permissions/roles',
      '/api/permissions/custom-roles',
      `/api/integrations?projectId=${A}`,
      `/api/accounting/dashboard?projectId=${A}`,
    ];
    for (const ruta of rutas) expect((await pedir(LIDER, ruta)).status, ruta).toBe(403);
    const alta = await request.post('/api/users').set(como(LIDER)).send({ nombre: 'Otra', email: `otra@${MARCA.toLowerCase()}.test`, role: 'gestor', projectIds: [A] });
    expect(alta.status).toBe(403);
    const suEquipo = await request.put(`/api/users/${LIDER.id}/equipo-comercial`).set(como(LIDER)).send({ gestoraIds: [FUERA.id] });
    expect(suEquipo.status).toBe(403);
  });
});

describe('el reparto: se decide por persona, como a un admin', () => {
  it('sin «recibe leads» en el campus no entra; con él, sí', async () => {
    const quienes = async () => (await gestoresDelReparto((s, p) => pool.query(s, p), A)).map((g) => Number(g.id));
    expect(await quienes()).not.toContain(LIDER.id);
    await q('UPDATE user_projects SET recibe_leads = TRUE WHERE user_id = $1 AND project_id = $2', [LIDER.id, A]);
    expect(await quienes()).toContain(LIDER.id);
    await q('UPDATE users SET is_available = FALSE WHERE id = $1', [LIDER.id]);
    expect(await quienes()).not.toContain(LIDER.id);
  });
});
