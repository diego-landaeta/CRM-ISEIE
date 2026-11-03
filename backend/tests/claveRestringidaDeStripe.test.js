import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

/**
 * Una clave RESTRINGIDA de Stripe tiene que valer (#44).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE DÓNDE SALE
 *
 * De los tres proyectos de IA no tenemos la clave secreta: está guardada como
 * secret en Supabase y de ahí no se puede sacar —la API devuelve el resumen,
 * no el valor—. La vía buena es crear en Stripe una clave RESTRINGIDA de solo
 * lectura y dársela al CRM, que además es mejor que la original: si se filtra,
 * no se puede cobrar con ella.
 *
 * Pero la prueba de conexión pedía `/v1/balance`, y una clave restringida
 * puede no llevar ese permiso: respondía 403, la pantalla decía «Stripe HTTP
 * 403» y la clave parecía inválida. O sea, el CRM cerraba justo el camino
 * recomendado.
 *
 * Ahora ante un 403 se pregunta por lo que el CRM de verdad necesita —los
 * cobros—, y si eso responde, la clave vale.
 */

const respuestas = new Map();
const fetchOriginal = globalThis.fetch;

globalThis.fetch = vi.fn(async (url) => {
  const clave = [...respuestas.keys()].find((k) => String(url).includes(k));
  const r = respuestas.get(clave);
  if (!r) throw new Error(`sin respuesta preparada para ${url}`);
  return { ok: r.status < 400, status: r.status, json: async () => r.body ?? {} };
});

afterAll(() => { globalThis.fetch = fetchOriginal; });

describe('la prueba de conexión de Stripe', () => {
  beforeEach(() => { respuestas.clear(); globalThis.fetch.mockClear(); });

  it('con permiso de saldo, dice el modo', async () => {
    respuestas.set('/v1/balance', { status: 200, body: { livemode: true } });
    const { testStripeParaPruebas } = await import('../src/modules/integrations/integrations.controller.js');
    const r = await testStripeParaPruebas('rk_live_x');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('LIVE');
  });

  it('SIN permiso de saldo pero con cobros, la clave vale', async () => {
    // Es el caso de una restringida de solo lectura, que es la que hay que
    // crear para los proyectos de IA.
    respuestas.set('/v1/balance', { status: 403 });
    respuestas.set('/v1/charges', { status: 200, body: { data: [{ livemode: true }] } });
    const { testStripeParaPruebas } = await import('../src/modules/integrations/integrations.controller.js');
    const r = await testStripeParaPruebas('rk_live_x');
    expect(r.ok).toBe(true);
    expect(r.limitada).toBe(true);
  });

  it('sin permiso para nada, dice qué darle', async () => {
    // Un «HTTP 403» a secas no le dice a nadie qué hacer.
    respuestas.set('/v1/balance', { status: 403 });
    respuestas.set('/v1/charges', { status: 403 });
    const { testStripeParaPruebas } = await import('../src/modules/integrations/integrations.controller.js');
    const r = await testStripeParaPruebas('rk_live_x');
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/Charges/);
  });

  it('una clave mala sigue siendo una clave mala', async () => {
    respuestas.set('/v1/balance', { status: 401 });
    const { testStripeParaPruebas } = await import('../src/modules/integrations/integrations.controller.js');
    const r = await testStripeParaPruebas('sk_live_malo');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
  });
});
