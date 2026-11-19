// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';
despuesDeCada(() => limpiar());
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * #752 (Refs #694) · Configuración › Roles no deja guardar un rol con un
 * permiso sin lo que necesita, y dice cuál. Es lo mismo que rechaza el
 * servidor (FALTA_REQUISITO): marcar algo sin su «Ver», o quitar un «Ver» del
 * que dependen otros. Lo que ya venía así no bloquea.
 */

const { catalogo } = await import('../../../backend/src/modules/permissions/catalogo.js')
  .then((m) => ({ catalogo: m.catalogoParaPantalla() }));
const { permisosDelRol } = await import('../../../backend/src/modules/permissions/resolver.js');

const api = vi.hoisted(() => ({
  getCatalogo: vi.fn(), getRoles: vi.fn(), getSystemDefaults: vi.fn(),
  guardarRolFijo: vi.fn(), guardarRolAMedida: vi.fn(), crearRolAMedida: vi.fn(),
}));
vi.mock('@/modules/permissions/api/permissions.api', () => api);
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: () => true }) }));
vi.mock('@/modules/permissions/components/PestanaVista', () => ({ default: () => null }));

const { default: RolesPage } = await import('@/modules/permissions/pages/RolesPage');
const lib = await import('@/modules/permissions/lib/permisos');

const fijo = (clave, nombre, permisos) => ({ clave, nombre, descripcion: '', permisos, cambiados: [], personas: 1, editable: true });

beforeEach(() => {
  vi.clearAllMocks();
  api.getCatalogo.mockResolvedValue(catalogo);
  api.getSystemDefaults.mockResolvedValue({});
  api.guardarRolFijo.mockResolvedValue({});
  api.getRoles.mockResolvedValue({ fijos: [fijo('admin', 'Admin', permisosDelRol('admin', []))], aMedida: [] });
});

async function abrirProspectos() {
  render(<MemoryRouter><RolesPage /></MemoryRouter>);
  await screen.findByRole('heading', { name: 'Admin' });
  fireEvent.change(screen.getByLabelText('Buscar un permiso'), { target: { value: 'prospectos' } });
}
const casilla = (nombre) => screen.getByText(nombre, { selector: 'span' }).closest('label').querySelector('input');
const guardar = () => screen.getByRole('button', { name: 'Guardar' });

describe('la regla, sin React', () => {
  it('solo lo que rompe el cambio, y en los dos sentidos', () => {
    expect(lib.roturasNuevas(catalogo, {}, { 'leads.edit': true })).toEqual(['«Editar prospectos» necesita «Ver prospectos».']);
    expect(lib.roturasNuevas(catalogo, { 'leads.view': true, 'leads.edit': true }, { 'leads.edit': true }))
      .toEqual(['Sin «Ver prospectos» no sirve «Editar prospectos»: quítalo también o deja «Ver prospectos».']);
    expect(lib.roturasNuevas(catalogo, { 'leads.edit': true }, { 'leads.edit': true, 'ventas.view': true })).toEqual([]);
  });
});

describe('Configuración › Roles', () => {
  it('quitar «Ver prospectos» con otros que lo necesitan: no deja guardar y dice por qué', async () => {
    await abrirProspectos();
    fireEvent.click(casilla('Ver prospectos'));
    const alerta = await screen.findByRole('alert');
    expect(within(alerta).getByText(/No se puede guardar así/)).toBeTruthy();
    expect(within(alerta).getByText(/Sin «Ver prospectos» no sirve «Editar prospectos»/)).toBeTruthy();
    expect(guardar().disabled).toBe(true);
    // Volver a marcarlo lo arregla.
    fireEvent.click(casilla('Ver prospectos'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('un cambio que no rompe nada se guarda', async () => {
    await abrirProspectos();
    fireEvent.click(casilla('Editar prospectos'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(guardar().disabled).toBe(false);
    fireEvent.click(guardar());
    expect(api.guardarRolFijo).toHaveBeenCalledWith('admin', expect.objectContaining({ 'leads.edit': false, 'leads.view': true }));
  });

  it('lo que ya venía roto no bloquea guardar otra cosa', async () => {
    const roto = { ...permisosDelRol('admin', []), 'leads.view': false };
    api.getRoles.mockResolvedValue({ fijos: [fijo('admin', 'Admin', roto)], aMedida: [] });
    await abrirProspectos();
    fireEvent.click(casilla('Editar prospectos'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(guardar().disabled).toBe(false);
  });
});
