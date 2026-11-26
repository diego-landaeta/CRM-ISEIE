// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  #619, tanda F (gemela de CRM#941): «Ver recorrido» en Tutores (la lista y la
  ficha del tutor, que es la misma pantalla: no hay `/tutores/:id`) y en
  Proceso comercial.

  Se pinta cada pantalla de verdad, con datos en los que sale todo, y se recorre
  entera. Lo que no está en ese momento se salta solo: la ficha sin tutor
  elegido (sus formaciones y sus consultas), un proceso sin pasos, y lo que es de
  quien configura los pasos para quien solo los ve. Que cada anclaje sigue en el
  código y que los permisos existen lo comprueba `recorridosCobros.test.jsx`; que
  el cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, api, yo, ambito, datos } = vi.hoisted(() => ({
  permisos: new Set(),
  api: { get: vi.fn() },
  yo: { current: { id: 41, role: 'admin' } },
  ambito: { current: null },
  datos: { pasos: true },
}));

vi.mock('@/shared/api/client', () => ({
  default: {
    get: (...a) => api.get(...a),
    post: vi.fn(async () => ({ success: true, data: {} })),
    patch: vi.fn(async () => ({ success: true })),
    delete: vi.fn(async () => ({ success: true })),
  },
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/useAmbito', () => ({
  useIdsDelAmbito: () => ambito.current.projects.map((p) => p.id),
  useProyectosDelAmbito: () => ambito.current.projects,
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));

const { RECORRIDOS_COBROS, claveRecorrido } = await import('@/shared/lib/recorridosCobros');
const { RECORRIDOS_GESTORA_D } = await import('@/shared/lib/recorridosGestoraD');
const { recorridosDeLaRuta } = await import('@/shared/lib/recorridosPorRuta');
const { default: TutoresPage } = await import('@/modules/tutores/pages/TutoresPage');
const { default: ProcesoPage } = await import('@/modules/proceso/pages/ProcesoPage');

const SRC = path.resolve(__dirname, '..');
const CAMPUS = [{ id: 1, nombre: 'Campus Uno', sociedad_emisora_id: 3 }];
const UN_CAMPUS = { activeProject: CAMPUS[0], projects: CAMPUS, isAllProjects: false, activeIssuer: null, activeIssuerId: null };

const TUTORA = {
  id: 41, nombre: 'Laura Tutora', email: 'laura@ejemplo.com', active: true, last_login_at: null, pendiente_de_entrar: true,
  dni_nif: null, iban: null, banco: null, telefono: null, notas: null, formaciones: 1, proyectos: 1,
  marcas: 'Campus Uno', es_de_este_proyecto: true,
};
const COLABORACION = {
  id: 5, tutor_id: 41, product_id: 11, pct: '10', vigente_desde: '2026-09-01', vigente_hasta: null, activa: true, notas: null,
  tutor: 'Laura Tutora', formacion: 'Máster en Psicología', precio: '1200', project_id: 1, proyecto: 'Campus Uno',
  rige_hoy: true, entrego_foto: true, entrego_video: false, modulos_pct: 50,
};
const PASO = {
  id: 1, project_id: 1, clave: 'bienvenida', nombre: 'Bienvenida', orden: 1, cuando: null, dia_desde: 0, dia_hasta: 1,
  canales: ['llamada', 'whatsapp'], es_seguimiento: false, nota: 'Presentarse y preguntar qué busca.', activo: true,
};
const RESPUESTAS = {
  '/tutores': { success: true, data: [TUTORA] },
  '/tutores/colaboraciones': { success: true, data: [COLABORACION] },
  '/tutores/ajustes': { success: true, data: { aplica_desde: '2026-08-01', pct_por_defecto: 10, correos_a_tutores: false } },
  '/tutores/41/campus': {
    success: true,
    data: {
      campus: [{
        project_id: 1, campus: 'Campus Uno', via: 'campus', issuer_id: null, empresa: null, campus_conectado: true,
        estado: 'activa', comprobado_at: '2026-11-20T10:00:00Z', error: null, propio: true,
      }],
      empresas: [], disponible: true, motivo_no_disponible: null, no_disponible_desde: null, avisos: [],
    },
  },
  '/proceso/pasos': () => ({ success: true, data: datos.pasos ? [PASO] : [] }),
};
/** La respuesta por la ruta, sin la parte de los parámetros. */
const responder = async (url) => {
  const r = RESPUESTAS[String(url).split('?')[0]];
  return (typeof r === 'function' ? r() : r) ?? { success: true, data: [] };
};

const PANTALLAS = {
  tutores: { pintar: () => <TutoresPage />, cargada: 'Laura Tutora' },
  'proceso-comercial': { pintar: () => <ProcesoPage />, cargada: 'Bienvenida' },
};
const IDS = Object.keys(PANTALLAS);
const boton = (id) => `Ver recorrido: ${RECORRIDOS_GESTORA_D[id].titulo}`;
const pintar = (id) => render(<MemoryRouter>{PANTALLAS[id].pintar()}</MemoryRouter>);
const titulos = (id, fuera = []) => RECORRIDOS_GESTORA_D[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
const cargada = (id) => screen.findAllByText(PANTALLAS[id].cargada, {}, { timeout: 5000 });

/** Pulsa la tutora en la lista y espera su ficha entera (formaciones y consultas). */
async function elegirTutora() {
  fireEvent.click(screen.getAllByText('Laura Tutora')[0].closest('button'));
  await screen.findByText('Máster en Psicología', {}, { timeout: 5000 });
  await screen.findByText('Consultas de alumnos', {}, { timeout: 5000 });
}

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

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  ['tutores.gestionar', 'tutores.contrasena', 'proceso.view', 'proceso.configurar_pasos'].forEach((k) => permisos.add(k));
  yo.current = { id: 41, role: 'admin' };
  ambito.current = UN_CAMPUS;
  datos.pasos = true;
  api.get.mockReset();
  api.get.mockImplementation(responder);
});
afterEach(() => cleanup());

describe('el día a día, cuarta tanda, en el modelo (#619, tanda F)', () => {
  it('son dos, Tutores y Proceso comercial, y están registrados con los demás', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_D)).toEqual(['tutores', 'proceso-comercial']);
    for (const id of IDS) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_GESTORA_D[id]);
  });

  it('cada uno con el permiso con el que el menú deja ver su pantalla', () => {
    expect(RECORRIDOS_GESTORA_D.tutores.permiso).toBe('tutores.gestionar');
    expect(RECORRIDOS_GESTORA_D['proceso-comercial'].permiso).toBe('proceso.view');
  });

  it.each(IDS)('%s: de 5 a 8 pasos, y su pantalla lo ofrece con «Ver recorrido» y el margen de scroll', (id) => {
    const r = RECORRIDOS_GESTORA_D[id];
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    const codigo = r.pantalla.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('la ficha del cliente no lleva otro: en main ya tiene «Avance del alumno» (avance-alumno)', () => {
    const rutas = Object.values(RECORRIDOS_GESTORA_D).flatMap((r) => r.rutas);
    expect(rutas).not.toContain('/clients/:id');
    expect(rutas).not.toContain('/tutores/comisiones');
  });
});

describe('el botón «Recorrido» de la cabecera los encuentra por su ruta', () => {
  it('cada pantalla, el suyo, y las vecinas siguen con el suyo', () => {
    expect(recorridosDeLaRuta('/tutores')).toEqual(['tutores']);
    expect(recorridosDeLaRuta('/tutores/')).toEqual(['tutores']);
    expect(recorridosDeLaRuta('/leads/proceso')).toEqual(['proceso-comercial']);
    expect(recorridosDeLaRuta('/tutores/comisiones')).toEqual(['comisiones-tutores']);
    expect(recorridosDeLaRuta('/leads/12')).toEqual(['prospecto-ficha']);
    expect(recorridosDeLaRuta('/leads/cola')).toEqual(['cola-del-dia']);
  });
});

describe.each(IDS)('%s: la pantalla de verdad, recorrida entera', (id) => {
  it('nunca sale solo (#681), ni la primera vez; con su botón se recorre sin saltarse nada', async () => {
    pintar(id);
    await cargada(id);
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: titulos(id)[0] })).toBeNull();
    if (id === 'tutores') await elegirTutora();
    expect(localStorage.getItem(claveRecorrido(id, 41))).toBeNull();
    expect(await abrirYRecorrer(id)).toEqual(titulos(id));
    await waitFor(() => expect(localStorage.getItem(claveRecorrido(id, 41))).toBe('1'));
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('en la pantalla hay un solo «Ver recorrido»', async () => {
    pintar(id);
    await cargada(id);
    if (id === 'tutores') await elegirTutora();
    expect(screen.getAllByRole('button', { name: /^Ver recorrido/ })).toHaveLength(1);
  });
});

describe('lo que no está, se salta solo', () => {
  it('Tutores sin ninguno elegido: la ficha se señala vacía y se saltan sus formaciones y sus consultas', async () => {
    pintar('tutores');
    await cargada('tutores');
    expect(screen.getByText('Elige un tutor')).toBeInTheDocument();
    expect(await abrirYRecorrer('tutores')).toEqual(titulos('tutores', ['Sus formaciones', 'Consultas de alumnos']));
  });

  it('Tutores con uno sin formaciones: «Sus formaciones» señala el aviso de que no tiene ninguna', async () => {
    api.get.mockImplementation(async (url) => (String(url).split('?')[0] === '/tutores/colaboraciones'
      ? { success: true, data: [] } : responder(url)));
    pintar('tutores');
    await cargada('tutores');
    fireEvent.click(screen.getAllByText('Laura Tutora')[0].closest('button'));
    await screen.findByText('Sin formaciones asignadas', {}, { timeout: 5000 });
    await screen.findByText('Consultas de alumnos', {}, { timeout: 5000 });
    expect(await abrirYRecorrer('tutores')).toEqual(titulos('tutores'));
  });

  it('Proceso comercial de quien solo lo ve: sin «Editar y ordenar» ni «Nuevo paso»', async () => {
    permisos.delete('proceso.configurar_pasos');
    pintar('proceso-comercial');
    await cargada('proceso-comercial');
    expect(await abrirYRecorrer('proceso-comercial')).toEqual(titulos('proceso-comercial', ['Editar y ordenar', 'Nuevo paso']));
  });

  it('Proceso comercial sin pasos: se saltan los pasos, sus plantillas y editarlos', async () => {
    datos.pasos = false;
    pintar('proceso-comercial');
    await screen.findByText(/Crea el primero/, {}, { timeout: 5000 });
    expect(await abrirYRecorrer('proceso-comercial'))
      .toEqual(titulos('proceso-comercial', ['Los pasos', 'Plantillas de este paso', 'Editar y ordenar']));
  });

  it.each([
    ['tutores', 'tutores.gestionar'],
    ['proceso-comercial', 'proceso.view'],
  ])('%s: sin su permiso, no ofrece recorrido', async (id, quitar) => {
    permisos.delete(quitar);
    pintar(id);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
  });
});
