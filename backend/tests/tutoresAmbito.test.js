import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Tutores: cada operación, solo con lo de tus campus (IDOR de `/api/tutores`).
 *
 * #245 cerró la lista y la ficha, pero `exigirGestion` solo dice QUIÉN gestiona, no DE QUÉ
 * CAMPUS. Un admin de un campus podía, con solo cambiar el id: retirar o reactivar a un
 * profesor de otra empresa, abrirle, editar o borrarle una colaboración (su porcentaje de
 * comisión), revertir, liquidar o cambiar el estado de sus comisiones, listar las comisiones
 * de otro campus con `?projectId=`, ver la ficha de su curso, y —sin ni siquiera ser admin—
 * mirar o mandar el correo de facturación de un tutor ajeno.
 *
 *   npx vitest run tests/tutoresAmbito.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: modulo } = await import('../src/modules/tutores/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use(modulo.prefix, modulo.router);
app.use(errorHandler);
const request = supertest(app);
const url = (ruta) => `${modulo.prefix}${ruta}`;

const MARCA = `TUT${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { users: [], projects: [], products: [], leads: [], conversions: [] };
let P; let OTRO; let SUPER; let ADMIN; let ADMIN_OTRO; let GESTORA;
let TUTOR_P; let TUTOR_OTRO; let TUTOR_AMBOS; let TUTOR_BAJA;
let PROD_P; let PROD_P2; let PROD_OTRO;
let COL_P; let COL_OTRO;
const PERIODO = '2030-03';

const como = (u) => ({ Authorization: `Bearer ${jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' })}` });

async function persona(n, role, campus = []) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role`,
    [`${MARCA} ${n}`, `${n.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]);
  ids.users.push(u.id);
  for (const c of campus) await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, c]);
  return u;
}
const producto = async (projectId, n) => {
  const [p] = await q(`INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 1000) RETURNING id`, [projectId, `${MARCA} ${n}`]);
  ids.products.push(p.id);
  return p.id;
};
const colaboracion = async (tutorId, productId, pct = 10) => (await q(
  `INSERT INTO tutor_collaborations (tutor_id, product_id, pct, vigente_desde) VALUES ($1, $2, $3, '2026-01-01') RETURNING id`,
  [tutorId, productId, pct]))[0].id;
/** Una comisión pendiente de ese tutor, en ese campus (con su venta y su cobro). */
async function comision(tutorId, projectId, productId, colId) {
  const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, $2, $3, '+34600111222') RETURNING id`,
    [projectId, `${MARCA} Ana`, `ana${Math.random().toString(36).slice(2, 8)}@lead.${MARCA.toLowerCase()}.test`]);
  ids.leads.push(l.id);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion) VALUES ($1, $2, 'Curso', 1000, '2030-03-10') RETURNING id`,
    [l.id, projectId]);
  ids.conversions.push(v.id);
  const [pago] = await q(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, 1000, '2030-03-10') RETURNING id`, [v.id]);
  return (await q(
    `INSERT INTO tutor_commissions (payment_id, tutor_id, collaboration_id, product_id, base_calculo, pct, importe, estado, periodo)
     VALUES ($1, $2, $3, $4, 1000, 10, 100, 'pendiente', $5) RETURNING id`,
    [pago.id, tutorId, colId, productId, PERIODO]))[0].id;
}
const estadoDe = async (id) => (await q(`SELECT estado FROM tutor_commissions WHERE id = $1`, [id]))[0]?.estado;
const activo = async (id) => (await q(`SELECT active FROM users WHERE id = $1`, [id]))[0]?.active;

let COM_P; let COM_OTRO; let COM_AMBOS_P; let COM_AMBOS_OTRO;

beforeAll(async () => {
  const proy = async (c) => {
    const [p] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${c}`, `${MARCA.toLowerCase()}-${c}`, `${MARCA}-key-${c}`]);
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a'); OTRO = await proy('b');
  SUPER = await persona('SUPER', 'superadmin');
  ADMIN = await persona('ADMIN', 'admin', [P]);
  ADMIN_OTRO = await persona('ADMINOTRO', 'admin', [OTRO]);
  GESTORA = await persona('GESTORA', 'gestor', [P]);
  TUTOR_P = await persona('TUTORP', 'tutor', [P]);
  TUTOR_OTRO = await persona('TUTOROTRO', 'tutor', [OTRO]);
  TUTOR_AMBOS = await persona('TUTORAMBOS', 'tutor', [P, OTRO]);
  TUTOR_BAJA = await persona('TUTORBAJA', 'tutor', [P]);
  PROD_P = await producto(P, 'cursoP'); PROD_P2 = await producto(P, 'cursoP2'); PROD_OTRO = await producto(OTRO, 'cursoOtro');
  COL_P = await colaboracion(TUTOR_P.id, PROD_P);
  COL_OTRO = await colaboracion(TUTOR_OTRO.id, PROD_OTRO);
  const colAmbosP = await colaboracion(TUTOR_AMBOS.id, PROD_P);
  const colAmbosOtro = await colaboracion(TUTOR_AMBOS.id, PROD_OTRO);
  COM_P = await comision(TUTOR_P.id, P, PROD_P, COL_P);
  COM_OTRO = await comision(TUTOR_OTRO.id, OTRO, PROD_OTRO, COL_OTRO);
  COM_AMBOS_P = await comision(TUTOR_AMBOS.id, P, PROD_P, colAmbosP);
  COM_AMBOS_OTRO = await comision(TUTOR_AMBOS.id, OTRO, PROD_OTRO, colAmbosOtro);
}, 60000);

afterAll(async () => {
  await q(`DELETE FROM tutor_commissions WHERE tutor_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE id = ANY($1::int[])`, [ids.leads]);
  await q(`DELETE FROM tutor_collaborations WHERE tutor_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM products WHERE id = ANY($1::int[])`, [ids.products]);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

describe('colaboraciones: solo las de tus campus', () => {
  it('la lista no trae las de otro campus', async () => {
    const r = await request.get(url('/colaboraciones')).set(como(ADMIN));
    expect(r.status).toBe(200);
    const ver = r.body.data.map((c) => c.id);
    expect(ver).toContain(COL_P);
    expect(ver).not.toContain(COL_OTRO);
  });

  it('editar la de otro campus: «no encontrada», y el porcentaje no cambia', async () => {
    const r = await request.patch(url(`/colaboraciones/${COL_OTRO}`)).set(como(ADMIN)).send({ pct: 99 });
    expect(r.status).toBe(404);
    expect((await q(`SELECT pct FROM tutor_collaborations WHERE id = $1`, [COL_OTRO]))[0].pct).toBe('10.00');
  });

  it('editar la de su campus sí', async () => {
    const r = await request.patch(url(`/colaboraciones/${COL_P}`)).set(como(ADMIN)).send({ pct: 12 });
    expect(r.status).toBe(200);
  });

  it('borrar la de otro campus: no encontrada, y sigue ahí', async () => {
    expect((await request.delete(url(`/colaboraciones/${COL_OTRO}`)).set(como(ADMIN))).status).toBe(404);
    expect(await q(`SELECT 1 FROM tutor_collaborations WHERE id = $1`, [COL_OTRO])).toHaveLength(1);
  });

  it('abrirle una a un tutor de otra empresa: no encontrado, y no se crea', async () => {
    const r = await request.post(url('/colaboraciones')).set(como(ADMIN))
      .send({ tutorId: TUTOR_OTRO.id, productId: PROD_OTRO, pct: 50, desde: '2031-01-01' });
    expect(r.status).toBe(404);
    expect(await q(`SELECT 1 FROM tutor_collaborations WHERE tutor_id = $1 AND vigente_desde = '2031-01-01'`, [TUTOR_OTRO.id])).toHaveLength(0);
  });

  it('abrirle una a un tutor de su campus sí', async () => {
    const r = await request.post(url('/colaboraciones')).set(como(ADMIN))
      .send({ tutorId: TUTOR_P.id, productId: PROD_P2, pct: 15, desde: '2031-01-01' });
    expect(r.status).toBe(201);
  });

  it('el super admin, en cualquiera', async () => {
    expect((await request.patch(url(`/colaboraciones/${COL_OTRO}`)).set(como(SUPER)).send({ pct: 11 })).status).toBe(200);
  });
});

describe('comisiones: solo las de tus campus', () => {
  it('la lista sin campus trae solo las suyas; con el campus de otro, 403', async () => {
    const todas = await request.get(url(`/comisiones?periodo=${PERIODO}`)).set(como(ADMIN));
    expect(todas.status).toBe(200);
    const ver = todas.body.data.map((c) => c.id);
    expect(ver).toEqual(expect.arrayContaining([COM_P, COM_AMBOS_P]));
    expect(ver).not.toContain(COM_OTRO);
    expect(ver).not.toContain(COM_AMBOS_OTRO);
    expect((await request.get(url(`/comisiones?projectId=${OTRO}`)).set(como(ADMIN))).status).toBe(403);
  });

  it('revertir la de otro campus: no encontrada, y sigue pendiente', async () => {
    expect((await request.post(url(`/comisiones/${COM_OTRO}/revertir`)).set(como(ADMIN)).send({ motivo: 'x' })).status).toBe(404);
    expect(await estadoDe(COM_OTRO)).toBe('pendiente');
  });

  it('cambiar el estado de la de otro campus: no encontrada', async () => {
    expect((await request.patch(url(`/comisiones/${COM_OTRO}/estado`)).set(como(ADMIN)).send({ estado: 'notificada' })).status).toBe(404);
    expect(await estadoDe(COM_OTRO)).toBe('pendiente');
  });

  it('liquidar unas líneas: si una sola es de otro campus, no se paga NINGUNA', async () => {
    const r = await request.post(url('/comisiones/liquidar')).set(como(ADMIN)).send({ ids: [COM_P, COM_OTRO] });
    expect(r.status).toBe(404);
    expect(await estadoDe(COM_P)).toBe('pendiente');
    expect(await estadoDe(COM_OTRO)).toBe('pendiente');
  });

  it('liquidar a un tutor de otra empresa: no encontrado', async () => {
    expect((await request.post(url('/comisiones/liquidar')).set(como(ADMIN)).send({ tutorId: TUTOR_OTRO.id, periodo: PERIODO })).status).toBe(404);
    expect(await estadoDe(COM_OTRO)).toBe('pendiente');
  });

  it('un tutor que da clase en las dos empresas: se paga SOLO lo de mi campus', async () => {
    const r = await request.post(url('/comisiones/liquidar')).set(como(ADMIN)).send({ tutorId: TUTOR_AMBOS.id, periodo: PERIODO });
    expect(r.status).toBe(200);
    expect(r.body.data.liquidadas).toBe(1);
    expect(await estadoDe(COM_AMBOS_P)).toBe('pagada');
    expect(await estadoDe(COM_AMBOS_OTRO)).toBe('pendiente');
  });

  it('calcular con el campus de otro: 403', async () => {
    expect((await request.post(url('/comisiones/calcular')).set(como(ADMIN)).send({ projectId: OTRO })).status).toBe(403);
  });

  it('el super admin, en cualquiera', async () => {
    expect((await request.post(url(`/comisiones/${COM_OTRO}/revertir`)).set(como(SUPER)).send({ motivo: 'prueba' })).status).toBe(200);
    expect(await estadoDe(COM_OTRO)).toBe('revertida');
  });
});

describe('tutores y formaciones: solo los de tus campus', () => {
  it('retirar o reactivar a un tutor de otra empresa: no encontrado', async () => {
    expect((await request.delete(url(`/${TUTOR_OTRO.id}`)).set(como(ADMIN))).status).toBe(404);
    expect((await request.post(url(`/${TUTOR_OTRO.id}/reactivar`)).set(como(ADMIN))).status).toBe(404);
    expect(await activo(TUTOR_OTRO.id)).toBe(true);
  });

  it('retirar a uno de su campus sí', async () => {
    expect((await request.delete(url(`/${TUTOR_BAJA.id}`)).set(como(ADMIN))).status).toBe(200);
    expect(await activo(TUTOR_BAJA.id)).toBe(false);
  });

  it('marcar «se busca tutor» en una formación de otro campus: no encontrada', async () => {
    expect((await request.put(url(`/formaciones/${PROD_OTRO}/busqueda`)).set(como(ADMIN)).send({ buscando: true })).status).toBe(404);
    expect((await request.put(url(`/formaciones/${PROD_P}/busqueda`)).set(como(ADMIN)).send({ buscando: true })).status).toBe(200);
  });

  it('la ficha del curso y su brochure, solo de su campus', async () => {
    expect((await request.get(url(`/curso/${PROD_OTRO}`)).set(como(ADMIN))).status).toBe(404);
    expect((await request.get(url(`/curso/${PROD_OTRO}/brochure`)).set(como(ADMIN))).status).toBe(404);
    expect((await request.get(url(`/curso/${PROD_P}`)).set(como(ADMIN))).status).toBe(200);
  });
});

describe('el correo de facturación al tutor', () => {
  it('quien no gestiona (una gestora) ni lo ve ni lo manda', async () => {
    expect((await request.get(url(`/comisiones/aviso?tutorId=${TUTOR_AMBOS.id}&periodo=${PERIODO}`)).set(como(GESTORA))).status).toBe(403);
    expect((await request.post(url('/comisiones/avisar')).set(como(GESTORA)).send({ tutorId: TUTOR_AMBOS.id, periodo: PERIODO })).status).toBe(403);
  });

  it('un admin, solo a los tutores de sus campus', async () => {
    expect((await request.get(url(`/comisiones/aviso?tutorId=${TUTOR_OTRO.id}&periodo=${PERIODO}`)).set(como(ADMIN))).status).toBe(404);
    expect((await request.post(url('/comisiones/avisar')).set(como(ADMIN)).send({ tutorId: TUTOR_OTRO.id, periodo: PERIODO })).status).toBe(404);
  });
});
