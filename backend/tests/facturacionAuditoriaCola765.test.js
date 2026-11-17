import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * CRM#765 (gemela CRM-ISEIE#453) · Auditoría de facturación, contra la base.
 *
 * El recorrido entero con datos de verdad:
 *   1. Un número repetido en la serie (la misma serie escrita en minúsculas y
 *      con un espacio, que el índice único no ve) → la auditoría PAUSA.
 *   2. Con la pausa, una factura manual no sale (423) y los cobros que entran
 *      esperan en la cola de la pausa.
 *   3. «Marcar como solucionado» con el error aún ahí NO reanuda.
 *   4. Arreglado, reanuda y emite la cola EN ORDEN DE COBRO (el del 16 antes
 *      que el del 17, aunque el del 17 entrara antes).
 *
 *   DATABASE_URL=... node scripts/db-preparar.mjs
 *   npx vitest run tests/facturacionAuditoriaCola765.test.js
 */

const madrid = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/Madrid' });
const HOY = madrid(Date.now());
const AYER = madrid(Date.now() - 86400000);
// La primera factura de la sociedad marca su arranque: un cobro anterior no lleva factura.
const ANTEAYER = madrid(Date.now() - 2 * 86400000);
process.env.FACTURACION_AUDITORIA_ACTIVA = 'true';
// Desde hoy: el histórico de la base de pruebas no cuenta.
process.env.FACTURACION_AUDITORIA_DESDE = HOY;
process.env.FACTURACION_AUDITORIA_DIAS = '9';

// El correo no se manda en pruebas: se mira que se pida.
vi.mock('../src/modules/facturacion-auditoria/facturacion-auditoria.correo.js', () => ({
  avisarDeLaPausa: vi.fn(async () => ({ sent: true })),
}));

const { default: pool } = await import('../src/shared/config/db.js');
const invoices = await import('../src/modules/invoices/invoices.model.js');
const servicio = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.service.js');
const { avisarDeLaPausa } = await import('../src/modules/facturacion-auditoria/facturacion-auditoria.correo.js');

const MARCA = `C765_${Date.now().toString(36)}`;
const SERIE = `T${Date.now().toString(36).slice(-6).toUpperCase()}`;
const q = (sql, params) => pool.query(sql, params).then((r) => r.rows);
let proyecto; let otro; let emisora; let lead; let venta; let repetida;

// Cada cobro con su importe: dos de 100 € de la misma venta en la misma semana
// son una «posible duplicada» (CRM#819) y la emision automatica no los saca.
const cobro = async (fecha, importe = 100) => (await q(
  `INSERT INTO conversion_payments (conversion_id, importe, fecha) VALUES ($1, $3, $2) RETURNING id`,
  [venta.id, fecha, importe]))[0].id;

beforeAll(async () => {
  // Una pausa abierta que dejara otra ejecución local no puede tapar esta.
  await q(`UPDATE facturacion_pausas SET reanudada_at = NOW() WHERE reanudada_at IS NULL`);
  [emisora] = await q(
    `INSERT INTO invoice_issuers (razon_social, nif, direccion, ciudad, cp, serie, activo)
     VALUES ($1, 'B12345674', 'Calle 1', 'Madrid', '28001', $2, true) RETURNING id`, [MARCA, SERIE]);
  [proyecto] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $1, $3) RETURNING id`,
    [MARCA, MARCA.toLowerCase(), emisora.id]);
  [otro] = await q(
    `INSERT INTO projects (nombre, slug, webhook_api_key, sociedad_emisora_id) VALUES ($1, $2, $1, $3) RETURNING id`,
    [`${MARCA}b`, `${MARCA.toLowerCase()}b`, emisora.id]);
  [lead] = await q(`INSERT INTO leads (nombre, project_id) VALUES ($1, $2) RETURNING id`, [MARCA, proyecto.id]);
  [venta] = await q(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, importe_total, importe_pagado)
     VALUES ($1, $2, 'Curso', 1000, 300) RETURNING id`, [lead.id, proyecto.id]);
});

afterAll(async () => {
  const ids = [proyecto?.id, otro?.id].filter(Boolean);
  await q(`DELETE FROM facturacion_cola_pausa WHERE conversion_id = $1`, [venta?.id || 0]);
  await q(`UPDATE facturacion_pausas SET reanudada_at = NOW() WHERE reanudada_at IS NULL`);
  await q(`DELETE FROM invoices WHERE project_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM invoice_sequences WHERE project_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM conversions WHERE project_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM leads WHERE project_id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM projects WHERE id = ANY($1::int[])`, [ids]);
  await q(`DELETE FROM invoice_issuers WHERE id = $1`, [emisora?.id || 0]);
});

describe('auditoría de facturación contra la base (#765)', { timeout: 60000 }, () => {
  it('error provocado → pausa, correo y aviso; con la pausa no sale una factura manual', async () => {
    const p0 = await cobro(ANTEAYER);
    const primera = await invoices.create({
      projectId: proyecto.id, conversionId: venta.id, paymentId: p0, permitirParecida: true, fechaEmision: ANTEAYER,
      clienteNombre: 'Ana', clienteNif: '12345678Z', clienteDireccion: 'Calle 2', clienteCiudad: 'Madrid',
      clienteCp: '28002', clientePais: 'España',
      items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 100 }],
      baseImponible: 100, ivaPct: 0, ivaImporte: 0, total: 100, metodoPago: 'transferencia',
    }, null);
    expect(primera.serie).toBe(SERIE);
    // El mismo número en otro campus de la misma sociedad, con la serie mal escrita.
    [repetida] = await q(
      `INSERT INTO invoices (project_id, serie, ano, numero, codigo, cliente_nombre, cliente_nif, cliente_direccion,
                             cliente_ciudad, cliente_cp, cliente_pais, items, base_imponible, total, issuer_id)
       SELECT $2, lower(serie) || ' ', ano, numero, codigo, 'Otro', '12345678Z', 'x', 'y', '28001', 'España',
              items, 50, 50, issuer_id FROM invoices WHERE id = $1 RETURNING id`,
      [primera.id, otro.id]);

    const r = await servicio.auditar({ origen: 'programada' });
    const mias = r.incidencias.filter((i) => i.serie === SERIE);
    expect(mias).toHaveLength(1);
    expect(mias[0].tipo).toBe('numero_repetido');
    expect(r.limpia).toBe(false);
    expect(r.pausa?.id).toBeTruthy();

    expect(avisarDeLaPausa).toHaveBeenCalledTimes(1);
    const [aviso] = await q(
      `SELECT type FROM admin_notifications WHERE type = 'facturacion_pausada'
         AND (metadata->>'pausa_id')::bigint = $1`, [r.pausa.id]);
    expect(aviso).toBeTruthy();
    expect((await servicio.estado()).pausada).toBe(true);

    await expect(invoices.create({
      projectId: proyecto.id, clienteNombre: 'Manual', clienteNif: '12345678Z', clienteDireccion: 'C',
      clienteCiudad: 'M', clienteCp: '28001', clientePais: 'España',
      items: [{ descripcion: 'x', cantidad: 1, precio_unitario: 10 }], baseImponible: 10, ivaPct: 0, total: 10,
    }, null)).rejects.toMatchObject({ statusCode: 423, code: 'FACTURACION_PAUSADA' });

    // Una segunda vuelta con el mismo error no abre otra pausa ni repite el correo.
    await servicio.auditar({ origen: 'programada' });
    expect(avisarDeLaPausa).toHaveBeenCalledTimes(1);
  });

  it('los cobros que entran se encolan y salen EN ORDEN DE COBRO al reanudar, solo si la auditoría sale limpia', async () => {
    const elDeHoy = await cobro(HOY, 130);    // entra primero…
    const elDeAyer = await cobro(AYER, 120);  // …pero se cobró antes
    expect(await servicio.encolarSiPausada({ paymentId: elDeHoy, conversionId: venta.id })).toBe(true);
    expect(await servicio.encolarSiPausada({ paymentId: elDeAyer, conversionId: venta.id })).toBe(true);

    // Con el error todavía ahí: no reanuda y no emite nada.
    const sucia = await servicio.reanudar({ userId: null });
    expect(sucia.reanudada).toBe(false);
    expect(await q(`SELECT id FROM invoices WHERE payment_id = ANY($1::int[])`, [[elDeHoy, elDeAyer]])).toHaveLength(0);
    expect((await servicio.estado()).pausada).toBe(true);

    // La auditoría no corrige: lo arregla una persona.
    await q(`DELETE FROM invoices WHERE id = $1`, [repetida.id]);

    const limpia = await servicio.reanudar({ userId: null });
    expect(limpia.reanudada).toBe(true);
    expect(limpia.emitidas.map((e) => [e.payment_id, e.resultado])).toEqual([
      [elDeAyer, 'emitida'], [elDeHoy, 'emitida'],
    ]);
    const [a, b] = await q(
      `SELECT payment_id, numero FROM invoices WHERE payment_id = ANY($1::int[]) ORDER BY numero`,
      [[elDeHoy, elDeAyer]]);
    expect([a.payment_id, b.payment_id]).toEqual([elDeAyer, elDeHoy]);
    expect(b.numero).toBe(a.numero + 1);
    expect((await servicio.estado()).pausada).toBe(false);
  });
});
