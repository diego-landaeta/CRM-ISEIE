/*
  CONSULTAS DE ALUMNOS · FASE 1 (#187): en qué campus atiende cada tutor y si
  está matriculado en ellos.

  De dónde salen los campus de un tutor, sin copiar nada:

    · sus `user_projects` activos: los campus que se le marcan al darlo de alta
      (son los mismos que mira Tutores para sus formaciones);
    · y los de sus EMPRESAS (`tutor_empresas`), leídos de
      `projects.sociedad_emisora_id` en el momento. «Asignar una empresa cubre
      todos sus proyectos, también los que se añadan después: se resuelve al
      consultar, no copiando filas» (#187).

  La matrícula (`tutor_campus`) es lo que dice el Moodle del campus, conectado en
  Integraciones (provider «moodle»): activa, pendiente o baja. Un campus sin
  Moodle conectado no se puede comprobar y se dice así, sin inventar un estado.

  Quién recibe consultas de un campus (`tutoresQueRecibenConsultas`): tutores
  activos, disponibles («No disponible» = vacaciones o baja, decisión 6) y con la
  matrícula ACTIVA en ese campus. Lo usará el reparto de la fase 2 (#188).
*/
import { query } from '../../shared/config/db.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';
import {
  usuarioPorCorreo, estadoDeLaMatricula, MoodleError,
} from '../../shared/services/moodle.client.js';

// Tutor = rol principal o añadido. `roles_extra` es un array de ENUM: se pide
// como texto para poder compararlo.
const ES_TUTOR = `(u.role = 'tutor' OR 'tutor' = ANY(COALESCE(u.roles_extra, '{}')::text[]))`;

/** ¿Este usuario es tutor (como rol principal o añadido)? */
export async function esTutor(userId) {
  const { rows } = await query(`SELECT 1 FROM users u WHERE u.id = $1 AND ${ES_TUTOR}`, [userId]);
  return rows.length > 0;
}

/**
 * Los campus del tutor, con cómo le llegan y su matrícula.
 *
 * Un campus que le llega por los dos lados sale una vez, marcado como «campus»
 * (es lo que se le puso a mano) y con la empresa al lado.
 */
export async function campusDelTutor(tutorId) {
  const { rows } = await query(
    `WITH suyos AS (
       SELECT up.project_id, 'campus'::text AS via
         FROM user_projects up
        WHERE up.user_id = $1 AND up.active = true
       UNION
       SELECT p.id, 'empresa'::text
         FROM tutor_empresas te
         JOIN projects p ON p.sociedad_emisora_id = te.issuer_id AND p.active = true
        WHERE te.tutor_id = $1
     ),
     uno AS (
       SELECT project_id, MIN(via) AS via FROM suyos GROUP BY project_id
     )
     SELECT p.id AS project_id, p.nombre AS campus, uno.via,
            ii.id AS issuer_id, COALESCE(ii.alias, ii.razon_social) AS empresa,
            tc.estado, tc.comprobado_at, tc.error,
            (pi.id IS NOT NULL AND pi.active AND pi.encrypted_value IS NOT NULL) AS campus_conectado
       FROM uno
       JOIN projects p ON p.id = uno.project_id
       LEFT JOIN invoice_issuers ii ON ii.id = p.sociedad_emisora_id
       LEFT JOIN tutor_campus tc ON tc.tutor_id = $1 AND tc.project_id = p.id
       LEFT JOIN project_integrations pi ON pi.project_id = p.id AND pi.provider = 'moodle'
      ORDER BY p.nombre`,
    [tutorId]
  );
  return rows.map((r) => ({
    project_id: Number(r.project_id),
    campus: r.campus,
    via: r.via,                       // 'campus' (puesto a mano) | 'empresa'
    issuer_id: r.issuer_id ? Number(r.issuer_id) : null,
    empresa: r.empresa || null,
    campus_conectado: Boolean(r.campus_conectado),
    estado: r.estado || null,         // null = sin comprobar
    comprobado_at: r.comprobado_at || null,
    error: r.error || null,
  }));
}

/** Las empresas enteras del tutor. */
export async function empresasDelTutor(tutorId) {
  const { rows } = await query(
    `SELECT ii.id AS issuer_id, COALESCE(ii.alias, ii.razon_social) AS empresa, te.created_at,
            (SELECT COUNT(*) FROM projects p WHERE p.sociedad_emisora_id = ii.id AND p.active)::int AS campus
       FROM tutor_empresas te
       JOIN invoice_issuers ii ON ii.id = te.issuer_id
      WHERE te.tutor_id = $1
      ORDER BY 2`,
    [tutorId]
  );
  return rows.map((r) => ({ ...r, issuer_id: Number(r.issuer_id) }));
}

/** Los campus activos de una empresa. */
export async function campusDeLaEmpresa(issuerId) {
  const { rows } = await query(
    'SELECT id FROM projects WHERE sociedad_emisora_id = $1 AND active = true ORDER BY id', [issuerId]);
  return rows.map((r) => Number(r.id));
}

export async function existeEmpresa(issuerId) {
  const { rows } = await query('SELECT 1 FROM invoice_issuers WHERE id = $1', [issuerId]);
  return rows.length > 0;
}

export async function asignarEmpresa(tutorId, issuerId, porQuien) {
  await query(
    `INSERT INTO tutor_empresas (tutor_id, issuer_id, creado_por) VALUES ($1, $2, $3)
     ON CONFLICT (tutor_id, issuer_id) DO NOTHING`,
    [tutorId, issuerId, porQuien || null]
  );
}

/** Quita la empresa. Sus campus puestos a mano se quedan. */
export async function quitarEmpresa(tutorId, issuerId) {
  await query('DELETE FROM tutor_empresas WHERE tutor_id = $1 AND issuer_id = $2', [tutorId, issuerId]);
}

/** Le pone un campus (o se lo devuelve si lo tenía apagado). */
export async function asignarCampus(tutorId, projectId) {
  await query(
    `INSERT INTO user_projects (user_id, project_id, active) VALUES ($1, $2, true)
     ON CONFLICT (user_id, project_id) DO UPDATE SET active = true`,
    [tutorId, projectId]
  );
}

/** La conexión con el Moodle de un campus, o null si no está conectado. */
export async function conexionDelCampus(projectId) {
  const { rows } = await query(
    `SELECT encrypted_value, iv, auth_tag, config_public
       FROM project_integrations
      WHERE project_id = $1 AND provider = 'moodle' AND active = true AND encrypted_value IS NOT NULL`,
    [projectId]
  );
  const r = rows[0];
  if (!r || !r.config_public?.url) return null;
  try {
    return { url: r.config_public.url, token: decrypt(r.encrypted_value, r.iv, r.auth_tag) };
  } catch (err) {
    logger.warn({ projectId, err: err.message }, 'tutores/campus: el token del Moodle no se puede descifrar');
    return { error: 'El token del campus no se puede descifrar: vuelve a guardarlo en Integraciones.' };
  }
}

/**
 * Pregunta al campus por el tutor y guarda lo que diga.
 *
 * Si el campus no contesta, el estado se queda como estaba y se apunta el error:
 * un campus caído no puede dar de baja a nadie.
 */
async function comprobarUno(tutor, projectId, anterior, opciones = {}) {
  const conexion = await conexionDelCampus(projectId);
  if (!conexion) return { project_id: projectId, estado: anterior, sin_conectar: true };
  if (conexion.error) {
    await guardarError(tutor.id, projectId, anterior, conexion.error);
    return { project_id: projectId, estado: anterior, error: conexion.error };
  }
  try {
    const usuario = await usuarioPorCorreo(conexion, tutor.email, opciones);
    const estado = estadoDeLaMatricula(usuario, anterior);
    await query(
      `INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id, comprobado_at, error)
       VALUES ($1, $2, $3, $4, NOW(), NULL)
       ON CONFLICT (tutor_id, project_id) DO UPDATE
         SET estado = EXCLUDED.estado, moodle_user_id = EXCLUDED.moodle_user_id,
             comprobado_at = NOW(), error = NULL`,
      [tutor.id, projectId, estado, usuario?.id || null]
    );
    return { project_id: projectId, estado, antes: anterior };
  } catch (err) {
    const mensaje = err instanceof MoodleError ? err.message : 'No se ha podido comprobar en el campus.';
    if (!(err instanceof MoodleError)) logger.warn({ projectId, err: err.message }, 'tutores/campus: fallo al comprobar');
    await guardarError(tutor.id, projectId, anterior, mensaje);
    return { project_id: projectId, estado: anterior, error: mensaje };
  }
}

async function guardarError(tutorId, projectId, anterior, mensaje) {
  // Sin estado anterior no hay fila que conservar: el error se enseña en la
  // respuesta y la próxima comprobación lo vuelve a intentar.
  if (!anterior) return;
  await query(
    'UPDATE tutor_campus SET error = $3, comprobado_at = NOW() WHERE tutor_id = $1 AND project_id = $2',
    [tutorId, projectId, mensaje]
  );
}

/**
 * Comprueba el tutor en todos sus campus (o solo en `soloProyectos`).
 * Devuelve sus campus ya actualizados y la lista de lo que ha pasado.
 */
export async function comprobarTutor(tutorId, { soloProyectos = null, ...opciones } = {}) {
  const { rows } = await query('SELECT id, email FROM users WHERE id = $1', [tutorId]);
  const tutor = rows[0];
  if (!tutor) return { campus: [], resultados: [] };
  const antes = await campusDelTutor(tutorId);
  const resultados = [];
  for (const c of antes) {
    if (soloProyectos && !soloProyectos.includes(c.project_id)) continue;
    // De uno en uno: son pocos campus por tutor y así no se le cae un Moodle encima.
    resultados.push(await comprobarUno(tutor, c.project_id, c.estado, opciones));
  }
  return { campus: await campusDelTutor(tutorId), resultados };
}

/** Cuánto vale una comprobación antes de repetirla al abrir la ficha. */
export const COMPROBACION_FRESCA_MS = Number(process.env.TUTORES_CAMPUS_FRESCA_MS || 30 * 1000);

/**
 * Al abrir la ficha del tutor: vuelve a preguntar a los campus conectados cuya
 * comprobación tenga más de 30 segundos (para no preguntar dos veces seguidas). Así lo que se ve es lo de ahora, sin
 * pulsar «Comprobar en los campus» (Diana, prueba a mano del 19/10).
 */
export async function comprobarSiHaceFalta(tutorId, opciones = {}) {
  const ahora = Date.now();
  const viejos = (await campusDelTutor(tutorId))
    .filter((c) => c.campus_conectado
      && (!c.comprobado_at || ahora - new Date(c.comprobado_at).getTime() > COMPROBACION_FRESCA_MS))
    .map((c) => c.project_id);
  if (!viejos.length) return { campus: null, resultados: [] };
  return comprobarTutor(tutorId, { soloProyectos: viejos, ...opciones });
}

/**
 * Todos los tutores activos, en todos sus campus. Lo llama el trabajo
 * programado. Devuelve cuántos ha mirado y los que han cambiado de estado.
 */
export async function comprobarTodos(opciones) {
  const { rows } = await query(
    `SELECT u.id FROM users u WHERE u.active = true AND ${ES_TUTOR} ORDER BY u.id`);
  let mirados = 0;
  const cambios = [];
  for (const { id } of rows) {
    const { resultados } = await comprobarTutor(Number(id), opciones);
    for (const r of resultados) {
      if (r.sin_conectar) continue;
      mirados += 1;
      // Solo lo que cambia de verdad: la primera comprobación no es un cambio.
      if (r.antes && r.estado && r.estado !== r.antes) {
        cambios.push({ tutor_id: Number(id), project_id: r.project_id, de: r.antes, a: r.estado });
      }
    }
  }
  return { tutores: rows.length, mirados, cambios };
}

/**
 * Los tutores que pueden recibir consultas de un campus: activos, disponibles y
 * con la matrícula ACTIVA en ese campus (por campus o por empresa). Un tutor sin
 * matrícula, o de baja en el campus, no recibe consultas de ese proyecto.
 */
export async function tutoresQueRecibenConsultas(projectId) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email
       FROM users u
       JOIN tutor_campus tc ON tc.tutor_id = u.id AND tc.project_id = $1 AND tc.estado = 'activa'
      WHERE u.active = true
        AND u.consultas_disponible
        AND ${ES_TUTOR}
        AND (
          EXISTS (SELECT 1 FROM user_projects up
                   WHERE up.user_id = u.id AND up.project_id = $1 AND up.active = true)
          OR EXISTS (SELECT 1 FROM tutor_empresas te
                       JOIN projects p ON p.sociedad_emisora_id = te.issuer_id AND p.active = true
                      WHERE te.tutor_id = u.id AND p.id = $1)
        )
      ORDER BY u.nombre`,
    [projectId]
  );
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

/**
 * «No disponible» de Consultas (vacaciones o baja), en sus columnas propias
 * (migración 223). No son las del reparto de prospectos (`is_available`): una
 * gestora que además es tutora no deja de recibir prospectos por esto, ni al
 * revés (QA de Diego, 22/10, punto 6).
 */
export async function ponerDisponible(tutorId, disponible, motivo) {
  const { rows } = await query(
    `UPDATE users
        SET consultas_disponible = $1,
            consultas_no_disponible_motivo = CASE WHEN $1 = false THEN $2 ELSE NULL END,
            consultas_no_disponible_desde  = CASE WHEN $1 = false THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $3
      RETURNING consultas_disponible, consultas_no_disponible_motivo, consultas_no_disponible_desde`,
    [disponible, motivo || null, tutorId]
  );
  return rows[0] || null;
}

export async function disponibilidad(tutorId) {
  const { rows } = await query(
    `SELECT consultas_disponible, consultas_no_disponible_motivo, consultas_no_disponible_desde
       FROM users WHERE id = $1`, [tutorId]);
  return rows[0] || null;
}
