// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda E (gemela de CRM#941; Diego, 19/11: «las que son así, dáselas a
  Ángel CEDIA»): «Ver recorrido» en lo que quedaba de WhatsApp (Banco de
  mensajes y Actividad; el chat, Plantillas y Conexión ya tienen el suyo, y Ayuda
  ya es una guía) y en las pestañas de Consultas: Alumnos sin mensajes, Mi
  carga, Tutores, Métricas y Respuestas del campus. Correos no: aquí la pantalla
  llega con #750, y su recorrido con ella.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que esa persona no
  tiene en ese momento («Sincronizar ahora» en «Mis alumnos», el ranking en «Las
  mías», el aviso de campus sin tutor si no hay ninguno) se salta solo. Que cada
  anclaje sigue en el código y que los permisos existen lo comprueba
  `recorridosCobros.test.jsx`; que el cartel cabe a 375 px, paso a paso,
  `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito, datos } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
  datos: { campusSinTutor: true },
}));

vi.mock('@/shared/api/client', () => ({
  default: { get: (...a) => api.get(...a), post: vi.fn(async () => ({ success: true, data: {} })), patch: vi.fn(async () => ({ success: true })) },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/useAmbito', () => ({
  useIdsDelAmbito: () => ambito.current.projects.map((p) => p.id),
  useProyectosDelAmbito: () => ambito.current.projects,
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_C } = await import('@/shared/lib/recorridosGestoraC');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: BancoPage } = await import('@/modules/whatsapp/pages/BancoPage');
const { default: ActividadWhatsappPage } = await import('@/modules/whatsapp/pages/ActividadWhatsappPage');
const { default: AlumnosSinMensajesPage } = await import('@/modules/consultas/pages/AlumnosSinMensajesPage');
const { default: MiCargaPage } = await import('@/modules/consultas/pages/MiCargaPage');
const { default: TutoresConsultasPage } = await import('@/modules/consultas/pages/TutoresConsultasPage');
const { default: MetricasConsultasPage } = await import('@/modules/consultas/pages/MetricasConsultasPage');
const { default: RespuestasCampusPage } = await import('@/modules/consultas/pages/RespuestasCampusPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };

const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
const MM = (n) => ({ media: n, mediana: n });
const FILA_RANKING = { id: 41, nombre: 'Laura Tutora', consultas: 4, pendientes: 1, primeraRespuestaHoras: MM(3), enPlazoPct: 75 };
const CARGA = { id: 1, nivel: 'media', texto: 'Corrigiendo el módulo 2', created_at: hace(30), por: null };
const RESPUESTAS = {
  '/whatsapp/banco': {
    success: true,
    data: [{
      id: 1, ts: hace(2), telefono: '34600000000', quien: 'Ana Pérez', direccion: 'entrante', tipo: 'texto',
      texto: 'Hola, quiero información del máster', con_adjunto: false, nombre_archivo: null, estado: null,
      instancia: 'u41', es_grupo: false, participante_nombre: null, enviado_por_nombre: null,
    }],
    pagination: { total: 1, page: 1, limit: 50, totalPages: 1 },
  },
  '/whatsapp/banco/numeros': {
    success: true,
    data: [{ telefono: '34600000000', quien: 'Ana Pérez', es_grupo: false, mensajes: 12, primero: hace(500), ultimo: hace(2) }],
  },
  '/whatsapp/actividad': {
    success: true,
    data: {
      filas: [{
        id: 41, nombre: 'Laura Gestora', chats: 10, respondidos: 8, sin_responder: 2, mediana_min: 14, texto: 30, voz: 3,
        ultimo_mensaje_del_numero: hace(1), a_whatsapp: 5, a_llamadas: 2, a_correos: 1, a_notas: 4,
      }],
    },
  },
  '/consultas/alumnos-sin-mensajes': {
    success: true,
    data: {
      alumnos: [{
        id: 3, project_id: 1, campus: 'Campus Uno', tutor_id: 41, tutor: 'Laura Tutora', alumno_nombre: 'Carla Gómez',
        alumno_email: 'carla@ejemplo.com', curso_nombre: 'Máster en Psicología', matriculado_desde: '2026-11-10',
        matricula_aproximada: false, ultimo_acceso: null, dias: 6, color: 'ambar',
      }],
      total: 1, diasAmbar: 5, diasRojo: 7,
    },
  },
  '/consultas/carga': {
    success: true,
    data: {
      actual: CARGA, historial: [CARGA], desactualizada: false, diasPlazo: 7,
      datosReales: { alumnos_activos: 20, consultas_abiertas: 2, alumnos_sin_mensajes: 1 },
    },
  },
  '/consultas/tutores-panel': () => ({
    success: true,
    data: {
      tutores: [{
        id: 41, nombre: 'Laura Tutora', email: 'laura@ejemplo.com', disponible: true, motivo_no_disponible: null,
        campus: ['Campus Uno'], empresas: null, carga: CARGA, desactualizada: false,
        alumnos_activos: 20, consultas_abiertas: 2, alumnos_sin_mensajes: 1,
      }],
      campusSinTutor: datos.campusSinTutor ? [{ id: 2, campus: 'Campus Dos', empresa: null }] : [],
      diasPlazoCarga: 7,
    },
  }),
  '/consultas/metricas': {
    success: true,
    data: {
      plazoHoras: 24,
      consultas: {
        volumen: 4, respondidas: 3, primeraRespuestaHoras: MM(3), resolucionHoras: MM(20), enPlazoPct: 75,
        pendientes: { total: 1, mediaHoras: 30, maximaHoras: 30 },
        fueraDePlazo: [{ id: 7, alumno_nombre: 'Bea Ruiz', campus: 'Campus Uno', tutor: 'Laura Tutora', estado: 'abierta', entrada_at: hace(30), horas: 30 }],
        porDia: [{ dia: '2026-11-20', n: 2 }, { dia: '2026-11-21', n: 2 }],
      },
      alumnos: { total: 20, sinMensajes: 1, sinMensajesDiasMedia: 6, contactadosPct: 95, primerContactoDias: MM(2), matriculaAproximada: false },
      ranking: { tutores: [FILA_RANKING], campus: [{ ...FILA_RANKING, id: 1, nombre: 'Campus Uno' }] },
    },
  },
  '/consultas/respuestas': {
    success: true,
    data: [{ id: 1, titulo: 'Plazo ampliado', texto: 'Hola {nombre}, el plazo se amplía una semana.', project_id: 1, campus: 'Campus Uno', personal: false }],
  },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => {
  const r = RESPUESTAS[String(url).split('?')[0]];
  return (typeof r === 'function' ? r() : r) ?? { success: true, data: [] };
};

/** Tutora y administración a la vez: abre en «lo mío»; en «De todos» sale lo de administración. */
const aDeTodos = async (esperar) => {
  fireEvent.click(within(screen.getByRole('tablist', { name: 'De quién' })).getByRole('tab', { name: 'De todos' }));
  await esperar();
};
const PANTALLAS = {
  'whatsapp-banco': { pintar: () => <BancoPage />, cargada: 'Hola, quiero información del máster' },
  'whatsapp-actividad': { pintar: () => <ActividadWhatsappPage />, cargada: 'Laura Gestora' },
  'consultas-alumnos': {
    pintar: () => <AlumnosSinMensajesPage />,
    cargada: 'Carla Gómez',
    preparar: () => aDeTodos(() => screen.findByRole('button', { name: /Sincronizar ahora/ })),
  },
  'consultas-carga': { pintar: () => <MiCargaPage />, cargada: 'Tus datos reales' },
  'consultas-tutores': { pintar: () => <TutoresConsultasPage />, cargada: 'Laura Tutora' },
  'consultas-metricas': {
    pintar: () => <MetricasConsultasPage />,
    cargada: 'Primera respuesta',
    preparar: () => aDeTodos(() => screen.findByText('Ranking de tutores')),
  },
  'consultas-respuestas': { pintar: () => <RespuestasCampusPage />, cargada: 'Plazo ampliado' },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_C[id].titulo}`;
const pintar = (id) => render(<MemoryRouter>{PANTALLAS[id].pintar()}</MemoryRouter>);
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_C[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
const cargada = (id) => screen.findAllByText(PANTALLAS[id].cargada, {}, { timeout: 5000 });

/** Recorre el recorrido abierto pulsando «Siguiente» y devuelve los títulos vistos. */
function recorrer(n) {
  const vistos = [];
  for (let i = 0; i < n + 2; i++) {
    const titulo = document.getElementById('recorrido-titulo');
    vistos.push(titulo.textContent);
    const sig = within(titulo.closest('[role="dialog"]')).queryByRole('button', { name: /Siguiente/ });
    if (!sig) break;
    fireEvent.click(sig);
  }
  return vistos;
}

/** Abre el recorrido con su botón y lo recorre entero. */
async function abrirYRecorrer(id) {
  fireEvent.click(await screen.findByRole('button', { name: boton(id) }, { timeout: 3000 }));
  await screen.findByRole('dialog', { name: titulos(id)[0] }, { timeout: 3000 });
  return recorrer(titulos(id).length);
}

/** Como tutora sola, sin administración ni coordinación. */
function comoTutora() {
  yo.current = { id: 41, role: 'tutor', roles_extra: [] };
  ['consultas.view', 'consultas.gestionar'].forEach((k) => permisos.delete(k));
}

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  [
    'whatsapp.usar', 'reports.view',
    'consultas.view', 'consultas.atender', 'consultas.gestionar',
  ].forEach((k) => permisos.add(k));
  // Superadmin y tutora a la vez: ve «lo mío / De todos», «Sincronizar ahora» y el ranking.
  yo.current = { id: 41, role: 'superadmin', roles_extra: ['tutor'] };
  ambito.current = UN_CAMPUS;
  datos.campusSinTutor = true;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('el día a día, tercera tanda, en el modelo (#619, tanda E)', () => {
  it('son siete (Correos llega con #750), por menú, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_C)).toEqual([
      'whatsapp-banco', 'whatsapp-actividad',
      'consultas-alumnos', 'consultas-carga', 'consultas-tutores', 'consultas-metricas', 'consultas-respuestas',
    ]);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_C[id]);
  });

  it('cada uno con el permiso con el que el menú (o su pestaña) y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_C).map((r) => [r.id, r.permiso]))).toEqual({
      'whatsapp-banco': ['whatsapp.usar', 'whatsapp.supervisar', 'whatsapp.banco'],
      'whatsapp-actividad': 'reports.view',
      'consultas-alumnos': ['consultas.view', 'consultas.atender'],
      'consultas-carga': 'consultas.atender',
      'consultas-tutores': 'consultas.view',
      'consultas-metricas': ['consultas.view', 'consultas.atender'],
      'consultas-respuestas': 'consultas.gestionar',
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con «Ver recorrido» y el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_C[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el chat, Plantillas, Conexión y Ayuda de WhatsApp no se repiten: ya tienen el suyo', () => {
    const rutas = Object.values(RECORRIDOS_GESTORA_C).flatMap((r) => r.rutas);
    for (const r of ['/whatsapp', '/whatsapp/chat', '/whatsapp/plantillas', '/whatsapp/conexion', '/whatsapp/ayuda']) {
      expect(rutas).not.toContain(r);
    }
  });

  it('sin «consultas.view», Alumnos sin mensajes no explica «Sincronizar ahora»', () => {
    const vistos = pasosPara(RECORRIDOS_GESTORA_C['consultas-alumnos'], (k) => k === 'consultas.atender').map((p) => p.titulo);
    expect(vistos).not.toContain('Sincronizar ahora');
    expect(vistos).toHaveLength(RECORRIDOS_GESTORA_C['consultas-alumnos'].pasos.length - 1);
  });
});

describe('el botón «Recorrido» de la cabecera los encuentra por su ruta', () => {
  it('cada pantalla, el suyo', () => {
    expect(recorridosDeLaRuta('/whatsapp/banco')).toEqual(['whatsapp-banco']);
    expect(recorridosDeLaRuta('/whatsapp/actividad')).toEqual(['whatsapp-actividad']);
    // Correos aún no está aquí (#750): sin pantalla, sin recorrido.
    expect(recorridosDeLaRuta('/correos')).toEqual([]);
    expect(recorridosDeLaRuta('/consultas/alumnos')).toEqual(['consultas-alumnos']);
    expect(recorridosDeLaRuta('/consultas/carga')).toEqual(['consultas-carga']);
    expect(recorridosDeLaRuta('/consultas/tutores/')).toEqual(['consultas-tutores']);
    expect(recorridosDeLaRuta('/consultas/metricas')).toEqual(['consultas-metricas']);
    expect(recorridosDeLaRuta('/consultas/respuestas')).toEqual(['consultas-respuestas']);
  });

  it('la bandeja y una consulta siguen con el suyo, el de main (consultas-chat y consulta-responder)', () => {
    expect(recorridosDeLaRuta('/consultas')).toEqual(['consultas-chat']);
    expect(recorridosDeLaRuta('/consultas/7')).toEqual(['consulta-responder']);
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  it('nunca sale solo (#681), ni la primera vez; con su botón se recorre sin saltarse nada', async () => {
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    await PANTALLAS[id].preparar?.();
    expect(localStorage.getItem(claveRecorrido(id, 41))).toBeNull();
    expect(await abrirYRecorrer(id)).toEqual(titulos(id));
    // Se marca como visto al abrirse (en un efecto: puede llegar justo después del cartel).
    await waitFor(() => expect(localStorage.getItem(claveRecorrido(id, 41))).toBe('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('ya visto, tampoco sale; el botón lo repite', async () => {
    localStorage.setItem(claveRecorrido(id, 41), '1');
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: boton(id) }));
    expect(screen.getByRole('dialog', { name: titulos(id)[0] })).toBeInTheDocument();
  });
});

describe('lo que no está, se salta solo', () => {
  it('el Banco, en «Por número»: la lista es el resumen y el recorrido sale entero', async () => {
    pintar('whatsapp-banco');
    await cargada('whatsapp-banco');
    fireEvent.click(screen.getByRole('button', { name: /Por número/ }));
    await screen.findByRole('button', { name: '34600000000' }, { timeout: 5000 });
    expect(await abrirYRecorrer('whatsapp-banco')).toEqual(titulos('whatsapp-banco'));
  });

  it('Alumnos sin mensajes de una tutora: sin «Los tuyos o los de todos» ni «Sincronizar ahora»', async () => {
    comoTutora();
    pintar('consultas-alumnos');
    await cargada('consultas-alumnos');
    expect(await abrirYRecorrer('consultas-alumnos')).toEqual(titulos('consultas-alumnos', ['Los tuyos o los de todos', 'Sincronizar ahora']));
  });

  it('Alumnos sin mensajes de administración (sin ser tutora): con «Sincronizar ahora» y sin «Los tuyos o los de todos»', async () => {
    yo.current = { id: 41, role: 'admin', roles_extra: [] };
    permisos.delete('consultas.atender');
    pintar('consultas-alumnos');
    await cargada('consultas-alumnos');
    await screen.findByRole('button', { name: /Sincronizar ahora/ });
    expect(await abrirYRecorrer('consultas-alumnos')).toEqual(titulos('consultas-alumnos', ['Los tuyos o los de todos']));
  });

  it('Tutores sin campus sin tutor: se salta el aviso', async () => {
    datos.campusSinTutor = false;
    pintar('consultas-tutores');
    await cargada('consultas-tutores');
    expect(await abrirYRecorrer('consultas-tutores')).toEqual(titulos('consultas-tutores', ['Campus sin tutor']));
  });

  it('Métricas de una tutora: sin «Las tuyas o las de todos» ni el ranking', async () => {
    comoTutora();
    pintar('consultas-metricas');
    await cargada('consultas-metricas');
    expect(screen.queryByText('Ranking de tutores')).toBeNull();
    expect(await abrirYRecorrer('consultas-metricas')).toEqual(titulos('consultas-metricas', ['Las tuyas o las de todos', 'El ranking']));
  });

  it('Respuestas de un campus sin ninguna: el aviso de vacío ocupa el sitio de la lista y sale entero', async () => {
    api.get.mockImplementation(async (url) => (String(url).split('?')[0] === '/consultas/respuestas' ? { success: true, data: [] } : responder(url)));
    pintar('consultas-respuestas');
    await screen.findByText('Este campus aún no tiene respuestas preparadas', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('consultas-respuestas')).toEqual(titulos('consultas-respuestas'));
  });

  it.each([
    ['whatsapp-banco', ['whatsapp.usar']],
    ['whatsapp-actividad', ['reports.view']],
    ['consultas-carga', ['consultas.atender']],
    ['consultas-tutores', ['consultas.view']],
  ])('%s: sin su permiso, no ofrece recorrido', async (id, quitar) => {
    quitar.forEach((k) => permisos.delete(k));
    pintar(id);
    await cargada(id);
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });
});
