// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

afterEach(cleanup);

/**
 * #423, fase 3 · Configuración › Roles como Shopify y la ficha de permisos.
 *
 * El editor: secciones que se pliegan, «Seleccionar todo» por sección, el
 * buscador y el aviso cuando algo marcado necesita otra cosa. La ficha: de
 * dónde viene cada permiso y cambiar una excepción.
 */

const { catalogoDelServidor } = await import('../../../backend/src/modules/permissions/catalogo.js')
  .then((m) => ({ catalogoDelServidor: m.catalogoParaPantalla() }));

const api = vi.hoisted(() => ({
  getCatalogo: vi.fn(), getFicha: vi.fn(), guardarExcepciones: vi.fn(), cambiarRolAMedida: vi.fn(),
}));
vi.mock('@/modules/permissions/api/permissions.api', () => api);
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { default: EditorDePermisos } = await import('@/modules/permissions/components/EditorDePermisos');
const { default: PermisosDePersona } = await import('@/modules/permissions/components/PermisosDePersona');
const lib = await import('@/modules/permissions/lib/permisos');

const catalogo = catalogoDelServidor;

describe('la lógica del editor', () => {
  it('busca sin acentos y por trozos, en nombre, frase, pantalla o sección', () => {
    const s = lib.filtrar(catalogo, 'factur cola');
    const claves = s.flatMap(lib.clavesDeSeccion);
    expect(claves).toContain('facturas.cola');
    expect(claves).not.toContain('leads.view');
  });

  it('«Seleccionar todo» marca la sección menos lo bloqueado', () => {
    const fin = catalogo.secciones.find((x) => x.clave === 'finanzas');
    const claves = lib.clavesDeSeccion(fin);
    const v = lib.marcarTodas({}, claves, true, ['facturas.cola']);
    expect(lib.estadoDe(claves, v)).toBe('parcial');
    expect(v['facturas.cola']).toBeUndefined();
    expect(lib.estadoDe(claves, lib.marcarTodas(v, ['facturas.cola'], true))).toBe('todas');
  });

  it('avisa de lo que necesita otra cosa: editar sin ver', () => {
    const avisos = lib.avisosDeDependencias(catalogo, { 'leads.edit': true });
    expect(avisos).toEqual([expect.objectContaining({ clave: 'leads.edit', faltan: [{ clave: 'leads.view', nombre: 'Ver prospectos' }] })]);
  });
});

describe('<EditorDePermisos>', () => {
  it('pliega las secciones, y «Seleccionar todo» cambia todas las de la sección', () => {
    const onCambiar = vi.fn();
    render(<EditorDePermisos catalogo={catalogo} valores={{}} onCambiar={onCambiar} />);
    // Plegadas: se ve la sección, no sus casillas.
    expect(screen.getByText('Finanzas')).toBeTruthy();
    expect(screen.queryByText('Emitir desde la cola')).toBeNull();
    const seccion = screen.getByText('Finanzas').closest('section');
    fireEvent.click(within(seccion).getByLabelText('Seleccionar todo'));
    const marcado = onCambiar.mock.calls[0][0];
    expect(marcado['facturas.cola']).toBe(true);
    expect(marcado['leads.view']).toBeUndefined();
  });

  it('al buscar abre lo que encuentra', () => {
    render(<EditorDePermisos catalogo={catalogo} valores={{}} onCambiar={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Buscar un permiso'), { target: { value: 'liquidar' } });
    expect(screen.getByText('Liquidar comisiones')).toBeTruthy();
    expect(screen.queryByText('Prospectos')).toBeNull();
  });

  it('avisa de la dependencia y la marca con un clic', () => {
    const onCambiar = vi.fn();
    render(<EditorDePermisos catalogo={catalogo} valores={{ 'leads.edit': true }} onCambiar={onCambiar} />);
    expect(screen.getByText(/«Editar prospectos» necesita «Ver prospectos»/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Marcarlo' }));
    expect(onCambiar.mock.calls[0][0]['leads.view']).toBe(true);
  });

  it('en solo lectura no hay «Seleccionar todo» ni avisos', () => {
    render(<EditorDePermisos catalogo={catalogo} valores={{ 'leads.edit': true }} soloLectura />);
    expect(screen.queryByLabelText('Seleccionar todo')).toBeNull();
    expect(screen.queryByText(/necesita/)).toBeNull();
  });
});

describe('<PermisosDePersona>', () => {
  beforeEach(() => {
    api.getCatalogo.mockResolvedValue(catalogo);
    api.getFicha.mockResolvedValue({
      persona: { id: 7, nombre: 'Laura', email: 'l@x', role: 'gestor', roles_extra: [], active: true },
      mapa: { 'leads.view': true, 'diplomas.view': true },
      origenes: { 'leads.view': { tipo: 'rol', rol: 'gestor' }, 'diplomas.view': { tipo: 'excepcion' } },
      excepciones: { 'diplomas.view': true },
      rolAMedida: null,
      rolesAMedida: [],
      registro: [{ id: 1, cuando: '2026-10-21T10:00:00Z', quien_nombre: 'Diego', clave: 'diplomas.view', antes: 'como su rol (no)', despues: 'sí', origen: 'ficha_usuario' }],
      puedeEditar: true,
    });
    api.guardarExcepciones.mockResolvedValue({});
  });

  it('dice de dónde le viene cada permiso y enseña el historial', async () => {
    render(<PermisosDePersona userId={7} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Permisos de Laura')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Buscar un permiso'), { target: { value: 'ver diplomas' } });
    expect(screen.getByText('Excepción suya')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Buscar un permiso'), { target: { value: 'ver prospectos' } });
    expect(screen.getByText('Su rol: Gestora')).toBeTruthy();
    expect(screen.getByText(/Diego · diplomas.view: como su rol \(no\) → sí/)).toBeTruthy();
  });

  it('volver a «Como su rol» quita la excepción', async () => {
    render(<PermisosDePersona userId={7} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('Permisos de Laura')).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Buscar un permiso'), { target: { value: 'ver diplomas' } });
    const grupo = screen.getByRole('radiogroup', { name: 'Excepción para Ver diplomas' });
    fireEvent.click(within(grupo).getByRole('radio', { name: 'Como su rol' }));
    await waitFor(() => expect(api.guardarExcepciones).toHaveBeenCalledWith(7, { 'diplomas.view': null }));
  });
});
