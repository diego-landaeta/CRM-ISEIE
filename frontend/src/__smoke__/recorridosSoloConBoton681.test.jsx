// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  CRM-ISEIE#681 (gemela de CRM#1012; Diego, 23/11): «QUE SOLO SE ACTIVE AL TOCAR
  EL BOTÓN ARRIBA DE RECORRIDO, NO SIEMPRE COMO PASA EN ALGUNAS PÁGINAS».

    · Ningún recorrido se abre solo: ni en el código (nadie pregunta ya «¿lo ha
      visto?» para abrirlo) ni al pintar cada «Ver recorrido» con todo permitido.
    · El botón «Recorrido» de arriba abre el de la pantalla (según la ruta)
      y el general; con teclado, también.
    · El general solo enseña los bloques del menú que esa persona ve.
    · El registro ruta → recorrido: cada ruta apunta a una pantalla que existe.
*/

const { permisos, yo, proyecto } = vi.hoisted(() => ({
  permisos: new Set(),
  yo: { current: { id: 41, role: 'admin', nombre: 'Marta Ruiz' } },
  proyecto: { current: { id: 1, nombre: 'Campus Uno', modules: null } },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, logout: vi.fn() }) }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: proyecto.current, projects: [proyecto.current], isAllProjects: false,
    activeIssuer: null, activeIssuerId: null, switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));
vi.mock('@/contexts/ThemeContext', () => {
  const tema = { theme: 'light', toggleTheme: vi.fn() };
  return { useTheme: () => tema, useOptionalTheme: () => tema };
});
vi.mock('@/shared/hooks/useAmbito', () => ({ useIdsDelAmbito: () => [1], useProyectosDelAmbito: () => [] }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }) }));
vi.mock('@/shared/api/client', () => ({
  default: { get: vi.fn(async () => ({ success: true, data: [] })), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

const { RECORRIDOS_COBROS } = await import('@/shared/lib/recorridosCobros');
const { recorridosDeLaRuta, tablaDeRutas } = await import('@/shared/lib/recorridosPorRuta');
const { _reiniciarLanzador } = await import('@/shared/lib/lanzadorRecorridos');
const { default: VerRecorrido } = await import('@/shared/components/ui/VerRecorrido');
const { default: BotonRecorrido, bloquesQueVe } = await import('@/shared/components/layout/BotonRecorrido');
const { default: PresentadorRecorrido } = await import('@/shared/components/layout/PresentadorRecorrido');
const { pasosDelRecorridoGeneral } = await import('@/shared/lib/recorridoGeneral');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const SRC = path.resolve(__dirname, '..');
const TODOS_LOS_PERMISOS = [...CLAVES];

function codigoDe(dir = SRC, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'test' && e.name !== '__smoke__' && e.name !== 'node_modules') codigoDe(p, acc); }
    else if (/\.(tsx|jsx|ts|js)$/.test(e.name) && !/\.test\./.test(e.name)) acc.push([path.relative(SRC, p), fs.readFileSync(p, 'utf8')]);
  }
  return acc;
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  yo.current = { id: 41, role: 'admin', nombre: 'Marta Ruiz' };
  _reiniciarLanzador();
  window.matchMedia = window.matchMedia || ((q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ningún recorrido se abre solo', () => {
  it('en el código, nadie abre un recorrido porque «no lo ha visto»', () => {
    const culpables = [];
    for (const [f, c] of codigoDe()) {
      // Las funciones se pueden seguir definiendo (se exportan), pero no usarse para abrir.
      const usos = c.split('\n').filter((l) => /\b(recorridoPendiente|tourPendiente|hayQueSeñalar)\(/.test(l) && !/export (function|const)/.test(l));
      if (usos.length) culpables.push(`${f}: ${usos.join(' | ').trim()}`);
    }
    expect(culpables).toEqual([]);
  });

  it('cada «Ver recorrido», con todos los permisos y la pantalla lista, espera a que lo pulsen', () => {
    vi.useFakeTimers();
    for (const k of TODOS_LOS_PERMISOS) permisos.add(k);
    render(<>{Object.keys(RECORRIDOS_COBROS).map((id) => <VerRecorrido key={id} id={id} listo />)}</>);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(document.querySelector('[aria-labelledby="recorrido-titulo"]')).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Ver recorrido:/ }).length).toBe(Object.keys(RECORRIDOS_COBROS).length);
  });

  it('la cabecera tampoco abre nada sola', () => {
    vi.useFakeTimers();
    for (const k of TODOS_LOS_PERMISOS) permisos.add(k);
    render(<MemoryRouter initialEntries={['/links-pago']}><BotonRecorrido /><PresentadorRecorrido /></MemoryRouter>);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(document.querySelector('[aria-labelledby="recorrido-titulo"]')).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('el botón «Recorrido» de arriba', () => {
  const pintar = (ruta) => render(
    <MemoryRouter initialEntries={[ruta]}><BotonRecorrido /><PresentadorRecorrido /></MemoryRouter>,
  );

  it('abre el de la pantalla: en Links de pago, el de Links de pago, sin menú de por medio', () => {
    permisos.add('links_pago.crear');
    pintar('/links-pago');
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Links de pago' })).toBeInTheDocument();
  });

  it('la flecha deja elegir: el de la pantalla o el general', () => {
    permisos.add('links_pago.crear');
    pintar('/links-pago');
    fireEvent.click(screen.getByRole('button', { name: 'Más recorridos' }));
    expect(screen.getByRole('menu', { name: 'Recorridos' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Tu menú, paso a paso/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Links de pago' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Links de pago' })).toBeInTheDocument();
  });

  it('con varios en la pantalla (la ficha de la venta), «Recorrido» los ofrece para elegir', () => {
    for (const k of ['conversions.view', 'links_pago.crear', 'stripe.edit']) permisos.add(k);
    pintar('/ventas/12');
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido' }));
    expect(document.querySelector('[aria-labelledby="recorrido-titulo"]')).toBeNull();
    const nombres = screen.getAllByRole('menuitem').map((b) => b.textContent);
    expect(nombres).toEqual(expect.arrayContaining([
      'Cuotas y cobros de la venta', 'Cobrar la venta con links de pago', 'Cobro automático de las cuotas', 'Cargos de Stripe sin enlazar',
    ]));
  });

  it('en una pantalla sin recorrido, «Recorrido» abre el general, con el rol de quien entra', async () => {
    permisos.add('leads.view');
    pintar('/una-pantalla-sin-recorrido');
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido' }));
    // En el móvil abre antes el menú y espera un instante.
    expect(await screen.findByRole('dialog', { name: 'Tu CRM, como Admin' }, { timeout: 2000 })).toBeInTheDocument();
  });

  it('sin el permiso de la pantalla, no lo ofrece: sale el general, y la flecha dice que no tiene', async () => {
    permisos.add('leads.view');
    pintar('/links-pago');
    fireEvent.click(screen.getByRole('button', { name: 'Más recorridos' }));
    expect(screen.getByText('Esta pantalla todavía no tiene recorrido.')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Links de pago' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Tu menú, paso a paso/ })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Recorrido' }));
    expect(await screen.findByRole('dialog', { name: 'Tu CRM, como Admin' }, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Links de pago' })).toBeNull();
  });

  it('con teclado: flechas para moverse y Escape para cerrar, con el foco de vuelta en la flecha', () => {
    permisos.add('links_pago.crear');
    pintar('/links-pago');
    const flecha = screen.getByRole('button', { name: 'Más recorridos' });
    fireEvent.click(flecha);
    const items = screen.getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(flecha);
  });
});

describe('el recorrido general, según el rol', () => {
  it('una gestora solo ve los bloques que tiene: ni Finanzas ni Configuración', () => {
    yo.current = { id: 50, role: 'gestor', nombre: 'Ana' };
    for (const k of ['leads.view', 'ventas.view', 'proceso.view']) permisos.add(k);
    const bloques = bloquesQueVe(yo.current, (k) => permisos.has(k));
    const nombres = bloques.map((b) => b.label);
    expect(nombres).toContain('Comercial');
    expect(nombres).not.toContain('Finanzas');
    expect(nombres).not.toContain('Configuración');
    const pasos = pasosDelRecorridoGeneral({ roles: ['gestor'], bloques, nombre: 'Ana' });
    expect(pasos[0].titulo).toBe('Tu CRM, como Gestora');
    expect(pasos.map((p) => p.titulo)).not.toContain('Finanzas');
    expect(pasos.find((p) => p.titulo === 'Lo de cada día').texto).toMatch(/La cola del día/);
  });

  it('una admin con Finanzas lo ve, con sus entradas', () => {
    for (const k of ['leads.view', 'ventas.view', 'accounting.view', 'facturas.view']) permisos.add(k);
    const bloques = bloquesQueVe(yo.current, (k) => permisos.has(k));
    const finanzas = bloques.find((b) => b.label === 'Finanzas');
    expect(finanzas).toBeTruthy();
    expect(finanzas.ancla).toBe('menu-finanzas');
    const paso = pasosDelRecorridoGeneral({ roles: ['admin'], bloques }).find((p) => p.titulo === 'Finanzas');
    expect(paso.donde).toBe('[data-recorrido="menu-finanzas"]');
    expect(paso.texto).toMatch(/Tienes: /);
  });

  it('cada bloque que se señala tiene su anclaje en el menú lateral', () => {
    const sidebar = fs.readFileSync(path.join(SRC, 'shared/components/layout/Sidebar.jsx'), 'utf8');
    expect(sidebar).toMatch(/data-recorrido=\{anclaDelBloque\(section\.label\)\}/);
    // (En ISEIE no hay selector de campus arriba: el general no lo señala.)
    for (const n of ['menu-buscar', 'cabecera-recorrido']) {
      const todo = codigoDe().map(([, c]) => c).join('\n');
      expect(todo, n).toContain(`data-recorrido="${n}"`);
    }
  });
});

describe('el registro ruta → recorrido', () => {
  const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');

  it('cada ruta del registro existe en App.jsx', () => {
    for (const [ruta] of tablaDeRutas()) {
      // Absoluta («/links-pago») o anidada en su layout («ventas/:id» dentro de «/finanzas»).
      const tramos = ruta.split('/').filter(Boolean);
      const sufijos = tramos.map((_, i) => tramos.slice(i).join('/'));
      expect(ruta === '/' || app.includes(`path="${ruta}"`) || sufijos.some((x) => app.includes(`path="${x}"`)), ruta).toBe(true);
    }
  });

  it('casa las rutas con parámetros y sin barra final', () => {
    expect(recorridosDeLaRuta('/ventas/12')).toEqual(expect.arrayContaining(['venta-cuotas', 'link-de-pago', 'cobro-automatico', 'cargos-sin-enlazar']));
    expect(recorridosDeLaRuta('/accounting/income/')).toContain('ventas');
    expect(recorridosDeLaRuta('/ventas')).not.toContain('venta-cuotas');
    expect(recorridosDeLaRuta('/links-pago')).toEqual(['links-pago']);
    expect(recorridosDeLaRuta('/no-existe')).toEqual([]);
  });

  it('manda la ruta más concreta, como en el router: La cola no es la ficha de un prospecto', () => {
    expect(recorridosDeLaRuta('/leads/cola')).toEqual(['cola-del-dia']);
    expect(recorridosDeLaRuta('/leads/12')).toEqual(['prospecto-ficha']);
    expect(recorridosDeLaRuta('/ventas/sin-formacion')).toEqual(['ventas-sin-formacion']);
  });
});
