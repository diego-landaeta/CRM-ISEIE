// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

/*
  Repaso de roles (Diego, 25/11/2026: «que todos los CRM funcionen bien en todos
  los roles»). Tras lo de Raquel (la líder de equipo sin su equipo en los
  filtros), lo mismo en la tarjeta «Programas de interés» de la ficha: la lista
  de gestoras se pedía solo con `users.view`, y a la líder le salía vacía.
*/

const sesion = vi.hoisted(() => ({ user: null, permissions: null, alcanceComercial: null, projects: [] }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() }));

vi.mock('@/shared/api/client', () => ({ default: api, API_BASE_URL: '/api' }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => sesion }));
vi.mock('@/shared/hooks/useCampusMio', () => ({ useEsCampusMio: () => () => true }));

const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: LeadProductsCard } = await import('@/modules/leads/components/lead-detail/LeadProductsCard');

function entrarComo(role, alcance = null) {
  sesion.user = { id: 5, role, roles_extra: [], lleva_equipo: Array.isArray(alcance) };
  sesion.permissions = role === 'superadmin' ? { '*': true } : resolverPermisos({ role, roles_extra: [] }).mapa;
  sesion.alcanceComercial = alcance;
}
const pideUsuarios = () => api.get.mock.calls.some(([u]) => String(u).startsWith('/users'));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

describe('Programas de interés: las gestoras para cada programa', () => {
  // Quién pide la lista: quien ve a más de una persona, o tiene «Ver usuarios».
  const PIDE = { superadmin: true, admin: true, soporte: true, lider_equipo: true, project_manager: true, gestor: false, tutor: false };
  for (const [role, pide] of Object.entries(PIDE)) {
    it(`${role}: ${pide ? 'pide' : 'no pide'} GET /users`, async () => {
      entrarComo(role, role === 'lider_equipo' ? [5, 2, 12] : null);
      render(<LeadProductsCard leadId={900} projectId={4} isAdmin={false} />);
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await waitFor(() => expect(pideUsuarios()).toBe(pide));
      if (pide) expect(api.get).toHaveBeenCalledWith('/users', { params: { limit: 100, alcance: 'comercial' } });
    });
  }
});
