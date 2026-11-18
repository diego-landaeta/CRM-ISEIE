import { describe, it, expect, vi, beforeEach } from 'vitest';

// #747 · Ventas a plazos: la suscripción de Stripe se cierra sola al completar el
// pago, y se avisa. Manuel: «si nadie cancela la suscripción a tiempo se cobra
// una cuota de más. Ya ha pasado». Cifras inventadas.

const estado = vi.hoisted(() => ({ venta: null, filas: {}, sql: [] }));

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  query: vi.fn(async (sql, params) => {
    estado.sql.push({ sql, params });
    if (/FROM conversions c\s+LEFT JOIN projects/.test(sql)) return { rows: estado.venta ? [estado.venta] : [] };
    if (/SET suscripcion_estado = 'cerrando'/.test(sql)) {
      return { rows: estado.filas.reservaFalla ? [] : [{ suscripcion_estado: 'cerrando' }] };
    }
    if (/SET suscripcion_estado = 'revisar'/.test(sql)) {
      return { rows: estado.filas.yaEnRevisar ? [] : [{ id: 1 }] };
    }
    if (/SET suscripcion_estado = 'error'/.test(sql)) return { rows: [{ error_antes: estado.filas.errorAntes || null }] };
    if (/FROM project_webhook_tokens/.test(sql)) return { rows: estado.filas.webhooks || [] };
    return { rows: [] };
  }),
}));

const S = await import('../src/modules/stripe-payments/suscripciones.service.js');

// Una venta a 3 cuotas de 100 €, con su suscripción.
const venta = (x = {}) => ({
  id: 70, project_id: 1, lead_id: 9, importe_total: '300.00', producto_contratado: 'Curso de prueba',
  stripe_subscription_id: 'sub_123', suscripcion_estado: 'activa', suscripcion_cerrada_at: null,
  campus: 'Campus de prueba', cobrado: '300.00', cobros: 3, cuotas_pendientes: 0, ...x,
});

function stripeDeMentira({ estadoSub = 'active', borrarFalla = null } = {}) {
  const llamadas = [];
  const llamar = vi.fn(async (_k, metodo, path) => {
    llamadas.push(`${metodo} ${path}`);
    if (metodo === 'GET' && path.startsWith('/v1/subscriptions/')) return { id: 'sub_123', status: estadoSub };
    if (metodo === 'DELETE') {
      if (borrarFalla) { const e = new Error(borrarFalla); e.status = 403; throw e; }
      return { id: 'sub_123', status: 'canceled' };
    }
    return {};
  });
  return { llamar, llamadas };
}

const deps = (x = {}) => ({ activo: () => true, clave: async () => 'sk_test_x', avisar: vi.fn(async () => ({ enviado: true })), ...x });

beforeEach(() => { estado.venta = null; estado.filas = {}; estado.sql = []; });

describe('de qué suscripción es un cargo', () => {
  it('la factura de siempre y la de la API de 2025', () => {
    expect(S.suscripcionDeFactura({ subscription: 'sub_a' })).toBe('sub_a');
    expect(S.suscripcionDeFactura({ parent: { subscription_details: { subscription: 'sub_b' } } })).toBe('sub_b');
    expect(S.suscripcionDeFactura({ lines: { data: [{ parent: { subscription_item_details: { subscription: 'sub_c' } } }] } })).toBe('sub_c');
    expect(S.suscripcionDeFactura({ id: 'in_1' })).toBeNull();
  });

  it('cargo → factura → suscripción', async () => {
    const llamar = vi.fn(async (_k, _m, path) => (path.startsWith('/v1/charges/')
      ? { id: 'ch_1', invoice: 'in_1' } : { id: 'in_1', subscription: 'sub_1' }));
    expect(await S.suscripcionDelCargo('k', 'ch_1', { llamar })).toBe('sub_1');
  });

  it('sin factura en el cargo, por su PaymentIntent (API nueva)', async () => {
    const llamar = vi.fn(async (_k, _m, path) => {
      if (path.startsWith('/v1/charges/')) return { id: 'ch_1', payment_intent: 'pi_1' };
      if (path === '/v1/invoice_payments') return { data: [{ invoice: 'in_9' }] };
      return { id: 'in_9', parent: { subscription_details: { subscription: 'sub_9' } } };
    });
    expect(await S.suscripcionDelCargo('k', 'ch_1', { llamar })).toBe('sub_9');
  });

  it('un pago único no tiene suscripción', async () => {
    const llamar = vi.fn(async (_k, _m, path) => {
      if (path.startsWith('/v1/charges/')) return { id: 'ch_1', payment_intent: 'pi_1' };
      return { data: [] };
    });
    expect(await S.suscripcionDelCargo('k', 'ch_1', { llamar })).toBeNull();
  });
});

describe('qué toca hacer', () => {
  it('cuenta lo cobrado, no las cuotas emitidas', () => {
    // Dos cuotas cobradas y la tercera fallida: no se cierra.
    expect(S.decidir(venta({ cobrado: '200.00', cobros: 2 }))).toBe('falta');
    expect(S.decidir(venta())).toBe('cerrar');
    expect(S.decidir(venta({ cobrado: '299.995' }))).toBe('cerrar');
  });
  it('si quedan cuotas previstas sin cobrar, no cierra: revisar', () => {
    expect(S.decidir(venta({ cuotas_pendientes: 1 }))).toBe('revisar');
  });
  it('sin suscripción, ya cerrada o sin total, nada', () => {
    expect(S.decidir(venta({ stripe_subscription_id: null }))).toBe('sin_suscripcion');
    expect(S.decidir(venta({ suscripcion_cerrada_at: new Date() }))).toBe('ya_cerrada');
    expect(S.decidir(venta({ importe_total: '0' }))).toBe('sin_total');
  });
});

describe('cerrar la suscripción', () => {
  it('al cobrarse la tercera cuota, la cancela en Stripe y avisa', async () => {
    estado.venta = venta();
    const { llamar, llamadas } = stripeDeMentira();
    const d = deps({ llamar });
    const r = await S.revisarVenta(70, d);
    expect(r.resultado).toBe('cancelada');
    expect(llamadas).toEqual(['GET /v1/subscriptions/sub_123', 'DELETE /v1/subscriptions/sub_123']);
    expect(estado.sql.some((q) => /suscripcion_estado = 'cancelada', suscripcion_cerrada_at = NOW\(\)/.test(q.sql))).toBe(true);
    expect(d.avisar).toHaveBeenCalledWith(expect.objectContaining({ id: 70 }), 'cancelada');
  });

  it('con una cuota fallida no se cancela antes de tiempo', async () => {
    estado.venta = venta({ cobrado: '200.00', cobros: 2 });
    const { llamar } = stripeDeMentira();
    const d = deps({ llamar });
    expect((await S.revisarVenta(70, d)).resultado).toBe('falta');
    expect(llamar).not.toHaveBeenCalled();
    expect(d.avisar).not.toHaveBeenCalled();
  });

  it('con el interruptor apagado no toca Stripe', async () => {
    estado.venta = venta();
    const { llamar } = stripeDeMentira();
    const d = deps({ llamar, activo: () => false });
    expect((await S.revisarVenta(70, d)).resultado).toBe('apagado');
    expect(llamar).not.toHaveBeenCalled();
  });

  it('si otro la está cerrando a la vez, no la cancela dos veces', async () => {
    estado.venta = venta();
    estado.filas.reservaFalla = true;
    const { llamar } = stripeDeMentira();
    expect((await S.revisarVenta(70, deps({ llamar }))).resultado).toBe('en_curso');
    expect(llamar).not.toHaveBeenCalled();
  });

  it('si ya estaba cancelada en Stripe, la marca y no avisa', async () => {
    estado.venta = venta();
    const { llamar, llamadas } = stripeDeMentira({ estadoSub: 'canceled' });
    const d = deps({ llamar });
    expect((await S.revisarVenta(70, d)).resultado).toBe('ya_cerrada_en_stripe');
    expect(llamadas).not.toContain('DELETE /v1/subscriptions/sub_123');
    expect(d.avisar).not.toHaveBeenCalled();
  });

  it('si Stripe no deja (clave de solo lectura), avisa para cancelarla a mano, una vez', async () => {
    estado.venta = venta();
    const { llamar } = stripeDeMentira({ borrarFalla: 'HTTP 403' });
    const d = deps({ llamar });
    const r = await S.revisarVenta(70, d);
    expect(r.resultado).toBe('error');
    expect(d.avisar).toHaveBeenCalledWith(expect.anything(), 'error', 'HTTP 403');
    // La siguiente vuelta lo reintenta, pero ya no vuelve a avisar.
    estado.filas.errorAntes = 'HTTP 403';
    const d2 = deps({ llamar });
    await S.revisarVenta(70, d2);
    expect(d2.avisar).not.toHaveBeenCalled();
  });

  it('con cuotas previstas sin cobrar, avisa para revisar (una vez) y no cancela', async () => {
    estado.venta = venta({ cuotas_pendientes: 1 });
    const { llamar } = stripeDeMentira();
    const d = deps({ llamar });
    expect((await S.revisarVenta(70, d)).resultado).toBe('revisar');
    expect(llamar).not.toHaveBeenCalled();
    expect(d.avisar).toHaveBeenCalledWith(expect.anything(), 'revisar');
    estado.filas.yaEnRevisar = true;
    const d2 = deps({ llamar });
    await S.revisarVenta(70, d2);
    expect(d2.avisar).not.toHaveBeenCalled();
  });
});

describe('el aviso', () => {
  it('a admisión del campus y a SUSCRIPCION_AVISO_PARA, sin repetir', async () => {
    estado.filas.webhooks = [{ aviso_emails: ['Admision@campus.test', 'info@campus.test'] }];
    const para = await S.destinatarios(1, { SUSCRIPCION_AVISO_PARA: 'direccion@empresa.test, admision@campus.test' });
    expect(para).toEqual(['admision@campus.test', 'info@campus.test', 'direccion@empresa.test']);
  });

  it('sin el nombre de la alumna, con la venta y el botón a su ficha', () => {
    const c = S.armarAviso(venta(), 'cancelada');
    expect(c.asunto).toBe('Pago completado: suscripción cerrada · Campus de prueba');
    expect(c.htmlContent).toContain('Venta nº <strong>70</strong>');
    expect(c.htmlContent).toContain('sub_123');
    expect(c.htmlContent).toMatch(/clientes\/9/);
    expect(c.textContent).toMatch(/no se le cobrará ninguna cuota más/);
  });

  it('el de error dice que hay que cancelarla a mano', () => {
    const c = S.armarAviso(venta(), 'error', 'HTTP 403');
    expect(c.asunto).toMatch(/^URGENTE/);
    expect(c.textContent).toMatch(/Cancélala a mano en Stripe/);
  });
});
