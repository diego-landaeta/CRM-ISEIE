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
  '/sales', '/commissions', '/expenses', '/payroll',
  '/accounting', '/accounting/income', '/accounting/receivable', '/accounting/payable',
  '/revenue',
  '/clients', '/clients/1',
  '/configuracion/canales', '/configuracion/atajos',
  '/configuracion/categorias-arbol', '/configuracion/campos',
  '/manual', '/preferences', '/seo', '/soporte',
  '/matriculas',
  '/forms', '/make-webhooks', '/make-webhooks/1', '/woocommerce',
  '/email-sequences', '/email-templates',
  '/documentos', '/documentos/config',
  '/roles', '/reports', '/notificaciones', '/notifications',
  '/activity', '/status', '/profile', '/settings',
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
