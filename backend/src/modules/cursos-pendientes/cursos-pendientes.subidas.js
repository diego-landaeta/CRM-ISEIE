import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { explicarPermisos } from '../permissions/permissions.service.js';
import * as model from './cursos-pendientes.model.js';

/**
 * Control de subidas de contenido por curso (#771, Automatizaciones 8/9).
 *
 * Cuando una formación de «Cursos pendientes» está entregada, quien lleva las
 * subidas marca tres puntos: los vídeos de los directores en
 * YouTube, los módulos en el Moodle del campus y los datos de los directores
 * enviados para la web. Administración ve solo lo atrasado.
 *
 *   · Una fila por curso y punto (`cursos_pendientes_subidas`, migración 309 en ISEIE, 297 en el 360).
 *     `created_at` es «desde cuándo falta»; la fecha límite sale de sumar
 *     CONTROL_SUBIDAS_PLAZO_DIAS (7 de serie) al día en que se abre, y se puede
 *     mover punto a punto.
 *   · «Atrasado» no se guarda: sale solo (fecha límite pasada y sin hacer).
 *   · Quién marca: quien tiene «Gestionar colaboraciones» (`tutores.gestionar`),
 *     que es el permiso que ya tiene quien lleva las subidas, en los campus que ve. Lo pone el
 *     guardia de la ruta; el campus, `cargarVisible` del servicio.
 *   · Avisos: solo en la campana, nunca por correo (y por tanto nunca a un tutor:
 *     el freno NO_ESCRIBIR_A_TUTORES ni entra en juego). Apagados de serie;
 *     CONTROL_SUBIDAS_AVISOS=1 los enciende.
 *
 * PUNTO DE UNIÓN CON LA #770. La lista se abre SOLA cuando el curso pasa a
 * «entregado» (ESTADO_QUE_ABRE_EL_CONTROL): `modificar` llama a `abrirControl`
 * dentro de su transacción. Ese estado lo añade la #770; mientras no esté, nadie
 * puede poner un curso en «entregado» y la lista se abre a mano desde la ficha
 * (POST /:id/subidas), que sirve también para los cursos que ya existían.
 */

export const PUNTOS = [
  { clave: 'videos_youtube', nombre: 'Vídeos de los directores en YouTube' },
  { clave: 'modulos_moodle', nombre: 'Módulos subidos al Moodle' },
  { clave: 'datos_directores_web', nombre: 'Datos de los directores enviados para la web' },
];
const CLAVES = PUNTOS.map((p) => p.clave);
const nombreDe = (clave) => PUNTOS.find((p) => p.clave === clave)?.nombre || clave;

/** El estado de «Cursos pendientes» que abre la lista sola. Lo trae la #770. */
export const ESTADO_QUE_ABRE_EL_CONTROL = 'entregado';

/** El permiso que deja ver el control y marcar. */
export const PERMISO_SUBIDAS = 'tutores.gestionar';

export const plazoDias = () => {
  const n = parseInt(process.env.CONTROL_SUBIDAS_PLAZO_DIAS || '7', 10);
  return Number.isInteger(n) && n > 0 && n <= 365 ? n : 7;
};

export const avisosActivos = () => {
  const v = String(process.env.CONTROL_SUBIDAS_AVISOS || '').toLowerCase();
  return v === '1' || v === 'true';
};

const zona = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/**
 * Abre la lista de control de un curso: un punto por cada uno de PUNTOS, con su
 * fecha límite. Si ya estaba abierta no toca nada (ni las fechas ni lo marcado).
 * Devuelve cuántos puntos ha creado. `client`: para ir dentro de una transacción.
 */
export async function abrirControl(cursoId, { userId = null, client = null } = {}) {
  const q = client ? client.query.bind(client) : query;
  const { rowCount } = await q(
    `INSERT INTO cursos_pendientes_subidas (curso_id, punto, fecha_limite, created_by)
     SELECT $1, p, (now() AT TIME ZONE $3::text)::date + $4::int, $5
       FROM unnest($2::text[]) AS p
     ON CONFLICT (curso_id, punto) DO NOTHING`,
    [cursoId, CLAVES, zona(), plazoDias(), userId]
  );
  if (rowCount > 0) await model.apuntar(cursoId, userId, 'subidas_abiertas', { puntos: rowCount, plazo_dias: plazoDias() }, null, client);
  return rowCount;
}

// `zonaSql`: el parámetro con la zona de la app (`$n::text`). El día de `created_at`
// también es el de esa zona: con `::date` a secas sería el de la sesión (UTC) y,
// pasada la medianoche en Madrid, «hoy» y «desde» caerían en días distintos.
const COLUMNAS = (zonaSql) => {
  const hoy = `(now() AT TIME ZONE ${zonaSql})::date`;
  return `
  s.id, s.curso_id, s.punto, s.fecha_limite::text AS fecha_limite, s.hecho, s.hecho_at, uh.nombre AS hecho_por,
  s.enlace, s.nota, s.created_at AS desde,
  (NOT s.hecho AND s.fecha_limite < ${hoy}) AS atrasado,
  (${hoy} - (s.created_at AT TIME ZONE ${zonaSql})::date) AS dias_esperando,
  CASE WHEN s.hecho THEN NULL ELSE (${hoy} - s.fecha_limite) END AS dias_de_retraso`;
};

const conNombre = (r) => ({ ...r, nombre: nombreDe(r.punto) });

/** Los puntos de un curso, en el orden de PUNTOS. Vacío si la lista no está abierta. */
export async function puntosDe(cursoId) {
  const { rows } = await query(
    `SELECT ${COLUMNAS('$2::text')}
       FROM cursos_pendientes_subidas s LEFT JOIN users uh ON uh.id = s.hecho_por
      WHERE s.curso_id = $1`,
    [cursoId, zona()]
  );
  return rows.map(conNombre).sort((a, b) => CLAVES.indexOf(a.punto) - CLAVES.indexOf(b.punto));
}

/**
 * Lo que falta subir, por curso: cada punto sin hacer con desde cuándo y su
 * fecha límite. `soloAtrasadas`: la vista de administración. `projectIds`: los
 * campus que ve quien pregunta (null = todos). Los cancelados no cuentan.
 */
export async function listarPendientes({ projectIds = null, soloAtrasadas = false, incluirHechas = false } = {}) {
  const hoy = '(now() AT TIME ZONE $1::text)::date';
  const params = [zona()];
  const cond = [`c.estado <> 'cancelado'`];
  if (projectIds) { params.push(projectIds); cond.push(`c.project_id = ANY($${params.length}::int[])`); }
  if (!incluirHechas) cond.push('NOT s.hecho');
  if (soloAtrasadas) cond.push(`NOT s.hecho AND s.fecha_limite < ${hoy}`);
  const { rows } = await query(
    `SELECT ${COLUMNAS('$1::text')}, c.nombre AS curso, c.estado AS estado_curso, c.project_id, p.nombre AS campus
       FROM cursos_pendientes_subidas s
       JOIN cursos_pendientes c ON c.id = s.curso_id
       JOIN projects p ON p.id = c.project_id
       LEFT JOIN users uh ON uh.id = s.hecho_por
      WHERE ${cond.join(' AND ')}
      ORDER BY s.hecho, s.fecha_limite, p.nombre, c.nombre, s.id`,
    params
  );
  return rows.map(conNombre);
}

const fechaOk = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(v));

/**
 * Marca un punto: `hecho`, `enlace`, `nota` y/o `fecha_limite`. El curso ya
 * viene comprobado (que existe y que quien marca lo ve). Lo deja en el historial.
 */
export async function marcarPunto(user, curso, punto, cambios) {
  if (!CLAVES.includes(punto)) throw new AppError('Ese punto no existe', 400, 'VALIDATION_ERROR');
  const { rows: [fila] } = await query(
    `SELECT * FROM cursos_pendientes_subidas WHERE curso_id = $1 AND punto = $2`, [curso.id, punto]);
  if (!fila) throw new AppError('Este curso no tiene la lista de subidas abierta', 409, 'SUBIDAS_SIN_ABRIR');
  if (curso.estado === 'cancelado') throw new AppError('Ese curso está cancelado', 409, 'CONFLICT');

  const sets = [];
  const params = [fila.id];
  const detalle = { punto };
  const poner = (sql, valor) => { params.push(valor); sets.push(sql.replace('?', `$${params.length}`)); };

  if (typeof cambios.hecho === 'boolean' && cambios.hecho !== fila.hecho) {
    poner('hecho = ?', cambios.hecho);
    if (cambios.hecho) { poner('hecho_por = ?', user.userId); sets.push('hecho_at = NOW()'); } else sets.push('hecho_por = NULL', 'hecho_at = NULL');
    detalle.hecho = cambios.hecho;
  }
  if ('enlace' in cambios && (cambios.enlace || null) !== (fila.enlace || null)) {
    const e = cambios.enlace ? String(cambios.enlace).trim() : null;
    if (e && !/^https?:\/\/\S+$/i.test(e)) throw new AppError('El enlace tiene que empezar por https://', 400, 'VALIDATION_ERROR');
    poner('enlace = ?', e);
    detalle.enlace = e;
  }
  if ('nota' in cambios && (cambios.nota || null) !== (fila.nota || null)) {
    poner('nota = ?', cambios.nota ? String(cambios.nota).trim() : null);
    detalle.nota = true;
  }
  // DATE llega como texto AAAA-MM-DD (shared/config/db.js).
  if ('fecha_limite' in cambios && String(cambios.fecha_limite) !== String(fila.fecha_limite).slice(0, 10)) {
    if (!fechaOk(cambios.fecha_limite)) throw new AppError('La fecha tiene que ser AAAA-MM-DD', 400, 'VALIDATION_ERROR');
    poner('fecha_limite = ?', cambios.fecha_limite);
    detalle.fecha_limite = cambios.fecha_limite;
  }

  if (sets.length) {
    await query(`UPDATE cursos_pendientes_subidas SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
    await model.apuntar(curso.id, user.userId, 'subida_marcada', detalle, null);
  }
  return puntosDe(curso.id);
}

// ── Avisos ────────────────────────────────────────────────────────────────

/**
 * Quién lleva las subidas de un campus: las personas activas de ese campus con
 * «Gestionar colaboraciones». Si no hay nadie, el admin del campus (y los super
 * admin), para que el aviso no se pierda.
 */
export async function responsablesDelCampus(projectId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id FROM users u
       JOIN user_projects up ON up.user_id = u.id AND up.project_id = $1 AND up.active
      WHERE u.active`,
    [projectId]
  );
  const con = [];
  for (const { id } of rows) {
    const e = await explicarPermisos(id);
    if (e?.mapa[PERMISO_SUBIDAS] === true) con.push(id);
  }
  return con.length ? con : model.adminsDelCampus(projectId);
}

/**
 * Lo ejecuta el job una vez al día: por cada curso con puntos que acaban de
 * pasar su fecha límite, UN aviso en la campana a quien lleva las subidas de su
 * campus. Cada punto avisa una sola vez por fecha límite (si se mueve la fecha y
 * se vuelve a pasar, vuelve a avisar). Con CONTROL_SUBIDAS_AVISOS apagado no
 * hace nada.
 */
export async function avisarSubidasVencidas() {
  if (!avisosActivos()) return { activo: false, enviados: 0 };
  const { rows } = await query(
    `SELECT s.curso_id, s.punto, s.fecha_limite::text AS fecha_limite, c.nombre, c.project_id, p.nombre AS campus
       FROM cursos_pendientes_subidas s
       JOIN cursos_pendientes c ON c.id = s.curso_id
       JOIN projects p ON p.id = c.project_id
      WHERE NOT s.hecho AND c.estado <> 'cancelado'
        AND s.fecha_limite < (now() AT TIME ZONE $1::text)::date
      ORDER BY s.curso_id, s.punto`,
    [zona()]
  );
  const porCurso = new Map();
  for (const r of rows) {
    const { rowCount } = await query(
      `INSERT INTO cursos_pendientes_avisos (curso_id, tipo, dia) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [r.curso_id, `subida_${r.punto}`.slice(0, 30), r.fecha_limite]
    );
    if (!rowCount) continue;
    if (!porCurso.has(r.curso_id)) porCurso.set(r.curso_id, { ...r, puntos: [] });
    porCurso.get(r.curso_id).puntos.push(nombreDe(r.punto));
  }
  let enviados = 0;
  for (const c of porCurso.values()) {
    const destino = await responsablesDelCampus(c.project_id);
    if (!destino.length) continue;
    await notifyUsers({
      targetUserIds: destino, type: 'curso_pendiente_subida_vencida',
      title: `Subidas atrasadas: ${c.nombre}`,
      message: `${c.campus}. Falta: ${c.puntos.join('; ')}.`,
      link_path: `/products/pending?curso=${c.curso_id}`,
    }).catch((err) => logger.warn({ err: err.message, curso: c.curso_id }, 'Control de subidas: el aviso falló'));
    enviados += 1;
  }
  if (enviados) logger.info({ enviados }, 'Control de subidas: avisos de puntos vencidos');
  return { activo: true, revisados: rows.length, enviados };
}
