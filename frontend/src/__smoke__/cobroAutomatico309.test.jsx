// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
import { afterEach as despues } from 'vitest';
despues(() => limpiar());
import { render, screen, fireEvent, within } from '@testing-library/react';

/**
 * Cobro automático de las cuotas con Stripe (#680, 309; Diego, 19/11/2026).
 *
 *   · en «Generar plan de pago» se elige «Cobrar automáticamente con Stripe en las
 *     fechas de las cuotas»: el botón pasa a «Activar y generar el link de la
 *     cuota 1» y manda `cobroAutomatico: true`;
 *   · sin poder (campus apagado, sin clave…), se dice por qué y no hay casilla;
 *     sin el permiso, ni se ve;
 *   · activo: la tarjeta (marca y cuatro cifras) y, cuota a cuota, si Stripe la
 *     cobrará sola y cuándo, si falló (con su link y su reintento) o por qué no
 *     se puede programar.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put, delete: vi.fn() }, APP_BASE_URL: '', API_BASE_URL: '/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } } }) }));

const { default: PlanDePagoDialog } = await import('@/modules/links-pago/components/PlanDePagoDialog');
const { CobroAutomaticoDetalle, estadoDeCuota } = await import('@/modules/links-pago/components/CobroAutomaticoCuotas');

const VENTA = { id: 8, project_id: 1, lead_id: 3, lead_nombre: 'Ana', lead_email: 'ana@x.test', producto_contratado_id: 5,
  producto_nombre: 'Máster', importe_total: 900, cobrado: 0, pendiente: 900 };
const CUOTAS = [
  { id: 11, numero: 1, importe: 300, vence: '2026-11-19', concepto: null, link_id: null, link_estado: null, link_url: null, link_caduca_el: null },
  { id: 12, numero: 2, importe: 300, vence: '2026-12-25', concepto: null, link_id: null, link_estado: null, link_url: null, link_caduca_el: null },
  { id: 13, numero: 3, importe: 300, vence: '2027-01-25', concepto: null, link_id: null, link_estado: null, link_url: null, link_caduca_el: null },
];
const autoBase = (extra = {}) => ({
  disponible: true, motivo_no_disponible: null, reintento_dias: 3, activo: false, activado_el: null, tarjeta: null,
  stripe_schedule_id: null, sincronizado_el: null, sync_error: null, hora_de_cobro: 9, cuotas: [], ...extra,
});
const cuotaAuto = (extra) => ({
  installment_id: 12, numero: 2, vence: '2026-12-25', importe: 300, estado: null, fecha_programada: null, importe_programado: null,
  desfasada: false, intentos: 0, error_codigo: null, reintento_el: null, url_pago: null, historial: [], guarda_tarjeta: false, problema: null, ...extra,
});

let auto;
beforeEach(() => {
  get.mockReset(); post.mockReset(); put.mockReset();
  permisos.mapa = { 'links_pago.crear': true, 'links_pago.cobro_automatico': true };
  auto = autoBase();
  get.mockImplementation(async () => ({ success: true, data: { venta: VENTA, cuotas: CUOTAS, cobro_automatico: auto } }));
  post.mockImplementation(async () => ({ success: true, data: {
    venta: VENTA, creados: 1,
    cuotas: [{ ...CUOTAS[0], link_id: 50, link_estado: 'creado', link_url: 'https://buy.stripe.com/test_1', link_guarda_tarjeta: true }, CUOTAS[1], CUOTAS[2]],
    cobro_automatico: autoBase({ activo: true, cuotas: [cuotaAuto({ installment_id: 11, numero: 1, guarda_tarjeta: true }), cuotaAuto(), cuotaAuto({ installment_id: 13, numero: 3 })] }),
  } }));
});

describe('«Cobrar automáticamente con Stripe en las fechas de las cuotas»', () => {
  it('marcada, el botón activa y genera solo el link de la primera, y lo pide al servidor', async () => {
    render(<PlanDePagoDialog conversionId={8} onClose={() => {}} />);
    const casilla = await screen.findByRole('checkbox', { name: /Cobrar automáticamente con Stripe en las fechas de las cuotas/ });
    expect(screen.getByRole('button', { name: 'Generar los 3 links' })).toBeTruthy();
    fireEvent.click(casilla);
    const boton = screen.getByRole('button', { name: 'Activar y generar el link de la cuota 1' });
    expect(screen.getByText('link que guarda la tarjeta')).toBeTruthy();
    expect(screen.getAllByText('la cobra Stripe')).toHaveLength(2);
    fireEvent.click(boton);
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/links-pago/plan', { conversionId: 8, cobroAutomatico: true }));
    expect(await screen.findByText(/Cobro automático activado/)).toBeTruthy();
    // Ya activo: el detalle sale y la primera dice que guarda la tarjeta.
    expect(screen.getByText(/La paga el alumno con su link y, al pagarla, guarda la tarjeta/)).toBeTruthy();
  });

  it('sin poder activarlo en el campus: dice por qué y no hay casilla', async () => {
    auto = autoBase({ disponible: false, motivo_no_disponible: 'Este campus no tiene permitido el cobro automático.' });
    render(<PlanDePagoDialog conversionId={8} onClose={() => {}} />);
    expect(await screen.findByText(/Este campus no tiene permitido el cobro automático/)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('sin el permiso de cobro automático, ni la casilla ni el aviso', async () => {
    permisos.mapa = { 'links_pago.crear': true };
    render(<PlanDePagoDialog conversionId={8} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Generar los 3 links' })).toBeTruthy();
    expect(screen.queryByText(/Cobrar automáticamente/)).toBeNull();
  });
});

describe('lo que se ve de cada cuota', () => {
  const activo = (cuotas, extra = {}) => autoBase({
    activo: true, tarjeta: { marca: 'visa', ultimos4: '4242', caduca: '12/2030', guardada_el: '2026-11-19T10:00:00Z' }, cuotas, ...extra,
  });

  it('la tarjeta, la fecha en que Stripe la cobrará, un fallo con su reintento y una que no se puede programar', () => {
    const e = activo([
      cuotaAuto({ estado: 'programada', fecha_programada: '2026-12-25', importe_programado: 300 }),
      cuotaAuto({ installment_id: 13, numero: 3, estado: 'fallida', intentos: 1, error_codigo: 'insufficient_funds', reintento_el: '2026-12-28', url_pago: 'https://invoice.stripe.com/i/x' }),
      cuotaAuto({ installment_id: 14, numero: 4, problema: 'Su fecha es hoy o ya pasó: Stripe no programa cobros en el pasado. Cóbrala con su link o cambia la fecha.' }),
    ]);
    const quitar = vi.fn();
    render(<CobroAutomaticoDetalle estado={e} onQuitar={quitar} />);
    expect(screen.getByText('VISA ****4242 (caduca 12/2030)')).toBeTruthy();
    expect(screen.getByText(/Stripe la cobrará sola el 25\/12\/2026 hacia las 9:00 con VISA \*\*\*\*4242/)).toBeTruthy();
    expect(screen.getByText(/sin saldo suficiente.*Se reintenta una vez el 28\/12\/2026/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /link de pago/ }).getAttribute('href')).toBe('https://invoice.stripe.com/i/x');
    expect(screen.getByText(/No se cobrará sola: Su fecha es hoy o ya pasó/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Quitar el cobro automático' }));
    expect(quitar).toHaveBeenCalled();
  });

  it('si Stripe no tiene el plan al día, se dice claro', () => {
    render(<CobroAutomaticoDetalle estado={activo([], { sync_error: 'Stripe no ha aceptado el plan: red caída.' })} />);
    expect(within(screen.getByRole('alert')).getByText(/Stripe no tiene el plan al día: Stripe no ha aceptado el plan/)).toBeTruthy();
  });

  it('un cambio de fecha aún no pasado a Stripe sale como pendiente', () => {
    const e = activo([]);
    expect(estadoDeCuota(cuotaAuto({ estado: 'programada', fecha_programada: '2026-12-20', desfasada: true }), e).texto).toMatch(/pendiente de pasar a Stripe/);
    expect(estadoDeCuota(cuotaAuto({ estado: 'cobrada' }), e)).toMatchObject({ texto: 'Cobrada por Stripe.', tono: 'ok' });
  });
});
