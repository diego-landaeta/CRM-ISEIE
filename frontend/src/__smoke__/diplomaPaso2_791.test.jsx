// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  #791 (gemela de CRM#1135) · Diploma al 100 %, paso 2.

   · Diplomas › Pendientes: a quien ya se le pidieron los datos no se le ofrece «Aprobar y
     emitir» como a los demás; se dice que se espera al alumno y hasta cuándo. Con los
     datos ya contestados, el botón vuelve.
   · La ficha del alumno enseña el diploma: datos pedidos, contestados o emitido; sin nada,
     no se pinta.
*/

const datos = vi.hoisted(() => {
  const fila = (id, nombre, extra = {}) => ({
    matriculaId: id, centro: 'ISEIE', titular: { nombre, email: `alumno${id}@prueba.test`, dni: '12345678Z' },
    curso: { ref: 12, nombre: 'Máster en Prueba' }, notaFinal: 8, umbral: 5, completado: true,
    actividades: { total: 4, calificadas: 4 }, propuesto: true, nexpediente: null,
    solicitud: { en: '2026-11-20T09:00:00Z', nombre }, decision: null, crm: null, edicion: null, firma: null,
    programaCrm: { programa: { horas: 100, modulos: [{ titulo: 'Módulo uno' }] }, formacion: null, motivo: null, editado: false, elegida: false },
    confirmacion: null,
    ...extra,
  });
  const confirmacion = (estado, extra = {}) => ({
    estado, pedidaEn: '2026-11-24T10:00:00Z', caducaEn: '2026-12-01T10:00:00Z', enviadaEn: '2026-11-24T10:00:00Z',
    simulado: false, envioError: null, respondidaEn: null, sinAplicar: false, aplicarError: null, ...extra,
  });
  return {
    confirmacion,
    pendientes: [
      fila(1, 'Ana Esperando', { confirmacion: confirmacion('pendiente') }),
      fila(2, 'Luis Sin Pedir'),
      fila(3, 'Eva Confirmada', { confirmacion: confirmacion('confirmado', { respondidaEn: '2026-11-25T08:00:00Z' }) }),
    ],
    ficha: [],
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
  },
  diplomasApi: {
    resumen: async () => ({ data: { pendientes: 3, rechazadas: 0, vigentes: 0, revocados: 0, terminados: 0, porAvisar: 0, sinEmitir: 0, porEnviar: 0 } }),
    solicitudes: async () => ({ data: { filas: datos.pendientes, total: datos.pendientes.length, pagina: 1, tam: 50 } }),
    porAvisar: async () => ({ data: { porAvisar: [], sinEmitir: [] } }),
    diplomas: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    terminados: async () => ({ data: { filas: [], total: 0, pagina: 1, tam: 50 } }),
    formaciones: async () => ({ data: { proyecto: null, motivo: null, formaciones: [] } }),
    firma: vi.fn(),
  },
}));

vi.mock('@/shared/api/client', async (original) => {
  const real = await original();
  return {
    ...real,
    default: { ...real.default, get: vi.fn(async (url) => (String(url).endsWith('/diploma') ? { success: true, data: datos.ficha } : { success: true, data: null })) },
  };
});

const { default: CertifexDiplomasPage } = await import('@/modules/certifex/pages/CertifexDiplomasPage');
const { default: DiplomaDelAlumno } = await import('@/modules/clients/components/DiplomaDelAlumno');
const { leerConfirmacion, leerDiplomaDeLaFicha } = await import('@/modules/diploma-confirmacion/components/EstadoDelDiploma');

afterEach(cleanup);

const filaDe = (nombre) => screen.getByText(nombre).closest('tr');

describe('#791 · Diplomas › Pendientes', () => {
  it('con los datos pedidos: «Esperando al alumno» en vez de «Aprobar y emitir»; los demás, como siempre', async () => {
    render(<MemoryRouter><CertifexDiplomasPage /></MemoryRouter>);
    await screen.findByText('Ana Esperando');

    const esperando = within(filaDe('Ana Esperando'));
    expect(esperando.queryByRole('button', { name: /Aprobar y emitir/ })).toBeNull();
    expect(esperando.getByRole('status').textContent).toMatch(/Esperando al alumno.*Datos pedidos\. Hasta el 1 dic/);
    expect(esperando.getByText('Datos pedidos')).toBeTruthy();

    const sinPedir = within(filaDe('Luis Sin Pedir'));
    expect(sinPedir.getByRole('button', { name: /Aprobar y emitir/ })).toBeTruthy();
    expect(sinPedir.queryByText('Datos pedidos')).toBeNull();

    const confirmada = within(filaDe('Eva Confirmada'));
    expect(confirmada.getByRole('button', { name: /Aprobar y emitir/ })).toBeTruthy();
    expect(confirmada.getByText('Datos confirmados')).toBeTruthy();
  });
});

describe('#791 · lo que se dice de cada estado', () => {
  it('pendiente, confirmado, corregido (con y sin pasar a Certifex) y vencido', () => {
    const c = datos.confirmacion;
    expect(leerConfirmacion(c('pendiente'))).toMatchObject({ rotulo: 'Datos pedidos', puedeEmitir: false, tono: 'info' });
    expect(leerConfirmacion(c('pendiente')).detalle).toMatch(/hasta el 1 dic/);
    expect(leerConfirmacion(c('pendiente', { envioError: 'rebotado' }))).toMatchObject({ tono: 'warning' });
    expect(leerConfirmacion(c('confirmado', { respondidaEn: '2026-11-25T08:00:00Z' }))).toMatchObject({ rotulo: 'Datos confirmados', puedeEmitir: true });
    expect(leerConfirmacion(c('corregido', { sinAplicar: true }))).toMatchObject({ puedeEmitir: false, tono: 'warning' });
    expect(leerConfirmacion(c('corregido'))).toMatchObject({ rotulo: 'Datos corregidos', puedeEmitir: true });
    expect(leerConfirmacion(c('vencido'))).toMatchObject({ rotulo: 'Plazo vencido', puedeEmitir: true });
  });

  it('en la ficha, lo emitido manda: número y si ya se le envió', () => {
    const base = {
      matricula_id: 1, centro: 'ISEIE', project_id: 1, campus: 'ISEIE', estado: 'confirmado', curso_nombre: 'Máster',
      pedido_at: '2026-11-24T10:00:00Z', caduca_at: '2026-12-01T10:00:00Z', enviado_at: null, envio_simulado: false, envio_error: null,
      respondido_at: '2026-11-25T08:00:00Z', aplicado_at: null, aplicar_error: null, nexpediente: null, emitido_at: null, diploma_enviado_at: null,
    };
    expect(leerDiplomaDeLaFicha(base).rotulo).toBe('Datos confirmados');
    const emitido = leerDiplomaDeLaFicha({ ...base, nexpediente: 'ISEIE-2026-000001-AAAA', emitido_at: '2026-11-26T10:00:00Z' });
    expect(emitido).toMatchObject({ rotulo: 'Diploma emitido' });
    expect(emitido.detalle).toMatch(/ISEIE-2026-000001-AAAA.*Aún no se le ha enviado/);
    expect(leerDiplomaDeLaFicha({ ...base, nexpediente: 'X', emitido_at: '2026-11-26T10:00:00Z', diploma_enviado_at: '2026-11-27T10:00:00Z' }).detalle)
      .toMatch(/Enviado al alumno el 27 nov/);
  });
});

describe('#791 · la ficha del alumno', () => {
  it('enseña el diploma de cada curso; sin nada, no pinta la tarjeta', async () => {
    datos.ficha = [];
    const { container } = render(<DiplomaDelAlumno leadId={7} />);
    await new Promise((r) => { setTimeout(r, 0); });
    expect(container.innerHTML).toBe('');
    cleanup();

    datos.ficha = [{
      matricula_id: 1, centro: 'ISEIE', project_id: 1, campus: 'ISEIE', estado: 'pendiente', curso_nombre: 'Máster en Prueba',
      pedido_at: '2026-11-24T10:00:00Z', caduca_at: '2026-12-01T10:00:00Z', enviado_at: '2026-11-24T10:00:00Z', envio_simulado: false,
      envio_error: null, respondido_at: null, aplicado_at: null, aplicar_error: null, nexpediente: null, emitido_at: null, diploma_enviado_at: null,
    }];
    render(<DiplomaDelAlumno leadId={7} />);
    expect(await screen.findByRole('heading', { name: /Diploma/ })).toBeTruthy();
    expect(screen.getByText('Máster en Prueba')).toBeTruthy();
    expect(screen.getByText('Datos pedidos')).toBeTruthy();
  });
});
