import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * «Mi campus» de la tutora (#850): una duda contestada desde el CRM seguía saliendo «sin
 * contestar» hasta que caducaba la copia de dos minutos de lo leído en Moodle. La copia es
 * para no castigar al campus; si una consulta ya no espera, no vuelve a salir.
 *
 * Sin base ni Moodle: la base es un `query` de mentira con las consultas en memoria, y las
 * llamadas a Moodle, funciones que devuelven un curso con un alumno.
 */

const consultas = [];
const query = vi.fn(async (sql, params = []) => {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('FROM tutor_campus tc') && s.includes('tc.moodle_user_id IS NOT NULL')) {
    return { rows: [{ project_id: 7, moodle_user_id: 701, campus: 'ICTESS' }] };
  }
  if (s.includes('FROM tutor_campus tc')) return { rows: [] }; // campus sin conectar
  if (s.includes('FROM cursos_pendientes')) return { rows: [] };
  if (s.includes('FROM consultas')) {
    const [tutorId, projectId] = params;
    const abiertas = consultas.filter((c) => c.tutor_id === tutorId && c.estado === 'abierta'
      && (projectId === undefined || c.project_id === projectId));
    return { rows: abiertas.map((c) => ({ id: c.id, alumno_moodle_id: c.alumno, alumno_nombre: 'Alumno', desde: new Date('2026-11-18T15:08:26Z') })) };
  }
  throw new Error(`SQL sin preparar en el test: ${s.slice(0, 80)}`);
});
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));
vi.mock('../src/modules/tutores/tutor.campus.js', () => ({
  conexionDelCampus: vi.fn(async () => ({ url: 'https://campus.test', token: 'token-del-campus' })),
}));
const moodle = vi.hoisted(() => ({ lecturas: 0 }));
vi.mock('../src/shared/services/moodle.client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  cursosDe: vi.fn(async () => { moodle.lecturas += 1; return [{ id: 30, nombre: 'PRUEBA chat', seguimiento: false }]; }),
  matriculadosDe: vi.fn(async () => [
    { id: 701, nombre: 'Tutora', roles: ['editingteacher'] },
    { id: 900, nombre: 'Alumno', roles: ['student'] },
  ]),
  tareasDeCursos: vi.fn(async () => new Map()),
  entregasSinCorregir: vi.fn(async () => new Map()),
}));

const { miCampus } = await import('../src/modules/tutores/tutor.micampus.js');

const dudasDe = (datos) => datos.campus.flatMap((c) => [...c.dudasSinCurso, ...c.cursos.flatMap((k) => k.dudas)]);
let tutor = 1000;

beforeEach(() => {
  consultas.length = 0;
  moodle.lecturas = 0;
  tutor += 1; // la copia es por tutora: cada prueba, una tutora sin copia
});

describe('Mi campus: dudas contestadas (#850)', () => {
  it('la duda contestada desde el CRM deja de contar aunque Moodle se lea de la copia', async () => {
    consultas.push({ id: 5, tutor_id: tutor, project_id: 7, alumno: 900, estado: 'abierta' });
    const antes = await miCampus(tutor);
    expect(dudasDe(antes).map((d) => d.consultaId)).toEqual([5]);
    expect(antes.campus[0].cursos[0].dudas).toHaveLength(1);

    consultas[0].estado = 'respondida'; // guardarRespuestaDelCrm → marcarRespondida
    const despues = await miCampus(tutor);
    expect(moodle.lecturas).toBe(1); // Moodle no se vuelve a leer: la copia sigue valiendo
    expect(dudasDe(despues)).toEqual([]);
    expect(despues.campus[0].cursos[0].alumnos).toHaveLength(1); // lo de Moodle, intacto
  });

  it('la copia guardada no se toca: si la consulta vuelve a esperar, vuelve a salir', async () => {
    consultas.push({ id: 6, tutor_id: tutor, project_id: 7, alumno: 900, estado: 'abierta' });
    await miCampus(tutor);
    consultas[0].estado = 'cerrada';
    expect(dudasDe(await miCampus(tutor))).toEqual([]);
    consultas[0].estado = 'abierta'; // el alumno escribe otra vez y se reabre
    expect(dudasDe(await miCampus(tutor)).map((d) => d.consultaId)).toEqual([6]);
  });

  it('una pasada a otra tutora tampoco sale en la suya', async () => {
    consultas.push({ id: 7, tutor_id: tutor, project_id: 7, alumno: 999, estado: 'abierta' });
    expect((await miCampus(tutor)).campus[0].dudasSinCurso).toHaveLength(1);
    consultas[0].tutor_id = tutor + 5000;
    expect((await miCampus(tutor)).campus[0].dudasSinCurso).toEqual([]);
  });
});
