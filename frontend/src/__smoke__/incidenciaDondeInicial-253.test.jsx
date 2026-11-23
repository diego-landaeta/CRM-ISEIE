// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno y la limpieza entre pruebas se ponen aquí.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import IncidenciaDialog from '@/modules/incidencias/components/IncidenciaDialog';
import { incidenciasApi } from '@/modules/incidencias/api/incidencias.api';

afterEach(cleanup);

/**
 * Incidencias (#253): una nueva sale con el campus o la empresa de arriba.
 *
 * Visto en la prueba a mano (02/11): con Psiko arriba, «Campus o empresa» salía
 * en «Ninguno (todo el CRM)», y la incidencia no aparecía en la lista de Psiko
 * que se estaba mirando.
 *
 * PR #612 (Diego): «todo el CRM» solo para superadmin y soporte. Para el resto,
 * con «Todos» arriba no sale nada elegido y obliga a elegir.
 */

const campus = [
  { id: 1, nombre: 'Psiko Aprende', sociedad_emisora_id: 10, sociedad_nombre: 'CEDIA' },
  { id: 2, nombre: 'ISEIH', sociedad_emisora_id: null },
];

function abrir(props = {}) {
  render(
    <MemoryRouter>
      <IncidenciaDialog personas={[]} campus={campus} yo={1} onCerrar={() => {}} onGuardada={() => {}} {...props} />
    </MemoryRouter>,
  );
  return document.getElementById('inc-donde').textContent;
}

describe('el campus de una incidencia nueva', () => {
  it('con un campus arriba, sale ese campus', () => {
    expect(abrir({ dondeInicial: 'p:1' })).toContain('Campus · Psiko Aprende');
  });

  it('con una empresa arriba, sale esa empresa', () => {
    expect(abrir({ dondeInicial: 'e:10' })).toContain('Empresa · CEDIA');
  });

  it('un admin con «Todos» arriba: no sale «Ninguno», sale «Elige…»', () => {
    const texto = abrir({ dondeInicial: '' });
    expect(texto).toContain('Elige…');
    expect(texto).not.toContain('Ninguno');
  });

  it('un campus que no es suyo no se pone: «Elige…»', () => {
    expect(abrir({ dondeInicial: 'p:99' })).toContain('Elige…');
  });

  it('el superadmin o soporte con «Todos» arriba: «Ninguno (todo el CRM)»', () => {
    expect(abrir({ dondeInicial: '', veTodo: true })).toContain('Ninguno (todo el CRM)');
  });

  it('al editar una que ya existe, manda la suya y no la de arriba', () => {
    const inc = { id: 5, projectId: 2, tipos: ['capa8'], quePaso: 'x', estado: 'open', gravedad: 'medium', ocurrioAt: '2026-10-06T10:00:00Z' };
    expect(abrir({ incidencia: inc, dondeInicial: 'p:1' })).toContain('Campus · ISEIH');
  });

  it('un admin no la apunta sin campus: avisa y no la manda', () => {
    const crear = vi.spyOn(incidenciasApi, 'crear');
    abrir({ dondeInicial: '' });
    fireEvent.change(document.getElementById('inc-que'), { target: { value: 'Se dio de alta en otro campus' } });
    fireEvent.click(screen.getByRole('button', { name: /Apuntar incidencia/ }));
    expect(screen.getByText('Elige el campus o la empresa')).toBeTruthy();
    expect(crear).not.toHaveBeenCalled();
    // El aviso está arriba y el botón abajo: se lleva al campus para que se vea.
    expect(document.activeElement).toBe(document.getElementById('inc-donde'));
    crear.mockRestore();
  });

  it('sin ningún tipo, lleva al primer botón de «Tipo», que también está arriba', () => {
    const crear = vi.spyOn(incidenciasApi, 'crear');
    abrir({ dondeInicial: 'p:1' });
    fireEvent.change(document.getElementById('inc-que'), { target: { value: 'Se dio de alta en otro campus' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capa 8' }));
    fireEvent.click(screen.getByRole('button', { name: /Apuntar incidencia/ }));
    expect(screen.getByText('Elige al menos un tipo')).toBeTruthy();
    expect(crear).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.getElementById('inc-tipos').querySelector('button'));
    crear.mockRestore();
  });

  it('en solo lectura, una sin campus dice «todo el CRM», no «Elige…»', () => {
    const inc = { id: 6, projectId: null, sociedadId: null, tipos: ['capa8'], quePaso: 'x', estado: 'open', gravedad: 'medium', ocurrioAt: '2026-10-06T10:00:00Z', adjuntos: [] };
    expect(abrir({ incidencia: inc, soloLectura: true })).toContain('Ninguno (todo el CRM)');
  });
});
