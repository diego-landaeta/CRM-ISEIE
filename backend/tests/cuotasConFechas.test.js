import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Cuotas con sus fechas, con o sin cobro automático (gemela de CRM#1021; Diego, 23/11/2026: «el link
 * de pago debe dejar CREAR CUOTAS Y ELEGIR LAS FECHAS SÍ O SÍ»).
 *
 * Sin base: lo puro y, con el modelo y Stripe de mentira, lo que pasa al pagarse
 * la inicial. Lo que va contra la base, en linkSencilloCuotas.test.js.
 *
 *   · `cuotas` en el cuerpo: una por cuota, que sumen lo que queda tras la
 *     inicial y cada una después de la anterior; la primera, de mañana en
 *     adelante; la última, a menos de tres años;
 *   · la venta del link nace con esas fechas (`planDelLink` con `plan_cuotas`);
 *   · el link de una cuota vive hasta su fecha, aunque pase de la máxima del
 *     campus (antes caducaba antes de vencer);
 *   · al pagarse la inicial de un link SIN cobro automático, un link por cuota
 *     (menos la 1, que es la inicial); con cobro automático, ninguno;
 *   · la migración 326: solo añade la columna, y se puede pasar dos veces.
 *
 *   npx vitest run tests/cuotasConFechas.test.js
 */

process.env.LOG_LEVEL = 'silent';

const m = vi.hoisted(() => ({
  producto: vi.fn(), config: vi.fn(), ventaConFicha: vi.fn(), cuotasPendientes: vi.fn(), anotarEvento: vi.fn(),
  marcarPagado: vi.fn(), anotarEventoDelCargo: vi.fn(),
}));
const crearLinksDeCuotas = vi.hoisted(() => vi.fn());
const trasPagarseUnLink = vi.hoisted(() => vi.fn());
// Lo que mira `paraUnLinkEnCuotas` (en MultiCRM, en conectarStripe992.test.js).
const delCampus = vi.hoisted(() => vi.fn());
const claveDeEscritura = vi.hoisted(() => vi.fn());
const claveObligatoria = vi.hoisted(() => vi.fn());
const comprobarPermisosDeCobro = vi.hoisted(() => vi.fn());
vi.mock('../src/modules/links-pago/links-pago.model.js', async (orig) => ({ ...(await orig()), ...m }));
vi.mock('../src/modules/links-pago/links-pago.service.js', async (orig) => ({ ...(await orig()), crearLinksDeCuotas, claveDeEscritura, claveObligatoria }));
vi.mock('../src/modules/links-pago/links-pago.cobro-auto.model.js', async (orig) => ({ ...(await orig()), delCampus }));
vi.mock('../src/modules/links-pago/links-pago.stripe.js', async (orig) => ({ ...(await orig()), comprobarPermisosDeCobro }));
vi.mock('../src/modules/links-pago/links-pago.cobro-auto.js', async (orig) => ({ ...(await orig()), trasPagarseUnLink }));

const { crearSchema } = await import('../src/modules/links-pago/links-pago.validation.js');
const service = await import('../src/modules/links-pago/links-pago.service.js');
const cobro = await import('../src/modules/links-pago/links-pago.cobro.js');
const cobroAuto = await import('../src/modules/links-pago/links-pago.cobro-auto.js');
const { ErrorDeStripe } = await import('../src/modules/links-pago/links-pago.stripe.js');

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SQL = fs.readFileSync(path.join(AQUI, '..', 'migrations', '326_links_pago_plan_de_cuotas.sql'), 'utf8');
const sinComentarios = SQL.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

const BASE = { projectId: 1, productId: 5, importe: 900, modalidad: 'cuotas', num_cuotas: 2, inicial: 300 };
const CFG = { cuotas_admitidas: true, cuotas_max: 12, monedas: ['EUR'], moneda_defecto: 'EUR', caducidad_dias: 7, caducidad_max_dias: 30, descuento_max_pct: 0 };
const PROD = { id: 5, nombre: 'Máster', precio: 900, moneda: 'EUR' };
const error = (cuerpo) => crearSchema.safeParse(cuerpo).error?.errors?.[0]?.message;

beforeEach(() => {
  for (const f of [...Object.values(m), crearLinksDeCuotas, trasPagarseUnLink]) f.mockReset();
});

describe('las cuotas que manda la gestora (Zod)', () => {
  const plan = [{ importe: 250, vence: '2026-12-23' }, { importe: 350, vence: '2027-02-23' }];
  it('una por cuota, con su importe y su fecha: vale', () => {
    const r = crearSchema.safeParse({ ...BASE, cuotas: plan });
    expect(r.success).toBe(true);
    expect(r.data.cuotas).toEqual(plan);
    // Sin `cuotas`, como siempre (reparto igual, una al mes desde el pago).
    expect(crearSchema.safeParse(BASE).success).toBe(true);
  });
  it('que sumen lo que queda tras la inicial, al céntimo', () => {
    expect(error({ ...BASE, cuotas: [{ importe: 250, vence: '2026-12-23' }, { importe: 349.99, vence: '2027-02-23' }] })).toMatch(/no suman/);
    expect(crearSchema.safeParse({ ...BASE, importe: 900.01, cuotas: [{ importe: 250, vence: '2026-12-23' }, { importe: 350.01, vence: '2027-02-23' }] }).success).toBe(true);
  });
  it('tantas como `num_cuotas`, cada una después de la anterior, y fechas que existen', () => {
    expect(error({ ...BASE, cuotas: [{ importe: 600, vence: '2026-12-23' }] })).toMatch(/una fecha por cuota/);
    expect(error({ ...BASE, cuotas: [plan[1], plan[0]] })).toMatch(/después de la anterior/);
    expect(error({ ...BASE, cuotas: [plan[0], { importe: 350, vence: '2026-12-23' }] })).toMatch(/después de la anterior/);
    expect(error({ ...BASE, cuotas: [plan[0], { importe: 350, vence: '2027-02-30' }] })).toMatch(/no existe/);
    expect(error({ ...BASE, cuotas: [plan[0], { importe: 350, vence: '23/02/2027' }] })).toMatch(/AAAA-MM-DD/);
  });
  it('solo con «inicial + cuotas»', () => {
    expect(error({ ...BASE, inicial: undefined, num_cuotas: 2, cuotas: plan })).toMatch(/inicial \+ cuotas/);
    expect(error({ projectId: 1, productId: 5, importe: 900, cuotas: plan })).toBeTruthy();
  });
});

describe('las reglas del servidor con las fechas', () => {
  const reglas = (plan, hoy = '2026-11-23') => service.comprobarReglas({
    cfg: CFG, prod: PROD, importe: 900, modalidad: 'cuotas', numCuotas: plan.length, inicial: 300, plan, hoy, esAdmin: false,
  });
  it('de mañana en adelante, a menos de tres años y cada una de al menos 0,50 €', () => {
    expect(() => reglas([{ importe: 600, vence: '2026-11-24' }])).not.toThrow();
    expect(() => reglas([{ importe: 600, vence: '2026-11-23' }])).toThrow(/de mañana en adelante/);
    expect(() => reglas([{ importe: 600, vence: '2026-11-01' }])).toThrow(/de mañana en adelante/);
    expect(() => reglas([{ importe: 600, vence: '2029-11-23' }])).not.toThrow();
    expect(() => reglas([{ importe: 600, vence: '2029-11-24' }])).toThrow(/más de 3 años/);
    expect(() => reglas([{ importe: 599.6, vence: '2026-12-01' }, { importe: 0.4, vence: '2027-01-01' }])).toThrow(/al menos 0,50 €/);
  });
});

describe('la venta del link, con las fechas elegidas', () => {
  it('la inicial el día del pago y cada cuota con su importe y su fecha', () => {
    const link = { modalidad: 'cuotas', num_cuotas: 3, importe: '900', importe_inicial: '300',
      plan_cuotas: [{ importe: 250, vence: '2026-12-05' }, { importe: 350, vence: '2027-02-20' }] };
    expect(service.planDelLink(link, '2026-11-24')).toEqual([
      { numero: 1, importe: 300, vence: '2026-11-24' },
      { numero: 2, importe: 250, vence: '2026-12-05' },
      { numero: 3, importe: 350, vence: '2027-02-20' },
    ]);
  });
  it('sin fechas (los links de antes), como siempre: iguales y una al mes desde el pago', () => {
    const link = { modalidad: 'cuotas', num_cuotas: 3, importe: '900', importe_inicial: '300', plan_cuotas: null };
    expect(service.planDelLink(link, '2026-11-24').map((c) => c.vence)).toEqual(['2026-11-24', '2026-12-24', '2027-01-24']);
  });
});

describe('el link de una cuota vive hasta su fecha', () => {
  const hoy = new Date('2026-11-23T10:00:00Z');
  it('vencimiento + la caducidad de serie, aunque pase de la máxima del campus', () => {
    expect(service.diasDeLaCuota('2027-02-23', CFG, hoy)).toBe(92 + 7);
    expect(service.diasDeLaCuota('2026-11-25', CFG, hoy)).toBe(2 + 7);
    // Vencida o de hoy: la caducidad de serie.
    expect(service.diasDeLaCuota('2026-11-01', CFG, hoy)).toBe(7);
  });
});

describe('al pagarse la inicial', () => {
  const LINK = { id: 40, project_id: 3, product_id: 5, created_by: 9, modalidad: 'cuotas', guarda_tarjeta: false, installment_id: null };
  const PENDIENTES = [
    { id: 101, numero: 1, importe: 300, vence: '2026-11-23', link_id: null },
    { id: 102, numero: 2, importe: 250, vence: '2026-12-05', link_id: null },
    { id: 103, numero: 3, importe: 350, vence: '2027-02-20', link_id: 77 },
  ];
  beforeEach(() => {
    m.producto.mockResolvedValue(PROD);
    m.config.mockResolvedValue(CFG);
    m.ventaConFicha.mockResolvedValue({ id: 500, lead_id: 60 });
    m.cuotasPendientes.mockResolvedValue(PENDIENTES);
    m.anotarEvento.mockResolvedValue();
    crearLinksDeCuotas.mockResolvedValue([201]);
  });

  it('sin cobro automático: un link por cuota pendiente, menos la 1 (la inicial), y queda en el historial', async () => {
    expect(await cobro.linksDeLasCuotas(LINK, 500)).toEqual([201]);
    expect(crearLinksDeCuotas).toHaveBeenCalledWith({
      projectId: 3, leadId: 60, conversionId: 500, prod: PROD, cfg: CFG, userId: 9, cuotas: PENDIENTES.slice(1),
    });
    expect(m.anotarEvento).toHaveBeenCalledWith(40, 'links_de_las_cuotas', { conversion_id: 500, links: [201] });
  });

  it('con cobro automático, de una cuota, de pago único o sin venta: nada', async () => {
    for (const l of [{ ...LINK, guarda_tarjeta: true }, { ...LINK, installment_id: 101 }, { ...LINK, modalidad: 'unico' }]) {
      expect(await cobro.linksDeLasCuotas(l, 500)).toEqual([]);
    }
    expect(await cobro.linksDeLasCuotas(LINK, null)).toEqual([]);
    expect(crearLinksDeCuotas).not.toHaveBeenCalled();
  });

  it('si Stripe falla, no lanza: lo apunta en el historial del link', async () => {
    crearLinksDeCuotas.mockRejectedValue(new Error('Stripe caído'));
    expect(await cobro.linksDeLasCuotas(LINK, 500)).toEqual([]);
    expect(m.anotarEvento).toHaveBeenCalledWith(40, 'links_de_las_cuotas_fallidos', { conversion_id: 500, motivo: 'Stripe caído' });
  });

  it('`trasCobrar`: con la tarjeta, el cobro automático; sin ella, los links de las cuotas', async () => {
    m.marcarPagado.mockResolvedValue({ estado_antes: 'abierto' });
    const payment = { stripe_id: 'ch_1', stripe_created_at: 1795000000, amount: 300, payment_method: 'card' };
    await cobro.trasCobrar(LINK, { payment, conversionId: 500, conversionPaymentId: 1 });
    expect(crearLinksDeCuotas).toHaveBeenCalledTimes(1);
    expect(trasPagarseUnLink).not.toHaveBeenCalled();
    await cobro.trasCobrar({ ...LINK, guarda_tarjeta: true }, { payment, conversionId: 500, conversionPaymentId: 1 });
    expect(trasPagarseUnLink).toHaveBeenCalledTimes(1);
    expect(crearLinksDeCuotas).toHaveBeenCalledTimes(1);
    // Un aviso repetido (ya estaba pagado): nada otra vez.
    m.marcarPagado.mockResolvedValue(null);
    await cobro.trasCobrar(LINK, { payment, conversionId: 500, conversionPaymentId: 1 });
    expect(crearLinksDeCuotas).toHaveBeenCalledTimes(1);
  });
});

describe('«Inicial + cuotas»: disponibles siempre que el campus las admita', () => {
  const para = (o = {}) => cobroAuto.paraUnLinkEnCuotas(1, { cfg: CFG, puedeCobroAuto: true, ...o });
  beforeEach(() => {
    for (const f of [delCampus, claveDeEscritura, claveObligatoria, comprobarPermisosDeCobro]) f.mockReset();
    delCampus.mockResolvedValue({ permitido: true, reintento_dias: 3 });
    claveDeEscritura.mockResolvedValue('rk_test_x');
    claveObligatoria.mockResolvedValue('rk_test_x');
    comprobarPermisosDeCobro.mockResolvedValue(undefined);
  });
  it('todo en orden: disponibles y automáticas', async () => {
    expect(await para()).toEqual({ disponible: true, automatico: true, motivo: null, cuotas_max: 12 });
  });
  it('sin cobro automático (clave sin permisos, campus que no lo permite, sin el permiso): disponibles, cada una con su link', async () => {
    comprobarPermisosDeCobro.mockRejectedValueOnce(new ErrorDeStripe(403, 'The provided key does not have the required permissions'));
    const r = await para();
    expect(r).toMatchObject({ disponible: true, automatico: false });
    expect(r.motivo).toMatch(/Subscription Schedules/);
    delCampus.mockResolvedValueOnce({ permitido: false, reintento_dias: 3 });
    expect(await para()).toMatchObject({ disponible: true, automatico: false, motivo: expect.stringMatching(/no tiene permitido/) });
    claveDeEscritura.mockResolvedValueOnce(null);
    expect(await para()).toMatchObject({ disponible: true, automatico: false });
    expect(await para({ puedeCobroAuto: false })).toMatchObject({ disponible: true, automatico: false });
  });
  it('sin cuotas, solo lo que decide el campus', async () => {
    expect(await para({ cfg: null })).toMatchObject({ disponible: false, automatico: false });
    expect(await para({ cfg: { ...CFG, cuotas_admitidas: false } })).toMatchObject({ disponible: false, motivo: expect.stringMatching(/no admite pagos en cuotas/) });
    expect(await para({ cfg: { ...CFG, monedas: ['USD'] } })).toMatchObject({ disponible: false, motivo: expect.stringMatching(/EUR/) });
  });
});

describe('la migración 326', () => {
  it('solo añade la columna (y su CHECK), en una transacción, y se puede pasar dos veces', () => {
    expect(sinComentarios).toMatch(/ADD COLUMN IF NOT EXISTS plan_cuotas JSONB;/);
    expect(sinComentarios).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_links_plan_cuotas'\)/);
    expect(sinComentarios).toMatch(/^BEGIN;/m);
    expect(sinComentarios).toMatch(/^COMMIT;/m);
    expect(sinComentarios).not.toMatch(/\bDROP\b|\bDELETE\b|TRUNCATE|\bUPDATE\b/i);
  });
});
