import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { actividadComercial, actividadComercialDetalle } from '../src/modules/reports/report.controller.js';

/**
 * #203, parte B (comentario de Diego del 27/10): la actividad por comercial en
 * Reportes y en el Dashboard, con la misma consulta que Claude. Las pruebas que
 * pide:
 *
 *   - una llamada de Ana a un lead de Dayana cuenta para Ana;
 *   - la suma de las filas da el total del equipo;
 *   - una gestora no ve las filas de las demás, ni en la pantalla ni en la API.
 *
 * Y la lista que se abre al pulsar un número: lead, hora y nota.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/actividadEnReportes.test.js
 */

const marca = `actr${Date.now().toString(36)}`;
const ids = { usuarios: [], prospectos: [], proyectos: [] };
const C = {}; // campus
const U = {}; // personas
const L = {}; // prospectos
const DIA = { desde: '2026-09-30', hasta: '2026-09-30' };

const uno = async (sql, p) => (await query(sql, p)).rows[0];
const fila = (r, clave) => r.filas.find((f) => f.comercial === `${clave} ${marca}`);

async function campus(clave, esPrueba = false) {
  const p = await uno(`INSERT INTO projects (nombre, slug, webhook_api_key, es_prueba) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${clave} ${marca}`, `${clave.toLowerCase()}-${marca}`, `${clave}-${marca}-key`, esPrueba]);
  ids.proyectos.push(p.id);
  C[clave] = p.id;
}

async function persona(clave, role, ...campusClaves) {
  const u = await uno(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
    [`${clave} ${marca}`, `${clave.toLowerCase()}@${marca}.test`, role]);
  ids.usuarios.push(u.id);
  U[clave] = u.id;
  for (const k of campusClaves) {
    await query('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [u.id, C[k]]);
  }
}

async function prospecto(clave, campusClave, duena) {
  const l = await uno(
    `INSERT INTO leads (project_id, nombre, email, responsable_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [C[campusClave], `${clave} ${marca}`, `${clave.toLowerCase()}@lead.${marca}.test`, U[duena]]
  );
  ids.prospectos.push(l.id);
  L[clave] = l.id;
}

const contacto = (quien, prospectoClave, tipo, horaDeMadrid, nota = 'prueba') => query(
  `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
   VALUES ($1, $2, $3, $4, ($5::timestamp AT TIME ZONE 'Europe/Madrid'))`,
  [L[prospectoClave], tipo, nota, U[quien], horaDeMadrid]
);

/** Llama al controlador como lo haría la pantalla y devuelve `data` o el error. */
async function pedir(fn, quien, consulta) {
  const req = { user: { userId: U[quien], role: quien === 'ADMIN' ? 'admin' : 'gestor' }, query: consulta };
  let data;
  let error;
  await fn(req, { json: (b) => { data = b.data; } }, (e) => { error = e; });
  if (error) throw error;
  return data;
}

/**
 *   Campus A: prospectos de Dayana (DAYANA_1, DAYANA_2). Campus B: uno de Ana.
 *   La admin está en A y B; Ana y Dayana, en A (Ana también en B).
 *
 *   30/09 (Madrid):
 *     Ana     llama a DAYANA_1 (ficha de Dayana) con nota «le interesa»,
 *             le escribe un WhatsApp y llama a su prospecto de B.
 *     Dayana  correo a DAYANA_2 y una nota interna.
 *
 *   Campus PRUEBA (de pruebas, migración 148), de la admin: una llamada de Ana
 *   que solo se ve si se elige ese campus.
 */
beforeAll(async () => {
  await campus('A');
  await campus('B');
  await campus('OTRO');
  await campus('PRUEBA', true);
  await persona('ADMIN', 'admin', 'A', 'B', 'PRUEBA');
  await persona('ANA', 'gestor', 'A', 'B');
  await persona('DAYANA', 'gestor', 'A');
  await prospecto('DAYANA_1', 'A', 'DAYANA');
  await prospecto('DAYANA_2', 'A', 'DAYANA');
  await prospecto('ANA_B', 'B', 'ANA');
  await prospecto('DE_PRUEBA', 'PRUEBA', 'ANA');

  await contacto('ANA', 'DAYANA_1', 'llamada', '2026-09-30 10:00', 'le interesa');
  await contacto('ANA', 'DAYANA_1', 'whatsapp', '2026-09-30 10:05');
  await contacto('ANA', 'ANA_B', 'llamada', '2026-09-30 12:00');
  await contacto('DAYANA', 'DAYANA_2', 'email', '2026-09-30 18:00');
  await contacto('DAYANA', 'DAYANA_2', 'nota', '2026-09-30 18:30');
  await contacto('ANA', 'DE_PRUEBA', 'llamada', '2026-09-30 16:00');
}, 60000);

afterAll(async () => {
  await query('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.prospectos]); // y sus contactos
  await query('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [ids.usuarios]);
  await query('DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]);
  await query('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.proyectos]);
}, 60000);

describe('actividad por comercial en Reportes (#203, parte B)', () => {
  it('una llamada de Ana a un lead de Dayana cuenta para Ana', async () => {
    const r = await pedir(actividadComercial, 'ADMIN', { ...DIA, projectId: String(C.A) });
    expect(fila(r, 'ANA')).toMatchObject({ user_id: U.ANA, llamadas: 1, whatsapp: 1, toques: 2 });
    expect(fila(r, 'DAYANA')).toMatchObject({ llamadas: 0, correos: 1, toques: 1 });
  });

  it('la suma de las filas da el total del equipo', async () => {
    const r = await pedir(actividadComercial, 'ADMIN', DIA);
    for (const k of ['llamadas', 'whatsapp', 'correos', 'notas', 'toques']) {
      expect(r.filas.reduce((s, f) => s + f[k], 0)).toBe(r.equipo[k]);
    }
    // «Todos» = sus campus A y B: la llamada de Ana en B también cuenta.
    expect(r.equipo).toMatchObject({ llamadas: 2, toques: 4 });
  });

  it('una gestora solo ve su fila, aunque pida la de otra o un campus que no es suyo', async () => {
    const r = await pedir(actividadComercial, 'DAYANA', DIA);
    expect(r.filas.map((f) => f.comercial)).toEqual([`DAYANA ${marca}`]);
    const fuera = await pedir(actividadComercial, 'DAYANA', { ...DIA, projectId: String(C.B) }).catch((e) => e);
    expect(fuera.statusCode).toBe(403);
  });

  it('un admin no ve un campus que no es suyo', async () => {
    const e = await pedir(actividadComercial, 'ADMIN', { ...DIA, projectId: String(C.OTRO) }).catch((x) => x);
    expect(e.statusCode).toBe(403);
  });

  it('sin fechas, ayer; un periodo al revés se rechaza', async () => {
    const r = await pedir(actividadComercial, 'ADMIN', {});
    expect(r.desde).toBe(r.hasta);
    const e = await pedir(actividadComercial, 'ADMIN', { desde: '2026-09-30', hasta: '2026-09-01' }).catch((x) => x);
    expect(e.code).toBe('PERIODO_AL_REVES');
  });

  it('una fecha que no existe se rechaza (no llega a la base)', async () => {
    const e = await pedir(actividadComercial, 'ADMIN', { desde: '2026-02-30' }).catch((x) => x);
    expect(e).toMatchObject({ statusCode: 400, code: 'FECHA_NO_VALIDA' });
  });

  it('el campus de pruebas se ve si se elige, y con «Todos» no (migración 148)', async () => {
    const elegido = await pedir(actividadComercial, 'ADMIN', { ...DIA, projectId: String(C.PRUEBA) });
    expect(fila(elegido, 'ANA')).toMatchObject({ llamadas: 1 });
    // «Todos»: la llamada en PRUEBA no suma (la prueba de la suma ya espera 2).
    const todos = await pedir(actividadComercial, 'ADMIN', DIA);
    expect(todos.equipo.llamadas).toBe(2);
  });
});

describe('la lista detrás de un número', () => {
  it('las llamadas de Ana: lead, hora y nota, también en la ficha de Dayana', async () => {
    const lista = await pedir(actividadComercialDetalle, 'ADMIN', { ...DIA, userId: String(U.ANA), tipo: 'llamada' });
    expect(lista.map((c) => c.lead)).toEqual([`ANA_B ${marca}`, `DAYANA_1 ${marca}`]);
    expect(lista[1]).toMatchObject({ tipo: 'llamada', nota: 'le interesa' });
    expect(lista[1].fecha).toBeInstanceOf(Date);
  });

  it('cuadra con la cifra de la tabla, y «toques» no lleva las notas', async () => {
    const r = await pedir(actividadComercial, 'ADMIN', DIA);
    const toques = await pedir(actividadComercialDetalle, 'ADMIN', { ...DIA, userId: String(U.DAYANA), tipo: 'toques' });
    expect(toques).toHaveLength(fila(r, 'DAYANA').toques);
    expect(toques.map((c) => c.tipo)).toEqual(['email']);
  });

  it('una gestora que pide la lista de otra recibe la suya', async () => {
    const lista = await pedir(actividadComercialDetalle, 'DAYANA', { ...DIA, userId: String(U.ANA), tipo: 'llamada' });
    expect(lista).toEqual([]);
    const suya = await pedir(actividadComercialDetalle, 'DAYANA', { ...DIA, userId: String(U.ANA), tipo: 'email' });
    expect(suya.map((c) => c.lead)).toEqual([`DAYANA_2 ${marca}`]);
  });

  it('un tipo que no existe se rechaza', async () => {
    const e = await pedir(actividadComercialDetalle, 'ADMIN', { ...DIA, userId: String(U.ANA), tipo: 'sms' }).catch((x) => x);
    expect(e.code).toBe('TIPO_NO_VALIDO');
  });
});
