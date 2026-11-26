// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup as limpiar } from '@testing-library/react';
import { afterEach as despues } from 'vitest';
despues(() => limpiar());

/**
 * CRM-ISEIE#759 (gemela de CRM#1103) · Cobro automático cancelado en Stripe.
 *
 *   · cuota a cuota: «Cobro automático cancelado en Stripe el …: motivo. Sigue
 *     pendiente: mándale un link de pago»;
 *   · la tarjeta del cobro automático dice «Cancelado en Stripe», cuándo y por qué;
 *   · «Mandar link de pago» de esa cuota: pide al servidor el link de ESA cuota
 *     (cuotaIds) y lo deja listo para copiar o mandar; sin permiso, ni se ve.
 */

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ default: { get, post, put: vi.fn(), delete: vi.fn() }, APP_BASE_URL: '', API_BASE_URL: '/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
const permisos = vi.hoisted(() => ({ mapa: {} }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 2, funciones: { links_pago: true } } }) }));

const { CobroAutomaticoDetalle, estadoDeCuota } = await import('@/modules/links-pago/components/CobroAutomaticoCuotas');
const { default: LinkDeCuotaCancelada } = await import('@/modules/links-pago/components/LinkDeCuotaCancelada');

const auto = (extra = {}) => ({
  disponible: true, motivo_no_disponible: null, reintento_dias: 3, activo: false, activado_el: null,
  tarjeta: { marca: 'visa', ultimos4: '4242', caduca: '12/2030', guardada_el: null },
  stripe_schedule_id: null, sincronizado_el: null, sync_error: null, hora_de_cobro: 9, cuotas: [], ...extra,
});
const cuota = (extra) => ({
  installment_id: 12, numero: 2, vence: '2026-12-25', importe: 300, estado: null, fecha_programada: null, importe_programado: null,
  desfasada: false, intentos: 0, error_codigo: null, reintento_el: null, url_pago: null, historial: [], guarda_tarjeta: false, problema: null, ...extra,
});

beforeEach(() => {
  get.mockReset(); post.mockReset();
  permisos.mapa = { 'links_pago.crear': true };
});

describe('cuota a cuota', () => {
  it('cancelada en Stripe: con su fecha y su motivo, y que sigue pendiente', () => {
    const s = estadoDeCuota(cuota({ estado: 'cancelada', cancelada_el: '2026-11-24T10:00:00Z', cancelada_motivo: 'La suscripción se canceló en Stripe. Lo hizo: el alumno.' }), auto());
    expect(s.tono).toBe('bad');
    expect(s.texto).toMatch(/Cobro automático cancelado en Stripe el 24\/11\/2026/);
    expect(s.texto).toMatch(/Lo hizo: el alumno/);
    expect(s.texto).toMatch(/Sigue pendiente: mándale un link de pago/);
  });

  it('la tarjeta del cobro automático dice «Cancelado en Stripe», cuándo y por qué', () => {
    render(<CobroAutomaticoDetalle estado={auto({
      cancelado_en_stripe: { el: '2026-11-24T10:00:00Z', motivo: 'Stripe canceló la suscripción porque no pudo cobrar.' },
      cuotas: [cuota({ estado: 'cancelada', cancelada_el: '2026-11-24T10:00:00Z' })],
    })} />);
    expect(screen.getByText('Cancelado en Stripe')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/dejó de cobrar las cuotas el 24\/11\/2026: Stripe canceló la suscripción/);
    expect(screen.queryByText('Quitado')).toBeNull();
  });
});

describe('«Mandar link de pago» de la cuota', () => {
  it('pide el link de ESA cuota y lo deja listo para copiar', async () => {
    post.mockResolvedValue({ success: true, data: {
      venta: { id: 8 }, creados: 1,
      cuotas: [{ id: 12, numero: 2, importe: 300, vence: '2026-12-25', concepto: null, link_id: 70, link_estado: 'creado', link_url: 'https://buy.stripe.com/test_70', link_caduca_el: null }],
    } });
    get.mockResolvedValue({ success: true, data: [{
      id: 70, project_id: 1, lead_id: 3, conversion_id: 8, product_id: 5, product_nombre: 'Máster', created_by: 2, creado_por_nombre: 'G',
      precio_catalogo: 300, importe: 300, descuento_pct: 0, moneda: 'EUR', modalidad: 'unico', estado: 'creado',
      url: 'https://buy.stripe.com/test_70', caduca_el: null, pagado_el: null, anulado_por_nombre: null, anulado_el: null, motivo_anulacion: null,
    }] });
    const escucha = vi.fn();
    window.addEventListener('links-pago:creado', escucha);
    render(<LinkDeCuotaCancelada conversionId={8} cuotaId={12} nombre="Ana" />);
    fireEvent.click(screen.getByRole('button', { name: /Mandar link de pago/ }));
    await waitFor(() => expect(screen.getByText(/Link de la cuota/)).toBeTruthy());
    expect(post).toHaveBeenCalledWith('/links-pago/plan', { conversionId: 8, cuotaIds: [12] });
    expect(screen.getByRole('button', { name: /Copiar mensaje/ })).toBeTruthy();
    expect(escucha).toHaveBeenCalled();
    window.removeEventListener('links-pago:creado', escucha);
  });

  it('si el servidor no deja (p. ej., Stripe ya la cobró), lo dice y no hay link', async () => {
    post.mockRejectedValue({ data: { error: 'Stripe ya ha cobrado esta cuota con su factura: el cobro entrará solo en la venta. No se crea otro link.' } });
    render(<LinkDeCuotaCancelada conversionId={8} cuotaId={12} />);
    fireEvent.click(screen.getByRole('button', { name: /Mandar link de pago/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/ya ha cobrado/));
    expect(screen.queryByText(/Link de la cuota/)).toBeNull();
  });

  it('sin el permiso de crear links, no se ve', () => {
    permisos.mapa = {};
    const { container } = render(<LinkDeCuotaCancelada conversionId={8} cuotaId={12} />);
    expect(container.textContent).toBe('');
  });
});
