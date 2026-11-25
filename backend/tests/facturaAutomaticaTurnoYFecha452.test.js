import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import crypto from 'node:crypto';

/**
 * CRM-ISEIE#452 (gemela de CRM#764) · Lo que salió al encenderla en /testeo (24/11/2026), contra la base.
 *
 *   1. EL TURNO. Un alumno que no contesta (o cuya ficha no vale) paraba TODAS
 *      las facturas automáticas del campus: «Espera su turno en la cola: hay
 *      cobros anteriores sin facturar». El día 7 tampoco salía la de quien tenía
 *      la ficha completa. Ahora los cobros que esperan datos del alumno o a una
 *      persona no paran a los demás. La cola manual sigue en orden.
 *   2. LA FECHA, EN EL ORDEN DEL NÚMERO. Crear con una fecha anterior a la de la
 *      factura anterior de la serie, «Cambiar fechas» fuera de orden y emitir un
 *      borrador viejo (salía con la fecha del día en que se guardó) → no.
 *   3. EL ENLACE NO SE GUARDA en el registro de correos.
 *
 * La prueba vieja (facturaAutomatica764, aquí también) simula `puedeFacturarAhora` → true:
 * por eso el turno nunca se vio. Aquí va el de verdad.
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/facturaAutomaticaTurnoYFecha452.test.js
 */

vi.setConfig({ testTimeout: 90000, hookTimeout: 60000 });

const correos = [];
vi.mock('../src/shared/services/brevo.service.js', () => ({
  sendEmail: vi.fn(async (c) => { correos.push(c); return { sent: true }; }),
}));
vi.mock('../src/modules/invoices/invoices.service.js', async (original) => ({
  ...(await original()),
  generatePDF: vi.fn(async () => ({ bytes: Buffer.from('%PDF-1.4 prueba') })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const conversionModel = await import('../src/modules/conversions/conversion.model.js');
const fa = await import('../src/modules/factura-automatica/factura-automatica.service.js');
const invModel = await import('../src/modules/invoices/invoices.model.js');
const invService = await import('../src/modules/invoices/invoices.service.js');
const { ENLACE_NO_GUARDADO } = await import('../src/modules/factura-automatica/factura-automatica.emails.js');

const MARCA = `T764_${Date.now().toString(36)}`;
const serieNueva = (l) => `${l}${crypto.randomBytes(3).toString('hex').toUpperCase()}`.slice(0, 7);
const SERIE = serieNueva('U');
const SERIE_F = serieNueva('V');
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
const one = async (sql, params) => (await q(sql, params))[0];
let HOY; let AYER; let MANANA; let HACE5;
let proyecto; let emisor; let proyectoF; let emisorF;

// DNI de prueba con su letra, distinto en cada pasada: la posible duplicada
// (CRM#819) mira el NIF en toda la base, no solo en este campus.
const LETRAS = 'TRWAGMYFPDXBNJZSQVHLCKE';
let semilla = 10000000 + (Date.now() % 80000000);
const dni = () => { semilla += 1; return `${semilla}${LETRAS[semilla % 23]}`; };

const fichaBuena = (nombre) => ({
  nombre, email: `${nombre.split(' ')[0].toLowerCase()}.${MARCA.toLowerCase()}@example.com`,
  identificacion_fiscal: dni(), direccion_fiscal: 'Calle Mayor 1, 2.º B',
  ciudad_fiscal: 'Madrid', codigo_postal_fiscal: '28013', pais_fiscal: 'España',
});
const fichaMala = (nombre) => ({ nombre, email: `${nombre.split(' ')[0].toLowerCase()}.${MARCA.toLowerCase()}@example.com` });

async function venta(ficha, total = 400) {
  const lead = await one(
    `INSERT INTO leads (nombre, email, project_id, identificacion_fiscal, direccion_fiscal,
                        ciudad_fiscal, codigo_postal_fiscal, pais_fiscal)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [ficha.nombre, ficha.email, proyecto.id, ficha.identificacion_fiscal || null, ficha.direccion_fiscal || null,
      ficha.ciudad_fiscal || null, ficha.codigo_postal_fiscal || null, ficha.pais_fiscal || null]);
  const v = await conversionModel.create({
    lead_id: lead.id, project_id: proyecto.id, producto_contratado: `${MARCA} curso`,
    importe_total: total, importe_pagado: 0, metodo_pago: 'tarjeta', fecha_conversion: HOY,
  });
  return { ...v, lead_id: lead.id };
}

async function cobrar(v, importe) {
  const r = await conversionModel.addPayment(v.id, { importe, fecha: HOY, metodo: 'tarjeta' }, { allowDuplicate: true });
  await fa.alCobrar({ conversionId: v.id, paymentId: r.payment.id });
  return r.payment.id;
}

const enlaceDe = (c) => /datos-fiscales\/([A-Za-z0-9_.-]+)/.exec(c.htmlContent)?.[1];
const facturasDe = (v) => q(`SELECT * FROM invoices WHERE conversion_id = $1 AND estado <> 'cancelada' ORDER BY id`, [v.id]);
const filaDe = (v) => one('SELECT * FROM factura_datos_fiscales WHERE conversion_id = $1', [v.id]);

const facturaManual = (extra = {}) => invModel.create({
  projectId: proyectoF.id,
  clienteNombre: `${MARCA} Cliente ${crypto.randomBytes(2).toString('hex')}`,
  clienteNif: dni(), clienteDireccion: 'Calle 2', clienteCiudad: 'Madrid', clienteCp: '28002', clientePais: 'España',
  items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 10 + Math.random() }],
  baseImponible: 10, ivaPct: 0, ivaImporte: 0, total: Number((10 + Math.random() * 50).toFixed(2)),
  metodoPago: 'transferencia',
  ...extra,
}, null);

beforeAll(async () => {
  ({ hoy: HOY, ayer: AYER, manana: MANANA, hace5: HACE5 } = await one(
    `SELECT CURRENT_DATE::text AS hoy, (CURRENT_DATE - 1)::text AS ayer,
            (CURRENT_DATE + 1)::text AS manana, (CURRENT_DATE - 5)::text AS hace5`));
  emisor = await one(
    `INSERT INTO invoice_issuers (razon_social, nif, serie, activo) VALUES ($1, 'B12345674', $2, true) RETURNING id`,
    [`${MARCA} S.L.`, SERIE]);
  proyecto = await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id, slug`,
    [MARCA, MARCA.toLowerCase(), MARCA, emisor.id]);
  // La cola del campus «al día» hasta ayer: así cuenta el orden, como en ISEF.
  await invModel.setFacturacionAlDia(proyecto.id, AYER, null);

  emisorF = await one(
    `INSERT INTO invoice_issuers (razon_social, nif, direccion, ciudad, cp, serie, activo)
     VALUES ($1, 'B12345674', 'Calle 1', 'Madrid', '28001', $2, true) RETURNING id`,
    [`${MARCA} Fechas S.L.`, SERIE_F]);
  proyectoF = await one(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [`${MARCA} fechas`, `${MARCA.toLowerCase()}-f`, `${MARCA}-f`, emisorF.id]);
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
  const ids = [proyecto?.id, proyectoF?.id].filter(Boolean);
  const ventas = `SELECT id FROM conversions WHERE project_id = ANY($1::int[])`;
  const quita = (sql) => q(sql, [ids]).catch(() => {});
  await quita('DELETE FROM invoices WHERE project_id = ANY($1::int[])');
  await quita('DELETE FROM factura_datos_fiscales WHERE project_id = ANY($1::int[])');
  await quita(`DELETE FROM conversion_installments WHERE conversion_id IN (${ventas})`);
  await quita(`DELETE FROM conversion_payments WHERE conversion_id IN (${ventas})`);
  await quita(`DELETE FROM conversion_items WHERE conversion_id IN (${ventas})`);
  await quita(`DELETE FROM commissions WHERE conversion_id IN (${ventas})`);
  await quita('DELETE FROM conversions WHERE project_id = ANY($1::int[])');
  await quita('DELETE FROM lead_interactions WHERE lead_id IN (SELECT id FROM leads WHERE project_id = ANY($1::int[]))');
  await quita('DELETE FROM leads WHERE project_id = ANY($1::int[])');
  await quita('DELETE FROM invoicing_status WHERE project_id = ANY($1::int[])');
  await quita('DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])');
  await quita('DELETE FROM projects WHERE id = ANY($1::int[])');
  await q('DELETE FROM invoice_issuers WHERE id = ANY($1::int[])', [[emisor?.id, emisorF?.id].filter(Boolean)]).catch(() => {});
  await pool.end();
});

describe('#764 · el turno de la cola no lo para un alumno que no contesta', () => {
  it('el que contesta factura aunque otro, que cobró antes, siga sin contestar; la cola manual sigue en orden', async () => {
    const callado = await venta(fichaMala(`Callado ${MARCA}`));
    const pagoCallado = await cobrar(callado, 111.11);
    expect((await filaDe(callado)).estado).toBe('pendiente');

    const rapida = await venta(fichaMala(`Rápida ${MARCA}`));
    const pagoRapida = await cobrar(rapida, 122.22);
    const token = enlaceDe(correos[correos.length - 1]);
    expect(token).toBeTruthy();

    const r = await fa.responder(token, {
      tipo: 'particular', nombre: `Rápida Pérez ${MARCA}`, nif: dni(), direccion: 'Avenida del Puerto 22',
      codigo_postal: '46021', ciudad: 'Valencia', pais: 'España', email: `rapida.${MARCA.toLowerCase()}@example.com`,
    });
    // Antes: 0 facturas, «[HAY_ANTERIORES] Espera su turno en la cola».
    expect(r.facturas).toBe(1);
    const [inv] = await facturasDe(rapida);
    expect(inv.payment_id).toBe(pagoRapida);
    expect(inv.serie).toBe(SERIE);
    expect((await filaDe(rapida)).ultimo_error).toBeNull();

    // La del que calla sigue en la cola, y quien factura a mano la sigue viendo
    // primero: el orden manual no cambia.
    expect(await facturasDe(callado)).toHaveLength(0);
    expect(await invService.puedeFacturarAhora(proyecto.id, HOY, pagoCallado)).toBe(true);
    const otroPago = (await conversionModel.addPayment(rapida.id, { importe: 50, fecha: HOY, metodo: 'tarjeta' },
      { allowDuplicate: true })).payment.id;
    expect(await invService.puedeFacturarAhora(proyecto.id, HOY, otroPago)).toBe(false);
    expect(await invService.puedeFacturarAhora(proyecto.id, HOY, otroPago, { saltarEsperandoDatos: true })).toBe(true);
    // Ese cobro de más solo servía para mirar el turno: fuera, para que no espere en la cola de la siguiente.
    await q('DELETE FROM conversion_payments WHERE id = $1', [otroPago]);
  });

  it('día N: la ficha mala pasa a revisión y NO para la factura de la ficha buena, que cobró después', async () => {
    const mala = await venta(fichaMala(`Mala ${MARCA}`));
    await cobrar(mala, 133.33);
    const buena = await venta(fichaBuena(`Buena Gómez ${MARCA}`));
    const pagoBuena = await cobrar(buena, 144.44);
    await q(`UPDATE factura_datos_fiscales SET caduca_at = NOW() - INTERVAL '1 minute'
              WHERE conversion_id = ANY($1::int[])`, [[mala.id, buena.id]]);

    await fa.vuelta();

    expect((await filaDe(mala)).estado).toBe('revision');
    expect(await facturasDe(mala)).toHaveLength(0);
    const filaBuena = await filaDe(buena);
    expect(filaBuena.estado).toBe('ficha');
    // Antes: «Espera su turno en la cola» y ninguna factura.
    const [inv] = await facturasDe(buena);
    expect(inv?.payment_id).toBe(pagoBuena);
    expect(Number(inv.datos_fiscales_id)).toBe(Number(filaBuena.id));
    expect(inv.fecha_emision).toBe(HOY);
  });
});

describe('#764 · el enlace del formulario no se guarda en el registro de correos', () => {
  it('sale en el correo, pero lo que se guarda va sin él', async () => {
    const v = await venta(fichaMala(`Guardado ${MARCA}`));
    await cobrar(v, 155.55);
    const c = correos[correos.length - 1];
    const token = enlaceDe(c);
    expect(token).toBeTruthy();
    expect(c.htmlContent).toContain(token);
    expect(c.cuerpoGuardado).toBeTruthy();
    expect(c.cuerpoGuardado).not.toContain(token);
    expect(c.cuerpoGuardado).toContain(ENLACE_NO_GUARDADO);
  });
});

describe('#764 · la fecha de una factura va en el orden de su número', () => {
  it('crear con una fecha anterior a la de la factura anterior de la serie → 409, y no gasta número', async () => {
    const f1 = await facturaManual();
    expect(f1.fecha_emision).toBe(HOY);
    await expect(facturaManual({ fechaEmision: AYER }))
      .rejects.toMatchObject({ statusCode: 409, code: 'FECHA_FUERA_DE_ORDEN' });
    const f2 = await facturaManual();
    expect(f2.numero).toBe(f1.numero + 1);
  });

  it('«Cambiar fechas»: dentro del hueco entre sus vecinas sí; fuera, no', async () => {
    const [a, b] = await q(
      `SELECT id, numero FROM invoices WHERE project_id = $1 AND numero IS NOT NULL ORDER BY numero LIMIT 2`,
      [proyectoF.id]);
    // La segunda no puede irse antes que la primera, que es de hoy.
    await expect(invModel.updateFechas(b.id, { fechaEmision: AYER }))
      .rejects.toMatchObject({ code: 'FECHA_FUERA_DE_ORDEN' });
    // La primera no puede irse después de la segunda.
    await expect(invModel.updateFechas(a.id, { fechaEmision: MANANA }))
      .rejects.toMatchObject({ code: 'FECHA_FUERA_DE_ORDEN' });
    // Antes de la segunda sí: es la primera de la serie.
    const ok = await invModel.updateFechas(a.id, { fechaEmision: AYER });
    expect(ok.fecha_emision).toBe(AYER);
    // Y cambiar solo la de pago no mira nada de esto.
    expect((await invModel.updateFechas(b.id, { fechaPago: HACE5 })).fecha_pago).toBe(HACE5);
  });

  it('un borrador guardado hace días y emitido hoy sale con la fecha de hoy, no con la suya', async () => {
    const borrador = await facturaManual({ borrador: true });
    expect(borrador.numero).toBeNull();
    await q('UPDATE invoices SET fecha_emision = $2 WHERE id = $1', [borrador.id, HACE5]);
    const emitida = await invModel.emitirBorrador(borrador.id, {});
    expect(emitida.numero).toBeGreaterThan(0);
    // Antes: la fecha de hace 5 días con el número de hoy.
    expect(emitida.fecha_emision).toBe(HOY);
  });
});
