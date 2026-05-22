// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const mockUser = { id: 1, nombre: 'Manuel Test', email: 'manuel@test.com', role: 'superadmin' };
const mockProjects = [
  { id: 1, nombre: 'ISEIE España', slug: 'iseie-es', emoji: null, type: 'crm', theme_color: null, logo_url: null },
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
    const isList = /\/(leads|products|conversions|notifications|matriculas|forms|expenses|payments|email-sequences|email-templates|reports|status)(\?|$)/.test(u)
      || u.includes('/by-lead/') || u.includes('/dashboard-summary') || u.includes('/stats');
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
});

async function renderAt(path) {
  vi.resetModules();
  const { ThemeProvider } = await import('@/contexts/ThemeContext');
  const { AuthProvider } = await import('@/contexts/AuthContext');
  const { ProjectProvider } = await import('@/contexts/ProjectContext');
  const App = (await import('@/App')).default;
  const ErrorBoundary = (await import('@/shared/components/layout/ErrorBoundary')).default;

  return render(
    <ErrorBoundary>
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider>
          <AuthProvider>
            <ProjectProvider>
              <App />
            </ProjectProvider>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    </ErrorBoundary>
  );
}

describe('app boot routes', () => {
  for (const path of ['/dashboard', '/leads', '/products', '/sales', '/notifications', '/activity', '/settings', '/profile', '/accounting', '/clients', '/roles', '/reports', '/documentos', '/email-sequences', '/email-templates']) {
    it(`renders ${path} without throwing`, { timeout: 15000 }, async () => {
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
      await new Promise((r) => setTimeout(r, 500));
      console.error = origError;

      const html = container.innerHTML;
      const broken = html.includes('Algo se ha roto');
      if (broken || errors.length > 0) {
        console.log(`\n[CRASH on ${path}] errors:`, errors.slice(0, 3));
      }
      expect(broken, `ErrorBoundary triggered on ${path}`).toBe(false);
    });
  }
});
