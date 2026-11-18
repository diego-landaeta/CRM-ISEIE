import { getClient, query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './cursos-pendientes.model.js';
import { avisarTutora, avisarAlumnaNueva, esResponsableValido, enlace } from './cursos-pendientes.service.js';
import { notificar } from './cursos-pendientes.correos.js';

/**
 * Cursos vendidos sin desarrollar (#770, fase 2 de #336).
 *
 * Al registrar una venta, si alguno de sus cursos está marcado «sin desarrollar»
 * en Productos:
 *   · si ya hay un pendiente abierto de ese curso en el campus, se le suma la
 *     alumna (y su responsable se entera);
 *   · si no, se crea, asignado al responsable del producto y con la fecha
 *     límite = el día de la venta + el plazo. Al responsable le llega el aviso
 *     con esa fecha; si el producto no tiene responsable, a administración del
 *     campus, para que lo asigne.
 * Si la fecha límite pasa sin publicarlo, el aviso de «retrasado» que ya existía
 * (job diario, `avisarVencimientos`) llega al responsable y a administración.
 *
 * DECISIONES ABIERTAS (pendientes de direccion), configurables, con estos valores de serie:
 *   · el responsable se fija en cada producto (`responsable_desarrollo_id`);
 *     vacío = lo asigna administración tras la venta;
 *   · el plazo cuenta desde la venta (si la venta se registra con fecha pasada,
 *     desde hoy, para no nacer ya retrasado). Por producto
 *     (`plazo_desarrollo_dias`) o, si no, el de serie por tipo:
 *     CURSOS_PENDIENTES_PLAZO_DIAS = «30» (todos) o «curso=30,diplomado=45,master=60».
 *
 * Nunca rompe la venta: lo llama `conversion.service.create` después del COMMIT
 * y cualquier fallo se queda en el log.
 *
 * PORTE A CRM-ISEIE (#458): el enlace sale de `enlace()` del servicio (allí es
 * /products/pending). Allí la venta no siempre entra por
 * `conversion.service.create` (Make reparte los leads) y la tabla
 * `cursos_pendientes` tiene que existir antes; sin ella esto falla con 42P01 y
 * solo se registra en el log.
 */

const PLAZO_DE_SERIE = Object.freeze({ curso: 30, diplomado: 45, master: 60 });
const diaValido = (n) => /^\d+$/.test(String(n)) && Number(n) >= 1 && Number(n) <= 365;

/** Los días de serie por tipo, leídos de CURSOS_PENDIENTES_PLAZO_DIAS. Lo que no se entiende, se ignora. */
export function plazosPorDefecto(valor = process.env.CURSOS_PENDIENTES_PLAZO_DIAS) {
  const v = String(valor ?? '').trim().toLowerCase();
  const plazos = { ...PLAZO_DE_SERIE };
  if (!v) return plazos;
  if (diaValido(v)) return { curso: Number(v), diplomado: Number(v), master: Number(v) };
  for (const trozo of v.split(',')) {
    const [tipo, dias] = trozo.split('=').map((s) => String(s ?? '').trim());
    if (tipo in plazos && diaValido(dias)) plazos[tipo] = Number(dias);
  }
  return plazos;
}

/** El tipo del pendiente sale del nombre del producto (el catálogo no lo guarda aparte). */
export function tipoPorNombre(nombre) {
  const n = String(nombre || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  if (/\b(master|maestria)\b/.test(n)) return 'master';
  if (/\bdiplomado\b/.test(n)) return 'diplomado';
  return 'curso';
}

const ZONA = () => process.env.APP_TIMEZONE || 'Europe/Madrid';

/** Los productos «sin desarrollar» de esa venta: el curso de la venta y los de sus líneas. */
async function productosSinDesarrollar(conversionId, projectId) {
  const { rows } = await query(
    `SELECT p.id, p.nombre, p.responsable_desarrollo_id, p.plazo_desarrollo_dias
       FROM products p
      WHERE p.sin_desarrollar AND p.project_id = $2
        AND p.id IN (SELECT producto_contratado_id FROM conversions WHERE id = $1
                     UNION SELECT product_id FROM conversion_items WHERE conversion_id = $1)
      ORDER BY p.id`,
    [conversionId, projectId]
  );
  return rows;
}

/** El pendiente abierto de ese curso en el campus: primero por ficha, luego por nombre. */
async function abiertoEnTx(client, { projectId, productId, nombre }) {
  const { rows: [c] } = await client.query(
    `SELECT id FROM cursos_pendientes
      WHERE project_id = $1 AND estado NOT IN ('cerrado', 'cancelado')
        AND (product_id = $2 OR lower(nombre) = lower($3))
      ORDER BY (product_id IS NOT DISTINCT FROM $2) DESC, id
      LIMIT 1 FOR UPDATE`,
    [projectId, productId, nombre]
  );
  return c?.id || null;
}

async function unCurso(venta, producto, userId) {
  const tipo = tipoPorNombre(producto.nombre);
  const plazo = producto.plazo_desarrollo_dias || plazosPorDefecto()[tipo];
  const responsable = producto.responsable_desarrollo_id && (await esResponsableValido(producto.responsable_desarrollo_id))
    ? producto.responsable_desarrollo_id : null;

  const client = await getClient();
  let cursoId = null; let nuevo = false; let sumada = false;
  try {
    await client.query('BEGIN');
    cursoId = await abiertoEnTx(client, { projectId: venta.project_id, productId: producto.id, nombre: producto.nombre });
    if (!cursoId) {
      // ON CONFLICT sin destino: si otra venta del mismo curso lo acaba de crear
      // (índices únicos parciales de la 217), no falla; se suma a ese.
      const { rows: [c] } = await client.query(
        `INSERT INTO cursos_pendientes (project_id, product_id, nombre, tipo, tutor_id, estado,
                                        fecha_solicitud, fecha_comprometida, created_by)
         VALUES ($1, $2, $3, $4, $5::int, CASE WHEN $5::int IS NULL THEN 'pendiente_asignar' ELSE 'asignado' END,
                 COALESCE($6::date, (now() AT TIME ZONE $7::text)::date),
                 GREATEST(COALESCE($6::date, (now() AT TIME ZONE $7::text)::date), (now() AT TIME ZONE $7::text)::date) + $8::int,
                 $9)
         ON CONFLICT DO NOTHING RETURNING id`,
        [venta.project_id, producto.id, producto.nombre, tipo, responsable, venta.fecha, ZONA(), plazo, userId]
      );
      if (c) {
        cursoId = c.id; nuevo = true;
        await model.apuntar(cursoId, userId, 'creado',
          { nombre: producto.nombre, tipo, origen: 'venta', conversion_id: venta.id, plazo_dias: plazo, tutor_id: responsable }, null, client);
      } else {
        cursoId = await abiertoEnTx(client, { projectId: venta.project_id, productId: producto.id, nombre: producto.nombre });
      }
    }
    if (cursoId) {
      const { rows } = await client.query(
        `INSERT INTO cursos_pendientes_alumnas (curso_id, lead_id, conversion_id) VALUES ($1, $2, $3)
         ON CONFLICT (curso_id, lead_id) DO NOTHING RETURNING id`,
        [cursoId, venta.lead_id, venta.id]
      );
      sumada = rows.length > 0;
      if (sumada) {
        await model.apuntar(cursoId, userId, 'alumna_sumada', { lead_id: venta.lead_id, conversion_id: venta.id, origen: 'venta' }, null, client);
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }

  if (!cursoId) return null;
  const curso = await model.porId(cursoId);
  const quien = { userId: userId || null };
  if (nuevo && curso.tutor_id) await avisarTutora('asignado', curso, curso.tutor_id, quien);
  else if (nuevo) await avisarSinResponsable(curso, quien);
  else if (sumada && curso.tutor_id) await avisarAlumnaNueva(curso, quien);
  return { curso_id: cursoId, nuevo, alumna_sumada: sumada, tutor_id: curso.tutor_id, fecha_limite: curso.fecha_comprometida };
}

async function avisarSinResponsable(curso, user) {
  const admins = await model.adminsDelCampus(curso.project_id);
  if (!admins.length) return;
  const fecha = curso.fecha_comprometida ? String(curso.fecha_comprometida instanceof Date ? curso.fecha_comprometida.toISOString() : curso.fecha_comprometida).slice(0, 10) : null;
  await notificar({
    clave: `cp-vendido-sin-responsable-${curso.id}`, project_id: curso.project_id,
    targetUserIds: admins, type: 'curso_pendiente_sin_tutora',
    title: `Vendido sin desarrollar y sin responsable: ${curso.nombre}`,
    message: `${curso.campus}. Asígnale tutor o redactor${fecha ? `; fecha límite: ${fecha}` : ''}.`,
    link_path: enlace(curso.id), triggered_by_user_id: user?.userId || null,
  }).catch(() => {});
}

/**
 * Lo llama la venta. Devuelve lo que ha hecho con cada curso «sin desarrollar»
 * (vacío si no había ninguno). No lanza: un fallo se registra y la venta sigue.
 */
export async function alVender({ conversionId, userId = null }) {
  const hecho = [];
  try {
    const { rows: [venta] } = await query(
      `SELECT id, lead_id, project_id, fecha_conversion::text AS fecha FROM conversions WHERE id = $1`, [conversionId]);
    if (!venta) return hecho;
    for (const producto of await productosSinDesarrollar(venta.id, venta.project_id)) {
      try {
        const r = await unCurso(venta, producto, userId);
        if (r) hecho.push({ product_id: producto.id, ...r });
      } catch (err) {
        logger.warn({ err: err.message, conversionId, productId: producto.id }, 'Cursos pendientes: no se pudo apuntar el curso vendido sin desarrollar');
      }
    }
    if (hecho.length) logger.info({ conversionId, cursos: hecho.map((h) => h.curso_id) }, 'Cursos pendientes: venta de cursos sin desarrollar');
  } catch (err) {
    logger.warn({ err: err.message, conversionId }, 'Cursos pendientes: no se pudo revisar la venta');
  }
  return hecho;
}
