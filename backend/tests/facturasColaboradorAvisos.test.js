import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';

// Nada sale de verdad: Brevo y R2, simulados.
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async () => ({ sent: true })),
}));
vi.mock('../src/shared/services/r2.service.js', () => ({
  uploadToR2: vi.fn(async (key) => key),
  getFromR2: vi.fn(async (key) => ({ body: { transformToByteArray: async () => Buffer.from(`%PDF-1.4 ${key}`) } })),
  deleteFromR2: vi.fn(),
}));
vi.mock('../src/shared/utils/presignedUrl.js', () => ({
  generatePresignedUrl: vi.fn(async (key) => `https://r2.test/${key}?firmado`),
}));
// El latido, sin intervalos de verdad: solo se mira qué tareas se ponen en marcha.
vi.mock('../src/jobs/latido.js', async (original) => ({ ...(await original()), vigilar: vi.fn() }));

import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import app from '../src/app.js';
import pool from '../src/shared/config/db.js';
import { sendEmail } from '../src/shared/services/brevo.service.js';
import { vigilar } from '../src/jobs/latido.js';
import { huella, enlaceDeLaSemilla } from '../src/modules/facturas-colaborador/facturas.service.js';
import {
  avisarLlegadas, resumenPorPagar, tokenDeConfirmacion, diaEnMadrid,
} from '../src/modules/facturas-colaborador/avisos.service.js';
import { armarLlegadas, armarPorPagar, destinatariosDe } from '../src/modules/facturas-colaborador/avisos.emails.js';
import { runPorPagar, startFacturasColaboradorAvisosScheduler } from '../src/jobs/facturasColaboradorAvisosJob.js';

/**
 * Facturas de colaboradores (#202) · los avisos de Diego del 04/11.
 *
 *   1. «Han llegado N facturas» al correo de facturación de la empresa, juntas si
 *      llegan seguidas (CRM#613).
 *   2. «Faltan N facturas por pagar», una vez al día por empresa.
 *   3. «He recibido el pago y lo confirmo» en el correo de «Factura pagada», con
 *      su opinión (1 a 5 y un comentario).
 *
 * Sus meses son enero, febrero y marzo de 2026: los demás ficheros no los usan.
 *
 *   cd backend && npx vitest run tests/facturasColaboradorAvisos.test.js
 */

process.env.CLOUDFLARE_R2_ACCOUNT_ID = 'cuenta-de-prueba';
process.env.CLOUDFLARE_R2_ACCESS_KEY = 'clave-de-prueba';
process.env.CLOUDFLARE_R2_BUCKET = 'cubo-de-prueba';

const request = supertest(app);
const API = '/api/facturas-colaborador';
const MARCA = `FCAVI${Date.now().toString(36)}`;
const MARZO = '2026-03-01';
const FEBRERO = '2026-02-01';
const ENERO = '2026-01-01';
const PDF = Buffer.from('%PDF-1.4\n% factura de prueba\n');

const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];

const CORREO_A = `facturacion_${MARCA.toLowerCase()}@test.local`;
const E = {};   // empresas
const P = {};   // campus
const C = {};   // colaboradores
const F = {};   // facturas
let admin;
let tokenAdmin;

const encender = () => { process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS = 'true'; };
const apagar = () => { delete process.env.FACTURAS_COLABORADOR_CORREOS_ACTIVOS; };
const correosA = (email) => sendEmail.mock.calls.map((c) => c[0]).filter((c) => c.to.some((d) => d.email === email));
const registro = (id, evento) => q(
  'SELECT detalle, ip FROM facturas_colaborador_registro WHERE factura_id = $1 AND evento = $2 ORDER BY id', [id, evento]);
const fila = (id) => one(
  `SELECT aviso_empresa_at, pago_confirmado_at, pago_valoracion, pago_comentario, pago_feedback_at
     FROM facturas_colaborador WHERE id = $1`, [id]);

async function colaborador(clave, empresa) {
  C[clave] = await one(
    `INSERT INTO colaboradores (nombre, email, area) VALUES ($1, $2, 'seo') RETURNING id, nombre, email`,
    [`${MARCA} ${clave}`, `${clave}_${MARCA.toLowerCase()}@test.local`]);
  await q('INSERT INTO colaborador_empresas (colaborador_id, issuer_id) VALUES ($1, $2)', [C[clave].id, empresa.id]);
  return C[clave];
}

/** Una factura ya recibida hace `hace` minutos, todavía sin avisar a la empresa. */
async function recibida(clave, colab, empresa, { periodo = MARZO, importe = 600, moneda = 'EUR', hace = 10 } = {}) {
  F[clave] = (await one(
    `INSERT INTO facturas_colaborador
       (colaborador_id, issuer_id, periodo, subida_at, numero_recepcion, importe, moneda, numero_factura, archivo_key, tamano)
     VALUES ($1, $2, $3, NOW() - make_interval(mins => $4::int), $5, $6, $7, $8, $9, 30) RETURNING id`,
    [colab.id, empresa.id, periodo, hace, `REC-AV-${clave}-${MARCA}`, importe, moneda, `F-${clave}`,
      `facturas-colaborador/2026-03/${clave}/2026-03_${MARCA}_${clave}.pdf`])).id;
  return F[clave];
}

const ponerSubida = (id, minutos) => q(
  'UPDATE facturas_colaborador SET subida_at = NOW() - make_interval(mins => $2::int) WHERE id = $1', [id, minutos]);

beforeAll(async () => {
  apagar();
  E.A = await one(
    'INSERT INTO invoice_issuers (razon_social, nif, email) VALUES ($1, $2, $3) RETURNING id, razon_social',
    [`${MARCA}A Formación, S.L.`, `BA${Date.now().toString().slice(-7)}`, CORREO_A]);
  E.B = await one(
    'INSERT INTO invoice_issuers (razon_social, nif) VALUES ($1, $2) RETURNING id, razon_social',
    [`${MARCA}B Consultoría, S.L.`, `BB${Date.now().toString().slice(-7)}`]);
  for (const k of ['A', 'B']) {
    P[k] = await one(
      `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id, logo_url)
       VALUES ($1, $2, $3, $4, 'https://logo.prueba/marca.png') RETURNING id, nombre`,
      [`${MARCA} Campus ${k}`, `${MARCA.toLowerCase()}-${k.toLowerCase()}`, `${MARCA}-key-${k}`, E[k].id]);
  }
  await colaborador('laura', E.A);
  await colaborador('ana', E.A);
  await colaborador('pedro', E.A);
  await colaborador('sinCorreo', E.B);
  admin = await one(`INSERT INTO users (nombre, email, password_hash, role) VALUES ($1, $2, 'x', 'superadmin') RETURNING id`,
    [`${MARCA} super`, `super_${MARCA.toLowerCase()}@test.local`]);
  tokenAdmin = jwt.sign({ userId: admin.id, role: 'superadmin', roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET, { expiresIn: '1h' });
});

afterEach(() => apagar());

afterAll(async () => {
  apagar();
  const ids = Object.values(C).map((c) => c.id);
  await q(`DELETE FROM facturas_colaborador_registro
            WHERE colaborador_id = ANY($1::int[])
               OR factura_id IN (SELECT id FROM facturas_colaborador WHERE colaborador_id = ANY($1::int[]))`, [ids]);
  await q(`DELETE FROM admin_notifications WHERE type = 'factura_colaborador'
            AND (metadata->>'factura_id')::int IN (SELECT id FROM facturas_colaborador WHERE colaborador_id = ANY($1::int[]))`, [ids]);
  await q('DELETE FROM facturas_colaborador WHERE colaborador_id = ANY($1::int[])', [ids]);
  await q('DELETE FROM colaboradores WHERE id = ANY($1::int[])', [ids]);
  await q('DELETE FROM users WHERE id = $1', [admin.id]);
  await q('DELETE FROM projects WHERE id = ANY($1::int[])', [Object.values(P).map((p) => p.id)]);
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [Object.values(E).map((e) => e.id)]);
  await pool.end();
});

/* ─────────────────────────── 1. «Han llegado N facturas» ─────────────────────────── */

describe('aviso de llegada a la empresa (CRM#613, Diego 04/11)', () => {
  it('al subir por el enlace, la factura queda en la cola del aviso (sin avisar todavía)', async () => {
    const semilla = crypto.randomBytes(32).toString('hex');
    const token = enlaceDeLaSemilla(semilla);
    const { id } = await one(
      `INSERT INTO facturas_colaborador (colaborador_id, issuer_id, periodo, token_hash, token_semilla, caduca_at)
       VALUES ($1, $2, $3, $4, $5, NOW() + interval '5 days') RETURNING id`,
      [C.laura.id, E.A.id, MARZO, huella(token), semilla]);
    F.laura = id;
    const res = await request.post(`${API}/enlace/${token}`)
      .field('importe', '600').field('numero_factura', 'F-LAURA-03')
      .attach('archivo', PDF, 'factura.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = await one('SELECT subida_at, aviso_empresa_at FROM facturas_colaborador WHERE id = $1', [id]);
    expect(r.subida_at).not.toBeNull();
    expect(r.aviso_empresa_at).toBeNull();
  });

  it('mientras siguen llegando (menos de 5 minutos desde la última) no se avisa', async () => {
    encender();
    sendEmail.mockClear();
    await recibida('ana', C.ana, E.A, { hace: 1, importe: 300, moneda: 'USD' });
    await recibida('pedro', C.pedro, E.A, { hace: 20, importe: 372 });
    await ponerSubida(F.laura, 2);
    await avisarLlegadas();
    expect(correosA(CORREO_A)).toHaveLength(0);
    expect((await fila(F.pedro)).aviso_empresa_at).toBeNull();
  });

  it('cuando paran, las tres van JUNTAS en un solo correo al correo de facturación de la empresa', async () => {
    encender();
    sendEmail.mockClear();
    await ponerSubida(F.laura, 7);
    await ponerSubida(F.ana, 6);
    const r = await avisarLlegadas();
    expect(r.avisos).toBeGreaterThanOrEqual(1);
    const correos = correosA(CORREO_A);
    expect(correos).toHaveLength(1);
    const c = correos[0];
    expect(c.subject).toBe(`Han llegado 3 facturas de colaboradores · ${MARCA}A`);
    // La lista: colaborador, mes e importe de cada una, cada moneda por su lado.
    for (const n of ['laura', 'ana', 'pedro']) expect(c.htmlContent).toContain(`${MARCA} ${n}`);
    expect(c.htmlContent).toContain('marzo 2026');
    expect(c.htmlContent).toContain('972,00 €');
    expect(c.htmlContent).toContain('300,00 US$');
    // Con el botón al CRM y la marca del campus (P.correo, norma del 10/10).
    expect(c.htmlContent).toContain('/accounting/facturas-colaboradores?vista=enviadas');
    expect(c.htmlContent).toContain(`${MARCA} Campus A`);
    expect(c.projectId).toBe(P.A.id);
    // Las copias adjuntas.
    expect(c.attachment).toHaveLength(3);
    expect(c.clave).toMatch(/^facturas-colaborador-aviso-empresa-/);
    for (const k of ['laura', 'ana', 'pedro']) {
      expect((await fila(F[k])).aviso_empresa_at).not.toBeNull();
      const [ev] = await registro(F[k], 'aviso_empresa');
      expect(ev.detalle).toMatchObject({ para: CORREO_A, junto_con: 3 });
    }
  });

  it('otra vuelta no las vuelve a avisar', async () => {
    encender();
    sendEmail.mockClear();
    await avisarLlegadas();
    expect(correosA(CORREO_A)).toHaveLength(0);
  });

  it('si alguien sube sin parar, la primera no espera más de 30 minutos', async () => {
    encender();
    sendEmail.mockClear();
    await recibida('pedroFeb', C.pedro, E.A, { periodo: FEBRERO, hace: 31 });
    await recibida('anaFeb', C.ana, E.A, { periodo: FEBRERO, hace: 1 });
    await avisarLlegadas();
    const [c] = correosA(CORREO_A);
    expect(c.subject).toBe(`Han llegado 2 facturas de colaboradores · ${MARCA}A`);
  });

  it('con una sola, el asunto es el del comprobante: «Factura recibida · colaborador · mes · recepción»', async () => {
    encender();
    sendEmail.mockClear();
    await recibida('lauraFeb', C.laura, E.A, { periodo: FEBRERO, hace: 8 });
    await avisarLlegadas();
    const [c] = correosA(CORREO_A);
    expect(c.subject).toBe(`Factura recibida · ${MARCA} laura · febrero 2026 · REC-AV-lauraFeb-${MARCA}`);
    expect(c.htmlContent).toContain('Ha llegado 1 factura de colaborador');
  });

  it('si la empresa no tiene correo de facturación, no se manda, queda en el registro y no se reintenta', async () => {
    encender();
    sendEmail.mockClear();
    await recibida('deB', C.sinCorreo, E.B, { hace: 9 });
    await avisarLlegadas();
    expect(sendEmail.mock.calls.filter((x) => x[0].subject.includes(`${MARCA}B`))).toHaveLength(0);
    const [ev] = await registro(F.deB, 'aviso_empresa_fallido');
    expect(ev.detalle.motivo).toContain('no tiene correo de facturación');
    expect((await fila(F.deB)).aviso_empresa_at).not.toBeNull();
  });

  it('con los correos apagados no llama a Brevo, y al encenderlos no sale de golpe lo de antes', async () => {
    apagar();
    sendEmail.mockClear();
    await recibida('apagado', C.laura, E.A, { periodo: ENERO, hace: 9 });
    await avisarLlegadas();
    expect(sendEmail).not.toHaveBeenCalled();
    expect((await fila(F.apagado)).aviso_empresa_at).not.toBeNull();
    encender();
    await avisarLlegadas();
    expect(correosA(CORREO_A)).toHaveLength(0);
  });

  it('el campo de correo admite varias direcciones', () => {
    expect(destinatariosDe('a@x.com, b@y.es; mal')).toEqual([{ email: 'a@x.com' }, { email: 'b@y.es' }]);
    expect(destinatariosDe(null)).toEqual([]);
  });

  it('los nombres se escapan en el correo', () => {
    const { htmlContent } = armarLlegadas({
      empresa: { id: 1, razon_social: 'X & <Y>' },
      facturas: [{ id: 1, periodo: MARZO, importe: 1, moneda: 'EUR', colaborador_nombre: '<b>Muñoz</b>' }],
    });
    expect(htmlContent).toContain('&lt;b&gt;Muñoz&lt;/b&gt;');
    expect(htmlContent).not.toContain('<b>Muñoz</b>');
  });
});

/* ─────────────────────────── 2. «Faltan N facturas por pagar» ─────────────────────────── */

describe('resumen diario «Faltan facturas por pagar» (Diego 04/11)', () => {
  // 10:00 de Madrid un día cualquiera: el resumen se cuenta por día.
  const MANANA = new Date('2026-11-05T09:00:00Z');
  const OTRO_DIA = new Date('2026-11-06T09:00:00Z');
  const resumenesDeA = (dia) => q('SELECT * FROM facturas_colaborador_resumenes WHERE issuer_id = $1 AND dia = $2::date', [E.A.id, dia]);

  it('antes de las 09:00 de Madrid no hace nada', async () => {
    encender();
    sendEmail.mockClear();
    const r = await runPorPagar({ ahora: new Date('2026-11-05T07:30:00Z') });  // 08:30 en Madrid
    expect(r).toEqual({ omitido: 'fuera de hora' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('a las 09:00, uno por empresa con cuántas, el total y cuánto llevan esperando', async () => {
    encender();
    sendEmail.mockClear();
    // La de pedro, recibida hace 12 días.
    await q("UPDATE facturas_colaborador SET subida_at = NOW() - interval '12 days' WHERE id = $1", [F.pedro]);
    await runPorPagar({ ahora: MANANA });
    const correos = correosA(CORREO_A);
    expect(correos).toHaveLength(1);
    const [c] = correos;
    const pendientes = (await q(
      `SELECT COUNT(*)::int AS n FROM facturas_colaborador
        WHERE issuer_id = $1 AND subida_at IS NOT NULL AND pagada_at IS NULL AND anulada_at IS NULL`, [E.A.id]))[0].n;
    expect(c.subject).toBe(`Faltan ${pendientes} facturas de colaboradores por pagar · ${MARCA}A`);
    expect(c.htmlContent).toContain(`${MARCA} pedro`);
    expect(c.htmlContent).toContain('12 días');
    expect(c.htmlContent).toContain('/accounting/facturas-colaboradores?vista=por_pagar');
    expect(c.htmlContent).toContain(`${MARCA} Campus A`);
    expect(c.clave).toBe(`facturas-colaborador-por-pagar-${E.A.id}-2026-11-05`);
    const [fila5] = await resumenesDeA('2026-11-05');
    expect(fila5).toMatchObject({ enviado: true, facturas: pendientes });
  });

  it('el mismo día no sale otro; al día siguiente, sí', async () => {
    encender();
    sendEmail.mockClear();
    await runPorPagar({ ahora: new Date('2026-11-05T15:00:00Z') });
    expect(correosA(CORREO_A)).toHaveLength(0);
    await runPorPagar({ ahora: OTRO_DIA });
    expect(correosA(CORREO_A)).toHaveLength(1);
  });

  it('sin pendientes no manda nada', async () => {
    encender();
    // Todas las de A, pagadas.
    await q("UPDATE facturas_colaborador SET pagada_at = '2026-11-01' WHERE issuer_id = $1 AND subida_at IS NOT NULL", [E.A.id]);
    sendEmail.mockClear();
    await resumenPorPagar({ ahora: new Date('2026-11-07T09:00:00Z') });
    expect(correosA(CORREO_A)).toHaveLength(0);
    expect(await resumenesDeA('2026-11-07')).toHaveLength(0);
    await q('UPDATE facturas_colaborador SET pagada_at = NULL WHERE issuer_id = $1', [E.A.id]);
  });

  it('el día se cuenta en Madrid', () => {
    expect(diaEnMadrid(new Date('2026-11-05T23:30:00Z'))).toBe('2026-11-06');
  });

  it('una sola, en singular', () => {
    const { asunto, htmlContent } = armarPorPagar({
      empresa: { id: 1, razon_social: 'CEDIA Formación, S.L.' },
      facturas: [{ id: 1, periodo: MARZO, importe: 600, moneda: 'EUR', colaborador_nombre: 'Laura', dias: 1 }],
    });
    expect(asunto).toBe('Falta 1 factura de colaborador por pagar · CEDIA');
    expect(htmlContent).toContain('1 día');
  });

  it('cada trabajo se apaga con su interruptor *_DISABLED', () => {
    vigilar.mockClear();
    process.env.FACTURAS_COLABORADOR_LLEGADAS_DISABLED = '1';
    process.env.FACTURAS_COLABORADOR_POR_PAGAR_DISABLED = '1';
    startFacturasColaboradorAvisosScheduler();
    expect(vigilar).not.toHaveBeenCalled();
    delete process.env.FACTURAS_COLABORADOR_POR_PAGAR_DISABLED;
    startFacturasColaboradorAvisosScheduler();
    expect(vigilar.mock.calls.map((c) => c[0])).toEqual(['facturas_colaborador_por_pagar']);
    delete process.env.FACTURAS_COLABORADOR_LLEGADAS_DISABLED;
    vigilar.mockClear();
    startFacturasColaboradorAvisosScheduler();
    expect(vigilar.mock.calls.map((c) => c[0])).toEqual(['facturas_colaborador_llegadas', 'facturas_colaborador_por_pagar']);
  });
});

/* ─────────────────────────── 3. «He recibido el pago y lo confirmo» ─────────────────────────── */

describe('«He recibido el pago y lo confirmo» y su opinión (Diego 04/11)', () => {
  let token;
  const pagar = (ids) => request.post(`${API}/facturas/pagar`).set('Authorization', `Bearer ${tokenAdmin}`)
    .field('ids', ids.join(',')).field('fecha', '2026-11-03').field('forma_pago', 'transferencia');
  const enlaceDelCorreo = (c) => c.htmlContent.match(/factura-colaborador\/pago\/(\d+\.\d+\.[A-Za-z0-9_-]{43})/)?.[1];

  it('el correo de «Factura pagada» lleva el botón, con su enlace firmado', async () => {
    encender();
    sendEmail.mockClear();
    const res = await pagar([F.laura]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    await vi.waitFor(() => expect(correosA(C.laura.email)).toHaveLength(1));
    const [c] = correosA(C.laura.email);
    expect(c.htmlContent).toContain('He recibido el pago y lo confirmo');
    token = enlaceDelCorreo(c);
    expect(token).toBe(tokenDeConfirmacion(F.laura, 1));
  });

  it('el enlace se abre sin entrar y enseña su factura, sin confirmar todavía', async () => {
    const res = await request.get(`${API}/pago/${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({
      colaborador: `${MARCA} laura`, mes: 'marzo de 2026', importe: 600, moneda: 'EUR',
      pagada_at: '2026-11-03', forma_pago: 'transferencia', confirmado_at: null, opinion: null,
    });
    expect(res.body.data.marca).toMatchObject({ nombre: `${MARCA} Campus A` });
  });

  it('abrir el enlace (GET), aunque sea varias veces, no confirma nada ni deja rastro', async () => {
    // Los antivirus y filtros de correo de las empresas abren los enlaces solos (Diego, 04/11).
    for (let i = 0; i < 3; i++) expect((await request.get(`${API}/pago/${token}`)).status).toBe(200);
    expect(await fila(F.laura)).toMatchObject({ pago_confirmado_at: null, pago_feedback_at: null });
    expect(await registro(F.laura, 'pago_confirmado')).toHaveLength(0);
    expect((await request.get(`${API}/pago/${token}`)).body.data.confirmado_at).toBeNull();
  });

  it('opinar antes de confirmar no se puede', async () => {
    const res = await request.post(`${API}/pago/${token}/opinion`).send({ valoracion: 5 });
    expect(res.status).toBe(409);
  });

  it('confirmar apunta la fecha y queda en el registro; la segunda vez no la cambia', async () => {
    const res = await request.post(`${API}/pago/${token}/confirmar`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const antes = (await fila(F.laura)).pago_confirmado_at;
    expect(antes).not.toBeNull();
    expect(res.body.data.confirmado_at).not.toBeNull();
    expect(await registro(F.laura, 'pago_confirmado')).toHaveLength(1);
    const otra = await request.post(`${API}/pago/${token}/confirmar`);
    expect(otra.status).toBe(200);
    expect((await fila(F.laura)).pago_confirmado_at).toEqual(antes);
    expect(await registro(F.laura, 'pago_confirmado')).toHaveLength(1);
  });

  it('la opinión: de 1 a 5 y un comentario; se guarda una sola vez', async () => {
    expect((await request.post(`${API}/pago/${token}/opinion`).send({ valoracion: 7 })).status).toBe(400);
    expect((await request.post(`${API}/pago/${token}/opinion`).send({})).status).toBe(400);
    const res = await request.post(`${API}/pago/${token}/opinion`).send({ valoracion: 4, comentario: '  Todo bien, un poco tarde  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.opinion).toMatchObject({ valoracion: 4, comentario: 'Todo bien, un poco tarde' });
    expect(await fila(F.laura)).toMatchObject({ pago_valoracion: 4, pago_comentario: 'Todo bien, un poco tarde' });
    const [ev] = await registro(F.laura, 'pago_opinion');
    expect(ev.detalle).toMatchObject({ valoracion: 4, comentario: 'Todo bien, un poco tarde' });
    const otra = await request.post(`${API}/pago/${token}/opinion`).send({ valoracion: 1 });
    expect(otra.status).toBe(409);
    expect((await fila(F.laura)).pago_valoracion).toBe(4);
  });

  it('administración lo ve en la lista: «Pago confirmado por el colaborador» y su opinión', async () => {
    const res = await request.get(`${API}/facturas?vista=pagadas&periodo=2026-03`).set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const f = res.body.data.facturas.find((x) => x.id === F.laura);
    expect(f.pago_confirmado_at).not.toBeNull();
    expect(f).toMatchObject({ pago_valoracion: 4, pago_comentario: 'Todo bien, un poco tarde' });
  });

  it('un enlace tocado o inventado no vale', async () => {
    const [id, vez, sig] = token.split('.');
    const tocado = `${id}.${vez}.${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`;
    expect((await request.get(`${API}/pago/${tocado}`)).status).toBe(404);
    expect((await request.get(`${API}/pago/${F.ana}.${vez}.${sig}`)).status).toBe(404);
    expect((await request.get(`${API}/pago/no-es-un-enlace`)).status).toBe(404);
    expect((await request.post(`${API}/pago/${tocado}/confirmar`)).status).toBe(404);
  });

  it('si se deshace el pago, el enlace deja de valer y la confirmación se borra; el nuevo pago trae otro', async () => {
    encender();
    const des = await request.post(`${API}/facturas/${F.laura}/deshacer-pago`).set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ motivo: 'Fecha equivocada' });
    expect(des.status, JSON.stringify(des.body)).toBe(200);
    expect(await fila(F.laura)).toMatchObject({ pago_confirmado_at: null, pago_valoracion: null, pago_comentario: null, pago_feedback_at: null });
    expect((await request.get(`${API}/pago/${token}`)).status).toBe(404);
    sendEmail.mockClear();
    expect((await pagar([F.laura])).status).toBe(200);
    await vi.waitFor(() => expect(correosA(C.laura.email)).toHaveLength(1));
    const nuevo = enlaceDelCorreo(correosA(C.laura.email)[0]);
    expect(nuevo).toBe(tokenDeConfirmacion(F.laura, 2));
    expect((await request.get(`${API}/pago/${nuevo}`)).body.data.confirmado_at).toBeNull();
  });
});
