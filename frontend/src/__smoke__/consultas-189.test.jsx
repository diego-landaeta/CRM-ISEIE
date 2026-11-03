// @vitest-environment jsdom
// Traída de MultiCRM (2.6.0). ISEIE no tiene un setup común de pruebas: el entorno,
// los matchers de jest-dom y la limpieza entre pruebas se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { afterEach as despuesDeCada } from 'vitest';
import { cleanup as limpiar } from '@testing-library/react';

despuesDeCada(limpiar);
if (typeof window !== 'undefined') {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
  window.matchMedia ??= () => ({ matches: false, media: '', onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; } });
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  Consultas de alumnos, fase 3 (#189): «Alumnos sin mensajes» con «Escribir al
  alumno», «Mi carga de trabajo», el panel de tutores con el aviso de campus
  sin tutor y las métricas.
*/

const api = vi.hoisted(() => ({
  alumnosSinMensajes: vi.fn(), escribirAlAlumno: vi.fn(), miCarga: vi.fn(), guardarCarga: vi.fn(),
  panelDeTutores: vi.fn(), campusSinTutor: vi.fn(), sincronizarAlumnos: vi.fn(), metricas: vi.fn(),
  mias: vi.fn(), panel: vi.fn(), leerAhora: vi.fn(),
  toast: vi.fn(),
  user: { role: 'tutor' },
}));
vi.mock('@/modules/consultas/api/consultas.api', async (original) => {
  const real = await original();
  return { ...real, consultasApi: api };
});
vi.mock('@/shared/hooks/useToast', () => ({ toast: api.toast }));
// El mapa de permisos del servidor (#423): los de serie de sus roles.
vi.mock('@/contexts/AuthContext', async () => {
  const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
  const mapa = (u) => (u ? resolverPermisos({ role: u.role, roles_extra: u.roles_extra || [], excepciones: {} }).mapa : null);
  return { useAuth: () => ({ user: api.user, permissions: mapa(api.user) }) };
});
vi.mock('@/contexts/ProjectContext', () => ({
  useProjectContext: () => ({ activeProject: { id: 1, nombre: 'Psiko' }, activeIssuerId: null }),
}));

import AlumnosSinMensajesPage from '@/modules/consultas/pages/AlumnosSinMensajesPage';
import MiCargaPage from '@/modules/consultas/pages/MiCargaPage';
import TutoresConsultasPage from '@/modules/consultas/pages/TutoresConsultasPage';
import MetricasConsultasPage from '@/modules/consultas/pages/MetricasConsultasPage';
import ConsultasPage from '@/modules/consultas/pages/ConsultasPage';

const diasAtras = (d) => new Date(Date.now() - d * 86400_000).toISOString();
const alumno = (extra = {}) => ({
  id: 11, project_id: 1, campus: 'Psiko', tutor_id: 7, tutor: 'Tutora', alumno_nombre: 'Ana Pérez',
  alumno_email: 'ana@campus.es', curso_nombre: 'Psicología', matriculado_desde: diasAtras(8),
  matricula_aproximada: true, ultimo_acceso: null, dias: 8, color: 'rojo', ...extra,
});
const reales = { alumnos_activos: 12, consultas_abiertas: 3, alumnos_sin_mensajes: 2 };
const metricas = (extra = {}) => ({
  plazoHoras: 24,
  consultas: {
    volumen: 4, respondidas: 3, primeraRespuestaHoras: { media: 11, mediana: 2 }, resolucionHoras: { media: 10, mediana: 10 },
    enPlazoPct: 67, pendientes: { total: 1, mediaHoras: 48, maximaHoras: 48 },
    fueraDePlazo: [{ id: 9, alumno_nombre: 'Luis', campus: 'Psiko', tutor: 'Tutora', estado: 'respondida', entrada_at: diasAtras(3), horas: 30 }],
    porDia: [{ dia: '2026-10-15', n: 3 }, { dia: '2026-10-16', n: 1 }],
  },
  alumnos: { total: 3, sinMensajes: 2, sinMensajesDiasMedia: 4, contactadosPct: 33, primerContactoDias: { media: 3, mediana: 3 }, matriculaAproximada: true },
  ...extra,
});
const enRuta = (el) => render(<MemoryRouter>{el}</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.user = { role: 'tutor' };
  api.alumnosSinMensajes.mockResolvedValue({ success: true, data: {
    alumnos: [alumno(), alumno({ id: 12, alumno_nombre: 'Luis Gil', dias: 5, color: 'ambar' }), alumno({ id: 13, alumno_nombre: 'Eva Ruiz', dias: 1, color: 'verde' })],
    diasAmbar: 5, diasRojo: 7,
  } });
  api.escribirAlAlumno.mockResolvedValue({ success: true, data: { consultaId: 50, enviado: true, error: null } });
  api.miCarga.mockResolvedValue({ success: true, data: { actual: null, historial: [], desactualizada: true, diasPlazo: 7, datosReales: reales } });
  api.guardarCarga.mockResolvedValue({ success: true, data: {
    actual: { id: 1, nivel: 'alta', texto: 'Exámenes', created_at: new Date().toISOString(), por: 'Tutora' },
    historial: [{ id: 1, nivel: 'alta', texto: 'Exámenes', created_at: new Date().toISOString(), por: 'Tutora' }],
    desactualizada: false, diasPlazo: 7, datosReales: reales,
  } });
  api.panelDeTutores.mockResolvedValue({ success: true, data: {
    tutores: [{ id: 7, nombre: 'Tutora', email: 't@x.es', disponible: true, motivo_no_disponible: null, campus: ['Psiko'], empresas: ['CEDIA'],
      carga: { nivel: 'completa', texto: 'Hasta arriba', created_at: diasAtras(9) }, desactualizada: true, ...reales }],
    campusSinTutor: [{ id: 2, campus: 'Fono', empresa: 'CEDIA' }], diasPlazoCarga: 7,
  } });
  api.campusSinTutor.mockResolvedValue({ success: true, data: [{ id: 2, campus: 'Fono', empresa: 'CEDIA' }] });
  api.metricas.mockResolvedValue({ success: true, data: metricas() });
  api.mias.mockResolvedValue({ success: true, data: { consultas: [], plazoHoras: 24 } });
  api.panel.mockResolvedValue({ success: true, data: { consultas: [], plazoHoras: 24 } });
});

describe('#189 · Alumnos sin mensajes', () => {
  it('el tutor ve los suyos con las columnas de la issue y el semáforo, en el orden del servidor', async () => {
    enRuta(<AlumnosSinMensajesPage />);
    expect(await screen.findByText('Ana Pérez')).toBeTruthy();
    expect(api.alumnosSinMensajes).toHaveBeenCalledWith(undefined);
    for (const col of ['Alumno', 'Curso', 'Proyecto', 'Matrícula', 'Sin contacto']) {
      expect(screen.getByRole('columnheader', { name: col })).toBeTruthy();
    }
    const filas = screen.getAllByRole('row').slice(1);
    expect(filas.map((f) => within(f).getAllByRole('cell')[0].textContent)).toEqual([
      expect.stringContaining('Ana Pérez'), expect.stringContaining('Luis Gil'), expect.stringContaining('Eva Ruiz'),
    ]);
    expect(within(filas[0]).getByText('8 días').className).toContain('destructive');
    expect(within(filas[1]).getByText('5 días').className).toContain('warning');
    expect(within(filas[2]).getByText('1 día').className).toContain('success');
    expect(screen.queryByRole('button', { name: /Sincronizar ahora/ })).toBeNull();
  });

  it('«Escribir al alumno»: sin texto avisa; con texto lo manda y recarga la lista', async () => {
    enRuta(<AlumnosSinMensajesPage />);
    await screen.findByText('Ana Pérez');
    fireEvent.click(screen.getAllByRole('button', { name: 'Escribir al alumno' })[0]);
    fireEvent.click(screen.getByRole('button', { name: /Enviar al campus/ }));
    expect(await screen.findByText('Falta el mensaje: escríbelo en «Mensaje al alumno».')).toBeTruthy();
    expect(api.escribirAlAlumno).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/Mensaje al alumno/), { target: { value: 'Bienvenida' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar al campus/ }));
    await waitFor(() => expect(api.escribirAlAlumno).toHaveBeenCalledWith(11, 'Bienvenida'));
    await waitFor(() => expect(api.alumnosSinMensajes).toHaveBeenCalledTimes(2));
    expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Mensaje enviado al campus' }));
  });

  it('si no llega al campus, lo dice', async () => {
    api.escribirAlAlumno.mockResolvedValue({ success: true, data: { consultaId: 50, enviado: false, error: 'Falta el token del tutor en este campus' } });
    enRuta(<AlumnosSinMensajesPage />);
    await screen.findByText('Ana Pérez');
    fireEvent.click(screen.getAllByRole('button', { name: 'Escribir al alumno' })[0]);
    fireEvent.change(screen.getByLabelText(/Mensaje al alumno/), { target: { value: 'Hola' } });
    fireEvent.click(screen.getByRole('button', { name: /Enviar al campus/ }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Guardado, pero no ha llegado al campus', description: 'Falta el token del tutor en este campus', variant: 'destructive',
    })));
  });

  it('administración ve los de todos del campus de arriba, con el tutor y «Sincronizar ahora»', async () => {
    api.user = { role: 'admin' };
    api.sincronizarAlumnos.mockResolvedValue({ success: true, data: [{ projectId: 1, nuevos: 2, errores: [] }] });
    enRuta(<AlumnosSinMensajesPage />);
    await screen.findByText('Ana Pérez');
    expect(api.alumnosSinMensajes).toHaveBeenCalledWith({ projectId: 1, issuerId: null });
    expect(screen.getByRole('columnheader', { name: 'Tutor' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Escribir al alumno' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Sincronizar ahora/ }));
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '2 alumno(s) nuevo(s)' })));
  });
});

describe('#189 · Mi carga de trabajo', () => {
  it('sin indicar: avisa, enseña los datos reales y exige el nivel', async () => {
    enRuta(<MiCargaPage />);
    expect(await screen.findByText('Aún no has indicado tu carga de trabajo.')).toBeTruthy();
    const datos = screen.getByRole('complementary');
    expect(within(datos).getByText('Alumnos activos').nextSibling.textContent).toBe('12');
    expect(within(datos).getByText('Consultas abiertas').nextSibling.textContent).toBe('3');
    expect(within(datos).getByText('Alumnos sin mensajes').nextSibling.textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('Falta el nivel: elige baja, media, alta o completa en «Nivel de carga».')).toBeTruthy();
    expect(api.guardarCarga).not.toHaveBeenCalled();
  });

  it('guarda el nivel y el texto, y queda en el historial', async () => {
    enRuta(<MiCargaPage />);
    await screen.findByText('Aún no has indicado tu carga de trabajo.');
    fireEvent.click(screen.getByRole('radio', { name: 'Alta' }));
    fireEvent.change(screen.getByLabelText(/En qué estás trabajando/), { target: { value: 'Exámenes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.guardarCarga).toHaveBeenCalledWith('alta', 'Exámenes'));
    const historial = await screen.findByRole('list', { name: 'Historial de la carga' });
    expect(within(historial).getByText('Exámenes')).toBeTruthy();
    expect(screen.queryByText(/Aún no has indicado/)).toBeNull();
  });

  it('pasado el plazo sale «desactualizada»', async () => {
    api.miCarga.mockResolvedValue({ success: true, data: {
      actual: { id: 1, nivel: 'media', texto: null, created_at: diasAtras(9), por: null },
      historial: [{ id: 1, nivel: 'media', texto: null, created_at: diasAtras(9), por: null }],
      desactualizada: true, diasPlazo: 7, datosReales: reales,
    } });
    enRuta(<MiCargaPage />);
    expect(await screen.findByText(/Desactualizada: hace más de 7 días/)).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Media' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('#189 · panel de tutores', () => {
  it('nivel, texto, fecha, «desactualizada», datos reales y el aviso de campus sin tutor', async () => {
    api.user = { role: 'admin' };
    enRuta(<TutoresConsultasPage />);
    expect(await screen.findByText('Hasta arriba')).toBeTruthy();
    expect(api.panelDeTutores).toHaveBeenCalledWith({ projectId: 1, issuerId: null });
    expect(screen.getByText('Completa')).toBeTruthy();
    expect(screen.getByText('Desactualizada')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('1 campus conectado no tiene tutor para las consultas')).toBeTruthy();
    expect(screen.getByText(/Fono \(CEDIA\)/)).toBeTruthy();
  });

  it('la bandeja de administración también avisa del campus sin tutor; la del tutor no', async () => {
    api.user = { role: 'admin' };
    const { unmount } = enRuta(<ConsultasPage />);
    expect(await screen.findByText('1 campus conectado no tiene tutor para las consultas')).toBeTruthy();
    unmount();
    api.user = { role: 'tutor' };
    enRuta(<ConsultasPage />);
    await waitFor(() => expect(api.mias).toHaveBeenCalled());
    expect(api.campusSinTutor).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/no tiene tutor para las consultas/)).toBeNull();
  });
});

describe('#189 · métricas', () => {
  it('el tutor ve las suyas: primera respuesta (mediana y media), en plazo, pendientes, fuera de plazo y alumnos; sin ranking', async () => {
    enRuta(<MetricasConsultasPage />);
    expect(await screen.findByText('Primera respuesta')).toBeTruthy();
    expect(api.metricas).toHaveBeenCalledWith({ desde: undefined, hasta: undefined, tutorId: null }, undefined);
    expect(screen.getByText('2 h')).toBeTruthy();
    expect(screen.getByText('Mediana · media 11 h')).toBeTruthy();
    expect(screen.getByText('67 %')).toBeTruthy();
    expect(screen.getByText('Fuera de plazo (1)')).toBeTruthy();
    expect(screen.getByText('33 %')).toBeTruthy();
    expect(screen.queryByText('Ranking de tutores')).toBeNull();
    expect(screen.queryByText('Tutor')).toBeNull();
  });

  it('las fechas filtran', async () => {
    enRuta(<MetricasConsultasPage />);
    await screen.findByText('Primera respuesta');
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
    await waitFor(() => expect(api.metricas).toHaveBeenLastCalledWith({ desde: '2026-10-01', hasta: undefined, tutorId: null }, undefined));
  });

  it('administración ve el ranking de tutores y de campus del ámbito de arriba', async () => {
    api.user = { role: 'admin' };
    api.metricas.mockResolvedValue({ success: true, data: metricas({ ranking: {
      tutores: [{ id: 7, nombre: 'Tutora', consultas: 3, pendientes: 0, primeraRespuestaHoras: { media: 11, mediana: 2 }, enPlazoPct: 67 }],
      campus: [{ id: 1, nombre: 'Psiko', consultas: 4, pendientes: 1, primeraRespuestaHoras: { media: 11, mediana: 2 }, enPlazoPct: 67 }],
    } }) });
    enRuta(<MetricasConsultasPage />);
    expect(await screen.findByText('Ranking de tutores')).toBeTruthy();
    expect(api.metricas).toHaveBeenCalledWith(expect.objectContaining({ tutorId: null }), { projectId: 1, issuerId: null });
    expect(screen.getByText('Ranking de campus')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Tutor' })).toBeTruthy();
  });
});

describe('#189 · lo que salió en la revisión final (18/10)', () => {
  it('un día suelto se escribe tal cual, sin pasar por la hora (en América salía el día de antes)', async () => {
    const { fechaCorta } = await import('@/modules/consultas/components/ConsultasNav');
    expect(fechaCorta('2026-10-02')).toBe('2/10/2026');
    expect(fechaCorta(null)).toBe('—');
  });

  it('«Mi carga» dice por qué no carga, en vez de quedarse en «Cargando…»', async () => {
    api.miCarga.mockRejectedValue(Object.assign(new Error('La carga es de cada tutor'), { data: { error: 'La carga es de cada tutor' } }));
    enRuta(<MiCargaPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/No se ha podido cargar tu carga de trabajo: La carga es de cada tutor/)).toBeTruthy();
    expect(screen.queryByText('Cargando…')).toBeNull();
  });

  it('si falla la lista de alumnos, no se quedan los de antes', async () => {
    api.user = { role: 'admin' };
    api.alumnosSinMensajes.mockRejectedValueOnce(new Error('403'));
    enRuta(<AlumnosSinMensajesPage />);
    await waitFor(() => expect(api.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'No se han podido cargar los alumnos' })));
    expect(screen.queryByText('Ana Pérez')).toBeNull();
  });

  it('soporte como rol de más no ve «Tutores» (el servidor no se lo deja)', () => {
    api.user = { role: 'tutor', roles_extra: ['soporte'] };
    enRuta(<AlumnosSinMensajesPage />);
    expect(screen.queryByRole('link', { name: /Tutores/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Mi carga/ })).toBeTruthy();
  });
});
