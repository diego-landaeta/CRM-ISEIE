// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda D (gemela de CRM#941; Diego, 19/11: «las que son así, dáselas a
  Ángel CEDIA»): «Ver recorrido» en las siguientes por uso después de la tanda
  C: el Seguimiento de fin de mes, la Conexión de WhatsApp (el chat y Plantillas
  ya tienen el suyo) y las Consultas de los alumnos, la bandeja y la consulta
  abierta.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera: cada paso encuentra su sitio y ninguno se salta. Lo que esa persona no
  tiene en ese momento (el aviso de antes de enlazar con el número ya enlazado,
  «Leer el campus ahora» sin permiso) se salta solo. Que cada anclaje sigue en
  el código y que los permisos existen lo comprueba `recorridosCobros.test.jsx`;
  que el cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito, whatsapp } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
  whatsapp: { conectado: false },
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
const { RECORRIDOS_GESTORA_B } = await import('@/shared/lib/recorridosGestoraB');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: SeguimientoPage } = await import('@/modules/proceso/pages/SeguimientoPage');
const { default: ConexionPage } = await import('@/modules/whatsapp/pages/ConexionPage');
const { default: ConsultasPage } = await import('@/modules/consultas/pages/ConsultasPage');
const { default: ConsultaPage } = await import('@/modules/consultas/pages/ConsultaPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [
  { id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 },
  { id: 2, nombre: 'Campus Dos', sociedad_emisora_id: 3 },
];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: [CAMPUS[0]], isAllProjects: false, activeIssuer: null, activeIssuerId: null };
const EMPRESA = {
  activeProject: { id: -1, nombre: 'Todos' }, projects: CAMPUS, isAllProjects: true,
  activeIssuer: { id: 3, nombre: 'Empresa de prueba', campus: CAMPUS }, activeIssuerId: 3,
};

const FILA = {
  lead_id: 5, lead_nombre: 'Ana Pérez', lead_email: 'ana@ejemplo.com', lead_telefono: '+34600000000',
  lead_estado: 'contactado', clave: 'paso_2', orden: 2, paso_nombre: 'Seguimiento 2', paso_nota: null,
  canales: ['whatsapp', 'email'], producto: 'Máster', proyecto: 'Campus Uno', gestora: 'Laura',
  contactos: 0, avisa_plazas: false,
};
const hace = (h) => new Date(Date.now() - h * 3600000).toISOString();
const CONSULTA = {
  id: 7, project_id: 1, campus: 'Campus Uno', empresa: null, alumno_nombre: 'Bea Ruiz', alumno_email: 'bea@ejemplo.com',
  curso_nombre: 'Máster en Psicología', tutor_id: 41, tutor: 'Laura', estado: 'abierta', entrada_at: hace(5),
  asignada_at: hace(5), primera_lectura_at: null, primera_respuesta_at: null, cerrada_at: null, reabierta_at: null,
  espera_desde: hace(5), ultimo_mensaje: 'No encuentro el temario del módulo 2', sin_enviar: 0,
};
const RESPUESTAS = {
  '/proceso/seguimiento/resumen': { success: true, data: { total: 2, este_mes: 1, uno_a_tres: 1, tres_a_seis: 0, mas_de_seis: 0, nunca_contactados: 1 } },
  '/proceso/seguimiento': {
    success: true,
    data: [{
      ...FILA, fecha_entrada: '2026-10-01', dias_desde_entrada: 49, ultimo_contacto: null,
      dias_sin_contacto: null, antiguedad: 'uno_a_tres',
    }],
    pagination: { total: 1, totalPages: 1 },
    formaciones: [{ ids: [9], nombre: 'Máster', personas: 1 }],
  },
  '/whatsapp/conexion': () => ({
    success: true,
    data: whatsapp.conectado
      ? { configurado: true, conectado: true, nombre: 'Laura', numero: '34600000000', instancia: 'u41' }
      : { configurado: true, conectado: false, instancia: 'u41' },
  }),
  '/whatsapp/sincronizacion': { success: true, data: { conversaciones: 12, mensajes: 340, entrando: false, haceSegundos: 90, adjuntosPendientes: 0, progreso: null } },
  '/whatsapp/respuesta-llamada': { success: true, data: { activa: false, texto: '', disponible: true } },
  '/consultas/mias': { success: true, data: { consultas: [CONSULTA], total: 1, plazoHoras: 24 } },
  '/consultas': { success: true, data: { consultas: [CONSULTA], total: 1, plazoHoras: 24 } },
  '/consultas/7': {
    success: true,
    data: {
      ...CONSULTA, plazoHoras: 24, puedes: 'tutor', eventos: [], notas: [],
      mensajes: [{
        id: 1, autor: 'alumno', autor_nombre: 'Bea Ruiz', texto: 'No encuentro el temario del módulo 2',
        escrito_at: hace(5), enviado_campus_at: null, error_envio: null, en_el_campus: true, adjuntos: [],
      }],
    },
  },
  '/consultas/7/contexto': {
    success: true,
    data: { cursos: [{ id: 3, nombre: 'Máster en Psicología', ultimoAcceso: hace(30), url: 'https://campus.ejemplo/course/view.php?id=3' }], entregas: [], anteriores: [], error: null },
  },
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => {
  const r = RESPUESTAS[String(url).split('?')[0]];
  return (typeof r === 'function' ? r() : r) ?? { success: true, data: [] };
};

const PANTALLAS = {
  'seguimiento-fin-de-mes': { pintar: () => <SeguimientoPage />, cargada: 'Ana Pérez', empresa: true },
  'whatsapp-conexion': { pintar: () => <ConexionPage />, cargada: 'Todavía no has enlazado tu número.' },
  consultas: {
    pintar: () => <ConsultasPage />,
    cargada: 'Bea Ruiz',
    // Tutora y administración a la vez: abre en «Mis consultas»; en «Todas» sale además «Leer el campus ahora».
    preparar: async () => {
      fireEvent.click(within(screen.getByRole('tablist', { name: 'Qué consultas' })).getByRole('tab', { name: 'Todas' }));
      await screen.findByRole('button', { name: /Leer el campus ahora/ });
    },
  },
  consulta: {
    pintar: () => <Routes><Route path="/consultas/:id" element={<ConsultaPage />} /></Routes>,
    ruta: '/consultas/7',
    cargada: 'Ficha del alumno',
  },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_B[id].titulo}`;
const pintar = (id) => {
  if (PANTALLAS[id].empresa) ambito.current = EMPRESA;
  return render(<MemoryRouter initialEntries={[PANTALLAS[id].ruta || '/']}>{PANTALLAS[id].pintar()}</MemoryRouter>);
};
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_B[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
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

// Lo que se ve de la Conexión según esté o no enlazado el número.
const SOLO_ENLAZADO = ['Lo que ha entrado', 'Si te llaman'];
const SOLO_SIN_ENLAZAR = ['Antes de enlazar, lee esto', 'Qué te traes del móvil'];

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  ['proceso.view', 'leads.view', 'whatsapp.usar', 'consultas.view', 'consultas.atender', 'consultas.gestionar'].forEach((k) => permisos.add(k));
  // Superadmin y tutora a la vez: ve «Mis consultas / Todas» y «Leer el campus ahora».
  yo.current = { id: 41, role: 'superadmin', roles_extra: ['tutor'] };
  ambito.current = UN_CAMPUS;
  whatsapp.conectado = false;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('el día a día, segunda tanda, en el modelo (#619, tanda D)', () => {
  it('son cuatro, por uso, y están registrados con los demás (VerRecorrido y la prueba a 375 los ven)', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_B)).toEqual(['seguimiento-fin-de-mes', 'whatsapp-conexion', 'consultas', 'consulta']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_B[id]);
  });

  it('cada uno con el permiso con el que el menú y el servidor dejan ver su pantalla', () => {
    expect(Object.fromEntries(Object.values(RECORRIDOS_GESTORA_B).map((r) => [r.id, r.permiso]))).toEqual({
      'seguimiento-fin-de-mes': 'proceso.view',
      'whatsapp-conexion': 'whatsapp.usar',
      consultas: ['consultas.view', 'consultas.atender'],
      consulta: ['consultas.view', 'consultas.atender'],
    });
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con «Ver recorrido»', (id) => {
    const r = RECORRIDOS_GESTORA_B[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    // La consulta abierta no se desplaza (va a pantalla entera): no le hace falta el margen.
    if (id !== 'consulta') expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('el chat de WhatsApp y Plantillas no se repiten: ya tienen el suyo', () => {
    const titulos = Object.values(RECORRIDOS_COBROS).map((r) => r.titulo.toLowerCase());
    expect(titulos.some((t) => t.includes('plantilla'))).toBe(false);
    expect(Object.values(RECORRIDOS_COBROS).flatMap((r) => r.rutas)).not.toEqual(expect.arrayContaining(['/whatsapp', '/whatsapp/chat', '/whatsapp/plantillas']));
  });

  it('sin «consultas.gestionar», no sale «Leer el campus ahora»', () => {
    const vistos = pasosPara(RECORRIDOS_GESTORA_B.consultas, (k) => k === 'consultas.atender').map((p) => p.titulo);
    expect(vistos).not.toContain('Leer el campus ahora');
    expect(vistos).toHaveLength(RECORRIDOS_GESTORA_B.consultas.pasos.length - 1);
  });
});

describe('el botón «Recorrido» de la cabecera los encuentra por su ruta', () => {
  it('cada pantalla, el suyo', () => {
    expect(recorridosDeLaRuta('/leads/seguimiento')).toEqual(['seguimiento-fin-de-mes']);
    expect(recorridosDeLaRuta('/whatsapp/conexion')).toEqual(['whatsapp-conexion']);
    expect(recorridosDeLaRuta('/consultas')).toEqual(['consultas']);
    expect(recorridosDeLaRuta('/consultas/7')).toEqual(['consulta']);
    expect(recorridosDeLaRuta('/consultas/7/')).toEqual(['consulta']);
  });

  it('una pantalla con nombre no es una ficha: «/consultas/metricas» no ofrece el de la consulta', () => {
    for (const ruta of ['/consultas/alumnos', '/consultas/carga', '/consultas/tutores', '/consultas/metricas', '/consultas/respuestas']) {
      expect(recorridosDeLaRuta(ruta), ruta).toEqual([]);
    }
    // Lo mismo con la ficha del prospecto (tanda C): Proceso comercial y Convocatorias no son un prospecto.
    expect(recorridosDeLaRuta('/leads/proceso')).toEqual([]);
    expect(recorridosDeLaRuta('/leads/convocatorias')).toEqual([]);
    expect(recorridosDeLaRuta('/leads/12')).toEqual(['prospecto-ficha']);
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
    // La Conexión, sin enlazar: lo de después de enlazar se salta (se recorre enlazado abajo).
    const fuera = id === 'whatsapp-conexion' ? SOLO_ENLAZADO : [];
    expect(await abrirYRecorrer(id)).toEqual(titulos(id, fuera));
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
  it('la Conexión con el número ya enlazado: lo que ha entrado y las llamadas, sin el aviso ni el historial', async () => {
    whatsapp.conectado = true;
    pintar('whatsapp-conexion');
    await screen.findByText(/Conectado como/, {}, { timeout: 5000 });
    await screen.findByText('Si te llaman por WhatsApp', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('whatsapp-conexion')).toEqual(titulos('whatsapp-conexion', SOLO_SIN_ENLAZAR));
  });

  it('Consultas de una tutora (sin administración): sin «Leer el campus ahora» ni «Las tuyas o todas»', async () => {
    yo.current = { id: 41, role: 'tutor', roles_extra: [] };
    permisos.delete('consultas.view');
    permisos.delete('consultas.gestionar');
    pintar('consultas');
    await cargada('consultas');
    expect(await abrirYRecorrer('consultas')).toEqual(titulos('consultas', ['Leer el campus ahora', 'Las tuyas o todas']));
  });

  it('una consulta vista por administración: la caja va en modo nota y el recorrido sale entero', async () => {
    // Administración solo deja notas: la caja sigue (en modo nota) y el paso también.
    api.get.mockImplementation(async (url) => (String(url).split('?')[0] === '/consultas/7'
      ? { success: true, data: { ...(await responder(url)).data, puedes: 'admin' } }
      : responder(url)));
    pintar('consulta');
    await cargada('consulta');
    await screen.findByText('Guardar nota', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('consulta')).toEqual(titulos('consulta'));
  });

  it('una consulta cerrada de una tutora: sin la caja, se salta «Responder»', async () => {
    api.get.mockImplementation(async (url) => (String(url).split('?')[0] === '/consultas/7'
      ? { success: true, data: { ...(await responder(url)).data, estado: 'cerrada' } }
      : responder(url)));
    pintar('consulta');
    await screen.findByText(/Consulta cerrada/, {}, { timeout: 5000 });
    expect(await abrirYRecorrer('consulta')).toEqual(titulos('consulta', ['Responder']));
  });

  it('sin «whatsapp.usar», la Conexión no ofrece recorrido', async () => {
    permisos.delete('whatsapp.usar');
    pintar('whatsapp-conexion');
    await cargada('whatsapp-conexion');
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });
});
