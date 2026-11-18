import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * #396 · Disputas de Stripe: verlas abiertas por empresa y por campus, y aviso
 * a los admins.
 *
 * Sin base y sin Stripe: el modelo, la campana, Brevo y las llamadas a Stripe
 * van simulados. Lo que se defiende:
 *   · el importe de Stripe se pasa bien a unidades (también monedas sin decimales);
 *   · una disputa nueva y abierta avisa UNA vez (la reserva gana a la carrera);
 *   · el correo no sale con DISPUTAS_CORREO_ACTIVO apagado (de serie);
 *   · el webhook guarda la disputa aunque el CRM no tenga el cargo (en ISEIE
 *     cada campus tiene su cuenta: no hay filtro de cuentas compartidas);
 *   · el resumen separa monedas, agrupa por empresa y campus y no cuenta dos
 *     veces la misma disputa;
 *   · la lista sale del ámbito de quien mira (no de lo que mande la URL).
 *
 *   npx vitest run tests/disputasStripe396.test.js
 */

const modelo = vi.hoisted(() => ({
  ESTADOS_ABIERTOS: ['warning_needs_response', 'warning_under_review', 'needs_response', 'under_review'],
  ESTADOS_SIN_RESPONDER: ['warning_needs_response', 'needs_response'],
  upsertDisputa: vi.fn(),
  cargoDelCrm: vi.fn(),
  abiertasAnterioresA: vi.fn(),
  reservarAviso: vi.fn(),
  soltarAviso: vi.fn(),
  porRecordar: vi.fn(),
  destinatarios: vi.fn(),
  campus: vi.fn(),
  listar: vi.fn(),
  estadoDelSondeo: vi.fn(),
}));
const pagos = vi.hoisted(() => ({
  upsertSyncState: vi.fn(),
  marcarDisputaEnElCargo: vi.fn(),
  listProjectsWithStripe: vi.fn(),
}));
const stripe = vi.hoisted(() => ({ getStripeKey: vi.fn(), stripeGet: vi.fn() }));
const campana = vi.hoisted(() => ({ notifyUsers: vi.fn() }));
const brevo = vi.hoisted(() => ({ sendEmail: vi.fn() }));
const ambito = vi.hoisted(() => ({ proyectosDelAmbito: vi.fn(), campusDeTodos: vi.fn() }));

vi.mock('../src/modules/stripe-payments/disputas.model.js', () => modelo);
vi.mock('../src/modules/stripe-payments/stripe-payments.model.js', () => pagos);
vi.mock('../src/modules/notifications/notifications.service.js', () => campana);
vi.mock('../src/shared/services/brevo.service.js', () => brevo);
vi.mock('../src/shared/utils/ambito.js', () => ambito);
vi.mock('../src/modules/stripe-payments/stripe-payments.service.js', async (original) => {
  const real = await original();
  return { ...real, ...stripe };
});

const svc = await import('../src/modules/stripe-payments/disputas.service.js');
const ctrl = await import('../src/modules/stripe-payments/disputas.controller.js');

const AHORA = Date.UTC(2026, 10, 17, 10, 0, 0);
const seg = (ms) => Math.floor(ms / 1000);
const DIA = 86400000;

/** Una disputa como la manda Stripe. */
function disputaStripe(extra = {}) {
  return {
    id: 'dp_1', object: 'dispute', amount: 12345, currency: 'eur', reason: 'fraudulent',
    status: 'needs_response', livemode: true, created: seg(AHORA - DIA),
    evidence_details: { due_by: seg(AHORA + 5 * DIA), has_evidence: false },
    charge: { id: 'ch_1', billing_details: { email: 'ana@prueba.test', name: 'Ana Pérez' }, metadata: {} },
    payment_intent: 'pi_1',
    ...extra,
  };
}

/** La fila que devolvería el upsert. */
const fila = (extra = {}) => ({
  id: 7, project_id: 2, dispute_id: 'dp_1', charge_id: 'ch_1', amount: 123.45, currency: 'EUR',
  status: 'needs_response', reason: 'fraudulent', evidence_due_by: new Date(AHORA + 5 * DIA).toISOString(),
  customer_name: 'Ana Pérez', customer_email: 'ana@prueba.test', livemode: true, avisada_at: null, nueva: true,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.DISPUTAS_CORREO_ACTIVO;
  modelo.reservarAviso.mockResolvedValue(true);
  modelo.destinatarios.mockResolvedValue([
    { id: 1, email: 'admin.uno@empresa.test', nombre: 'Admin Uno' },
    { id: 5, email: 'admin.dos@empresa.test', nombre: 'Admin Dos' },
  ]);
  modelo.campus.mockResolvedValue({ id: 2, nombre: 'ISEIE España', empresa: 'ISEIE' });
  modelo.cargoDelCrm.mockResolvedValue(null);
  modelo.abiertasAnterioresA.mockResolvedValue([]);
  campana.notifyUsers.mockResolvedValue({ id: 99 });
  brevo.sendEmail.mockResolvedValue({ sent: true });
  stripe.getStripeKey.mockResolvedValue('rk_prueba');
});
afterEach(() => { delete process.env.DISPUTAS_CORREO_ACTIVO; });

describe('el importe de Stripe, en unidades', () => {
  it('céntimos en las monedas normales', () => {
    expect(svc.importeDeStripe(12345, 'eur')).toBe(123.45);
    expect(svc.importeDeStripe(9900, 'USD')).toBe(99);
  });
  it('sin dividir en las que no tienen decimales, y entre mil en las de tres', () => {
    expect(svc.importeDeStripe(5000, 'jpy')).toBe(5000);
    expect(svc.importeDeStripe(1500, 'kwd')).toBe(1.5);
  });
});

describe('la disputa de Stripe, como fila', () => {
  it('con el cargo expandido (sondeo): cliente del cargo, moneda en mayúsculas, fecha límite', () => {
    const d = svc.disputaDeStripe(disputaStripe(), 2);
    expect(d).toMatchObject({
      project_id: 2, dispute_id: 'dp_1', charge_id: 'ch_1', payment_intent_id: 'pi_1',
      amount: 123.45, currency: 'EUR', reason: 'fraudulent', status: 'needs_response',
      evidence_due_by: seg(AHORA + 5 * DIA), customer_email: 'ana@prueba.test', customer_name: 'Ana Pérez',
      livemode: true, origen: 'sondeo',
    });
  });
  it('con el cargo como id (webhook): el cliente sale de lo que ya tiene el CRM', () => {
    const d = svc.disputaDeStripe(disputaStripe({ charge: 'ch_9' }), 2,
      { origen: 'webhook', cargoCrm: { customer_email: 'luis@prueba.test', customer_name: 'Luis' } });
    expect(d).toMatchObject({ charge_id: 'ch_9', customer_email: 'luis@prueba.test', customer_name: 'Luis', origen: 'webhook' });
  });
  it('el enlace a Stripe, y al modo pruebas si no es real', () => {
    expect(svc.enlaceEnStripe('dp_1', true)).toBe('https://dashboard.stripe.com/disputes/dp_1');
    expect(svc.enlaceEnStripe('dp_1', false)).toBe('https://dashboard.stripe.com/test/disputes/dp_1');
  });
});

describe('guardar y avisar', () => {
  it('nueva y abierta: campana a los admins del campus y a los super admin, sin correo (apagado de serie)', async () => {
    modelo.upsertDisputa.mockResolvedValue(fila());
    const r = await svc.guardar(2, disputaStripe());
    expect(r.nueva).toBe(true);
    expect(modelo.reservarAviso).toHaveBeenCalledWith(7, 'avisada_at');
    expect(campana.notifyUsers).toHaveBeenCalledTimes(1);
    const n = campana.notifyUsers.mock.calls[0][0];
    expect(n.targetUserIds).toEqual([1, 5]);
    expect(n.type).toBe('stripe_disputa');
    expect(n.link_path).toBe('/accounting/disputas');
    // Lo que pide la tarjeta en el aviso: cliente, importe, campus y fecha límite.
    expect(n.message).toContain('Ana Pérez');
    expect(n.message).toMatch(/123,45/);
    expect(n.message).toContain('ISEIE España');
    expect(n.message).toMatch(/22 de noviembre de 2026/);
    expect(brevo.sendEmail).not.toHaveBeenCalled();
    expect(r.aviso).toMatchObject({ avisado: true, correo: 'APAGADO' });
  });

  it('con DISPUTAS_CORREO_ACTIVO=true sale también el correo, con clave para no repetirlo', async () => {
    process.env.DISPUTAS_CORREO_ACTIVO = 'true';
    modelo.upsertDisputa.mockResolvedValue(fila());
    await svc.guardar(2, disputaStripe());
    expect(brevo.sendEmail).toHaveBeenCalledTimes(1);
    const c = brevo.sendEmail.mock.calls[0][0];
    expect(c.to).toEqual([{ email: 'admin.uno@empresa.test' }, { email: 'admin.dos@empresa.test' }]);
    expect(c.clave).toBe('stripe-disputa-nueva-2-dp_1');
    expect(c.htmlContent).toContain('https://dashboard.stripe.com/disputes/dp_1');
  });

  it('si otro proceso ya la avisó (webhook y sondeo a la vez), no se avisa dos veces', async () => {
    modelo.upsertDisputa.mockResolvedValue(fila());
    modelo.reservarAviso.mockResolvedValue(false);
    await svc.guardar(2, disputaStripe());
    expect(campana.notifyUsers).not.toHaveBeenCalled();
  });

  it('ya avisada, o cerrada: no avisa', async () => {
    modelo.upsertDisputa.mockResolvedValue(fila({ nueva: false, avisada_at: new Date().toISOString() }));
    await svc.guardar(2, disputaStripe());
    modelo.upsertDisputa.mockResolvedValue(fila({ id: 8, status: 'lost' }));
    await svc.guardar(2, disputaStripe({ status: 'lost' }));
    expect(modelo.reservarAviso).not.toHaveBeenCalled();
    expect(campana.notifyUsers).not.toHaveBeenCalled();
  });

  it('sin nadie a quien avisar, la reserva se suelta para la siguiente vuelta', async () => {
    modelo.upsertDisputa.mockResolvedValue(fila());
    modelo.destinatarios.mockResolvedValue([]);
    const r = await svc.guardar(2, disputaStripe());
    expect(modelo.soltarAviso).toHaveBeenCalledWith(7, 'avisada_at');
    expect(r.aviso).toMatchObject({ avisado: false, motivo: 'SIN_DESTINATARIOS' });
  });

  it('si el CRM tiene el cargo, deja al día sus columnas de disputa (Pagos Stripe)', async () => {
    modelo.cargoDelCrm.mockResolvedValue({ id: 3, customer_email: 'ana@prueba.test' });
    modelo.upsertDisputa.mockResolvedValue(fila({ nueva: false, avisada_at: 'ya' }));
    await svc.guardar(2, disputaStripe());
    expect(pagos.marcarDisputaEnElCargo).toHaveBeenCalledWith(2, 'ch_1', expect.objectContaining({ dispute_id: 'dp_1' }));
  });
});

describe('el webhook', () => {
  it('guarda la disputa aunque el CRM no tenga el cargo, sin preguntar a Stripe', async () => {
    modelo.cargoDelCrm.mockResolvedValue(null);
    modelo.upsertDisputa.mockResolvedValue(fila());
    const r = await svc.desdeElWebhook(2, disputaStripe({ charge: 'ch_1' }));
    expect(r.skipped).toBeUndefined();
    expect(stripe.stripeGet).not.toHaveBeenCalled();
    expect(modelo.upsertDisputa).toHaveBeenCalledWith(expect.objectContaining({ origen: 'webhook', charge_id: 'ch_1' }));
    expect(pagos.marcarDisputaEnElCargo).not.toHaveBeenCalled();
  });
  it('con el cargo en el CRM, el cliente sale de él y se marca el cargo', async () => {
    modelo.cargoDelCrm.mockResolvedValue({ id: 3, customer_email: 'luis@prueba.test', customer_name: 'Luis' });
    modelo.upsertDisputa.mockResolvedValue(fila({ nueva: false, avisada_at: 'ya' }));
    await svc.desdeElWebhook(2, disputaStripe({ charge: 'ch_1' }));
    expect(modelo.upsertDisputa).toHaveBeenCalledWith(expect.objectContaining({ origen: 'webhook', customer_name: 'Luis' }));
    expect(pagos.marcarDisputaEnElCargo).toHaveBeenCalledWith(2, 'ch_1', expect.objectContaining({ dispute_id: 'dp_1' }));
  });
});

describe('el sondeo', () => {
  it('pide las de la ventana con el cargo expandido, pagina, y revisa una a una las abiertas más viejas', async () => {
    modelo.upsertDisputa.mockImplementation(async (d) => fila({ dispute_id: d.dispute_id, nueva: false, avisada_at: 'ya' }));
    modelo.abiertasAnterioresA.mockResolvedValue(['dp_viejo']);
    stripe.stripeGet
      .mockResolvedValueOnce({ data: [disputaStripe({ id: 'dp_1' })], has_more: true })
      .mockResolvedValueOnce({ data: [disputaStripe({ id: 'dp_2' })], has_more: false })
      .mockResolvedValueOnce(disputaStripe({ id: 'dp_viejo', status: 'under_review' }));
    const r = await svc.sincronizar(2, { ahora: AHORA });
    expect(r).toMatchObject({ vistas: 2, revisadas: 1 });
    const [, ruta, params] = stripe.stripeGet.mock.calls[0];
    expect(ruta).toBe('/v1/disputes');
    expect(params['expand[]']).toBe('data.charge');
    expect(params['created[gte]']).toBe(seg(AHORA) - 120 * 86400);
    expect(stripe.stripeGet.mock.calls[1][2].starting_after).toBe('dp_1');
    expect(stripe.stripeGet.mock.calls[2][1]).toBe('/v1/disputes/dp_viejo');
    expect(pagos.upsertSyncState).toHaveBeenCalledWith(2, expect.objectContaining({ disputes_last_error: null }));
  });

  it('sin cuentas compartidas en ISEIE: toda disputa de la cuenta es del campus', async () => {
    modelo.upsertDisputa.mockResolvedValue(fila({ nueva: false, avisada_at: 'ya' }));
    stripe.stripeGet.mockResolvedValueOnce({ data: [
      disputaStripe({ id: 'dp_a', charge: { id: 'ch_a', metadata: { proyecto: 'uno' } } }),
      disputaStripe({ id: 'dp_b', charge: { id: 'ch_b', metadata: { proyecto: 'otro' } } }),
    ], has_more: false });
    const r = await svc.sincronizar(2, { ahora: AHORA });
    expect(r).toMatchObject({ vistas: 2 });
    expect(r.ajenas).toBeUndefined();
  });

  it('si Stripe falla, se apunta el fallo y no la hora del último bueno', async () => {
    stripe.stripeGet.mockRejectedValue(new Error('Stripe /v1/disputes HTTP 401'));
    await expect(svc.sincronizar(2, { ahora: AHORA })).rejects.toThrow('401');
    expect(pagos.upsertSyncState).toHaveBeenCalledWith(2, { disputes_last_error: 'Stripe /v1/disputes HTTP 401' });
  });

  it('sin clave de Stripe en el campus es un 409 de negocio, no un 500, y se apunta el motivo', async () => {
    stripe.getStripeKey.mockResolvedValue(null);
    const err = await svc.sincronizar(2, { ahora: AHORA }).catch((e) => e);
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('STRIPE_SIN_CLAVE');
    expect(stripe.stripeGet).not.toHaveBeenCalled();
    expect(pagos.upsertSyncState).toHaveBeenCalledWith(2, { disputes_last_error: 'Stripe API key no configurada para este proyecto' });
  });

  it('el segundo aviso: las que vencen pronto sin respuesta, con su propio tipo', async () => {
    modelo.porRecordar.mockResolvedValue([fila({ avisada_at: 'ya' })]);
    const r = await svc.recordar();
    expect(r.recordadas).toBe(1);
    expect(modelo.porRecordar).toHaveBeenCalledWith(3);
    expect(modelo.reservarAviso).toHaveBeenCalledWith(7, 'recordada_at');
    expect(campana.notifyUsers.mock.calls[0][0].type).toBe('stripe_disputa_vence');
  });
});

describe('el resumen de la pantalla', () => {
  const f = (extra) => ({
    id: 1, dispute_id: 'dp_x', project_id: 1, proyecto: 'ISEIH', empresa_id: 8, empresa: 'CEDIA',
    status: 'needs_response', amount: 100, currency: 'EUR', evidence_due_by: new Date(AHORA + 10 * DIA).toISOString(), ...extra,
  });
  const filas = [
    f({ id: 1, dispute_id: 'dp_1', amount: 100, evidence_due_by: new Date(AHORA + 2 * DIA).toISOString() }),
    f({ id: 2, dispute_id: 'dp_2', project_id: 2, proyecto: 'Psiko Aprende', amount: 50.5 }),
    f({ id: 3, dispute_id: 'dp_3', project_id: 2, proyecto: 'Psiko Aprende', amount: 200, currency: 'USD' }),
    // La misma disputa vista desde dos campus que comparten cuenta sin filtro.
    f({ id: 4, dispute_id: 'dp_2', project_id: 3, proyecto: 'Fono Aprende', amount: 50.5 }),
    f({ id: 5, dispute_id: 'dp_4', project_id: 4, proyecto: 'ICTESS', empresa_id: 9, empresa: 'ICTESS', amount: 30 }),
    f({ id: 6, dispute_id: 'dp_5', status: 'lost', amount: 999 }),
  ];

  it('por empresa y por campus, con un total por moneda y sin contar dos veces la misma', () => {
    const r = svc.resumir(filas, { dias: 7, ahora: AHORA });
    expect(r.total.abiertas).toBe(4);
    expect(r.total.importes).toEqual({ EUR: 180.5, USD: 200 });
    const cedia = r.porEmpresa.find((e) => e.empresa_id === 8);
    expect(cedia).toMatchObject({ abiertas: 3, importes: { EUR: 150.5, USD: 200 } });
    expect(r.porEmpresa.find((e) => e.empresa_id === 9)).toMatchObject({ abiertas: 1, importes: { EUR: 30 } });
    expect(r.porProyecto.map((p) => [p.proyecto, p.abiertas])).toEqual([
      ['Fono Aprende', 1], ['ICTESS', 1], ['ISEIH', 1], ['Psiko Aprende', 2],
    ]);
  });

  it('las que vencen en los próximos días, de la más urgente a la menos', () => {
    expect(svc.resumir(filas, { dias: 7, ahora: AHORA }).vencenPronto.map((v) => v.dispute_id)).toEqual(['dp_1']);
    expect(svc.resumir(filas, { dias: 15, ahora: AHORA }).vencenPronto.map((v) => v.dispute_id))
      .toEqual(['dp_1', 'dp_2', 'dp_3', 'dp_4']);
  });
});

describe('la lista, dentro de lo de quien mira', () => {
  const res = () => { const r = {}; r.json = vi.fn(() => r); r.status = vi.fn(() => r); return r; };

  it('pide al modelo el ámbito ya recortado, no lo que venga en la URL', async () => {
    ambito.proyectosDelAmbito.mockResolvedValue({ projectId: null, projectIds: [1, 2] });
    modelo.listar.mockResolvedValue([]);
    modelo.estadoDelSondeo.mockResolvedValue([]);
    const r = res(); const next = vi.fn();
    await ctrl.listar({ query: { issuerId: '9' }, user: { userId: 5, role: 'admin' } }, r, next);
    expect(next).not.toHaveBeenCalled();
    expect(modelo.listar).toHaveBeenCalledWith({ projectId: null, projectIds: [1, 2], estado: 'abiertas' });
    expect(modelo.estadoDelSondeo).toHaveBeenCalledWith([1, 2]);
  });

  it('sin campus ni empresa, todos los suyos (campusDeTodos)', async () => {
    ambito.proyectosDelAmbito.mockResolvedValue({ projectId: null, projectIds: null });
    ambito.campusDeTodos.mockResolvedValue([1, 2, 3, 4]);
    modelo.listar.mockResolvedValue([{ dispute_id: 'dp_1', livemode: true, status: 'needs_response', amount: 1, currency: 'EUR' }]);
    modelo.estadoDelSondeo.mockResolvedValue([]);
    const r = res();
    await ctrl.listar({ query: {}, user: { userId: 1, role: 'superadmin' } }, r, vi.fn());
    expect(modelo.listar).toHaveBeenCalledWith({ projectId: null, projectIds: [1, 2, 3, 4], estado: 'abiertas' });
    expect(r.json.mock.calls[0][0].data.disputas[0].stripe_url).toBe('https://dashboard.stripe.com/disputes/dp_1');
  });

  it('un filtro raro es un 400, no una consulta', async () => {
    const next = vi.fn();
    await ctrl.listar({ query: { estado: 'borrar' }, user: { userId: 1, role: 'superadmin' } }, res(), next);
    expect(next.mock.calls[0][0].statusCode).toBe(400);
  });
});

describe('las rutas', () => {
  const rutas = readFileSync(new URL('../src/modules/stripe-payments/stripe-payments.routes.js', import.meta.url), 'utf8');
  it('/disputas va antes de /:id y pide stripe.edit (admin y super admin)', () => {
    const disputas = rutas.indexOf("router.get('/disputas'");
    expect(disputas).toBeGreaterThan(-1);
    expect(disputas).toBeLessThan(rutas.indexOf("router.get('/:id'"));
    expect(rutas).toMatch(/router\.get\('\/disputas', puede\('stripe\.edit'\)/);
    // Traerlas a mano de una cuenta: solo de un campus suyo.
    expect(rutas).toMatch(/router\.post\('\/disputas\/sincronizar', puede\('stripe\.edit'\), projectAccess/);
  });
  it('el webhook guarda las disputas por la misma puerta que el sondeo', () => {
    const src = readFileSync(new URL('../src/modules/stripe-payments/stripe-payments.service.js', import.meta.url), 'utf8');
    const desde = src.indexOf("case 'charge.dispute.created'");
    expect(src.slice(desde, src.indexOf('case \'payment_intent.succeeded\'', desde))).toContain('desdeElWebhook');
  });
});
