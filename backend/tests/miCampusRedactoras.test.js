import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Mi campus» para las tutoras redactoras, con uno o varios campus (Diego, 24/11/2026:
 * «pon lo nuevo del campus para responder… que lleguen las tareas y corregirlas desde
 * ahí. Que eso sea para las tutoras redactoras, y que puedan ver entre uno y varios
 * campus»).
 *
 *  1. La redactora (`tutor_redactor`) entra en todo lo de Mi campus: leerlo, abrir una
 *     tarea y sus archivos, poner la nota, y sus consultas (verlas y responderlas). Lo
 *     que no es suyo (prospectos, ventas), 403 como siempre. Y de serie trae los dos
 *     permisos que lo abren: `tutores.mis_cursos` y `consultas.atender`.
 *  2. `?campus=` lee de Moodle SOLO los campus elegidos, de entre los suyos: uno que no
 *     es suyo no se lee; si no queda ninguno, todos. `todosLosCampus` dice cuáles tiene,
 *     para el selector, aunque solo se haya leído uno.
 *  3. La copia de dos minutos va por campus: cambiar de selección no vuelve a leer lo
 *     que ya se leyó.
 *
 * Sin base ni Moodle: `query` de mentira y las llamadas a Moodle, funciones contadas.
 *
 *   cd backend && npx vitest run tests/miCampusRedactoras.test.js
 */

const query = vi.fn(async (sql) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('FROM tutor_campus tc') && s.includes('tc.moodle_user_id IS NOT NULL')) {
    return { rows: [
      { project_id: 7, moodle_user_id: 701, campus: 'ISSLOGG' },
      { project_id: 8, moodle_user_id: 801, campus: 'ISEF' },
    ] };
  }
  if (s.includes('FROM tutor_campus tc')) {
    return { rows: [{ project_id: 9, campus: 'Fono', estado: 'pendiente', error: null, moodle_user_id: null }] };
  }
  if (s.includes('FROM cursos_pendientes')) {
    return { rows: [
      { id: 1, nombre: 'Curso de ISEF', tipo: 'curso', estado: 'en_desarrollo', project_id: 8, campus: 'ISEF', avance_modulos: 10 },
      { id: 2, nombre: 'Curso de ISSLOGG', tipo: 'curso', estado: 'en_desarrollo', project_id: 7, campus: 'ISSLOGG', avance_modulos: 0 },
    ] };
  }
  if (s.includes('FROM consultas')) return { rows: [] };
  throw new Error(`SQL sin preparar en el test: ${s.slice(0, 80)}`);
});
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));
vi.mock('../src/modules/tutores/tutor.campus.js', () => ({
  conexionDelCampus: vi.fn(async (projectId) => ({ url: `https://campus${projectId}.test`, token: `token-${projectId}` })),
}));
/** Qué campus se han leído de Moodle (por la dirección de la conexión). */
const leidos = vi.hoisted(() => []);
vi.mock('../src/shared/services/moodle.client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  cursosDe: vi.fn(async (conexion, moodleId) => {
    leidos.push(Number(/campus(\d+)/.exec(conexion.url)[1]));
    return [{ id: 30 + (moodleId % 10), nombre: `Curso de ${moodleId}`, seguimiento: false }];
  }),
  matriculadosDe: vi.fn(async (conexion) => {
    const yo = conexion.url.includes('campus7') ? 701 : 801;
    return [
      { id: yo, nombre: 'Redactora', roles: ['editingteacher'] },
      { id: 900, nombre: 'Alumno', roles: ['student'] },
    ];
  }),
  tareasDeCursos: vi.fn(async () => new Map()),
  entregasSinCorregir: vi.fn(async () => new Map()),
}));

const { miCampus, campusElegidos, olvidarMiCampus } = await import('../src/modules/tutores/tutor.micampus.js');
const { rutaDeRolCerrado } = await import('../src/shared/utils/roles.js');
const { resolverPermisos } = await import('../src/modules/permissions/resolver.js');

let tutora = 5000;
beforeEach(() => {
  leidos.length = 0;
  tutora += 1; // la copia es por tutora: cada prueba, una sin copia
});

describe('la tutora redactora entra en Mi campus, corrige y responde', () => {
  const redactora = { userId: 1, role: 'tutor_redactor', roles_extra: [] };

  it('el servidor le deja todas las rutas de Mi campus y de sus consultas', () => {
    for (const url of [
      '/api/tutores/mi-campus', '/api/tutores/mi-campus?campus=7,8&refrescar=1',
      '/api/tutores/mi-campus/tareas/7/31/77', '/api/tutores/mi-campus/tareas/7/31/77/archivo?alumnoId=900&n=0',
      '/api/tutores/mi-campus/tareas/7/31/77/calificar', '/api/tutores/mi-campus/cursos/7/31',
      '/api/consultas/mias?estado=pendientes', '/api/consultas/12', '/api/consultas/12/responder',
      '/api/cursos-pendientes',
    ]) {
      expect(rutaDeRolCerrado(redactora, url), url).toBe(true);
    }
  });

  it('lo que no es suyo sigue cerrado', () => {
    for (const url of ['/api/leads', '/api/conversions', '/api/consultas-ajenas', '/api/users']) {
      expect(rutaDeRolCerrado(redactora, url), url).toBe(false);
    }
  });

  it('de serie trae los permisos que abren Mi campus y sus consultas', () => {
    const { mapa } = resolverPermisos({ role: 'tutor_redactor' });
    expect(mapa['tutores.mis_cursos']).toBe(true);
    expect(mapa['consultas.atender']).toBe(true);
    // El panel de todas las consultas no: solo las suyas.
    expect(mapa['consultas.view']).toBeFalsy();
  });
});

describe('uno o varios campus', () => {
  const suyos = [{ projectId: 7, campus: 'ISSLOGG' }, { projectId: 8, campus: 'ISEF' }];

  it('campusElegidos: solo de los suyos; sin nada válido, todos', () => {
    expect(campusElegidos(suyos, [8]).elegidos.map((c) => c.projectId)).toEqual([8]);
    expect(campusElegidos(suyos, ['7', 8]).elegidos.map((c) => c.projectId)).toEqual([7, 8]);
    expect(campusElegidos(suyos, [8, 99]).elegidos.map((c) => c.projectId)).toEqual([8]);
    expect(campusElegidos(suyos, [99]).filtro).toBeNull();
    expect(campusElegidos(suyos, []).elegidos).toHaveLength(2);
    expect(campusElegidos(suyos, null).filtro).toBeNull();
  });

  it('con un campus elegido, solo se lee ese de Moodle; el selector sabe los dos', async () => {
    const d = await miCampus(tutora, { campus: [8] });
    expect(leidos).toEqual([8]);
    expect(d.campus.map((c) => c.projectId)).toEqual([8]);
    expect(d.elegidos).toEqual([8]);
    expect(d.todosLosCampus).toEqual(suyos);
    // Lo de por desarrollar y lo de sin conectar, también solo de ese campus.
    expect(d.pendientes.map((p) => p.id)).toEqual([1]);
    expect(d.sinConectar).toEqual([]);
  });

  it('un campus que no es suyo no se lee: salen todos los suyos', async () => {
    const d = await miCampus(tutora, { campus: [99] });
    expect(leidos.sort()).toEqual([7, 8]);
    expect(d.elegidos).toBeNull();
    expect(d.pendientes).toHaveLength(2);
    expect(d.sinConectar.map((s) => s.projectId)).toEqual([9]);
  });

  it('la copia va por campus: al pasar de uno a todos, solo se lee el que faltaba', async () => {
    await miCampus(tutora, { campus: [7] });
    expect(leidos).toEqual([7]);
    const todos = await miCampus(tutora);
    expect(leidos).toEqual([7, 8]);
    expect(todos.campus.map((c) => c.projectId)).toEqual([7, 8]);
    // «Actualizar» los vuelve a leer; y tras corregir, se olvida la copia de todos sus campus.
    await miCampus(tutora, { refrescar: true, campus: [8] });
    expect(leidos).toEqual([7, 8, 8]);
    olvidarMiCampus(tutora);
    await miCampus(tutora);
    expect(leidos).toEqual([7, 8, 8, 7, 8]);
  });
});
