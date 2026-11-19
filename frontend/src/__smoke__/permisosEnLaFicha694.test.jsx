// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno, los matchers de jest-dom
// y la limpieza se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, waitFor, cleanup } from '@testing-library/react';

/*
  Gemela de diego-landaeta/CRM#698 y #752 (#694 del 360) · Los permisos siempre
  a la vista en la ficha de usuario. En el 360 es `UserFormDialog`; en ISEIE son
  `EditUserModal` e `InviteUserModal`, dentro de Configuración.

  - Editando: la sección «Permisos» está en la propia ficha, sin pulsar nada,
    con de dónde le viene cada uno; una excepción se guarda ahí mismo.
  - En el alta: lo que trae el rol elegido, y las excepciones se ajustan antes
    de crearla y viajan con el alta.
  - Nadie da lo que no tiene: «Sí» no se ofrece para lo que quien da de alta no
    tiene. Sin «Permisos de cada persona», solo lectura.
*/

const avisos = vi.hoisted(() => ({ toast: vi.fn() }));
const api = vi.hoisted(() => ({ getCatalogo: vi.fn(), getFicha: vi.fn(), guardarExcepciones: vi.fn(), cambiarRolAMedida: vi.fn(), vistaPreviaDeAlta: vi.fn() }));
const cliente = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: avisos.toast }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/modules/permissions/api/permissions.api', () => api);
vi.mock('@/shared/api/client', () => ({ default: cliente }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 1, role: 'superadmin' }, projects: [{ id: 1, nombre: 'ISEIE' }] }) }));
vi.mock('@/modules/equipo-comercial/components/EquipoComercial', () => ({ default: () => null }));

const { InviteUserModal, EditUserModal } = await import('@/shared/pages/SettingsPage');

afterEach(cleanup);

const CATALOGO = {
  roles: [{ clave: 'gestor', nombre: 'Gestora', descripcion: '' }],
  secciones: [{
    clave: 'comercial', nombre: 'Comercial', recursos: [{
      clave: 'leads', nombre: 'Prospectos', acciones: [
        { clave: 'leads.view', nombre: 'Ver prospectos', descripcion: '' },
        { clave: 'leads.export', nombre: 'Exportar prospectos', descripcion: '' },
        { clave: 'leads.borrar', nombre: 'Borrar prospectos', descripcion: '' },
      ],
    }],
  }],
};
const PROYECTOS = [{ id: 1, nombre: 'ISEIE' }];
const esperar = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const abrirComercial = () => fireEvent.click(screen.getByRole('button', { name: /Comercial/ }));

beforeEach(() => {
  vi.clearAllMocks();
  cliente.get.mockResolvedValue({ success: true, data: [] });
  cliente.post.mockResolvedValue({ success: true, data: {} });
  api.getCatalogo.mockResolvedValue(CATALOGO);
  api.guardarExcepciones.mockResolvedValue({});
});

describe('editando: los permisos en la propia ficha', () => {
  const laura = { id: 4, nombre: 'Laura', email: 'laura@empresa.com', role: 'gestor', projects: [] };
  const ficha = (puedeEditar) => ({
    persona: { id: 4, nombre: 'Laura', email: 'laura@empresa.com', role: 'gestor', roles_extra: [], active: true },
    mapa: { 'leads.view': true, 'leads.export': false, 'leads.borrar': false },
    origenes: { 'leads.view': { tipo: 'rol', rol: 'gestor' }, 'leads.export': { tipo: 'rol', rol: 'gestor' }, 'leads.borrar': { tipo: 'rol', rol: 'gestor' } },
    excepciones: {}, rolAMedida: null, rolesAMedida: [], registro: [], puedeEditar,
  });
  const editar = () => render(<EditUserModal user={laura} projects={PROYECTOS} onClose={vi.fn()} onSaved={vi.fn()} />);

  it('se ven sin abrir otro diálogo, con de dónde le viene cada uno', async () => {
    api.getFicha.mockResolvedValue(ficha(true));
    editar();
    await esperar();
    expect(screen.getByRole('heading', { name: 'Permisos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ver permisos/ })).toBeNull();
    abrirComercial();
    expect(screen.getByText('Ver prospectos')).toBeInTheDocument();
    expect(screen.getAllByText('Su rol: Gestora').length).toBeGreaterThan(0);
    // Todos los permisos, también los que no tiene (Diego, 11/11).
    expect(screen.getByText('Exportar prospectos')).toBeInTheDocument();
  });

  it('una excepción se guarda ahí mismo', async () => {
    api.getFicha.mockResolvedValue(ficha(true));
    editar();
    await esperar();
    abrirComercial();
    const grupo = screen.getByRole('radiogroup', { name: 'Excepción para Exportar prospectos' });
    fireEvent.click(within(grupo).getByRole('radio', { name: 'Sí' }));
    await esperar();
    expect(api.guardarExcepciones).toHaveBeenCalledWith(4, { 'leads.export': true });
  });

  it('sin «Permisos de cada persona», solo lectura', async () => {
    api.getFicha.mockResolvedValue(ficha(false));
    editar();
    await esperar();
    abrirComercial();
    expect(screen.getByText(/solo lectura/)).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });
});

describe('en el alta: lo que trae el rol, y sus excepciones antes de crearla', () => {
  const vista = (excepciones = {}, misPermisos = null) => ({
    mapa: { 'leads.view': true, 'leads.export': excepciones['leads.export'] === true, 'leads.borrar': false },
    origenes: {
      'leads.view': { tipo: 'rol', rol: 'gestor' },
      'leads.export': excepciones['leads.export'] === true ? { tipo: 'excepcion' } : { tipo: 'rol', rol: 'gestor' },
      'leads.borrar': { tipo: 'rol', rol: 'gestor' },
    },
    puedeEditar: true, misPermisos,
  });
  const alta = () => render(<InviteUserModal projects={PROYECTOS} onClose={vi.fn()} onCreated={vi.fn()} />);

  it('pide lo que trae el rol elegido y, con una excepción, vuelve a pedirlo con ella', async () => {
    api.vistaPreviaDeAlta.mockImplementation(async ({ excepciones }) => vista(excepciones));
    alta();
    await esperar();
    expect(api.vistaPreviaDeAlta).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'gestor', excepciones: {} }));
    abrirComercial();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Excepción para Exportar prospectos' })).getByRole('radio', { name: 'Sí' }));
    await esperar();
    expect(api.vistaPreviaDeAlta).toHaveBeenLastCalledWith(expect.objectContaining({ excepciones: { 'leads.export': true } }));
    expect(screen.getByText('Excepción suya: dado a mano')).toBeInTheDocument();
    // No se guarda nada todavía: va con el alta.
    expect(api.guardarExcepciones).not.toHaveBeenCalled();
  });

  it('las excepciones viajan con el alta', async () => {
    api.vistaPreviaDeAlta.mockImplementation(async ({ excepciones }) => vista(excepciones));
    alta();
    await esperar();
    abrirComercial();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Excepción para Exportar prospectos' })).getByRole('radio', { name: 'Sí' }));
    await esperar();
    fireEvent.change(screen.getByLabelText(/^Nombre y apellido/), { target: { value: 'Ana Nueva' } });
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: 'ana@empresa.com' } });
    const campus = screen.getAllByRole('checkbox').find((c) => /ISEIE/.test(c.closest('label')?.textContent || ''));
    fireEvent.click(campus);
    await esperar();
    fireEvent.click(screen.getByRole('button', { name: 'Invitar' }));
    await waitFor(() => expect(cliente.post).toHaveBeenCalled());
    const [ruta, cuerpo] = cliente.post.mock.calls.find((c) => c[0] === '/users');
    expect(ruta).toBe('/users');
    expect(cuerpo).toMatchObject({ excepciones: { 'leads.export': true } });
  });

  it('«Sí» no se ofrece para lo que quien da de alta no tiene', async () => {
    api.vistaPreviaDeAlta.mockResolvedValue(vista({}, ['leads.view']));
    alta();
    await esperar();
    abrirComercial();
    const si = within(screen.getByRole('radiogroup', { name: 'Excepción para Exportar prospectos' })).getByRole('radio', { name: 'Sí' });
    expect(si).toBeDisabled();
    expect(si).toHaveAttribute('title', 'No lo puedes dar: tú no lo tienes');
  });
});
