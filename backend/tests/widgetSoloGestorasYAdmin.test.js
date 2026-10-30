import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pool from '../src/shared/config/db.js';
import { listCandidateUsers, listActiveWidgetUsers } from '../src/modules/widget/widget.model.js';

/**
 * Quien puede salir en el WhatsApp de la web: gestoras y admin, nadie mas (#238).
 *
 * Las dos consultas del widget filtraban por campus y por usuario activo, pero
 * no por rol. La lista del panel enseñaba a todos los tutores, soporte y
 * superadmin del campus (27 tutores en ISEIE), y la rotacion que ve el
 * visitante de la web tampoco los descartaba: marcar a un tutor por error le
 * mandaba los leads.
 *
 * Contra Postgres de verdad: lo que falla aqui es el WHERE.
 */

const PROYECTO = 1;
// SIN superadmin, a proposito: otras pruebas de la suite (Certifex) comparan «los
// superadmin activos» con quienes recibieron un aviso, y uno que aparece y
// desaparece mientras tanto las desajusta (rompio el CI de otra rama). Con el
// tutor y el soporte ya se prueba el mecanismo del filtro, que es `role IN
// ('gestor', 'admin')`; un superadmin queda fuera por lo mismo.
const ROLES = ['gestor', 'admin', 'soporte', 'tutor'];
const ids = {};

beforeAll(async () => {
  for (const role of ROLES) {
    const { rows } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, role, active,
                          whatsapp_phone, whatsapp_widget_active)
       VALUES ($1, $2, 'x', $3, TRUE, '34600000000', TRUE)
       RETURNING id`,
      [`Widget Rol ${role}`, `widget-rol-${role}@test-widget.com`, role]);
    ids[role] = rows[0].id;
    await pool.query(
      `INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, TRUE)`,
      [ids[role], PROYECTO]);
  }
});

afterAll(async () => {
  const todos = Object.values(ids);
  await pool.query('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [todos]);
  await pool.query('DELETE FROM users WHERE id = ANY($1::int[])', [todos]);
  await pool.end();
});

describe('la lista de candidatos del panel', () => {
  it('enseña gestoras y admin', async () => {
    const lista = (await listCandidateUsers(PROYECTO)).map((u) => u.id);
    expect(lista).toContain(ids.gestor);
    expect(lista).toContain(ids.admin);
  });

  it('no enseña tutores ni soporte', async () => {
    const lista = (await listCandidateUsers(PROYECTO)).map((u) => u.id);
    expect(lista).not.toContain(ids.tutor);
    expect(lista).not.toContain(ids.soporte);
  });
});

describe('la rotacion publica del widget', () => {
  it('incluye a la gestora y al admin marcados', async () => {
    const rotacion = (await listActiveWidgetUsers(PROYECTO)).map((u) => u.id);
    expect(rotacion).toContain(ids.gestor);
    expect(rotacion).toContain(ids.admin);
  });

  it('no incluye a un tutor o soporte aunque esten marcados a mano', async () => {
    // Los dos tienen `whatsapp_widget_active = TRUE` y telefono: es justo el
    // caso de quien los marco por error en la base.
    const rotacion = (await listActiveWidgetUsers(PROYECTO)).map((u) => u.id);
    expect(rotacion).not.toContain(ids.tutor);
    expect(rotacion).not.toContain(ids.soporte);
  });
});
