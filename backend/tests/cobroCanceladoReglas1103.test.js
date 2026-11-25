import { describe, it, expect } from 'vitest';

/**
 * CRM#1103 · Cobro automático cancelado en Stripe: lo puro (sin base).
 *   · qué avisos de Stripe son una cancelación y cuáles no;
 *   · el motivo, quién y cuándo, como lo cuenta Stripe.
 *
 *   npx vitest run tests/cobroCanceladoReglas1103.test.js
 */
process.env.LOG_LEVEL = 'silent';
const C = await import('../src/modules/stripe-payments/cobro-cancelado.service.js');
const { EVENTOS_DE_LOS_LINKS } = await import('../src/modules/links-pago/links-pago.service.js');

const ev = (type, object, extra = {}) => ({ id: 'evt_1', type, created: 1764000000, data: { object, ...extra } });

describe('qué es una cancelación', () => {
  it('suscripción borrada, calendario cancelado o abortado, factura anulada o incobrable', () => {
    expect(C.queEs(ev('customer.subscription.deleted', { status: 'canceled' }))).toEqual({ clase: 'suscripcion' });
    expect(C.queEs(ev('subscription_schedule.canceled', {}))).toEqual({ clase: 'calendario' });
    expect(C.queEs(ev('subscription_schedule.aborted', {}))).toEqual({ clase: 'calendario' });
    expect(C.queEs(ev('invoice.voided', {}))).toEqual({ clase: 'factura' });
    expect(C.queEs(ev('invoice.marked_uncollectible', {}))).toEqual({ clase: 'factura' });
  });

  it('una suscripción que cambia sin tocar su estado (renovación, tarjeta) no es nada', () => {
    expect(C.queEs(ev('customer.subscription.updated', { status: 'active' }, { previous_attributes: { current_period_end: 1 } }))).toBeNull();
    expect(C.queEs(ev('customer.subscription.updated', { status: 'active' }))).toBeNull();
    expect(C.queEs(ev('customer.subscription.updated', { status: 'past_due' }, { previous_attributes: { status: 'active' } }))).toBeNull();
  });

  it('pasa a impagada o caducada: Stripe la da por perdida; y de ahí a activa, vuelve a cobrarse', () => {
    expect(C.queEs(ev('customer.subscription.updated', { status: 'unpaid' }, { previous_attributes: { status: 'past_due' } })))
      .toEqual({ clase: 'suscripcion' });
    expect(C.queEs(ev('customer.subscription.updated', { status: 'incomplete_expired' }, { previous_attributes: { status: 'incomplete' } })))
      .toEqual({ clase: 'suscripcion' });
    expect(C.queEs(ev('customer.subscription.updated', { status: 'active' }, { previous_attributes: { status: 'unpaid' } })))
      .toEqual({ clase: 'reactivada' });
  });

  it('lo demás no', () => {
    expect(C.queEs(ev('invoice.paid', {}))).toBeNull();
    expect(C.queEs(ev('charge.succeeded', {}))).toBeNull();
  });

  it('el webhook de cada cuenta pide todos estos eventos', () => {
    for (const e of C.EVENTOS_DE_CANCELACION) expect(EVENTOS_DE_LOS_LINKS).toContain(e);
  });
});

describe('el motivo, quién y cuándo', () => {
  it('lo cancela el alumno desde el portal: su razón, en castellano, y la fecha de Stripe', () => {
    const m = C.motivoDe(ev('customer.subscription.deleted', {
      status: 'canceled', canceled_at: 1763900000,
      cancellation_details: { reason: 'cancellation_requested', feedback: 'too_expensive', comment: 'No puedo pagarlo' },
    }));
    expect(m.motivo).toMatch(/se canceló en Stripe/);
    expect(m.motivo).toMatch(/demasiado caro: No puedo pagarlo/);
    expect(m.quien).toBe('el alumno');
    expect(m.cuando).toBe(new Date(1763900000 * 1000).toISOString());
    expect(m.detalle).toMatchObject({ razon: 'cancellation_requested', opinion: 'too_expensive', evento: 'evt_1' });
  });

  it('Stripe la cancela porque no pudo cobrar: automático', () => {
    const m = C.motivoDe(ev('customer.subscription.deleted', { status: 'canceled', cancellation_details: { reason: 'payment_failed' } }));
    expect(m.motivo).toMatch(/no pudo cobrar/);
    expect(m.quien).toBe('Stripe, automáticamente');
    // Sin canceled_at, la fecha del aviso.
    expect(m.cuando).toBe(new Date(1764000000 * 1000).toISOString());
  });

  it('desde el panel o la API (hay petición): se dice', () => {
    const m = C.motivoDe({ ...ev('customer.subscription.deleted', { status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } }), request: { id: 'req_1' } });
    expect(m.quien).toMatch(/panel o la API/);
    expect(m.detalle.peticion).toBe('req_1');
  });

  it('impagada, calendario abortado y factura incobrable', () => {
    expect(C.motivoDe(ev('customer.subscription.updated', { status: 'unpaid' })).motivo).toMatch(/impagada/);
    expect(C.motivoDe(ev('subscription_schedule.aborted', {})).motivo).toMatch(/por impago/);
    const f = C.motivoDe(ev('invoice.marked_uncollectible', { status_transitions: { marked_uncollectible_at: 1763950000 } }));
    expect(f.motivo).toMatch(/incobrable/);
    expect(f.cuando).toBe(new Date(1763950000 * 1000).toISOString());
  });
});
