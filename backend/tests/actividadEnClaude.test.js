import {
  describe, it, expect, beforeAll, afterAll,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { construirAmbito } from '../src/modules/mcp/mcp.acceso.js';
import { HERRAMIENTAS } from '../src/modules/mcp/mcp.tools.js';
import { ayerEnMadrid, hoyEnMadrid } from '../src/modules/mcp/mcp.model.js';

/**
 * #203, parte A (ficha de Diego del 07/10): la actividad por comercial en
 * Claude, contra la base de verdad. Las pruebas que pide la ficha:
 *
 *   - un contacto hecho por una gestora en una ficha de otra cuenta para
 *     quien lo hizo;
 *   - una nota no cuenta;
 *   - un contacto a las 00:30 de Madrid cuenta en ese día, no en el anterior.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/actividadEnClaude.test.js
 */

const marca = `act${Date.now().toString(36)}`;
const ids = { usuarios: [], prospectos: [], proyectos: [], conversaciones: [] };
const C = {}; // campus
const U = {}; // comerciales
const L = {}; // prospectos

const uno = async (sql, p) => (await query(sql, p)).rows[0];
const herramienta = HERRAMIENTAS.find((h) => h.nombre === 'actividad_por_comercial');
const campusDe = (...claves) => claves.map((k) => ({ id: C[k], nombre: `${k} ${marca}`, sociedad_id: null }));
const admin = (...claves) => construirAmbito({ id: 999995, nombre: 'Admin de prueba', role: 'admin', active: true }, campusDe(...claves));
const comoGestora = (clave, ...campus) => construirAmbito({ id: U[clave], nombre: `${clave} ${marca}`, role: 'gestor', active: true }, campusDe(...campus));
const fila = (r, clave) => r.filas.find((f) => f.comercial === `${clave} ${marca}`);
const DIA = { desde: '2026-09-30', hasta: '2026-09-30' };

async function campus(clave) {
  const p = await uno(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${clave} ${marca}`, `${clave.toLowerCase()}-${marca}`, `${clave}-${marca}-key`]);
  ids.proyectos.push(p.id);
  C[clave] = p.id;
}

async function comercial(clave) {
  const u = await uno(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${clave} ${marca}`, `${clave.toLowerCase()}@${marca}.test`]);
  ids.usuarios.push(u.id);
  U[clave] = u.id;
}

async function prospecto(clave, campusClave, duena, { borrado = false } = {}) {
  const l = await uno(
    `INSERT INTO leads (project_id, nombre, email, responsable_id, deleted_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [C[campusClave], `${clave} ${marca}`, `${clave.toLowerCase()}@lead.${marca}.test`, U[duena], borrado ? new Date() : null]
  );
  ids.prospectos.push(l.id);
  L[clave] = l.id;
}

/** Un contacto a una hora de Madrid («2026-09-30 00:30»). */
const contacto = (quien, prospectoClave, tipo, horaDeMadrid) => query(
  `INSERT INTO lead_interactions (lead_id, tipo, nota, created_by, fecha)
   VALUES ($1, $2, 'prueba', $3, ($4::timestamp AT TIME ZONE 'Europe/Madrid'))`,
  [L[prospectoClave], tipo, U[quien], horaDeMadrid]
);

/** Un mensaje de WhatsApp a una hora de Madrid. */
const mensaje = (conversacionId, direccion, tipo, quien, horaDeMadrid) => query(
  `INSERT INTO wa_mensajes (conversacion_id, direccion, tipo, texto, enviado_por, ts)
   VALUES ($1, $2, $3, 'prueba', $4, ($5::timestamp AT TIME ZONE 'Europe/Madrid'))`,
  [conversacionId, direccion, tipo, quien ? U[quien] : null, horaDeMadrid]
);

/**
 *   Campus A: prospectos de Dayana (DAYANA_1, DAYANA_2) y uno borrado.
 *   Campus B: un prospecto de Ana.
 *
 *   30/09 (Madrid):
 *     Ana     llama a DAYANA_1 (ficha de Dayana) y le escribe un WhatsApp;
 *             apunta una nota en DAYANA_2; llama a su prospecto de B;
 *             llama al prospecto borrado.
 *     Dayana  WhatsApp a DAYANA_1 a las 00:30 y correo a DAYANA_2.
 *   29/09 a las 23:59 (Madrid): Dayana llama a DAYANA_2 (es del 29, no del 30).
 */
beforeAll(async () => {
  await campus('A');
  await campus('B');
  await comercial('ANA');
  await comercial('DAYANA');
  await prospecto('DAYANA_1', 'A', 'DAYANA');
  await prospecto('DAYANA_2', 'A', 'DAYANA');
  await prospecto('BORRADO', 'A', 'DAYANA', { borrado: true });
  await prospecto('ANA_B', 'B', 'ANA');

  await contacto('ANA', 'DAYANA_1', 'llamada', '2026-09-30 10:00');
  await contacto('ANA', 'DAYANA_1', 'whatsapp', '2026-09-30 10:05');
  await contacto('ANA', 'DAYANA_2', 'nota', '2026-09-30 11:00');
  await contacto('ANA', 'ANA_B', 'llamada', '2026-09-30 12:00');
  await contacto('ANA', 'BORRADO', 'llamada', '2026-09-30 13:00');
  await contacto('DAYANA', 'DAYANA_1', 'whatsapp', '2026-09-30 00:30');
  await contacto('DAYANA', 'DAYANA_2', 'email', '2026-09-30 18:00');
  await contacto('DAYANA', 'DAYANA_2', 'llamada', '2026-09-29 23:59');

  // WhatsApp que salieron (#128): Ana manda a DAYANA_1 dos escritos y una nota
  // de voz; el prospecto le contesta con un audio (entrante: no cuenta); Ana
  // manda un sticker (ni escrito ni voz). Un mensaje viejo sin autora.
  const conv = await uno(
    `INSERT INTO wa_conversaciones (instancia, jid, telefono, lead_id, project_id)
     VALUES ($1, $2, '+34600000001', $3, $4) RETURNING id`,
    [`inst-${marca}`, `34600000001-${marca}@s.whatsapp.net`, L.DAYANA_1, C.A]
  );
  ids.conversaciones.push(conv.id);
  await mensaje(conv.id, 'saliente', 'texto', 'ANA', '2026-09-30 10:01');
  await mensaje(conv.id, 'saliente', 'texto', 'ANA', '2026-09-30 10:02');
  await mensaje(conv.id, 'saliente', 'audio', 'ANA', '2026-09-30 10:03');
  await mensaje(conv.id, 'entrante', 'audio', null, '2026-09-30 10:04');
  await mensaje(conv.id, 'saliente', 'sticker', 'ANA', '2026-09-30 10:05');
  await mensaje(conv.id, 'saliente', 'texto', null, '2026-09-30 10:06');
  await mensaje(conv.id, 'saliente', 'audio', 'DAYANA', '2026-09-30 00:30');
}, 60000);

afterAll(async () => {
  await query('DELETE FROM wa_conversaciones WHERE id = ANY($1::int[])', [ids.conversaciones]); // y sus mensajes
  await query('DELETE FROM leads WHERE id = ANY($1::int[])', [ids.prospectos]); // y sus contactos
  await query('DELETE FROM users WHERE id = ANY($1::int[])', [ids.usuarios]);
  await query('DELETE FROM projects WHERE id = ANY($1::int[])', [ids.proyectos]);
}, 60000);

describe('actividad_por_comercial', () => {
  it('un contacto en la ficha de otra cuenta para quien lo hizo', async () => {
    const r = await herramienta.ejecutar(admin('A'), DIA);
    // La llamada y el WhatsApp de Ana van en una ficha de Dayana: son de Ana.
    expect(fila(r, 'ANA')).toMatchObject({ llamadas: 1, whatsapp: 1, correos: 0, personas: 1, toques: 2 });
    expect(fila(r, 'DAYANA')).toMatchObject({ llamadas: 0, whatsapp: 1, correos: 1, personas: 2, toques: 2 });
  });

  it('una nota no cuenta como contacto: va aparte', async () => {
    const r = await herramienta.ejecutar(admin('A'), DIA);
    expect(fila(r, 'ANA').notas).toBe(1);
    // Ni en los toques ni en las personas (la nota es en DAYANA_2, que Ana no contactó).
    expect(fila(r, 'ANA')).toMatchObject({ toques: 2, personas: 1 });
  });

  it('un contacto a las 00:30 de Madrid cuenta en ese día, no en el anterior', async () => {
    const dia30 = await herramienta.ejecutar(admin('A'), DIA);
    expect(fila(dia30, 'DAYANA').whatsapp).toBe(1);
    const dia29 = await herramienta.ejecutar(admin('A'), { desde: '2026-09-29', hasta: '2026-09-29' });
    // El 29 solo está la llamada de las 23:59; el WhatsApp de las 00:30 no.
    expect(fila(dia29, 'DAYANA')).toMatchObject({ llamadas: 1, whatsapp: 0 });
  });

  it('el equipo suma las filas, salvo las personas (dos pueden tocar a la misma)', async () => {
    const r = await herramienta.ejecutar(admin('A'), DIA);
    expect(r.equipo).toMatchObject({ llamadas: 1, whatsapp: 2, correos: 1, notas: 1, toques: 4 });
    // Ana tocó a 1 y Dayana a 2, pero DAYANA_1 es la misma persona: 2, no 3.
    expect(r.equipo.personas).toBe(2);
  });

  it('ordenadas por llamadas y después por toques', async () => {
    const r = await herramienta.ejecutar(admin('A'), DIA);
    expect(r.filas.map((f) => f.comercial)).toEqual([`ANA ${marca}`, `DAYANA ${marca}`, 'Sin asignar']);
  });

  it('solo los campus pedidos y sin fichas borradas', async () => {
    const soloA = await herramienta.ejecutar(admin('A', 'B'), { ...DIA, proyecto_id: C.A });
    expect(fila(soloA, 'ANA').llamadas).toBe(1); // ni la de B ni la del prospecto borrado
    const conB = await herramienta.ejecutar(admin('A', 'B'), DIA);
    expect(fila(conB, 'ANA').llamadas).toBe(2); // la de B sí; la del borrado, no
  });

  it('una gestora solo se ve a sí misma, también en fichas de otra', async () => {
    const r = await herramienta.ejecutar(comoGestora('ANA', 'A'), DIA);
    expect(r.filas.map((f) => f.comercial)).toEqual([`ANA ${marca}`]);
    expect(r.equipo.toques).toBe(2);
  });

  it('solo «desde»: hasta hoy en Madrid; solo «hasta»: ese día', async () => {
    const desde = await herramienta.ejecutar(admin('A'), { desde: '2026-09-29' });
    expect(desde).toMatchObject({ desde: '2026-09-29', hasta: hoyEnMadrid() });
    // Del 29 en adelante: la llamada de Dayana del 29 y todo lo del 30.
    expect(fila(desde, 'DAYANA')).toMatchObject({ llamadas: 1, whatsapp: 1, correos: 1 });
    const hasta = await herramienta.ejecutar(admin('A'), { hasta: '2026-09-29' });
    expect(hasta).toMatchObject({ desde: '2026-09-29', hasta: '2026-09-29' });
    expect(fila(hasta, 'DAYANA')).toMatchObject({ llamadas: 1, whatsapp: 0 });
  });

  it('sin fechas, el día de ayer en Madrid', async () => {
    const r = await herramienta.ejecutar(admin('A'), {});
    expect(r).toMatchObject({ desde: ayerEnMadrid(), hasta: ayerEnMadrid() });
    // A las 23:30 UTC del 30/09 ya es 01/10 en Madrid: «ayer» es el 30.
    expect(ayerEnMadrid(new Date('2026-09-30T23:30:00Z'))).toBe('2026-09-30');
    expect(hoyEnMadrid(new Date('2026-09-30T23:30:00Z'))).toBe('2026-10-01');
  });

  it('el WhatsApp que salió, escrito y por voz, para quien lo mandó (#128)', async () => {
    const r = await herramienta.ejecutar(admin('A'), DIA);
    // Ni el audio que entró ni el sticker: 2 escritos y 1 de voz.
    expect(fila(r, 'ANA')).toMatchObject({ whatsapp_texto: 2, whatsapp_voz: 1 });
    // La nota de voz de Dayana de las 00:30 es del 30.
    expect(fila(r, 'DAYANA')).toMatchObject({ whatsapp_texto: 0, whatsapp_voz: 1 });
    // Lo que no tiene autora no se pierde: «Sin asignar», y el total cuadra.
    expect(r.filas.find((f) => f.comercial === 'Sin asignar')).toMatchObject({ whatsapp_texto: 1, whatsapp_voz: 0, toques: 0 });
    expect(r.equipo).toMatchObject({ whatsapp_texto: 3, whatsapp_voz: 2 });
  });

  it('a una gestora, solo sus mensajes: ni los de otra ni los sin autora', async () => {
    const r = await herramienta.ejecutar(comoGestora('ANA', 'A'), DIA);
    expect(r.filas.map((f) => f.comercial)).toEqual([`ANA ${marca}`]);
    expect(r.equipo).toMatchObject({ whatsapp_texto: 2, whatsapp_voz: 1 });
  });

  it('un periodo al revés se rechaza', async () => {
    const e = await herramienta.ejecutar(admin('A'), { desde: '2026-09-30', hasta: '2026-09-01' }).catch((x) => x);
    expect(e.code).toBe('MCP_PERIODO_AL_REVES');
  });
});
