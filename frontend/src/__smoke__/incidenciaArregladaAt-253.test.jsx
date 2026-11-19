// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

/**
 * Incidencias (#253): «Cuándo se arregló» se puede borrar.
 *
 * Auditoría del 02/11: al vaciar el campo no se mandaba nada y se quedaba la
 * fecha de antes. Si nunca tuvo fecha, sigue sin mandarse (al cerrarla la pone
 * el servidor).
 */

const editar = vi.fn();
vi.mock('@/modules/incidencias/api/incidencias.api', async (original) => ({
  ...(await original()),
  incidenciasApi: { editar: (...a) => editar(...a), subirAdjunto: vi.fn() },
}));

const { default: IncidenciaDialog } = await import('@/modules/incidencias/components/IncidenciaDialog');

// Con campus: sin él, un admin no la guarda (PR #612), y aquí se mira otra cosa.
const base = { id: 7, projectId: 1, sociedadId: null, tipos: ['capa8'], quePaso: 'Se borró un prospecto', estado: 'resolved', gravedad: 'medium', ocurrioAt: '2026-10-06T10:00:00Z', adjuntos: [] };

async function guardarCon(incidencia) {
  render(
    <MemoryRouter>
      <IncidenciaDialog incidencia={incidencia} personas={[]} campus={[]} yo={1} onCerrar={() => {}} onGuardada={() => {}} />
    </MemoryRouter>,
  );
  fireEvent.change(document.getElementById('inc-arreglo-cuando'), { target: { value: '' } });
  fireEvent.submit(document.querySelector('form'));
  await waitFor(() => expect(editar).toHaveBeenCalled());
  return editar.mock.calls[0][1];
}

// Auditoría del 02/11: la pista de «Su número (id)» seguía diciendo «búscala».
describe('la pista de «sobre qué» de una factura o un usuario', () => {
  const abrirCon = (extra) => {
    render(
      <MemoryRouter>
        <IncidenciaDialog incidencia={{ ...base, arregladaAt: null, ...extra }} personas={[]} campus={[]} yo={1} onCerrar={() => {}} onGuardada={() => {}} />
      </MemoryRouter>,
    );
    return document.body.textContent;
  };

  it('la factura con su venta: «Abre la venta de esa factura»', () => {
    expect(abrirCon({ entidadTipo: 'factura', entidadId: 86, entidadVentaId: 569 })).toContain('Abre la venta de esa factura.');
  });

  it('el usuario de sus campus: «Se abre Configuración › Usuarios»', () => {
    expect(abrirCon({ entidadTipo: 'usuario', entidadId: 7, entidadNombre: 'Laura' })).toContain('Se abre Configuración › Usuarios: búscalo allí.');
  });

  it('sin lo que da el servidor (de otra empresa): su pantalla', () => {
    expect(abrirCon({ entidadTipo: 'factura', entidadId: 86, entidadVentaId: null })).toContain('Se abre Facturas: búscala con este número.');
  });

  // Auditoría del 03/11: a la gestora (sin `users.view`) le decía «búscala».
  it('el usuario sin nombre (otra empresa, o la gestora): «Se abre Configuración»', () => {
    const texto = abrirCon({ entidadTipo: 'usuario', entidadId: 7, entidadNombre: null });
    expect(texto).toContain('Se abre Configuración › Usuarios');
    expect(texto).not.toContain('búscala con este número');
  });

  // Auditoría del 03/11: lo que no estaba probado.
  it('el enlace lleva de verdad a la venta', () => {
    abrirCon({ entidadTipo: 'factura', entidadId: 86, entidadVentaId: 569 });
    expect(document.querySelector('a[aria-label="Abrir la ficha"]').getAttribute('href')).toBe('/ventas/569');
  });

  it('si se cambia el número, la venta de antes ya no vale: a su pantalla', () => {
    abrirCon({ entidadTipo: 'factura', entidadId: 86, entidadVentaId: 569 });
    fireEvent.change(document.getElementById('inc-entidad-id'), { target: { value: '87' } });
    expect(document.body.textContent).toContain('Se abre Facturas: búscala con este número.');
    expect(document.querySelector('a[aria-label="Abrir la ficha"]').getAttribute('href')).toBe('/accounting/facturas');
  });
});

describe('«Cuándo se arregló» al editar', () => {
  beforeEach(() => {
    editar.mockReset();
    editar.mockResolvedValue({ success: true, data: base });
  });

  it('si tenía fecha y se vacía, se manda el vacío', async () => {
    const datos = await guardarCon({ ...base, arregladaAt: '2026-10-20T10:00:00Z' });
    expect(datos).toHaveProperty('arregladaAt', null);
  });

  it('si nunca tuvo fecha, no se manda: la pone el servidor al cerrarla', async () => {
    const datos = await guardarCon({ ...base, arregladaAt: null });
    expect(datos).not.toHaveProperty('arregladaAt');
  });
});
