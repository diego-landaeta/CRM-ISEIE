// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/*
  El apartado Moodle del menú (Diego, 25/11/2026: «necesito que en el menú salga
  un apartado de Moodle, porque no se entiende del todo, y poder meter todo lo de
  Moodle ahí; entro y no me sale nada en el Moodle o no lo encuentro»).

  Se defiende:
    · el bloque «Moodle», detrás de Académico, con sus entradas en orden de uso;
    · cada perfil ve en él lo mismo que antes veía repartido (admin, superadmin,
      gestora, tutora y redactora), y a quien no le queda nada no le sale;
    · «Moodle › Cursos y alumnos» sigue al campus de arriba: con uno, sus cursos;
      sin Moodle, «Este campus no tiene Moodle conectado» con el enlace a
      Integraciones; con «Todos», la lista y el aviso de que se elija uno.

  Gemela de la del 360 (`src/test/apartadoMoodle.test.jsx`). Aquí «Mis cursos»
  de la tutora también va al apartado, junto a su Mi campus, e Integraciones es
  `/accounting/integrations`.
*/

const ctx = vi.hoisted(() => ({ proyecto: {}, user: { id: 1, role: 'superadmin' } }));
const api = vi.hoisted(() => ({
  campus: vi.fn(), cursos: vi.fn(), categorias: vi.fn(), revision: vi.fn(),
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: ctx.user, permissions: null }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ctx.proyecto }));
vi.mock('@/contexts/ThemeContext', () => ({ useTheme: () => ({}), useOptionalTheme: () => 'dark' }));
vi.mock('@/shared/api/client', () => ({ default: { get: vi.fn(async () => ({ success: true, data: null })), post: vi.fn() } }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/moodle/api/moodle.api', () => ({ moodleApi: api }));

const { NAV_SECTIONS, entradasDeSeccion, canSeeItem, nombreDeSeccion } = await import('@/shared/components/layout/Sidebar');
const { crearCan } = await import('@/shared/hooks/usePermission');
const { rolesDe } = await import('@/shared/lib/roles');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { ORDEN_DENTRO_DEL_BLOQUE, APARTADO_MOODLE } = await import('@/shared/components/layout/bloquesDelMenu');
const { default: MoodlePage } = await import('@/modules/moodle/pages/MoodlePage');

afterEach(cleanup);

/** Lo que ve alguien, por bloque: { [bloque]: [entradas] }, con el nombre que ve del bloque. */
function menuDe(role, { roles_extra = [], permisos = null } = {}) {
  const user = { id: 1, role, roles_extra };
  const mapa = permisos
    ? Object.fromEntries(permisos.map((p) => [p, true]))
    : resolverPermisos({ role, roles_extra, excepciones: {} }).mapa;
  const can = crearCan(user, mapa);
  const out = {};
  for (const s of NAV_SECTIONS) {
    const items = entradasDeSeccion(s, { user, can, soloColab: false })
      .flatMap((it) => (it.children ? it.children.filter((c) => canSeeItem(c, rolesDe(user), false, user, can)) : [it]))
      .map((it) => it.label);
    if (items.length) out[nombreDeSeccion(s, user)] = items;
  }
  return out;
}

const ORDEN = ORDEN_DENTRO_DEL_BLOQUE.Moodle;
const enOrden = (lista) => lista.every((x, i) => i === 0 || ORDEN.indexOf(lista[i - 1]) < ORDEN.indexOf(x));

describe('el apartado Moodle del menú (Diego, 25/11)', () => {
  it('es un bloque propio, justo detrás de Académico, y está aprobado', () => {
    const nombres = NAV_SECTIONS.map((s) => s.label);
    expect(nombres.indexOf('Moodle')).toBe(nombres.indexOf('Académico') + 1);
    expect(APARTADO_MOODLE.aprobadoPor).toBe('Diego, 25/11');
  });

  it('trae todo lo de Moodle, en orden de uso, y lo de Moodle ya no está en otro bloque', () => {
    const moodle = NAV_SECTIONS.find((s) => s.label === 'Moodle').items;
    const rutas = moodle.map((i) => i.to);
    for (const r of ['/mis-cursos/campus', '/mis-cursos', '/consultas', '/conexion/moodle', '/products/cursos-moodle', '/products/pending', '/moodle/conexion']) {
      expect(rutas, r).toContain(r);
    }
    expect(enOrden(moodle.map((i) => i.label))).toBe(true);
    expect(moodle.find((i) => i.to === '/conexion/moodle').label).toBe('Cursos y alumnos');
    const fuera = NAV_SECTIONS.filter((s) => s.label !== 'Moodle')
      .flatMap((s) => s.items.flatMap((i) => [i, ...(i.children || [])]))
      .filter((i) => ['/mis-cursos/campus', '/mis-cursos', '/consultas', '/conexion/moodle', '/products/cursos-moodle', '/products/pending', '/matriculas/diplomas'].includes(i.to));
    expect(fuera.map((i) => i.label)).toEqual([]);
  });

  it('cada entrada conserva su permiso de siempre; la conexión del campus, el de Integraciones', () => {
    const moodle = NAV_SECTIONS.find((s) => s.label === 'Moodle').items;
    const por = (to) => moodle.find((i) => i.to === to);
    expect(por('/conexion/moodle').permiso).toBe('moodle.view');
    expect(por('/products/cursos-moodle').permiso).toBe('moodle.cursos_producto');
    expect(por('/moodle/conexion').permiso).toBe('integrations.view');
    const integraciones = NAV_SECTIONS.flatMap((s) => s.items).find((i) => i.to === '/accounting/integrations');
    expect(por('/moodle/conexion').roles).toEqual(integraciones.roles);
  });

  it('superadmin: todo el apartado, en orden', () => {
    const m = menuDe('superadmin').Moodle;
    expect(m).toEqual(expect.arrayContaining(['Mi campus', 'Consultas', 'Cursos y alumnos', 'Cursos de Moodle', 'Cursos pendientes', 'Conexión del campus']));
    expect(enOrden(m)).toBe(true);
  });

  it('admin: Mi campus, Cursos y alumnos, Cursos de Moodle y la conexión del campus', () => {
    const m = menuDe('admin').Moodle;
    expect(m).toEqual(expect.arrayContaining(['Mi campus', 'Cursos y alumnos', 'Cursos de Moodle', 'Conexión del campus']));
    expect(enOrden(m)).toBe(true);
  });

  it('gestora: solo lo que ya veía (Cursos pendientes); nada de Cursos y alumnos ni de la conexión', () => {
    const menu = menuDe('gestor');
    expect(menu.Moodle).toEqual(['Cursos pendientes']);
    expect(Object.values(menu).flat()).not.toContain('Conexión del campus');
  });

  it('tutora: su Mi campus, sus cursos y sus Consultas, en el apartado Moodle; nada más de él', () => {
    const menu = menuDe('tutor');
    expect(menu.Moodle).toEqual(expect.arrayContaining(['Mi campus', 'Mis cursos', 'Consultas']));
    expect(enOrden(menu.Moodle)).toBe(true);
    expect(menu['Académico']).toBeUndefined();
    for (const no of ['Cursos y alumnos', 'Cursos de Moodle', 'Conexión del campus', 'Diplomas']) expect(menu.Moodle).not.toContain(no);
  });

  it('redactora: Mi campus y Consultas en Moodle, y su «Mis tareas» como siempre', () => {
    const REDACTOR = ['tasks.view_own', 'tasks.create', 'tasks.edit', 'facturas_colaborador.subir', 'tutores.mis_cursos', 'consultas.atender'];
    const menu = menuDe('tutor_redactor', { permisos: REDACTOR });
    expect(menu.Moodle).toEqual(expect.arrayContaining(['Mi campus', 'Consultas']));
    expect(enOrden(menu.Moodle)).toBe(true);
    expect(menu['Mis tareas']).toEqual(expect.arrayContaining(['Mi tablero', 'Historial de tareas']));
  });

  it('a quien no le queda ninguna entrada de Moodle, el bloque no le sale', () => {
    expect(menuDe('colaborador').Moodle).toBeUndefined();
  });
});

const abrir = () => render(<MemoryRouter><MoodlePage /></MemoryRouter>);
const conectado = { id: 7, nombre: 'Psiko Aprende', configurado: true, conexion: 'integraciones', cursos: { total: 2, activos: 1, proximos: 0, terminados: 0, ocultos: 1 } };
const sinMoodle = { id: 8, nombre: 'Fono Aprende', configurado: false, conexion: null };

describe('Moodle › Cursos y alumnos sigue al campus de arriba', () => {
  beforeEach(() => {
    for (const f of Object.values(api)) f.mockReset();
    api.categorias.mockResolvedValue({ data: { categorias: [] } });
    api.revision.mockResolvedValue({ data: { total: 0, revisados: 0, no_leidos: 0, pendientes: 0, saturado: false, espera_s: 0, hallazgos: { sin_alumnos: [], dormidos: [], con_nunca_entraron: [] } } });
    api.cursos.mockResolvedValue({ data: { total: 1, pagina: 1, limite: 25, cursos: [{ campus_id: 7, curso_id: 11, nombre: 'Máster en Psicología', nombre_corto: 'MP', categoria: null, estado: 'activo', visible: true, inicio: null, fin: null, finalizacion_activada: false, alumnos: 2 }], resumen: { cursos_en_moodle: 2, de_cache: false, actualizado_hace_s: 0 } } });
  });

  it('con un campus elegido: sus cursos, sin pasar por la lista', async () => {
    ctx.proyecto = { activeProject: { id: 7, nombre: 'Psiko Aprende', type: 'crm' }, isAllProjects: false, activeIssuerId: null };
    api.campus.mockResolvedValue({ data: { campus: [conectado], funciones: [] } });
    abrir();
    expect((await screen.findAllByText('Máster en Psicología')).length).toBeGreaterThan(0);
    expect(api.campus).toHaveBeenCalledWith(expect.objectContaining({ proyectoId: 7 }));
    expect(screen.queryByText('Todos los campus')).toBeNull();
  });

  it('un campus sin Moodle: lo dice y lleva a Integraciones › Moodle de ese campus', async () => {
    ctx.proyecto = { activeProject: { id: 8, nombre: 'Fono Aprende', type: 'crm' }, isAllProjects: false, activeIssuerId: null };
    api.campus.mockResolvedValue({ data: { campus: [sinMoodle], funciones: [] } });
    abrir();
    expect(await screen.findByText('Este campus no tiene Moodle conectado')).toBeTruthy();
    const enlace = screen.getByRole('link', { name: /Integraciones › Moodle/ });
    expect(enlace.getAttribute('href')).toBe('/accounting/integrations?campus=8&seccion=moodle');
  });

  it('con «Todos»: la lista de campus y el aviso de que se elija uno', async () => {
    ctx.proyecto = { activeProject: { id: -1 }, isAllProjects: true, activeIssuerId: null };
    api.campus.mockResolvedValue({ data: { campus: [conectado, sinMoodle], funciones: [] } });
    abrir();
    await waitFor(() => expect(api.campus).toHaveBeenCalled());
    expect(api.campus.mock.calls[0][0]?.proyectoId).toBeUndefined();
    expect(await screen.findByTestId('moodle-elige-campus')).toBeTruthy();
    expect((await screen.findAllByText('Psiko Aprende')).length).toBeGreaterThan(0);
  });
});
