// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #223 (gemela de MultiCRM #384) · Ver Diplomas (Certifex) sin ser admin.

  Diego: «Adriana, Daniela, Yosbely, Dayana, Mireia y Ana deben de tener para ver los de
  Certifex». Con «Diplomas (Certifex) · Ver» se entra a la pantalla en SOLO LECTURA: lo
  mismo a la vista, ningún botón que cambie nada, y un aviso «Solo lectura».

  Lo que se fija:
   · la entrada del menú la ve admin/superadmin por su rol y el resto solo con el permiso;
   · en solo lectura no hay aprobar, emitir, rechazar, editar, poner el DNI, enviar,
     corregir, revocar ni «Nuevo diploma», ni casillas para hacerlo en bloque;
   · se sigue viendo todo, el DNI incluido, y el PDF digital (sin el A3 ni «enviar»);
   · sin `soloLectura`, administración lo ve como siempre.
*/

const datos = vi.hoisted(() => {
  const fila = (id, nombre, dni, extra = {}) => ({
    matriculaId: id, centro: 'ISEIE', titular: { nombre, email: `alumno${id}@prueba.test`, dni },
    curso: { ref: 12, nombre: 'Máster en Prueba' }, notaFinal: 8, umbral: 5, completado: true,
    actividades: { total: 4, calificadas: 4 }, propuesto: true, nexpediente: null,
    solicitud: { en: '2026-10-20T09:00:00Z', nombre }, decision: null, crm: null, edicion: null, firma: null,
    programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Módulo uno' }] }, formacion: null, motivo: null, editado: false, elegida: false },
    ...extra,
  });
  const aprobada = { decision: { decision: 'aprobada', motivo: null, decididoPor: 'x', decididoEn: '2026-10-20T10:00:00Z', refExterna: null } };
  const diploma = (nexpediente, alumno, extra = {}) => ({
    nexpediente, centro: 'ISEIE', alumno, titulacion: 'Máster en Prueba', cursoRef: 12, emitidoEn: '2026-10-20T10:00:00Z',
    emitidaPor: 'Adriana (CRM)', revocada: false, revocacion: null, verificarUrl: `https://certifex.test/c/${nexpediente}`,
    diplomaUrl: null, aviso: null, emitidoEnCrm: true, imprenta: true, ...extra,
  });
  return {
    pendientes: [fila(1, 'Ana Con Documento', '12345678Z'), fila(2, 'Luis Sin Documento', null)],
    sinEmitir: [fila(4, 'Olga Aprobada', 'X1234567L', aprobada)],
    porAvisar: [fila(5, 'Eva Por Avisar', 'Y1234567L', { ...aprobada, nexpediente: 'ISEIE-2026-000005-AAAA', diploma: diploma('ISEIE-2026-000005-AAAA', 'Eva Por Avisar') })],
    diplomas: [diploma('ISEIE-2026-000009-BBBB', 'Rosa Emitida')],
  };
});

vi.mock('@/shared/hooks/useToast', () => ({
  toast: () => {},
  useToast: () => ({ toasts: [], addListener: () => () => {} }),
}));

vi.mock('@/modules/certifex/api/certifex.api', () => ({
  emisionesApi: {
    estado: async () => ({ data: { conectado: true, nombre: 'CRM de prueba' } }),
    centros: async () => ({ data: [{ codigo: 'ISEIE', nombre: 'ISEIE' }] }),
    cursos: async () => ({ data: [] }),
    diploma: async () => new Blob(['%PDF'], { type: 'application/pdf' }),
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 2, rechazadas: 0, vigentes: 1, revocados: 0, terminados: 0, porAvisar: 1, sinEmitir: 1, porEnviar: 1 } }),
    solicitudes: async () => ({ data: { filas: datos.pendientes, total: datos.pendientes.length, pagina: 1, tam: 50 } }),
    porAvisar: async () => ({ data: { porAvisar: datos.porAvisar, sinEmitir: datos.sinEmitir } }),
    diplomas: async () => ({ data: { filas: datos.diplomas, total: datos.diplomas.length, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    formaciones: async () => ({ data: { proyecto: null, motivo: null, formaciones: [] } }),
    firma: vi.fn(),
    // Justificante del envío (05/11/2026): la ficha enseña los envíos también en solo lectura.
    envios: async () => ({ data: { credencial: { nexpediente: 'ISEIE-2026-000005-AAAA', centro: 'ISEIE' }, envios: [{
      id: 7, tipo: 'credencial', en: '2026-11-05T13:03:12.000Z', resultado: 'enviado', aprobadoPor: 'Adriana (CRM)',
      destinatario: 'alumno5@prueba.test', asunto: 'Tu diploma', messageId: '<x@y>', sinDetalle: false,
    }] } }),
    justificante: vi.fn(),
  },
}));

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { canSeeItem } = await import('@/shared/components/layout/Sidebar');

afterEach(cleanup);

async function abrir(props = {}, ruta = '/') {
  render(<MemoryRouter initialEntries={[ruta]}><CertifexDiplomasPage {...props} /></MemoryRouter>);
}

// Lo que cambia algo: nada de esto puede salir en solo lectura.
const ACCIONES = [/Aprobar y emitir/, /^Rechazar/, /^Editar/, /Nuevo diploma/, /^Emitir \d/, /Poner/, /Enviar/, /Reenviar/, /Corregir/, /Revocar/];

describe('Diplomas en solo lectura', () => {
  it('Pendientes: se ve todo, con «Solo lectura», y ningún botón que cambie nada', async () => {
    await abrir({ soloLectura: true });
    await screen.findByText('Luis Sin Documento');
    expect(screen.getByText('Solo lectura')).toBeTruthy();
    expect(screen.getByText('Ana Con Documento')).toBeTruthy();
    expect(screen.getByText('Eva Por Avisar')).toBeTruthy();
    // El DNI se ve; el que falta, se dice, sin ofrecer ponerlo.
    expect(screen.getByText('DNI 12345678Z')).toBeTruthy();
    expect(within(screen.getByText('Luis Sin Documento').closest('tr')).getByText('Sin DNI')).toBeTruthy();
    for (const a of ACCIONES) expect(screen.queryAllByRole('button', { name: a }), String(a)).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // Ver el PDF de lo emitido, sí.
    expect(screen.getByRole('button', { name: /Ver PDF/ })).toBeTruthy();
  });

  it('el PDF se ve, pero sin «enviar al alumno» ni el A3 de imprenta', async () => {
    await abrir({ soloLectura: true });
    fireEvent.click(await screen.findByRole('button', { name: /Ver PDF/ }));
    const visor = await screen.findByRole('dialog');
    expect(within(visor).queryByRole('button', { name: /enviar al alumno/i })).toBeNull();
    expect(within(visor).queryByText(/imprenta/i)).toBeNull();
    // Quien solo ve Diplomas ve los envíos y descarga su justificante (es leer).
    expect(await within(visor).findByText('Enviado el 05/11/2026 14:03 a alumno5@prueba.test')).toBeTruthy();
    expect(within(visor).getByRole('button', { name: /Descargar justificante/ })).toBeTruthy();
  });

  it('Emitidos: ver el PDF y copiar el enlace; nada de enviar, corregir ni revocar', async () => {
    await abrir({ soloLectura: true }, '/?pestana=enviados');
    await screen.findByText('Rosa Emitida');
    expect(screen.getByRole('button', { name: 'Ver PDF' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copiar enlace de verificación' })).toBeTruthy();
    for (const a of ACCIONES) expect(screen.queryAllByRole('button', { name: a }), String(a)).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('administración, como siempre: sus botones están y no dice «Solo lectura»', async () => {
    await abrir();
    await screen.findByText('Luis Sin Documento');
    expect(screen.queryByText('Solo lectura')).toBeNull();
    expect(screen.getByRole('button', { name: /Nuevo diploma/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Aprobar y emitir/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Sin DNI · Poner/ }).length).toBeGreaterThan(0);
  });
});

// En ISEIE `canSeeItem(item, roles, soloColaboraciones, permisos, can)`.
describe('la entrada «Diplomas» del menú', () => {
  const diplomas = { label: 'Diplomas', to: '/matriculas/diplomas', roles: ['superadmin', 'admin'], oPermiso: 'diplomas.view' };
  const can = (lista) => (k) => lista.includes(k);

  it('admin y superadmin, por su rol', () => {
    expect(canSeeItem(diplomas, ['admin'], false, {}, can([]))).toBe(true);
    expect(canSeeItem(diplomas, ['superadmin'], false, {}, can([]))).toBe(true);
  });

  it('una gestora, solo con «Diplomas (Certifex) · Ver»', () => {
    expect(canSeeItem(diplomas, ['gestor'], false, {}, can([]))).toBe(false);
    expect(canSeeItem(diplomas, ['gestor'], false, {}, can(['diplomas.view']))).toBe(true);
    // Sin `can` (llamadas antiguas), como antes: no.
    expect(canSeeItem(diplomas, ['gestor'], false, {})).toBe(false);
  });

  it('quien solo lleva colaboraciones también la ve si se le ha dado', () => {
    expect(canSeeItem(diplomas, ['gestor'], true, {}, can([]))).toBe(false);
    expect(canSeeItem(diplomas, ['gestor'], true, {}, can(['diplomas.view']))).toBe(true);
  });

  it('un tutor o un colaborador, nunca', () => {
    expect(canSeeItem(diplomas, ['tutor'], false, {}, can(['diplomas.view']))).toBe(false);
    expect(canSeeItem(diplomas, ['colaborador'], false, {}, can(['diplomas.view']))).toBe(false);
  });
});
