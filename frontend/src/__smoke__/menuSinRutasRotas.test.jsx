// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { isValidElement } from 'react';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Navigate, createRoutesFromChildren, matchRoutes } from 'react-router-dom';
import { Megaphone } from '@phosphor-icons/react';
import App from '@/App';
import { NAV_SECTIONS, NavItem, EntradaProximamente } from '@/shared/components/layout/Sidebar';
import { SECTIONS } from '@/shared/lib/sections';

/*
  Ninguna entrada del menú lleva a «Página no encontrada» (#226, #234).

  Diego, 10/10: «Las entradas del menú que NO existen en ISEIE se marcan
  "Próximamente" (sin enlace). Las que SÍ existen en algún CRM se hacen
  funcionar donde falten». Campañas y Chat IA acababan en la página de error,
  y «Dashboard» de Finanzas llevaba a Ventas, igual que la entrada de debajo.

  Las rutas salen del propio App.jsx —se llama a `App()` y se recorre el árbol
  de <Route>—, no de una lista copiada aquí: una lista copiada da la razón al
  menú aunque App.jsx cambie.
*/

afterEach(cleanup);

function buscarRoutes(el) {
  if (!el) return null;
  if (Array.isArray(el)) {
    for (const x of el) { const r = buscarRoutes(x); if (r) return r; }
    return null;
  }
  if (!isValidElement(el)) return null;
  if (el.type === Routes) return el;
  return buscarRoutes(el.props?.children);
}

const RUTAS = createRoutesFromChildren(buscarRoutes(App()).props.children);

/**
 * A qué pantalla lleva una dirección, siguiendo las redirecciones. `null` si
 * cae en el `*` (la página de error) o si solo la recoge una ruta con `:id`:
 * `/leads/loquesea` encaja con la ficha de un prospecto y no por eso existe.
 */
function destino(camino, saltos = 0) {
  const limpio = camino.split('?')[0];
  const m = matchRoutes(RUTAS, limpio);
  if (!m) return null;
  const ultima = m[m.length - 1];
  if (ultima.route.path === '*') return null;
  if (Object.keys(ultima.params).length > 0) return null;
  const el = ultima.route.element;
  if (isValidElement(el) && el.type === Navigate) {
    if (saltos > 3) return null;
    return destino(String(el.props.to), saltos + 1);
  }
  return limpio;
}

const entradasDelMenu = NAV_SECTIONS.flatMap((s) =>
  s.items.flatMap((it) => (it.children
    ? it.children.map((c) => ({ ...c, seccion: s.label, grupo: it.label }))
    : [{ ...it, seccion: s.label }])),
);

describe('el menú de ISEIE no lleva a «Página no encontrada»', () => {
  it('hay entradas que mirar (si esto falla, la prueba no está mirando nada)', () => {
    expect(entradasDelMenu.length).toBeGreaterThan(30);
  });

  it('cada entrada con dirección tiene su pantalla en App.jsx', () => {
    const rotas = entradasDelMenu
      .filter((e) => e.to && !e.comingSoon)
      .filter((e) => destino(e.to) === null)
      .map((e) => `${e.seccion} › ${e.label} (${e.to})`);
    expect(rotas).toEqual([]);
  });

  it('las «Próximamente» no tienen pantalla: si la tienen, sobra la marca', () => {
    const conPantalla = entradasDelMenu
      .filter((e) => e.comingSoon && destino(e.to) !== null)
      .map((e) => `${e.seccion} › ${e.label} (${e.to})`);
    expect(conPantalla).toEqual([]);
  });

  it('las que no existen en ISEIE están marcadas como «Próximamente»', () => {
    const marcadas = entradasDelMenu.filter((e) => e.comingSoon).map((e) => e.to).sort();
    // «Chat IA» ya no sale ni como «Próximamente»: las pantallas de IA del CRM
    // están apagadas (#30, Diego 10/11, `PANTALLAS_IA`).
    expect(marcadas).toEqual(['/campaigns', '/google-ads']);
  });

  it('dentro de una misma sección, dos entradas no llevan a la misma pantalla', () => {
    // Era el caso de Finanzas: «Dashboard» y «Ventas», las dos a /ventas. Y el
    // de Captación: «Webhooks» redirigía a la pantalla de Make.
    const repetidas = [];
    for (const s of NAV_SECTIONS) {
      const vistas = new Map();
      const planas = s.items.flatMap((it) => it.children || [it]);
      for (const e of planas) {
        if (!e.to || e.comingSoon) continue;
        const d = destino(e.to);
        if (vistas.has(d)) repetidas.push(`${s.label}: «${vistas.get(d)}» y «${e.label}» → ${d}`);
        else vistas.set(d, e.label);
      }
    }
    expect(repetidas).toEqual([]);
  });

  it('el Dashboard de Finanzas lleva al dashboard de finanzas, no a Ventas', () => {
    const finanzas = NAV_SECTIONS.find((s) => s.label === 'Finanzas');
    const dashboard = finanzas.items.find((e) => e.label === 'Dashboard');
    expect(dashboard.to).toBe('/accounting');
    expect(destino('/accounting')).toBe('/accounting');
  });

  it('Reportes de un gestor (/activity) también tiene pantalla', () => {
    // El menú cambia /informes por /activity según el rol.
    expect(destino('/activity')).toBe('/activity');
  });

  it('las pestañas de cada sección tienen su pantalla', () => {
    const rotas = SECTIONS.flatMap((s) => s.tabs.map((t) => ({ ...t, seccion: s.label })))
      .filter((t) => destino(t.to) === null)
      .map((t) => `${t.seccion} › ${t.label} (${t.to})`);
    expect(rotas).toEqual([]);
  });

  it('cada redirección de App.jsx acaba en una pantalla que existe', () => {
    const redirecciones = [];
    const recorrer = (rutas) => {
      for (const r of rutas) {
        if (isValidElement(r.element) && r.element.type === Navigate && r.path && r.path !== '*') {
          redirecciones.push({ desde: r.path, a: String(r.element.props.to) });
        }
        if (r.children) recorrer(r.children);
      }
    };
    recorrer(RUTAS);
    expect(redirecciones.length).toBeGreaterThan(5);
    const rotas = redirecciones
      .filter((r) => !r.desde.includes(':'))
      .filter((r) => destino(r.a) === null)
      .map((r) => `${r.desde} → ${r.a}`);
    expect(rotas).toEqual([]);
  });
});

describe('«Próximamente» en el menú', () => {
  it('es una entrada atenuada, con su etiqueta y sin enlace', () => {
    const { container, getByText } = render(<EntradaProximamente label="Campañas" icon={Megaphone} />);
    expect(getByText('Próximamente')).toBeTruthy();
    expect(getByText('Campañas')).toBeTruthy();
    expect(container.querySelector('a')).toBeNull();
    expect(container.firstChild.getAttribute('aria-disabled')).toBe('true');
  });

  it('una entrada del menú marcada no navega, aunque tenga dirección', () => {
    const { container } = render(
      <MemoryRouter>
        <NavItem to="/campaigns" label="Campañas" icon={Megaphone} comingSoon />
      </MemoryRouter>,
    );
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('Próximamente');
  });

  it('una entrada normal sí es un enlace', () => {
    const { container } = render(
      <MemoryRouter>
        <NavItem to="/webhooks" label="Webhooks" icon={Megaphone} />
      </MemoryRouter>,
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/webhooks');
  });
});
