import { logger } from '../../shared/utils/logger.js';
import * as cfg from './diploma-confirmacion.config.js';
import * as model from './diploma-confirmacion.model.js';

/*
  Confirmación de datos del diploma (#768) · la puerta de la emisión.

  Lo usa `prepararEmision` (certifex.emision.js), por donde pasan TODAS las
  emisiones del CRM: «Aprobar y emitir», «Emitir» y la pestaña Emisiones. Va en
  un fichero aparte para que Certifex no cargue el resto del módulo (correo,
  enlaces) y no haya imports en círculo.

  Con el interruptor apagado no mira nada: ni una consulta más.
*/

export const DATOS_SIN_PEDIR = 'DATOS_SIN_PEDIR';
export const DATOS_SIN_CONFIRMAR = 'DATOS_SIN_CONFIRMAR';
export const DATOS_SIN_APLICAR = 'DATOS_SIN_APLICAR';

const fmtFecha = (d) => new Date(d).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'long', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
});

/** Estados con los que el diploma ya puede salir. */
export const LISTOS = new Set(['confirmado', 'corregido', 'vencido']);

/**
 * Por qué no se puede emitir cada matrícula por la confirmación de datos.
 * `centroDe(id)` da su campus. Devuelve Map id → { codigo, motivo }; las que
 * pueden salir no aparecen. Lanza si la base no contesta (quien llama decide).
 *
 *  · sin confirmación pedida  → DATOS_SIN_PEDIR
 *  · pendiente                → DATOS_SIN_CONFIRMAR (el plazo sigue corriendo)
 *  · corregida y sin pasar a Certifex → DATOS_SIN_APLICAR (saldría lo de antes)
 *  · confirmada, corregida y aplicada, o vencida (7 días) → puede salir
 */
export async function bloqueosDeConfirmacion(ids, centroDe) {
  const out = new Map();
  if (!cfg.activa()) return out;
  const afectadas = ids.filter((id) => cfg.activaEn(centroDe(id)));
  if (!afectadas.length) return out;
  const filas = await model.deLasMatriculas(afectadas);
  for (const id of afectadas) {
    const f = filas.get(Number(id));
    if (!f) {
      out.set(id, {
        codigo: DATOS_SIN_PEDIR,
        motivo: 'No se ha emitido: falta que el alumno confirme los datos de su diploma. Pídele la confirmación y se podrá emitir cuando conteste (o a los 7 días).',
      });
    } else if (f.estado === 'pendiente') {
      out.set(id, {
        codigo: DATOS_SIN_CONFIRMAR,
        motivo: `No se ha emitido: el alumno aún no ha confirmado sus datos. Tiene hasta el ${fmtFecha(f.caduca_at)}; si no contesta, se podrá emitir con los datos actuales.`,
      });
    } else if (f.estado === 'corregido' && !f.aplicado_at) {
      out.set(id, {
        codigo: DATOS_SIN_APLICAR,
        motivo: `No se ha emitido: el alumno corrigió sus datos y aún no se han pasado a Certifex${f.aplicar_error ? ` (${f.aplicar_error})` : ''}. Vuelve a pasarlos o revísalos con «Editar».`,
      });
    }
  }
  return out;
}

/**
 * Apunta con qué datos salió cada diploma (solo en matrículas con confirmación).
 * No para nada: el diploma ya está emitido, y no saber apuntarlo no lo deshace.
 */
export async function anotarEmisiones(emitidas) {
  if (!cfg.activa() || !emitidas.length) return;
  for (const { matriculaId, nexpediente, datos } of emitidas) {
    try {
      await model.registrarEmision(matriculaId, { nexpediente, datos });
    } catch (err) {
      logger.warn({ err: err.message, matriculaId }, 'Confirmación de diploma: no se pudo apuntar la emisión');
    }
  }
}

/**
 * Un diploma revertido (#351, gemela de CRM#624): suelta su número anulado, para que la nueva
 * emisión se apunte. No mira el interruptor: si estuvo encendido, puede haber filas con ese
 * número aunque hoy esté apagado. Tampoco para nada: la reversión ya está hecha en Certifex.
 */
export async function soltarEmisionRevertida(nexpediente) {
  if (!nexpediente) return;
  try {
    await model.soltarEmision(nexpediente);
  } catch (err) {
    logger.warn({ err: err.message, nexpediente }, 'Confirmación de diploma: no se pudo soltar el número revertido');
  }
}

/** Apunta cuándo se le mandó el diploma al alumno. Tampoco para nada. */
export async function anotarEnvios(nexpedientes) {
  if (!cfg.activa() || !nexpedientes.length) return;
  try {
    await model.registrarEnvioDiploma(nexpedientes);
  } catch (err) {
    logger.warn({ err: err.message }, 'Confirmación de diploma: no se pudo apuntar el envío');
  }
}

/**
 * En qué está la confirmación de cada fila de Diplomas › Pendientes (#791): `confirmacion`,
 * o null si no se ha pedido (o el interruptor está apagado). Así el panel enseña «datos
 * pedidos, esperando al alumno» en vez del «Aprobar y emitir» de las demás. Sin el enlace,
 * la IP ni el documento. Si la base no contesta, el listado sale igual, sin el dato.
 */
export async function conConfirmacion(filas) {
  for (const c of filas) c.confirmacion = null;
  if (!cfg.activa() || !filas.length) return;
  try {
    const m = await model.deLasMatriculas(filas.map((c) => Number(c.matriculaId)));
    for (const c of filas) {
      const f = m.get(Number(c.matriculaId));
      if (!f) continue;
      c.confirmacion = {
        estado: f.estado,
        pedidaEn: f.created_at,
        caducaEn: f.caduca_at,
        enviadaEn: f.enviado_at,
        simulado: !!f.envio_simulado,
        envioError: f.envio_error,
        respondidaEn: f.respondido_at,
        // Corregida y sin pasar a Certifex: aún no se puede emitir (DATOS_SIN_APLICAR).
        sinAplicar: f.estado === 'corregido' && !f.aplicado_at,
        aplicarError: f.aplicar_error,
      };
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Confirmación de diploma: no se pudo leer para el listado');
  }
}
