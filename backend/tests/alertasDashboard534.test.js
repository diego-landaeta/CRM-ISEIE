import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { findAll, getStats, getTodaySummary } from '../src/modules/leads/lead.model.js';
import { listLeadsSchema } from '../src/modules/leads/lead.validation.js';

/**
 * Gemela de CRM#884 (#534 del 360, parte 5; aquí, #367) · El Dashboard como
 * «Hoy»: las dos alertas.
 *
 * «Sin gestora» y «Sin actividad» son botones que llevan a Prospectos con
 * `?qf=sin-gestora` / `?qf=sin-actividad`. La cifra de la tarjeta y la lista a
 * la que lleva tienen que dar lo mismo: salen de la misma condición
 * (`SIN_GESTORA`, `SIN_ACTIVIDAD`). Además, «sin actividad» ya no cuenta los
 * prospectos borrados, y `/leads/today` da los nuevos del mes.
 */

const MARCA = `A534_${Date.now().toString(36)}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const uno = (sql, params) => q(sql, params).then((r) => r[0]);
let proyecto;
let gestora;

async function lead(n, { responsable = null, status = 'nuevo', diasQuieto = 0, borrado = false, hace = 0 } = {}) {
  // Quieto: sin interacciones y sin cambios desde hace `diasQuieto` días. Las
  // fechas van en el INSERT y no en un UPDATE después: en ISEIE el disparador
  // `set_updated_at` (migración 001) pone `updated_at = NOW()` en cada UPDATE.
  const l = await uno(
    `INSERT INTO leads (project_id, nombre, email, responsable_id, status, custom_fields, fecha_solicitud,
                        created_at, updated_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5, '{}', NOW() - make_interval(days => $6::int),
             NOW() - make_interval(days => $7::int), NOW() - make_interval(days => $7::int),
             CASE WHEN $8::boolean THEN NOW() END)
     RETURNING id`,
    [proyecto.id, `${MARCA} ${n}`, `${n}@${MARCA.toLowerCase()}.test`, responsable, status, hace, diasQuieto, borrado]
  );
  return l.id;
}

const ids = (r) => r.leads.map((x) => x.id).sort((a, b) => a - b);

beforeAll(async () => {
  proyecto = await uno(
    `INSERT INTO projects (nombre, slug, webhook_api_key, dias_alerta_inactividad) VALUES ($1, $2, $3, 5) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), MARCA]
  );
  gestora = await uno(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [MARCA, `g@${MARCA.toLowerCase()}.test`]
  );
});

afterAll(async () => {
  if (proyecto) {
    await q('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  if (gestora) await q('DELETE FROM users WHERE id = $1', [gestora.id]);
  await pool.end();
});

describe('gemela de CRM#884 · las alertas del Dashboard cuadran con la lista a la que llevan', () => {
  it('«Sin gestora»: la cifra de stats y la lista ?qf=sin-gestora', async () => {
    const a = await lead('sg1');
    const b = await lead('sg2', { status: 'contactado' });
    await lead('sg-convertido', { status: 'convertido' });        // cerrado: no cuenta
    await lead('sg-no-interesado', { status: 'no_interesado' });  // cerrado: no cuenta
    await lead('sg-borrado', { borrado: true });                  // borrado: no cuenta
    await lead('con-gestora', { responsable: gestora.id });

    const stats = await getStats(proyecto.id);
    const lista = await findAll({ projectId: proyecto.id, qf: 'sin-gestora', page: 1, limit: 50 });
    expect(Number(stats.sin_asignar)).toBe(2);
    expect(lista.total).toBe(2);
    expect(ids(lista)).toEqual([a, b].sort((x, y) => x - y));
  });

  it('«Sin actividad»: la cifra de /leads/today y la lista ?qf=sin-actividad', async () => {
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    const quieto = await lead('quieto', { responsable: gestora.id, diasQuieto: 10 });
    await lead('reciente', { responsable: gestora.id, diasQuieto: 2 });                  // dentro de los 5 días
    await lead('quieto-cerrado', { responsable: gestora.id, diasQuieto: 10, status: 'convertido' });
    await lead('quieto-borrado', { responsable: gestora.id, diasQuieto: 10, borrado: true }); // antes contaba
    const conNota = await lead('quieto-con-nota', { responsable: gestora.id, diasQuieto: 10 });
    await q(`INSERT INTO lead_interactions (lead_id, tipo, nota, fecha) VALUES ($1, 'nota', 'ayer', NOW() - INTERVAL '1 day')`, [conNota]);

    const hoy = await getTodaySummary({ userId: 0, role: 'superadmin', projectId: proyecto.id });
    const lista = await findAll({ projectId: proyecto.id, qf: 'sin-actividad', page: 1, limit: 50 });
    expect(hoy.inactivos).toBe(1);
    expect(lista.total).toBe(1);
    expect(ids(lista)).toEqual([quieto]);
  });

  it('/leads/today da los nuevos del mes, sin borrados', async () => {
    await q('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await lead('hoy');
    await lead('borrado-hoy', { borrado: true });
    await lead('del-mes-pasado', { hace: 40 });
    const hoy = await getTodaySummary({ userId: 0, role: 'superadmin', projectId: proyecto.id });
    expect(hoy.nuevos_mes).toBe(1);
    expect(hoy.nuevos_hoy).toBeGreaterThanOrEqual(1);
  });
});

describe('el filtro rápido del servidor solo acepta lo que conoce', () => {
  it('sin-gestora y sin-actividad pasan; cualquier otra cosa da error', () => {
    for (const qf of ['sin-gestora', 'sin-actividad']) {
      expect(listLeadsSchema.safeParse({ projectId: '1', qf }).success, qf).toBe(true);
    }
    expect(listLeadsSchema.safeParse({ projectId: '1', qf: "x' OR 1=1 --" }).success).toBe(false);
  });
});
