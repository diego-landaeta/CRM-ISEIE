// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de CRM#880 · Configuración vista por una gestora: las pestañas que el
  servidor le niega (403) no salen ni se montan. Usuarios y Disponibilidad leen
  `/users*` (users.view) y APIs globales lee `/credentials` (credentials.view).
  En ISEIE la pestaña de entrada es Usuarios: sin users.view se abre Seguridad.
  Cada perfil lleva el mapa de serie que le da el servidor (`resolverPermisos`).
*/

const h = vi.hoisted(() => ({ user: null, permissions: null, get: null }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: h.user, permissions: h.permissions, projects: [] }) }));
vi.mock('@/shared/api/client', () => ({ default: { get: (...a) => h.get(...a), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/components/ui/useConfirm', () => ({ useConfirm: () => vi.fn() }));
// Marca y Países son de otras pruebas; aquí solo importa qué se pide al servidor.
vi.mock('@/shared/pages/MarcaSection', () => ({ default: () => <p>contenido-marca</p> }));
vi.mock('@/modules/settings/components/PaisesPorCampus', () => ({ default: () => <p>contenido-paises</p> }));

const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: SettingsPage } = await import('@/shared/pages/SettingsPage');

function como(role, excepciones = {}) {
  h.user = { id: 7, nombre: 'Prueba', role };
  h.permissions = resolverPermisos({ role, roles_extra: [], excepciones }).mapa;
}
const abrir = () => render(<MemoryRouter><SettingsPage /></MemoryRouter>);
const pedidas = () => h.get.mock.calls.map(([url]) => String(url));
const nav = () => screen.getByRole('navigation', { name: 'Configuración' });

beforeEach(() => {
  h.get = vi.fn().mockResolvedValue({ success: true, data: [] });
});

describe('Configuración · pestañas según los permisos (gemela de CRM#880)', () => {
  it('gestora: no salen Usuarios, Disponibilidad ni APIs globales, se abre Seguridad y no se pide nada a /users ni /credentials', async () => {
    como('gestor');
    abrir();
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Disponibilidad' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'APIs globales' })).toBeNull();
    // Lo que no pide permiso para leerse sigue ahí.
    expect(screen.getByRole('button', { name: 'Seguridad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marca' })).toBeTruthy();
    expect(nav().textContent).toContain('Roles y permisos');
    expect(screen.getByRole('heading', { name: 'Seguridad' })).toBeTruthy();
    // Dar tiempo a los efectos: ninguna lectura que el servidor le niega.
    await new Promise((r) => setTimeout(r, 0));
    expect(pedidas().filter((u) => u.startsWith('/users') || u.startsWith('/credentials'))).toEqual([]);
  });

  it('gestora: las demás pestañas se siguen abriendo', () => {
    como('gestor');
    abrir();
    fireEvent.click(screen.getByRole('button', { name: 'Marca' }));
    expect(screen.getByText('contenido-marca')).toBeTruthy();
  });

  it('admin: salen las tres y se entra en Usuarios, que lee /users', async () => {
    como('admin');
    abrir();
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disponibilidad' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'APIs globales' })).toBeTruthy();
    await waitFor(() => expect(pedidas().some((u) => u.startsWith('/users?'))).toBe(true));
  });

  it('con users.view pero sin credentials.view: Usuarios sí y APIs globales no', () => {
    como('gestor', { 'users.view': true });
    abrir();
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disponibilidad' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'APIs globales' })).toBeNull();
  });

  it('el mapa de permisos llega después: se pasa sola de Seguridad a Usuarios', () => {
    como('admin');
    const mapa = h.permissions;
    h.permissions = null;
    const { rerender } = abrir();
    expect(screen.queryByRole('button', { name: 'Usuarios' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Seguridad' })).toBeTruthy();
    h.permissions = mapa;
    rerender(<MemoryRouter><SettingsPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: 'Usuarios' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Seguridad' })).toBeNull();
  });
});
