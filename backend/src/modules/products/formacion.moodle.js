import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { formacionesMoodleActivas, pluginMoodleActivo } from '../../shared/config/soloEnPruebas.js';
import { guardarCursoEnMoodle, MoodleError } from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';
import { textoParaElCampus } from '../consultas/consultas.service.js';
import * as cursosProducto from '../moodle/moodle.cursosProducto.model.js';
import { vaciarCacheCursosProducto } from '../moodle/moodle.cursosProducto.controller.js';

/**
 * Formaciones desde el CRM · fase 2 (CRM#1113 / CRM-ISEIE#767): «Crear en Moodle» /
 * «Actualizar en Moodle» desde la ficha de la formación.
 *
 * El curso se crea (o se actualiza) en el Moodle del campus con el plugin local_crm
 * 1.12.0 (`local_crm_curso_guardar`): nombre, fechas y una sección por módulo, con su
 * título y su temario. Después queda unido al producto en `moodle_cursos_producto`, lo
 * mismo que se hace a mano en «Cursos de Moodle» y lo que lee la matrícula automática.
 *
 * Reglas:
 *   · Apagado en producción hasta que se apruebe (FORMACIONES_MOODLE_EN_PRODUCCION=1).
 *   · Con un curso ya unido, se actualiza ESE; sin él, el plugin busca por el idnumber
 *     del CRM («crm-<campus>-<producto>») antes de crear: dos clics no crean dos cursos.
 *   · Con más de un curso unido no se adivina cuál: se dice y no se hace nada.
 *   · El curso nuevo nace oculto a los alumnos; las secciones de más no se borran.
 */

/** ¿Se puede usar en este servidor? (el interruptor y el plugin). */
export const moodleDisponible = (env = process.env) => formacionesMoodleActivas(env) && pluginMoodleActivo(env);

/** El idnumber que el CRM pone a sus cursos, para encontrarlos otra vez. */
export const idnumberDe = (projectId, productId) => `crm-${projectId}-${productId}`;

/** Un día «AAAA-MM-DD» como marca de tiempo de Moodle, a mediodía UTC: el mismo día en España y en América. */
export function marcaDeDia(dia) {
  if (!dia) return 0;
  const t = Date.parse(`${String(dia).slice(0, 10)}T12:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / 1000) : 0;
}

/** Lo que se manda al plugin, a partir de la formación y sus módulos. */
export function datosDelCurso(formacion, modulos, { cursoId = 0, categoria = 0 } = {}) {
  return {
    cursoId,
    idnumber: idnumberDe(formacion.project_id, formacion.id),
    nombre: formacion.nombre,
    nombreCorto: formacion.nombre.slice(0, 255),
    categoria,
    inicio: marcaDeDia(formacion.fecha_inicio),
    fin: marcaDeDia(formacion.fecha_fin),
    secciones: modulos.map((m) => ({
      nombre: m.titulo.slice(0, 255),
      resumen: m.descripcion ? textoParaElCampus(m.descripcion) : '',
    })),
  };
}

/** ¿Tiene el campus su Moodle conectado con el plugin? (sin descifrar nada) */
export async function campusConectado(projectId) {
  const { rows } = await query(
    `SELECT 1 FROM project_integrations
      WHERE project_id = $1 AND provider = 'moodle' AND active = true AND encrypted_value IS NOT NULL`,
    [projectId]
  );
  return rows.length > 0;
}

export async function llevarAMoodle(productId, projectId, { categoria = 0, userId = null, ip = null, fetchImpl } = {}) {
  if (!moodleDisponible()) {
    throw new AppError('Crear cursos en Moodle desde el CRM aún no está aprobado en este servidor.', 409, 'APAGADO');
  }
  const { rows: [p] } = await query(
    'SELECT id, project_id, nombre, fecha_inicio, fecha_fin FROM products WHERE id = $1', [productId]);
  if (!p) throw new AppError('Formación no encontrada', 404, 'PRODUCT_NOT_FOUND');
  if (Number(p.project_id) !== Number(projectId)) throw new AppError('No tienes acceso a esta formación', 403, 'FORBIDDEN');
  const fecha = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);
  const formacion = { ...p, id: Number(p.id), project_id: Number(p.project_id), fecha_inicio: fecha(p.fecha_inicio), fecha_fin: fecha(p.fecha_fin) };

  const { rows: modulos } = await query(
    'SELECT titulo, descripcion FROM product_modules WHERE product_id = $1 ORDER BY orden, id', [productId]);
  if (!modulos.length) throw new AppError('La formación no tiene módulos: añádelos antes de llevarla a Moodle.', 409, 'SIN_MODULOS');

  const { rows: unidos } = await query(
    'SELECT curso_moodle_id FROM moodle_cursos_producto WHERE product_id = $1 AND project_id = $2', [productId, projectId]);
  if (unidos.length > 1) {
    throw new AppError('Esta formación está unida a varios cursos de Moodle: deja uno en «Cursos de Moodle» antes de actualizar.', 409, 'VARIOS_CURSOS');
  }

  const conexion = await conexionDelCampus(projectId);
  if (!conexion) throw new AppError('Este campus no tiene su Moodle conectado (Integraciones › Moodle).', 409, 'SIN_MOODLE');
  if (conexion.error) throw new AppError(conexion.error, 409, 'SIN_MOODLE');

  let r;
  try {
    r = await guardarCursoEnMoodle(conexion, datosDelCurso(formacion, modulos, {
      cursoId: unidos[0] ? Number(unidos[0].curso_moodle_id) : 0, categoria,
    }), fetchImpl ? { fetchImpl } : undefined);
  } catch (err) {
    if (err instanceof MoodleError) {
      const mensaje = err.codigo === 'SIN_FUNCION' || err.codigo === 'PERMISO'
        ? `${err.message} Hace falta el plugin del CRM 1.12.0 en el campus.`
        : err.message;
      throw new AppError(mensaje, 502, 'MOODLE');
    }
    throw err;
  }

  await cursosProducto.unir({ productId, projectId, curso: { id: r.cursoId, nombre: r.nombre }, userId, ip });
  vaciarCacheCursosProducto();
  return r;
}
