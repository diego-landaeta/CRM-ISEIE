import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * «Qué ha pasado hoy» (#13), contra la base de verdad.
 *
 * Lo que se defiende:
 *   · altas de prospectos, ventas, cambios de estado y contactos, de más nuevo a
 *     más viejo, con su frase ya escrita;
 *   · paginado por cursor (`before` = el `fecha` del último evento);
 *   · por defecto, solo HOY; con `desde`, el rango que se pida;
 *   · cada una ve lo suyo —sus prospectos y lo que ella hizo— y quien manda, lo
 *     de sus campus; el recorte lo pone la sesión, no la URL;
 *   · no cuenta un prospecto borrado, una mensualidad, ni lo de otro proyecto.
 *
 *   npx vitest run tests/actividadReciente.test.js
 */

const { default: pool } = await import('../src/shared/config/db.js');
const { default: actividad } = await import('../src/modules/actividad/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const { inicioDeHoy, } = await import('../src/modules/actividad/actividad.controller.js');
const { frase } = await import('../src/modules/actividad/actividad.model.js');

const app = express();
app.use(express.json());
app.use(actividad.prefix, actividad.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `ACT${Date.now().toString(36)}`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
const ids = { leads: [], conversions: [], users: [], projects: [] };
let P; let OTRO; let ADMIN; let LAURA; let ANA;
const jwtDe = (u) => jwt.sign({ userId: u.id, role: u.role }, process.env.JWT_SECRET, { expiresIn: '10m' });
const DESDE = '2020-01-01';
const pide = (u, qs = '') => request.get(`/api/actividad?desde=${DESDE}${qs}`).set('Authorization', `Bearer ${jwtDe(u)}`);

async function persona(nombre, role) {
  const [u] = await q(
    `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id, role, nombre`,
    [`${MARCA} ${nombre}`, `${nombre.toLowerCase()}@${MARCA.toLowerCase()}.test`, role]
  );
  ids.users.push(u.id);
  await q(`INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)`, [u.id, P]);
  return u;
}

async function lead(nombre, { responsable = null, minutos, proyecto = P, borrado = false }) {
  const [l] = await q(
    `INSERT INTO leads (project_id, nombre, responsable_id, created_at, deleted_at)
     VALUES ($1, $2, $3, now() - ($4 || ' minutes')::interval, $5) RETURNING id`,
    [proyecto, `${MARCA} ${nombre}`, responsable, String(minutos), borrado ? new Date() : null]
  );
  ids.leads.push(l.id);
  return l.id;
}

beforeAll(async () => {
  const proy = async (clave) => {
    const [p] = await q(
      `INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
      [`${MARCA} ${clave}`, `${MARCA.toLowerCase()}-${clave}`, `${MARCA}-key-${clave}`]
    );
    ids.projects.push(p.id);
    return p.id;
  };
  P = await proy('a');
  OTRO = await proy('b');
  ADMIN = await persona('ADMIN', 'admin');
  LAURA = await persona('LAURA', 'gestor');
  ANA = await persona('ANA', 'gestor');

  // Hace 10 minutos: entra un prospecto de Laura; hace 8, ella lo llama; hace 6, lo pasa a contactado;
  // hace 4, le registra una venta de 900 €.
  const l1 = await lead('Marta', { responsable: LAURA.id, minutos: 10 });
  await q(`INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, created_at) VALUES ($1, 'llamada', 'x', $2, now() - interval '8 minutes')`, [l1, LAURA.id]);
  await q(`INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by, changed_at) VALUES ($1, 'por_contactar', 'contactado', $2, now() - interval '6 minutes')`, [l1, LAURA.id]);
  const [v] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion, created_at)
     VALUES ($1, $2, 'Máster', 900, 0, $3, CURRENT_DATE, now() - interval '4 minutes') RETURNING id`, [l1, P, LAURA.id]
  );
  ids.conversions.push(v.id);
  // Un prospecto de Ana, y Laura le cambia el estado (cuenta para Laura: lo hizo ella).
  const l2 = await lead('Pedro', { responsable: ANA.id, minutos: 9 });
  await q(`INSERT INTO lead_status_history (lead_id, status_anterior, status_nuevo, changed_by, changed_at) VALUES ($1, 'nuevo', 'en_seguimiento', $2, now() - interval '3 minutes')`, [l2, LAURA.id]);
  // Ana lo escribe por WhatsApp (no es de Laura ni lo hizo ella).
  await q(`INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, created_at) VALUES ($1, 'whatsapp', 'x', $2, now() - interval '2 minutes')`, [l2, ANA.id]);
  // No cuentan: borrado, de otro proyecto, una mensualidad, y uno de hace tres días.
  await lead('Borrado', { responsable: LAURA.id, minutos: 5, borrado: true });
  await lead('OtroProyecto', { responsable: LAURA.id, minutos: 5, proyecto: OTRO });
  const [m] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado, vendedora_id, fecha_conversion, es_mensualidad, created_at)
     VALUES ($1, $2, 'Cuota', 50, 50, $3, CURRENT_DATE, true, now() - interval '1 minute') RETURNING id`, [l1, P, LAURA.id]
  );
  ids.conversions.push(m.id);
  await lead('Antiguo', { responsable: LAURA.id, minutos: 60 * 24 * 3 });
}, 60000);

afterAll(async () => {
  const l = `(SELECT id FROM leads WHERE nombre LIKE '${MARCA}%')`;
  await q(`DELETE FROM lead_interactions WHERE lead_id IN ${l}`);
  await q(`DELETE FROM lead_status_history WHERE lead_id IN ${l}`);
  await q(`DELETE FROM conversion_payments WHERE conversion_id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM conversions WHERE id = ANY($1::int[])`, [ids.conversions]);
  await q(`DELETE FROM leads WHERE nombre LIKE '${MARCA}%'`);
  await q(`DELETE FROM user_projects WHERE user_id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM users WHERE id = ANY($1::int[])`, [ids.users]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids.projects]);
  await pool.end();
}, 60000);

const tipos = (r) => r.body.data.eventos.map((e) => e.tipo);

describe('quien manda ve todo lo de sus campus', () => {
  it('los cuatro tipos, de más nuevo a más viejo, con su frase', async () => {
    const r = await pide(ADMIN);
    expect(r.status).toBe(200);
    const e = r.body.data.eventos;
    expect(e.map((x) => x.tipo)).toEqual([
      'contacto',        // Ana por WhatsApp a Pedro (hace 2)
      'estado_cambiado', // Laura pasa a Pedro (hace 3)
      'venta_creada',    // la venta de 900 (hace 4)
      'estado_cambiado', // Laura pasa a Marta (hace 6)
      'contacto',        // Laura llama a Marta (hace 8)
      'lead_creado',     // Pedro (hace 9)
      'lead_creado',     // Marta (hace 10)
      'lead_creado',     // Antiguo (hace tres días: solo sale porque se pidió desde 2020)
    ]);
    expect(e.map((x) => x.texto)).toEqual([
      `${MARCA} ANA escribió por WhatsApp a ${MARCA} Pedro`,
      `${MARCA} LAURA pasó a ${MARCA} Pedro de «Nuevo» a «En seguimiento»`,
      expect.stringMatching(new RegExp(`^${MARCA} LAURA registró una venta a ${MARCA} Marta por 900\\s€$`)),
      `${MARCA} LAURA pasó a ${MARCA} Marta de «Por contactar» a «Contactado»`,
      `${MARCA} LAURA llamó a ${MARCA} Marta`,
      `Entró ${MARCA} Pedro, asignado a ${MARCA} ANA`,
      `Entró ${MARCA} Marta, asignado a ${MARCA} LAURA`,
      `Entró ${MARCA} Antiguo, asignado a ${MARCA} LAURA`,
    ]);
    expect(e[2]).toMatchObject({ importe: 900, detalle: 'Máster', proyecto: `${MARCA} a` });
  });

  it('no cuenta lo borrado, una mensualidad, ni lo de otro proyecto', async () => {
    const todo = (await pide(ADMIN)).body.data.eventos.map((e) => e.texto).join('\n');
    expect(todo).not.toContain('Borrado');
    expect(todo).not.toContain('OtroProyecto');
    expect(todo).not.toContain('Cuota');
    expect((await pide(ADMIN)).body.data.eventos.filter((e) => e.tipo === 'venta_creada')).toHaveLength(1);
  });
});

describe('cada gestora ve lo suyo', () => {
  it('Laura: sus prospectos y lo que ella hizo, aunque sea en un prospecto de otra', async () => {
    const e = (await pide(LAURA)).body.data.eventos;
    const textos = e.map((x) => x.texto);
    // Su prospecto, su llamada, su cambio, su venta, y el cambio que ella hizo en el de Ana.
    expect(textos).toContain(`Entró ${MARCA} Marta, asignado a ${MARCA} LAURA`);
    expect(textos).toContain(`${MARCA} LAURA llamó a ${MARCA} Marta`);
    expect(textos).toContain(`${MARCA} LAURA pasó a ${MARCA} Pedro de «Nuevo» a «En seguimiento»`);
    expect(e.some((x) => x.tipo === 'venta_creada')).toBe(true);
    // NO: el alta del prospecto de Ana ni su WhatsApp.
    expect(textos.join('\n')).not.toContain('Entró ' + MARCA + ' Pedro');
    expect(textos.join('\n')).not.toContain('ANA escribió');
  });

  it('Ana: lo suyo, y nada de lo de Laura', async () => {
    const textos = (await pide(ANA)).body.data.eventos.map((x) => x.texto).join('\n');
    expect(textos).toContain(`Entró ${MARCA} Pedro`);
    expect(textos).toContain('ANA escribió por WhatsApp');
    // Laura cambió el estado de un prospecto DE ANA: es actividad sobre su cartera.
    expect(textos).toContain('LAURA pasó a');
    expect(textos).not.toContain('Marta');
  });

  it('el recorte lo pone la sesión: pedir «asesoraId» de otra por la URL no sirve', async () => {
    const textos = (await pide(ANA, `&asesoraId=${LAURA.id}`)).body.data.eventos.map((x) => x.texto).join('\n');
    expect(textos).not.toContain('Marta');
  });

  it('un campus que no es suyo: 403', async () => {
    const r = await request.get(`/api/actividad?desde=${DESDE}&projectId=${OTRO}`).set('Authorization', `Bearer ${jwtDe(LAURA)}`);
    expect(r.status).toBe(403);
  });
});

describe('paginado por cursor', () => {
  it('limit parte la lista y `siguiente` es el cursor; la página dos sigue donde acabó la uno', async () => {
    const p1 = (await pide(ADMIN, '&limit=3')).body.data;
    expect(p1.eventos).toHaveLength(3);
    expect(p1.siguiente).toBe(p1.eventos[2].fecha);
    const p2 = (await pide(ADMIN, `&limit=3&before=${encodeURIComponent(p1.siguiente)}`)).body.data;
    expect(p2.eventos).toHaveLength(3);
    const p3 = (await pide(ADMIN, `&limit=3&before=${encodeURIComponent(p2.siguiente)}`)).body.data;
    expect(p3.eventos).toHaveLength(2);
    expect(p3.siguiente).toBeNull();
    const juntas = [...p1.eventos, ...p2.eventos, ...p3.eventos];
    expect(new Set(juntas.map((e) => `${e.tipo}-${e.fecha}-${e.lead_id}`)).size).toBe(8); // sin repetir ni perder
    expect(juntas.map((e) => e.fecha)).toEqual([...juntas.map((e) => e.fecha)].sort().reverse());
  });
});

describe('qué se pide', () => {
  it('por defecto, solo hoy: el prospecto de hace tres días no sale', async () => {
    const r = await request.get('/api/actividad').set('Authorization', `Bearer ${jwtDe(ADMIN)}`);
    expect(r.body.data.eventos.map((e) => e.texto).join('\n')).not.toContain('Antiguo');
    // …y con `desde` antiguo, sí.
    expect((await pide(ADMIN)).body.data.eventos.map((e) => e.texto).join('\n')).toContain('Antiguo');
  });

  it('`tipos` filtra', async () => {
    const r = await pide(ADMIN, '&tipos=venta_creada,lead_creado');
    expect([...new Set(tipos(r))].sort()).toEqual(['lead_creado', 'venta_creada']);
  });

  it('un tipo que no existe, una fecha mala o un límite fuera de rango: 400', async () => {
    expect((await pide(ADMIN, '&tipos=inventado')).status).toBe(400);
    expect((await pide(ADMIN, '&before=ayer')).status).toBe(400);
    expect((await pide(ADMIN, '&limit=0')).status).toBe(400);
    expect((await pide(ADMIN, '&limit=101')).status).toBe(400);
  });

  it('sin sesión: 401', async () => {
    expect((await request.get('/api/actividad')).status).toBe(401);
  });
});

describe('las piezas', () => {
  it('el inicio de hoy es la medianoche de Madrid, en horario de verano y de invierno', () => {
    expect(inicioDeHoy(new Date('2026-10-20T10:00:00Z'), 'Europe/Madrid')).toBe('2026-10-19T22:00:00.000Z');
    expect(inicioDeHoy(new Date('2026-12-20T10:00:00Z'), 'Europe/Madrid')).toBe('2026-12-19T23:00:00.000Z');
    // A las 23:30 UTC ya es mañana en Madrid.
    expect(inicioDeHoy(new Date('2026-10-20T23:30:00Z'), 'Europe/Madrid')).toBe('2026-10-20T22:00:00.000Z');
  });

  it('las frases', () => {
    expect(frase({ tipo: 'lead_creado', lead_nombre: 'Marta', persona: null })).toBe('Entró Marta, sin asignar');
    expect(frase({ tipo: 'estado_cambiado', lead_nombre: 'Marta', persona: null, detalle: 'nuevo → contactado' })).toBe('El sistema pasó a Marta de «Nuevo» a «Contactado»');
    expect(frase({ tipo: 'contacto', lead_nombre: 'Marta', persona: 'Laura', detalle: 'nota' })).toBe('Laura dejó una nota en la ficha de Marta');
  });
});
