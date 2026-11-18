// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #351, punto 3 («Prevención»), también en Certificaciones › Emisiones: «Antes de "Aprobar y
  emitir" algo que va a salir "Con lo de Moodle", un aviso que lo diga y ofrezca "Editar" para
  elegir la formación vendida». Emisiones tiene sus propios «Aprobar y emitir» y «Emitir».

  Lo que se fija:
   · lo que no tiene el temario oficial (sin programa del CRM, o con horas y sin módulos) se
     avisa como «Con lo de Moodle», con «Editar», que abre aquí mismo la revisión (también
     de una matrícula que el alumno no ha pedido: sin el nombre, que es de la solicitud);
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
  fila(1, 'Ana Con Programa', {
    // Su diploma se revirtió (#351): lo dice la fila.
    revertido: { nexpediente: 'PSIKO-2026-000009-X1YZ', motivo: 'Con lo de Moodle', por: 'ana@prueba.test', en: '2026-11-12T10:00:00Z' },
  }),
  fila(2, 'Berta Con Moodle', { programaCrm: { programa: null, formacion: null, motivo: 'No tiene ninguna venta en Psiko.' } }),
  fila(3, 'Carla Sin Modulos', { programaCrm: { programa: { horas: 100, modulos: [] }, formacion: null, motivo: null, editado: false, elegida: false } }),
  fila(4, 'Diana Revisada Sinprograma', {
    edicion: { emailCrm: null, productoId: 77, programaEditado: null, por: 'x', en: '2026-11-12T10:00:00Z' },
    programaCrm: { programa: null, formacion: { id: 77, nombre: 'Sin temario', numModulos: null }, motivo: '«Sin temario» no tiene horas ni módulos.', editado: false, elegida: true },
  }),
  // Sin el dato (el servidor no pudo saberlo): no se avisa de nada.
  fila(5, 'Elena Sin Dato', { programaCrm: undefined }),
  // Con solicitud (lo pidió el alumno) y sin programa.
  fila(6, 'Fran Con Solicitud', {
    solicitud: { en: '2026-11-02T09:00:00Z', nombre: 'Fran Con Solicitud', nombreAlumno: 'Fran Con Solicitud', revisado: null },
    programaCrm: { programa: null, formacion: null, motivo: 'No tiene ninguna venta en Psiko.' },
  }),
];
const editar = vi.hoisted(() => ({ llamadas: [] }));

vi.mock('@/shared/hooks/useToast', () => ({ toast: () => {}, useToast: () => ({ toasts: [], addListener: () => () => {} }) }));
vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'PSIKO', nombre: 'Psiko Aprende', moodleUrl: null, logo: null, activo: true, cursos: 1, matriculados: 5, porDecidir: 5, aprobadasSinEmitir: 0, rechazadas: 0, emitidas: 0 }] }),
    cursos: async () => ({ data: [] }),
    listar: vi.fn(async () => ({ data: { filas: FILAS, total: FILAS.length, pagina: 1, tam: 50 } })),
  },
  diplomasApi: {
    pedir: vi.fn(),
    formaciones: async () => ({ data: { proyecto: { id: 1, nombre: 'Psiko' }, motivo: null, formaciones: [
      { id: 7, nombre: 'Máster en Psicología Clínica', horas: 100, modulos: [{ titulo: 'Módulo 1', horas: 100 }], activa: true },
    ] } }),
    editar: async (cambios) => { editar.llamadas.push(cambios); return { data: { matriculaId: cambios.matriculaId } }; },
  },
}));

const { default: CertifexEmisionesPage } = await import('@/modules/certifex/pages/CertifexEmisionesPage');
const { emisionesApi } = await import('@/modules/certifex/api/certifex.api');

afterEach(cleanup);

/** Elige esas filas y pulsa «Aprobar y emitir»: devuelve el diálogo de confirmación. */
async function aprobarYEmitir(nombres, props = { puedeEditar: true }) {
  render(<MemoryRouter><CertifexEmisionesPage embebida {...props} /></MemoryRouter>);
  await screen.findByText('Ana Con Programa');
  for (const n of nombres) fireEvent.click(screen.getByRole('checkbox', { name: `Elegir a ${n}` }));
  fireEvent.click(screen.getByRole('button', { name: /^Aprobar y emitir \(/ }));
  return screen.findByRole('dialog');
}

describe('#351 · una matrícula revertida lo dice en Emisiones', () => {
  it('«Revertido · nº anulado», con quién y por qué al pasar por encima', async () => {
    render(<MemoryRouter><CertifexEmisionesPage embebida puedeEditar /></MemoryRouter>);
    const filaAna = (await screen.findByText('Ana Con Programa')).closest('tr');
    const marca = within(filaAna).getByText('PSIKO-2026-000009-X1YZ').closest('div');
    expect(marca.textContent).toMatch(/Revertido · PSIKO-2026-000009-X1YZ anulado/);
    expect(marca.getAttribute('title')).toMatch(/ana@prueba\.test.*Con lo de Moodle/);
    // Las demás, sin marca.
    expect(within((await screen.findByText('Berta Con Moodle')).closest('tr')).queryByText(/Revertido ·/)).toBeNull();
  });
});

describe('#351 prevención en Emisiones: antes de «Aprobar y emitir»', () => {
  it('avisa de lo que saldría «Con lo de Moodle» (sin programa, o sin módulos), con «Editar»', async () => {
    const d = await aprobarYEmitir(['Berta Con Moodle', 'Carla Sin Modulos']);
    expect(within(d).getByText('2 saldrán «Con lo de Moodle»')).toBeTruthy();
    expect(within(d).getByText(/elige la formación con «Editar»/)).toBeTruthy();
    expect(within(d).getByRole('button', { name: /Editar los datos de Berta Con Moodle antes de emitir/ })).toBeTruthy();
    expect(within(d).getByRole('button', { name: /Editar los datos de Carla Sin Modulos antes de emitir/ })).toBeTruthy();
  });

  it('«Editar» abre aquí la revisión de una matrícula que no pidió el alumno: solo la formación vendida (ni nombre, ni DNI, ni correo); guarda y recarga', async () => {
    editar.llamadas.length = 0;
    const d = await aprobarYEmitir(['Berta Con Moodle']);
    fireEvent.click(within(d).getByRole('button', { name: /Editar los datos de Berta Con Moodle antes de emitir/ }));
    const r = await screen.findByRole('dialog', { name: 'Revisar datos antes de aprobar' });
    expect(within(r).getByText(/no ha pedido el diploma: sale el nombre de Moodle/)).toBeTruthy();
    expect(within(r).queryByLabelText(/^Nombre para el diploma/)).toBeNull();
    // Sin solicitud, el DNI y el correo no se editan desde aquí (7.ª auditoría).
    expect(within(r).queryByPlaceholderText('Ej.: 12345678Z')).toBeNull();
    expect(within(r).queryByText('Correo del alumno en el CRM')).toBeNull();
    const cargasAntes = emisionesApi.listar.mock.calls.length;
    fireEvent.click(await within(r).findByRole('combobox', { name: 'Formación vendida' }));
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Máster en Psicología Clínica/ }));
    fireEvent.click(within(r).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(editar.llamadas).toHaveLength(1));
    // Sin solicitud: el campus y el correo, para que el servidor la encuentre (no se guardan).
    expect(editar.llamadas[0]).toEqual({ matriculaId: 2, productoId: 7, centro: 'PSIKO', q: 'alumno2@prueba.test' });
    await waitFor(() => expect(emisionesApi.listar.mock.calls.length).toBeGreaterThan(cargasAntes));
    // Vuelve a la confirmación del mismo lote, con lo elegido intacto.
    const otra = await screen.findByRole('dialog', { name: /Aprobar y emitir 1/ });
    expect(within(otra).getByText('Saldrá «Con lo de Moodle»')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Elegir a Berta Con Moodle' }).checked).toBe(true);
  });

  it('cancelar la revisión vuelve a la confirmación', async () => {
    const d = await aprobarYEmitir(['Berta Con Moodle']);
    fireEvent.click(within(d).getByRole('button', { name: /Editar los datos de Berta Con Moodle antes de emitir/ }));
    const r = await screen.findByRole('dialog', { name: 'Revisar datos antes de aprobar' });
    fireEvent.click(within(r).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('dialog', { name: /Aprobar y emitir 1/ })).toBeTruthy();
  });

  it('sin el permiso de emitir (el que pide guardar), no hay «Editar»: se dice quién lo revisa', async () => {
    const d = await aprobarYEmitir(['Berta Con Moodle'], {});
    expect(within(d).getByText('Saldrá «Con lo de Moodle»')).toBeTruthy();
    expect(within(d).queryByRole('button', { name: /Editar los datos/ })).toBeNull();
    expect(within(d).getByText('Lo revisa quien emite diplomas.')).toBeTruthy();
  });

  it('con solicitud, la revisión sí deja tocar el nombre', async () => {
    const d = await aprobarYEmitir(['Fran Con Solicitud']);
    fireEvent.click(within(d).getByRole('button', { name: /Editar los datos de Fran Con Solicitud antes de emitir/ }));
    const r = await screen.findByRole('dialog', { name: 'Revisar datos antes de aprobar' });
    expect(within(r).getByDisplayValue('Fran Con Solicitud')).toBeTruthy();
    expect(within(r).queryByText(/no ha pedido el diploma/)).toBeNull();
  });

  it('lo revisado a mano sin programa: «No se emitirá», no «saldrá con lo de Moodle»', async () => {
    const d = await aprobarYEmitir(['Diana Revisada Sinprograma']);
    expect(within(d).getByText('No se emitirá')).toBeTruthy();
    expect(within(d).queryByText(/Con lo de Moodle/)).toBeNull();
    expect(within(d).getByRole('button', { name: /Editar los datos de Diana Revisada Sinprograma/ })).toBeTruthy();
  });

  it('lo que tiene programa del CRM, o del que no se sabe, sin aviso', async () => {
    const d = await aprobarYEmitir(['Ana Con Programa', 'Elena Sin Dato']);
    expect(within(d).getByText(/Se aprueban y se emiten en Certifex/)).toBeTruthy();
    expect(within(d).queryByText(/Con lo de Moodle|No se emitirá/)).toBeNull();
  });
});
