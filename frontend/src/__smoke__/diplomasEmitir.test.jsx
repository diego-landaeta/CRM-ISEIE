// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Emitir diplomas sin ser admin («Diplomas (Certifex) · Emitir»), gemela de la de MultiCRM.

  Diego, 22/10/2026: «que Dayana pueda emitir, no la dejan; puede hacerlo». Con el
  permiso de emitir (la misma clave en los dos CRM), la pantalla Diplomas deja hacer el recorrido de emitir y esconde
  lo que sigue siendo de administración.

  Lo que se fija:
   · sale todo lo de emitir: «Nuevo diploma», «Aprobar y emitir», «Editar», «Sin DNI ·
     Poner», el reintento de «Aprobados sin diploma», «Enviar diploma al alumno» y las
     casillas para hacerlo en bloque;
   · no sale lo de administración: «Rechazar» (en la fila y en bloque), el aviso de
     rechazo, «Corregir nombre», «Revocar» ni el A3 de imprenta;
   · la entrada «Diplomas» del menú se ve también solo con el permiso de emitir.
*/

const datos = vi.hoisted(() => {
  const fila = (id, nombre, dni, extra = {}) => ({
    matriculaId: id, centro: 'ICTESS', titular: { nombre, email: `alumno${id}@prueba.test`, dni },
    curso: { ref: 12, nombre: 'Diplomado en Prueba' }, notaFinal: 8, umbral: 5, completado: true,
    actividades: { total: 4, calificadas: 4 }, propuesto: true, nexpediente: null,
    solicitud: { en: '2026-10-20T09:00:00Z', nombre }, decision: null, crm: null, edicion: null, firma: null,
    programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Módulo uno' }] }, formacion: null, motivo: null, editado: false, elegida: false },
    ...extra,
  });
  const aprobada = { decision: { decision: 'aprobada', motivo: null, decididoPor: 'x', decididoEn: '2026-10-20T10:00:00Z', refExterna: null } };
  const rechazada = { decision: { decision: 'rechazada', motivo: 'No pagó', decididoPor: 'x', decididoEn: '2026-10-20T10:00:00Z', refExterna: null } };
  const diploma = (nexpediente, alumno, extra = {}) => ({
    nexpediente, centro: 'ICTESS', alumno, titulacion: 'Diplomado en Prueba', cursoRef: 12, emitidoEn: '2026-10-20T10:00:00Z',
    emitidaPor: 'Dayana (CRM ISEIE)', revocada: false, revocacion: null, verificarUrl: `https://certifex.test/c/${nexpediente}`,
    diplomaUrl: null, aviso: null, emitidoEnCrm: true, imprenta: true, ...extra,
  });
  return {
    pendientes: [fila(1, 'Ana Con Documento', '12345678Z'), fila(2, 'Luis Sin Documento', null)],
    rechazadas: [fila(3, 'Pepa Rechazada', '12345678Z', rechazada)],
    sinEmitir: [fila(4, 'Olga Aprobada', 'X1234567L', aprobada)],
    porAvisar: [fila(5, 'Eva Por Avisar', 'Y1234567L', { ...aprobada, nexpediente: 'ICTESS-2026-000005-AAAA', diploma: diploma('ICTESS-2026-000005-AAAA', 'Eva Por Avisar') })],
    diplomas: [diploma('ICTESS-2026-000009-BBBB', 'Rosa Emitida')],
  };
});

vi.mock('@/shared/hooks/useToast', () => ({
  toast: () => {},
  useToast: () => ({ toasts: [], addListener: () => () => {} }),
}));

vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'ICTESS', nombre: 'ICTESS' }] }),
    cursos: async () => ({ data: [] }),
    diploma: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 2, rechazadas: 1, vigentes: 1, revocados: 0, terminados: 0, porAvisar: 1, sinEmitir: 1, porEnviar: 1 } }),
    solicitudes: async (f) => ({ data: f?.estado === 'rechazada'
      ? { filas: datos.rechazadas, total: datos.rechazadas.length, pagina: 1, tam: 50 }
      : { filas: datos.pendientes, total: datos.pendientes.length, pagina: 1, tam: 50 } }),
    porAvisar: async () => ({ data: { porAvisar: datos.porAvisar, sinEmitir: datos.sinEmitir } }),
    diplomas: async () => ({ data: { filas: datos.diplomas, total: datos.diplomas.length, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    formaciones: async () => ({ data: { proyecto: null, motivo: null, formaciones: [] } }),
    firma: vi.fn(),
  },
}));

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { canSeeItem } = await import('@/shared/components/layout/Sidebar');

afterEach(cleanup);

async function abrir(props = {}, ruta = '/') {
  render(<MemoryRouter initialEntries={[ruta]}><CertifexDiplomasPage {...props} /></MemoryRouter>);
}

// Lo que sigue siendo de administración: no puede salir a quien solo emite.
const DE_ADMIN = [/^Rechazar/, /aviso de rechazo/i, /Reenviar aviso/, /Corregir/, /Revocar/, /imprenta/i, /Sincronizar/];

describe('Diplomas para quien emite sin ser admin', () => {
  it('Pendientes: aprobar y emitir, editar, poner el DNI, reintentar, enviar y «Nuevo diploma»; rechazar, no', async () => {
    await abrir({ soloEmitir: true });
    await screen.findByText('Luis Sin Documento');
    expect(screen.queryByText('Solo lectura')).toBeNull();
    expect(screen.getByRole('button', { name: /Nuevo diploma/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Aprobar y emitir/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^Editar los datos/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Sin DNI · Poner/ }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Emitir 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Enviar diploma al alumno/ })).toBeTruthy();
    for (const a of DE_ADMIN) expect(screen.queryAllByRole('button', { name: a }), String(a)).toHaveLength(0);
  });

  it('en bloque: «Aprobar y emitir» sí, «Rechazar» no', async () => {
    await abrir({ soloEmitir: true });
    const fila = (await screen.findByText('Ana Con Documento')).closest('tr');
    fireEvent.click(within(fila).getByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Aprobar y emitir \(1\)/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Rechazar \(/ })).toBeNull();
  });

  it('Emitidos: enviar al alumno sí; corregir y revocar, no', async () => {
    await abrir({ soloEmitir: true }, '/?pestana=enviados');
    await screen.findByText('Rosa Emitida');
    expect(screen.getByRole('button', { name: /Enviar al alumno/ })).toBeTruthy();
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
    for (const a of DE_ADMIN) expect(screen.queryAllByRole('button', { name: a }), String(a)).toHaveLength(0);
  });

  it('el PDF: «enviar al alumno» sí; el A3 de imprenta, no', async () => {
    await abrir({ soloEmitir: true });
    fireEvent.click(await screen.findByRole('button', { name: /Ver PDF/ }));
    const visor = await screen.findByRole('dialog');
    expect(within(visor).getByRole('button', { name: /enviar al alumno/i })).toBeTruthy();
    expect(within(visor).queryByText(/imprenta/i)).toBeNull();
  });

  it('Rechazados: se ven, sin el aviso de rechazo ni casillas', async () => {
    await abrir({ soloEmitir: true }, '/?pestana=rechazados');
    await screen.findByText('Pepa Rechazada');
    expect(screen.queryAllByRole('button', { name: /aviso de rechazo|Reenviar aviso/i })).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('administración, como siempre: también rechaza, corrige y revoca', async () => {
    await abrir({}, '/?pestana=enviados');
    await screen.findByText('Rosa Emitida');
    expect(screen.getByRole('button', { name: 'Corregir nombre' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revocar' })).toBeTruthy();
  });
});

// En ISEIE `canSeeItem(item, roles, soloColaboraciones, permisos, can)`.
describe('la entrada «Diplomas» del menú, con el permiso de emitir', () => {
  const diplomas = { label: 'Diplomas', to: '/matriculas/diplomas', roles: ['superadmin', 'admin'], oPermiso: ['diplomas.view', 'diplomas.emit'] };
  const can = (lista) => (k) => lista.includes(k);

  it('una gestora la ve con «Emitir» aunque no tenga «Ver»', () => {
    expect(canSeeItem(diplomas, ['gestor'], false, {}, can(['diplomas.emit']))).toBe(true);
    expect(canSeeItem(diplomas, ['gestor'], false, {}, can(['diplomas.view']))).toBe(true);
    expect(canSeeItem(diplomas, ['gestor'], false, {}, can([]))).toBe(false);
  });
});
