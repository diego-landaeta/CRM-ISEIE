import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Equipo comercial de una administradora (Carlos, 09/11/2026; migración 274).
 *
 * «Raquel pasa a ser administradora como Daniela: no recibe leads y puede ver
 * los leads y la gestión de las diferentes compañeras. Daniela puede ver todas.
 * Raquel podrá ver sus comerciales asignadas (pueden variar).»
 *
 * Contra la base LOCAL (docker-compose.dev.yml):
 *   npx vitest run tests/equipoComercial.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const modulos = await Promise.all([
  import('../src/modules/leads/index.js'),
  import('../src/modules/conversions/index.js'),
  import('../src/modules/users/index.js'),
  import('../src/modules/sales/index.js'),
]);
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { construirAmbito, alcanceDelMcp } = await import('../src/modules/mcp/mcp.acceso.js');
const { HERRAMIENTAS } = await import('../src/modules/mcp/mcp.tools.js');
const { alcanceComercial } = await import('../src/shared/utils/roles.js');

const app = express();
app.use(express.json());
for (const { default: m } of modulos) app.use(m.prefix, m.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `EQC${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], leads: [], conversions: [] };
let P; let OTRO;
let SUPER; let RAQUEL; let DANIELA; let G1; let G2; let G3; let GOTRO;
const L = {}; const V = {};

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, c]);
  return u;
}

async function prospecto(clave, responsable, conVenta = false) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, email, telefono, responsable_id)
     VALUES ($1, $2, $3, '+34600111222', $4) RETURNING id`,
    [P, `${MARCA} ${clave}`, `${clave.toLowerCase()}@lead.${MARCA.toLowerCase()}.test`, responsable.id]);
  L[clave] = l.id; ids.leads.push(l.id);
  if (conVenta) {
    const [v] = await q(
      `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, fecha_conversion)
       VALUES ($1, $2, 'Curso', 500, 0, CURRENT_DATE) RETURNING id`, [l.id, P]);
    V[clave] = v.id; ids.conversions.push(v.id);
    await q('INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 100, CURRENT_DATE)', [v.id]);
  }
}

const idsDe = (res) => (res.body.data || []).map((r) => Number(r.id));
const leadsDe = async (u) => {
  const r = await request.get(`/api/leads?projectId=${P}&includeConverted=true&limit=100`).set(como(u));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return idsDe(r).filter((id) => ids.leads.includes(id));
};
// La lista de Ventas por cliente (la de la pantalla de Ventas): un cliente por
// prospecto con venta. Se devuelve la VENTA de cada uno para comparar.
// (`GET /api/conversions` no se usa aquí: en una base nueva da 500 porque la
// columna `conversions.factura_no_requerida` no tiene migración en este repo.)
const ventasDe = async (u) => {
  const r = await request.get(`/api/ventas/por-cliente?projectId=${P}&limit=100`).set(como(u));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  const ventaDe = Object.fromEntries(Object.entries(V).map(([k, v]) => [L[k], v]));
  return (r.body.data || []).map((c) => ventaDe[Number(c.lead_id)]).filter(Boolean);
};
const ponerEquipo = (quien, lider, gestoraIds) =>
  request.put(`/api/users/${lider.id}/equipo-comercial`).set(como(quien)).send({ gestoraIds });

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id',
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  RAQUEL = await persona('RAQUEL', 'admin', [P]);
  DANIELA = await persona('DANIELA', 'admin', [P]);
  G1 = await persona('GUNO', 'gestor', [P]);
  G2 = await persona('GDOS', 'gestor', [P]);
  G3 = await persona('GTRES', 'gestor', [P]);
  GOTRO = await persona('GOTRO', 'gestor', [OTRO]);
  await prospecto('L1', G1, true);
  await prospecto('L2', G2);
  await prospecto('L3', G3, true);
}, 60000);

afterAll(async () => {
  await q('DELETE FROM equipo_comercial WHERE lider_id = ANY($1::int[]) OR gestora_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM permisos_registro WHERE usuario_id = ANY($1::int[]) OR quien_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM lead_status_history WHERE lead_id = ANY($1::int[])', [ids.leads]).catch(() => {});
  await q('DELETE FROM invoices WHERE conversion_id = ANY($1::int[])', [ids.conversions]).catch(() => {});
  await q('DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM conversions WHERE id = ANY($1::int[])', [ids.conversions]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
}, 60000);

describe('quién decide el equipo (PUT /api/users/:id/equipo-comercial)', () => {
  it('sin el permiso equipos.gestionar, 403 (una admin no se lo pone a otra)', async () => {
    const r = await ponerEquipo(DANIELA, RAQUEL, [G1.id]);
    expect(r.status).toBe(403);
    expect(await q('SELECT 1 FROM equipo_comercial WHERE lider_id = $1', [RAQUEL.id])).toHaveLength(0);
  });

  it('una gestora de otro campus, 400 y no se guarda nada', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, [G1.id, GOTRO.id]);
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({ success: false, code: 'GESTORA_NO_VALIDA' });
    expect(await q('SELECT 1 FROM equipo_comercial WHERE lider_id = $1', [RAQUEL.id])).toHaveLength(0);
  });

  it('ella misma no puede estar en su equipo, 400', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, [RAQUEL.id]);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('NO_A_SI_MISMA');
  });

  it('una admin no puede entrar como gestora del equipo, 400', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, [DANIELA.id]);
    expect(r.status).toBe(400);
  });

  it('sin la lista, 400 de validación', async () => {
    const r = await request.put(`/api/users/${RAQUEL.id}/equipo-comercial`).set(como(SUPER)).send({ gestoraIds: 'x' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
  });

  it('el super admin le pone a Raquel dos gestoras; queda en el registro', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, [G1.id, G2.id, G1.id]);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.gestoraIds.sort()).toEqual([G1.id, G2.id].sort());
    const reg = await q(`SELECT quien_id, despues FROM permisos_registro WHERE usuario_id = $1 AND clave = 'equipo_comercial'`, [RAQUEL.id]);
    expect(reg).toHaveLength(1);
    expect(reg[0].quien_id).toBe(SUPER.id);
    expect(reg[0].despues).toContain(`#${G1.id}`);
  });

  it('GET: lo ve quien puede ver usuarios, con las candidatas de sus campus', async () => {
    const r = await request.get(`/api/users/${RAQUEL.id}/equipo-comercial`).set(como(DANIELA));
    expect(r.status).toBe(200);
    expect(r.body.data.gestoraIds.sort()).toEqual([G1.id, G2.id].sort());
    const candidatas = r.body.data.candidatas.map((c) => c.id);
    expect(candidatas).toEqual(expect.arrayContaining([G1.id, G2.id, G3.id]));
    expect(candidatas).not.toContain(GOTRO.id);
    expect(candidatas).not.toContain(DANIELA.id);
  });
});

describe('lo que ve cada una', () => {
  it('Raquel (con equipo) ve los prospectos de sus gestoras y no los de otra', async () => {
    expect((await leadsDe(RAQUEL)).sort()).toEqual([L.L1, L.L2].sort());
  });

  it('Raquel: la ficha de un prospecto de su equipo sí; la de otra gestora, no (lo mismo que a una gestora)', async () => {
    expect((await request.get(`/api/leads/${L.L1}`).set(como(RAQUEL))).status).toBe(200);
    const ajena = await request.get(`/api/leads/${L.L3}`).set(como(RAQUEL));
    const comoGestora = await request.get(`/api/leads/${L.L3}`).set(como(G1));
    expect(ajena.status).toBe(comoGestora.status);
    expect([403, 404]).toContain(ajena.status);
    expect(ajena.body.data).toBeUndefined();
  });

  it('Raquel ve las ventas de su equipo y no las de otra; la ficha ajena, cerrada', async () => {
    expect(await ventasDe(RAQUEL)).toEqual([V.L1]);
    expect((await request.get(`/api/conversions/${V.L1}`).set(como(RAQUEL))).status).toBe(200);
    const ajena = await request.get(`/api/conversions/${V.L3}`).set(como(RAQUEL));
    expect([403, 404]).toContain(ajena.status);
    expect(ajena.body.data).toBeUndefined();
  });

  it('Raquel puede filtrar por una de sus gestoras; pedir a otra no ensancha nada', async () => {
    const una = await request.get(`/api/leads?projectId=${P}&includeConverted=true&responsableId=${G2.id}`).set(como(RAQUEL));
    expect(idsDe(una).filter((id) => ids.leads.includes(id))).toEqual([L.L2]);
    const otra = await request.get(`/api/leads?projectId=${P}&includeConverted=true&responsableId=${G3.id}`).set(como(RAQUEL));
    expect(idsDe(otra)).not.toContain(L.L3);
  });

  it('Daniela (admin sin equipo) ve todo su campus', async () => {
    expect((await leadsDe(DANIELA)).sort()).toEqual([L.L1, L.L2, L.L3].sort());
    expect((await ventasDe(DANIELA)).sort()).toEqual([V.L1, V.L3].sort());
  });

  it('una gestora sigue viendo solo lo suyo', async () => {
    expect(await leadsDe(G1)).toEqual([L.L1]);
    expect(await ventasDe(G1)).toEqual([V.L1]);
    expect(await leadsDe(G3)).toEqual([L.L3]);
  });

  it('el ranking de Raquel es el de su equipo; el de Daniela, el de todas', async () => {
    const deRaquel = await request.get(`/api/ventas/gestores-stats?projectId=${P}&periodo=all`).set(como(RAQUEL));
    expect(deRaquel.status, JSON.stringify(deRaquel.body)).toBe(200);
    const suyas = deRaquel.body.data.gestores.map((g) => g.user_id);
    expect(suyas).not.toContain(G3.id);
    const deDaniela = await request.get(`/api/ventas/gestores-stats?projectId=${P}&periodo=all`).set(como(DANIELA));
    expect(deDaniela.body.data.gestores.map((g) => g.user_id)).toContain(G3.id);
  });

  it('Raquel solo reparte dentro de su equipo', async () => {
    const fuera = await request.patch(`/api/leads/${L.L2}/reassign`).set(como(RAQUEL)).send({ responsable_id: G3.id });
    expect(fuera.status).toBe(403);
    expect((await q('SELECT responsable_id FROM leads WHERE id = $1', [L.L2]))[0].responsable_id).toBe(G2.id);
    const ajeno = await request.patch(`/api/leads/${L.L3}/reassign`).set(como(RAQUEL)).send({ responsable_id: G1.id });
    expect([403, 404]).toContain(ajeno.status);
    expect((await q('SELECT responsable_id FROM leads WHERE id = $1', [L.L3]))[0].responsable_id).toBe(G3.id);
  });

  it('el alcance se calcula una vez por petición (mismo objeto de sesión, misma respuesta)', async () => {
    const user = { userId: RAQUEL.id, role: 'admin' };
    const a = alcanceComercial(user);
    expect(alcanceComercial(user)).toBe(a);
    expect((await a).sort()).toEqual([RAQUEL.id, G1.id, G2.id].sort());
    expect(await alcanceComercial({ userId: DANIELA.id, role: 'admin' })).toBeNull();
    expect(await alcanceComercial({ userId: G1.id, role: 'gestor' })).toEqual([G1.id]);
    expect(await alcanceComercial({ userId: SUPER.id, role: 'superadmin' })).toBeNull();
  });
});

describe('Claude (MCP) respeta el equipo', () => {
  const ambitoDe = async (u, role) => {
    const user = { id: u.id, nombre: u.nombre, role, active: true };
    return construirAmbito(user, [{ id: P, nombre: `${MARCA} a`, sociedad_id: null }], await alcanceDelMcp(user));
  };
  const herramienta = (n) => HERRAMIENTAS.find((h) => h.nombre === n);
  const idsMcp = (r) => (r.filas || r.prospectos || r.ventas || r.items || r.data || [])
    .map((f) => Number(f.id ?? f.venta_id ?? f.prospecto_id)).filter((id) => [...ids.leads, ...ids.conversions].includes(id));

  it('buscar_prospectos: Raquel, los de su equipo; Daniela, todos', async () => {
    const r = await herramienta('buscar_prospectos').ejecutar(await ambitoDe(RAQUEL, 'admin'), { pagina: 1, limite: 100 });
    expect(idsMcp(r).sort()).toEqual([L.L1, L.L2].sort());
    const d = await herramienta('buscar_prospectos').ejecutar(await ambitoDe(DANIELA, 'admin'), { pagina: 1, limite: 100 });
    expect(idsMcp(d).sort()).toEqual([L.L1, L.L2, L.L3].sort());
  });

  it('ver_prospecto: uno de otra gestora no existe para Raquel', async () => {
    await expect(herramienta('ver_prospecto').ejecutar(await ambitoDe(RAQUEL, 'admin'), { id: L.L3 }))
      .rejects.toMatchObject({ statusCode: 404 });
    await expect(herramienta('ver_prospecto').ejecutar(await ambitoDe(RAQUEL, 'admin'), { id: L.L1 })).resolves.toBeTruthy();
  });

  it('pedir los prospectos de una gestora de fuera del equipo, 403', async () => {
    await expect(herramienta('buscar_prospectos').ejecutar(await ambitoDe(RAQUEL, 'admin'), { gestora_id: G3.id, pagina: 1, limite: 10 }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('listar_ventas: Raquel, solo las de su equipo', async () => {
    const r = await herramienta('listar_ventas').ejecutar(await ambitoDe(RAQUEL, 'admin'), { pagina: 1, limite: 100 });
    expect(idsMcp(r)).toEqual([V.L1]);
  });

  it('un informe de Reportes en Claude, recortado al equipo', async () => {
    const r = await herramienta('informe').ejecutar(await ambitoDe(RAQUEL, 'admin'), { tipo: 'resumen_mensual' });
    expect(r.informe).toBe('resumen_mensual');
  });
});

describe('corregir y abonar facturas: solo la administradora sin equipo (Diego 09/11)', () => {
  it('Raquel (con equipo) no gestiona ninguna factura; Daniela (sin equipo) sí', async () => {
    const { esFacturaQueGestiona } = await import('../src/modules/invoices/invoices.model.js');
    // El id de factura da igual: el corte es por quién pide, antes de mirar la factura.
    expect(await esFacturaQueGestiona(RAQUEL.id, 'admin', 0)).toBe(false);
    expect(await esFacturaQueGestiona(DANIELA.id, 'admin', 0)).toBe(true);
    expect(await esFacturaQueGestiona(SUPER.id, 'superadmin', 0)).toBe(true);
  });
});

describe('cambiar el equipo surte efecto en la siguiente petición', () => {
  it('quitarle a G1: Raquel deja de ver su prospecto y su venta', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, [G2.id]);
    expect(r.status).toBe(200);
    expect(await leadsDe(RAQUEL)).toEqual([L.L2]);
    expect(await ventasDe(RAQUEL)).toEqual([]);
    expect((await request.get(`/api/leads/${L.L1}`).set(como(RAQUEL))).status).not.toBe(200);
  });

  it('dejarla sin equipo: vuelve a ver todo su campus, como Daniela', async () => {
    const r = await ponerEquipo(SUPER, RAQUEL, []);
    expect(r.status).toBe(200);
    expect(r.body.data.gestoraIds).toEqual([]);
    expect((await leadsDe(RAQUEL)).sort()).toEqual([L.L1, L.L2, L.L3].sort());
  });
});
