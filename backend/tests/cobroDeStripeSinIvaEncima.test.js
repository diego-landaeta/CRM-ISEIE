import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
  UN COBRO DE STRIPE ES LO QUE COBRO STRIPE (15/10, QA de produccion).

  El caso es de MultiCRM, pero ISEIE tiene el mismo codigo (enlace de Stripe,
  correccion de factura y sincronizacion del cobro) y le podia pasar igual. En
  ISEIE no hay ningun cobro asi a 15/10.

  Venta 643 de Psiko Aprende, 09/10. Lo que paso, en orden:
    09:05  Stripe cobra 412,25 € (cargo ch_3UOZ…, stripe_payments 138214).
    09:18  El enlace automatico por correo registra el cobro 845: 412,25 €.
    09:24  La cola saca la factura CEDIA 2026/0196, exenta, por 412,25 €.
    09:27  Se corrige la factura para ponerle el 21 %. La pantalla deja «El
           precio ya incluye IVA» sin marcar (una factura exenta lo tiene asi),
           el servidor suma el IVA ENCIMA —412,25 + 86,57 = 498,82— y, como la
           correccion sincroniza el cobro con la factura, el cobro 845 pasa a
           498,82 € y la venta a 498,82 cobrados. 86,57 € que nadie pago.

  Aqui se rehace ese camino con la base simulada: el enlace de Stripe y el
  cobro de verdad (conversion.model.addPayment), y la correccion de verdad
  (controlador + modelo de facturas). Lo que tiene que salir: cobro 412,25 y
  factura 412,25 = 340,70 de base + 71,55 de IVA.
*/

// ── La base simulada ─────────────────────────────────────────────────────────
let db;
const sqls = [];

function base({ ivaIncluidoVenta }) {
  return {
    conversions: new Map([[643, {
      id: 643, importe_total: 412.25, importe_pagado: 0,
      iva_incluido: ivaIncluidoVenta, iva_pct: 21,
    }]]),
    payments: new Map(),
    invoices: new Map(),
    // Cobros con un cargo de Stripe cobrado enganchado.
    deStripe: new Set(),
    siguientePago: 845,
  };
}

const r = (rows) => ({ rows });

function responder(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  sqls.push(s);
  if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(s)) return r([]);

  // conversion.model.addPayment
  if (/^SELECT id, importe_total, importe_pagado FROM conversions WHERE id = \$1 FOR UPDATE/.test(s)) {
    const c = db.conversions.get(Number(p[0]));
    return r(c ? [{ ...c }] : []);
  }
  if (/^INSERT INTO conversion_payments/.test(s)) {
    const cp = {
      id: db.siguientePago++, conversion_id: Number(p[0]), importe: Number(p[1]),
      fecha: p[2] || '2026-10-09', notas: p[3], metodo: p[4] ?? null,
    };
    db.payments.set(cp.id, cp);
    return r([{ ...cp }]);
  }
  if (/^UPDATE conversions SET importe_pagado = \$1, updated_at = NOW\(\) WHERE id = \$2/.test(s)) {
    db.conversions.get(Number(p[1])).importe_pagado = Number(p[0]);
    return r([]);
  }
  if (/^SELECT id, importe_previsto FROM conversion_installments/.test(s)) return r([]);

  // ¿La admin lleva un equipo comercial? (#415: si lo lleva no corrige facturas). Aquí, no.
  if (/^SELECT gestora_id FROM equipo_comercial WHERE lider_id = \$1/.test(s)) return r([]);

  // Facturas
  if (/FROM invoices i LEFT JOIN projects p ON p\.id = i\.project_id/.test(s)) {
    const i = db.invoices.get(Number(p[0]));
    return r(i ? [{ ...i }] : []);
  }
  if (/FROM invoices i JOIN conversion_payments cp ON cp\.id = i\.payment_id WHERE i\.id = \$1/.test(s)) {
    const i = db.invoices.get(Number(p[0]));
    const cp = i && db.payments.get(i.payment_id);
    return r(cp ? [{ id: cp.id, importe: cp.importe, de_stripe: db.deStripe.has(cp.id) }] : []);
  }
  if (/^SELECT \* FROM invoices WHERE id = \$1 FOR UPDATE/.test(s)) {
    const i = db.invoices.get(Number(p[0]));
    return r(i ? [{ ...i }] : []);
  }
  if (/^UPDATE invoices SET cliente_nombre=\$2/.test(s)) {
    const i = db.invoices.get(Number(p[0]));
    Object.assign(i, {
      items: JSON.parse(p[9]), base_imponible: Number(p[10]), iva_pct: Number(p[11]),
      iva_importe: Number(p[12]), iva_incluido: !!p[13], total: Number(p[14]), leyenda_iva: p[19],
    });
    return r([{ ...i }]);
  }
  if (/^UPDATE invoices SET pdf_path = NULL/.test(s)) return r([]);
  if (/^SELECT cp\.importe, EXISTS \( SELECT 1 FROM stripe_payments sp/.test(s)) {
    const cp = db.payments.get(Number(p[0]));
    return r(cp ? [{ importe: cp.importe, de_stripe: db.deStripe.has(cp.id) }] : []);
  }
  if (/^UPDATE conversion_payments SET importe = \$1 WHERE id = \$2/.test(s)) {
    db.payments.get(Number(p[1])).importe = Number(p[0]);
    return r([]);
  }
  if (/^UPDATE conversion_installments SET importe_cobrado/.test(s)) return r([]);
  if (/^UPDATE conversions SET importe_pagado = GREATEST\(0, importe_pagado \+ \$1\)/.test(s)) {
    const c = db.conversions.get(Number(p[1]));
    c.importe_pagado = Math.max(0, Number((c.importe_pagado + Number(p[0])).toFixed(2)));
    return r([]);
  }
  throw new Error(`SQL no simulada en la prueba: ${s.slice(0, 160)}`);
}

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => responder(sql, params)),
  getClient: vi.fn(async () => ({
    query: vi.fn(async (sql, params) => responder(sql, params)),
    release: vi.fn(),
  })),
}));

// Lo de alrededor del enlace de Stripe, que aqui no se prueba.
vi.mock('../src/modules/integrations/integrations.model.js', () => ({ get: vi.fn(async () => null) }));
vi.mock('../src/modules/tutores/tutor.model.js', () => ({ registrarDevolucion: vi.fn() }));
vi.mock('../src/modules/stripe-payments/stripe-payments.model.js', () => ({
  upsertPayment: vi.fn(async () => ({ id: 138214, conversion_id: null })),
  findLeadByEmail: vi.fn(async () => ({ id: 4080, status: 'convertido', responsable_id: null })),
  findConversionByLeadId: vi.fn(async () => ({ id: 643 })),
  findPagoDuplicado: vi.fn(async () => null),
  linkPayment: vi.fn(async (_id, { conversionPaymentId }) => {
    if (conversionPaymentId) db.deStripe.add(conversionPaymentId);
  }),
}));

const stripe = await import('../src/modules/stripe-payments/stripe-payments.service.js');
const { corregir } = await import('../src/modules/invoices/invoices.controller.js');
const INV = await import('../src/modules/invoices/invoices.model.js');
const service = await import('../src/modules/invoices/invoices.service.js');

// El cargo tal como lo manda Stripe: 412,25 € en euros.
const CARGO = {
  id: 'ch_3UOZjLFsTdkKKUhQ0OoCnx0i', object: 'charge', status: 'succeeded',
  amount: 41225, currency: 'eur', created: 1791536715,
  billing_details: { email: 'alumna@example.com', name: 'Alumna' },
  payment_method_details: { type: 'card' }, metadata: {},
};

// La factura que saco la cola: exenta, por lo cobrado (como la 2026/0196 a las 09:24).
function facturaDeLaCola(paymentId) {
  return {
    id: 411, codigo: '2026/0196', numero: 196, ano: 2026, serie: 'CEDIA', tipo: 'normal', estado: 'pagada',
    project_id: 2, conversion_id: 643, payment_id: paymentId, issuer_id: 8,
    items: [{ descripcion: 'Producto/servicio: servicio académico, Curso de Escalas', cantidad: 1, precio_unitario: 412.25 }],
    base_imponible: 412.25, iva_pct: 0, iva_importe: 0, iva_incluido: false, total: 412.25,
    leyenda_iva: 'Operación exenta de IVA conforme a la normativa aplicable.', metodo_pago: 'tarjeta_stripe',
  };
}

// Lo que manda la pantalla al corregirla: «Lleva IVA» marcado y «El precio ya
// incluye IVA» sin marcar, que es como venia de la factura exenta.
const CORRECCION_CON_IVA = {
  items: [{ descripcion: 'Producto/servicio: servicio académico, Curso de Escalas', cantidad: 1, precio_unitario: 412.25 }],
  ivaPct: 21, ivaIncluido: false, exento: false, numero: 196,
};

async function corregirFactura(id, body) {
  const res = { json: vi.fn() };
  const next = vi.fn();
  await corregir({ params: { id: String(id) }, body, user: { userId: 7, role: 'admin' } }, res, next);
  return { data: res.json.mock.calls[0]?.[0]?.data, error: next.mock.calls[0]?.[0] };
}

async function cobroDeStripe() {
  await stripe.handleWebhookEvent(2, { type: 'charge.succeeded', data: { object: CARGO } });
  const [cp] = [...db.payments.values()];
  return cp;
}

beforeEach(() => { sqls.length = 0; });

describe.each([
  ['con IVA no incluido', false],
  ['con IVA incluido (como la 643 real)', true],
])('venta %s, cargo de Stripe de 412,25 €', (_nombre, ivaIncluidoVenta) => {
  beforeEach(() => { db = base({ ivaIncluidoVenta }); });

  it('el cobro es 412,25: lo que cobro Stripe, sin sumarle el IVA', async () => {
    const cp = await cobroDeStripe();
    expect(cp.importe).toBe(412.25);
    expect(db.conversions.get(643).importe_pagado).toBe(412.25);
    expect(db.deStripe.has(cp.id)).toBe(true);
  });

  it('al ponerle el 21 % a su factura: 412,25 = 340,70 + 71,55, y el cobro no se mueve', async () => {
    const cp = await cobroDeStripe();
    db.invoices.set(411, facturaDeLaCola(cp.id));

    const { data, error } = await corregirFactura(411, CORRECCION_CON_IVA);

    expect(error).toBeUndefined();
    expect(data.total).toBe(412.25);
    expect(data.base_imponible).toBe(340.7);
    expect(data.iva_importe).toBe(71.55);
    expect(data.iva_pct).toBe(21);
    expect(data.iva_incluido).toBe(true);
    // El cobro sigue siendo lo que cobro Stripe, y la venta igual.
    expect(db.payments.get(cp.id).importe).toBe(412.25);
    expect(db.conversions.get(643).importe_pagado).toBe(412.25);
    expect(sqls.some((s) => /^UPDATE conversion_payments/.test(s))).toBe(false);
  });
});

describe('el modelo, aunque le llegue el IVA sumado encima', () => {
  beforeEach(() => { db = base({ ivaIncluidoVenta: false }); });

  it('no toca un cobro de Stripe: 409 y todo como estaba', async () => {
    const cp = await cobroDeStripe();
    db.invoices.set(411, facturaDeLaCola(cp.id));

    const err = await INV.updateBorrador(411, {
      items: CORRECCION_CON_IVA.items, baseImponible: 412.25, ivaPct: 21, ivaImporte: 86.57,
      ivaIncluido: false, total: 498.82, leyendaIva: null,
    }, { soloBorrador: false }).then(() => null, (e) => e);

    expect(err?.code).toBe('COBRO_DE_STRIPE');
    expect(err?.statusCode ?? err?.status).toBe(409);
    expect(err.message).toContain('412.25 €');
    expect(sqls).toContain('ROLLBACK');
    expect(sqls.some((s) => /^UPDATE conversion_payments/.test(s))).toBe(false);
    expect(db.payments.get(cp.id).importe).toBe(412.25);
    expect(db.conversions.get(643).importe_pagado).toBe(412.25);
  });

  it('pero un cobro apuntado a mano se sigue corrigiendo desde su factura (era 300, se pone 250)', async () => {
    db.payments.set(900, { id: 900, conversion_id: 643, importe: 300, fecha: '2026-10-01', metodo: 'transferencia' });
    db.conversions.get(643).importe_pagado = 300;
    db.invoices.set(500, { ...facturaDeLaCola(900), id: 500, total: 300, base_imponible: 300 });

    await INV.updateBorrador(500, {
      items: [{ descripcion: 'Curso', cantidad: 1, precio_unitario: 250 }],
      baseImponible: 250, ivaPct: 0, ivaImporte: 0, ivaIncluido: false, total: 250,
    }, { soloBorrador: false });

    expect(db.payments.get(900).importe).toBe(250);
    expect(db.conversions.get(643).importe_pagado).toBe(250);
  });
});

describe('la regla del IVA dentro', () => {
  const items = [{ cantidad: 1, precio_unitario: 412.25 }];

  it('si los conceptos suman lo cobrado, el IVA va dentro', () => {
    expect(service.ivaDentroSiEsLoCobrado({ items, ivaPct: 21, ivaIncluido: false, cobrado: 412.25 })).toBe(true);
    expect(service.calcularImportes({ items, ivaPct: 21, ivaIncluido: true }))
      .toEqual({ baseImponible: 340.7, ivaImporte: 71.55, total: 412.25 });
  });

  it('si se teclea la base para que con el IVA salga lo cobrado, se respeta', () => {
    const base = [{ cantidad: 1, precio_unitario: 340.7 }];
    expect(service.ivaDentroSiEsLoCobrado({ items: base, ivaPct: 21, ivaIncluido: false, cobrado: 412.25 })).toBe(false);
    expect(service.calcularImportes({ items: base, ivaPct: 21, ivaIncluido: false }).total).toBe(412.25);
  });

  it('sin IVA o sin cobro no cambia nada', () => {
    expect(service.ivaDentroSiEsLoCobrado({ items, ivaPct: 0, ivaIncluido: false, cobrado: 412.25 })).toBe(false);
    expect(service.ivaDentroSiEsLoCobrado({ items, ivaPct: 21, ivaIncluido: false, cobrado: null })).toBe(false);
  });
});
