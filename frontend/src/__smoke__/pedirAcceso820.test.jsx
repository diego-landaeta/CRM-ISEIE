// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Gemela de CRM#820 (CRM-ISEIE#501) · Pedir acceso o permiso desde el CRM.

  Las peticiones de acceso le llegaban a Diego por chat. Ahora hay un botón en
  el menú de usuario y en «No tienes acceso» que abre un formulario corto y lo
  manda a soporte como un ticket del tipo «acceso». Lo que se fija aquí:

    - el formulario: qué pide, qué manda al servidor y qué no deja enviar;
    - «No tienes acceso» sabe QUÉ permiso falta y lo pone solo;
    - el botón del menú de usuario lo tiene todo el mundo, también el tutor y
      el colaborador (que son quienes más acaban pidiendo).

  Los mapas de permisos son los del servidor (`resolverPermisos`), por rol.
*/

const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const toast = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ user: null, permissions: null, logout: () => {} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({
    activeProject: { id: 1, nombre: 'ISEIE' }, activeIssuerId: null, activeIssuer: null,
    projects: [{ id: 1, nombre: 'ISEIE' }, { id: 2, nombre: 'CEDIA' }], setActiveProject: vi.fn(),
  }),
}));
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark', toggleTheme: vi.fn() }),
  useOptionalTheme: () => 'dark',
}));
vi.mock('@/shared/api/client', () => ({ default: { get, post, patch } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast }));

const acc = await import('@/modules/soporte/lib/accesos');
const { default: PedirAcceso } = await import('@/modules/soporte/components/PedirAcceso');
const { default: Sidebar, permisoQueFalta } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');

const quien = (role) => ({ id: 41, nombre: 'Prueba', email: 'p@empresa.com', role, roles_extra: [], active: true });
const mapaDe = (role) => resolverPermisos({ role }).mapa;
const canDe = (role) => crearCan(quien(role), mapaDe(role));

beforeEach(() => {
  cleanup();
  post.mockReset();
  post.mockResolvedValue({ success: true, data: { id: '9', kind: 'access' } });
  patch.mockReset();
  patch.mockResolvedValue({ success: true, data: {} });
  get.mockReset();
  get.mockResolvedValue({ success: true, data: { count: 0 } });
  toast.mockReset();
});

describe('el formulario, sin pantalla', () => {
  it('desde «No tienes acceso» llega con el permiso puesto y el tipo «permiso»', () => {
    expect(acc.formularioVacio({ permiso: 'leads.view' })).toMatchObject({ tipo: 'permiso', permiso: 'leads.view' });
    expect(acc.formularioVacio()).toMatchObject({ tipo: '', permiso: '' });
  });

  it('pide qué se necesita y una explicación; un alta, nombre y correo', () => {
    const vacio = acc.formularioVacio();
    expect(Object.keys(acc.erroresDe(vacio)).sort()).toEqual(['explicacion', 'tipo']);
    const alta = { ...vacio, tipo: 'alta', explicacion: 'Entra el lunes en admisiones' };
    expect(Object.keys(acc.erroresDe(alta)).sort()).toEqual(['correo', 'nombre']);
    expect(acc.erroresDe({ ...alta, nombre: 'Ana', correo: 'no-es-correo' }).correo).toBe('El correo no es válido');
    expect(acc.erroresDe({ ...alta, nombre: 'Ana', correo: 'ana@ejemplo.com' })).toEqual({});
    expect(acc.erroresDe({ ...vacio, tipo: 'permiso', permiso: 'ver todo', explicacion: 'Lo necesito' }).permiso).toBeTruthy();
  });

  it('manda solo lo que toca a lo que se pide', () => {
    const f = {
      ...acc.formularioVacio(), tipo: 'claude', nombre: 'no va', correo: 'no@va.com',
      explicacion: '  Se me cerró Claude  ', projectId: '2',
    };
    expect(acc.cuerpoDePeticion(f, 'https://x/crm/')).toEqual({
      tipo: 'claude', explicacion: 'Se me cerró Claude', url: 'https://x/crm/', projectId: 2,
    });
    const otro = { ...acc.formularioVacio(), tipo: 'campus', explicacion: 'Quiero entrar', campus: ' CEDIA ' };
    expect(acc.cuerpoDePeticion(otro, 'u')).toEqual({ tipo: 'campus', explicacion: 'Quiero entrar', url: 'u', campus: 'CEDIA' });
  });

  it('la tarjeta del ticket dice qué se pide y para quién', () => {
    expect(acc.resumenDeAcceso({ tipo: 'alta', persona: { nombre: 'Ana', correo: 'ana@x.com' } }))
      .toEqual(['Dar de alta a una persona', 'Para: Ana · ana@x.com']);
    expect(acc.resumenDeAcceso({ tipo: 'permiso', permiso: 'leads.view' })).toEqual(['Un permiso', 'Permiso: leads.view']);
    expect(acc.resumenDeAcceso(null)).toEqual([]);
  });
});

describe('«No tienes acceso» sabe qué permiso falta', () => {
  it('a una tutora en Prospectos le falta «leads.view»; a un admin, nada', () => {
    expect(permisoQueFalta('/leads', canDe('tutor'))).toBe('leads.view');
    expect(permisoQueFalta('/leads', canDe('admin'))).toBeNull();
  });

  it('también en las rutas sin entrada en el menú', () => {
    expect(permisoQueFalta('/whatsapp', canDe('tutor'))).toBe('whatsapp.usar');
  });

  it('una ruta que no pide permiso no tiene nada que pedir', () => {
    expect(permisoQueFalta('/perfil', canDe('tutor'))).toBeNull();
  });
});

describe('el formulario en pantalla', () => {
  async function abrir(inicial) {
    auth.user = quien('gestor');
    auth.permissions = mapaDe('gestor');
    render(<MemoryRouter><PedirAcceso /></MemoryRouter>);
    await act(async () => { acc.abrirPedirAcceso(inicial); });
  }

  it('con el permiso que falta ya puesto, sin explicación no se envía', async () => {
    await abrir({ tipo: 'permiso', permiso: 'leads.view' });
    expect(screen.getByRole('dialog', { name: 'Pedir acceso o permiso' })).toBeTruthy();
    expect(screen.getByDisplayValue('leads.view')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByText('Enviar a soporte')); });
    expect(screen.getByText('Explica un poco más qué necesitas')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it('con la explicación, crea el ticket de acceso y se cierra', async () => {
    await abrir({ tipo: 'permiso', permiso: 'leads.view' });
    const caja = screen.getByRole('dialog').querySelector('textarea');
    fireEvent.change(caja, { target: { value: 'Para atender los prospectos de mi campus' } });
    await act(async () => { fireEvent.click(screen.getByText('Enviar a soporte')); });
    expect(post).toHaveBeenCalledTimes(1);
    const [ruta, cuerpo] = post.mock.calls[0];
    expect(ruta).toBe('/soporte/accesos');
    expect(cuerpo).toMatchObject({ tipo: 'permiso', permiso: 'leads.view', explicacion: 'Para atender los prospectos de mi campus' });
    expect(cuerpo.url).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Petición enviada a soporte' }));
  });

  it('si el servidor dice que no, lo cuenta y no se cierra', async () => {
    post.mockRejectedValueOnce(new Error('Has pedido muchos accesos seguidos'));
    await abrir({ tipo: 'claude' });
    fireEvent.change(screen.getByRole('dialog').querySelector('textarea'), { target: { value: 'Se me cerró Claude' } });
    await act(async () => { fireEvent.click(screen.getByText('Enviar a soporte')); });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive', description: 'Has pedido muchos accesos seguidos' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('el botón del menú de usuario', () => {
  it.each(['gestor', 'tutor', 'colaborador', 'tutor_redactor', 'admin'])('lo tiene %s, y abre el formulario', async (role) => {
    auth.user = quien(role);
    auth.permissions = mapaDe(role);
    expect(mapaDe(role)['accesos.pedir']).toBe(true);
    const abierto = vi.fn();
    window.addEventListener(acc.EVENTO_PEDIR_ACCESO, abierto);
    render(<MemoryRouter><Sidebar /></MemoryRouter>);
    await act(async () => { fireEvent.click(screen.getByText('Prueba')); });
    await act(async () => { fireEvent.click(screen.getByText('Pedir acceso o permiso')); });
    expect(abierto).toHaveBeenCalledTimes(1);
    window.removeEventListener(acc.EVENTO_PEDIR_ACCESO, abierto);
  });

  it('ver y gestionar las peticiones, solo soporte y admin de serie', () => {
    for (const role of ['soporte', 'admin']) {
      expect(mapaDe(role)['accesos.view'], role).toBe(true);
      expect(mapaDe(role)['accesos.gestionar'], role).toBe(true);
    }
    for (const role of ['gestor', 'tutor', 'colaborador', 'tutor_redactor', 'project_manager']) {
      expect(mapaDe(role)['accesos.view'], role).not.toBe(true);
      expect(mapaDe(role)['accesos.gestionar'], role).not.toBe(true);
    }
  });
});
