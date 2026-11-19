// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';
import { respuestaFinanzas, RUTA_DE } from './recorridosFinanzas619.datos';

/*
  Los recorridos guiados de Finanzas (CRM-ISEIE#619, segunda tanda; gemela de
  CRM#941). Diego, 19/11: cada pantalla de Finanzas con su «Ver recorrido», como
  Ventas. Esta tanda trae cuatro (Dashboard, Conversiones, Egresos y Cuentas
  por cobrar). Se comprueba, para las cuatro:

    · que cada recorrido presenta, cuenta sus pasos, acaba diciendo cómo repetirlo,
      con frases de cartel y permisos del catálogo;
    · que cada paso apunta a un `data-recorrido` que sigue en el código de su
      pantalla, y que la pantalla lo ofrece con «Ver recorrido»;
    · que la pantalla, con datos, PINTA cada sitio que se señala, y que el
      recorrido pasa por todos sus pasos con «Siguiente» y se cierra con Escape.

  (A 375 px, paso a paso, los prueba `recorridoEnMovil.test.jsx` junto a los demás.)
*/

const { permisos, api } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'superadmin', nombre: 'Claude QA' } }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }),
}));
vi.mock('@/shared/api/client', () => ({
  default: {
    get: (...a) => api.get(...a), post: (...a) => api.post(...a), put: (...a) => api.put(...a),
    patch: (...a) => api.patch(...a), delete: (...a) => api.delete(...a),
  },
}));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'Campus Demo' },
    activeIssuer: null, activeIssuerId: null,
    projects: [{ id: 1, nombre: 'Campus Demo' }], switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => async () => true }));

const { RECORRIDOS_FINANZAS } = await import('@/shared/lib/recorridosFinanzas');
const { RECORRIDOS_COBROS, pasosPara, claveRecorrido } = await import('@/shared/lib/recorridosCobros');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const PANTALLAS = {
  'finanzas-dashboard': () => import('@/modules/accounting/pages/AccountingDashboardPage'),
  conversiones: () => import('@/modules/revenue/pages/RevenuePage'),
  egresos: () => import('@/modules/expenses/pages/ExpensesPage'),
  'por-cobrar': () => import('@/modules/accounting/pages/ReceivablePage'),
};

const SRC = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const nombreDe = (donde) => /^\[data-recorrido="([a-z0-9-]+)"\]$/.exec(donde)?.[1];
const lista = (p) => (p == null ? [] : Array.isArray(p) ? p : [p]);
const RECORRIDOS = Object.values(RECORRIDOS_FINANZAS);
const TODO = () => true;

beforeAll(() => {
  // Las gráficas (recharts) miden su caja; jsdom no sabe.
  globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
});

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  for (const k of CLAVES) permisos.add(k);
  for (const m of Object.values(api)) m.mockReset();
  api.get.mockImplementation(async (url) => respuestaFinanzas(url) ?? { success: true, data: [] });
  document.body.innerHTML = '';
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('los recorridos de Finanzas', () => {
  it('son las cuatro pantallas de esta tanda, sin Facturación, Links de pago, Stripe, Disputas, Integraciones ni Conciliación', () => {
    expect(Object.keys(RECORRIDOS_FINANZAS).sort()).toEqual(['conversiones', 'egresos', 'finanzas-dashboard', 'por-cobrar']);
    expect(Object.keys(PANTALLAS).sort()).toEqual(Object.keys(RECORRIDOS_FINANZAS).sort());
  });

  it('se registran con los de cobros (así «Ver recorrido» los conoce), sin pisar ninguno', () => {
    for (const [id, r] of Object.entries(RECORRIDOS_FINANZAS)) expect(RECORRIDOS_COBROS[id]).toBe(r);
  });

  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: presenta, cuenta sus pasos y termina diciendo cómo repetirlo', (id, r) => {
    expect(r.id).toBe(id);
    expect(r.pasos.length).toBeGreaterThanOrEqual(4);
    expect(r.pasos[0].texto).toContain('{pasos}');
    expect(r.pasos[0].donde).toBeUndefined();
    expect(r.pasos.at(-1).texto).toMatch(/«Ver recorrido»/);
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

  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: cada anclaje sigue en el código de su pantalla, que lo ofrece con «Ver recorrido»', (id, r) => {
    const codigo = r.pantalla.map(leer).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    for (const p of r.pasos.filter((x) => x.donde)) {
      const n = nombreDe(p.donde);
      expect(n, `«${p.donde}» no es un data-recorrido`).toBeTruthy();
      expect(codigo, `falta data-recorrido="${n}" en ${r.pantalla.join(', ')}`).toMatch(new RegExp(`data-recorrido="${n}"`));
    }
  });
});

describe('cada pantalla, con datos', () => {
  it.each(RECORRIDOS.map((r) => [r.id, r]))('%s: pinta todo lo que se señala, y el recorrido pasa por todos sus pasos', async (id, r) => {
    // Ya visto: que no se abra solo a media prueba; se abre con el botón.
    localStorage.setItem(claveRecorrido(id, 7), '1');
    const { default: Pantalla } = await PANTALLAS[id]();
    const ruta = RUTA_DE[id];
    render(
      <MemoryRouter initialEntries={[ruta]}>
        <Routes><Route path={ruta} element={<Pantalla />} /></Routes>
      </MemoryRouter>,
    );
    // Lo que solo sale en la otra vista (el calendario, estando en la lista) se salta solo.
    const OTRA_VISTA = ['cobrar-calendario'];
    const sitios = r.pasos.filter((p) => p.donde).map((p) => nombreDe(p.donde)).filter((n) => !OTRA_VISTA.includes(n));
    await waitFor(() => {
      const faltan = sitios.filter((n) => !document.querySelector(`[data-recorrido="${n}"]`));
      expect(faltan, `no se pintan: ${faltan.join(', ')}`).toEqual([]);
    }, { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: `Ver recorrido: ${r.titulo}` }));
    const todos = pasosPara(r, TODO);
    const pasos = todos.filter((p) => !p.donde || document.querySelector(p.donde));
    const vistos = [];
    for (let i = 0; i < pasos.length; i++) {
      const titulo = document.getElementById('recorrido-titulo')?.textContent;
      vistos.push(titulo);
      // Dentro del cartel: la pantalla puede tener su propio «Siguiente» (la paginación).
      const cartel = document.querySelector('[role="dialog"][aria-labelledby="recorrido-titulo"]');
      const sig = within(cartel).queryByRole('button', { name: /Siguiente/ });
      if (!sig) break;
      fireEvent.click(sig);
    }
    expect(vistos).toEqual(pasos.map((p) => p.titulo));
    expect(screen.getByText(new RegExp(`de ${todos.length}$`))).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.getElementById('recorrido-titulo')).toBeNull();
  }, 120000); // la primera pantalla carga recharts, que tarda

  it('sin el permiso de la pantalla, ni botón', async () => {
    permisos.delete('expenses.view');
    const { default: ExpensesPage } = await PANTALLAS.egresos();
    render(<MemoryRouter initialEntries={['/expenses']}><Routes><Route path="/expenses" element={<ExpensesPage />} /></Routes></MemoryRouter>);
    // La pantalla carga igual (es el servidor quien la cierra); solo falta el botón.
    await waitFor(() => expect(document.querySelector('[data-recorrido="egresos-lista"]')).not.toBeNull(), { timeout: 4000 });
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  }, 15000);

});

describe('el cartel, a 375 px', () => {
  it('si crece después de abrirse (la letra llega tarde y el texto pasa a otra línea), se recoloca y no se sale', async () => {
    const { default: RecorridoGuiado } = await import('@/shared/components/ui/RecorridoGuiado');
    const { act } = await import('@testing-library/react');
    const antes = { ro: globalThis.ResizeObserver, vv: Object.getOwnPropertyDescriptor(window, 'visualViewport') };
    let avisar = () => {};
    globalThis.ResizeObserver = class { constructor(cb) { avisar = cb; } observe() {} unobserve() {} disconnect() {} };
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { width: 375, height: 667, offsetLeft: 0, offsetTop: 0, addEventListener: vi.fn(), removeEventListener: vi.fn() },
    });
    try {
      render(<RecorridoGuiado clave="crece" alCerrar={() => {}} pasos={[{ titulo: 'Primero', texto: 'Texto' }, { titulo: 'Y listo', texto: 'Fin' }]} />);
      const cartel = screen.getByRole('dialog');
      Object.defineProperty(cartel, 'offsetHeight', { configurable: true, value: 240 });
      act(() => avisar());
      // Pegado abajo con su alto de verdad: 667 − 16 − 240.
      expect(parseFloat(cartel.style.top)).toBe(667 - 16 - 240);
    } finally {
      globalThis.ResizeObserver = antes.ro;
      if (antes.vv) Object.defineProperty(window, 'visualViewport', antes.vv);
      else delete window.visualViewport;
    }
  });
});
