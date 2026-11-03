import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import * as model from '../src/modules/soporte/soporte.model.js';

/**
 * El alcance de los tickets, contra Postgres de verdad (#38, #245).
 *
 * Lo que se fija aqui es el SQL: el recorte por autor y por campus vive en un
 * `WHERE (abierto_por = $1 OR project_id = ANY($2))`, y un mock del modelo no
 * dice nada de eso. Un admin ve los tickets de SUS campus y los que abrio el;
 * no los de otra empresa.
 */

const CAMPUS_MIO = 1;
const CAMPUS_AJENO = 2;
const ids = {};
let autorA;
let autorB;

async function ticket({ autor, proyecto, titulo }) {
  const { rows } = await pool.query(
    `INSERT INTO tickets (abierto_por, project_id, titulo, primera_respuesta_at, created_at)
     VALUES ($1, $2, $3, NOW(), NOW() - interval '2 hours') RETURNING id`,
    [autor, proyecto, titulo]);
  return rows[0].id;
}

beforeAll(async () => {
  const mk = async (email) => (await pool.query(
    `INSERT INTO users (nombre, email, password_hash, role, active)
     VALUES ($1, $2, 'x', 'gestor', TRUE) RETURNING id`, [email, email])).rows[0].id;
  autorA = await mk('soporte-alcance-a@test-soporte.com');
  autorB = await mk('soporte-alcance-b@test-soporte.com');

  ids.delMio = await ticket({ autor: autorB, proyecto: CAMPUS_MIO, titulo: '[alcance] de mi campus' });
  ids.delAjeno = await ticket({ autor: autorB, proyecto: CAMPUS_AJENO, titulo: '[alcance] de otro campus' });
  ids.sinProyecto = await ticket({ autor: autorB, proyecto: null, titulo: '[alcance] sin proyecto' });
  ids.propioAjeno = await ticket({ autor: autorA, proyecto: CAMPUS_AJENO, titulo: '[alcance] mio en otro campus' });
});

afterAll(async () => {
  await pool.query('DELETE FROM tickets WHERE titulo LIKE $1', ['[alcance]%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['%@test-soporte.com']);
  await pool.end();
});

const titulos = async (filtros) =>
  (await model.listar({ limit: 100, ...filtros })).tickets
    .map((t) => t.title).filter((t) => t.startsWith('[alcance]')).sort();

describe('listar acotado por quien pregunta', () => {
  it('sin alcance (superadmin y soporte) salen todos', async () => {
    expect(await titulos({ alcance: null })).toEqual([
      '[alcance] de mi campus', '[alcance] de otro campus',
      '[alcance] mio en otro campus', '[alcance] sin proyecto',
    ]);
  });

  it('un admin ve los de su campus y los que abrio el, nada mas', async () => {
    const lista = await titulos({ alcance: { userId: autorA, projectIds: [CAMPUS_MIO] } });
    expect(lista).toEqual(['[alcance] de mi campus', '[alcance] mio en otro campus']);
  });

  it('un ticket de otro campus y uno sin proyecto NO le salen', async () => {
    const lista = await titulos({ alcance: { userId: autorA, projectIds: [CAMPUS_MIO] } });
    expect(lista).not.toContain('[alcance] de otro campus');
    expect(lista).not.toContain('[alcance] sin proyecto');
  });

  it('con una lista de campus vacia solo ve los suyos', async () => {
    expect(await titulos({ alcance: { userId: autorA, projectIds: [] } }))
      .toEqual(['[alcance] mio en otro campus']);
  });

  it('el total y las paginas cuentan lo mismo que lo que se lista', async () => {
    const r = await model.listar({
      limit: 100, alcance: { userId: autorA, projectIds: [] },
    });
    expect(r.total).toBe(r.tickets.length);
  });
});

describe('los tiempos acotados por campus', () => {
  it('un admin mide solo los tickets de sus campus', async () => {
    const mio = await model.tiempos({ projectIds: [CAMPUS_MIO] });
    const ajeno = await model.tiempos({ projectIds: [CAMPUS_AJENO] });
    const todo = await model.tiempos({});
    // Los tickets de este test: 1 en el campus mio, 2 en el ajeno, 1 sin proyecto.
    expect(mio.total).toBeGreaterThanOrEqual(1);
    expect(mio.total + ajeno.total).toBeLessThanOrEqual(todo.total);
    expect(todo.total).toBeGreaterThanOrEqual(mio.total + ajeno.total + 1);
  });

  it('con un campus sin tickets da cero y no explota', async () => {
    const r = await model.tiempos({ projectIds: [987654] });
    expect(r.total).toBe(0);
    expect(r.medianaRespuestaSeg).toBeNull();
  });
});

describe('el adjunto sabe de que proyecto es su ticket', () => {
  it('adjuntoPorId trae el proyecto del ticket, que es lo que decide el acceso', async () => {
    const { rows } = await pool.query(
      `INSERT INTO ticket_adjuntos (ticket_id, nombre, clave) VALUES ($1, 'a.png', 'tickets/x/a.png') RETURNING id`,
      [ids.delAjeno]);
    const a = await model.adjuntoPorId(rows[0].id);
    expect(a.ticket_project_id).toBe(CAMPUS_AJENO);
    expect(a.abierto_por).toBe(autorB);
  });
});
