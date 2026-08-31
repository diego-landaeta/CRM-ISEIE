/**
 * Quien puede tener WhatsApp, en UN sitio.
 *
 * Antes esto vivia dentro de una consulta SQL —dos veces, una por cada rama del
 * selector— escrito como `role IN ('superadmin','admin','gestor','soporte')`.
 * Tenia dos problemas:
 *
 *   · Para que un rol nuevo pudiera tener WhatsApp habia que editar SQL, y en
 *     dos sitios. El que se olvidara uno daba comportamientos distintos segun
 *     quien mirara.
 *   · Los que no estaban en la lista **no aparecian**, sin decir por que. Hoy
 *     eso deja fuera a los tutores. No es que no puedan enlazar: es que no
 *     salen, que es la peor forma de negar algo — parece un fallo.
 *
 * Es la tarea #68.
 */

/**
 * Los roles que llevan WhatsApp.
 *
 * TUTOR NO ESTA, y es a proposito: un tutor da clase, no atiende prospectos, y
 * enlazar su numero personal a un CRM no le aporta nada. Pero esto es una
 * decision de negocio y no tecnica — si manana se decide lo contrario, se
 * cambia AQUI y funciona en todas partes.
 */
export const ROLES_CON_WHATSAPP = ['superadmin', 'admin', 'gestor', 'soporte'];

/** Por que NO puede tener WhatsApp. null si si puede. */
export function porQueNoPuede(usuario) {
  if (!usuario) return 'No se encontro a esta persona.';
  if (!usuario.active) return 'Esta persona esta dada de baja.';
  // Quien lleva colaboraciones no es una gestora de prospectos aunque tenga ese
  // rol: no se le reparte trabajo y tampoco le corresponde una sesion.
  if (usuario.gestor_colaboraciones) return 'Lleva colaboraciones, no prospectos.';
  if (!ROLES_CON_WHATSAPP.includes(usuario.role)) {
    return usuario.role === 'tutor'
      ? 'Los tutores no usan WhatsApp del CRM: dan clase, no atienden prospectos.'
      : `El rol «${usuario.role}» no tiene WhatsApp.`;
  }
  return null;
}

/** Lo contrario, para leerlo mejor donde toca. */
export const puedeTenerWhatsapp = (usuario) => porQueNoPuede(usuario) === null;

/**
 * Alguien deja de poder tener WhatsApp: se le desvincula el numero, pero sus
 * conversaciones se quedan.
 *
 * Es el punto 3 de la tarea #68, y era el que faltaba por decidir. De las tres
 * salidas posibles se elige la de en medio:
 *
 *   · No tocar nada dejaria su numero personal enlazado a un CRM que ya no usa,
 *     posiblemente durante meses y sin que nadie se acuerde.
 *   · Borrarlo todo se lleva por delante el historial de conversaciones con
 *     prospectos que siguen siendo de la empresa.
 *
 * El numero es suyo; las conversaciones con clientes son de la empresa. Asi que
 * se suelta lo suyo y se guarda lo de la empresa.
 *
 * No lanza nunca: esto se llama desde el cambio de rol, y que WhatsApp no
 * responda no puede impedir que a alguien se le cambie el rol o se le de de baja.
 * Devuelve que se hizo, para poder decirlo.
 */
export async function alPerderAcceso(usuarioId, motivo) {
  const salida = { desvinculada: false, motivo, error: null };
  try {
    const evolution = await import('./evolution.client.js');
    if (!evolution.configurado()) return salida;

    const instancia = evolution.instanciaDe(usuarioId);
    // `estado` devuelve la respuesta cruda de Evolution, no un booleano.
    const est = await evolution.estado(instancia).catch(() => null);
    const abierta = est?.datos?.instance?.state === 'open'
      || est?.datos?.state === 'open';
    // Si no habia sesion enlazada no hay nada que soltar, y no es un fallo.
    if (!abierta) return salida;

    const r = await evolution.cerrarSesion(instancia);
    salida.desvinculada = Boolean(r?.ok);

    const { logger } = await import('../../shared/utils/logger.js');
    logger.warn(
      { usuarioId, motivo, desvinculada: salida.desvinculada },
      'WhatsApp: se desvincula el numero porque esta persona ya no puede tenerlo'
    );
  } catch (err) {
    salida.error = err?.message || String(err);
    try {
      const { logger } = await import('../../shared/utils/logger.js');
      logger.error({ usuarioId, motivo, err: salida.error },
        'WhatsApp: no se pudo desvincular al perder el acceso — revisar a mano');
    } catch { /* ni el registro puede tumbar esto */ }
  }
  return salida;
}
