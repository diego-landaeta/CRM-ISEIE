// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #351, punto 3 («Prevención»), también en Certificaciones › Emisiones: «Antes de "Aprobar y
  emitir" algo que va a salir "Con lo de Moodle", un aviso que lo diga y ofrezca "Editar" para
  elegir la formación vendida». Emisiones tiene sus propios «Aprobar y emitir» y «Emitir».

  Lo que se fija:
   · lo que no tiene el temario oficial (sin programa del CRM, o con horas y sin módulos) se
     avisa como «Con lo de Moodle», con «Editar», que abre esa solicitud en Diplomas;
   · lo revisado a mano que aun así no tiene programa, como «No se emitirá»;
   · lo que tiene programa, sin aviso; y sin el dato (no se pudo saber), tampoco.
*/

const fila = (id, nombre, extra = {}) => ({
  matriculaId: id, centro: 'PSIKO', titular: { nombre, email: `alumno${id}@prueba.test`, dni: '12345678Z' },
  curso: { ref: 34, nombre: 'Curso en Nutrición Terapéutica y Funcional' }, notaFinal: 8, umbral: 5, completado: true,
  actividades: { total: 4, calificadas: 4 }, entregas: null, terminado: true, propuesto: true, nexpediente: null,
  solicitud: null, programa: null, decision: null, crm: null, edicion: null,
  programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Bases' }] }, formacion: null, motivo: null, editado: false, elegida: false },
  ...extra,
});
const FILAS = [
  fila(1, 'Ana Con Programa'),
  fila(2, 'Berta Con Moodle', { programaCrm: { programa: null, formacion: null, motivo: 'No tiene ninguna venta en Psiko.' } }),
  fila(3, 'Carla Sin Modulos', { programaCrm: { programa: { horas: 100, modulos: [] }, formacion: null, motivo: null, editado: false, elegida: false } }),
  fila(4, 'Diana Revisada Sinprograma', {
    edicion: { emailCrm: null, productoId: 77, programaEditado: null, por: 'x', en: '2026-11-12T10:00:00Z' },
    programaCrm: { programa: null, formacion: { id: 77, nombre: 'Sin temario', numModulos: null }, motivo: '«Sin temario» no tiene horas ni módulos.', editado: false, elegida: true },
  }),
  // Sin el dato (el servidor no pudo saberlo): no se avisa de nada.
  fila(5, 'Elena Sin Dato', { programaCrm: undefined }),
];

vi.mock('@/shared/hooks/useToast', () => ({ toast: () => {}, useToast: () => ({ toasts: [], addListener: () => () => {} }) }));
vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'PSIKO', nombre: 'Psiko Aprende', moodleUrl: null, logo: null, activo: true, cursos: 1, matriculados: 5, porDecidir: 5, aprobadasSinEmitir: 0, rechazadas: 0, emitidas: 0 }] }),
    cursos: async () => ({ data: [] }),
    listar: vi.fn(async () => ({ data: { filas: FILAS, total: FILAS.length, pagina: 1, tam: 50 } })),
  },
  diplomasApi: { pedir: vi.fn() },
}));

const { default: CertifexEmisionesPage } = await import('@/modules/certifex/pages/CertifexEmisionesPage');

afterEach(cleanup);

/** Elige esas filas y pulsa «Aprobar y emitir»: devuelve el diálogo de confirmación. */
async function aprobarYEmitir(nombres) {
  render(<MemoryRouter><CertifexEmisionesPage embebida /></MemoryRouter>);
  await screen.findByText('Ana Con Programa');
  for (const n of nombres) fireEvent.click(screen.getByRole('checkbox', { name: `Elegir a ${n}` }));
  fireEvent.click(screen.getByRole('button', { name: /^Aprobar y emitir \(/ }));
  return screen.findByRole('dialog');
}

describe('#351 prevención en Emisiones: antes de «Aprobar y emitir»', () => {
  it('avisa de lo que saldría «Con lo de Moodle» (sin programa, o sin módulos), con «Editar» en Diplomas', async () => {
    const d = await aprobarYEmitir(['Berta Con Moodle', 'Carla Sin Modulos']);
    expect(within(d).getByText('2 saldrán «Con lo de Moodle»')).toBeTruthy();
    expect(within(d).getByText(/elige la formación con «Editar»/)).toBeTruthy();
    const editar = within(d).getByRole('link', { name: /Editar los datos de Berta Con Moodle en Diplomas/ });
    expect(editar.getAttribute('href')).toMatch(/clientes\/matriculas\/diplomas\?buscar=alumno2%40prueba\.test$/);
    expect(editar.getAttribute('target')).toBe('_blank');
    expect(within(d).getByRole('link', { name: /Editar los datos de Carla Sin Modulos/ })).toBeTruthy();
  });

  it('lo revisado a mano sin programa: «No se emitirá», no «saldrá con lo de Moodle»', async () => {
    const d = await aprobarYEmitir(['Diana Revisada Sinprograma']);
    expect(within(d).getByText('No se emitirá')).toBeTruthy();
    expect(within(d).queryByText(/Con lo de Moodle/)).toBeNull();
    expect(within(d).getByRole('link', { name: /Editar los datos de Diana Revisada Sinprograma/ })).toBeTruthy();
  });

  it('lo que tiene programa del CRM, o del que no se sabe, sin aviso', async () => {
    const d = await aprobarYEmitir(['Ana Con Programa', 'Elena Sin Dato']);
    expect(within(d).getByText(/Se aprueban y se emiten en Certifex/)).toBeTruthy();
    expect(within(d).queryByText(/Con lo de Moodle|No se emitirá/)).toBeNull();
  });
});
