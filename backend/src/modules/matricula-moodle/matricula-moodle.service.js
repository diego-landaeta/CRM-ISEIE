import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import * as cfg from './matricula-moodle.config.js';
import * as model from './matricula-moodle.model.js';
import { matricularEnMoodle } from './matricula-moodle.moodle.js';
import * as correo from './matricula-moodle.correo.js';

/**
 * Matrícula automática en Moodle (#767) · fases 1 y 2.
 *
 *   1) Con el PRIMER pago de una venta (lo cobrado pasa de 0 a más de 0) se
 *      programa su matrícula: para el día anterior a `fecha_inicio`, o para ya
 *      si no tiene fecha o ese día ya pasó. «En planes de pago, con el primer
 *      pago» está decidido en la issue.
 *   2) Si se borra la venta, o se quita el pago y lo cobrado vuelve a 0, la
 *      matrícula que aún no se ha hecho se cancela.
 *   3) Cada hora, el trabajo (`vuelta`) coge las que ya tocan, comprueba que se
 *      pueden hacer y:
 *        · FASE 2 (#455): si el campus tiene el plugin conectado, la hace en
 *          Moodle (`hacerEnMoodle`), la deja «hecha» y le manda al alumno su
 *          correo de bienvenida (`bienvenida`). Lo que no se arregla
 *          reintentando (cuenta suspendida, un rechazo del plugin) queda en
 *          «fallo» con aviso a la primera; un campus sin la 1.12.0, con aviso
 *          y reintento lento.
 *        · FASE 1, si el campus no tiene el plugin conectado: la deja «lista»
 *          y avisa por la campana a administración para que la haga a mano.
 *        · si algo falta (correo del alumno, curso de Moodle en el producto…),
 *          lo reintenta a la hora siguiente; al agotar los intentos queda en
 *          «fallo» y se avisa a administración con el motivo.
 *
 * Los datos de acceso los manda el CRM, no Moodle (Diego, 23/11): el plugin crea
 * la cuenta sin mandar nada y devuelve un enlace de un solo uso para poner la
 * contraseña, que va SOLO en el correo (ni en la base ni en el registro).
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
// Fase 2: lo que pide que alguien lo mire YA (suspendida, rechazada, a medias, el
// campus sin la 1.12.0 o el correo de bienvenida que no salió).
export const TIPO_REVISAR = 'matricula_moodle_revisar';

/** Un campus sin preparar (sin la 1.12.0, token sin permiso) se reintenta cada día. */
const ESPERA_CAMPUS_SIN_PREPARAR_MIN = 24 * 60;

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
  if (!fila.lead_id || fila.alumno_borrado) return { motivo: 'La ficha del alumno ya no existe' };
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
 * FASE 2 (#455): crear o reutilizar el usuario por correo y matricularlo como
 * alumno en cada curso con `local_crm_matricular` (plugin 1.12.0). El detalle de
 * lo que devuelve, en `matricula-moodle.moodle.js`. Si lanza, cuenta como un
 * intento fallido con el mensaje del error (red, tiempo…) y se reintenta.
 */
export async function hacerEnMoodle(fila, cursos, deps) {
  return matricularEnMoodle(fila, cursos, deps);
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

/** Una nota en la ficha del alumno (lo que pasó con su matrícula). Nunca lanza. */
async function anotarEnFicha(fila, texto) {
  if (!fila.lead_id) return;
  try {
    const leadModel = await import('../leads/lead.model.js');
    await leadModel.createInteraction(fila.lead_id, 'nota', texto, null, null);
  } catch (err) {
    logger.warn({ err: err.message, matriculaId: fila.id }, 'matrícula Moodle: no se pudo anotar en la ficha');
  }
}

const ahoraEnMadrid = () => new Intl.DateTimeFormat('es-ES', {
  timeZone: cfg.ZONA, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).format(new Date());

/**
 * El correo de bienvenida al alumno, ya matriculado (#455). Devuelve qué pasó, para
 * la ficha: `{ enviado, texto }`. Nunca lanza: la matrícula ya está hecha.
 *
 *   · cuenta NUEVA con enlace: siempre (sin él no puede entrar).
 *   · cuenta que ya existía: solo con MATRICULA_MOODLE_CORREO_EXISTENTES, y solo con
 *     los cursos en los que se le acaba de matricular (los `ya_estaba` no son nuevos).
 *
 * `enviar` solo lo usan las pruebas (por defecto, `sendEmail` de Brevo, con el freno).
 */
export async function bienvenida(fila, r, { enviar = null } = {}) {
  const bien = (r.cursos || []).filter((c) => c.resultado === 'matriculado' || c.resultado === 'ya_estaba');
  const nuevos = bien.filter((c) => c.resultado === 'matriculado');
  let armado;
  let cual;
  if (r.nuevo) {
    if (!r.enlace) return { enviado: false, texto: 'Cuenta nueva, pero el campus no ha dado el enlace para poner la contraseña: no se manda correo' };
    cual = 'con el enlace para poner su contraseña';
  } else {
    if (!cfg.correoExistentes()) return { enviado: false, texto: 'Ya tenía cuenta en el campus: no se le manda correo (MATRICULA_MOODLE_CORREO_EXISTENTES apagado)' };
    if (!nuevos.length) return { enviado: false, texto: 'Ya tenía cuenta y ya estaba en todos los cursos: no se le manda correo' };
    cual = 'con sus cursos nuevos y el acceso al campus';
  }

  try {
    const proyecto = await model.campus(fila.project_id);
    armado = r.nuevo
      ? correo.armarNuevo({ alumno: fila.alumno_nombre, proyecto, campusUrl: r.campusUrl, cursos: bien, enlace: r.enlace })
      : correo.armarExistente({ alumno: fila.alumno_nombre, proyecto, campusUrl: r.campusUrl, cursos: nuevos });
    const mandar = enviar ?? (await import('../../shared/services/brevo.service.js')).sendEmail;
    const res = await mandar({
      to: { email: String(fila.alumno_email).trim(), name: fila.alumno_nombre || undefined },
      subject: armado.asunto,
      htmlContent: armado.htmlContent,
      textContent: armado.textContent,
      tags: ['matricula-moodle', r.nuevo ? 'bienvenida-nuevo' : 'bienvenida-existente'],
      projectId: fila.project_id,
      // El nombre del campus como remitente: sin cuenta de Brevo propia, el de serie es
      // «CRM ISEIE», y al alumno no se le nombra el CRM.
      fromName: proyecto?.nombre || undefined,
      // Una sola vez por matrícula, aunque la vuelta se repita.
      clave: `matricula-moodle:${fila.id}:bienvenida`,
    });
    if (res?.sent) return { enviado: true, texto: `Correo de bienvenida enviado ${cual} (${ahoraEnMadrid()})` };
    if (res?.reason === 'FRENO_DE_PRUEBAS') {
      return { enviado: false, frenado: true, texto: `Correo de bienvenida ${cual} preparado, pero no enviado: freno de correos de pruebas (EMAIL_LISTA_BLANCA)` };
    }
    if (res?.repetido) return { enviado: false, texto: 'El correo de bienvenida ya se había enviado antes: no se repite' };
    return { enviado: false, fallo: true, texto: `El correo de bienvenida ${cual} no ha salido (${res?.reason || 'sin respuesta'})` };
  } catch (err) {
    logger.warn({ err: err.message, matriculaId: fila.id }, 'matrícula Moodle: fallo al mandar la bienvenida');
    return { enviado: false, fallo: true, texto: `El correo de bienvenida ${cual} no ha salido (${err.message})` };
  }
}

/** Ya hecha en Moodle: se marca, se avisa si fue a medias y se manda la bienvenida. */
async function alHacerla(fila, cursos, r, { destinatarios, enviar }) {
  const fallidos = r.fallidos || [];
  const parcial = fallidos.length
    ? `No se pudo en: ${fallidos.map((c) => `${c.curso_nombre || `curso id ${c.curso_moodle_id}`} (${c.mensaje || 'error'})`).join('; ')}`
    : null;
  const hecha = await model.marcarHecha(fila.id, { cursos: r.cursos || cursos, moodleUserId: r.moodleUserId ?? null, motivo: parcial });
  if (!hecha) return 'ocupada';

  const bienvenidos = (r.cursos || []).filter((c) => c.resultado === 'matriculado' || c.resultado === 'ya_estaba');
  const correoHecho = await bienvenida(fila, r, { enviar });
  await anotarEnFicha(fila, [
    `🎓 Matriculado en Moodle (${fila.campus_nombre}): ${listaDeCursos(bienvenidos)}.`,
    r.nuevo ? `Cuenta nueva en el campus${r.moodleUserId ? ` (id ${r.moodleUserId})` : ''}.` : 'Ya tenía cuenta en el campus.',
    parcial ? `${parcial}.` : null,
    `${correoHecho.texto}.`,
  ].filter(Boolean).join(' '));

  if (parcial) {
    await avisar(fila, {
      tipo: TIPO_REVISAR,
      title: `Matrícula a medias: ${fila.alumno_nombre || 'alumno'} (${fila.campus_nombre})`,
      message: `Se ha matriculado en Moodle en ${listaDeCursos(bienvenidos)}. ${parcial}. Hazlo a mano en esos cursos.`,
    }, destinatarios);
  }
  if (correoHecho.fallo) {
    await avisar(fila, {
      tipo: TIPO_REVISAR,
      title: `No salió la bienvenida de ${fila.alumno_nombre || 'un alumno'} (${fila.campus_nombre})`,
      message: `Está matriculado en Moodle, pero ${correoHecho.texto.charAt(0).toLowerCase()}${correoHecho.texto.slice(1)}. `
        + 'Que use «¿Has olvidado tu contraseña?» en el campus, o mándale el acceso a mano.',
    }, destinatarios);
  }
  logger.info({ matriculaId: fila.id, moodleUserId: r.moodleUserId, nuevo: !!r.nuevo, parcial: !!parcial, correo: correoHecho.enviado },
    'matrícula Moodle: hecha');
  return parcial ? 'parcial' : 'hecha';
}

/** Una matrícula que ya toca. Devuelve qué pasó con ella. */
export async function procesar(fila, { destinatarios = null, moodle = hacerEnMoodle, enviar = null } = {}) {
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
  let r = null;
  try {
    ({ motivo, cursos } = await comprobar(fila));
    if (!motivo) {
      r = await moodle(fila, cursos);
      if (r?.hecha) return await alHacerla(fila, cursos, r, { destinatarios, enviar });
    }
  } catch (err) {
    motivo = `Error al matricular: ${err.message}`;
  }

  // Lo que no se arregla reintentando: «fallo» ya, con aviso y nota en la ficha.
  if (r?.definitivo) {
    const f = await model.anotarFallo(fila.id, r.motivo, { maximo: 1 });
    if (!f) return 'ocupada';
    const suspendido = r.tipo === 'suspendido';
    await avisar(fila, {
      tipo: TIPO_REVISAR,
      title: suspendido
        ? `Alumno suspendido en Moodle: ${fila.alumno_nombre || 'alumno'} (${fila.campus_nombre})`
        : `Matrícula rechazada por Moodle: ${fila.alumno_nombre || 'alumno'} (${fila.campus_nombre})`,
      message: `${r.motivo}. No se reintenta sola: ${listaDeCursos(cursos)}.`,
    }, destinatarios);
    await anotarEnFicha(fila, `⚠️ Matrícula en Moodle sin hacer (${fila.campus_nombre}): ${r.motivo}.`);
    logger.warn({ matriculaId: fila.id, tipo: r.tipo }, 'matrícula Moodle: no se puede hacer, se avisa a administración');
    return suspendido ? 'suspendido' : 'fallo';
  }

  // El campus no está preparado (sin la 1.12.0…): aviso la primera vez y reintento
  // al día siguiente; al agotar los intentos, «fallo» como cualquier otro.
  if (r?.lento) {
    const f = await model.anotarFallo(fila.id, r.motivo, { maximo: cfg.intentosMaximos(), minutos: ESPERA_CAMPUS_SIN_PREPARAR_MIN });
    if (!f) return 'ocupada';
    if (f.estado === 'fallo' || fila.motivo !== r.motivo) {
      await avisar(fila, {
        tipo: f.estado === 'fallo' ? TIPO_FALLO : TIPO_REVISAR,
        title: `Moodle del campus sin preparar para matricular (${fila.campus_nombre})`,
        message: `${r.motivo}. La matrícula de ${fila.alumno_nombre || 'un alumno'} (${listaDeCursos(cursos)}) `
          + (f.estado === 'fallo'
            ? `ha fallado ${f.intentos} veces. Hazla a mano en Moodle.`
            : 'se vuelve a intentar mañana; mientras, se puede hacer a mano.'),
      }, destinatarios);
    }
    return f.estado === 'fallo' ? 'fallo' : 'espera';
  }

  if (motivo) {
    const f = await model.anotarFallo(fila.id, motivo, { maximo: cfg.intentosMaximos() });
    if (f?.estado === 'fallo') {
      await avisar(fila, {
        tipo: TIPO_FALLO,
        title: `No se pudo preparar la matrícula de ${fila.alumno_nombre || 'un alumno'} (${fila.campus_nombre})`,
        message: `${motivo}. Se ha intentado ${f.intentos} veces. Corrígelo y matricúlalo a mano en Moodle.`,
      }, destinatarios);
      logger.warn({ matriculaId: fila.id, motivo }, 'matrícula Moodle: fallo definitivo, se avisa a administración');
      return 'fallo';
    }
    return 'reintento';
  }

  // Sin plugin conectado en el campus: como en la fase 1, a mano.
  const lista = await model.marcarLista(fila.id, cursos);
  if (!lista) return 'ocupada';
  await avisar(fila, {
    tipo: TIPO_LISTA,
    title: `Matrícula lista: ${fila.alumno_nombre || 'alumno'} (${fila.campus_nombre})`,
    message: `Ya ha pagado y toca matricularle en Moodle: ${listaDeCursos(cursos)}. `
      + 'El campus no tiene el plugin del CRM conectado, así que se hace a mano.',
  }, destinatarios);
  return 'lista';
}

/**
 * Una vuelta del trabajo de cada hora. `destinatarios` y `enviar` solo los usan
 * las pruebas; en el servidor son los admins del campus y los super admin, y Brevo.
 */
export async function vuelta({ destinatarios = null, moodle = hacerEnMoodle, enviar = null } = {}) {
  const resumen = {
    revisadas: 0, lista: 0, hecha: 0, parcial: 0, suspendido: 0, espera: 0, reintento: 0, fallo: 0, cancelada: 0, ocupada: 0,
  };
  if (!cfg.activa()) return resumen;
  await model.ajustarFechas();
  const filas = await model.pendientes();
  for (const fila of filas) {
    resumen.revisadas += 1;
    try {
      const r = await procesar(fila, { destinatarios, moodle, enviar });
      resumen[r] = (resumen[r] || 0) + 1;
    } catch (err) {
      logger.error({ err: err.message, matriculaId: fila.id }, 'matrícula Moodle: fallo al procesar');
    }
  }
  return resumen;
}
