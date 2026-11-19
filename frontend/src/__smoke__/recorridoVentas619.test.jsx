// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  El recorrido guiado de Ventas (CRM-ISEIE#619, gemela de CRM#941). Diego, 19/11:
  «esta sección [Ventas] tenga tutorial guiado». Sustituye al botón «Tutoriales».
  En ISEIE es la pantalla de `IncomePage` (Finanzas › Ingresos, /accounting/income).

  Se comprueba:
    · que tiene los pasos del encargo, con permisos del catálogo;
    · que cada paso apunta a un `data-recorrido` que sigue en el código, y que la
      pantalla, con datos, los pinta TODOS;
    · que «Tutoriales» ya no está y «Ver recorrido» sí, y que el recorrido pasa por
      todos sus pasos con «Siguiente», vuelve con «Atrás» y se cierra con Escape.
*/

const { permisos, api } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn(), post: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 7, role: 'admin' } }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }),
}));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a) } }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'Campus de prueba' },
    activeIssuer: { id: 3, nombre: 'Empresa de prueba' },
    projects: [{ id: 1, nombre: 'Campus de prueba' }], switchProject: vi.fn(), switchIssuer: vi.fn(),
  }),
}));

const { RECORRIDOS_COBROS, pasosPara, claveRecorrido } = await import('@/shared/lib/recorridosCobros');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');
const { default: IncomePage } = await import('@/modules/accounting/pages/IncomePage');

const SRC = path.resolve(__dirname, '..');
const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const nombreDe = (donde) => /^\[data-recorrido="([a-z0-9-]+)"\]$/.exec(donde)?.[1];
const lista = (p) => (p == null ? [] : Array.isArray(p) ? p : [p]);
const VENTAS = RECORRIDOS_COBROS.ventas;

/** Una pantalla de Ventas con de todo: avisos, reparto por campus, meta y lista. */
const TOTALES = {
  importe: 4200, pagado: 2600, pendiente: 1600, iva: 730,
  facturadas: 3, sinFactura: 2, noRequiereFactura: 1, pendientesDeFacturar: 1,
  facturasDeAntes: { n: 2, importe: 450 },
  facturadoEnPeriodo: { n: 5, importe: 2100 },
  cobrosDelPeriodo: { matricula: { n: 3, importe: 1650 }, cuotas: { n: 2, importe: 450 } },
  facturasPorClase: { venta: { n: 3, importe: 1650 }, cuota: { n: 2, importe: 450 }, parte: { n: 0, importe: 0 }, suelta: { n: 0, importe: 0 } },
  porProyecto: [
    { project_id: 1, nombre: 'Campus de prueba', ventas: { n: 3, importe: 3000 }, cuotas: { n: 1, importe: 200 } },
    { project_id: 2, nombre: 'Otro campus', ventas: { n: 1, importe: 1200 }, cuotas: { n: 1, importe: 250 } },
  ],
  cobradoDeMas: { n: 0, importe: 0 },
};
const FILA = { tipo: 'venta', clave_id: 1, fecha: '2026-11-05', fecha_de_la_venta: '2026-11-05', lead_id: 10, venta_id: 1,
  cliente: 'Ana Pérez', producto: 'Máster en Psicología', total: 1200, pagado: 600, factura: 'F-2026-0001', factura_no_requerida: false };

function respuestas(url) {
  switch (url) {
    case '/conversions': return { success: true, data: [{ id: 1 }], pagination: { total: 4 }, totales: TOTALES };
    case '/conversions/filas': return { success: true, data: [FILA], pagination: { total: 1 } };
    case '/conversions/productos': return { success: true, data: ['Máster en Psicología', 'Curso de Coaching'] };
    case '/ventas/gestores-stats': return { success: true, data: { gestores: [{ user_id: 7, nombre: 'Laura', role: 'gestor', ventas: 3 }] } };
    case '/ventas/my-stats': return { success: true, data: { user_id: 7, ventas: 3, vendido: 3000, cobrado: 1800, meta_ventas: 5, meta_facturacion: 4000, progreso_ventas_pct: 60, progreso_facturacion_pct: 45 } };
    case '/ventas/top-products': return { success: true, data: [{ product_id: 1, producto: 'Máster en Psicología', ventas: 2, facturado: 2400, cobrado: 1200 }] };
    default: return { success: true, data: [] };
  }
}

function abrir() {
  return render(
    <MemoryRouter initialEntries={['/accounting/income']}>
      <Routes><Route path="/accounting/income" element={<IncomePage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  ['ventas.view', 'conversions.view'].forEach((k) => permisos.add(k));
  api.get.mockReset();
  api.get.mockImplementation(async (url) => respuestas(url));
  api.post.mockReset();
  document.body.innerHTML = '';
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('los pasos del recorrido de Ventas', () => {
  it('presenta, cuenta sus pasos y termina diciendo cómo repetirlo', () => {
    expect(VENTAS.pasos[0].texto).toContain('{pasos}');
    expect(VENTAS.pasos.at(-1).texto).toMatch(/«Ver recorrido»/);
    for (const p of VENTAS.pasos) {
      expect(p.titulo.length).toBeGreaterThan(3);
      expect(p.texto.length).toBeLessThan(330);
      expect(p.texto).not.toMatch(/endpoint|payload|API key|token de acceso/i);
    }
  });

  it('explica todo lo del encargo', () => {
    const titulos = VENTAS.pasos.map((p) => p.titulo);
    for (const t of ['Los filtros', 'Las tarjetas', 'Cuotas facturadas', 'Ventas por facturar', 'Por proyecto',
      'Ventas que esperan factura', 'Facturas que no son ventas de ahora', 'Mi meta del mes', 'Programas más vendidos', 'Nueva venta']) {
      expect(titulos).toContain(t);
    }
  });

  it('sus permisos existen en el catálogo', () => {
    for (const k of [...lista(VENTAS.permiso), ...VENTAS.pasos.flatMap((p) => lista(p.permiso))]) {
      expect(CLAVES.has(k), `${k} no está en el catálogo`).toBe(true);
    }
  });

  it('cada anclaje sigue en el código de su pantalla', () => {
    const codigo = VENTAS.pantalla.map(leer).join('\n');
    for (const p of VENTAS.pasos.filter((x) => x.donde)) {
      const n = nombreDe(p.donde);
      expect(n, `«${p.donde}» no es un data-recorrido`).toBeTruthy();
      expect(codigo, `falta ${n}`).toMatch(new RegExp(`data-recorrido="${n}"`));
    }
  });

  it('«Tutoriales» ya no está: la pantalla ofrece «Ver recorrido»', () => {
    const pagina = leer('modules/accounting/pages/IncomePage.tsx');
    expect(pagina).toMatch(/<VerRecorrido id="ventas"/);
    expect(pagina).not.toMatch(/TutorialesVentas|Tutoriales\s*</);
    expect(fs.existsSync(path.join(SRC, 'modules/sales/components/TutorialesVentas.tsx'))).toBe(false);
  });
});

describe('la pantalla de Ventas, con datos', () => {
  it('pinta todos los anclajes y el botón, y sin «Tutoriales»', async () => {
    localStorage.setItem(claveRecorrido('ventas', 7), '1');
    abrir();
    await screen.findAllByText('Ana Pérez', {}, { timeout: 8000 });
    await screen.findByText('Mi meta del mes', {}, { timeout: 8000 });
    await screen.findByText(/Programas más vendidos/, {}, { timeout: 8000 });
    for (const p of VENTAS.pasos.filter((x) => x.donde)) {
      expect(document.querySelector(p.donde), p.donde).not.toBeNull();
    }
    expect(screen.getByRole('button', { name: 'Ver recorrido: Ventas' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tutoriales/ })).toBeNull();
  });

  it('sin permiso de ventas, ni botón ni recorrido', async () => {
    permisos.clear();
    abrir();
    await screen.findAllByText('Ana Pérez', {}, { timeout: 8000 });
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });

  it('la primera vez sale solo, pasa por todos los pasos, vuelve atrás y se cierra con Escape', async () => {
    abrir();
    await screen.findAllByText('Ana Pérez', {}, { timeout: 8000 });
    await screen.findByText('Mi meta del mes', {}, { timeout: 8000 });
    await screen.findByText(/Programas más vendidos/, {}, { timeout: 8000 });
    // Sale solo cuando la pantalla ha cargado.
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Las ventas del periodo' })).toBeInTheDocument(), { timeout: 3000 });
    expect(localStorage.getItem(claveRecorrido('ventas', 7))).toBe('1');
    const total = pasosPara(VENTAS, (k) => permisos.has(k)).length;
    const vistos = [];
    for (let i = 0; i < total + 2; i++) {
      vistos.push(document.getElementById('recorrido-titulo').textContent);
      expect(screen.getByText(new RegExp(`de ${total}$`))).toBeInTheDocument();
      const sig = screen.queryByRole('button', { name: /Siguiente/ });
      if (!sig) break;
      fireEvent.click(sig);
    }
    expect(vistos).toEqual(VENTAS.pasos.map((p) => p.titulo));
    // Atrás vuelve al anterior.
    fireEvent.click(screen.getByRole('button', { name: /Atrás/ }));
    expect(document.getElementById('recorrido-titulo').textContent).toBe('Nueva venta');
    act(() => { fireEvent.keyDown(window, { key: 'Escape' }); });
    expect(screen.queryByRole('dialog')).toBeNull();
    // Y «Ver recorrido» lo repite.
    fireEvent.click(screen.getByRole('button', { name: /Ver recorrido/ }));
    expect(screen.getByRole('dialog', { name: 'Las ventas del periodo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar el recorrido' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
