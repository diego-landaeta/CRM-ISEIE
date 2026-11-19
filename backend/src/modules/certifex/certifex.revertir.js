import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './certifex.model.js';
import { certifex, certifexPuede, recorrer } from './certifex.cliente.js';
import { alcanceDe, exigirExpedientes } from './certifex.alcance.js';
import { emitidoPorElCrm, revertiblePorEsteCrm } from './certifex.marcas.js';
import { revertirSchema, mensajeDeValidacion } from './certifex.validation.js';

/**
 * «Revertir» un diploma de «Emitidos, falta enviarlos al alumno» (#351).
 *
 * Diego, 03/11/2026, sobre CEDIA-2026-000011-B5HQ (emitido «con lo de Moodle»): «que en
 * esta sección se puedan revertir, porque este, por ejemplo, tiene los módulos malos;
 * reviértelo para que lo modifiquen».
 *
 * Lo hace Certifex (POST /api/crm/v1/revertir, su 0045): el número queda ANULADO (no se
 * borra ni se reutiliza; la verificación pública deja de darlo por válido y su PDF no se
 * sirve ni se envía) y la matrícula vuelve a «aprobada sin diploma». Ahí ya funcionan
 * «Editar» (formación y programa) y «Emitir»; al reemitir sale OTRO número.
 *
 * Aquí:
 *  · solo con `diplomas.revertir` (la ruta) y en sus campus (404 fuera, como revocar);
 *  · solo lo emitido desde el CRM, sin enviar, sin revocar y sin revertir (409), y en esos
 *    casos no se le pide nada a Certifex (que además lo vuelve a comprobar);
 *  · quien revierte ante Certifex es el usuario con sesión, diga lo que diga el cuerpo;
 *  · queda en el CRM (`certifex_reversiones`, migración 301) DESPUÉS de que Certifex lo
 *    haga, con la matrícula que dice Certifex (no la que diga el navegador);
 *  · mientras el Certifex conectado no tenga la ruta, no se usa: 503 sin tocar nada, y
 *    `disponibilidad` se lo dice a la pantalla para que el botón no se ofrezca.
 */

const SIN_TABLA = 'Falta aplicar en la base del CRM la migración 301 (certifex_reversiones), o el CRM no tiene permiso sobre ella.';
const SIN_CERTIFEX = 'El Certifex conectado todavía no permite revertir diplomas (falta desplegar su migración 0045 y POST /revertir).';
const NO_ENCONTRADO = 'Diploma no encontrado.';
const ROTULO_AVISO = { correo_apagado: 'el correo está apagado en el servidor', sin_correo: 'el alumno no tiene correo', error: 'el envío falló' };

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(mensajeDeValidacion(r.error), 400, 'VALIDATION_ERROR');
  return r.data;
}

/** El diploma tal y como lo da Certifex (incluye revocados y anulados), o null. */
async function diplomaPorNumero(nexp) {
  const d = await certifex('GET', `/diplomas?${new URLSearchParams({ estado: 'todos', q: nexp, pagina: '1', tam: '5' })}`);
  return (Array.isArray(d?.filas) ? d.filas : []).find((x) => x.nexpediente === nexp) ?? null;
}

/**
 * « (CRM X)»: cómo firma Certifex lo que hace este CRM (su `actorCrm`/`etiquetaCrm`): el nombre de
 * la clave tal cual si ya empieza por «CRM», y si no, «CRM » delante. Lo da Certifex en GET /yo.
 */
function sufijoDeEsteCrm(yo) {
  const nombre = String(yo?.nombre ?? '').trim();
  if (!nombre) throw new AppError('Certifex no dijo el nombre de este CRM (GET /yo).', 502, 'CERTIFEX_ERROR');
  return ` (${/^crm\b/i.test(nombre) ? nombre : `CRM ${nombre}`})`;
}

/** El campus del diploma, en mayúsculas, o null si Certifex no lo dice (nunca «UNDEFINED»). */
const centroDe = (dip) => (dip?.centro ? String(dip.centro).trim().toUpperCase() || null : null);

/** El correo de «persona (CRM X)», como lo devuelve Certifex en la anulación. */
const correoDe = (por) => String(por ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim() || String(por ?? '');

/**
 * GET /diplomas/revertir — ¿se puede usar ya? `{ disponible, motivo }`. Si no se puede
 * saber (Certifex no contesta, la clave no vale…), no disponible, con ESE motivo. Lo mismo
 * si en la base del CRM falta la tabla (el código desplegado antes que la migración).
 */
export async function disponibilidad(req, res, next) {
  try {
    let tabla;
    try {
      tabla = await model.tablaReversionesExiste();
    } catch (e) {
      return res.json({ success: true, data: { disponible: false, motivo: `No se pudo comprobar la base del CRM: ${String(e.message || 'no contesta').replace(/\.\s*$/, '')}.` } });
    }
    if (!tabla) return res.json({ success: true, data: { disponible: false, motivo: SIN_TABLA } });
    let disponible = false;
    let motivo = null;
    try {
      disponible = await certifexPuede('revertir');
      if (!disponible) motivo = SIN_CERTIFEX;
    } catch (e) {
      motivo = `No se pudo comprobar si Certifex permite revertir: ${String(e.message || 'no contesta').replace(/\.\s*$/, '')}.`;
    }
    res.json({ success: true, data: { disponible, motivo } });
  } catch (err) { next(err); }
}

/** POST /diplomas/revertir `{ nexpediente, motivo }`. */
export async function revertir(req, res, next) {
  try {
    const d = parsear(revertirSchema, req.body);
    // Como lo guarda Certifex (espacios seguidos, uno), para que los dos registros digan lo mismo.
    const motivo = d.motivo.replace(/\s+/g, ' ').trim();
    if (!(await model.tablaReversionesExiste())) throw new AppError(`${SIN_TABLA} No se ha revertido nada.`, 503, 'CRM_SIN_MIGRACION');
    if (!(await certifexPuede('revertir'))) throw new AppError(`${SIN_CERTIFEX} No se ha revertido nada.`, 503, 'CERTIFEX_SIN_REVERTIR');

    // El alcance por campus, como revocar y corregir (Diego: «como hacen `revocar` y `corregir`
    // (`exigirExpedientes`)»): 404 si no existe o no es de sus campus. Devuelve el diploma que ha
    // consultado, y se usa ese: Certifex no se pregunta dos veces. Sin alcance que mirar (super
    // admin), se pide aquí. Un diploma sin campus (en Certifex no existe: `proyecto_id not null`) da
    // 404 a quien tiene alcance, y 502 al resto: no se puede saber de quién es ni apuntarlo.
    const consultados = await exigirExpedientes(await alcanceDe(req.user), [d.nexpediente]);
    const dip = consultados?.get(d.nexpediente) ?? await diplomaPorNumero(d.nexpediente);
    if (!dip) throw new AppError(NO_ENCONTRADO, 404, 'NOT_FOUND');
    if (!centroDe(dip)) throw new AppError('Certifex no dice de qué campus es ese diploma: no se ha revertido nada.', 502, 'CERTIFEX_ERROR');

    if (dip.anulada) {
      // Ya revertido. Si el CRM no lo tenía apuntado (se cortó justo después de que
      // Certifex lo hiciera), se apunta ahora con lo que dice Certifex, matrícula incluida.
      await apuntarDesdeCertifex(dip).catch((e) => logger.warn({ err: e.message, nexpediente: d.nexpediente }, 'Certifex: no se pudo apuntar una reversión ya hecha'));
      throw new AppError('Ya está revertido: ese número está anulado. Búscalo en «Aprobados sin diploma» para volver a emitirlo.', 409, 'YA_REVERTIDO');
    }
    if (dip.revocada) throw new AppError('Está revocado: no se revierte.', 409, 'REVOCADO');
    if (dip.aviso) {
      // Para Certifex, un aviso APROBADO ya es «entregado» (la misma regla que corregir el
      // programa, 0041), haya salido el correo o no. Se dice lo que pasó de verdad.
      const salio = dip.aviso.resultado === 'enviado';
      throw new AppError(salio
        ? 'Ya se ha enviado al alumno: no se revierte. Si está mal, hay que revocarlo.'
        : `Ya se aprobó el aviso al alumno (${ROTULO_AVISO[dip.aviso.resultado] ?? dip.aviso.resultado}) y eso ya cuenta como entregado: no se revierte. Si está mal, hay que revocarlo.`,
      409, 'YA_ENVIADO');
    }
    // Entregado sin aviso del CRM: el correo salió desde el panel de Certifex (lo dice Certifex
    // en `entregado`; un Certifex anterior no lo manda y entonces lo comprueba él).
    if (dip.entregado === true) throw new AppError('Ya se entregó al alumno desde el panel de Certifex: no se revierte. Si está mal, hay que revocarlo.', 409, 'YA_ENVIADO');
    if (!emitidoPorElCrm(dip)) throw new AppError('Este diploma no se emitió desde el CRM: no se revierte desde aquí.', 409, 'EMITIDO_FUERA');
    // Lo emitió OTRO CRM del mismo campus (Certifex lo dice en `deEsteCrm`): lo revierte ese.
    if (!revertiblePorEsteCrm(dip)) throw new AppError('Este diploma lo emitió otro CRM: lo revierte el que lo emitió.', 409, 'OTRO_CRM');

    // Certifex puede esperar hasta 30 s a que acabe un envío del aviso de ESTE diploma (su
    // cerrojo): el CRM espera más, para no decir «no responde» a algo que acaba haciéndose.
    let hecho;
    try {
      hecho = await certifex('POST', '/revertir', { nexpediente: d.nexpediente, motivo, revertidoPor: req.user.email }, { timeoutMs: 45_000 });
    } catch (e) {
      // Otro lo revirtió entre la comprobación de arriba y esta llamada: está hecho. Se apunta
      // lo que dice Certifex y se contesta como arriba, en vez de enseñar un error.
      if (e.certifexCode === 'anulada') {
        const ahora = await diplomaPorNumero(d.nexpediente).catch(() => null);
        if (ahora?.anulada) {
          await apuntarDesdeCertifex(ahora).catch((x) => logger.warn({ err: x.message, nexpediente: d.nexpediente }, 'Certifex: no se pudo apuntar una reversión ya hecha'));
        }
        throw new AppError('Ya está revertido: ese número está anulado. Búscalo en «Aprobados sin diploma» para volver a emitirlo.', 409, 'YA_REVERTIDO');
      }
      throw e;
    }
    // La matrícula que vuelve a «Aprobados sin diploma» la dice Certifex (la de esa persona y
    // ese curso), no el navegador.
    const matriculaId = Number.isSafeInteger(hecho?.matriculaId) ? hecho.matriculaId : null;
    logger.info({ userId: req.user.userId, nexpediente: d.nexpediente, matriculaId }, 'Certifex: diploma revertido');

    let registrado = false;
    let aviso;
    try {
      await model.apuntarReversion({
        nexpediente: d.nexpediente, matriculaId, centro: centroDe(dip), alumno: dip.alumno ?? null,
        titulacion: dip.titulacion ?? null, motivo, revertidoPor: req.user.userId ?? null, revertidoPorEmail: req.user.email,
        revertidoEn: hecho?.anulada?.en ?? null,
      });
      registrado = true;
    } catch (e) {
      logger.error({ err: e.message, nexpediente: d.nexpediente }, 'Certifex: revertido, pero el CRM no lo pudo apuntar');
      aviso = 'Revertido en Certifex (allí queda quién, cuándo y por qué), pero el CRM no lo pudo apuntar.';
    }
    res.json({ success: true, data: { ...hecho, matriculaId, registrado, ...(aviso ? { aviso } : {}) } });
  } catch (err) { next(err); }
}

/** Apunta en el CRM una reversión que Certifex ya tiene y el CRM no (lo que dice Certifex). */
async function apuntarDesdeCertifex(dip) {
  if (!centroDe(dip)) throw new AppError(`Certifex no dice de qué campus es ${dip?.nexpediente}: no se apunta.`, 502, 'CERTIFEX_ERROR');
  if (await model.reversionDe(dip.nexpediente)) return;
  const a = dip.anulacion ?? {};
  await model.apuntarReversion({
    nexpediente: dip.nexpediente, matriculaId: Number.isSafeInteger(a.matriculaId) ? a.matriculaId : null,
    centro: centroDe(dip), alumno: dip.alumno ?? null,
    titulacion: dip.titulacion ?? null, motivo: a.motivo || '(sin motivo en Certifex)', revertidoPor: null,
    revertidoPorEmail: correoDe(a.por) || '(desconocido)', revertidoEn: a.en ?? null,
  });
}

/**
 * Lo que Certifex tiene revertido y el CRM no tiene apuntado (Certifex lo hizo pero el apunte
 * del CRM falló, o se cortó la respuesta): se apunta ahora, con lo que dice Certifex (quién,
 * cuándo, por qué y la matrícula). Así el registro del CRM no pierde ninguna (#351: «queda en
 * el CRM y en Certifex quién, cuándo, por qué y qué número»).
 *
 * Lo hace una tarea programada (`jobs/certifexReversionesScheduler.js`), no la carga de una
 * pantalla: un GET no escribe (7.ª auditoría). Recorre los campus de la clave de este CRM, todas
 * las páginas (los anulados son pocos: se revierte a mano, uno a uno). Solo con un Certifex que
 * ya revierte y con la tabla del CRM puesta; si no, no hace nada. Devuelve cuántas apuntó.
 */
export async function completarReversiones() {
  if (!(await model.tablaReversionesExiste())) return { apuntadas: 0, motivo: 'sin la tabla del CRM' };
  if (!(await certifexPuede('revertir'))) return { apuntadas: 0, motivo: 'Certifex aún no revierte' };
  // Solo lo que revirtió ESTE CRM: si un campus estuviera conectado a dos, lo que revirtió el otro
  // es del otro (12.ª auditoría, punto 4). Lo dice Certifex en cada anulado (`porEsteCrm`, con su
  // regla); un Certifex anterior no lo manda, y entonces se mira la firma « (CRM X)».
  const sufijo = sufijoDeEsteCrm(await certifex('GET', '/yo'));
  const deEste = (f) => (typeof f.anulacion?.porEsteCrm === 'boolean'
    ? f.anulacion.porEsteCrm
    : String(f.anulacion?.por ?? '').trimEnd().endsWith(sufijo));
  const { filas } = await recorrer('/diplomas', { estado: 'anulados' }, {
    filtro: (f) => !!(f?.anulada && f.nexpediente) && deEste(f),
  });
  if (!filas.length) return { apuntadas: 0 };
  const ya = await model.reversionesApuntadas(filas.map((f) => f.nexpediente));
  let apuntadas = 0;
  for (const f of filas) {
    if (ya.has(f.nexpediente)) continue;
    // Sin campus no se puede apuntar (ni saber de quién es): se dice y se sigue con los demás.
    if (!centroDe(f)) { logger.warn({ nexpediente: f.nexpediente }, 'Certifex: reversión sin campus, no se apunta'); continue; }
    await apuntarDesdeCertifex(f);
    apuntadas += 1;
    logger.warn({ nexpediente: f.nexpediente }, 'Certifex: reversión que faltaba en el CRM, apuntada ahora');
  }
  return { apuntadas };
}

/**
 * Para «Aprobados sin diploma»: la última reversión de cada matrícula (`revertido`), o
 * null. Si la base no contesta, el listado sale igual, sin el dato.
 */
export async function conReversiones(filas) {
  for (const c of filas) c.revertido = null;
  if (!filas.length) return;
  try {
    const m = await model.ultimasReversionesDe(filas.map((c) => c.matriculaId));
    for (const c of filas) {
      const r = m.get(Number(c.matriculaId));
      if (r) c.revertido = { nexpediente: r.nexpediente, motivo: r.motivo, por: r.por, en: r.en };
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudieron leer las reversiones');
  }
}
