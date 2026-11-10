import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import {
  contactosPorCampus, contactosPorGestora, seguimientoYTiempos,
} from '../src/modules/reports/report.model.js';

/**
 * Los contactos por campus y por gestora de los correos de dirección (#270),
 * contra Postgres de verdad.
 *
 * Lo que más importa: «las cifras, las mismas que en Reportes con esa empresa
 * elegida» es literal del ticket. Si el correo contara los contactos de otra
 * forma, diría 40 y la pantalla 43, y nadie se creería ninguno de los dos. Por eso
 * el primer caso compara con `seguimientoYTiempos`, que es lo que enseña Reportes.
 *
 * Proyectos propios y usuarios INACTIVOS: otras pruebas de la suite (Certifex)
 * enumeran admins y superadmins activos, y uno que aparece y desaparece mientras
 * tanto las desajusta.
 */

const marca = `CONT${Date.now().toString(36)}`;
const ids = { projects: [], users: [], leads: [] };
let pA; let pB; let u1; let u2;

const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);

async function lead(project, responsable, { borrado = false } = {}) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, email, status, responsable_id, created_at, fecha_solicitud, deleted_at)
     VALUES ($1, $2, $3, 'nuevo', $4, '2026-01-01', '2026-01-01', $5) RETURNING id`,
    [project, `${marca} lead`, `${marca}-${Math.random().toString(36).slice(2, 8)}@cont.test`, responsable,
      borrado ? '2026-02-01' : null]);
  ids.leads.push(l.id);
  return l.id;
}
const toque = (leadId, fecha) => q(
  `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha) VALUES ($1, 'llamada', 'x', $2, $3)`,
  [leadId, u1, fecha]);

beforeAll(async () => {
  for (const clave of ['A', 'B']) {
    const [p] = await q(
      `INSERT INTO projects (nombre, slug, webhook_api_key, type, es_prueba) VALUES ($1, $2, $3, 'crm', TRUE) RETURNING id`,
      [`${marca} campus ${clave}`, `${marca}-${clave}`.toLowerCase(), `whk_${marca}_${clave}`]);
    ids.projects.push(p.id);
  }
  [pA, pB] = ids.projects;
  const mk = async (rol, nombre) => (await q(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', $3, FALSE) RETURNING id`,
    [`${marca} ${nombre}`, `${nombre.toLowerCase()}@${marca.toLowerCase()}.test`, rol]))[0].id;
  u1 = await mk('gestor', 'Gestora');
  u2 = await mk('admin', 'Admin');
  ids.users.push(u1, u2);

  const a1 = await lead(pA, u1);
  const a2 = await lead(pA, u2);
  const a3 = await lead(pA, u1, { borrado: true });
  const b1 = await lead(pB, u1);

  // A1: dos en septiembre y una en el BORDE: 23:30 UTC del 30/09 son las 01:30 del
  // 1 de octubre en Madrid, y Reportes cuenta por la fecha de Madrid.
  await toque(a1, '2026-09-10T12:00:00Z');
  await toque(a1, '2026-09-10T13:00:00Z');
  await toque(a1, '2026-09-30T23:30:00Z');
  await toque(a2, '2026-09-12T10:00:00Z');
  await toque(a2, '2026-09-12T11:00:00Z');
  await toque(a3, '2026-09-12T10:00:00Z');          // prospecto borrado: no cuenta
  for (let i = 0; i < 4; i += 1) await toque(b1, '2026-09-15T10:00:00Z');
});

afterAll(async () => {
  await q('DELETE FROM lead_interactions WHERE lead_id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.leads]);
  await q('DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]);
  await pool.end();
});

const SEPT = { from: '2026-09-01', to: '2026-09-30' };

describe('contactos por campus', () => {
  it('cuenta los de cada campus, sin los de prospectos borrados', async () => {
    const r = await contactosPorCampus({ projectIds: [pA, pB], ...SEPT });
    const de = (id) => r.find((x) => x.project_id === id);
    expect(de(pA)).toMatchObject({ contactos: 4, personas: 2 });
    expect(de(pB)).toMatchObject({ contactos: 4, personas: 1 });
  });

  it('da lo MISMO que Reportes para el mismo campus y rango', async () => {
    const [mio] = await contactosPorCampus({ projectIds: [pA], ...SEPT });
    const rep = await seguimientoYTiempos({ projectId: pA, ...SEPT });
    expect(mio.contactos).toBe(rep.actividad.toques);
    expect(mio.personas).toBe(rep.actividad.personas);
  });

  it('el borde del dia es el de Madrid: las 23:30 UTC del 30/09 ya son del 1 de octubre', async () => {
    const sept = await contactosPorCampus({ projectIds: [pA], ...SEPT });
    const oct = await contactosPorCampus({ projectIds: [pA], from: '2026-10-01', to: '2026-10-01' });
    expect(sept[0].contactos).toBe(4);       // la del borde NO esta en septiembre
    expect(oct[0]).toMatchObject({ contactos: 1, personas: 1 });
    // Y Reportes dice lo mismo.
    const rep = await seguimientoYTiempos({ projectId: pA, from: '2026-10-01', to: '2026-10-01' });
    expect(rep.actividad.toques).toBe(1);
  });

  it('las dos fechas del rango van incluidas', async () => {
    const [d] = await contactosPorCampus({ projectIds: [pA], from: '2026-09-10', to: '2026-09-10' });
    expect(d.contactos).toBe(2);
  });

  it('un campus sin contactos no sale en la lista (quien llama lo pinta a cero)', async () => {
    const r = await contactosPorCampus({ projectIds: [pA, pB], from: '2026-08-01', to: '2026-08-31' });
    expect(r).toEqual([]);
  });

  it('sin campus no consulta nada', async () => {
    expect(await contactosPorCampus({ projectIds: [], ...SEPT })).toEqual([]);
    expect(await contactosPorCampus({ projectIds: null, ...SEPT })).toEqual([]);
  });

  it('un campus que no es de los pedidos no se cuela', async () => {
    const r = await contactosPorCampus({ projectIds: [pB], ...SEPT });
    expect(r.map((x) => x.project_id)).toEqual([pB]);
  });
});

describe('contactos por gestora', () => {
  it('cuenta a quien lleva los prospectos, SEA CUAL SEA SU ROL', async () => {
    const r = await contactosPorGestora({ projectIds: [pA, pB], ...SEPT });
    const de = (id) => r.find((x) => x.user_id === id);
    expect(de(u1)).toMatchObject({ contactos: 6 });        // 2 en A1 + 4 en B1; el borrado no
    // La persona con rol admin tambien: antes el diario solo miraba `role = 'gestor'`.
    expect(de(u2)).toMatchObject({ contactos: 2 });
  });

  it('acotado a un campus, solo los de ese campus', async () => {
    const r = await contactosPorGestora({ projectIds: [pA], ...SEPT });
    expect(r.find((x) => x.user_id === u1).contactos).toBe(2);
  });

  it('el total por gestora coincide con el total por campus', async () => {
    const porCampus = await contactosPorCampus({ projectIds: [pA, pB], ...SEPT });
    const porGestora = await contactosPorGestora({ projectIds: [pA, pB], ...SEPT });
    const suma = (l) => l.reduce((t, x) => t + x.contactos, 0);
    expect(suma(porGestora)).toBe(suma(porCampus));
  });
});
