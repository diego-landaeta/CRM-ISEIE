import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/**
 * Las admisiones, solo al CRM (#714), contra la base local.
 *
 * Carlos (10/11/2026, protección de datos): la solicitud de admisión (nombre, DNI,
 * las fotos del DNI, la firma) ya no puede llegar por correo. Se guarda en
 * Matrículas y el correo, como mucho, avisa con un enlace a la ficha, SIN datos ni
 * adjuntos. Aquí se comprueba:
 *   · el aviso no lleva el nombre, el correo, el teléfono, el DNI ni adjuntos;
 *   · solo sale con una solicitud nueva, a las direcciones del webhook, y con su
 *     interruptor (ADMISION_AVISO_ACTIVO);
 *   · los apellidos, que los formularios mandan aparte, se añaden al nombre;
 *   · el webhook guarda sus direcciones de aviso.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/admisionAviso.test.js
 */

const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'admision-aviso-'));
process.env.UPLOADS_DIR = CARPETA;
process.env.CRM_BASE_URL = 'https://crm.ejemplo.test/crm';

const { default: pool } = await import('../src/shared/config/db.js');
const tokenModel = await import('../src/modules/webhook-tokens/token.model.js');
const { recibirAdmision } = await import('../src/modules/matriculas/admision.service.js');
const { armarAviso, avisarAdmision, destinatarios } = await import('../src/modules/matriculas/admision.aviso.js');

const MARCA = `AVI${Date.now().toString(36)}`;
const correo = (n) => `${n}@${MARCA.toLowerCase()}.test`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
let PROYECTO; let JPG; let FIRMA;

// Lo que NUNCA puede ir en el aviso.
const NOMBRE = 'Lucía'; const APELLIDOS = 'Fernández Prieto';
const TELEFONO = '+34 611 222 333';

const envio = (extra = {}) => ({
  nombre: NOMBRE, apellidos: APELLIDOS, email: correo(`lucia${Math.random().toString(36).slice(2, 7)}`),
  // Cada envío con su DNI: la solicitud se deduplica por DNI o correo.
  telefono: TELEFONO, dni: `${Math.floor(10000000 + Math.random() * 89999999)}Q`, curso_solicitado: 'Máster en Neuropsicología Clínica',
  dni_frente: `data:image/jpeg;base64,${JPG.toString('base64')}`,
  firma: `data:image/png;base64,${FIRMA.toString('base64')}`,
  ...extra,
});

/** El aviso que se mandó (o se iba a mandar): el freno de pruebas lo anota entero. */
const enviado = async (matriculaId) => (await q('SELECT * FROM email_envios WHERE clave = $1', [`admision-aviso-${matriculaId}`]))[0];

beforeAll(async () => {
  [PROYECTO] = await q('INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id, nombre',
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  JPG = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c00' } }).jpeg().toBuffer();
  FIRMA = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="#fff"/><path d="M10 60 C60 10 120 70 190 20" stroke="#111" stroke-width="5" fill="none"/></svg>')).png().toBuffer();
}, 60000);

afterEach(() => { delete process.env.ADMISION_AVISO_ACTIVO; delete process.env.EMAIL_LISTA_BLANCA; });

afterAll(async () => {
  fs.rmSync(CARPETA, { recursive: true, force: true });
  await q("DELETE FROM email_envios WHERE clave LIKE 'admision-aviso-%' AND project_id = $1", [PROYECTO.id]);
  await q('DELETE FROM matriculas WHERE project_id = $1', [PROYECTO.id]);
  await q('DELETE FROM leads WHERE project_id = $1', [PROYECTO.id]);
  await q('DELETE FROM project_webhook_tokens WHERE project_id = $1', [PROYECTO.id]);
  await q('DELETE FROM projects WHERE id = $1', [PROYECTO.id]);
  await pool.end();
}, 60000);

/** Una solicitud por el servicio, esperando también al aviso (que en el webhook va sin esperar). */
async function admitir(token, body) {
  const r = await recibirAdmision(token, body, [], { respuestaMs: 0 });
  const aviso = r.interno.aviso ? await r.interno.aviso : null;
  return { ...r, aviso };
}

describe('el correo del aviso, sin datos', () => {
  it('campus, curso, número y botón a la ficha; nada de la persona', () => {
    const c = armarAviso({ marca: { id: 1, nombre: 'Psiko Aprende', slug: 'psiko-aprende' }, matriculaId: 321, curso: 'Máster en Neuropsicología' });
    expect(c.asunto).toBe('Nueva solicitud de admisión · Psiko Aprende');
    for (const texto of [c.htmlContent, c.textContent]) {
      expect(texto).toContain('Psiko Aprende');
      expect(texto).toContain('Máster en Neuropsicología');
      expect(texto).toContain('321');
      expect(texto).toContain('https://crm.ejemplo.test/crm/matriculas?matricula=321');
    }
    expect(c.htmlContent).toContain('Abrir la solicitud');
  });

  it('sin curso, la frase sigue bien; y el curso se recorta y se escapa', () => {
    expect(armarAviso({ marca: { nombre: 'ISEIH' }, matriculaId: 9 }).textContent).toContain('Ha llegado una solicitud de admisión a ISEIH.');
    const c = armarAviso({ marca: { nombre: 'ISEIH' }, matriculaId: 9, curso: `<b>x</b>${'a'.repeat(300)}` });
    expect(c.htmlContent).not.toContain('<b>x</b>');
    expect(c.htmlContent).not.toContain('a'.repeat(121));
  });

  it('las direcciones: limpias, sin repetir y solo correos', () => {
    expect(destinatarios([' Admisiones@Campus.com', 'admisiones@campus.com', 'no-es-correo', '', null, 'info@campus.com']))
      .toEqual(['admisiones@campus.com', 'info@campus.com']);
    expect(destinatarios(null)).toEqual([]);
  });
});

describe('cuándo sale el aviso', () => {
  it('una solicitud nueva avisa a las direcciones del webhook, y el correo no lleva ningún dato de la persona', async () => {
    process.env.ADMISION_AVISO_ACTIVO = 'true';
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {}, aviso_emails: ['admisiones@campus.test'] });
    expect(token.aviso_emails).toEqual(['admisiones@campus.test']);
    const body = envio();
    const r = await admitir(token, body);
    expect(r.interno.accion).toBe('created');
    // Fuera de producción y sin lista blanca, el freno lo para, pero lo anota entero.
    expect(r.aviso).toMatchObject({ enviado: false, motivo: 'FRENO_DE_PRUEBAS' });
    const fila = await enviado(r.interno.matriculaId);
    expect(fila).toBeTruthy();
    expect(fila.destinatarios).toBe('admisiones@campus.test');
    expect(fila.asunto).toBe(`Nueva solicitud de admisión · ${PROYECTO.nombre}`);
    expect(fila.project_id).toBe(PROYECTO.id);
    // El correo tal cual se armó (y, donde el registro guarda el cuerpo, el guardado).
    const html = `${r.aviso.correo.htmlContent}${fila.cuerpo_html || ''}`;
    expect(html).toContain(`matricula=${r.interno.matriculaId}`);
    expect(html).toContain('Máster en Neuropsicología Clínica');
    // Lo que NO va: ni el nombre, ni los apellidos, ni el correo, ni el teléfono, ni el DNI, ni imágenes.
    for (const dato of [NOMBRE, 'Fernández', body.email, '611 222 333', body.dni, 'base64', 'data:image']) {
      expect(html).not.toContain(dato);
      expect(fila.asunto).not.toContain(dato);
    }
    // Y la solicitud, entera en el CRM: con el nombre completo y sus documentos.
    const [m] = await q('SELECT nombre, dni, dni_doc_key, firma_key FROM matriculas WHERE id = $1', [r.interno.matriculaId]);
    expect(m.nombre).toBe(`${NOMBRE} ${APELLIDOS}`);
    expect(m.dni).toBe(body.dni);
    expect(m.dni_doc_key).toBeTruthy();
    expect(m.firma_key).toBeTruthy();
  });

  it('con la dirección en la lista blanca sale de verdad hacia Brevo (aquí sin clave: NO_API_KEY), con su marca', async () => {
    process.env.ADMISION_AVISO_ACTIVO = 'true';
    process.env.EMAIL_LISTA_BLANCA = 'aviso@campus.test';
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {}, aviso_emails: ['aviso@campus.test'] });
    const r = await admitir(token, envio());
    expect(r.aviso.motivo).not.toBe('FRENO_DE_PRUEBAS');
    expect(r.aviso.correo.htmlContent).not.toContain(NOMBRE);
  });

  it('apagado (sin ADMISION_AVISO_ACTIVO), se arma pero no se manda', async () => {
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {}, aviso_emails: ['admisiones@campus.test'] });
    const r = await admitir(token, envio());
    expect(r.aviso).toMatchObject({ enviado: false, motivo: 'APAGADO' });
    expect(await enviado(r.interno.matriculaId)).toBeUndefined();
  });

  it('sin direcciones en el webhook, no se avisa a nadie', async () => {
    process.env.ADMISION_AVISO_ACTIVO = 'true';
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
    expect(token.aviso_emails).toEqual([]);
    const r = await admitir(token, envio());
    expect(r.aviso).toMatchObject({ enviado: false, motivo: 'SIN_DESTINATARIOS' });
  });

  it('una solicitud repetida (la misma persona) no vuelve a avisar', async () => {
    process.env.ADMISION_AVISO_ACTIVO = 'true';
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {}, aviso_emails: ['admisiones@campus.test'] });
    const body = envio({ dni: `${MARCA}R1` });
    const a = await admitir(token, body);
    expect(a.interno.accion).toBe('created');
    const b = await admitir(token, { ...body, comentarios: 'otra vez' });
    expect(b.interno.accion).toBe('duplicate_skipped');
    expect(b.aviso).toBeNull();
  });

  it('un fallo del aviso no rompe la solicitud', async () => {
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {}, aviso_emails: ['admisiones@campus.test'] });
    const r = await recibirAdmision(token, envio(), [], { respuestaMs: 0, avisar: () => Promise.resolve({ enviado: false, motivo: 'ERROR' }) });
    expect(r.interno.accion).toBe('created');
    // Y el de verdad no lanza aunque le llegue basura.
    await expect(avisarAdmision({ token: null, matriculaId: null })).resolves.toMatchObject({ enviado: false });
  });
});

describe('los apellidos, aparte en los formularios', () => {
  it('con mapeo: nombre y apellidos de campos distintos se juntan', async () => {
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas',
      field_mapping: { nombre: 'nombre', apellidos: 'apellidos', email: 'correo_electronico', curso_solicitado: 'tipo_programa' } });
    const r = await admitir(token, { nombre: 'Marta', apellidos: 'Ruiz Gil', correo_electronico: correo('marta'), tipo_programa: 'Curso de Disfagia' });
    const [m] = await q('SELECT nombre, curso_solicitado FROM matriculas WHERE id = $1', [r.interno.matriculaId]);
    expect(m).toEqual({ nombre: 'Marta Ruiz Gil', curso_solicitado: 'Curso de Disfagia' });
  });

  it('si el nombre ya trae los apellidos, no se repiten', async () => {
    const token = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
    const r = await admitir(token, { nombre: 'Pablo Soto Vera', apellidos: 'Soto Vera', email: correo('pablo') });
    const [m] = await q('SELECT nombre FROM matriculas WHERE id = $1', [r.interno.matriculaId]);
    expect(m.nombre).toBe('Pablo Soto Vera');
  });
});

describe('el webhook guarda a quién avisa', () => {
  it('se cambian las direcciones y se pueden vaciar', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
    expect((await tokenModel.update(t.id, { aviso_emails: ['a@campus.test', 'b@campus.test'] })).aviso_emails).toEqual(['a@campus.test', 'b@campus.test']);
    expect((await tokenModel.update(t.id, { aviso_emails: [] })).aviso_emails).toEqual([]);
  });
});
