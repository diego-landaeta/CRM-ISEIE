import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as cfg from './matricula-moodle.config.js';
import * as model from './matricula-moodle.model.js';

/**
 * Matrícula automática en Moodle (#767) · fase 1.
 *
 *   1) Con el PRIMER pago de una venta (lo cobrado pasa de 0 a más de 0) se
 *      programa su matrícula: para el día anterior a `fecha_inicio`, o para ya
 *      si no tiene fecha o ese día ya pasó. «En planes de pago, con el primer
 *      pago» está decidido en la issue.
 *   2) Si se borra la venta, o se quita el pago y lo cobrado vuelve a 0, la
 *      matrícula que aún no se ha hecho se cancela.
 *   3) Cada hora, el trabajo (`vuelta`) coge las que ya tocan, comprueba que se
 *      pueden hacer y:
 *        · FASE 1: la deja «lista» y avisa por la campana a administración del
 *          campus para que la haga a mano. NO llama a Moodle.
 *        · si algo falta (correo del alumno, curso de Moodle en el producto…),
 *          lo reintenta a la hora siguiente; al agotar los intentos queda en
 *          «fallo» y se avisa a administración con el motivo.
 *
 * Lo de la fase 2 entra por `hacerEnMoodle`: crear o reutilizar el usuario por
 * correo y matricularlo con el plugin `local_crm`. Ningún correo al alumno sale
 * de aquí: las credenciales son una decisión pendiente (las mandaría Moodle).
 *
 * Por qué se engancha a `recalcularCobrado` (conversions/cobrado.js): desde la
 * #692/#811 por ahí pasan todos los caminos que tocan un cobro (a mano, cuota,
 * Stripe, PayPal y banco, corregir factura, borrar), y es la única forma de
 * saber «antes no había nada cobrado y ahora sí» sin repetirlo en siete sitios.
 * La única excepción es el pago inicial al crear la venta, que la propia
 * creación avisa aparte (conversion.model.create).
 */

export const TIPO_LISTA = 'matricula_moodle_lista';
export const TIPO_FALLO = 'matricula_moodle_fallo';

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Llamar SIEMPRE dentro de la transacción del cobro, con su cliente (`db`).
 * `antes` y `ahora`: lo cobrado de la venta antes y después del cambio.
 * Apagado el interruptor, no hace ninguna consulta.
 */
export async function alCambiarElCobro(db, conversionId, { antes, ahora }) {
  if (!cfg.activa() || !conversionId) return null;
  const ya = Number(ahora) || 0;
  if (ya > 0 && !(Number(antes) > 0)) {
    const fila = await model.programar(db, conversionId);
    return fila ? { programada: fila.id } : null;
  }
  if (ya <= 0) {
    const ids = await model.cancelarVigentes(db, conversionId, 'Se quitó el pago de la venta');
    return ids.length ? { canceladas: ids } : null;
  }
  return null;
}

/** Antes de borrar la venta (la fila de la matrícula se queda, sin venta). */
export async function alBorrarLaVenta(conversionId, db = { query }) {
  if (!cfg.activa() || !conversionId) return null;
  const ids = await model.cancelarVigentes(db, conversionId, 'Se borró la venta');
  return ids.length ? { canceladas: ids } : null;
}

/**
 * Qué impide hacer la matrícula, o los cursos en los que hacerla.
 * Devuelve `{ motivo }` o `{ cursos }`.
 */
export async function comprobar(fila) {
  const email = String(fila.alumno_email || '').trim();
  if (!fila.lead_id) return { motivo: 'La ficha del alumno ya no existe' };
  if (!CORREO.test(email)) return { motivo: 'El alumno no tiene un correo válido en su ficha' };

  const productos = await model.productosConCursos(fila.conversion_id);
  if (!productos.length) {
    return { motivo: 'La venta no tiene ningún producto del catálogo: no se sabe en qué curso matricular' };
  }
  const sinCurso = productos.filter((p) => !p.cursos.length);
  if (sinCurso.length) {
    const nombres = sinCurso.map((p) => `«${p.nombre}»`).join(', ');
    return { motivo: `${nombres} no ${sinCurso.length > 1 ? 'tienen' : 'tiene'} curso de Moodle asignado` };
  }
  return { cursos: productos.flatMap((p) => p.cursos.map((c) => ({ ...c, product_id: p.id }))) };
}

/**
 * FASE 2 (pendiente): crear o reutilizar el usuario por correo y matricularlo
 * como estudiante en cada curso, por el plugin del campus. Hoy no hace nada y
 * devuelve `{ hecha: false }`: la matrícula queda «lista» para hacerla a mano.
 * Si lanza, cuenta como un intento fallido con el mensaje del error.
 */
export async function hacerEnMoodle(/* fila, cursos */) {
  return { hecha: false };
}

const listaDeCursos = (cursos) => cursos
  .map((c) => (c.curso_nombre ? `${c.curso_nombre} (id ${c.curso_moodle_id})` : `curso id ${c.curso_moodle_id}`))
  .join(', ');

async function avisar(fila, { tipo, title, message }, destinatarios) {
  try {
    const para = destinatarios ?? await model.adminsDelCampus(fila.project_id);
    if (!para.length) return;
    const { notifyUsers } = await import('../notifications/notifications.service.js');
    await notifyUsers({
      targetUserIds: para,
      type: tipo,
      title,
      message,
      link_path: fila.lead_id ? `/clientes/${fila.lead_id}` : null,
      metadata: { matricula_id: fila.id, conversion_id: fila.conversion_id, campus_id: fila.project_id },
    });
  } catch (err) {
    logger.warn({ err: err.message, matriculaId: fila.id }, 'matrícula Moodle: no se pudo avisar');
  }
}

/** Una matrícula que ya toca. Devuelve qué pasó con ella. */
export async function procesar(fila, { destinatarios = null, moodle = hacerEnMoodle } = {}) {
  // La venta se borró o ya no tiene nada cobrado sin pasar por los ganchos
  // (un borrado en bloque, o el interruptor apagado en ese momento).
  if (!fila.venta_id) {
    await model.cancelar(fila.id, 'Se borró la venta');
    return 'cancelada';
  }
  if (!(Number(fila.cobrado) > 0)) {
    await model.cancelar(fila.id, 'La venta ya no tiene ningún pago');
    return 'cancelada';
  }

  let motivo;
  let cursos;
  try {
    ({ motivo, cursos } = await comprobar(fila));
    if (!motivo) {
      const r = await moodle(fila, cursos);
      if (r?.hecha) {
        await model.marcarHecha(fila.id, { cursos, moodleUserId: r.moodleUserId ?? null });
        return 'hecha';
      }
    }
  } catch (err) {
    motivo = `Error al matricular: ${err.message}`;
  }

  if (motivo) {
    const r = await model.anotarFallo(fila.id, motivo, { maximo: cfg.intentosMaximos() });
    if (r?.estado === 'fallo') {
      await avisar(fila, {
        tipo: TIPO_FALLO,
        title: `No se pudo preparar la matrícula de ${fila.alumno_nombre || 'un alumno'} (${fila.campus_nombre})`,
        message: `${motivo}. Se ha intentado ${r.intentos} veces. Corrígelo y matricúlalo a mano en Moodle.`,
      }, destinatarios);
      logger.warn({ matriculaId: fila.id, motivo }, 'matrícula Moodle: fallo definitivo, se avisa a administración');
      return 'fallo';
    }
    return 'reintento';
  }

  const lista = await model.marcarLista(fila.id, cursos);
  if (!lista) return 'ocupada';
  await avisar(fila, {
    tipo: TIPO_LISTA,
    title: `Matrícula lista: ${fila.alumno_nombre || 'alumno'} (${fila.campus_nombre})`,
    message: `Ya ha pagado y toca matricularle en Moodle: ${listaDeCursos(cursos)}. `
      + 'De momento se hace a mano; el CRM aún no matricula solo.',
  }, destinatarios);
  return 'lista';
}

/**
 * Una vuelta del trabajo de cada hora. `destinatarios` solo lo usan las
 * pruebas; en el servidor son los admins del campus y los super admin.
 */
export async function vuelta({ destinatarios = null, moodle = hacerEnMoodle } = {}) {
  const resumen = { revisadas: 0, lista: 0, hecha: 0, reintento: 0, fallo: 0, cancelada: 0, ocupada: 0 };
  if (!cfg.activa()) return resumen;
  await model.ajustarFechas();
  const filas = await model.pendientes();
  for (const fila of filas) {
    resumen.revisadas += 1;
    try {
      const r = await procesar(fila, { destinatarios, moodle });
      resumen[r] = (resumen[r] || 0) + 1;
    } catch (err) {
      logger.error({ err: err.message, matriculaId: fila.id }, 'matrícula Moodle: fallo al procesar');
    }
  }
  return resumen;
}
