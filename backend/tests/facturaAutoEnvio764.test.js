import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * CRM#764 (gemela CRM-ISEIE#452), 24/11 · Con la facturación automática ya
 * encendida en producción:
 *
 *   · «Enviar factura automáticamente: Sí / No». Sí de serie. Con No la factura
 *     se emite igual, pero el PDF no sale y lleva «No se envía automáticamente:
 *     la envía la gestora».
 *   · «Enviar a este correo». El formulario y el PDF van al correo confirmado;
 *     si cambia mientras el formulario espera, se le manda de nuevo.
 *   · La pantalla: formularios, facturas que salieron solas y lo que necesita a
 *     una persona; a una gestora, solo lo de sus alumnos.
 *
 * Con base real. Lo de fuera, simulado como en facturaAutomatica764.test.js.
 */

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
const envio = await import('../src/modules/factura-automatica/factura-automatica.envio.js');
const panelMod = await import('../src/modules/factura-automatica/factura-automatica.panel.js');
const ctrl = await import('../src/modules/factura-automatica/factura-automatica.controller.js');
const invService = await import('../src/modules/invoices/invoices.service.js');

const MARCA = `E764_${Date.now().toString(36)}`;
const SERIE = `E${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 7);
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const hoy = new Date().toISOString().slice(0, 10);
let proyecto;
let emisor;

// Un nombre distinto por prueba: con el mismo nombre, importe y día sería una «posible duplicada» (CRM#819).
const nombreDe = (email) => `Alumna ${email.split('.')[0]} Martín Soler`;
const formulario = (nif, email, nombre) => ({
  tipo: 'particular', nombre, nif, direccion: 'Calle del Olmo 3',
  codigo_postal: '28005', ciudad: 'Madrid', pais: 'España', email,
});

async function venta(email, total) {
  const [lead] = await q(
    'INSERT INTO leads (nombre, email, project_id, pais_fiscal) VALUES ($1, $2, $3, \'España\') RETURNING id',
    [nombreDe(email), email, proyecto.id]);
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total: total, importe_pagado: 0, metodo_pago: 'transferencia', fecha_conversion: hoy, iva_incluido: true,
  });
  return { ...v, lead_id: lead.id };
}
async function pagar(v, importe) {
  const r = await conversionModel.addPayment(v.id, { importe, fecha: hoy, metodo: 'transferencia' }, { allowDuplicate: true });
  return r.payment.id;
}
const enlaceDe = (c) => /datos-fiscales\/([A-Za-z0-9_.-]+)/.exec(c.htmlContent)?.[1];
const peticiones = () => correos.filter((c) => /datos-fiscales\//.test(c.htmlContent));
const conPdf = () => correos.filter((c) => c.attachment?.length);
const facturasDe = (v) => q('SELECT * FROM invoices WHERE conversion_id = $1 AND estado <> \'cancelada\' ORDER BY id', [v.id]);

function llamar(fn, req) {
  return new Promise((resolve, reject) => {
    fn(req, { json: (b) => resolve(b), status() { return this; } }, (err) => (err ? reject(err) : resolve(null)));
  });
}

beforeAll(async () => {
  [emisor] = await q(
    'INSERT INTO invoice_issuers (razon_social, nif, serie, activo) VALUES ($1, \'B12345674\', $2, true) RETURNING id',
    [`${MARCA} S.L.`, SERIE]);
  [proyecto] = await q(
    'INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id, slug',
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
    await q('DELETE FROM invoices WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM factura_datos_fiscales WHERE project_id = $1', [proyecto.id]);
    await q(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
    await q(`DELETE FROM commissions WHERE conversion_id IN (${ventas})`).catch(() => {});
    await q('DELETE FROM conversions WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = $1)', [proyecto.id]);
    await q('DELETE FROM leads WHERE project_id = $1', [proyecto.id]);
    await q('DELETE FROM invoice_sequences WHERE serie = $1', [SERIE]);
    await q('DELETE FROM projects WHERE id = $1', [proyecto.id]);
  }
  if (emisor) await q('DELETE FROM invoice_issuers WHERE id = $1', [emisor.id]);
  await pool.end();
});

describe('#764 · «Enviar factura automáticamente» y «Enviar a este correo»', () => {
  it('de serie: Sí, al correo de la ficha, sin confirmar', async () => {
    const v = await venta('ficha.serie.764@example.com', 301);
    expect(await envio.envioDeLaVenta(v.id)).toMatchObject({
      auto: true, email: null, email_ficha: 'ficha.serie.764@example.com',
      email_efectivo: 'ficha.serie.764@example.com', confirmado: false, nota: null,
    });
  });

  it('Sí con el correo confirmado: el formulario y el PDF van a ese', async () => {
    const v = await venta('ficha.si.764@example.com', 302);
    await envio.guardarEnLaVenta(v.id, { auto: true, email: ' Confirmado.Si.764@Example.com ' }, null);
    expect(await envio.envioDeLaVenta(v.id)).toMatchObject({
      auto: true, email: 'confirmado.si.764@example.com', email_efectivo: 'confirmado.si.764@example.com', confirmado: true,
    });
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 102) });
    expect(peticiones()).toHaveLength(1);
    expect(peticiones()[0].to[0].email).toBe('confirmado.si.764@example.com');

    await fa.responder(enlaceDe(peticiones()[0]), formulario('00000003A', 'otro.del.formulario@example.com', 'Alumna Si Martín Soler'));
    const [inv] = await facturasDe(v);
    expect(inv.sent_to_email).toBe('confirmado.si.764@example.com');
    expect(inv.envio_nota).toBeNull();
    expect(conPdf()).toHaveLength(1);
    expect(conPdf()[0].to[0].email).toBe('confirmado.si.764@example.com');
  });

  it('No: la factura sale igual, sin PDF, con la coletilla; la cola lo dice', async () => {
    const v = await venta('ficha.no.764@example.com', 303);
    await envio.guardarEnLaVenta(v.id, { auto: false, email: null }, null);
    const pago = await pagar(v, 103);
    await fa.alCobrar({ conversionId: v.id, paymentId: pago });
    // El formulario sí sale: sin él la factura saldría con la ficha.
    expect(peticiones()).toHaveLength(1);
    expect(peticiones()[0].to[0].email).toBe('ficha.no.764@example.com');

    const cola = await invService.getFacturacionAlDia(proyecto.id);
    const fila = cola.cola.find((c) => Number(c.payment_id) === Number(pago));
    expect(fila.envio_factura).toMatchObject({ auto: false, email: 'ficha.no.764@example.com' });

    const r = await fa.responder(enlaceDe(peticiones()[0]), formulario('00000004G', 'no.764@example.com', 'Alumna No Martín Soler'));
    expect(r.facturas).toBe(1);
    const [inv] = await facturasDe(v);
    expect(inv.numero).toBeTruthy();
    expect(inv.envio_nota).toBe(envio.NOTA_LA_ENVIA_LA_GESTORA);
    expect(inv.sent_at).toBeNull();
    expect(conPdf()).toHaveLength(0);
    expect((await envio.envioDeLaVenta(v.id)).nota).toBe('No se envía automáticamente: la envía la gestora');
  });

  it('cambiar el correo con el formulario esperando lo manda de nuevo al correo bueno', async () => {
    const v = await venta('mal.escrito.764@example.com', 304);
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 104) });
    expect(peticiones()).toHaveLength(1);
    correos.length = 0;
    const r = await llamar(ctrl.guardarEnvio, {
      params: { conversionId: String(v.id) }, body: { auto: true, email: 'bien.escrito.764@example.com' }, user: { userId: null },
    });
    expect(r.data).toMatchObject({ email_efectivo: 'bien.escrito.764@example.com', formulario_reenviado: true });
    expect(peticiones()).toHaveLength(1);
    expect(peticiones()[0].to[0].email).toBe('bien.escrito.764@example.com');
    // El mismo correo otra vez no vuelve a mandarlo.
    correos.length = 0;
    const otra = await llamar(ctrl.guardarEnvio, {
      params: { conversionId: String(v.id) }, body: { auto: true, email: 'bien.escrito.764@example.com' }, user: { userId: null },
    });
    expect(otra.data.formulario_reenviado).toBe(false);
    expect(correos).toHaveLength(0);
  });

  it('un correo que no es correo no se guarda', async () => {
    const v = await venta('ficha.mala.764@example.com', 305);
    await expect(llamar(ctrl.guardarEnvio, {
      params: { conversionId: String(v.id) }, body: { auto: true, email: 'esto no es un correo' }, user: { userId: null },
    })).rejects.toMatchObject({ statusCode: 400 });
  });

  it('el link de pago pasa lo elegido a la venta que nace al pagarlo; sin elegir, nada', async () => {
    const v = await venta('ficha.link.764@example.com', 306);
    await envio.delLinkALaVenta({ id: 1, factura_envio_auto: null, factura_envio_email: null }, v.id);
    expect((await envio.envioDeLaVenta(v.id)).confirmado).toBe(false);
    await envio.delLinkALaVenta({ id: 1, factura_envio_auto: false, factura_envio_email: 'pago.link.764@example.com' }, v.id);
    expect(await envio.envioDeLaVenta(v.id)).toMatchObject({ auto: false, email_efectivo: 'pago.link.764@example.com' });
  });
});

describe('#764 · la pantalla de la facturación automática', () => {
  it('formularios, facturas solas y lo que necesita a una persona; una gestora, solo lo suyo', async () => {
    // Una en revisión: día 7 sin respuesta y la ficha sin datos.
    const v = await venta('revision.764@example.com', 307);
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 107) });
    await q('UPDATE factura_datos_fiscales SET caduca_at = NOW() - INTERVAL \'1 minute\' WHERE conversion_id = $1', [v.id]);
    await fa.vuelta();

    const p = await panelMod.panel({ projectIds: [proyecto.id] });
    expect(p.resumen.formularios).toBeGreaterThanOrEqual(4);
    expect(p.resumen.contestados).toBeGreaterThanOrEqual(2);
    expect(p.resumen.las_envia_la_gestora).toBeGreaterThanOrEqual(1);
    expect(p.facturas.some((i) => i.envio_nota && !i.sent_at)).toBe(true);
    expect(p.facturas.some((i) => i.sent_to_email === 'confirmado.si.764@example.com')).toBe(true);
    const enRevision = p.atencion.find((a) => Number(a.conversion_id) === Number(v.id));
    expect(enRevision).toMatchObject({ codigo: 'REVISION', donde: 'cola' });
    expect(enRevision.texto).toMatch(/Reenvía el formulario/);
    expect(p.formularios.find((f) => Number(f.conversion_id) === Number(v.id)).situacion).toBe('vencido');

    // Una gestora sin alumnos aquí no ve nada.
    const suyo = await panelMod.panel({ projectIds: [proyecto.id], personas: [-1] });
    expect(suyo.formularios).toEqual([]);
    expect(suyo.facturas).toEqual([]);
  });

  it('en qué punto está cada petición y qué hacer', () => {
    const ahora = new Date('2026-11-24T12:00:00Z');
    expect(panelMod.situacion({ origen_datos: 'formulario', estado: 'respondido' }, ahora)).toBe('contestado');
    expect(panelMod.situacion({ origen_datos: 'ficha', estado: 'ficha' }, ahora)).toBe('vencido');
    expect(panelMod.situacion({ estado: 'pendiente', caduca_at: '2026-11-30T00:00:00Z' }, ahora)).toBe('esperando');
    expect(panelMod.situacion({ estado: 'pendiente', caduca_at: '2026-11-20T00:00:00Z' }, ahora)).toBe('vencido');
    expect(panelMod.necesitaAtencion({ estado: 'respondido', ultimo_error: '[POSIBLE_DUPLICADA] Posible duplicada de la factura 2026/0001' }))
      .toMatchObject({ codigo: 'POSIBLE_DUPLICADA', donde: 'cola' });
    expect(panelMod.necesitaAtencion({ estado: 'pendiente', envio_error: 'La ficha no tiene correo' }))
      .toMatchObject({ codigo: 'SIN_CORREO', donde: 'venta' });
    expect(panelMod.necesitaAtencion({ estado: 'respondido', ultimo_error: null })).toBeNull();
  });
});
