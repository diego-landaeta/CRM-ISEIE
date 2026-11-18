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
import { AppError } from '../../shared/utils/AppError.js';
import {
  usuarioPorCorreo, usuarioPor, estadoDeLaMatricula, MoodleError, cuentaDelToken, cuentaDelCampus, cursosDe, matriculadosDe,
} from '../../shared/services/moodle.client.js';

// Tutor = rol principal o añadido; el tutor redactor (CRM#708) también. `roles_extra` es un array de ENUM: se pide
// como texto para poder compararlo.
const ES_TUTOR = `(u.role IN ('tutor', 'tutor_redactor') OR COALESCE(u.roles_extra, '{}')::text[] && ARRAY['tutor', 'tutor_redactor'])`;

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
    // La tutora puede cambiar su correo del CRM. Si con el correo nuevo sale OTRA cuenta del
    // campus, no se cambia la vinculada: con eso podría escribir y calificar como otro profesor.
    const { rows: [vinculada] } = await query(
      'SELECT moodle_user_id FROM tutor_campus WHERE tutor_id = $1 AND project_id = $2', [tutor.id, projectId]);
    const yaVinculada = vinculada?.moodle_user_id != null ? Number(vinculada.moodle_user_id) : null;
    if (yaVinculada && usuario?.id && Number(usuario.id) !== yaVinculada) {
      const mensaje = OTRA_CUENTA;
      logger.warn({ tutorId: tutor.id, projectId, vinculada: yaVinculada, nueva: usuario.id }, 'tutores/campus: el correo apunta a otra cuenta');
      await guardarError(tutor.id, projectId, anterior, mensaje);
      return { project_id: projectId, estado: anterior, error: mensaje };
    }
    // Vinculada a mano (su correo del CRM no es el de Moodle): se mira esa cuenta por su id.
    const cuenta = usuario || (yaVinculada ? await usuarioPor(conexion, 'id', yaVinculada, opciones) : null);
    const estado = estadoDeLaMatricula(cuenta, anterior);
    await query(
      `INSERT INTO tutor_campus (tutor_id, project_id, estado, moodle_user_id, comprobado_at, error)
       VALUES ($1, $2, $3, $4, NOW(), NULL)
       ON CONFLICT (tutor_id, project_id) DO UPDATE
         SET estado = EXCLUDED.estado, moodle_user_id = COALESCE(tutor_campus.moodle_user_id, EXCLUDED.moodle_user_id),
             comprobado_at = NOW(), error = NULL`,
      [tutor.id, projectId, estado, cuenta?.id || null]
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

// ─── Vincular a mano su cuenta de Moodle (punto 2 de la revisión de la #689) ──
//
// Va por empresa (Diego, 06/11 y 10/11): una tutora que da clase en CEDIA y en
// ISEIE tiene una cuenta vinculada en CADA campus (`tutor_campus`, una fila por
// campus), y cada vínculo lo pone quien gestiona tutores en ESA empresa. Que quien
// pide lleve el campus lo mira el controlador; aquí, que la tutora lo tenga y que
// la cuenta sea de verdad la de una profesora de ese campus.

/** El error cuando su correo lleva a otra cuenta del campus (el panel ofrece «Vincular de nuevo»). */
export const OTRA_CUENTA = 'El correo apunta a otra cuenta del campus distinta de la vinculada. Si es correcto, pulsa «Vincular de nuevo».';

/** Los roles de Moodle que son «profesora de un curso» (los mismos que `consultas.alumnos.js`). */
const ROLES_DE_PROFESORA = new Set(['editingteacher', 'teacher']);

/**
 * Que la tutora tenga ese campus (puesto a mano o por su empresa), como lo pone
 * «Asignar campus». Sin esto, vincular creaba la fila de `tutor_campus` de un
 * campus que nadie le había dado y se saltaba esa comprobación (Diego, 10/11).
 */
export async function exigirCampusDeLaTutora(tutorId, projectId) {
  const suyos = await campusDelTutor(tutorId);
  if (!suyos.some((c) => c.project_id === Number(projectId))) {
    throw new AppError('Esta tutora no tiene ese campus: asígnale primero el campus.', 409, 'CAMPUS_NO_ASIGNADO');
  }
}

/** La conexión del campus, o un error que se entiende si no está conectado. */
async function conexionUsable(projectId) {
  const conexion = await conexionDelCampus(projectId);
  if (!conexion) throw new AppError('Este campus no está conectado en Integraciones', 409, 'SIN_CONEXION');
  if (conexion.error) throw new AppError(conexion.error, 409, 'SIN_CONEXION');
  return conexion;
}

const errorDelCampus = (err, porDefecto) => (err instanceof AppError ? err
  : new AppError(err instanceof MoodleError ? err.message : porDefecto, 502, 'MOODLE'));

/**
 * Que esa cuenta se pueda vincular a una tutora en ese campus: que sea profesora
 * (`editingteacher` o `teacher`) de al menos un curso del campus, que no sea la
 * cuenta del token, con la que el propio CRM habla con el campus, y que no sea
 * administradora del sitio aunque dé clase (Diego: «nunca el administrador del sitio»).
 *
 * El administrador del sitio: la API de Moodle solo dice si lo es la cuenta del token,
 * así que se pregunta al plugin (`local_crm_cuenta`, 1.10.2). Con un plugin anterior no
 * se puede saber: se sigue como antes (si no da clase, se rechaza por no ser profesora;
 * si da clase, se vincula, y el plugin, desde la 1.10.1, no envía ni califica como él)
 * y queda dicho en el log.
 */
async function exigirCuentaDeProfesora(conexion, cuenta, opciones) {
  const delToken = await cuentaDelToken(conexion, opciones);
  if (delToken.id && delToken.id === Number(cuenta.id)) {
    throw new AppError('Esa es la cuenta con la que el CRM se conecta al campus, no la de una tutora.', 409, 'NO_ES_PROFESORA');
  }
  const datos = await cuentaDelCampus(conexion, cuenta.id, opciones);
  if (!datos) {
    logger.warn({ campus: conexion.url, moodleUserId: Number(cuenta.id) },
      'tutores/campus: el plugin del campus no tiene local_crm_cuenta (anterior a la 1.10.2): no se puede saber si es el administrador del sitio');
  } else if (datos.esAdministrador) {
    throw new AppError('Esa cuenta es la del administrador del sitio: no se vincula a una tutora aunque dé clase. Vincula la cuenta con la que ella da clase.', 409, 'ADMIN_DEL_SITIO');
  }
  // De uno en uno y parando en el primero: lo normal es que lo sea del primer curso.
  for (const curso of await cursosDe(conexion, cuenta.id, opciones)) {
    const yo = (await matriculadosDe(conexion, curso.id, opciones)).find((u) => u.id === Number(cuenta.id));
    if (yo?.roles.some((r) => ROLES_DE_PROFESORA.has(r))) return;
  }
  throw new AppError('Esa cuenta no es profesora de ningún curso de este campus: solo se vincula la cuenta con la que da clase.', 409, 'NO_ES_PROFESORA');
}

/**
 * Olvida la cuenta de Moodle vinculada en ese campus y vuelve a buscarla por su correo.
 * Para cuando su cuenta del campus cambia de verdad (se rehízo, cambió de correo): lo
 * decide quien gestiona tutores, no la propia tutora. Solo ese campus: el vínculo de
 * otra empresa no se toca.
 */
export async function desvincularCuenta(tutorId, projectId, opciones = {}) {
  await exigirCampusDeLaTutora(tutorId, projectId);
  await query(
    'UPDATE tutor_campus SET moodle_user_id = NULL, error = NULL WHERE tutor_id = $1 AND project_id = $2',
    [tutorId, projectId]);
  return comprobarTutor(tutorId, { soloProyectos: [Number(projectId)], ...opciones });
}

/**
 * Buscar la cuenta de Moodle de una tutora cuando su correo del CRM no es el de Moodle,
 * por su correo de Moodle. (Por nombre de usuario no: Moodle solo lo enseña a quien puede
 * editar usuarios, y el usuario del servicio no puede.) Devuelve lo justo para confirmar
 * que es ella (nombre y correo), o null si no hay ninguna. Una cuenta que no se podría
 * vincular (no es profesora del campus) se dice ya aquí, no al pulsar «vincular».
 */
export async function buscarCuentaMoodle(tutorId, projectId, texto, opciones = {}) {
  await exigirCampusDeLaTutora(tutorId, projectId);
  const conexion = await conexionUsable(projectId);
  const q = String(texto || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(q)) throw new AppError('Escribe su correo de Moodle', 400, 'VALIDATION_ERROR');
  try {
    const cuenta = await usuarioPorCorreo(conexion, q, opciones);
    if (cuenta) await exigirCuentaDeProfesora(conexion, cuenta, opciones);
    return cuenta;
  } catch (err) {
    throw errorDelCampus(err, 'No se ha podido buscar en el campus.');
  }
}

/**
 * Vincula a mano la tutora con esa cuenta de Moodle (la que ha confirmado quien gestiona
 * tutores). La comprobación de cada hora la respeta: busca esa cuenta por su id.
 *
 * Solo cambia la fila que ya hay: nunca crea la de un campus que la tutora no tiene.
 */
export async function vincularAMano(tutorId, projectId, moodleUserId, opciones = {}) {
  await exigirCampusDeLaTutora(tutorId, projectId);
  const conexion = await conexionUsable(projectId);
  let cuenta;
  try {
    cuenta = await usuarioPor(conexion, 'id', moodleUserId, opciones);
    if (!cuenta) throw new AppError('Esa cuenta no existe en el campus', 404, 'NOT_FOUND');
    await exigirCuentaDeProfesora(conexion, cuenta, opciones);
  } catch (err) {
    throw errorDelCampus(err, 'No se ha podido leer el campus.');
  }
  const { rowCount } = await query(
    `UPDATE tutor_campus SET estado = $3, moodle_user_id = $4, comprobado_at = NOW(), error = NULL
      WHERE tutor_id = $1 AND project_id = $2`,
    [tutorId, projectId, estadoDeLaMatricula(cuenta), cuenta.id]);
  if (!rowCount) {
    // Tiene el campus, pero aún no se ha mirado en él (se le dio sin el Moodle conectado,
    // o el campus no contestó): primero esa comprobación, que es la que crea la fila.
    throw new AppError('Aún no se ha comprobado su matrícula en este campus: pulsa «Comprobar en los campus» y vuelve a vincular.', 409, 'SIN_COMPROBAR');
  }
  return cuenta;
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
