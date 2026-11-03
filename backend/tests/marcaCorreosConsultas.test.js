import {
  describe, it, expect, beforeAll, afterAll, vi,
} from 'vitest';
import { query } from '../src/shared/config/db.js';
import { encrypt } from '../src/shared/utils/crypto.js';

/**
 * Los correos semanal y de carga, con la marca del campus (QA de Diego, 22/10,
 * punto 9), contra la base de verdad.
 *
 * «Los correos semanal y de carga van sin la marca del campus (norma: todo
 * correo con la plantilla y la marca del campus). Hoy no salen por el freno.»
 *
 *   · tutor de un solo campus: su logo, su nombre, su remitente (`projectId`);
 *   · tutor de varios: la marca del CRM, sin hacerlo pasar por uno de ellos
 *     (el criterio de «Tu semana» de las gestoras).
 *
 * El freno se quita SOLO aquí, y el envío es de mentira: no sale nada.
 */

vi.mock('../src/shared/config/frenoTutores.js', () => ({ NO_ESCRIBIR_A_TUTORES: false }));
const enviado = vi.hoisted(() => []);
vi.mock('../src/shared/services/brevo.service.js', async (original) => ({
  ...(await original()),
  sendEmail: vi.fn(async (c) => { enviado.push(c); return { sent: true }; }),
}));

const { recordarCargas } = await import('../src/modules/consultas/consultas.plazos.js');
const { enviarResumenes } = await import('../src/jobs/consultasResumenScheduler.js');

const marca = `t9qa${Date.now()}`;
const ids = { users: [], projects: [] };
let hayBase = true;
let porQueNo = null;
const g = {};

async function crearCampus(nombre) {
  const { rows } = await query(
    `INSERT INTO projects (nombre, slug, webhook_api_key, active, logo_url) VALUES ($1, $2, $3, true, $4) RETURNING id`,
    [`${nombre} ${marca}`, `${nombre.toLowerCase()}-${marca}`, `k-${marca}-${nombre}`, `https://logos.prueba.local/${nombre}-${marca}.png`]);
  const id = Number(rows[0].id);
  ids.projects.push(id);
  const enc = encrypt('token-de-prueba');
  await query(
    `INSERT INTO project_integrations (project_id, provider, active, encrypted_value, iv, auth_tag, config_public)
     VALUES ($1, 'moodle', true, $2, $3, $4, $5)`,
    [id, enc.encrypted, enc.iv, enc.authTag, JSON.stringify({ url: 'https://campus.prueba.local', consultas: true })]);
  return id;
}

async function crearTutor(campus) {
  const { rows } = await query(
    `INSERT INTO users (nombre, email, password_hash, role, active) VALUES ($1, $2, 'x', 'tutor', true) RETURNING id`,
    [`Tutor & ${marca}`, `tutor.${ids.users.length}.${marca}@test.local`]);
  const id = Number(rows[0].id);
  ids.users.push(id);
  for (const p of campus) await query(`INSERT INTO tutor_campus (tutor_id, project_id, estado) VALUES ($1, $2, 'activa')`, [id, p]);
  return id;
}

beforeAll(async () => {
  try {
    g.uno = await crearCampus('Psiko');
    g.dos = await crearCampus('Fono');
    g.deUno = await crearTutor([g.uno]);
    g.deDos = await crearTutor([g.uno, g.dos]);
  } catch (err) {
    hayBase = false;
    porQueNo = err.message;
  }
});

afterAll(async () => {
  for (const [sql, p] of [
    ['DELETE FROM tutor_carga_recordatorios WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM tutor_campus WHERE tutor_id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM project_integrations WHERE project_id = ANY($1::int[])', [ids.projects]],
    ['DELETE FROM users WHERE id = ANY($1::int[])', [ids.users]],
    ['DELETE FROM projects WHERE id = ANY($1::int[])', [ids.projects]],
  ]) {
    try { await query(sql, p); } catch { /* sigue limpiando */ }
  }
});

const correoA = (tutorId) => enviado.filter((c) => c.to === `tutor.${ids.users.indexOf(tutorId)}.${marca}@test.local`);

describe('hay base', () => {
  it('contra la que probar', () => { expect(hayBase, porQueNo || '').toBe(true); });
});

describe.runIf(hayBase)('la marca en los correos de Consultas', () => {
  it('carga, tutor de un campus: su logo, su nombre y su remitente', async () => {
    enviado.length = 0;
    await recordarCargas({ tutorIds: [g.deUno] });
    const [c] = correoA(g.deUno);
    expect(c, 'no se ha generado el correo de carga').toBeTruthy();
    expect(c.projectId).toBe(g.uno);
    expect(c.subject).toBe(`[Psiko ${marca}] Actualiza tu carga de trabajo`);
    expect(c.htmlContent).toContain(`Psiko-${marca}.png`);
    // El saludo lo pone la plantilla: «Hola Nombre,» una vez y el nombre escapado una vez.
    expect(c.htmlContent).toContain(`Hola Tutor &amp; ${marca},`);
    expect(c.htmlContent).not.toMatch(/Hola\s+Hola|&amp;amp;|,,/);
  });

  it('carga, tutor de varios campus: la marca del CRM, ni Psiko ni Fono', async () => {
    enviado.length = 0;
    await recordarCargas({ tutorIds: [g.deDos] });
    const [c] = correoA(g.deDos);
    expect(c).toBeTruthy();
    expect(c.projectId).toBeNull();
    expect(c.subject).toBe('[CRM] Actualiza tu carga de trabajo');
    for (const campus of ['Psiko', 'Fono']) {
      expect(c.htmlContent).not.toContain(`${campus} ${marca}`);
      expect(c.htmlContent).not.toContain(`${campus}-${marca}.png`);
    }
  });

  it('semanal: lo mismo', async () => {
    enviado.length = 0;
    await enviarResumenes(new Date());
    const [uno] = correoA(g.deUno);
    const [dos] = correoA(g.deDos);
    expect(uno, 'no se ha generado el resumen del tutor de un campus').toBeTruthy();
    expect(uno.projectId).toBe(g.uno);
    expect(uno.subject).toBe(`[Psiko ${marca}] Tu semana en Consultas`);
    expect(uno.htmlContent).toContain(`Psiko-${marca}.png`);
    expect(uno.htmlContent).toContain(`Hola Tutor &amp; ${marca},`);
    expect(uno.htmlContent).not.toMatch(/Hola\s+Hola|&amp;amp;|,,/);
    expect(dos).toBeTruthy();
    expect(dos.projectId).toBeNull();
    expect(dos.subject).toBe('[CRM] Tu semana en Consultas');
  });
});

describe('el saludo de los correos de Consultas', () => {
  it('ninguno le pasa «Hola» a la plantilla: ella pone el «Hola» y la coma', async () => {
    const { readFileSync } = await import('node:fs');
    const ficheros = [
      'src/modules/consultas/consultas.plazos.js',
      'src/modules/consultas/consultas.service.js',
      'src/jobs/consultasResumenScheduler.js',
    ];
    for (const f of ficheros) {
      const codigo = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(codigo, f).not.toMatch(/saludo:\s*`Hola/);
    }
  });
});
