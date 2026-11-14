// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  «Revertir» un diploma de «Emitidos, falta enviarlos al alumno» (#351).

  Diego, 03/11/2026, sobre un diploma emitido «con lo de Moodle»: «que en esta sección se
  puedan revertir, porque este, por ejemplo, tiene los módulos malos; reviértelo para que lo
  modifiquen».

  Lo que se fija:
   · el botón sale solo con el permiso, y solo en lo emitido desde el CRM (lo enviado ya no
     está en esta lista);
   · mientras el Certifex conectado no lo permita, sale desactivado y se dice por qué;
   · el diálogo explica que el número se anula y que al reemitir sale otro, pide el motivo
     (obligatorio) y manda número y motivo;
   · si el servidor dice que no, el diálogo sigue abierto con el mensaje;
   · lo revertido sale en «Aprobados sin diploma» con el número anulado;
   · prevención: «Aprobar y emitir» algo que saldría «Con lo de Moodle» lo avisa antes,
     con «Editar» a mano; lo que tiene programa, no.
*/

const datos = vi.hoisted(() => {
  const aprobada = { decision: { decision: 'aprobada', motivo: null, decididoPor: 'x', decididoEn: '2026-11-03T10:00:00Z', refExterna: null } };
  const fila = (id, nombre, extra = {}) => ({
    matriculaId: id, centro: 'ISEIH', titular: { nombre, email: `alumno${id}@prueba.test`, dni: '12345678Z' },
    curso: { ref: 12, nombre: 'Curso en Nutrición Terapéutica y Funcional' }, notaFinal: 8, umbral: 5, completado: true,
    actividades: { total: 4, calificadas: 4 }, propuesto: true, nexpediente: null,
    solicitud: { en: '2026-11-02T09:00:00Z', nombre }, decision: null, crm: null, edicion: null, firma: null,
    programa: null,
    programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Módulo uno' }] }, formacion: null, motivo: null, editado: false, elegida: false },
    ...extra,
  });
  const diploma = (nexpediente, alumno, extra = {}) => ({
    nexpediente, centro: 'ISEIH', alumno, titulacion: 'Curso en Nutrición', cursoRef: 12, emitidoEn: '2026-11-03T10:00:00Z',
    emitidaPor: 'Diego (CRM 360)', revocada: false, revocacion: null, verificarUrl: null, diplomaUrl: null, aviso: null, emitidoEnCrm: true, imprenta: true, ...extra,
  });
  const porAvisar = (id, nombre, exp, extra = {}, extraDiploma = {}) => fila(id, nombre, {
    ...aprobada, nexpediente: exp, diploma: diploma(exp, nombre, extraDiploma), programaCrm: undefined, ...extra,
  });
  return {
    estado: { conectado: true, nombre: 'CRM de prueba' },
    disponible: { disponible: true, motivo: null },
    pendientes: [
      fila(1, 'Ana Con Programa'),
      fila(2, 'Berta Con Moodle', { programaCrm: { programa: null, formacion: null, motivo: 'No hay una venta que encaje.' } }),
      fila(3, 'Carla Sin Modulos', { programaCrm: { programa: { horas: 100, modulos: [] }, formacion: null, motivo: null, editado: false, elegida: false } }),
      fila(4, 'Diana Elegida Sintemario', {
        edicion: { emailCrm: null, productoId: 77, programaEditado: null, por: 'x', en: '2026-11-12T10:00:00Z' },
        programaCrm: { programa: null, formacion: { id: 77, nombre: 'Programa sin temario', numModulos: null }, motivo: '«Programa sin temario» no tiene horas ni módulos en el CRM.', editado: false, elegida: true },
      }),
    ],
    porAvisar: [
      porAvisar(5, 'Eva Con Moodle', 'CEDIA-2026-000011-B5HQ'),
      porAvisar(6, 'Fran De Fuera', 'CEDIA-2026-000012-C6JQ', {}, { emitidaPor: 'admin@certifex.tech', emitidoEnCrm: false }),
    ],
    sinEmitir: [
      fila(8, 'Hugo Revertido', {
        ...aprobada,
        revertido: { nexpediente: 'CEDIA-2026-000009-X1YZ', motivo: 'Con lo de Moodle', por: 'ana@prueba.test', en: '2026-11-12T10:00:00Z' },
      }),
    ],
    toasts: [],
  };
});

vi.mock('@/shared/hooks/useToast', () => ({
  toast: (t) => { datos.toasts.push(t); },
  useToast: () => ({ toasts: [], addListener: () => () => {} }),
}));

vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: datos.estado }),
    centros: async () => ({ data: [{ codigo: 'ISEIH', nombre: 'ISEIH', moodleUrl: null, logo: null, activo: true, cursos: 1, matriculados: 3, porDecidir: 2, aprobadasSinEmitir: 1, rechazadas: 0, emitidas: 3 }] }),
    cursos: async () => ({ data: [] }),
    diploma: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 4, rechazadas: 0, vigentes: 2, revocados: 0, terminados: 0, porAvisar: 2, sinEmitir: 1, porEnviar: 2 } }),
    solicitudes: async () => ({ data: { filas: datos.pendientes, total: datos.pendientes.length, pagina: 1, tam: 50 } }),
    porAvisar: vi.fn(async () => ({ data: { porAvisar: datos.porAvisar, sinEmitir: datos.sinEmitir } })),
    // Por enlace (?exp=), un número revertido: Certifex lo da como anulado.
    diplomas: async (f) => ({ data: { filas: f?.q === 'CEDIA-2026-000009-X1YZ' ? [{
      nexpediente: 'CEDIA-2026-000009-X1YZ', centro: 'ISEIH', alumno: 'Hugo Revertido', titulacion: 'Curso', cursoRef: 12, emitidoEn: '2026-11-03T10:00:00Z',
      emitidaPor: 'Diego (CRM 360)', revocada: false, revocacion: null, verificarUrl: null, diplomaUrl: null, aviso: null, emitidoEnCrm: true,
      anulada: true, anulacion: { en: '2026-11-12T10:00:00Z', motivo: 'Con lo de Moodle', por: 'ana@prueba.test (CRM 360)', sustituidaPor: null, matriculaId: 8 },
    }] : [], total: 0, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    formaciones: vi.fn(async () => ({ data: { proyecto: { id: 3, nombre: 'ISEIH' }, motivo: null, formaciones: [] } })),
    revertirDisponible: vi.fn(async () => ({ data: datos.disponible })),
    revertir: vi.fn(async (nexpediente) => ({ data: { ok: true, nexpediente, anulada: { en: '2026-11-13T10:00:00Z', por: 'yo (CRM 360)', motivo: 'x' }, matriculaId: 5, registrado: true } })),
    firma: vi.fn(),
  },
}));

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { diplomasApi } = await import('@/modules/certifex/api/certifex.api');

beforeEach(() => {
  datos.disponible = { disponible: true, motivo: null };
  datos.toasts.length = 0;
  diplomasApi.revertir.mockClear();
  diplomasApi.revertirDisponible.mockClear();
  diplomasApi.porAvisar.mockClear();
});
afterEach(cleanup);

const abrir = (props = {}) => render(<MemoryRouter><CertifexDiplomasPage {...props} /></MemoryRouter>);
const filaDe = async (texto) => (await screen.findByText(texto)).closest('tr');
const MOTIVO = 'Se emitió con las actividades de Moodle';
/** «Revertir» de esa fila, en cuanto se sabe que Certifex lo permite. */
const pulsarRevertir = async (fila) => {
  const b = within(fila).getByRole('button', { name: /^Revertir / });
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
  return screen.findByRole('dialog', { name: /Revertir CEDIA-/ });
};

describe('«Revertir» en «Emitidos, falta enviarlos al alumno»', () => {
  it('con el permiso: en lo emitido desde el CRM sí; en lo de fuera, no', async () => {
    abrir({ puedeRevertir: true });
    const eva = await filaDe('Eva Con Moodle');
    const boton = within(eva).getByRole('button', { name: 'Revertir CEDIA-2026-000011-B5HQ' });
    await waitFor(() => expect(boton.disabled).toBe(false));
    const fran = await filaDe('Fran De Fuera');
    expect(within(fran).queryByRole('button', { name: /^Revertir / })).toBeNull();
  });

  it('sin el permiso, no sale, y ni se pregunta si Certifex lo permite', async () => {
    abrir({});
    await filaDe('Eva Con Moodle');
    expect(screen.queryAllByRole('button', { name: /^Revertir / })).toHaveLength(0);
    expect(diplomasApi.revertirDisponible).not.toHaveBeenCalled();
  });

  it('en solo lectura tampoco, aunque traiga el permiso', async () => {
    abrir({ puedeRevertir: true, soloLectura: true });
    await filaDe('Eva Con Moodle');
    expect(screen.queryAllByRole('button', { name: /^Revertir / })).toHaveLength(0);
  });

  it('con un Certifex que aún no lo permite: desactivado, y se dice por qué', async () => {
    datos.disponible = { disponible: false, motivo: 'El Certifex conectado todavía no permite revertir diplomas (falta desplegar su migración 0045 y POST /revertir).' };
    abrir({ puedeRevertir: true });
    const eva = await filaDe('Eva Con Moodle');
    const b = within(eva).getByRole('button', { name: /^Revertir / });
    await waitFor(() => expect(b.getAttribute('title')).toMatch(/0045/));
    expect(b.disabled).toBe(true);
  });

  it('el diálogo dice que el número se anula y que sale otro; pide el motivo y manda número y motivo', async () => {
    abrir({ puedeRevertir: true });
    const dialogo = await pulsarRevertir(await filaDe('Eva Con Moodle'));
    expect(within(dialogo).getByText(/El número CEDIA-2026-000011-B5HQ se anula/)).toBeTruthy();
    expect(within(dialogo).getByText(/saldrá con otro número/)).toBeTruthy();
    expect(within(dialogo).getByText(/Aprobados sin diploma/)).toBeTruthy();
    const confirmar = within(dialogo).getByRole('button', { name: 'Revertir' });
    // Sin motivo, no se puede.
    expect(confirmar.disabled).toBe(true);
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: `  ${MOTIVO}  ` } });
    expect(confirmar.disabled).toBe(false);
    const cargasAntes = diplomasApi.porAvisar.mock.calls.length;
    fireEvent.click(confirmar);
    await waitFor(() => expect(diplomasApi.revertir).toHaveBeenCalledTimes(1));
    expect(diplomasApi.revertir.mock.calls[0]).toEqual(['CEDIA-2026-000011-B5HQ', MOTIVO]);
    await waitFor(() => expect(datos.toasts.at(-1)).toMatchObject({ title: 'Diploma revertido' }));
    expect(datos.toasts.at(-1).description).toMatch(/otro número/);
    // Se cierra y se recarga: la fila pasa a «Aprobados sin diploma».
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Revertir CEDIA-/ })).toBeNull());
    await waitFor(() => expect(diplomasApi.porAvisar.mock.calls.length).toBeGreaterThan(cargasAntes));
  });

  it('si el servidor dice que no, el diálogo sigue abierto con el mensaje', async () => {
    diplomasApi.revertir.mockRejectedValueOnce(new Error('Ya se ha enviado al alumno: no se revierte. Si está mal, hay que revocarlo.'));
    abrir({ puedeRevertir: true });
    const dialogo = await pulsarRevertir(await filaDe('Eva Con Moodle'));
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: MOTIVO } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Revertir' }));
    expect(await within(dialogo).findByRole('alert')).toBeTruthy();
    expect(within(dialogo).getByText(/Ya se ha enviado al alumno/)).toBeTruthy();
  });

  it('si Certifex lo revirtió pero el CRM no lo apuntó, se dice', async () => {
    diplomasApi.revertir.mockResolvedValueOnce({ data: { ok: true, nexpediente: 'CEDIA-2026-000011-B5HQ', anulada: { en: 'x', por: 'y', motivo: 'z' }, matriculaId: 5, registrado: false, aviso: 'Revertido en Certifex, pero el CRM no lo pudo apuntar.' } });
    abrir({ puedeRevertir: true });
    const dialogo = await pulsarRevertir(await filaDe('Eva Con Moodle'));
    fireEvent.change(within(dialogo).getByLabelText(/Motivo/), { target: { value: MOTIVO } });
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Revertir' }));
    await waitFor(() => expect(datos.toasts.at(-1)).toMatchObject({ title: 'Revertido, con un aviso', variant: 'destructive' }));
  });
});

describe('un número anulado abierto por enlace', () => {
  it('dice que está anulado (quién, por qué) y no abre la ficha ni ofrece «Enviar»', async () => {
    render(<MemoryRouter initialEntries={['/?pestana=emitidos&exp=CEDIA-2026-000009-X1YZ']}><CertifexDiplomasPage puedeRevertir /></MemoryRouter>);
    await waitFor(() => expect(datos.toasts.some((t) => /CEDIA-2026-000009-X1YZ está anulado/.test(t.title))).toBe(true));
    const t = datos.toasts.find((x) => /está anulado/.test(x.title));
    expect(t.description).toMatch(/ana@prueba\.test.*Con lo de Moodle/);
    expect(t.description).toMatch(/Aprobados sin diploma/);
    expect(screen.queryByRole('button', { name: /Enviar diploma al alumno/ })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('«Aprobados sin diploma»: lo revertido', () => {
  it('dice qué número se anuló', async () => {
    abrir({ puedeRevertir: true });
    expect(await screen.findByText(/Revertido · CEDIA-2026-000009-X1YZ anulado/)).toBeTruthy();
  });
});

describe('prevención: «Aprobar y emitir» algo que saldría «Con lo de Moodle»', () => {
  it('lo avisa antes, y «Editar» abre la revisión de esa solicitud', async () => {
    abrir({});
    const berta = await filaDe('Berta Con Moodle');
    fireEvent.click(within(berta).getByRole('button', { name: /Aprobar y emitir/ }));
    expect(await screen.findByText('Saldrá «Con lo de Moodle»')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Editar los datos de Berta Con Moodle antes de emitir/ }));
    expect(await screen.findByRole('dialog', { name: 'Revisar datos antes de aprobar' })).toBeTruthy();
  });

  it('también con las horas pero sin módulos (saldrían los de Moodle)', async () => {
    abrir({});
    const carla = await filaDe('Carla Sin Modulos');
    fireEvent.click(within(carla).getByRole('button', { name: /Aprobar y emitir/ }));
    expect(await screen.findByText('Saldrá «Con lo de Moodle»')).toBeTruthy();
    expect(screen.getByText(/No tiene el temario de la formación vendida/)).toBeTruthy();
  });

  it('lo que tiene programa del CRM, sin aviso', async () => {
    abrir({});
    const ana = await filaDe('Ana Con Programa');
    fireEvent.click(within(ana).getByRole('button', { name: /Aprobar y emitir/ }));
    await screen.findByText(/Se aprueban y se emite su diploma/);
    expect(screen.queryByText(/«Con lo de Moodle»/)).toBeNull();
  });

  it('con una formación elegida a mano sin temario, dice que NO se emitirá, no que saldrá sin temario', async () => {
    abrir({});
    const diana = await filaDe('Diana Elegida Sintemario');
    fireEvent.click(within(diana).getByRole('button', { name: /Aprobar y emitir/ }));
    expect(await screen.findByText('No se emitirá')).toBeTruthy();
    expect(screen.queryByText(/Saldrá sin el temario oficial|Saldrá «Con lo de Moodle»/)).toBeNull();
  });
});
