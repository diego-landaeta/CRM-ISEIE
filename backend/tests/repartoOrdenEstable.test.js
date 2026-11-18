import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { createLeadWithRoundRobin, reassignPendingRoundRobin } from '../src/modules/leads/lead.model.js';

/**
 * La rueda del CRM con gestoras EMPATADAS en `orden_cola`, contra la base.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE (revision del reparto, 18/11/2026)
 *
 * En ISEIE cuatro gestoras tienen `orden_cola = 0`. El alta de leads y la
 * reasignacion de pendientes ordenaban la lista con `ORDER BY up.orden_cola` a
 * secas, y con el empate Postgres no promete el mismo orden entre dos
 * consultas. La rueda guarda una POSICION (`last_assigned_index`), no una
 * persona: si el orden cambia, la misma posicion apunta a otra, y una recibe
 * dos seguidos y otra ninguno, sin error ni rastro.
 *
 * `reparto.js` ya desempataba por id (lo usan la asignacion por actividad y la
 * pantalla de «a quien le toca»), pero la rueda tenia su propia copia. Ahora
 * la rueda usa esa misma lista.
 *
 * Las relaciones con el campus se dan de alta AL REVES del id a proposito: sin
 * desempate, el orden sale del plan de la consulta (casi siempre, el orden en
 * que se escribieron las filas), no del id.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const marca = `t${Date.now()}`;
let projectId = null;
const ids = [];
let hayBase = true;
let porQueNo = null;

beforeAll(async () => {
  try {
    const { rows } = await query(
      `INSERT INTO projects (nombre, slug, webhook_api_key, active)
       VALUES ($1, $2, $3, true) RETURNING id`,
      [`Rueda ${marca}`, `rueda-${marca}`, `k-${marca}`]
    );
    projectId = rows[0].id;
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
    return;
  }
  for (const n of [1, 2, 3]) {
    const { rows } = await query(
      `INSERT INTO users (nombre, email, password_hash, role, active, is_available)
       VALUES ($1, $2, 'x', 'gestor', true, true) RETURNING id`,
      [`Gestora${n} ${marca}`, `g${n}.${marca}@test.local`]
    );
    ids.push(rows[0].id);
  }
  // Al reves del id, y las tres con el mismo orden_cola.
  for (const id of [...ids].reverse()) {
    await query(
      `INSERT INTO user_projects (user_id, project_id, active, orden_cola, recibe_leads)
       VALUES ($1, $2, true, 0, false)`,
      [id, projectId]
    );
  }
});

afterAll(async () => {
  if (!hayBase || !projectId) return;
  await query('DELETE FROM lead_utms WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [projectId]);
  await query('DELETE FROM leads WHERE project_id = $1', [projectId]);
  await query('DELETE FROM project_queue_state WHERE project_id = $1', [projectId]);
  await query('DELETE FROM user_projects WHERE project_id = $1', [projectId]);
  await query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
  await query('DELETE FROM projects WHERE id = $1', [projectId]);
});

async function alta(n) {
  const lead = await createLeadWithRoundRobin({
    projectId,
    nombre: `Lead ${n} ${marca}`,
    email: null,
    telefono: null,
    productoInteresId: null,
    notas: null,
    landingUrl: null,
    duplicadoDe: null,
    utms: null,
  });
  return lead.responsableId;
}

describe('la base tiene que estar', () => {
  it('se pudo crear el escenario, o esto no vale', () => {
    expect(hayBase && projectId, porQueNo ? `no se pudo montar el escenario: ${porQueNo}` : 'sin base no se comprueba nada').toBeTruthy();
  });
});

describe('la rueda con gestoras empatadas en orden_cola', () => {
  it('reparte en orden de id, una vuelta detras de otra', async () => {
    const quien = [];
    for (let n = 0; n < 6; n++) quien.push(await alta(n));
    expect(quien).toEqual([...ids, ...ids]);
  });

  it('la reasignacion de pendientes sigue la misma rueda que el alta', async () => {
    // La rueda acaba de dar dos vueltas: el siguiente es el primero por id.
    // Uno detras de otro (no en el mismo INSERT): la reasignacion los coge por
    // `created_at`, y en una sola sentencia los dos tendrian la misma hora.
    const rows = [];
    for (const n of ['A', 'B']) {
      const r = await query(
        `INSERT INTO leads (project_id, nombre, responsable_id) VALUES ($1, $2, NULL) RETURNING id`,
        [projectId, `Pendiente ${n} ${marca}`]
      );
      rows.push(r.rows[0]);
    }
    const r = await reassignPendingRoundRobin(projectId);
    expect(r.reassigned).toBe(2);
    const { rows: tras } = await query(
      'SELECT responsable_id FROM leads WHERE id = ANY($1::int[]) ORDER BY created_at, id',
      [rows.map((x) => x.id)]
    );
    expect(tras.map((x) => x.responsable_id)).toEqual([ids[0], ids[1]]);
    // Y el alta siguiente continua donde lo dejo la reasignacion.
    expect(await alta(99)).toBe(ids[2]);
  });
});
