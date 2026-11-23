// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

/*
  Los recorridos guiados de Stripe y de los cobros (Diego, 18/11: «deben haber
  tutorial guiado como en el tablero de tareas»). Se comprueba:

    · que cada recorrido tiene sus pasos, con permisos del catálogo, y que alguna
      pantalla lo ofrece;
    · que cada paso apunta a un `data-recorrido` que sigue en el código de su
      pantalla, y que las tarjetas lo pintan de verdad;
    · que NUNCA sale solo (CRM#1012): solo con «Ver recorrido» o con «Recorrido»
      en la cabecera; que se cierra si se abre otra ventana encima (salvo la que
      explica) y que un paso sin permiso no sale.
*/

const { permisos, yo, api } = vi.hoisted(() => ({
  permisos: new Set(),
  yo: { current: { id: 7, role: 'admin' } },
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }),
}));
vi.mock('@/shared/api/client', () => ({ APP_BASE_URL: '', default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a) } }));
vi.mock('@/shared/lib/linksPago', () => ({ useLinksPagoEncendidos: () => true }));
vi.mock('@/modules/links-pago/api/linksPago.api', () => ({
  listarLinks: vi.fn(async () => ({ success: true, data: [] })),
  crearLink: vi.fn(),
  anularLink: vi.fn(),
  verConfig: vi.fn(async () => ({ success: true, data: null })),
}));

const { RECORRIDOS_COBROS, pasosPara, claveRecorrido } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_FINANZAS } = await import('@/shared/lib/recorridosFinanzas');
// Los de las novedades del 18/11 (#611): se cuentan en recorridosNovedades611.
const { RECORRIDOS_NOVEDADES } = await import('@/shared/lib/recorridosNovedades');
const { RECORRIDOS_NOVEDADES_B } = await import('@/shared/lib/recorridosNovedadesB');
// Los del día a día de una gestora (#619, tanda C): se cuentan en recorridosGestora619.
const { RECORRIDOS_GESTORA } = await import('@/shared/lib/recorridosGestora');
const { default: VerRecorrido } = await import('@/shared/components/ui/VerRecorrido');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const SRC = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const nombreDe = (donde) => /^\[data-recorrido="([a-z0-9-]+)"\]$/.exec(donde)?.[1];
const lista = (p) => (p == null ? [] : Array.isArray(p) ? p : [p]);
const RECORRIDOS = Object.values(RECORRIDOS_COBROS);

/** Todo el código de src, para ver qué pantalla ofrece cada recorrido. */
function todoElCodigo(dir = SRC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__smoke__') todoElCodigo(p, acc); }
    else if (/\.(tsx|jsx)$/.test(e.name)) acc.push(fs.readFileSync(p, 'utf8'));
  }
  return acc.join('\n');
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  yo.current = { id: 7, role: 'admin' };
  api.get.mockReset();
  api.post.mockReset();
  document.body.innerHTML = '';
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('cada recorrido tiene sus pasos', () => {
  it('están los cinco del encargo, Links de pago (19/11), Ventas (#619), Cursos de Moodle (CRM#957) y los de links y cuotas (#681)', () => {
    // Los del bloque Finanzas (#619), los de las novedades (#611) y los de la gestora se cuentan en su propia prueba.
    expect(Object.keys(RECORRIDOS_COBROS)).toEqual(expect.arrayContaining([
      'anular-factura', 'cargos-sin-enlazar', 'cursos-producto', 'disputas-stripe', 'integraciones-stripe', 'link-de-pago', 'links-pago', 'pagos-stripe', 'ventas',
      'links-asistente', 'plan-de-pago', 'cobro-automatico', 'cola-facturacion',
    ]));
    expect(Object.keys(RECORRIDOS_COBROS).filter((k) => !(k in RECORRIDOS_FINANZAS) && !(k in RECORRIDOS_NOVEDADES))
      .filter((k) => !(k in RECORRIDOS_NOVEDADES_B) && !(k in RECORRIDOS_GESTORA)).length).toBeGreaterThan(9);
  });

  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: presenta, cuenta sus pasos y termina diciendo cómo repetirlo', (id, r) => {
    expect(r.id).toBe(id);
    expect(r.pasos.length).toBeGreaterThanOrEqual(4);
    expect(r.pasos[0].texto).toContain('{pasos}');
    expect(r.pasos.at(-1).texto).toMatch(/«Recorrido»/);
    for (const p of r.pasos) {
      expect(p.titulo.length).toBeGreaterThan(3);
      // Frases cortas, de las que se leen en un cartel.
      expect(p.texto.length).toBeLessThan(330);
      expect(p.texto).not.toMatch(/endpoint|payload|API key|token de acceso/i);
    }
  });

  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: sus permisos existen en el catálogo', (_id, r) => {
    for (const k of [...lista(r.permiso), ...r.pasos.flatMap((p) => lista(p.permiso))]) {
      expect(CLAVES.has(k), `${k} no está en el catálogo`).toBe(true);
    }
  });

  let codigo = '';
  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: se ofrece en la cabecera (por su ruta) o con «Ver recorrido»', (id, r) => {
    if (r.rutas.length > 0) return;
    codigo ||= todoElCodigo();
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
  });
});

describe('cada paso apunta a algo que está en su pantalla', () => {
  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: cada anclaje sigue en el código de su pantalla', (_id, r) => {
    const codigo = r.pantalla.map(leer).join('\n');
    for (const p of r.pasos.filter((x) => x.donde)) {
      const n = nombreDe(p.donde);
      expect(n, `«${p.donde}» no es un data-recorrido`).toBeTruthy();
      expect(codigo, `falta data-recorrido="${n}" en ${r.pantalla.join(', ')}`)
        .toMatch(new RegExp(`data-recorrido=(?:"${n}"|\\{[^}]*'${n}')`));
    }
  });

  it('la tarjeta de cargos sin enlazar pinta sus tres anclajes', async () => {
    permisos.add('stripe.edit');
    api.get.mockResolvedValue({ success: true, data: {
      cargos: [{ id: 1, stripe_id: 'ch_1', importe: 100, fecha: '2026-11-10' }],
      cobros: [{ id: 9, importe: 100, fecha: '2026-11-09', metodo: 'tarjeta', factura_id: 3, factura_codigo: 'F-1', cuota_numero: '1' }],
    } });
    const { default: EnlazarStripeCard } = await import('@/modules/sales/components/EnlazarStripeCard');
    render(<EnlazarStripeCard conversionId={5} />);
    await screen.findByText(/Cargos de Stripe sin enlazar/);
    for (const n of ['cargos-sin-enlazar', 'cargo-cobro', 'cargo-enlazar']) {
      expect(document.querySelector(`[data-recorrido="${n}"]`), n).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Ver recorrido: Cargos de Stripe sin enlazar' })).toBeInTheDocument();
  });

  it('la tarjeta de links de pago pinta los suyos (y sin «crear», no el botón)', async () => {
    permisos.add('links_pago.crear');
    const { default: LinksDePagoCard } = await import('@/modules/links-pago/components/LinksDePagoCard');
    const { unmount } = render(<LinksDePagoCard projectId={1} conversionId={5} pendiente={300} conRecorrido />);
    await screen.findByText(/Todavía no se le ha mandado/);
    for (const n of ['links-pago', 'links-crear', 'links-lista']) {
      expect(document.querySelector(`[data-recorrido="${n}"]`), n).not.toBeNull();
    }
    unmount();
    permisos.clear();
    permisos.add('links_pago.ver_todos');
    render(<LinksDePagoCard projectId={1} conversionId={5} pendiente={300} conRecorrido />);
    await screen.findByText(/Todavía no se le ha mandado/);
    expect(document.querySelector('[data-recorrido="links-crear"]')).toBeNull();
    // …y su recorrido no trae los pasos de crear.
    const pasos = pasosPara(RECORRIDOS_COBROS['link-de-pago'], (k) => permisos.has(k));
    expect(pasos.some((p) => p.donde === '[data-recorrido="links-crear"]')).toBe(false);
  });
});

describe('no sale un paso sin permiso', () => {
  const titulos = (id, can) => pasosPara(RECORRIDOS_COBROS[id], can).map((p) => p.titulo);

  it('Integraciones: sin «configurar links» no salen ni las reglas ni el interruptor', () => {
    const solo = titulos('integraciones-stripe', (k) => k === 'integrations.view');
    expect(solo).not.toContain('Las reglas del campus');
    expect(solo).not.toContain('El interruptor del campus');
    expect(solo).not.toContain('La clave de los links de pago');
    const admin = titulos('integraciones-stripe', (k) => ['integrations.view', 'integrations.edit', 'links_pago.configurar'].includes(k));
    expect(admin).toEqual(expect.arrayContaining(['La clave de los links de pago', 'Las reglas del campus', 'El interruptor del campus']));
  });

  it('Pagos Stripe: sin «asociar pagos» no se explica «Asociar»', () => {
    expect(titulos('pagos-stripe', (k) => k === 'stripe.view')).not.toContain('Asociar un pago');
    expect(titulos('pagos-stripe', (k) => ['stripe.view', 'stripe.edit'].includes(k))).toContain('Asociar un pago');
  });

  it('el recorrido abierto no enseña el paso sin permiso y cuenta solo los suyos', () => {
    vi.useFakeTimers();
    permisos.add('integrations.view');
    for (const n of ['stripe-clave', 'stripe-webhook', 'links-clave', 'links-reglas', 'links-webhook']) {
      const d = document.createElement('div'); d.setAttribute('data-recorrido', n); document.body.appendChild(d);
    }
    render(<VerRecorrido id="integraciones-stripe" listo={false} />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByRole('button', { name: /Ver recorrido/ }));
    const total = pasosPara(RECORRIDOS_COBROS['integraciones-stripe'], (k) => permisos.has(k)).length;
    const vistos = [];
    for (let i = 0; i < 12; i++) {
      const dialogo = screen.queryByRole('dialog');
      if (!dialogo) break;
      vistos.push(document.getElementById('recorrido-titulo').textContent);
      expect(screen.getByText(new RegExp(`de ${total}$`))).toBeInTheDocument();
      const sig = screen.queryByRole('button', { name: /Siguiente/ });
      if (!sig) break;
      fireEvent.click(sig);
      act(() => { vi.advanceTimersByTime(10); });
    }
    expect(vistos).toContain('La clave de cada campus');
    expect(vistos).not.toContain('Las reglas del campus');
    expect(vistos).not.toContain('El interruptor del campus');
  });
});

describe('cuándo sale: NUNCA solo (CRM#1012)', () => {
  it('sin el permiso del recorrido, ni botón ni recorrido', () => {
    vi.useFakeTimers();
    render(<VerRecorrido id="disputas-stripe" />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ni la primera vez ni con la pantalla lista: solo al pulsar «Ver recorrido»', () => {
    vi.useFakeTimers();
    permisos.add('stripe.edit');
    const { rerender } = render(<VerRecorrido id="disputas-stripe" listo={false} />);
    act(() => { vi.advanceTimersByTime(3000); });
    rerender(<VerRecorrido id="disputas-stripe" listo />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(localStorage.getItem(claveRecorrido('disputas-stripe', 7))).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ver recorrido/ }));
    expect(screen.getByRole('dialog', { name: 'Qué es una disputa' })).toBeInTheDocument();
  });

  it('dos en la misma pantalla: ninguno se abre solo', () => {
    vi.useFakeTimers();
    permisos.add('stripe.edit');
    permisos.add('links_pago.crear');
    render(<><VerRecorrido id="link-de-pago" /><VerRecorrido id="cargos-sin-enlazar" /></>);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
  });

  it('si se abre otra ventana con el recorrido puesto, se cierra', () => {
    vi.useFakeTimers();
    permisos.add('stripe.edit');
    render(<VerRecorrido id="disputas-stripe" />, { container: document.body.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByRole('button', { name: /Ver recorrido/ }));
    expect(screen.getByRole('dialog', { name: 'Qué es una disputa' })).toBeInTheDocument();
    const otra = document.createElement('div');
    otra.setAttribute('role', 'dialog');
    otra.setAttribute('aria-label', 'Crear link de pago');
    document.body.appendChild(otra);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByRole('dialog', { name: 'Qué es una disputa' })).toBeNull();
  });

  it('dentro de la ventana que explica (el asistente), esa ventana no lo cierra', () => {
    vi.useFakeTimers();
    permisos.add('links_pago.crear');
    const ventana = document.createElement('div');
    ventana.setAttribute('role', 'dialog');
    ventana.setAttribute('data-recorrido', 'links-asistente');
    document.body.appendChild(ventana);
    render(<VerRecorrido id="links-asistente" dentroDe='[data-recorrido="links-asistente"]' />, { container: ventana.appendChild(document.createElement('div')) });
    fireEvent.click(screen.getByRole('button', { name: /Ver recorrido/ }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('dialog', { name: 'Crear un link de pago' })).toBeInTheDocument();
  });
});
