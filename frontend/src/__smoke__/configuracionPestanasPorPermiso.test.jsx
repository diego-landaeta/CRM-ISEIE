// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Gemela de diego-landaeta/CRM#880 (QA de /testeo del 18/11/2026) · Configuración
 * vista por una gestora: las pestañas que el servidor le niega (403) no salen y
 * no se montan, así que no se piden. En ISEIE, Configuración abre en Usuarios:
 * sin «Ver usuarios», abre la primera que sí puede leer.
 */

const permisos = vi.hoisted(() => ({ mapa: {} }));
const cliente = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.mapa[k] === true, tieneRol: () => false }) }));
vi.mock('@/shared/api/client', () => ({ default: cliente }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 9, role: 'gestor' }, projects: [] }) }));
// Las secciones que no se miran aquí, sustituidas: solo importa cuál se monta.
vi.mock('@/shared/pages/MarcaSection', () => ({ default: () => <p>contenido-marca</p> }));
vi.mock('@/modules/settings/components/PaisesPorCampus', () => ({ default: () => <p>contenido-paises</p> }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn().mockResolvedValue(true) }));

const { default: SettingsPage } = await import('@/shared/pages/SettingsPage');

const abrir = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);
const pedidas = () => cliente.get.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  permisos.mapa = {};
  cliente.get.mockResolvedValue({ success: true, data: [] });
});
afterEach(cleanup);

describe('Configuración · pestañas según los permisos', () => {
  it('sin users.view ni credentials.view no salen Usuarios, Disponibilidad ni APIs globales, y no se piden', async () => {
    abrir();
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disponibilidad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'APIs globales' })).toBeNull();
    // Lo que no pide permiso para leerse sigue ahí.
    expect(screen.getByRole('button', { name: 'Seguridad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marca' })).toBeTruthy();
    // Abre la primera que sí puede leer, no Usuarios.
    expect(screen.getByText('contenido-marca')).toBeTruthy();
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/users') || u.startsWith('/credentials'))).toBe(false));
  });

  it('con users.view pero sin credentials.view, Usuarios sí (y abre ahí) y APIs globales no', async () => {
    permisos.mapa = { 'users.view': true };
    abrir();
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disponibilidad' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'APIs globales' })).toBeNull();
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/users'))).toBe(true));
  });

  it('con los dos permisos salen las tres', () => {
    permisos.mapa = { 'users.view': true, 'credentials.view': true };
    abrir();
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disponibilidad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'APIs globales' })).toBeTruthy();
  });
});
