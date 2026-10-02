import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import bcrypt from 'bcrypt';
import { query } from '../src/shared/config/db.js';
import { entregadoDe, tutoresConCursos, comisionesDeTutores } from '../src/modules/mcp/mcp.model.js';

/**
 * #207, reabierta por Manuel el 02/10: «en Comisiones está la columna Entregado
 * (foto corporativa, vídeo y módulos 25 / 50 / 100 %), pero la conexión no la
 * devuelve».
 *
 * - El texto tiene que ser EL MISMO que la columna de la pantalla.
 * - «¿A quién se le puede pagar ya?» en una sola consulta.
 * - Un filtro de entregas pendientes, que no cuente los cursos ya retirados.
 */

const marca = `t${Date.now()}`;
const ids = { usuarios: [], productos: [] };
let projectId = null;
let hayBase = true;
let porQueNo = null;

async function uno(sql, p) { return (await query(sql, p)).rows[0]; }

async function tutor(clave) {
  const u = await uno(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, $3, 'tutor', true) RETURNING id`,
    [`${clave} ${marca}`, `${clave}.${marca}@test.local`, await bcrypt.hash('x', 4)]
  );
  ids.usuarios.push(u.id);
  ids[clave] = u.id;
  await query('INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)', [u.id, projectId]);
  return u.id;
}

async function curso(clave) {
  const p = await uno(`INSERT INTO products (project_id, nombre, precio) VALUES ($1, $2, 1000) RETURNING id`, [projectId, `${clave} ${marca}`]);
  ids.productos.push(p.id);
  ids[clave] = p.id;
}

async function colaboracion(tutorId, productId, { foto = false, video = false, pct = 0, activa = true } = {}) {
  return (await uno(
    `INSERT INTO tutor_collaborations (tutor_id, product_id, pct, vigente_desde, activa, entrego_foto, entrego_video, modulos_pct)
     VALUES ($1, $2, 10, '2026-09-01', $3, $4, $5, $6) RETURNING id`,
    [tutorId, productId, activa, foto, video, pct]
  )).id;
}

/** Una línea de comisión de septiembre, con su venta y su cobro (la comisión exige un pago). */
async function comision(tutorId, productId, collaborationId, importe, estado = 'pendiente') {
  const lead = await uno(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, $2, $3) RETURNING id`,
    [projectId, `Alumno ${marca}`, `al.${marca}.${Math.random()}@lead.local`]);
  const venta = await uno(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, fecha_conversion) VALUES ($1, $2, 'Curso', $3, '2026-09-10') RETURNING id`,
    [lead.id, projectId, importe * 10]
  );
  const pago = await uno(`INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $2, '2026-09-10') RETURNING id`, [venta.id, importe * 10]);
  await query(
    `INSERT INTO tutor_commissions (payment_id, tutor_id, collaboration_id, product_id, base_calculo, pct, importe, estado, periodo)
     VALUES ($1, $2, $3, $4, $5, 10, $6, $7, '2026-09')`,
    [pago.id, tutorId, collaborationId, productId, importe * 10, importe, estado]
  );
}

beforeAll(async () => {
  try {
    projectId = (await uno(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active) VALUES ($1, $2, $3, true) RETURNING id`,
      [`Entregado ${marca}`, `entregado-${marca}`, `k-${marca}`]
    )).id;
    await curso('Completo');
    await curso('AMedias');
    await curso('Retirado');
    await tutor('melisa');
    await tutor('pedro');

    // Melisa: un curso entregado del todo, otro a medias y uno que ya no da.
    const completo = await colaboracion(ids.melisa, ids.Completo, { foto: true, video: true, pct: 100 });
    const aMedias = await colaboracion(ids.melisa, ids.AMedias, { foto: true, pct: 50 });
    await colaboracion(ids.melisa, ids.Retirado, { activa: false });
    await comision(ids.melisa, ids.Completo, completo, 30);
    await comision(ids.melisa, ids.AMedias, aMedias, 20);
    await comision(ids.melisa, ids.AMedias, aMedias, 5);

    // Pedro: todo entregado; se le puede pagar.
    const dePedro = await colaboracion(ids.pedro, ids.Completo, { foto: true, video: true, pct: 100 });
    await comision(ids.pedro, ids.Completo, dePedro, 12);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  if (!projectId) return;
  for (const [sql, p] of [
    ['DELETE FROM tutor_commissions WHERE tutor_id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM conversion_payments WHERE conversion_id IN (SELECT id FROM conversions WHERE project_id = $1)', [projectId]],
    ['DELETE FROM conversions WHERE project_id = $1', [projectId]],
    ['DELETE FROM leads WHERE project_id = $1', [projectId]],
    ['DELETE FROM tutor_collaborations WHERE tutor_id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM user_projects WHERE project_id = $1', [projectId]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]],
    ['DELETE FROM products WHERE id = ANY($1::int[])', [ids.productos]],
    ['DELETE FROM projects WHERE id = $1', [projectId]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

describe('el texto, el mismo que la columna Entregado de la pantalla', () => {
  it.each([
    [{}, 'sin entregar'],
    [{ entrego_foto: true }, 'Foto corporativa'],
    [{ entrego_video: true }, 'Vídeo'],
    [{ entrego_foto: true, entrego_video: true }, 'Foto y Vídeo'],
    [{ modulos_pct: 25 }, '25% módulos'],
    [{ entrego_video: true, modulos_pct: 50 }, 'Vídeo · 50% módulos'],
    [{ entrego_foto: true, entrego_video: true, modulos_pct: 100 }, 'Foto y Vídeo · 100% completo'],
  ])('%o → %s', (c, texto) => {
    expect(entregadoDe(c).entregado).toBe(texto);
  });

  it('dice lo que falta, y completo es foto, vídeo y módulos al 100 %', () => {
    expect(entregadoDe({ entrego_foto: true, modulos_pct: 50 }).falta).toEqual(['vídeo', 'módulos (va por el 50 %)']);
    expect(entregadoDe({}).falta).toEqual(['foto corporativa', 'vídeo', 'módulos']);
    expect(entregadoDe({ entrego_foto: true, entrego_video: true, modulos_pct: 100 }).todo_entregado).toBe(true);
    expect(entregadoDe(null).entregado).toBe('sin entregar');
  });
});

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe('listar_tutores, con lo entregado de cada curso', () => {
  it('cada curso trae lo entregado, y lo retirado no cuenta como pendiente', async () => {
    if (!hayBase) return;
    const r = await tutoresConCursos({ projectIds: [projectId] });
    const melisa = r.tutores.find((t) => t.id === ids.melisa);
    const porCurso = Object.fromEntries(melisa.cursos.map((c) => [c.curso.split(' ')[0], c]));
    expect(porCurso.Completo.entregado).toBe('Foto y Vídeo · 100% completo');
    expect(porCurso.AMedias.entregado).toBe('Foto corporativa · 50% módulos');
    expect(porCurso.AMedias.falta).toEqual(['vídeo', 'módulos (va por el 50 %)']);
    expect(porCurso.Retirado.entregado).toBe('sin entregar');
    expect(melisa.cursos_con_entregas_pendientes).toBe(1);
  });

  it('el filtro deja solo a quien le falta algo, y solo esos cursos', async () => {
    if (!hayBase) return;
    const r = await tutoresConCursos({ projectIds: [projectId], solo_entregas_pendientes: true });
    expect(r.total).toBe(1);
    expect(r.tutores[0].id).toBe(ids.melisa);
    expect(r.tutores[0].cursos.map((c) => c.curso)).toEqual([`AMedias ${marca}`]);
  });
});

describe('comisiones_tutores: ¿a quién se le puede pagar ya?', () => {
  it('curso a curso, sin multiplicar las líneas ni el dinero', async () => {
    if (!hayBase) return;
    const r = await comisionesDeTutores({ projectIds: [projectId], periodo: '2026-09' });
    const melisa = r.filas.find((f) => f.tutor_id === ids.melisa);
    const pedro = r.filas.find((f) => f.tutor_id === ids.pedro);
    expect(melisa.lineas).toBe(3);
    expect(melisa.por_pagar).toBe(55);
    expect(melisa.cursos.map((c) => c.entregado)).toEqual(['Foto corporativa · 50% módulos', 'Foto y Vídeo · 100% completo']);
    expect(melisa.cursos_con_entregas_pendientes).toBe(1);
    expect(melisa.se_puede_pagar).toBe(false);
    expect(pedro.se_puede_pagar).toBe(true);
    expect(r.totales.por_pagar).toBe(67);
  });

  it('con lo pagado ya no hay nada que pagar, aunque esté todo entregado', async () => {
    if (!hayBase) return;
    await query(`UPDATE tutor_commissions SET estado = 'pagada' WHERE tutor_id = $1`, [ids.pedro]);
    const r = await comisionesDeTutores({ projectIds: [projectId], periodo: '2026-09', tutor_id: ids.pedro });
    expect(r.filas[0].se_puede_pagar).toBe(false);
    await query(`UPDATE tutor_commissions SET estado = 'pendiente' WHERE tutor_id = $1`, [ids.pedro]);
  });

  it('el filtro deja las filas con entregas pendientes, y los totales son de esas', async () => {
    if (!hayBase) return;
    const r = await comisionesDeTutores({ projectIds: [projectId], periodo: '2026-09', solo_entregas_pendientes: true });
    expect(r.filas.map((f) => f.tutor_id)).toEqual([ids.melisa]);
    expect(r.totales.por_pagar).toBe(55);
  });
});
