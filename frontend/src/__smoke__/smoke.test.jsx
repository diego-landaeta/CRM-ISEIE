// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockUser = { id: 1, nombre: 'Manuel Test', email: 'manuel@test.com', role: 'superadmin' };
const mockProjects = [
  { id: 10, nombre: 'ISEIE', slug: 'iseie', emoji: null, type: 'crm', theme_color: null, logo_url: null },
];

beforeAll(() => {
  global.fetch = vi.fn((url) => {
    if (String(url).endsWith('/auth/refresh')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({
          success: true,
          data: { accessToken: 'fake-token', user: mockUser, projects: mockProjects, activeProjectId: 1 },
        }),
      });
    }
    const u = String(url);
    // Conexión → Moodle (2.6.0): la API devuelve los campus dentro de un objeto.
    if (u.includes('/moodle/campus')) {
      return Promise.resolve({
        ok: true, status: 200, headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ success: true, data: { campus: [], funciones: [] } }),
      });
    }
    // Lo nuevo de la 2.6.0 con su forma real: un objeto vacío hacía reventar las
    // pantallas en la prueba (no en el CRM), como «.length de undefined».
    const forma = (data) => Promise.resolve({
      ok: true, status: 200, headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, data }),
    });
    if (u.includes('/consultas/alumnos-sin-mensajes')) return forma({ alumnos: [], diasAmbar: 5, diasRojo: 7 });
    if (u.includes('/consultas/carga')) {
      return forma({ actual: null, historial: [], desactualizada: false, diasPlazo: 7,
        datosReales: { alumnos_activos: 0, consultas_abiertas: 0, alumnos_sin_mensajes: 0 } });
    }
    if (u.includes('/consultas/tutores-panel')) return forma({ tutores: [], campusSinTutor: [], diasPlazoCarga: 7 });
    if (u.includes('/consultas/campus-sin-tutor')) return forma([]);
    if (/\/cursos-pendientes(\?|$)/.test(u)) return forma([]);
    if (u.includes('/cursos-pendientes/resumen')) {
      return forma({ campus: [], total: { abiertos: 0, retrasados: 0, sin_tutora: 0, alumnas_esperando: 0 },
        carga_por_tutora: null, indicadores: null });
    }
    // Las ventas por vendedora del panel de Finanzas: una lista.
    if (u.includes('/informes/ventas-vendedora')) return forma([]);
    // Ventas por cliente y por país (pantalla Ventas): listas.
    if (u.includes('/ventas/por-cliente') || u.includes('/ventas/paises')) return forma([]);
    // Status: las piezas del sistema llegan en un objeto, no en una lista.
    if (u.includes('/status/piezas')) {
      return forma({ global: 'operativo', piezas: [], tareas: [], webhook: null, comprobado: null, arribaDesdeMs: 0 });
    }
    if (u.includes('/status/correos')) return forma({ envios: [], resumen: { enviado: 0, fallido: 0, bloqueado: 0 } });
    if (u.includes('/tasks/teams/mine')) return forma([]);
    if (/\/consultas(\/mias)?(\?|$)/.test(u)) return forma({ consultas: [], plazoHoras: 24 });
    if (u.includes('/ventas/sin-formacion')) {
      return forma({ filas: [], total: 0, conSugerencia: 0, sinTexto: 0, importe: 0, cobrado: 0 });
    }
    // Secuencias de correo (ruta en español desde la paridad con MultiCRM): una lista.
    if (u.includes('/secuencias-email')) return forma([]);
    // Endpoints que devuelven array en la app real (mayoría son listas o catálogos).
    const isList = /\/(leads|products|conversions|notifications|matriculas|forms|expenses|payments|email-sequences|email-templates|reports|status|commissions|payroll|accounts-payable|shortcuts|categories|field-definitions|make-webhooks|woocommerce|wc|credentials|users|availability|deliveries|sync-runs|rules|periods|spam-reports|sales|interactions|reminders)(\/|\?|$)/.test(u)
      || u.includes('/by-lead/') || u.includes('/dashboard-summary') || u.includes('/stats')
      || u.includes('/today') || u.includes('/tree') || u.includes('/runs');
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ success: true, data: isList ? [] : {} }),
    });
  });
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} });
  }
  window.scrollTo = () => {};
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  global.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
});

async function renderAt(path) {
  vi.resetModules();
  const { ThemeProvider } = await import('@/contexts/ThemeContext');
  const { AuthProvider } = await import('@/contexts/AuthContext');
  const { ProjectProvider } = await import('@/contexts/ProjectContext');
  const { ConfirmProvider } = await import('@/shared/components/ui/useConfirm');
  const App = (await import('@/App')).default;
  const ErrorBoundary = (await import('@/shared/components/layout/ErrorBoundary')).default;

  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <AuthProvider>
            <ProjectProvider>
              <ConfirmProvider>
                <App />
              </ConfirmProvider>
            </ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </ErrorBoundary>
  );
}

// TODAS las rutas estáticas (sin params) definidas en App.jsx + las dinámicas
// con un id de prueba. Si alguna rinde NotFoundPage o crash en ErrorBoundary,
// el test falla y nombra la ruta.
const ALL_STATIC_ROUTES = [
  '/dashboard',
  '/leads', '/leads/pipeline', '/leads/archived', '/leads/1',
  '/products', '/products/pending', '/products/tree', '/products/1',
  '/ventas', '/commissions', '/expenses', '/payroll',
  '/accounting', '/accounting/income', '/accounting/receivable', '/accounting/payable',
  '/revenue',
  '/clients', '/clients/1',
  '/configuracion/canales', '/configuracion/atajos',
  '/configuracion/categorias-arbol', '/configuracion/campos',
  '/manual', '/preferencias', '/seo', '/soporte',
  '/matriculas',
  '/forms', '/make-webhooks', '/make-webhooks/1', '/woocommerce',
  '/secuencias-email', '/email-templates',
  '/documentos', '/documentos/config',
  '/roles', '/informes', '/notificaciones', '/notifications',
  '/activity', '/status', '/perfil', '/configuracion',
  // Lo nuevo de la 2.6.0 (paridad con MultiCRM).
  '/consultas', '/consultas/alumnos', '/consultas/carga', '/consultas/tutores', '/consultas/metricas',
  '/conexion/moodle', '/ventas/sin-formacion', '/informes/preguntar',
  // Las pantallas de IA, apagadas (#30, Diego 10/11): su dirección lleva al inicio.
  '/chat-ia', '/ai-chat',
];

describe('app boot routes', () => {
  for (const path of ALL_STATIC_ROUTES) {
    it(`renders ${path} without throwing or showing 404`, { timeout: 30000 }, async () => {
      const errors = [];
      const origError = console.error;
      console.error = (...args) => {
        const msg = args.map(String).join(' ');
        if (msg.includes('[ErrorBoundary]') || msg.includes('Error: ') || msg.includes('TypeError')) {
          errors.push(msg);
        }
        origError(...args);
      };

      const { container } = await renderAt(path);
      await new Promise((r) => setTimeout(r, 600));
      console.error = origError;

      const html = container.innerHTML;
      const broken = html.includes('Algo se ha roto');
      // NotFoundPage muestra "404" o "Página no encontrada"
      const isNotFound = /404|no encontrad|Not Found/i.test(html) && !html.includes('Cargando');
      if (broken || isNotFound || errors.length > 0) {
        console.log(`\n[ISSUE on ${path}] broken=${broken} 404=${isNotFound} errors:`, errors.slice(0, 2));
      }
      expect(broken, `ErrorBoundary triggered on ${path}`).toBe(false);
      expect(isNotFound, `NotFoundPage rendered on ${path}`).toBe(false);
    });
  }
});
