import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * CRM-ISEIE#452 (gemela de CRM#764) · Factura automática con formulario de datos
 * fiscales.
 *
 *   pago → correo con enlace; formulario → factura; día 7 con ficha completa →
 *   factura; ficha incompleta → cola; cuota 2 → reutiliza; enlace usado,
 *   caducado o falso → rechazado; interruptor apagado → nada.
 *
 * Con base real (la de db-preparar). Lo de fuera, simulado: Brevo (no sale
 * nada), el PDF y el turno de la cola, que dependen del resto de la base.
 */

// Varias pruebas de facturación seguidas contra la base: más margen que el de serie.
vi.setConfig({ testTimeout: 90000, hookTimeout: 60000 });

const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
vi.mock('../src/modules/invoices/invoices.service.js', async (original) => ({
  ...(await original()),
  puedeFacturarAhora: vi.fn(async () => true),
  generatePDF: vi.fn(async () => ({ bytes: Buffer.from('%PDF-1.4 prueba') })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const fa = await import('../src/modules/factura-automatica/factura-automatica.service.js');
const df = await import('../src/modules/factura-automatica/datos-fiscales.js');

const MARCA = `F764_${Date.now().toString(36)}`;
const SERIE = `T${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 7);
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const hoy = new Date().toISOString().slice(0, 10);
let proyecto;
let emisor;

const FICHA_BUENA = {
  nombre: 'Ana Pérez López', email: 'ana.764@example.com',
  identificacion_fiscal: '12345678Z', direccion_fiscal: 'Calle Mayor 1, 2.º B',
  ciudad_fiscal: 'Madrid', codigo_postal_fiscal: '28013', pais_fiscal: 'España',
};
const FORMULARIO = {
  tipo: 'particular', nombre: 'Ana Pérez López', nif: '00000000T',
  direccion: 'Avenida del Puerto 22', codigo_postal: '46021', ciudad: 'Valencia',
  pais: 'España', email: 'facturas.ana@example.com',
};

async function venta(ficha = FICHA_BUENA, total = 300) {
  const [lead] = await q(
    `INSERT INTO leads (nombre, email, project_id, identificacion_fiscal, direccion_fiscal,
                        ciudad_fiscal, codigo_postal_fiscal, pais_fiscal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [ficha.nombre, ficha.email, proyecto.id, ficha.identificacion_fiscal || null, ficha.direccion_fiscal || null,
      ficha.ciudad_fiscal || null, ficha.codigo_postal_fiscal || null, ficha.pais_fiscal || 'España']);
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total: total, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: hoy,
    iva_incluido: true,
  });
  return { ...v, lead_id: lead.id };
}

async function pagar(v, importe = 100) {
  const r = await conversionModel.addPayment(v.id, { importe, fecha: hoy, metodo: 'transferencia' }, { allowDuplicate: true });
  return r.payment.id;
}

const enlaceDe = (c) => /datos-fiscales\/([A-Za-z0-9_.-]+)/.exec(c.htmlContent)?.[1];
const facturasDe = (v) => q('SELECT * FROM invoices WHERE conversion_id = $1 AND estado <> \'cancelada\' ORDER BY id', [v.id]);
const filaDe = (v) => q('SELECT * FROM factura_datos_fiscales WHERE conversion_id = $1', [v.id]).then((r) => r[0]);

beforeAll(async () => {
  [emisor] = await q(
    `INSERT INTO invoice_issuers (razon_social, nif, serie, activo) VALUES ($1, 'B12345674', $2, true) RETURNING id`,
    [`${MARCA} S.L.`, SERIE]);
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id, slug`,
    [MARCA, MARCA.toLowerCase(), MARCA, emisor.id]);
});

beforeEach(() => {
  correos.length = 0;
  process.env.FACTURA_AUTOMATICA_ACTIVA = '1';
  process.env.FACTURA_AUTOMATICA_CAMPUS = String(proyecto.id);
  process.env.FACTURA_AUTOMATICA_ENVIAR_PDF = '1';
});

afterAll(async () => {
  delete process.env.FACTURA_AUTOMATICA_ACTIVA;
  delete process.env.FACTURA_AUTOMATICA_CAMPUS;
  if (proyecto) {
    const ventas = `SELECT id FROM conversions WHERE project_id = ${Number(proyecto.id)}`;
    await q(`DELETE FROM invoices WHERE project_id = $1`, [proyecto.id]);
    await q(`DELETE FROM factura_datos_fiscales WHERE project_id = $1`, [proyecto.id]);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM commissions WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q(`DELETE FROM conversions WHERE project_id = $1`, [proyecto.id]);
    await q(`DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)`, [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM invoice_sequences WHERE serie = $1', [SERIE]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  if (emisor) await q('DELETE FROM invoice_issuers WHERE id = $1', [emisor.id]);
  await pool.end();
});

describe('#452 · el NIF y los datos de una factura', () => {
  it('DNI, NIE y CIF con su control; fuera de España, forma de identificador', () => {
    expect(df.esNifEspanolValido('12345678Z')).toBe(true);
    expect(df.esNifEspanolValido('12345678A')).toBe(false);
    expect(df.esNifEspanolValido('X1234567L')).toBe(true);
    expect(df.esNifEspanolValido('B12345674')).toBe(true);
    expect(df.esNifEspanolValido('B12345675')).toBe(false);
    expect(df.problemas({ ...FORMULARIO, pais: 'México', nif: 'PELA800101AB1', codigo_postal: '' })).toEqual([]);
  });

  it('el nombre de relleno o sin apellido no vale para facturar', () => {
    expect(df.problemas({ ...FORMULARIO, nombre: '+34 600 111 222' })).toContain('el nombre no tiene letras');
    expect(df.problemas({ ...FORMULARIO, nombre: 'Mari' })).toContain('falta el apellido');
    expect(df.problemas({ ...FORMULARIO, tipo: 'empresa', nombre: 'Acme', nif: 'B12345674' })).toEqual([]);
  });
});

describe('#452 · interruptor', () => {
  it('apagado no hace nada: ni fila, ni correo, ni factura', async () => {
    process.env.FACTURA_AUTOMATICA_ACTIVA = '0';
    const v = await venta();
    const pago = await pagar(v);
    expect(await fa.alCobrar({ conversionId: v.id, paymentId: pago })).toBe(false);
    expect(await filaDe(v)).toBeUndefined();
    expect(correos).toHaveLength(0);
    expect(await facturasDe(v)).toHaveLength(0);
  });

  it('encendido pero en otro campus, tampoco', async () => {
    process.env.FACTURA_AUTOMATICA_CAMPUS = '999999,otro-campus';
    const v = await venta();
    expect(await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v) })).toBe(false);
    expect(await filaDe(v)).toBeUndefined();
  });

  it('una venta que ya se facturaba a mano sigue a mano', async () => {
    const v = await venta();
    await q(`INSERT INTO invoices (project_id, conversion_id, serie, ano, numero, codigo, cliente_nombre, cliente_nif,
                               cliente_direccion, cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible,
                               total, estado, tipo)
             VALUES ($1, $2, $3, 2026, 9001, $4, 'x', 'x', 'x', 'x', 'x', 'x', '[]', 10, 10, 'emitida', 'normal')`, [proyecto.id, v.id, SERIE, `${SERIE}-9001`]);
    expect(await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v) })).toBe(false);
    expect(await filaDe(v)).toBeUndefined();
  });
});

describe('#452 · del pago a la factura', () => {
  it('pago → correo al alumno con un enlace; en la base solo su huella; la factura espera', async () => {
    const v = await venta();
    const pago = await pagar(v);
    expect(await fa.alCobrar({ conversionId: v.id, paymentId: pago })).toBe(true);

    expect(correos).toHaveLength(1);
    const c = correos[0];
    expect(c.to[0].email).toBe(FICHA_BUENA.email);
    expect(c.projectId).toBe(proyecto.id);
    expect(c.htmlContent).toContain(MARCA); // la marca del campus
    const token = enlaceDe(c);
    expect(fa.tokenBienFirmado(token)).toBe(true);

    const fila = await filaDe(v);
    expect(fila.estado).toBe('pendiente');
    expect(fila.token_hash).toBe(crypto.createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(fila)).not.toContain(token);
    expect(await facturasDe(v)).toHaveLength(0);

    // La página no enseña datos de nadie: la marca y el nombre de pila.
    const vista = await fa.verFormulario(token);
    expect(vista).toMatchObject({ marca: MARCA, nombre: 'Ana' });
    expect(JSON.stringify(vista)).not.toMatch(/12345678Z|Calle Mayor|example\.com/);
  });

  it('formulario → factura con SUS datos, sin autor; el enlace se quema; cuota 2 reutiliza', async () => {
    const v = await venta();
    const pago1 = await pagar(v);
    await fa.alCobrar({ conversionId: v.id, paymentId: pago1 });
    const token = enlaceDe(correos[0]);

    // Datos que no valen: se dice qué y cuenta como intento.
    await expect(fa.responder(token, { ...FORMULARIO, nif: '12345678A' }))
      .rejects.toMatchObject({ statusCode: 400, code: 'DATOS_NO_VALIDOS' });
    expect((await filaDe(v)).intentos).toBe(1);

    const r = await fa.responder(token, FORMULARIO, '127.0.0.1');
    expect(r).toMatchObject({ guardado: true, facturas: 1 });
    const [f1] = await facturasDe(v);
    expect(f1).toMatchObject({
      payment_id: pago1, cliente_nombre: 'Ana Pérez López', cliente_nif: '00000000T',
      cliente_ciudad: 'Valencia', cliente_email: FORMULARIO.email, created_by: null,
      estado: 'pagada', sent_to_email: FORMULARIO.email, // cobrada y mandada
    });
    expect(Number(f1.datos_fiscales_id)).toBe((await filaDe(v)).id);
    // El PDF, al correo que dio, con la marca.
    const conPdf = correos.find((c) => c.attachment?.length);
    expect(conPdf.to[0].email).toBe(FORMULARIO.email);
    expect(conPdf.projectId).toBe(proyecto.id);

    // Ya en su ficha.
    const [lead] = await q('SELECT identificacion_fiscal, ciudad_fiscal FROM leads WHERE id = $1', [v.lead_id]);
    expect(lead).toEqual({ identificacion_fiscal: '00000000T', ciudad_fiscal: 'Valencia' });

    // Un solo uso.
    await expect(fa.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
    await expect(fa.responder(token, FORMULARIO)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });

    // Cuota 2: sin volver a preguntar.
    correos.length = 0;
    const pago2 = await pagar(v);
    await fa.alCobrar({ conversionId: v.id, paymentId: pago2 });
    const facturas = await facturasDe(v);
    expect(facturas).toHaveLength(2);
    expect(facturas[1]).toMatchObject({ payment_id: pago2, cliente_nif: '00000000T' });
    expect(correos.some((c) => /datos-fiscales\//.test(c.htmlContent))).toBe(false);
    expect(await q('SELECT 1 FROM factura_datos_fiscales WHERE conversion_id = $1', [v.id])).toHaveLength(1);
  });

  it('día 7 sin respuesta y ficha completa → factura con la ficha', async () => {
    const v = await venta();
    const pago = await pagar(v);
    await fa.alCobrar({ conversionId: v.id, paymentId: pago });
    const token = enlaceDe(correos[0]);
    await q(`UPDATE factura_datos_fiscales SET caduca_at = NOW() - INTERVAL '1 minute' WHERE conversion_id = $1`, [v.id]);

    // Caducado: ya no vale.
    await expect(fa.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });

    await fa.vuelta();
    expect((await filaDe(v)).estado).toBe('ficha');
    const [f] = await facturasDe(v);
    expect(f).toMatchObject({ payment_id: pago, cliente_nif: '12345678Z', cliente_ciudad: 'Madrid' });
  });

  it('día 7 con la ficha incompleta → a revisión: el cobro se queda en la cola', async () => {
    const v = await venta({ nombre: 'Contacto WhatsApp', email: 'wa.764@example.com' });
    const pago = await pagar(v);
    await fa.alCobrar({ conversionId: v.id, paymentId: pago });
    await q(`UPDATE factura_datos_fiscales SET caduca_at = NOW() - INTERVAL '1 minute' WHERE conversion_id = $1`, [v.id]);

    await fa.vuelta();
    const fila = await filaDe(v);
    expect(fila.estado).toBe('revision');
    expect(fila.motivo_revision).toMatch(/NIF/);
    expect(await facturasDe(v)).toHaveLength(0);
    // Y una cuota posterior tampoco sale sola.
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v) });
    expect(await facturasDe(v)).toHaveLength(0);
  });

  it('enlace inventado o con la firma cambiada → rechazado sin mirar la base', async () => {
    await expect(fa.verFormulario('nada')).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
    const { token } = fa.nuevoToken();
    const falso = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    expect(fa.tokenBienFirmado(falso)).toBe(false);
    await expect(fa.verFormulario(token)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' }); // bien firmado, pero de nadie
  });

  it('al agotar los intentos el enlace deja de valer y la venta pasa a revisión', async () => {
    process.env.FACTURA_AUTOMATICA_INTENTOS = '2';
    try {
      const v = await venta();
      await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v) });
      const token = enlaceDe(correos[0]);
      await expect(fa.responder(token, { ...FORMULARIO, nif: 'x' })).rejects.toMatchObject({ code: 'DATOS_NO_VALIDOS' });
      await expect(fa.responder(token, { ...FORMULARIO, nif: 'x' })).rejects.toMatchObject({ code: 'SIN_INTENTOS' });
      await expect(fa.responder(token, FORMULARIO)).rejects.toMatchObject({ code: 'ENLACE_NO_VALE' });
      expect((await filaDe(v)).estado).toBe('revision');
      expect(await facturasDe(v)).toHaveLength(0);
    } finally {
      delete process.env.FACTURA_AUTOMATICA_INTENTOS;
    }
  });
});
