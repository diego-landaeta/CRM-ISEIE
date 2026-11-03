import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import express from 'express';
import supertest from 'supertest';
import sharp from 'sharp';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * El webhook de admisión (#198), contra la base de verdad.
 *
 * Diego (WhatsApp, 20/10): «un webhook abierto que reciba [los datos de admisión]
 * y luego se pueda mapear, por campus», y que se una a la persona por el correo.
 * Lo que pide la #198: archivos (multipart, URL o base64; JPG, PNG, WEBP, PDF;
 * 10 MB; tipo real), campos propios, vincular por email y luego teléfono (si no
 * existe se crea) y con la venta, e idempotente.
 *
 *   docker compose -f docker-compose.dev.yml up -d && npm run db:preparar
 *   npx vitest run tests/webhookAdmision.test.js
 */

// Los documentos se guardan de verdad (se mira la firma transparente), en una
// carpeta propia que se borra al acabar. Sin esto iban a /var/crm-uploads, que en
// la CI de GitHub (Linux) no se puede escribir: «No se ha podido guardar».
// Antes de importar nada: el almacenamiento lee la carpeta al cargarse.
const CARPETA = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-admision-'));
process.env.UPLOADS_DIR = CARPETA;

const { default: pool } = await import('../src/shared/config/db.js');
const { default: webhookTokens } = await import('../src/modules/webhook-tokens/index.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
const tokenModel = await import('../src/modules/webhook-tokens/token.model.js');
const matriculaModel = await import('../src/modules/matriculas/matricula.model.js');
const { obtenerArchivo, desdeUrl, ipPrivada, tipoReal } = await import('../src/modules/matriculas/admision.archivos.js');
const { fechaDeNacimiento } = await import('../src/modules/matriculas/admision.service.js');
const certifexModel = await import('../src/modules/certifex/certifex.model.js');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(webhookTokens.prefix, webhookTokens.router);
app.use(errorHandler);
const request = supertest(app);

const MARCA = `ADM${Date.now().toString(36)}`;
const correo = (n) => `${n}@${MARCA.toLowerCase()}.test`;
const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
let PROYECTO; let TOKEN; let GESTORA;

// ── Archivos de prueba ──────────────────────────────────────────────────────
let JPG; let PNG; let FIRMA_BLANCA; const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const FALSO = Buffer.from('esto no es una imagen, aunque se llame dni.jpg');

/** Una firma: un trazo negro sobre fondo blanco, como una foto o un escaneo. */
async function firmaSobreBlanco() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#fff"/><path d="M30 120 C90 20 160 140 230 60 S330 110 370 40" stroke="#111" stroke-width="7" fill="none"/></svg>';
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const recibir = (token = TOKEN.token) => request.post(`/api/webhook-tokens/receive/${token}`);
const matricula = async (id) => (await q('SELECT * FROM matriculas WHERE id = $1', [id]))[0];
// La respuesta pública solo trae `envio_id` (la huella): la matrícula se busca por ella.
const enviada = async (r) => (await q('SELECT * FROM matriculas WHERE project_id = $1 AND envio_huella = $2', [PROYECTO.id, r.body.data.envio_id]))[0];
// Lo que no sale en la respuesta (los documentos rechazados y por qué), llamando al servicio.
const admitir = async (body, archivos = [], token = TOKEN) => {
  const { recibirAdmision } = await import('../src/modules/matriculas/admision.service.js');
  return recibirAdmision(token, body, archivos);
};
const archivo = (fieldname, buffer, originalname) => ({ fieldname, buffer, originalname, size: buffer.length });
const historial = async (id) => (await q('SELECT evento, documento FROM matriculas_eventos WHERE matricula_id = $1 ORDER BY id', [id]));

beforeAll(async () => {
  [PROYECTO] = await q(`INSERT INTO projects (nombre, slug, webhook_api_key) VALUES ($1, $2, $3) RETURNING id`,
    [`${MARCA} Campus`, MARCA.toLowerCase(), `${MARCA}-key`]);
  // Una gestora en el campus: si el prospecto nuevo entrara en el reparto, se lo llevaría ella.
  [GESTORA] = await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'gestor') RETURNING id`,
    [`${MARCA} Gestora`, correo('gestora')]);
  await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [GESTORA.id, PROYECTO.id]);
  TOKEN = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
  JPG = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#c00' } }).jpeg().toBuffer();
  PNG = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#0c0' } }).png().toBuffer();
  FIRMA_BLANCA = await firmaSobreBlanco();
}, 60000);

afterAll(async () => {
  fs.rmSync(CARPETA, { recursive: true, force: true });
  await q(`DELETE FROM matriculas WHERE project_id = $1`, [PROYECTO.id]);
  await q(`DELETE FROM conversions WHERE project_id = $1`, [PROYECTO.id]);
  await q(`DELETE FROM leads WHERE project_id = $1`, [PROYECTO.id]);
  await q(`DELETE FROM project_webhook_tokens WHERE project_id = $1`, [PROYECTO.id]);
  await q(`DELETE FROM user_projects WHERE project_id = $1`, [PROYECTO.id]);
  await q(`DELETE FROM users WHERE id = $1`, [GESTORA.id]);
  await q(`DELETE FROM projects WHERE id = $1`, [PROYECTO.id]);
  await pool.end();
}, 60000);

describe('el modo escucha enseña también los archivos, para mapearlos', () => {
  it('un multipart con campos y un archivo: el archivo sale como marca, no como bytes', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
    await tokenModel.setListenMode(t.id, true);
    const r = await recibir(t.token).field('your-name', 'Ana').attach('dni-front', JPG, 'dni.jpg');
    expect(r.status).toBe(200);
    expect(r.body.data.mode).toBe('listen');
    const { sample_payload: s } = await tokenModel.findById(t.id);
    expect(s['your-name']).toBe('Ana');
    expect(s['dni-front']).toMatchObject({ __archivo: 'dni-front', nombre: 'dni.jpg', tamano: JPG.length });
  });
});

describe('los datos de la persona, en campos propios', () => {
  it('sin mapeo, con los nombres del contrato de la #198', async () => {
    const r = await recibir().send({
      nombre: 'Laura Sanz', email: correo('Laura'), telefono: '+34 600 111 222', documento_tipo: 'DNI', dni: '12345678Z',
      fecha_nacimiento: '17/05/1990', direccion: 'C/ Mayor 1', pais: 'España', estudios: 'Grado en Psicología',
      curso_solicitado: 'Máster en Neuropsicología',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ recibido: true, envio_id: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const m = await enviada(r);
    expect(m).toMatchObject({
      nombre: 'Laura Sanz', email: correo('laura'), telefono: '+34 600 111 222', documento_tipo: 'DNI', dni: '12345678Z',
      direccion: 'C/ Mayor 1', pais: 'España', estudios: 'Grado en Psicología', curso_solicitado: 'Máster en Neuropsicología',
      estado: 'solicitud_admision', source: 'webhook',
    });
    // La base la devuelve como texto o como fecha, según el tipo: se mira el día.
    const dia = m.fecha_nacimiento instanceof Date ? m.fecha_nacimiento.toISOString() : String(m.fecha_nacimiento);
    expect(dia.slice(0, 10)).toBe('1990-05-17');
    // El envío se conserva tal cual llegó.
    expect(m.datos_admision.estudios).toBe('Grado en Psicología');
    expect((await historial(m.id)).map((e) => e.evento)).toEqual(['recibida']);
  });

  it('con mapeo: cada formulario manda sus propios nombres (Elementor, Gravity…)', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {
      nombre: 'your-name', email: 'fields.correo', dni: 'fields.documento', curso_solicitado: 'form.curso',
    } });
    const r = await recibir(t.token).send({ 'your-name': 'Pedro Gil', fields: { correo: correo('pedro'), documento: 'X1234567L' }, form: { curso: 'Curso de Duelo' } });
    expect(r.status).toBe(200);
    const m = await enviada(r);
    expect(m).toMatchObject({ nombre: 'Pedro Gil', email: correo('pedro'), dni: 'X1234567L', curso_solicitado: 'Curso de Duelo' });
  });

  it('una fecha que no es fecha no se inventa: queda vacía (y en el envío original)', () => {
    expect(fechaDeNacimiento('1990-05-17')).toBe('1990-05-17');
    expect(fechaDeNacimiento('17-05-1990')).toBe('1990-05-17');
    expect(fechaDeNacimiento('31/02/1990')).toBeNull();
    expect(fechaDeNacimiento('mañana')).toBeNull();
  });

  it('la lista de Matrículas enseña a la persona aunque aún no tenga prospecto', async () => {
    const r = await recibir().send({ nombre: 'Sin Correo Ni Tel', dni: '00000001R' });
    const { matriculas } = await matriculaModel.findAll({ projectId: PROYECTO.id, search: 'Sin Correo' });
    const m = await enviada(r);
    expect(matriculas.find((x) => x.id === m.id)?.lead_nombre).toBe('Sin Correo Ni Tel');
  });
});

describe('los documentos: archivo, imagen en texto o URL', () => {
  it('multipart: el DNI por las dos caras, el título en PDF y la firma; cada uno con su línea en el historial', async () => {
    const r = await recibir()
      .field('nombre', 'Marta Ruiz').field('email', correo('marta'))
      .attach('dni_frente', JPG, 'frente.jpg').attach('dni_dorso', PNG, 'dorso.png')
      .attach('titulo_doc', PDF, 'titulo.pdf').attach('firma', FIRMA_BLANCA, 'firma.png');
    expect(r.status).toBe(200);
    const m = await enviada(r);
    expect(m.dni_doc_key).toMatch(/\.jpg$/);
    expect(m.dni_dorso_key).toMatch(/\.png$/);
    expect(m.titulo_doc_key).toMatch(/\.pdf$/);
    expect(m.firma_key).toMatch(/\.png$/);
    const docs = (await historial(m.id)).filter((e) => e.evento === 'documento').map((e) => e.documento);
    expect(docs.sort()).toEqual(['dni', 'dni_dorso', 'firma', 'titulo']);
  });

  it('la firma se guarda transparente y recortada al trazo (Diego: «que la firma llegue en fondo transparente»)', async () => {
    const r = await recibir().field('email', correo('firma')).attach('firma', FIRMA_BLANCA, 'firma.png');
    const m = await enviada(r);
    const { getLocal } = await import('../src/shared/services/localStorage.service.js');
    const { buffer } = await getLocal(m.firma_key);
    const meta = await sharp(buffer).metadata();
    expect(meta.hasAlpha).toBe(true);
    expect(meta.width).toBeLessThan(400); // recortada
    const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0); // la esquina, transparente
  });

  it('imagen en texto (data:image/png;base64): se guarda como documento, y el envío se conserva tal cual llegó', async () => {
    const dataUri = `data:image/png;base64,${FIRMA_BLANCA.toString('base64')}`;
    const r = await recibir().send({ email: correo('base64'), firma: dataUri });
    const m = await enviada(r);
    expect(m.firma_key).toBeTruthy();
    expect(m.datos_admision.firma).toBe(dataUri);
  });

  it('un archivo que no es lo que dice (texto llamado dni.jpg) se rechaza, y la solicitud se guarda igual', async () => {
    const r = await admitir({ email: correo('falso') }, [archivo('dni_frente', FALSO, 'dni.jpg')]);
    expect(r.interno.documentos.rechazados).toEqual([{ documento: 'dni_frente', motivo: 'No es un JPG, PNG, WEBP ni PDF.' }]);
    expect((await matricula(r.interno.matriculaId)).dni_doc_key).toBeNull();
    // Y quien lo manda recibe lo de siempre: el rechazo no sale en la respuesta.
    const h = await recibir().field('email', correo('falso-http')).attach('dni_frente', FALSO, 'dni.jpg');
    expect(h.status).toBe(200);
    expect(h.body.data).toEqual({ recibido: true, envio_id: expect.any(String) });
    expect((await enviada(h)).dni_doc_key).toBeNull();
  });

  it('una firma en PDF no vale: tiene que ser una imagen', async () => {
    const r = await admitir({ email: correo('firmapdf') }, [archivo('firma', PDF, 'firma.pdf')]);
    expect(r.interno.documentos.rechazados[0]).toMatchObject({ documento: 'firma', motivo: 'La firma tiene que ser una imagen, no un PDF.' });
  });

  it('una URL de la red interna o del propio servidor NO se descarga', async () => {
    const r = await admitir({ email: correo('ssrf'), dni_frente: 'http://127.0.0.1:5432/secreto.jpg', foto: 'http://169.254.169.254/latest/meta-data' });
    expect(r.status).toBe(200);
    expect(r.interno.documentos.rechazados).toEqual([
      { documento: 'dni_frente', motivo: 'La dirección del archivo no es pública.' },
      { documento: 'foto', motivo: 'La dirección del archivo no es pública.' },
    ]);
  });

  it('una URL pública se descarga (aquí, un servidor de prueba en 127.0.0.1 con el permiso de las pruebas)', async () => {
    const srv = http.createServer((req, res) => {
      if (req.url === '/saltar') { res.writeHead(302, { location: '/dni.jpg' }); return res.end(); }
      res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPG);
    });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const a = await obtenerArchivo(`${base}/saltar`, [], { permitirRedLocal: true });
      expect(a).toMatchObject({ ext: 'jpg', mime: 'image/jpeg' });
      expect(a.buffer.equals(JPG)).toBe(true);
      // Sin el permiso de las pruebas, la misma dirección se rechaza.
      await expect(desdeUrl(`${base}/dni.jpg`)).rejects.toThrow('La dirección del archivo no es pública.');
    } finally {
      srv.close();
    }
  });

  it('las direcciones internas y el tipo real, uno a uno', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(ipPrivada(ip)).toBe(true);
    }
    for (const ip of ['8.8.8.8', '104.16.0.1', '2606:4700::1111']) expect(ipPrivada(ip)).toBe(false);
    expect(tipoReal(JPG).ext).toBe('jpg');
    expect(tipoReal(PNG).ext).toBe('png');
    expect(tipoReal(PDF).ext).toBe('pdf');
    expect(tipoReal(FALSO)).toBeNull();
  });
});

describe('el contrato de Diego (01/10), tal cual, y formularios de verdad', () => {
  it('sin mapeo, el ARCHIVO «titulo» va como documento y «documento» como número', async () => {
    const r = await recibir().field('email', correo('contrato')).field('documento', 'Y7654321G')
      .attach('dni_frente', JPG, 'f.jpg').attach('titulo', PDF, 'titulo.pdf');
    const m = await enviada(r);
    expect(m.dni_doc_key).toMatch(/\.jpg$/);
    expect(m.titulo_doc_key).toMatch(/\.pdf$/);
    expect(m.titulo).toBeNull(); // el texto «Título / Programa» no se llena con un archivo
    expect(m.dni).toBe('Y7654321G');
  });

  it('el «titulo» que es texto sigue siendo el texto «Título / Programa»', async () => {
    const r = await recibir().send({ email: correo('titulotexto'), titulo: 'Máster en Duelo' });
    expect((await enviada(r)).titulo).toBe('Máster en Duelo');
  });

  it('Gravity: el nombre por partes ({ first, last }) se junta', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: { nombre: 'name', email: 'mail' } });
    const r = await recibir(t.token).send({ name: { first: 'Ana', last: 'Pérez Gil' }, mail: correo('gravity') });
    expect((await enviada(r)).nombre).toBe('Ana Pérez Gil');
  });

  it('varios archivos con el mismo nombre (fotos[]): se pueden mapear y vale el primero', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: { email: 'e', dni_frente: 'docs.0', dni_dorso: 'docs.1' } });
    const r = await recibir(t.token).field('e', correo('varios')).attach('docs', JPG, 'frente.jpg').attach('docs', PNG, 'dorso.png');
    const m = await enviada(r);
    expect(m.dni_doc_key).toMatch(/\.jpg$/);
    expect(m.dni_dorso_key).toMatch(/\.png$/);
  });

  it('un JSON con las imágenes en texto de más de 5 MB entra (el tope general de la API es 5 MB)', async () => {
    const grande = await sharp({ create: { width: 1400, height: 1400, channels: 3, background: '#888' } })
      .composite([{ input: Buffer.from(Array.from({ length: 1400 * 1400 * 3 }, (_, i) => (i * 7919) % 256)), raw: { width: 1400, height: 1400, channels: 3 } }])
      .png({ compressionLevel: 0 }).toBuffer();
    expect(grande.length).toBeGreaterThan(4 * 1024 * 1024);
    const uri = `data:image/png;base64,${grande.toString('base64')}`;
    // Una sola imagen (~10 MB en texto): dos eran ~20 MB, más que el tope del envío (19 MB).
    expect(uri.length).toBeGreaterThan(5 * 1024 * 1024);
    // La app de verdad, con su tope por ruta (app.js).
    const { default: appReal } = await import('../src/app.js');
    const r = await supertest(appReal).post(`/api/webhook-tokens/receive/${TOKEN.token}`)
      .send({ email: correo('json-grande'), dni_frente: uri });
    expect(r.status).toBe(200);
    expect((await enviada(r)).dni_doc_key).toBeTruthy();
  }, 60000);
});

describe('se une a la persona («que se sincronicen con el mail»)', () => {
  it('por el correo: con su prospecto de siempre y su gestora, sin crear otro', async () => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono, responsable_id) VALUES ($1, 'Rosa Prospecto', $2, '600999888', $3) RETURNING id`,
      [PROYECTO.id, correo('rosa'), GESTORA.id]);
    const r = await recibir().send({ nombre: 'Rosa en el formulario', email: correo('ROSA') });
    expect((await enviada(r)).lead_id).toBe(l.id);
    expect((await q('SELECT count(*)::int AS n FROM leads WHERE project_id = $1 AND lower(email) = $2', [PROYECTO.id, correo('rosa')]))[0].n).toBe(1);
  });

  it('si no hay correo que coincida, por el teléfono', async () => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email, telefono) VALUES ($1, 'Telmo', $2, '+34 611 222 333') RETURNING id`,
      [PROYECTO.id, correo('telmo-viejo')]);
    // El CRM compara los teléfonos con su prefijo (claveTelefono de lead.model.js): «+34 611 222 333» = «0034611222333».
    const r = await recibir().send({ nombre: 'Telmo', email: correo('telmo-nuevo'), telefono: '0034611222333' });
    const m = await enviada(r);
    expect(m.lead_id).toBe(l.id);
    // El buscador de Matrículas la encuentra también por el correo que escribió en el formulario.
    const { matriculas } = await matriculaModel.findAll({ projectId: PROYECTO.id, search: correo('telmo-nuevo') });
    expect(matriculas.map((x) => x.id)).toContain(m.id);
  });

  it('si no existe, se crea el prospecto SIN GESTORA (fuera del reparto; decidido el 20/10)', async () => {
    const r = await recibir().send({ nombre: 'Nuevo Alumno', email: correo('nuevo') });
    const m = await enviada(r);
    const [l] = await q('SELECT responsable_id, notas FROM leads WHERE id = $1', [m.lead_id]);
    expect(l.responsable_id).toBeNull();
    expect(l.notas).toBe('Creado por la solicitud de admisión');
  });

  it('sin correo no se crea prospecto (es obligatorio en la ficha): la solicitud queda sin vincular', async () => {
    const r = await recibir().send({ nombre: 'Solo Teléfono', telefono: '699000111' });
    expect((await enviada(r)).lead_id).toBeNull();
  });

  it('y con su venta, si la tiene y aún no tiene matrícula', async () => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Con Venta', $2) RETURNING id`, [PROYECTO.id, correo('venta')]);
    const [c] = await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Máster X', 2400) RETURNING id`, [l.id, PROYECTO.id]);
    const r = await recibir().send({ nombre: 'Con Venta', email: correo('venta') });
    expect((await enviada(r)).conversion_id).toBe(c.id);
  });

  it('y si la venta llega DESPUÉS de la solicitud («cuando la haya»), se une al registrarla', async () => {
    const r = await recibir().send({ nombre: 'Venta Tardía', email: correo('tardia') });
    const m = await enviada(r);
    expect(m.conversion_id).toBeNull();
    // La venta, como la registra el CRM (conversion.model.create: todas pasan por ahí).
    const { create: crearVenta } = await import('../src/modules/conversions/conversion.model.js');
    const c = await crearVenta({
      lead_id: m.lead_id, project_id: PROYECTO.id, producto_contratado: 'Curso Tardío', importe_total: 300, importe_pagado: 0,
    });
    expect((await matricula(m.id)).conversion_id).toBe(c.id);
  });

  it('Certifex encuentra su firma por el correo mapeado (aunque el formulario no lo llame «email»)', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: { email: 'your-email', firma: 'your-signature' } });
    const r = await recibir(t.token).field('your-email', correo('diploma')).attach('your-signature', FIRMA_BLANCA, 'f.png');
    const m = await enviada(r);
    await q(`UPDATE matriculas SET estado = 'validada' WHERE id = $1`, [m.id]);
    const firmas = await certifexModel.firmasDeAdmision([{ matriculaId: 999001, projectId: PROYECTO.id, email: correo('diploma') }]);
    expect(firmas.get(999001)?.matriculaCrm).toBe(m.id);
  });

  it('la firma solo sale de una admisión aceptada/en vigor («Validada»): ni de una solicitud, ni con los datos validados, ni de una rechazada (QA de Diego, 22/10)', async () => {
    const buscar = async () => (await certifexModel.firmasDeAdmision([{ matriculaId: 999002, projectId: PROYECTO.id, email: correo('suplantada') }])).get(999002);
    const conFirma = (curso) => recibir().field('email', correo('suplantada')).field('curso_solicitado', curso).attach('firma', FIRMA_BLANCA, 'f.png');
    // Alguien manda el formulario con el correo de otra persona: queda en «Solicitud».
    const solicitud = await enviada(await conFirma('Curso 1'));
    expect(solicitud.estado).toBe('solicitud_admision');
    expect(await buscar()).toBeUndefined();
    // «Validar datos» es el paso de en medio: todavía no está aceptada.
    await q(`UPDATE matriculas SET estado = 'datos_validados' WHERE id = $1`, [solicitud.id]);
    expect(await buscar()).toBeUndefined();
    await q(`UPDATE matriculas SET estado = 'rechazada' WHERE id = $1`, [solicitud.id]);
    expect(await buscar()).toBeUndefined();
    // Validada, sí.
    await q(`UPDATE matriculas SET estado = 'validada' WHERE id = $1`, [solicitud.id]);
    expect((await buscar())?.matriculaCrm).toBe(solicitud.id);
  });
});

describe('la respuesta pública no dice nada de la persona (QA de Diego, 22/10)', () => {
  it('nueva, de alguien con prospecto y venta, o repetida por su correo: la misma respuesta', async () => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Con Todo', $2) RETURNING id`, [PROYECTO.id, correo('con-todo')]);
    await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Máster Y', 900)`, [l.id, PROYECTO.id]);
    const nadie = await recibir().send({ nombre: 'Nadie', email: correo('nadie') });
    const conTodo = await recibir().send({ nombre: 'Con Todo', email: correo('con-todo') });
    // Otro envío (otro curso) con el mismo correo: es «repetido» por dentro.
    const otraVez = await recibir().send({ nombre: 'Con Todo', email: correo('con-todo'), curso_solicitado: 'Otro' });
    for (const r of [nadie, conTodo, otraVez]) {
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.data).sort()).toEqual(['envio_id', 'recibido']);
    }
    // Por dentro sí se unió a su prospecto y su venta.
    expect((await enviada(conTodo)).lead_id).toBe(l.id);
    expect((await enviada(conTodo)).conversion_id).toBeTruthy();
  });
});

describe('ni el tiempo ni los documentos delatan si la persona ya existe (caja negra, 24/10)', () => {
  const FIJO = 400;
  const cronometrar = async (body) => {
    const t0 = Date.now();
    const r = await admitirCon(body);
    return { ms: Date.now() - t0, r };
  };
  const admitirCon = async (body) => {
    const { recibirAdmision } = await import('../src/modules/matriculas/admision.service.js');
    return recibirAdmision(TOKEN, body, [], { respuestaMs: FIJO, permitirRedLocal: true });
  };

  it('correo nuevo, prospecto que ya existe y solicitud repetida: tardan lo mismo (el tiempo fijo)', async () => {
    await q(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Ya Prospecto', $2)`, [PROYECTO.id, correo('ya-prospecto')]);
    await admitirCon({ nombre: 'Ya Pidió', email: correo('ya-pidio') });
    const nuevo = await cronometrar({ nombre: 'Nuevo Del Todo', email: correo('nuevo-del-todo') });
    const prospecto = await cronometrar({ nombre: 'Ya Prospecto', email: correo('ya-prospecto') });
    const repetida = await cronometrar({ nombre: 'Ya Pidió', email: correo('ya-pidio'), curso_solicitado: 'Otro' });
    expect([nuevo.r.interno.accion, prospecto.r.interno.accion, repetida.r.interno.accion]).toEqual(['created', 'created', 'duplicate_skipped']);
    expect(nuevo.r.interno.leadCreado).toBe(true);
    expect(prospecto.r.interno.leadCreado).toBe(false);
    // Arriba, margen de sobra: un runner lento de GitHub no debe tumbar la prueba.
    for (const { ms } of [nuevo, prospecto, repetida]) {
      expect(ms).toBeGreaterThanOrEqual(FIJO - 5);
      expect(ms).toBeLessThan(FIJO + 400);
    }
  });

  it('el MISMO envío, idéntico (la web que reintenta): al momento y sin volver a descargar sus enlaces', async () => {
    const pedidos = [];
    const srv = http.createServer((req, res) => { pedidos.push(req.url); res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPG); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const envio = { nombre: 'Reintento', email: correo('reintento'), dni_frente: `http://127.0.0.1:${srv.address().port}/dni.jpg` };
      const a = await admitirCon(envio);
      const t0 = Date.now();
      const b = await admitirCon(envio);
      expect([a.interno.accion, b.interno.accion]).toEqual(['created', 'duplicate_skipped']);
      expect(b.data).toEqual(a.data); // la misma respuesta
      expect(Date.now() - t0).toBeLessThan(FIJO);
      expect(pedidos).toEqual(['/dni.jpg']);
    } finally { srv.close(); }
  });

  it('una solicitud repetida también descarga sus documentos: un enlace propio no sirve para saber si ya existía', async () => {
    const pedidos = [];
    const srv = http.createServer((req, res) => { pedidos.push(req.url); res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPG); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${srv.address().port}`;
    try {
      const a = await admitirCon({ nombre: 'Con Enlace', email: correo('con-enlace'), dni_frente: `${base}/primera.jpg` });
      const b = await admitirCon({ nombre: 'Con Enlace', email: correo('con-enlace'), dni_frente: `${base}/segunda.jpg` });
      expect([a.interno.accion, b.interno.accion]).toEqual(['created', 'duplicate_skipped']);
      expect(pedidos).toEqual(['/primera.jpg', '/segunda.jpg']);
      // Lo de la repetida no se guarda: la primera sigue con su documento.
      expect((await matricula(a.interno.matriculaId)).dni_doc_key).toMatch(/\.jpg$/);
    } finally { srv.close(); }
  });
});

describe('idempotente y con su llave', () => {
  it('el mismo envío dos veces no crea dos matrículas', async () => {
    const envio = { nombre: 'Doble', email: correo('doble'), curso_solicitado: 'Curso A' };
    const a = await recibir().send(envio);
    const b = await recibir().send(envio);
    expect(b.status).toBe(200);
    expect(b.body.data).toEqual(a.body.data);
    expect((await q('SELECT count(*)::int AS n FROM matriculas WHERE project_id = $1 AND email = $2', [PROYECTO.id, correo('doble')]))[0].n).toBe(1);
  });

  it('el mismo envío con los mismos archivos, tampoco', async () => {
    const enviar = () => recibir().field('email', correo('docdoble')).attach('dni_frente', JPG, 'd.jpg');
    const a = await enviar();
    const b = await enviar();
    expect(b.body.data).toEqual(a.body.data);
    expect((await q('SELECT count(*)::int AS n FROM matriculas WHERE project_id = $1 AND email = $2', [PROYECTO.id, correo('docdoble')]))[0].n).toBe(1);
  });

  it('un token apagado o inventado: 404', async () => {
    const t = await tokenModel.create({ project_id: PROYECTO.id, kind: 'matriculas', field_mapping: {} });
    await tokenModel.update(t.id, { active: false });
    expect((await recibir(t.token).send({ email: correo('apagado') })).status).toBe(404);
    expect((await recibir('matriculas_noexiste').send({})).status).toBe(404);
  });

  it('un archivo de más de 10 MB se corta antes de leerlo entero', async () => {
    const grande = Buffer.alloc(10 * 1024 * 1024 + 10, 0xff);
    const r = await recibir().field('email', correo('grande')).attach('dni_frente', grande, 'grande.jpg');
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/10 MB/);
  });
});

describe('lo que salió en la auditoría (22/10)', () => {
  it('una IP interna escrita como IPv6 (::ffff:127.0.0.1, ::7f00:1, NAT64) tampoco se descarga', async () => {
    for (const ip of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '64:ff9b::7f00:1', '2002:7f00:1::']) expect(ipPrivada(ip)).toBe(true);
    expect(ipPrivada('::ffff:8.8.8.8')).toBe(false);
    await expect(desdeUrl('http://[::ffff:127.0.0.1]:3001/api/health')).rejects.toThrow('La dirección del archivo no es pública.');
    await expect(desdeUrl('http://localhost:3001/api/health')).rejects.toThrow('La dirección del archivo no es pública.');
  });

  it('el «titulo» que llega como ENLACE al archivo (Gravity, Elementor) se descarga como documento', async () => {
    const srv = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/pdf' }); res.end(PDF); });
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const { recibirAdmision } = await import('../src/modules/matriculas/admision.service.js');
      const r = await recibirAdmision({ project_id: PROYECTO.id, field_mapping: {} },
        { email: correo('titulo-url'), titulo: `http://127.0.0.1:${srv.address().port}/uploads/titulo.pdf` }, [], { permitirRedLocal: true });
      expect(r.interno.documentos.guardados).toEqual(['titulo_doc']);
      const m = await matricula(r.interno.matriculaId);
      expect(m.titulo_doc_key).toMatch(/\.pdf$/);
      expect(m.titulo).toBeNull(); // no se guarda el enlace como «Título / Programa»
    } finally { srv.close(); }
  });

  it('dos envíos A LA VEZ de la misma persona (mismo DNI, algo distintos): uno entra y el otro es repetido, sin 500', async () => {
    const base = { email: correo('a-la-vez'), dni: 'Z1111111A', nombre: 'A La Vez' };
    const [a, b] = await Promise.all([recibir().send({ ...base, curso_solicitado: 'Curso 1' }), recibir().send({ ...base, curso_solicitado: 'Curso 2' })]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await q('SELECT count(*)::int AS n FROM matriculas WHERE project_id = $1 AND dni = $2', [PROYECTO.id, 'Z1111111A']))[0].n).toBe(1);
  });

  it('un correo largo (151 a 200 caracteres) ya no hace fallar la solicitud', async () => {
    const largo = `${'a'.repeat(170)}@${MARCA.toLowerCase()}.test`;
    const r = await recibir().send({ email: largo });
    expect(r.status).toBe(200);
    expect((await enviada(r)).dedupe_key).toBe(largo);
  });

  it('borrar la venta NO borra la solicitud de admisión: se queda suelta', async () => {
    const [l] = await q(`INSERT INTO leads (project_id, nombre, email) VALUES ($1, 'Venta Borrada', $2) RETURNING id`, [PROYECTO.id, correo('venta-borrada')]);
    const [c] = await q(`INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total) VALUES ($1, $2, 'Curso X', 100) RETURNING id`, [l.id, PROYECTO.id]);
    const r = await recibir().send({ nombre: 'Venta Borrada', email: correo('venta-borrada') });
    const antes = await enviada(r);
    expect(antes.conversion_id).toBe(c.id);
    await q('DELETE FROM conversions WHERE id = $1', [c.id]);
    const m = await matricula(antes.id);
    expect(m).toBeTruthy();
    expect(m.conversion_id).toBeNull();
  });

  it('con la app de verdad, un token inventado da 404 SIN leer el envío (antes se leían hasta 25 MB)', async () => {
    const { default: appReal } = await import('../src/app.js');
    const r = await supertest(appReal).post('/api/webhook-tokens/receive/matriculas_inventado').send({ email: correo('inventado'), relleno: 'x'.repeat(1024) });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/Token/);
  });

  it('la lista no trae de la base el envío entero (datos_admision), solo la ficha', async () => {
    const r = await recibir().send({ email: correo('lista-ligera'), nombre: 'Lista Ligera', firma: `data:image/png;base64,${FIRMA_BLANCA.toString('base64')}` });
    const { matriculas } = await matriculaModel.findAll({ projectId: PROYECTO.id, search: correo('lista-ligera') });
    const m = await enviada(r);
    const fila = matriculas.find((x) => x.id === m.id);
    expect(fila).toBeTruthy();
    expect(fila).not.toHaveProperty('datos_admision');
    expect(fila.lead_nombre).toBe('Lista Ligera');
  });
});

describe('la descarga desde una URL tiene un plazo total (QA de Diego, 22/10)', () => {
  // Un servidor de prueba que contesta según la ruta. Al acabar, cierra lo que quede abierto.
  async function servidor(manejar) {
    const srv = http.createServer(manejar);
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    return { base: `http://127.0.0.1:${srv.address().port}`, cerrar: () => { srv.closeAllConnections(); srv.close(); } };
  }

  it('un servidor que manda un byte cada poco (nunca 10 s callado) se corta al llegar al plazo', async () => {
    const goteos = [];
    const s = await servidor((req, res) => {
      res.writeHead(200, { 'content-type': 'image/jpeg' });
      res.write(JPG.subarray(0, 3));
      const t = setInterval(() => res.write(Buffer.from([0])), 100);
      goteos.push(t);
      req.on('close', () => clearInterval(t));
    });
    const antes = Date.now();
    try {
      await expect(desdeUrl(`${s.base}/lento.jpg`, { permitirRedLocal: true, plazoMs: 800 }))
        .rejects.toThrow('El archivo tarda demasiado en descargarse.');
      expect(Date.now() - antes).toBeLessThan(3000);
    } finally {
      goteos.forEach(clearInterval);
      s.cerrar();
    }
  });

  it('el plazo es para la descarga entera: cada redirección no vuelve a empezar de cero', async () => {
    // Cada salto tarda 300 ms (menos que el plazo), pero tres seguidos, no.
    const s = await servidor((req, res) => {
      const n = Number(req.url.slice(1)) || 0;
      setTimeout(() => {
        if (n < 3) { res.writeHead(302, { location: `/${n + 1}` }); return res.end(); }
        res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(JPG);
      }, 300);
    });
    try {
      await expect(desdeUrl(`${s.base}/0`, { permitirRedLocal: true, plazoMs: 700 }))
        .rejects.toThrow('El archivo tarda demasiado en descargarse.');
      // Con plazo de sobra, la misma cadena llega al archivo.
      const cuerpo = await desdeUrl(`${s.base}/0`, { permitirRedLocal: true, plazoMs: 5000 });
      expect(cuerpo.equals(JPG)).toBe(true);
    } finally {
      s.cerrar();
    }
  });

  it('la conexión de una redirección o un error se cierra: su cuerpo, aunque no acabe nunca, no se sigue leyendo', async () => {
    let abiertas = 0;
    const s = await servidor((req, res) => {
      if (req.url === '/dni.jpg') { res.writeHead(200, { 'content-type': 'image/jpeg' }); return res.end(JPG); }
      // Un 302 o un 500 con el cuerpo a goteo, sin acabar.
      abiertas += 1;
      req.socket.on('close', () => { abiertas -= 1; });
      res.writeHead(req.url === '/salta' ? 302 : 500, req.url === '/salta' ? { location: '/dni.jpg' } : {});
      res.write('x');
      const t = setInterval(() => res.write('x'), 50);
      res.on('close', () => clearInterval(t));
    });
    try {
      expect((await desdeUrl(`${s.base}/salta`, { permitirRedLocal: true, plazoMs: 5000 })).equals(JPG)).toBe(true);
      await expect(desdeUrl(`${s.base}/falla`, { permitirRedLocal: true, plazoMs: 5000 })).rejects.toThrow('contestó 500');
      await new Promise((ok) => setTimeout(ok, 300));
      expect(abiertas).toBe(0);
    } finally {
      s.cerrar();
    }
  });
});

describe('el tope del envío entero, por debajo de los 20 MB de Nginx (QA de Diego, 22/10)', () => {
  // Un «JPG» del tamaño pedido: la cabecera de verdad y relleno (el tipo se mira por los primeros bytes).
  const jpgDe = (bytes) => Buffer.concat([JPG, Buffer.alloc(bytes - JPG.length, 0x20)]);
  const MB = 1024 * 1024;
  let appReal;
  beforeAll(async () => { ({ default: appReal } = await import('../src/app.js')); });

  it('tres archivos de 7 MB (cada uno vale, juntos 21 MB): 413 con el motivo, sin llegar a Nginx', async () => {
    const r = await supertest(appReal).post(`/api/webhook-tokens/receive/${TOKEN.token}`)
      .field('email', correo('tres-de-7'))
      .attach('dni_frente', jpgDe(7 * MB), 'a.jpg').attach('dni_dorso', jpgDe(7 * MB), 'b.jpg').attach('foto', jpgDe(7 * MB), 'c.jpg');
    expect(r.status).toBe(413);
    expect(r.body).toMatchObject({ success: false, error: 'El envío pasa de 19 MB en total.', code: 'ENVIO_DEMASIADO_GRANDE' });
    expect((await q('SELECT count(*)::int AS n FROM matriculas WHERE project_id = $1 AND email = $2', [PROYECTO.id, correo('tres-de-7')]))[0].n).toBe(0);
  }, 60000);

  it('un JSON de más de 19 MB por trozos (sin Content-Length): lo corta el lector, con el mismo motivo', async () => {
    const srv = http.createServer(appReal);
    await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const r = await new Promise((ok, mal) => {
        const req = http.request({
          host: '127.0.0.1', port: srv.address().port, method: 'POST', path: `/api/webhook-tokens/receive/${TOKEN.token}`,
          headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' },
        }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: JSON.parse(b) })); });
        req.on('error', (e) => (e.code === 'EPIPE' || e.code === 'ECONNRESET' ? null : mal(e)));
        req.write(`{"email":"${correo('trozos')}","relleno":"`);
        const trozo = 'x'.repeat(MB);
        for (let i = 0; i < 20; i++) req.write(trozo);
        req.end('"}');
      });
      expect(r.status).toBe(413);
      expect(r.body).toMatchObject({ error: 'El envío pasa de 19 MB en total.', code: 'ENVIO_DEMASIADO_GRANDE' });
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  }, 60000);

  it('justo por debajo (dos archivos de 8 MB, unos 16 MB): entra, con sus documentos', async () => {
    const r = await supertest(appReal).post(`/api/webhook-tokens/receive/${TOKEN.token}`)
      .field('email', correo('dos-de-8'))
      .attach('dni_frente', jpgDe(8 * MB), 'a.jpg').attach('dni_dorso', jpgDe(8 * MB), 'b.jpg');
    expect(r.status).toBe(200);
    const m = await enviada(r);
    expect(m.dni_doc_key).toMatch(/\.jpg$/);
    expect(m.dni_dorso_key).toMatch(/\.jpg$/);
  }, 60000);
});

describe('el contrato de la lista y la ficha (Diego, 01/10)', () => {
  const ADMIN_ID = { id: null };
  const como = () => ({ Authorization: `Bearer ${jwt.sign({ userId: ADMIN_ID.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
  let api;

  beforeAll(async () => {
    const { default: modulo } = await import('../src/modules/matriculas/index.js');
    const appM = express();
    appM.use(express.json());
    appM.use(modulo.prefix, modulo.router);
    appM.use(errorHandler);
    api = supertest(appM);
    [ADMIN_ID.id] = (await q(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'admin') RETURNING id`,
      [`${MARCA} Contrato`, correo('contrato')])).map((u) => u.id);
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ADMIN_ID.id, PROYECTO.id]);
  });

  afterAll(async () => {
    await q('DELETE FROM user_projects WHERE user_id = $1', [ADMIN_ID.id]);
    await q('DELETE FROM users WHERE id = $1', [ADMIN_ID.id]);
  });

  it('lista: persona { nombre, email, telefono }, curso, proyecto, documento y documentos; sin datos_admision (va en la ficha)', async () => {
    const dataUri = `data:image/png;base64,${FIRMA_BLANCA.toString('base64')}`;
    const r = await recibir().send({ nombre: 'Rosa Contrato', email: correo('rosa-contrato'), telefono: '+34 677 000 111', dni: '44444444A', curso_solicitado: 'Curso C', firma: dataUri });
    const lista = await api.get(`/api/matriculas?projectId=${PROYECTO.id}&search=${encodeURIComponent(correo('rosa-contrato'))}`).set(como());
    expect(lista.status).toBe(200);
    const m = await enviada(r);
    const fila = lista.body.data.find((x) => x.id === m.id);
    expect(fila).toMatchObject({
      persona: { nombre: 'Rosa Contrato', email: correo('rosa-contrato'), telefono: '+34 677 000 111' },
      curso: 'Curso C', proyecto: `${MARCA} Campus`, documento: '44444444A', estado: 'solicitud_admision',
      documentos: { dni_frente: false, dni_dorso: false, foto: false, titulo: false, firma: true },
      lead_id: m.lead_id, conversion_id: null,
    });
    expect(fila.recibida_at).toBeTruthy();
    expect(fila).not.toHaveProperty('datos_admision');
    for (const k of ['solicitudes', 'pendientes', 'validadas', 'rechazadas']) expect(lista.body.stats).toHaveProperty(k);

    const ficha = await api.get(`/api/matriculas/${m.id}`).set(como());
    expect(ficha.body.data).toMatchObject({ persona: { nombre: 'Rosa Contrato' }, proyecto: `${MARCA} Campus`, documento: '44444444A' });
    expect(ficha.body.data.datos_admision.firma).toBe(dataUri);
    expect(ficha.body.data.firma_url).toMatch(/[?&]sig=/);
    expect(Array.isArray(ficha.body.data.historial)).toBe(true);
  });
});

describe('quién administra los webhooks: admin y super admin, cada uno sus campus', () => {
  // La URL con el token es la llave y la muestra trae datos de una persona: lo mismo
  // que el webhook de transferencias.
  const como = (id, role) => ({ Authorization: `Bearer ${jwt.sign({ userId: id, role }, process.env.JWT_SECRET, { expiresIn: '5m' })}` });
  let ADMIN; let AJENO; let SOPORTE; let SUPER;

  beforeAll(async () => {
    const usuario = async (n, role) => (await q(
      `INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', $3) RETURNING id`,
      [`${MARCA} ${n}`, correo(n), role]))[0];
    ADMIN = await usuario('admin', 'admin');
    AJENO = await usuario('ajeno', 'admin');
    SOPORTE = await usuario('soporte', 'soporte');
    SUPER = await usuario('super', 'superadmin');
    await q('INSERT INTO user_projects (user_id, project_id) VALUES ($1, $2)', [ADMIN.id, PROYECTO.id]);
  });

  afterAll(async () => {
    await q('DELETE FROM user_projects WHERE user_id = ANY($1::int[])', [[ADMIN.id, AJENO.id, SOPORTE.id, SUPER.id]]);
    await q('DELETE FROM users WHERE id = ANY($1::int[])', [[ADMIN.id, AJENO.id, SOPORTE.id, SUPER.id]]);
  });

  it('el admin del campus lo ve, lo crea, escucha y lo cambia', async () => {
    const lista = await request.get(`/api/webhook-tokens?projectId=${PROYECTO.id}`).set(como(ADMIN.id, 'admin'));
    expect(lista.status).toBe(200);
    expect(lista.body.data.some((t) => t.id === TOKEN.id)).toBe(true);
    const nuevo = await request.post('/api/webhook-tokens').set(como(ADMIN.id, 'admin'))
      .send({ project_id: PROYECTO.id, kind: 'matriculas' });
    expect(nuevo.status).toBe(201);
    expect((await request.post(`/api/webhook-tokens/${nuevo.body.data.id}/listen`).set(como(ADMIN.id, 'admin'))).status).toBe(200);
    expect((await request.get(`/api/webhook-tokens/${nuevo.body.data.id}/status`).set(como(ADMIN.id, 'admin'))).status).toBe(200);
    expect((await request.delete(`/api/webhook-tokens/${nuevo.body.data.id}`).set(como(ADMIN.id, 'admin'))).status).toBe(200);
  });

  it('un admin de otro campus: 403 en todo, y no se toca nada', async () => {
    const h = como(AJENO.id, 'admin');
    expect((await request.get(`/api/webhook-tokens?projectId=${PROYECTO.id}`).set(h)).status).toBe(403);
    expect((await request.get(`/api/webhook-tokens/${TOKEN.id}/status`).set(h)).status).toBe(403);
    expect((await request.post('/api/webhook-tokens').set(h).send({ project_id: PROYECTO.id, kind: 'matriculas' })).status).toBe(403);
    expect((await request.patch(`/api/webhook-tokens/${TOKEN.id}`).set(h).send({ active: false })).status).toBe(403);
    expect((await request.post(`/api/webhook-tokens/${TOKEN.id}/listen`).set(h)).status).toBe(403);
    expect((await request.post(`/api/webhook-tokens/${TOKEN.id}/listen/stop`).set(h)).status).toBe(403);
    expect((await request.delete(`/api/webhook-tokens/${TOKEN.id}`).set(h)).status).toBe(403);
    expect((await tokenModel.findById(TOKEN.id)).active).toBe(true);
  });

  it('gestora y soporte: 403, aunque la gestora esté en el campus', async () => {
    for (const h of [como(GESTORA.id, 'gestor'), como(SOPORTE.id, 'soporte')]) {
      expect((await request.get(`/api/webhook-tokens?projectId=${PROYECTO.id}`).set(h)).status).toBe(403);
      expect((await request.get(`/api/webhook-tokens/${TOKEN.id}/status`).set(h)).status).toBe(403);
      expect((await request.patch(`/api/webhook-tokens/${TOKEN.id}`).set(h).send({ notas: 'x' })).status).toBe(403);
    }
  });

  it('sin sesión: 401; el super admin, cualquier campus', async () => {
    expect((await request.get(`/api/webhook-tokens?projectId=${PROYECTO.id}`)).status).toBe(401);
    expect((await request.get(`/api/webhook-tokens/${TOKEN.id}/status`).set(como(SUPER.id, 'superadmin'))).status).toBe(200);
  });

  it('el envío público sigue sin sesión: la llave es el token', async () => {
    expect((await recibir().send({ email: correo('publico'), nombre: 'Público' })).status).toBe(200);
  });
});
