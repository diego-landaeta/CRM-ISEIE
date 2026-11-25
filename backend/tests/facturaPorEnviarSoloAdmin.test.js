import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * 25/11 · «Por enviar» y envío solo para administración (Diego, máxima prioridad):
 *   · sin cobro (venta o link solo para el enlace de Stripe) no sale nada;
 *   · FACTURA_ENVIO_REVISION_ADMIN=1: ni formulario ni PDF al alumno; la factura
 *     sale con la ficha y queda «Por enviar»; sin ficha completa, a revisión;
 *   · la gestora carga los datos en la venta y la factura sale «Por enviar»;
 *   · «Enviar factura automáticamente» solo con `facturas.envio_auto` (admin).
 *
 * Lo de antes, en facturaAutoEnvio764.test.js:
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

const MARCA = `PE25_${Date.now().toString(36)}`;
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
  delete process.env.FACTURA_ENVIO_REVISION_ADMIN;
});

afterAll(async () => {
  delete process.env.FACTURA_AUTOMATICA_ACTIVA;
  delete process.env.FACTURA_AUTOMATICA_CAMPUS;
  delete process.env.FACTURA_ENVIO_REVISION_ADMIN;
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


const catalogo = await import('../src/modules/permissions/catalogo.js');

async function fichaCompleta(v, nif) {
  await q(`UPDATE leads SET identificacion_fiscal = $2, direccion_fiscal = 'Calle del Olmo 3',
            codigo_postal_fiscal = '28005', ciudad_fiscal = 'Madrid', pais_fiscal = 'España' WHERE id = $1`, [v.lead_id, nif]);
}
const filaDe = (v) => q('SELECT * FROM factura_datos_fiscales WHERE conversion_id = $1', [v.id]).then((r) => r[0] || null);

describe('25/11 · sin cobro no hay factura', () => {
  it('una venta sin pago (la del link de Stripe) no manda formulario ni emite nada', async () => {
    const v = await venta('sin.cobro.pe25@example.com', 300);
    expect(correos).toHaveLength(0);
    expect(await filaDe(v)).toBeNull();
    expect(await facturasDe(v)).toHaveLength(0);
  });

  it('con el cobro, la factura es por lo cobrado, no por el total', async () => {
    process.env.FACTURA_ENVIO_REVISION_ADMIN = '1';
    const v = await venta('cobrado.pe25@example.com', 900);
    await fichaCompleta(v, '00000003A');
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 300) });
    const [inv] = await facturasDe(v);
    expect(Number(inv.total)).toBe(300);
  });
});

describe('25/11 · «Por enviar» (FACTURA_ENVIO_REVISION_ADMIN)', () => {
  beforeEach(() => { process.env.FACTURA_ENVIO_REVISION_ADMIN = '1'; });

  it('con la ficha completa: factura con su número, sin formulario ni PDF al alumno, «Por enviar»', async () => {
    const v = await venta('ficha.ok.pe25@example.com', 400);
    await fichaCompleta(v, '00000006Y');
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 400) });
    expect(peticiones()).toHaveLength(0);
    expect(conPdf()).toHaveLength(0);
    const [inv] = await facturasDe(v);
    expect(inv.codigo).toBeTruthy();
    expect(inv.sent_at).toBeNull();
    expect(inv.envio_nota).toBe(envio.NOTA_POR_ENVIAR);
    const p = await panelMod.panel({ projectIds: [proyecto.id] });
    expect(p.por_enviar.map((i) => i.id)).toContain(inv.id);
    expect(p.resumen.por_enviar).toBeGreaterThan(0);
  });

  it('sin ficha completa: a revisión, nada al alumno; la gestora carga los datos y sale «Por enviar»', async () => {
    const v = await venta('ficha.incompleta.pe25@example.com', 500);
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 250) });
    expect(peticiones()).toHaveLength(0);
    expect((await filaDe(v)).estado).toBe('revision');
    expect(await facturasDe(v)).toHaveLength(0);

    const r = await fa.datosDeLaGestora(v.id, {
      nif: '00000007F', direccion: 'Calle del Olmo 3', codigo_postal: '28005', ciudad: 'Madrid', pais: 'España',
    });
    expect(r).toMatchObject({ guardado: true, faltan: [] });
    const [lead] = await q('SELECT identificacion_fiscal, ciudad_fiscal FROM leads WHERE id = $1', [v.lead_id]);
    expect(lead).toMatchObject({ identificacion_fiscal: '00000007F', ciudad_fiscal: 'Madrid' });
    const [inv] = await facturasDe(v);
    expect(Number(inv.total)).toBe(250);
    expect(inv.envio_nota).toBe(envio.NOTA_POR_ENVIAR);
    expect(conPdf()).toHaveLength(0);
  });

  it('«Enviar por WhatsApp»: queda enviada, con la nota y quién; sale de «Por enviar» y no se marca dos veces', async () => {
    const invModel = await import('../src/modules/invoices/invoices.model.js');
    const v = await venta('whatsapp.pe25@example.com', 150);
    await fichaCompleta(v, '00000008P');
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 150) });
    const [inv] = await facturasDe(v);
    expect(inv.envio_nota).toBe(envio.NOTA_POR_ENVIAR);
    const r = await invModel.markSentWhatsapp(inv.id, 'Admin Prueba');
    expect(r.envio_nota).toBe('Enviada por WhatsApp (por Admin Prueba)');
    const [despues] = await facturasDe(v);
    expect(despues.sent_at).toBeTruthy();
    expect(despues.sent_to_email).toBeNull();
    expect(conPdf()).toHaveLength(0);
    const p = await panelMod.panel({ projectIds: [proyecto.id] });
    expect(p.por_enviar.map((i) => i.id)).not.toContain(inv.id);
    expect(await invModel.markSentWhatsapp(inv.id, 'Otra')).toBeNull();
  });

  it('apagado: como hasta hoy, se le pide el formulario al alumno', async () => {
    delete process.env.FACTURA_ENVIO_REVISION_ADMIN;
    const v = await venta('apagado.pe25@example.com', 200);
    await fa.alCobrar({ conversionId: v.id, paymentId: await pagar(v, 200) });
    expect(peticiones()).toHaveLength(1);
  });
});

describe('25/11 · el envío lo eligen solo las administradoras', () => {
  it('`facturas.envio_auto` es de administración, no de la gestora', () => {
    const p = catalogo.POR_CLAVE['facturas.envio_auto'];
    expect(p).toBeTruthy();
    expect(p.roles).toContain('admin');
    expect(p.roles).not.toContain('gestor');
  });

  it('sin el permiso, `envio_factura` se quita del cuerpo antes de guardar', async () => {
    const req = { user: { userId: 1 } };
    const sin = await envio.quitarSiNoPuede(req, { a: 1, envio_factura: { auto: true } }, { puede: async () => false });
    expect(sin).toEqual({ a: 1 });
    const con = await envio.quitarSiNoPuede(req, { a: 1, envio_factura: { auto: false } }, { puede: async (_r, clave) => clave === 'facturas.envio_auto' });
    expect(con).toEqual({ a: 1, envio_factura: { auto: false } });
  });
});
