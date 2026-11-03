/*
  CONSULTAS DE ALUMNOS · FASE 3 (#189): las métricas (especificación, punto 7).

    · Tiempo de primera respuesta (LA principal): de la entrada a la primera
      respuesta del tutor.
    · Tiempo de resolución: de la entrada al cierre.
    · Pendientes: abiertas sin respuesta, con su antigüedad.
    · % dentro de plazo y la lista de las que se pasaron (plazo: 24 h de inicio).
    · Volumen: consultas por día.
    · Alumnos sin mensajes, % de alumnos contactados y tiempo hasta el primer
      contacto (desde la matrícula, que es aproximada).

  Media y mediana: la mediana evita que un caso suelto lo distorsione todo.
  Las consultas que empezó el tutor («Escribir al alumno») no son preguntas de
  un alumno: no cuentan para los tiempos de respuesta ni para el volumen.

  Filtros: tutor, campus, empresa (vía campus) y fechas (de entrada). El tutor
  ve solo las suyas; administración ve además el ranking de tutores y campus.
*/
import { query } from '../../shared/config/db.js';
import { PLAZO_HORAS } from './consultas.model.js';

const HORAS = (a, b) => `EXTRACT(EPOCH FROM (${a} - ${b})) / 3600.0`;
const redondea = (v, d = 1) => (v == null ? null : Math.round(Number(v) * 10 ** d) / 10 ** d);

/** El WHERE común de las consultas, con sus parámetros. */
function filtro({ tutorId, projectIds, desde, hasta }, alias = 'c') {
  const w = [`${alias}.origen <> 'tutor'`];
  const p = [];
  if (tutorId) { p.push(tutorId); w.push(`${alias}.tutor_id = $${p.length}`); }
  if (projectIds) { p.push(projectIds); w.push(`${alias}.project_id = ANY($${p.length}::int[])`); }
  // Días de Madrid, como el volumen por día: si no, lo de las 00:00–02:00 caía
  // fuera del día pedido y salía en el gráfico del día de antes.
  if (desde) { p.push(desde); w.push(`${alias}.entrada_at >= ($${p.length}::date::timestamp AT TIME ZONE 'Europe/Madrid')`); }
  if (hasta) { p.push(hasta); w.push(`${alias}.entrada_at < (($${p.length}::date + 1)::timestamp AT TIME ZONE 'Europe/Madrid')`); }
  return { where: w.join(' AND '), p };
}

export async function metricas({ tutorId = null, projectIds = null, desde = null, hasta = null, ranking = false } = {}) {
  const f = filtro({ tutorId, projectIds, desde, hasta });
  const plazo = PLAZO_HORAS;

  const resumen = (await query(
    `SELECT COUNT(*)::int AS volumen,
            COUNT(*) FILTER (WHERE c.primera_respuesta_at IS NOT NULL)::int AS respondidas,
            AVG(${HORAS('c.primera_respuesta_at', 'c.entrada_at')}) AS primera_media,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${HORAS('c.primera_respuesta_at', 'c.entrada_at')}) AS primera_mediana,
            AVG(${HORAS('c.cerrada_at', 'c.entrada_at')}) AS resolucion_media,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${HORAS('c.cerrada_at', 'c.entrada_at')}) AS resolucion_mediana,
            COUNT(*) FILTER (WHERE c.primera_respuesta_at IS NOT NULL
                               AND ${HORAS('c.primera_respuesta_at', 'c.entrada_at')} <= ${plazo})::int AS en_plazo,
            COUNT(*) FILTER (WHERE c.estado = 'abierta')::int AS pendientes,
            AVG(${HORAS('NOW()', 'COALESCE(c.espera_desde, c.entrada_at)')}) FILTER (WHERE c.estado = 'abierta') AS pendientes_media,
            MAX(${HORAS('NOW()', 'COALESCE(c.espera_desde, c.entrada_at)')}) FILTER (WHERE c.estado = 'abierta') AS pendientes_maxima
       FROM consultas c WHERE ${f.where}`, f.p)).rows[0];

  // Fuera de plazo: respondidas tarde o abiertas que ya se pasaron.
  const fuera = (await query(
    `SELECT c.id, c.alumno_nombre, pr.nombre AS campus, u.nombre AS tutor, c.estado, c.entrada_at,
            ROUND((${HORAS('COALESCE(c.primera_respuesta_at, c.cerrada_at, NOW())', 'c.entrada_at')})::numeric, 1) AS horas
       FROM consultas c JOIN projects pr ON pr.id = c.project_id LEFT JOIN users u ON u.id = c.tutor_id
      WHERE ${f.where}
        AND ${HORAS('COALESCE(c.primera_respuesta_at, c.cerrada_at, NOW())', 'c.entrada_at')} > ${plazo}
      ORDER BY horas DESC LIMIT 100`, f.p)).rows;

  const porDia = (await query(
    `SELECT TO_CHAR(c.entrada_at AT TIME ZONE 'Europe/Madrid', 'YYYY-MM-DD') AS dia, COUNT(*)::int AS n
       FROM consultas c WHERE ${f.where} GROUP BY 1 ORDER BY 1`, f.p)).rows;

  // Los alumnos (seguimiento), del tutor o de esos campus.
  const fa = [];
  const wa = ['ta.activo'];
  if (tutorId) { fa.push(tutorId); wa.push(`ta.tutor_id = $${fa.length}`); }
  if (projectIds) { fa.push(projectIds); wa.push(`ta.project_id = ANY($${fa.length}::int[])`); }
  const alumnos = (await query(
    // Un alumno es uno aunque esté en varios cursos del mismo tutor (si no,
    // contaba doble en el total y en el % de contactados).
    `WITH a AS (
       SELECT ta.project_id, ta.tutor_id, ta.alumno_moodle_id,
              MIN(ta.matriculado_desde) AS matriculado_desde,
              MIN(ta.primer_contacto_at) AS primer_contacto_at,
              (BOOL_OR(ta.con_conversacion) OR EXISTS (SELECT 1 FROM consultas c WHERE c.project_id = ta.project_id
                 AND c.alumno_moodle_id = ta.alumno_moodle_id AND c.tutor_id = ta.tutor_id)) AS contactado
         FROM tutor_alumnos ta WHERE ${wa.join(' AND ')}
        GROUP BY ta.project_id, ta.tutor_id, ta.alumno_moodle_id
     )
     SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE contactado)::int AS contactados,
            COUNT(*) FILTER (WHERE NOT contactado)::int AS sin_mensajes,
            AVG(EXTRACT(EPOCH FROM (NOW() - matriculado_desde)) / 86400.0) FILTER (WHERE NOT contactado) AS sin_mensajes_dias_media,
            AVG(EXTRACT(EPOCH FROM (primer_contacto_at - matriculado_desde)) / 86400.0) FILTER (WHERE primer_contacto_at IS NOT NULL) AS primer_contacto_media,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (primer_contacto_at - matriculado_desde)) / 86400.0)
              FILTER (WHERE primer_contacto_at IS NOT NULL) AS primer_contacto_mediana
       FROM a`, fa)).rows[0];

  const respuesta = {
    plazoHoras: plazo,
    consultas: {
      volumen: resumen.volumen,
      respondidas: resumen.respondidas,
      primeraRespuestaHoras: { media: redondea(resumen.primera_media), mediana: redondea(resumen.primera_mediana) },
      resolucionHoras: { media: redondea(resumen.resolucion_media), mediana: redondea(resumen.resolucion_mediana) },
      enPlazoPct: resumen.respondidas ? redondea((resumen.en_plazo * 100) / resumen.respondidas, 0) : null,
      pendientes: { total: resumen.pendientes, mediaHoras: redondea(resumen.pendientes_media), maximaHoras: redondea(resumen.pendientes_maxima) },
      fueraDePlazo: fuera.map((x) => ({ ...x, horas: Number(x.horas) })),
      porDia,
    },
    alumnos: {
      total: alumnos.total,
      sinMensajes: alumnos.sin_mensajes,
      sinMensajesDiasMedia: redondea(alumnos.sin_mensajes_dias_media),
      contactadosPct: alumnos.total ? redondea((alumnos.contactados * 100) / alumnos.total, 0) : null,
      primerContactoDias: { media: redondea(alumnos.primer_contacto_media), mediana: redondea(alumnos.primer_contacto_mediana) },
      // La fecha de matrícula es la primera vez que el CRM vio al alumno.
      matriculaAproximada: true,
    },
  };

  if (ranking) {
    const r = (por) => query(
      `SELECT ${por === 'tutor' ? 'u.nombre' : 'pr.nombre'} AS quien_nombre,
              ${por === 'tutor' ? 'u.id' : 'pr.id'} AS quien_id,
              COUNT(*)::int AS consultas,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${HORAS('c.primera_respuesta_at', 'c.entrada_at')}) AS mediana,
              AVG(${HORAS('c.primera_respuesta_at', 'c.entrada_at')}) AS media,
              COUNT(*) FILTER (WHERE c.primera_respuesta_at IS NOT NULL)::int AS respondidas,
              COUNT(*) FILTER (WHERE c.primera_respuesta_at IS NOT NULL AND ${HORAS('c.primera_respuesta_at', 'c.entrada_at')} <= ${plazo})::int AS en_plazo,
              COUNT(*) FILTER (WHERE c.estado = 'abierta')::int AS pendientes
         FROM consultas c JOIN projects pr ON pr.id = c.project_id LEFT JOIN users u ON u.id = c.tutor_id
        WHERE ${f.where} ${por === 'tutor' ? 'AND c.tutor_id IS NOT NULL' : ''}
        GROUP BY ${por === 'tutor' ? 'u.id, u.nombre' : 'pr.id, pr.nombre'}
        ORDER BY mediana NULLS LAST, consultas DESC`, f.p);
    const fila = (x) => ({
      id: Number(x.quien_id), nombre: x.quien_nombre, consultas: x.consultas, pendientes: x.pendientes,
      primeraRespuestaHoras: { media: redondea(x.media), mediana: redondea(x.mediana) },
      enPlazoPct: x.respondidas ? redondea((x.en_plazo * 100) / x.respondidas, 0) : null,
    });
    respuesta.ranking = {
      tutores: (await r('tutor')).rows.map(fila),
      campus: (await r('campus')).rows.map(fila),
    };
  }
  return respuesta;
}
