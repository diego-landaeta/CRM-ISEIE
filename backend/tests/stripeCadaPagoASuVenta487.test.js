import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * Puerta 6 del conector de Claude (#487, gemela de CRM#848), contra la base de verdad (la local de
 * docker-compose.dev.yml): cada cargo de Stripe a SU venta, y la compra directa en
 * la web crea la suya, sin asesora y con la formación como producto.
 *
 * Todo lleva la marca P6TEST y cuelga de dos campus de prueba: al borrarlos al
 * final se va todo en cascada.
 *
 *   docker compose -f docker-compose.dev.yml up -d
 *   npm --prefix backend run db:preparar
 *   cd backend && npx vitest run tests/stripeCadaPagoASuVenta487.test.js
 */

const { query } = await import('../src/shared/config/db.js');
const servicio = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { elegirVenta, pedidoDeLaWeb, configCompraDirecta } = await import('../src/modules/stripe-payments/compra-directa.service.js');
const { listarPagosStripe } = await import('../src/modules/mcp/mcp.model.js');
const { cobrosMensuales } = await import('../src/modules/reports/report.model.js');

const MARCA = `P6TEST${Date.now().toString(36)}`;
const m = MARCA.toLowerCase();
const ids = {};
const uno = async (sql, p) => (await query(sql, p)).rows[0];
const ENCENDIDO = { STRIPE_ASOCIACION_V2_ACTIVA: 'true', COMPRA_DIRECTA_ACTIVA: 'true', COMPRA_DIRECTA_ESPERA_HORAS: '24', COMPRA_DIRECTA_DIAS: '30' };
const haceDias = (d) => Math.floor(Date.now() / 1000) - d * 86400;

const evento = (id, euros, { email, created = Math.floor(Date.now() / 1000), metadata = {}, customer = null } = {}) => ({
  type: 'charge.succeeded',
  data: { object: { id, amount: Math.round(euros * 100), currency: 'eur', status: 'succeeded', created, customer,
    billing_details: { email, name: `${MARCA} Cliente` }, metadata } },
});
const cargo = (stripeId) => uno(
  `SELECT id, conversion_id, conversion_payment_id, lead_id, link_method FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2`,
  [ids.PA, stripeId]);

async function lead(clave, email, { status = 'convertido', creado = 'NOW()' } = {}) {
  ids[clave] = (await uno(
    `INSERT INTO leads (project_id, nombre, email, status, created_at) VALUES ($1, $2, $3, $4, ${creado}) RETURNING id`,
    [ids.PA, `${MARCA} ${clave}`, email, status])).id;
}
async function venta(clave, leadClave, { producto = null, total = 1000, sub = null } = {}) {
  ids[clave] = (await uno(
    `INSERT INTO conversions (lead_id, project_id, producto_contratado, producto_contratado_id, importe_total, importe_pagado,
                              fecha_conversion, stripe_subscription_id)
     VALUES ($1, $2, $3, $4, $5, 0, CURRENT_DATE - 10, $6) RETURNING id`,
    [ids[leadClave], ids.PA, `${MARCA} venta ${clave}`, producto ? ids[producto] : null, total, sub])).id;
}
async function pedido(numero, productosWc) {
  await query(
    `INSERT INTO woocommerce_orders (project_id, wc_order_id, numero, status, total, currency, customer_email, customer_name, line_items)
     VALUES ($1, $2, $3, 'completed', 100, 'EUR', $4, $5, $6::jsonb)`,
    [ids.PA, numero, String(numero), `pedido${numero}@${m}.test`, `${MARCA} Comprador ${numero}`,
      JSON.stringify(productosWc.map((wc, i) => ({ id: i + 1, product_id: wc, name: `Producto ${wc}`, quantity: 1, total: 100 })))]);
}
/** Un cargo ya guardado (como lo deja el sondeo), de hace `dias` días y de un pedido de la web. */
async function cargoGuardado(stripeId, euros, { email, dias = 2, orderId = null }) {
  await query(
    `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, customer_name,
                                  metadata, stripe_created_at)
     VALUES ($1, $2, 'charge', 'succeeded', $3, 'EUR', $4, $5, $6, NOW() - make_interval(days => $7))`,
    [ids.PA, stripeId, euros, email, `${MARCA} Comprador`, orderId ? { order_id: String(orderId), site_url: 'https://tienda.test' } : {}, dias]);
}

// Las reglas nuevas van con interruptor y salen apagadas: aquí se encienden para
// probarlas, y el último bloque comprueba que apagadas no cambia nada.
const V2_ANTES = process.env.STRIPE_ASOCIACION_V2_ACTIVA;

beforeAll(async () => {
  process.env.STRIPE_ASOCIACION_V2_ACTIVA = 'true';
  // El campus nace hace un año: el suelo de la pasada es el alta del campus.
  ids.PA = (await uno(
    `INSERT INTO projects (nombre, slug, webhook_api_key, created_at) VALUES ($1, $2, $3, NOW() - interval '1 year') RETURNING id`,
    [`${MARCA} Campus`, `${m}-a`, `${MARCA}-key`])).id;
  for (const [clave, wc] of [['FA', 7001], ['FB', 7002], ['FC', 7003]]) {
    ids[clave] = (await uno(
      `INSERT INTO products (project_id, nombre, wc_product_id) VALUES ($1, $2, $3) RETURNING id`,
      [ids.PA, `${MARCA} Formación ${clave}`, wc])).id;
  }
}, 60000);

afterAll(async () => {
  if (V2_ANTES === undefined) delete process.env.STRIPE_ASOCIACION_V2_ACTIVA; else process.env.STRIPE_ASOCIACION_V2_ACTIVA = V2_ANTES;
  // El campus se lleva en cascada fichas, ventas, cobros, cargos, pedidos y productos.
  try { await query(`DELETE FROM projects WHERE id = $1`, [ids.PA]); } catch { /* sigue */ }
});

describe('piezas sueltas', () => {
  it('el pedido de la web sale de metadata.order_id, y nada más', () => {
    expect(pedidoDeLaWeb({ order_id: '1234', site_url: 'x' })).toBe('1234');
    expect(pedidoDeLaWeb({ order_id: 99 })).toBe('99');
    expect(pedidoDeLaWeb({})).toBeNull();
    expect(pedidoDeLaWeb(null)).toBeNull();
    expect(pedidoDeLaWeb({ order_id: '12; DROP' })).toBeNull();
  });

  it('elegir venta: la de la formación; si no, una sin formación; si todas son de otra, ninguna', () => {
    const v = [{ id: 3, producto_contratado_id: 10 }, { id: 2, producto_contratado_id: null }, { id: 1, producto_contratado_id: 20 }];
    expect(elegirVenta(v, null).id).toBe(3);
    expect(elegirVenta(v, 20).id).toBe(1);
    expect(elegirVenta(v, 30).id).toBe(2);
    expect(elegirVenta([{ id: 3, producto_contratado_id: 10 }], 30)).toBeNull();
    expect(elegirVenta([], 10)).toBeNull();
  });

  it('la configuración por defecto: 24 horas de espera y 30 días atrás', () => {
    expect(configCompraDirecta({})).toEqual({ esperaHoras: 24, dias: 30 });
    expect(configCompraDirecta({ COMPRA_DIRECTA_ESPERA_HORAS: '2', COMPRA_DIRECTA_DIAS: '0' })).toEqual({ esperaHoras: 2, dias: 1 });
  });
});

describe('cada cargo a su venta', { timeout: 60000 }, () => {
  it('ficha duplicada después de comprar: el cargo va a la venta de la ficha de antes', async () => {
    const email = `dup@${m}.test`;
    await lead('Ldup1', email, { creado: "NOW() - interval '30 days'" });
    await venta('Vdup', 'Ldup1');
    await lead('Ldup2', email, { status: 'nuevo' }); // la nueva, sin venta
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_dup`, 120, { email }));
    const sp = await cargo(`ch_${MARCA}_dup`);
    expect(sp).toMatchObject({ conversion_id: ids.Vdup, lead_id: ids.Ldup1, link_method: 'auto_email' });
    expect(sp.conversion_payment_id).not.toBeNull();
  });

  it('una ficha con venta que ya no está «convertida»: el cargo va igual a su venta', async () => {
    const email = `estado@${m}.test`;
    await lead('Lest', email, { status: 'en_seguimiento' });
    await venta('Vest', 'Lest');
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_est`, 80, { email }));
    expect(await cargo(`ch_${MARCA}_est`)).toMatchObject({ conversion_id: ids.Vest, link_method: 'auto_email' });
  });

  it('compra en la web de un curso NUEVO: no se cuelga de la venta de otro curso', async () => {
    const email = `otra@${m}.test`;
    await lead('Lotra', email);
    await venta('Votra', 'Lotra', { producto: 'FA' });
    await pedido(5001, [7002]); // compra la formación B
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_otra`, 90, { email, metadata: { order_id: '5001' } }));
    expect(await cargo(`ch_${MARCA}_otra`)).toMatchObject({ conversion_id: null, lead_id: ids.Lotra, link_method: 'auto_pending' });
  });

  it('compra en la web de un curso que ya tiene venta: va a la venta de ESE curso, no a la última', async () => {
    const email = `dos@${m}.test`;
    await lead('Ldos', email);
    await venta('VdosB', 'Ldos', { producto: 'FB' });
    await venta('VdosA', 'Ldos', { producto: 'FA' }); // la más reciente es de A
    await pedido(5002, [7002]);
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_dos`, 95, { email, metadata: { order_id: '5002' } }));
    expect(await cargo(`ch_${MARCA}_dos`)).toMatchObject({ conversion_id: ids.VdosB, link_method: 'auto_email' });
  });

  it('una renovación pagada con otro correo va a la venta de su suscripción', async () => {
    await lead('Lsub', `sub@${m}.test`);
    await venta('Vsub', 'Lsub', { total: 900, sub: `sub_${MARCA}` });
    // El sondeo ya preguntó a Stripe de qué suscripción es (sin venta aún).
    const id = `ch_${MARCA}_sub`;
    await query(
      `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at,
                                    stripe_subscription_id, suscripcion_buscada, customer_stripe_id)
       VALUES ($1, $2, 'charge', 'succeeded', 300, 'EUR', $3, NOW(), $4, true, 'cus_x')`,
      [ids.PA, id, `otro.correo@${m}.test`, `sub_${MARCA}`]);
    await servicio.handleWebhookEvent(ids.PA, evento(id, 300, { email: `otro.correo@${m}.test`, customer: 'cus_x' }));
    const sp = await cargo(id);
    expect(sp).toMatchObject({ conversion_id: ids.Vsub, lead_id: ids.Lsub, link_method: 'auto_suscripcion' });
    expect(sp.conversion_payment_id).not.toBeNull();
  });

  it('la suscripción de un cargo suelto se pregunta a Stripe una vez y queda apuntada', async () => {
    const id = `ch_${MARCA}_preg`;
    await query(
      `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, stripe_created_at, customer_stripe_id)
       VALUES ($1, $2, 'charge', 'succeeded', 10, 'EUR', NOW(), 'cus_y')`, [ids.PA, id]);
    const fila = await uno(`SELECT * FROM stripe_payments WHERE project_id = $1 AND stripe_id = $2`, [ids.PA, id]);
    let llamadas = 0;
    const opciones = { clave: async () => 'sk_prueba', delCargo: async () => { llamadas += 1; return `sub_${MARCA}_2`; } };
    expect(await servicio.suscripcionDelCargoSuelto(ids.PA, { stripe_id: id }, fila, opciones)).toBe(`sub_${MARCA}_2`);
    const despues = await uno(`SELECT * FROM stripe_payments WHERE id = $1`, [fila.id]);
    expect(despues).toMatchObject({ stripe_subscription_id: `sub_${MARCA}_2`, suscripcion_buscada: true });
    expect(await servicio.suscripcionDelCargoSuelto(ids.PA, { stripe_id: id }, despues, opciones)).toBe(`sub_${MARCA}_2`);
    expect(llamadas).toBe(1);
    // Sin cliente de Stripe no es de una suscripción: ni se pregunta.
    const suelto = { ...fila, id: -1, customer_stripe_id: null, suscripcion_buscada: false, stripe_subscription_id: null };
    expect(await servicio.suscripcionDelCargoSuelto(ids.PA, { stripe_id: 'x' }, suelto, opciones)).toBeNull();
    expect(llamadas).toBe(1);
  });
});

describe('la compra directa en la web crea su venta', { timeout: 60000 }, () => {
  it('apagado no hace nada', async () => {
    await pedido(6000, [7003]);
    await cargoGuardado(`ch_${MARCA}_apagado`, 150, { email: `apagado@${m}.test`, orderId: 6000 });
    expect(await servicio.comprasDirectasSinVenta(ids.PA, { env: {} })).toEqual({ mirados: 0, creadas: 0 });
    expect((await cargo(`ch_${MARCA}_apagado`)).conversion_id).toBeNull();
  });

  it('encendido: venta sin gestora, con la formación como producto y el cobro dentro', async () => {
    const antes = await listarPagosStripe({ projectIds: [ids.PA], pagina: 1, limite: 100 });
    await pedido(6001, [7003]);
    await cargoGuardado(`ch_${MARCA}_web`, 249.5, { email: `web@${m}.test`, orderId: 6001 });
    const r = await servicio.comprasDirectasSinVenta(ids.PA, { env: ENCENDIDO });
    expect(r.creadas).toBeGreaterThanOrEqual(1);

    const sp = await cargo(`ch_${MARCA}_web`);
    expect(sp.link_method).toBe('auto_compra_directa');
    const v = await uno(
      `SELECT c.producto_contratado, c.producto_contratado_id, c.importe_total, c.importe_pagado, c.vendedora_id,
              l.email, l.responsable_id, l.status
         FROM conversions c JOIN leads l ON l.id = c.lead_id WHERE c.id = $1`, [sp.conversion_id]);
    expect(v).toMatchObject({
      producto_contratado: `${MARCA} Formación FC`, producto_contratado_id: ids.FC,
      vendedora_id: null, email: `web@${m}.test`, responsable_id: null, status: 'convertido',
    });
    expect(Number(v.importe_total)).toBe(249.5);
    expect(Number(v.importe_pagado)).toBe(249.5);
    const cp = await uno(`SELECT importe, notas FROM conversion_payments WHERE id = $1`, [sp.conversion_payment_id]);
    expect(cp.notas).toContain(`ch_${MARCA}_web`);

    // Baja el contador «sin asociar» y el cargo dice cómo se asoció.
    const despues = await listarPagosStripe({ projectIds: [ids.PA], pagina: 1, limite: 100 });
    expect(despues.cifras.sin_asociar).toBeLessThan(antes.cifras.sin_asociar + 1);
    const fila = despues.pagos.find((p) => p.stripe_id === `ch_${MARCA}_web`);
    expect(fila).toMatchObject({ formacion: `${MARCA} Formación FC`, asociado_por: 'compra directa en la web (venta creada por el CRM)' });

    // Y sale en los cobros del mes con su formación, no con el nombre de la alumna.
    const cobros = await cobrosMensuales({ projectIds: [ids.PA] });
    const suyo = cobros.find((c) => Number(c.importe) === 249.5);
    expect(suyo.producto).toBe(`${MARCA} Formación FC`);
  });

  it('otra pasada no crea otra venta ni otro cobro', async () => {
    await servicio.comprasDirectasSinVenta(ids.PA, { env: ENCENDIDO });
    const { rows } = await query(
      `SELECT COUNT(*)::int AS n FROM conversion_payments cp JOIN conversions c ON c.id = cp.conversion_id
        WHERE c.project_id = $1 AND cp.notas LIKE $2`, [ids.PA, `%ch_${MARCA}_web%`]);
    expect(rows[0].n).toBe(1);
  });

  it('con ficha ya existente sin venta, la venta va en esa ficha', async () => {
    const email = `ficha@${m}.test`;
    await lead('Lficha', email, { status: 'nuevo', creado: "NOW() - interval '20 days'" });
    await pedido(6002, [7001]);
    await cargoGuardado(`ch_${MARCA}_ficha`, 60, { email, orderId: 6002 });
    await servicio.comprasDirectasSinVenta(ids.PA, { env: ENCENDIDO });
    const sp = await cargo(`ch_${MARCA}_ficha`);
    expect(sp.link_method).toBe('auto_compra_directa');
    expect(sp.lead_id).toBe(ids.Lficha);
    expect((await uno(`SELECT lead_id, producto_contratado_id FROM conversions WHERE id = $1`, [sp.conversion_id])))
      .toEqual({ lead_id: ids.Lficha, producto_contratado_id: ids.FA });
  });

  it('no se crea: cobro igual ya apuntado en el campus, pedido con dos formaciones, o aún dentro de la espera', async () => {
    // La asesora lo apuntó en una venta con otro correo.
    await lead('Lases', `asesora.puso.otro@${m}.test`);
    await venta('Vases', 'Lases');
    await query(`INSERT INTO conversion_payments (conversion_id, importe, fecha, notas) VALUES ($1, 333.33, CURRENT_DATE - 2, 'a mano')`, [ids.Vases]);
    await pedido(6003, [7003]);
    await cargoGuardado(`ch_${MARCA}_igual`, 333.33, { email: `igual@${m}.test`, orderId: 6003 });
    // Dos formaciones distintas en el pedido.
    await pedido(6004, [7001, 7002]);
    await cargoGuardado(`ch_${MARCA}_doble`, 210, { email: `doble@${m}.test`, orderId: 6004 });
    // De hace una hora.
    await pedido(6005, [7003]);
    await query(
      `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, metadata, stripe_created_at)
       VALUES ($1, $2, 'charge', 'succeeded', 70, 'EUR', $3, $4, NOW() - interval '1 hour')`,
      [ids.PA, `ch_${MARCA}_reciente`, `reciente@${m}.test`, { order_id: '6005' }]);

    await servicio.comprasDirectasSinVenta(ids.PA, { env: ENCENDIDO });
    for (const id of ['igual', 'doble', 'reciente']) {
      expect((await cargo(`ch_${MARCA}_${id}`)).conversion_id, id).toBeNull();
    }
  });
});

/*
  EL INTERRUPTOR (STRIPE_ASOCIACION_V2_ACTIVA). Apagado, que es como sale, un cargo
  se asocia EXACTAMENTE como antes de la puerta 6: por el correo, a la ficha más
  nueva del campus, solo si está «convertida» y tiene venta. Los mismos casos de
  arriba, con el interruptor apagado, dan lo que daban antes.
*/
describe('con el interruptor apagado no cambia nada', { timeout: 60000 }, () => {
  async function apagado(fn) {
    const antes = process.env.STRIPE_ASOCIACION_V2_ACTIVA;
    delete process.env.STRIPE_ASOCIACION_V2_ACTIVA;
    try { return await fn(); } finally {
      if (antes === undefined) delete process.env.STRIPE_ASOCIACION_V2_ACTIVA; else process.env.STRIPE_ASOCIACION_V2_ACTIVA = antes;
    }
  }
  const cobrosDe = async (conversionId) => Number((await uno(
    `SELECT COUNT(*)::int AS n FROM conversion_payments WHERE conversion_id = $1`, [conversionId])).n);

  it('sale apagado: solo «1» o «true» lo encienden', () => {
    expect(servicio.asociacionV2Activa({})).toBe(false);
    expect(servicio.asociacionV2Activa({ STRIPE_ASOCIACION_V2_ACTIVA: 'false' })).toBe(false);
    expect(servicio.asociacionV2Activa({ STRIPE_ASOCIACION_V2_ACTIVA: '0' })).toBe(false);
    expect(servicio.asociacionV2Activa({ STRIPE_ASOCIACION_V2_ACTIVA: '1' })).toBe(true);
    expect(servicio.asociacionV2Activa({ STRIPE_ASOCIACION_V2_ACTIVA: 'true' })).toBe(true);
  });

  it('una ficha «convertida» con venta: se asocia por el correo, como siempre', () => apagado(async () => {
    const email = `off.normal@${m}.test`;
    await lead('LoffN', email);
    await venta('VoffN', 'LoffN');
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_offn`, 70, { email }));
    const sp = await cargo(`ch_${MARCA}_offn`);
    expect(sp).toMatchObject({ conversion_id: ids.VoffN, lead_id: ids.LoffN, link_method: 'auto_email' });
    expect(sp.conversion_payment_id).not.toBeNull();
    expect(await cobrosDe(ids.VoffN)).toBe(1);
  }));

  it('una ficha con venta que ya no está «convertida»: queda pendiente, no se apunta ningún cobro', () => apagado(async () => {
    const email = `off.estado@${m}.test`;
    await lead('LoffE', email, { status: 'en_seguimiento' });
    await venta('VoffE', 'LoffE');
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_offe`, 80, { email }));
    expect(await cargo(`ch_${MARCA}_offe`)).toMatchObject({
      conversion_id: null, conversion_payment_id: null, lead_id: ids.LoffE, link_method: 'auto_pending' });
    expect(await cobrosDe(ids.VoffE)).toBe(0);
  }));

  it('ficha duplicada después de comprar: no se va a buscar la venta de la ficha de antes', () => apagado(async () => {
    const email = `off.dup@${m}.test`;
    await lead('LoffD1', email, { creado: "NOW() - interval '30 days'" });
    await venta('VoffD', 'LoffD1');
    await lead('LoffD2', email, { status: 'nuevo' });
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_offd`, 120, { email }));
    expect(await cargo(`ch_${MARCA}_offd`)).toMatchObject({
      conversion_id: null, conversion_payment_id: null, lead_id: ids.LoffD2, link_method: 'auto_pending' });
    expect(await cobrosDe(ids.VoffD)).toBe(0);
  }));

  it('una compra de la web: no se mira el pedido; va a la venta más reciente de la ficha, como siempre', () => apagado(async () => {
    const email = `off.web@${m}.test`;
    await lead('LoffW', email);
    await venta('VoffWB', 'LoffW', { producto: 'FB' });
    await venta('VoffWA', 'LoffW', { producto: 'FA' }); // la más reciente es de A
    await pedido(5901, [7002]); // el pedido es de la formación B
    await servicio.handleWebhookEvent(ids.PA, evento(`ch_${MARCA}_offw`, 95, { email, metadata: { order_id: '5901' } }));
    expect(await cargo(`ch_${MARCA}_offw`)).toMatchObject({ conversion_id: ids.VoffWA, link_method: 'auto_email' });
    expect(await cobrosDe(ids.VoffWB)).toBe(0);
  }));

  it('una renovación pagada con otro correo: no se asocia por la suscripción', () => apagado(async () => {
    await lead('LoffS', `off.sub@${m}.test`);
    await venta('VoffS', 'LoffS', { total: 900, sub: `sub_${MARCA}_off` });
    const id = `ch_${MARCA}_offs`;
    await query(
      `INSERT INTO stripe_payments (project_id, stripe_id, type, status, amount, currency, customer_email, stripe_created_at,
                                    stripe_subscription_id, suscripcion_buscada, customer_stripe_id)
       VALUES ($1, $2, 'charge', 'succeeded', 300, 'EUR', $3, NOW(), $4, true, 'cus_off')`,
      [ids.PA, id, `off.otro@${m}.test`, `sub_${MARCA}_off`]);
    await servicio.handleWebhookEvent(ids.PA, evento(id, 300, { email: `off.otro@${m}.test`, customer: 'cus_off' }));
    expect(await cargo(id)).toMatchObject({ conversion_id: null, conversion_payment_id: null });
    expect(await cobrosDe(ids.VoffS)).toBe(0);
  }));

  it('la compra directa tampoco crea ventas, aunque tenga su interruptor encendido', async () => {
    await pedido(6900, [7003]);
    await cargoGuardado(`ch_${MARCA}_offcd`, 150, { email: `off.cd@${m}.test`, orderId: 6900 });
    const soloCompraDirecta = { ...ENCENDIDO, STRIPE_ASOCIACION_V2_ACTIVA: 'false' };
    expect(await servicio.comprasDirectasSinVenta(ids.PA, { env: soloCompraDirecta })).toEqual({ mirados: 0, creadas: 0 });
    expect((await cargo(`ch_${MARCA}_offcd`)).conversion_id).toBeNull();
  });
});

describe('el aviso de Stripe no espera a la tienda', { timeout: 60000 }, () => {
  it('un pedido que aún no está guardado en el CRM no se decide dentro del aviso', async () => {
    const { formacionDelPedido, PEDIDO_SIN_LEER } = await import('../src/modules/stripe-payments/compra-directa.service.js');
    const pedir = async () => { throw new Error('no se debe salir a la tienda'); };
    expect(await formacionDelPedido(ids.PA, '987654321', { soloGuardado: true, pedir })).toBe(PEDIDO_SIN_LEER);
    // Guardado, se lee igual con o sin esperar.
    await pedido(5950, [7001]);
    expect(await formacionDelPedido(ids.PA, '5950', { soloGuardado: true, pedir })).toMatchObject({ id: ids.FA });
  });
});
