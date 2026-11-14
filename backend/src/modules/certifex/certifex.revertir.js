import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './certifex.model.js';
import { certifex, certifexTieneRuta } from './certifex.cliente.js';
import { alcanceDe, exigirExpedientes } from './certifex.alcance.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { emitidoPorElCrm } from './certifex.marcas.js';
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
 *  · queda en el CRM (`certifex_reversiones`, migración 280) DESPUÉS de que Certifex lo
 *    haga, con la matrícula que dice Certifex (no la que diga el navegador);
 *  · mientras el Certifex conectado no tenga la ruta, no se usa: 503 sin tocar nada, y
 *    `disponibilidad` se lo dice a la pantalla para que el botón no se ofrezca.
 */

const SIN_TABLA = 'Falta aplicar en la base del CRM la migración 280 (certifex_reversiones).';
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
      disponible = await certifexTieneRuta('/revertir');
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
    if (!(await certifexTieneRuta('/revertir'))) throw new AppError(`${SIN_CERTIFEX} No se ha revertido nada.`, 503, 'CERTIFEX_SIN_REVERTIR');

    // El alcance por campus, como revocar y corregir: 404 si el número no es de sus campus.
    await exigirExpedientes(await alcanceDe(req.user), [d.nexpediente]);
    const dip = await diplomaPorNumero(d.nexpediente);
    if (!dip) throw new AppError(NO_ENCONTRADO, 404, 'NOT_FOUND');

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

    // Certifex puede esperar hasta 30 s a que acabe un envío del aviso de ESTE diploma (su
    // cerrojo): el CRM espera más, para no decir «no responde» a algo que acaba haciéndose.
    const hecho = await certifex('POST', '/revertir', { nexpediente: d.nexpediente, motivo, revertidoPor: req.user.email }, { timeoutMs: 45_000 });
    // La matrícula que vuelve a «Aprobados sin diploma» la dice Certifex (la de esa persona y
    // ese curso), no el navegador.
    const matriculaId = Number.isSafeInteger(hecho?.matriculaId) ? hecho.matriculaId : null;
    logger.info({ userId: req.user.userId, nexpediente: d.nexpediente, matriculaId }, 'Certifex: diploma revertido');

    let registrado = false;
    let aviso;
    try {
      await model.apuntarReversion({
        nexpediente: d.nexpediente, matriculaId, centro: String(dip.centro).toUpperCase(), alumno: dip.alumno ?? null,
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
  if (await model.reversionDe(dip.nexpediente)) return;
  const a = dip.anulacion ?? {};
  await model.apuntarReversion({
    nexpediente: dip.nexpediente, matriculaId: Number.isSafeInteger(a.matriculaId) ? a.matriculaId : null,
    centro: String(dip.centro).toUpperCase(), alumno: dip.alumno ?? null,
    titulacion: dip.titulacion ?? null, motivo: a.motivo || '(sin motivo en Certifex)', revertidoPor: null,
    revertidoPorEmail: correoDe(a.por) || '(desconocido)', revertidoEn: a.en ?? null,
  });
}

const COMPLETAR_CADA_MS = 60_000;
const completadas = new Map();

/**
 * Lo que Certifex tiene revertido en estos campus y el CRM no tiene apuntado (Certifex lo
 * hizo pero el apunte del CRM falló, o se cortó la respuesta): se apunta ahora, con lo que
 * dice Certifex (quién, cuándo, por qué y la matrícula). Así el registro del CRM no pierde
 * ninguna (#351: «queda en el CRM y en Certifex quién, cuándo, por qué y qué número»).
 *
 * Solo con un Certifex que ya revierte y con la tabla del CRM puesta; lo más reciente (una
 * página de 200). Nada de esto impide ver el listado: si falla, queda en el log.
 */
export async function completarReversiones(ambito, req) {
  // Escribe en el registro: solo con el permiso de revertir, y como mucho una vez por minuto
  // y por ámbito (es un repaso, no hace falta en cada carga de la pantalla). La hora se
  // apunta solo si el repaso sale bien: si Certifex falla, se reintenta en la siguiente carga.
  const clave = ambito?.centro ?? [...(ambito?.centros ?? [])].sort().join(',');
  try {
    if (ambito?.vacio) return;
    if (req && !(await tienePermiso(req, 'diplomas.revertir'))) return;
    if (Date.now() - (completadas.get(clave) ?? 0) < COMPLETAR_CADA_MS) return;
    if (!(await model.tablaReversionesExiste())) return;
    if (!(await certifexTieneRuta('/revertir'))) return;
    const params = { estado: 'anulados', pagina: '1', tam: '200' };
    if (ambito?.centro) params.centro = ambito.centro;
    const d = await certifex('GET', `/diplomas?${new URLSearchParams(params)}`);
    const filas = (Array.isArray(d?.filas) ? d.filas : [])
      .filter((f) => f?.anulada && f.nexpediente && (!ambito?.centros || ambito.centros.has(String(f.centro).toUpperCase())));
    if (!filas.length) { completadas.set(clave, Date.now()); return; }
    const ya = await model.reversionesApuntadas(filas.map((f) => f.nexpediente));
    for (const f of filas) {
      if (ya.has(f.nexpediente)) continue;
      await apuntarDesdeCertifex(f);
      logger.warn({ nexpediente: f.nexpediente }, 'Certifex: reversión que faltaba en el CRM, apuntada ahora');
    }
    completadas.set(clave, Date.now());
  } catch (e) {
    logger.warn({ err: e.message }, 'Certifex: no se pudieron completar las reversiones');
  }
}

/** Para las pruebas: olvida cuándo se repasó cada ámbito. */
export function olvidarRepasos() {
  completadas.clear();
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
