// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Novedades con una versión SIN `arreglos` (la 2.2.0 de producción no los trae).
 * Antes `v.arreglos.length` tumbaba la pantalla entera: «Algo se ha roto».
 */
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'gestor', email: 'g@ejemplo.test' } }) }));
vi.mock('@/modules/novedades/api/novedades.api', () => ({
  traerNovedades: vi.fn(async () => ({
    crm: { nombre: 'CRM', color: '#123456' },
    actual: '2.2.0',
    versiones: [{
      version: '2.2.0', fecha: '2026-10-16', titulo: 'Versión 2.2.0', intro: 'Lo nuevo.',
      grupos: [{ titulo: 'Diplomas', items: [{ titulo: 'Firma del alumno', texto: 'Ya desde el CRM.' }] }],
    }],
  })),
  traerEnvios: vi.fn(async () => []),
  bajarPdf: vi.fn(),
  enviarNovedades: vi.fn(),
}));

const { default: NovedadesPage } = await import('@/modules/novedades/pages/NovedadesPage');

describe('Novedades con una versión sin arreglos', () => {
  it('se pinta en vez de romperse', async () => {
    render(<MemoryRouter><NovedadesPage /></MemoryRouter>);
    expect(await screen.findAllByText(/Versión 2\.2\.0/)).not.toHaveLength(0);
    expect(screen.queryByText(/Algo se ha roto/)).toBeNull();
  });
});
