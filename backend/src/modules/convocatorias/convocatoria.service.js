import * as Conv from './convocatoria.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { createReminder } from '../leads/lead.model.js';
import { logger } from '../../shared/utils/logger.js';

export function listar(projectId, opciones) {
  return Conv.listar(projectId, opciones);
}

export async function crear(projectId, datos) {
  return Conv.crear(projectId, datos);
}

export async function editar(id, projectId, datos) {
  const c = await Conv.editar(id, projectId, datos);
  if (!c) throw new AppError('Esa convocatoria no existe en este proyecto', 404);
  return c;
}

/**
 * Ofrecer la convocatoria a alguien.
 *
 * Y dejar puesto el aviso de «¿llenó la solicitud?» para el día siguiente, que
 * es literalmente lo que pidió Diego: sin él, se ofrece la beca y nadie vuelve
 * a mirar si la pidió.
 */
export async function ofrecer(convocatoriaId, datos) {
  const conv = await Conv.porId(convocatoriaId);
  if (!conv) throw new AppError('Esa convocatoria no existe', 404);
  if (!conv.activa) throw new AppError(`«${conv.nombre}» está cerrada`, 409);

  const ofr = await Conv.ofrecer(convocatoriaId, datos);
  // `null` significa que ya se le había ofrecido: no es un error, es que no hay
  // nada que hacer. Se devuelve lo que ya había para que la pantalla lo enseñe.
  if (!ofr) {
    const previos = await Conv.ofrecimientosDeLead(datos.leadId);
    return previos.find((x) => Number(x.convocatoria_id) === Number(convocatoriaId)) || null;
  }

  const manana = new Date();
  manana.setDate(manana.getDate() + 1);
  createReminder(
    datos.leadId,
    manana.toISOString().slice(0, 10),
    `¿Llenó la solicitud de «${conv.nombre}»?`,
    datos.ofrecidaPor || null
  ).catch((err) => logger.warn(
    { err: err.message, leadId: datos.leadId },
    'No se pudo poner el aviso de la solicitud'
  ));

  return ofr;
}

/**
 * Cambiar lo que se sabe de un ofrecimiento.
 *
 * Aquí es donde vive la regla del #91. NO se bloquea: el CRM avisa y la persona
 * decide. Bloquear un descuento que el jefe ha autorizado a mano convierte la
 * regla en un estorbo, y lo que se acaba haciendo es no registrarlo — que es
 * justo perder el dato.
 *
 * Y no se puede decidir sola cuál de los dos topes aplica: el CRM no sabe si
 * una formación está «ya habilitada». Así que se avisa contra el más bajo y se
 * dicen los dos, que es lo honesto.
 */
export async function actualizarOfrecimiento(id, datos) {
  const ofr = await Conv.actualizarOfrecimiento(id, datos);
  if (!ofr) throw new AppError('Ese ofrecimiento no existe', 404);

  const conv = await Conv.porId(ofr.convocatoria_id);
  let aviso = null;
  if (ofr.descuento != null && conv) {
    const d = Number(ofr.descuento);
    if (d > Number(conv.tope_habilitada)) {
      aviso = `${d} % pasa del tope máximo de «${conv.nombre}» (${conv.tope_habilitada} %, `
        + 'y ese solo para formación ya habilitada).';
    } else if (d > Number(conv.tope_nueva)) {
      aviso = `${d} % pasa del tope de formación nueva (${conv.tope_nueva} %). `
        + `Solo llega hasta ${conv.tope_habilitada} % si la formación ya está habilitada.`;
    }
  }
  return { ...ofr, aviso };
}

export function ofrecimientosDeLead(leadId) {
  return Conv.ofrecimientosDeLead(leadId);
}

export function pendientesDeRespuesta(opciones) {
  return Conv.pendientesDeRespuesta(opciones);
}

export function embudo(opciones) {
  return Conv.embudo(opciones);
}
