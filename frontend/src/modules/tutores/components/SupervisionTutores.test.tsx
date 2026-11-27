// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Supervisión de tutores (la dirección, 26/11/2026): la pestaña de «Mi campus» de quien tiene
 * `tutores.supervisar`.
 *   · la lista de los tutores de sus campus, con sus cifras;
 *   · al elegir uno: su campus (por responder, por corregir, cursos, por desarrollar), sus
 *     tareas con su último comentario y, si es redactora, lo que redacta;
 *   · solo lectura: ni «Responder», ni «Corregir», ni nada que escriba; ningún POST.
 */

const pedidas: string[] = [];
const escritas: string[] = [];
let permisos: Record<string, boolean> = {};

const TUTORES = [
  {
    id: 11, nombre: 'Redactora Uno', email: 'r1@campus.test', campus: ['ISEIE'], disponible: true, motivo_no_disponible: null,
    carga: { nivel: 'alta', texto: 'Tres módulos esta semana', created_at: '2026-11-25T10:00:00Z' }, carga_desactualizada: false,
    alumnos_activos: 12, consultas_abiertas: 2, alumnos_sin_mensajes: 1, es_redactora: true, tareas_abiertas: 1, por_desarrollar: 1,
  },
  {
    id: 12, nombre: 'Tutor Dos', email: 't2@campus.test', campus: ['ISEIE'], disponible: false, motivo_no_disponible: 'De vacaciones',
    carga: null, carga_desactualizada: true,
    alumnos_activos: 3, consultas_abiertas: 0, alumnos_sin_mensajes: 0, es_redactora: false, tareas_abiertas: 0, por_desarrollar: 0,
  },
];
const CAMPUS = {
  leidoAt: '2026-11-26T09:00:00Z',
  campus: [{
    projectId: 3, campus: 'ISEIE', url: 'https://campus.test', error: null, dudasSinCurso: [],
    cursos: [{
      id: 500, nombre: 'Curso de Neuropsicología', url: 'https://campus.test/course/view.php?id=500', error: null,
      alumnos: [{ id: 60 }], dudas: [{ consultaId: 1, alumnoId: 60, alumno: 'Alumno Sesenta', desde: '2026-11-24T10:00:00Z' }],
      tareas: [{ id: 900, nombre: 'Tarea final', entrega: null, corregirUrl: 'https://campus.test/x', sinCorregir: [{ alumnoId: 61, alumno: 'Alumno Sesenta y uno', entregadaAt: '2026-11-22T10:00:00Z' }] }],
      sinResponder: [],
    }],
  }],
  pendientes: [{ id: 5, nombre: 'Diplomado de Atención', tipo: 'diplomado', estado: 'en_desarrollo', campus: 'ISEIE', fechaComprometida: '2026-12-15', avance: { foto: true, video: false, modulos: 50 } }],
  sinConectar: [],
};
const TAREAS = [{
  id: 77, titulo: 'Redactar el módulo 3', estado: 'en_curso', columna: 'En curso', prioridad: 'alta', vence: '2026-12-01T00:00:00Z',
  creada: '2026-11-20T00:00:00Z', actualizada: '2026-11-25T00:00:00Z', hecha: null, equipo: 'Redactoras ISEIE', comentarios: 3,
  ultimoComentario: { texto: 'Subido el tema 2', at: '2026-11-25T12:00:00Z', autor: 'Redactora Uno' },
}];

const REDACCION = {
  es_redactora: true, rol_moodle: 'editingteacher', lista: false, sin_curso: [],
  campus: [{
    project_id: 3, campus: 'ISEIE', tiene_campus: true, campus_conectado: true, vinculada_en_crm: true,
    cuenta: { id: 9, nombre: 'Redactora Uno', suspendida: false, vinculada: true }, problemas: [],
    cursos: [{
      product_id: 1, producto: 'Producto 1', producto_activo: true, por: ['responsable'], curso_moodle_id: 1,
      curso_nombre: 'Curso sin matricular', estado: 'sin_matricula', roles: [], enlace: 'https://campus.test/user/index.php?id=1',
    }],
  }],
};

vi.mock('@/shared/api/client', () => ({
  default: {
    get: async (url: string) => {
      pedidas.push(url);
      if (url === '/tutores/supervision') return { success: true, data: { tutores: TUTORES } };
      if (/\/mi-campus/.test(url)) return { success: true, data: CAMPUS };
      if (/\/tareas$/.test(url)) return { success: true, data: TAREAS };
      if (/\/redaccion-moodle$/.test(url)) return { success: true, data: REDACCION };
      return { success: true, data: null };
    },
    post: async (url: string) => { escritas.push(url); return { success: true }; },
    patch: async (url: string) => { escritas.push(url); return { success: true }; },
    put: async (url: string) => { escritas.push(url); return { success: true }; },
    delete: async (url: string) => { escritas.push(url); return { success: true }; },
  },
}));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k: string) => permisos[k] === true }) }));

const { default: SupervisionTutores } = await import('./SupervisionTutores');

const pintar = (ruta = '/mis-cursos/campus?vista=supervision') => render(
  <MemoryRouter initialEntries={[ruta]}><SupervisionTutores /></MemoryRouter>,
);

beforeEach(() => { pedidas.length = 0; escritas.length = 0; permisos = { 'tutores.supervisar': true }; });
afterEach(() => { cleanup(); });

describe('supervisión de tutores', () => {
  it('la lista: cada tutor con sus cifras, la redactora marcada, y dice que es solo lectura', async () => {
    pintar();
    expect(await screen.findByText('Redactora Uno')).toBeTruthy();
    expect(screen.getByText('Tutor Dos')).toBeTruthy();
    expect(screen.getByText('Redactora')).toBeTruthy();
    expect(screen.getByText('2 consultas abiertas')).toBeTruthy();
    expect(screen.getByText('No disponible')).toBeTruthy();
    expect(screen.getByText('Solo lectura.')).toBeTruthy();
    expect(screen.getByText('Elige un tutor para ver su campus y sus tareas.')).toBeTruthy();
  });

  it('al elegir una tutora: su campus, sin botones para responder ni corregir', async () => {
    pintar();
    fireEvent.click(await screen.findByRole('button', { name: /Redactora Uno/ }));
    expect(await screen.findByText('Alumno Sesenta')).toBeTruthy();
    expect(pedidas).toContain('/tutores/supervision/11/mi-campus');
    expect(screen.getByText('Alumno Sesenta y uno · Tarea final')).toBeTruthy();
    expect(screen.getByText('Diplomado de Atención')).toBeTruthy();
    expect(screen.getByText('«Tres módulos esta semana»')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Responder|Corregir|Enviar|Cerrar/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Corregir|Responder/ })).toBeNull();
    // Lo único que se abre es el curso en Moodle, con su cuenta de Moodle.
    expect(screen.getByRole('link', { name: /Ver en Moodle/ }).getAttribute('href')).toContain('course/view.php?id=500');
  });

  it('sus tareas, con lo último que ha escrito; sin «Abrir en el tablero» si no ve todo el tablero', async () => {
    pintar('/mis-cursos/campus?vista=supervision&tutor=11');
    fireEvent.click(await screen.findByRole('tab', { name: /Sus tareas/ }));
    expect(await screen.findByText('Redactar el módulo 3')).toBeTruthy();
    expect(screen.getByText('Subido el tema 2')).toBeTruthy();
    expect(screen.getByText('Prioridad alta')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Abrir en el tablero' })).toBeNull();
  });

  it('el superadmin (ve todo el tablero) sí puede abrir la tarea', async () => {
    permisos = { 'tutores.supervisar': true, 'tasks.view_all': true };
    pintar('/mis-cursos/campus?vista=supervision&tutor=11');
    fireEvent.click(await screen.findByRole('tab', { name: /Sus tareas/ }));
    expect((await screen.findByRole('link', { name: 'Abrir en el tablero' })).getAttribute('href')).toBe('/tareas?id=77');
  });

  it('a un tutor que no redacta no se le ofrece «Lo que redacta»', async () => {
    pintar('/mis-cursos/campus?vista=supervision&tutor=12');
    const pestanas = await screen.findByRole('tablist');
    expect(within(pestanas).queryByRole('tab', { name: 'Lo que redacta' })).toBeNull();
    expect(screen.getByText('no la ha dicho todavía')).toBeTruthy();
  });

  it('lo que redacta: por la ruta de supervisión y sin el enlace para matricularla (eso es de coordinación)', async () => {
    pintar('/mis-cursos/campus?vista=supervision&tutor=11');
    fireEvent.click(await screen.findByRole('tab', { name: 'Lo que redacta' }));
    expect(await screen.findByText('Curso sin matricular')).toBeTruthy();
    expect(pedidas).toContain('/tutores/supervision/11/redaccion-moodle');
    expect(screen.getByText('Sin matricular')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Matricularla|Cambiarle el rol/ })).toBeNull();
  });

  it('en ningún momento escribe nada', async () => {
    pintar('/mis-cursos/campus?vista=supervision&tutor=11');
    await screen.findByText('Alumno Sesenta');
    fireEvent.click(screen.getByRole('tab', { name: /Sus tareas/ }));
    await screen.findByText('Redactar el módulo 3');
    expect(escritas).toEqual([]);
  });
});
