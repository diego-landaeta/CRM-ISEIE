// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  CRM-ISEIE#611, tanda A (gemela de CRM#928; Diego, 19/11: «es un tutorial
  guiado de la app, como el del tablero»): «Ver recorrido» en las novedades del
  18/11. La misma prueba que en el 360, con lo que en ISEIE es distinto: la ficha
  de la venta en `/ventas/:id`, sin empresas y «Lo que toca» solo en /staging.

    · El menú por bloques (#587).
    · El Dashboard como «Hoy» (#590).
    · Ventas repetidas (#577): el aviso al registrar y «Posibles repetidas».
    · Las cuotas en la ficha de la venta (gemela de CRM#892).

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se
  recorre entera: cada paso encuentra su sitio y ninguno se salta. Que cada
  anclaje sigue en el código y que los permisos existen lo comprueba
  `recorridosCobros.test.jsx` (estos se suman a `RECORRIDOS_COBROS`); que el
  cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin', nombre: 'Marta' } },
}));

vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => api.get(...a), post: vi.fn(async () => ({ success: true })), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, logout: vi.fn() }) }));
vi.mock('@/contexts/ThemeContext', () => {
  const tema = { theme: 'light', toggleTheme: vi.fn() };
  return { useTheme: () => tema, useOptionalTheme: () => tema };
});
const CAMPUS = [{ id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3, modules: null }];
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: CAMPUS[0], projects: CAMPUS, isAllProjects: false,
    activeIssuer: null, activeIssuerId: null,
    switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/shared/hooks/useAmbito', () => ({
  useIdsDelAmbito: () => [1],
  useProyectosDelAmbito: () => CAMPUS,
}));
// En ISEIE «Lo que toca» solo sale con el proceso en pruebas (/staging, `PROCESO_EN_PRUEBAS`).
vi.mock('@/shared/lib/enPruebas', async (original) => ({ ...(await original()), PROCESO_EN_PRUEBAS: true }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }) }));
vi.mock('@/shared/lib/linksPago', () => ({ useLinksPagoEncendidos: () => false, linksPagoEncendidos: () => false }));
vi.mock('@/modules/whatsapp/api/whatsapp.api', () => ({
  whatsappApi: { plantillas: vi.fn(async () => ({ success: true, data: [] })) },
}));

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_NOVEDADES } = await import('@/shared/lib/recorridosNovedades');
const { default: DashboardPage } = await import('@/shared/pages/DashboardPage');
const { default: SalesPage } = await import('@/modules/sales/pages/SalesPage');
const { default: SaleDetailPage } = await import('@/modules/sales/pages/SaleDetailPage');
const { default: Sidebar } = await import('@/shared/components/layout/Sidebar');

const SRC = path.resolve(__dirname, '..');

const VENTA = {
  id: 10, lead_id: 5, project_id: null, lead_nombre: 'Ana Pérez', lead_email: 'ana@ejemplo.com',
  producto_contratado: 'Máster', proyecto_nombre: 'Campus Uno',
  importe_total: 900, importe_pagado: 1000, importe_pendiente: 0, cobrado_de_mas: 100,
  fecha_conversion: '2026-09-01', fecha_compromiso_pago: null, metodo_pago: 'transferencia', notas_pago: null,
  installments: [
    { id: 1, numero: 1, fecha_vencimiento: '2026-09-01', importe_previsto: 300, importe_cobrado: 300, fecha_cobro: '2026-09-01', factura_codigo: 'F-1' },
    { id: 2, numero: 2, fecha_vencimiento: '2026-10-01', importe_previsto: 300, importe_cobrado: 300, fecha_cobro: '2026-10-02', factura_codigo: 'F-2' },
    { id: 3, numero: 3, fecha_vencimiento: '2026-11-01', importe_previsto: 300, importe_cobrado: 300, fecha_cobro: '2026-11-02', factura_codigo: null },
  ],
  payments: [
    { id: 21, importe: 300, fecha: '2026-09-01', metodo: 'transferencia', cuota_numero: '1', factura_codigo: 'F-1' },
    { id: 22, importe: 700, fecha: '2026-10-02', metodo: 'tarjeta', cuota_numero: '2, 3', factura_codigo: 'F-2' },
  ],
};

const RESPUESTAS = {
  // «Hoy»
  '/leads/stats': { success: true, data: { total: 10, nuevos: 2, sin_asignar: 3 } },
  '/leads/today': { success: true, data: { nuevos_hoy: 1, nuevos_mes: 8, inactivos: 4, reminders_pendientes: [] } },
  '/leads': { success: true, data: [] },
  '/informes/mi-puesto': { success: true, data: { total: { cobrado: 1500, cobros: 3, ventas: 2, vendido: 3000 }, tabla: [] } },
  '/ventas/facturado': { success: true, data: { total: { facturado: 1200, ventas: 2 } } },
  '/proceso/cola/resumen': { success: true, data: { atrasados: 2, hoy: 3, manana: 1, esta_semana: 4 } },
  // La ficha de la venta
  '/conversions/10': { success: true, data: VENTA },
  '/conversions/10/reparto': { success: true, data: null },
  '/stripe-payments/de-la-venta/10': { success: true, data: { cargos: [], cobros: [] } },
  '/users': { success: true, data: [] },
};

const responder = async (url) => RESPUESTAS[String(url).split('?')[0]] ?? { success: true, data: null };

const PANTALLAS = {
  'menu-bloques': {
    // En jsdom no hay `matchMedia`: el menú que se ve es el del cajón (`onNavigate`).
    pintar: () => <MemoryRouter><Sidebar onNavigate={() => {}} /></MemoryRouter>,
    cargada: 'Buscar…',
    permisos: ['leads.view', 'ventas.view', 'products.view', 'accounting.view', 'integrations.view', 'proceso.view'],
  },
  'hoy-dashboard': {
    pintar: () => <MemoryRouter><DashboardPage /></MemoryRouter>,
    cargada: 'Lo que toca',
    permisos: ['proceso.view', 'leads.view'],
  },
  'ventas-repetidas': {
    pintar: () => <MemoryRouter><SalesPage /></MemoryRouter>,
    cargada: 'Posibles repetidas',
    permisos: ['ventas.registrar', 'conversions.edit'],
  },
  'venta-cuotas': {
    pintar: () => (
      <MemoryRouter initialEntries={['/ventas/10']}>
        <Routes><Route path="/ventas/:id" element={<SaleDetailPage />} /></Routes>
      </MemoryRouter>
    ),
    cargada: 'Plan de cuotas',
    permisos: ['conversions.view', 'conversions.cobros'],
  },
};
const IDS = Object.keys(PANTALLAS);
const titulos = (id, can = () => true) => pasosPara(RECORRIDOS_NOVEDADES[id], can).map((p) => p.titulo);

function recorrer(n) {
  const vistos = [];
  for (let i = 0; i < n + 2; i++) {
    const titulo = document.getElementById('recorrido-titulo');
    vistos.push(titulo.textContent);
    const sig = within(titulo.closest('[role="dialog"]')).queryByRole('button', { name: /Siguiente/ });
    if (!sig) break;
    fireEvent.click(sig);
  }
  return vistos;
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  yo.current = { id: 41, role: 'admin', nombre: 'Marta' };
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('los recorridos de las novedades (#611, tanda A)', () => {
  it('son los cuatro de la issue, en su orden, y están registrados con los demás', () => {
    expect(Object.keys(RECORRIDOS_NOVEDADES)).toEqual(['menu-bloques', 'hoy-dashboard', 'ventas-repetidas', 'venta-cuotas']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_NOVEDADES[id]);
  });

  it.each(IDS)('%s: de 5 a 8 pasos, casi todos señalando algo, y su pantalla lo ofrece', (id) => {
    const r = RECORRIDOS_NOVEDADES[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    expect(r.pasos.filter((p) => p.donde).length).toBeGreaterThanOrEqual(r.pasos.length - 2);
    const codigo = fs.readFileSync(path.join(SRC, r.pantalla[0]), 'utf8');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
  });

  it('el permiso de cada uno es el de su pantalla: el menú y «Hoy», ninguno', () => {
    expect(RECORRIDOS_NOVEDADES['menu-bloques'].permiso).toBeUndefined();
    expect(RECORRIDOS_NOVEDADES['hoy-dashboard'].permiso).toBeUndefined();
    expect(RECORRIDOS_NOVEDADES['ventas-repetidas'].permiso).toEqual(['ventas.registrar', 'conversions.edit']);
    expect(RECORRIDOS_NOVEDADES['venta-cuotas'].permiso).toBe('conversions.view');
  });

  it('las pantallas con barra fija arriba dejan margen de scroll a lo señalado', () => {
    for (const f of ['shared/pages/DashboardPage.jsx', 'modules/sales/pages/SalesPage.tsx', 'modules/sales/pages/SaleDetailPage.tsx']) {
      expect(fs.readFileSync(path.join(SRC, f), 'utf8'), f).toContain('[&_[data-recorrido]]:scroll-mt-40');
    }
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  const { pintar, cargada } = PANTALLAS[id];

  it('la primera vez sale solo, cuando la pantalla ha cargado, y se recorre sin saltarse nada', async () => {
    for (const p of PANTALLAS[id].permisos) permisos.add(p);
    render(pintar());
    await screen.findAllByText(cargada, {}, { timeout: 5000 });
    const esperados = titulos(id, (k) => permisos.has(k));
    await screen.findByRole('dialog', { name: esperados[0] }, { timeout: 3000 });
    await waitFor(() => expect(localStorage.getItem(claveRecorrido(id, 41))).toBe('1'));
    expect(recorrer(esperados.length)).toEqual(esperados);
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('ya visto, no vuelve a salir solo; «Ver recorrido» lo repite, «Atrás» vuelve y Escape lo cierra', async () => {
    for (const p of PANTALLAS[id].permisos) permisos.add(p);
    localStorage.setItem(claveRecorrido(id, 41), '1');
    render(pintar());
    await screen.findAllByText(cargada, {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1000));
    const [primero, segundo] = titulos(id, (k) => permisos.has(k));
    expect(screen.queryByRole('dialog', { name: primero })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `Ver recorrido: ${RECORRIDOS_NOVEDADES[id].titulo}` }));
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    expect(screen.getByRole('dialog', { name: segundo })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(screen.getByRole('dialog', { name: primero })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: primero })).toBeNull();
  });
});

describe('quién ve qué', () => {
  it('ventas repetidas: sin «conversions.edit» no sale «Posibles repetidas», ni su paso', async () => {
    permisos.add('ventas.registrar');
    render(PANTALLAS['ventas-repetidas'].pintar());
    const esperados = titulos('ventas-repetidas', (k) => permisos.has(k));
    expect(esperados).not.toContain('Posibles repetidas');
    await screen.findByRole('dialog', { name: esperados[0] }, { timeout: 3000 });
    expect(screen.queryByText('Posibles repetidas')).toBeNull();
    expect(recorrer(esperados.length)).toEqual(esperados);
  });

  it('ventas repetidas: sin registrar ni editar ventas, ni botón ni recorrido', async () => {
    permisos.add('conversions.view');
    render(PANTALLAS['ventas-repetidas'].pintar());
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('la ficha de la venta: sin «conversions.cobros» no se explica «Cuota ya pagada»', () => {
    expect(titulos('venta-cuotas', (k) => k === 'conversions.view')).not.toContain('Cuota ya pagada');
  });

  it('la ficha de la venta: sin cobro de más, ese paso se salta', async () => {
    permisos.add('conversions.view');
    RESPUESTAS['/conversions/10'] = { success: true, data: { ...VENTA, importe_pagado: 900, cobrado_de_mas: 0 } };
    try {
      render(PANTALLAS['venta-cuotas'].pintar());
      await screen.findAllByText('Plan de cuotas', {}, { timeout: 5000 });
      const esperados = titulos('venta-cuotas', (k) => permisos.has(k)).filter((t) => t !== 'Cobrado de más');
      await screen.findByRole('dialog', { name: esperados[0] }, { timeout: 3000 });
      expect(recorrer(esperados.length)).toEqual(esperados);
    } finally {
      RESPUESTAS['/conversions/10'] = { success: true, data: VENTA };
    }
  });

  it('el menú: un bloque que esa persona no tiene no se pinta y su paso se salta', async () => {
    // Una gestora sin Finanzas. (Configuración sí la tiene: en ISEIE «Status» no
    // pide permiso y está en ese bloque; en el 360 pide `status.view`.)
    yo.current = { id: 41, role: 'gestor', nombre: 'Marta' };
    for (const p of ['leads.view', 'ventas.view', 'proceso.view']) permisos.add(p);
    render(PANTALLAS['menu-bloques'].pintar());
    await screen.findAllByText('Buscar…', {}, { timeout: 5000 });
    await screen.findByRole('dialog', { name: 'El menú, por bloques' }, { timeout: 3000 });
    const vistos = recorrer(8);
    expect(document.querySelector('[data-recorrido="menu-finanzas"]')).toBeNull();
    expect(vistos).not.toContain('Finanzas');
    expect(vistos).toContain('El bloque Hoy');
    expect(vistos.at(-1)).toBe('Y listo');
  });

  it('el cajón del móvil cerrado (en ISEIE sigue montado) no ofrece ni abre el recorrido', async () => {
    permisos.add('leads.view');
    render(<MemoryRouter><Sidebar onNavigate={() => {}} visible={false} /></MemoryRouter>);
    await screen.findAllByText('Buscar…', {}, { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
    // Ni sus anclajes: con los dos menús montados, el recorrido del PC cogía
    // los del cajón cerrado (ocultos) y no señalaba nada.
    expect(document.querySelector('[data-recorrido^="menu-"]')).toBeNull();
  });

  it('el menú plegado (solo iconos) no ofrece el recorrido', async () => {
    permisos.add('leads.view');
    render(<MemoryRouter><Sidebar collapsed /></MemoryRouter>);
    await new Promise((r) => setTimeout(r, 1000));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });
});
