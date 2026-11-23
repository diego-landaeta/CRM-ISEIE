/*
  LAS TUTORAS REDACTORAS EN MOODLE (porte de CRM#1026 del 360, sigue a #687).

  Para que una redactora vea sus cursos en «Mi campus» y le lleguen las dudas del chat
  del curso hacen falta, en CADA campus donde están los cursos que redacta:

    1. una cuenta en ese Moodle con el mismo correo que en el CRM (o vinculada a mano),
       que no esté suspendida ni sea la del administrador del sitio;
    2. el campus asignado en su ficha y la cuenta vinculada en el CRM (`tutor_campus`
       activa, con su `moodle_user_id`), que es lo que lee «Mi campus»;
    3. matriculada en cada uno de esos cursos como profesora (`editingteacher` o
       `teacher`): el chat de grupo del plugin y «Mi campus» solo cuentan ese rol.

  Aquí se COMPRUEBA, campus a campus y curso a curso, sin escribir nada en Moodle ni en
  el CRM. «Los cursos que redacta» son sus productos (colaboración activa, curso
  pendiente asignado o «Responsable de desarrollarlo»: ver `cursosQueRedacta`) con su
  curso de Moodle unido (`moodle_cursos_producto`, migración 311).

  Matricularla desde el CRM NO se hace: el plugin (`local_crm_matricular`, 1.12.0) solo
  matricula con roles de tipo alumno, a propósito, y el servicio del CRM no lleva
  `enrol_manual_enrol_users`. Darle a ese token permiso para hacer profesora a alguien
  es una decisión de Diego (CRM#1026). Mientras, se da el enlace a la página de
  participantes del curso para que lo haga quien administra el campus.
*/
import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import {
  usuarioPor, usuarioPorCorreo, cuentaDelCampus, cursosDe, matriculadosDe, urlDelCampus, MoodleError,
} from '../../shared/services/moodle.client.js';
import { campusDelTutor, conexionDelCampus } from './tutor.campus.js';

/** Los roles de Moodle con los que cuenta como profesora del curso (los de «Mi campus» y del chat de grupo). */
const ROLES_DE_PROFESORA = new Set(['editingteacher', 'teacher']);

/**
 * Los cursos que redacta: sus productos, cada uno con sus cursos de Moodle, o sin
 * ninguno si aún no se le ha unido. Un producto es suyo por cualquiera de estas tres
 * (`por` dice cuáles), porque el CRM no tiene un único «redacta este curso»:
 *
 *   · `colaboracion`: una colaboración activa en Tutores (la de los entregables: foto,
 *     vídeo, módulos);
 *   · `curso_pendiente`: un curso pendiente que tiene asignado y no está cancelado;
 *   · `responsable`: es la «Responsable de desarrollarlo» del producto (#770).
 */
export async function cursosQueRedacta(tutorId) {
  const { rows } = await query(
    `WITH suyos AS (
       SELECT product_id, 'colaboracion'::text AS por FROM tutor_collaborations
        WHERE tutor_id = $1 AND activa AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_DATE)
       UNION
       SELECT product_id, 'curso_pendiente' FROM cursos_pendientes
        WHERE tutor_id = $1 AND product_id IS NOT NULL AND estado <> 'cancelado'
       UNION
       SELECT id, 'responsable' FROM products WHERE responsable_desarrollo_id = $1
     ),
     por_producto AS (
       SELECT product_id, array_agg(DISTINCT por ORDER BY por) AS por FROM suyos GROUP BY product_id
     )
     SELECT pr.id AS product_id, pr.nombre AS producto, pr.active AS producto_activo,
            pr.project_id AS producto_campus_id, pp.por,
            mc.project_id, p.nombre AS campus, mc.curso_moodle_id, mc.curso_nombre
       FROM por_producto pp
       JOIN products pr ON pr.id = pp.product_id
       LEFT JOIN moodle_cursos_producto mc ON mc.product_id = pr.id
       LEFT JOIN projects p ON p.id = mc.project_id
      ORDER BY p.nombre NULLS LAST, lower(pr.nombre), pr.id, mc.curso_moodle_id`,
    [tutorId]);
  return rows.map((r) => ({
    product_id: Number(r.product_id),
    producto: r.producto,
    producto_activo: r.producto_activo !== false,
    producto_campus_id: r.producto_campus_id != null ? Number(r.producto_campus_id) : null,
    por: r.por || [],
    project_id: r.project_id != null ? Number(r.project_id) : null,
    campus: r.campus || null,
    curso_moodle_id: r.curso_moodle_id != null ? Number(r.curso_moodle_id) : null,
    curso_nombre: r.curso_nombre || null,
  }));
}

const mensajeDe = (err, porDefecto) => (err instanceof MoodleError ? err.message : porDefecto);

/** Un curso, aún sin mirar en Moodle. */
const cursoSinMirar = (c, estado) => ({
  product_id: c.product_id,
  producto: c.producto,
  producto_activo: c.producto_activo,
  por: c.por,
  curso_moodle_id: c.curso_moodle_id,
  curso_nombre: c.curso_nombre,
  estado,          // 'profesora' | 'otro_rol' | 'sin_matricula' | 'sin_comprobar'
  roles: [],
  enlace: null,
});

/**
 * Comprueba un campus: su cuenta y su rol en cada curso. Nunca lanza: lo que falla se
 * dice en `problema`, y los cursos que no se han podido mirar quedan «sin_comprobar».
 */
async function comprobarCampus({ tutor, projectId, campus, cursos, tieneCampus, vinculo }, opciones) {
  const entrada = {
    project_id: projectId,
    campus,
    tiene_campus: tieneCampus,
    campus_conectado: false,
    // Lo que lee «Mi campus»: la cuenta vinculada en el CRM y activa.
    vinculada_en_crm: Boolean(vinculo && vinculo.estado === 'activa' && vinculo.moodle_user_id != null),
    cuenta: null,
    problemas: [],
    cursos: cursos.map((c) => cursoSinMirar(c, 'sin_comprobar')),
  };
  if (!tieneCampus) {
    entrada.problemas.push('No tiene este campus: asígnaselo en «Consultas de alumnos» › Añadir un campus.');
  }

  const conexion = await conexionDelCampus(projectId);
  if (!conexion) {
    entrada.problemas.push('El Moodle de este campus no está conectado en Integraciones: no se puede comprobar.');
    return entrada;
  }
  if (conexion.error) {
    entrada.problemas.push(conexion.error);
    return entrada;
  }
  entrada.campus_conectado = true;
  const base = urlDelCampus(conexion.url);
  for (const c of entrada.cursos) c.enlace = `${base}/user/index.php?id=${c.curso_moodle_id}`;

  try {
    // La cuenta vinculada (también a mano) manda; si no hay, la de su correo del CRM.
    const vinculada = vinculo?.moodle_user_id != null ? Number(vinculo.moodle_user_id) : null;
    const cuenta = vinculada
      ? await usuarioPor(conexion, 'id', vinculada, opciones)
      : await usuarioPorCorreo(conexion, tutor.email, opciones);
    if (!cuenta) {
      entrada.problemas.push(vinculada
        ? `La cuenta vinculada (id ${vinculada}) ya no existe en este Moodle: pulsa «Vincular de nuevo».`
        : `No hay ninguna cuenta en este Moodle con su correo del CRM (${tutor.email}). Créala con ese correo o vincúlala a mano.`);
      for (const c of entrada.cursos) c.estado = 'sin_matricula';
      return entrada;
    }
    entrada.cuenta = { id: Number(cuenta.id), nombre: cuenta.nombre || null, suspendida: Boolean(cuenta.suspendido), vinculada: Boolean(vinculada) };
    if (cuenta.suspendido) entrada.problemas.push('Su cuenta de este Moodle está suspendida.');

    // Con un plugin anterior a la 1.10.2 no se puede saber (null): no se inventa.
    const datos = await cuentaDelCampus(conexion, cuenta.id, opciones);
    if (datos?.esAdministrador) {
      entrada.problemas.push('Esa cuenta es la del administrador del sitio: el CRM no la vincula a una tutora. Necesita una cuenta propia.');
    }

    const suyos = new Set((await cursosDe(conexion, cuenta.id, opciones)).map((k) => k.id));
    // Un curso puede venir de dos productos: se pregunta una sola vez por curso.
    const roles = new Map();
    for (const c of entrada.cursos) {
      if (!suyos.has(c.curso_moodle_id)) { c.estado = 'sin_matricula'; continue; }
      if (!roles.has(c.curso_moodle_id)) {
        const yo = (await matriculadosDe(conexion, c.curso_moodle_id, opciones)).find((u) => u.id === Number(cuenta.id));
        roles.set(c.curso_moodle_id, yo?.roles || []);
      }
      c.roles = roles.get(c.curso_moodle_id);
      c.estado = c.roles.some((r) => ROLES_DE_PROFESORA.has(r)) ? 'profesora' : 'otro_rol';
    }

    if (tieneCampus && !entrada.vinculada_en_crm && !cuenta.suspendido && !datos?.esAdministrador) {
      entrada.problemas.push('Su cuenta aún no está vinculada en el CRM: pulsa «Comprobar en los campus».');
    }
  } catch (err) {
    if (!(err instanceof MoodleError)) logger.warn({ projectId, err: err.message }, 'tutores/redaccion: fallo al leer el campus');
    entrada.problemas.push(mensajeDe(err, 'No se ha podido leer el campus.'));
  }
  return entrada;
}

/**
 * Cómo está la redactora en Moodle para los cursos que redacta.
 *
 * `campusVisibles`: los campus de quien mira (null = todos). Un campus de otra empresa
 * no se mira ni se enseña, como el vínculo de su cuenta (#689, punto 2).
 *
 * Devuelve `{ es_redactora, campus: [...], sin_curso: [...], lista }`. `lista` es que
 * hay al menos un curso y en todos los campus está todo bien.
 */
export async function redaccionEnMoodle(tutorId, { campusVisibles = null, ...opciones } = {}) {
  const { rows: [tutor] } = await query(
    `SELECT id, email,
            (role::text = 'tutor_redactor' OR 'tutor_redactor' = ANY(COALESCE(roles_extra, '{}')::text[])) AS es_redactora
       FROM users WHERE id = $1`, [tutorId]);
  if (!tutor) return null;
  const visible = (id) => campusVisibles === null || campusVisibles.includes(Number(id));

  const filas = await cursosQueRedacta(tutorId);
  const sinCurso = filas
    .filter((f) => f.curso_moodle_id == null && visible(f.producto_campus_id))
    .map((f) => ({ product_id: f.product_id, producto: f.producto, producto_activo: f.producto_activo, por: f.por }));

  const porCampus = new Map();
  for (const f of filas) {
    if (f.curso_moodle_id == null || !visible(f.project_id)) continue;
    if (!porCampus.has(f.project_id)) porCampus.set(f.project_id, { campus: f.campus, cursos: [] });
    porCampus.get(f.project_id).cursos.push(f);
  }

  const suyos = new Set((await campusDelTutor(tutorId)).map((c) => c.project_id));
  const { rows: vinculos } = await query(
    'SELECT project_id, estado, moodle_user_id FROM tutor_campus WHERE tutor_id = $1', [tutorId]);
  const vinculoDe = new Map(vinculos.map((v) => [Number(v.project_id), v]));

  const campus = [];
  // De uno en uno: son pocos campus por redactora y así no se le cae un Moodle encima.
  for (const [projectId, { campus: nombre, cursos }] of porCampus) {
    campus.push(await comprobarCampus({
      tutor, projectId, campus: nombre, cursos, tieneCampus: suyos.has(projectId), vinculo: vinculoDe.get(projectId),
    }, opciones));
  }

  const lista = campus.length > 0 && campus.every((c) => c.problemas.length === 0
    && c.cursos.every((k) => k.estado === 'profesora'));
  return { es_redactora: Boolean(tutor.es_redactora), campus, sin_curso: sinCurso, lista };
}
