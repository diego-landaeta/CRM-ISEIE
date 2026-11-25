/**
 * Espejo en el servidor de `SOLO_EN_PRUEBAS` (frontend/src/shared/lib/enPruebas.js).
 *
 * Lo que aún no está aprobado para producción tampoco se monta en el servidor
 * de producción (ni sus trabajos programados): el tablero de tareas (#210) y
 * las facturas de colaboradores (#202) van así en MultiCRM («esto de tareas no
 * va», Diego 07/10; revisión de la PR #293, 10/10), y aquí igual (paridad, 15/10).
 *
 * Está encendido:
 *   · fuera de producción (local, tests): NODE_ENV distinto de 'production';
 *   · en /staging: CRM_BASE_URL apunta a /staging (el servidor de pruebas de
 *     ISEIE DEBE tenerla así, o lo que se prueba en /staging dejaría de
 *     responder); también /testeo, que es como se llama en MultiCRM;
 *   · o si se aprueba con su interruptor: TAREAS_EN_PRODUCCION=1 o
 *     FACTURAS_COLABORADOR_EN_PRODUCCION=1. El de uno no enciende el otro.
 *
 * Es una función y no una constante para que las pruebas puedan pasarle el
 * entorno que quieran.
 */
export function enPruebasOAprobado(interruptor, env = process.env) {
  if (env[interruptor] === '1') return true;
  if (env.NODE_ENV !== 'production') return true;
  return /\/(staging|testeo)(\/|$)/.test(env.CRM_BASE_URL || '');
}

/** El tablero de tareas (#210). Se aprueba con TAREAS_EN_PRODUCCION=1. */
export function tareasActivas(env = process.env) {
  return enPruebasOAprobado('TAREAS_EN_PRODUCCION', env);
}

/**
 * Facturas de colaboradores (#202, Diana): tampoco en el servidor de producción
 * mientras Diego no lo apruebe — ni la API (también la del enlace público) ni la
 * tarea del mes. Revisión de la PR #293 de MultiCRM, 10/10. Se aprueba con
 * FACTURAS_COLABORADOR_EN_PRODUCCION=1.
 */
export function facturasColaboradorActivas(env = process.env) {
  return enPruebasOAprobado('FACTURAS_COLABORADOR_EN_PRODUCCION', env);
}

/**
 * Links de pago (#407, gemela de CRM#680): ni `/api/links-pago` ni el hueco `stripe_links` de
 * Integraciones en el servidor de producción mientras Diego no lo apruebe (revisión
 * de la fase 1). Se aprueba con LINKS_PAGO_EN_PRODUCCION=1.
 */
export function linksPagoActivos(env = process.env) {
  return enPruebasOAprobado('LINKS_PAGO_EN_PRODUCCION', env);
}

/**
 * Lo del Moodle que aún no está aprobado para producción, con el mismo nombre e
 * interruptor que en MultiCRM (PLUGIN_MOODLE_EN_PRODUCCION=1):
 *
 *   · el plugin del CRM en cada Moodle (#406, gemela de MultiCRM #679 / PR #689): todo
 *     lo que ESCRIBE en un campus o lo cambia — la respuesta de la tutora por el
 *     plugin, el aviso de disponibilidad, el código de conexión, el repaso de los
 *     campus conectados y el aviso que el plugin manda al CRM (`/api/moodle-avisos`).
 *     Diego, revisión de la #689: «que no salga a producción sin verlo»;
 *   · el aviso de entregas sin corregir (#457: a la tutora a las 48 h y después a
 *     administración), que lee Moodle con el token del campus y escribe a tutoras y admins.
 *
 * Apagado, la respuesta de la tutora sale como hasta ahora (con su token del campus)
 * y el CRM no acepta avisos del plugin. El plugin también viene apagado de serie en el
 * propio Moodle (ajustes del plugin).
 */
export function pluginMoodleActivo(env = process.env) {
  return enPruebasOAprobado('PLUGIN_MOODLE_EN_PRODUCCION', env);
}

/**
 * Formaciones desde el CRM, fase 2 (CRM#1113): crear o actualizar el curso de Moodle de
 * una formación, con una sección por módulo. ESCRIBE en el Moodle del campus, así que en
 * producción va apagado hasta que se apruebe con FORMACIONES_MOODLE_EN_PRODUCCION=1 (y
 * necesita además el plugin, PLUGIN_MOODLE_EN_PRODUCCION, y la 1.12.0 en el campus).
 */
export function formacionesMoodleActivas(env = process.env) {
  return enPruebasOAprobado('FORMACIONES_MOODLE_EN_PRODUCCION', env);
}

/**
 * Cobro automático de las cuotas (#680; Diego, 19/11/2026): el CRM cobra solo cada
 * cuota en su fecha con la tarjeta que el alumno guardó al pagar su link. Mueve
 * dinero sin que nadie pulse nada, así que en producción va APAGADO hasta que
 * Diego lo apruebe con COBRO_AUTOMATICO_EN_PRODUCCION=1. Fuera de producción (y en
 * /testeo), encendido. Necesita además los links de pago: sin ellos no hay ni
 * link con el que guardar la tarjeta ni link de respaldo si el cobro falla.
 *
 * Encendido aquí no basta: cada campus lo permite o no (Integraciones › Links de
 * pago, apagado de serie) y cada venta lo activa la gestora.
 */
export function cobroAutomaticoActivo(env = process.env) {
  return linksPagoActivos(env) && enPruebasOAprobado('COBRO_AUTOMATICO_EN_PRODUCCION', env);
}

/**
 * Seguimiento de los links que no se pagan (gemela de CRM#984, #659): cada 15
 * minutos mira en Stripe qué links ha abierto el alumno, avisa a la gestora si lo
 * abrió y no pagó, y le manda al alumno el recordatorio de las 24 h y de las 72 h.
 * Escribe a alumnos sin que nadie pulse nada, así que en producción va APAGADO
 * hasta que Diego lo apruebe con LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION=1. Fuera de
 * producción (y en /staging), encendido; los correos pasan igual por el freno de
 * pruebas de `sendEmail`. Necesita los links de pago encendidos.
 *
 * Renovar un caducado y ver el estado en la lista NO dependen de esto.
 */
export function seguimientoLinksActivo(env = process.env) {
  return linksPagoActivos(env) && enPruebasOAprobado('LINKS_PAGO_SEGUIMIENTO_EN_PRODUCCION', env);
}

/**
 * El recordatorio por WhatsApp (CRM#984), aparte y APAGADO en todos los entornos
 * salvo LINKS_PAGO_RECORDATORIO_WHATSAPP=1: WhatsApp no tiene freno de pruebas como
 * el correo, y un mensaje automático desde el número de una gestora es lo que hace
 * que reporten la línea. Sale por la conversación que esa gestora ya tenga con el
 * prospecto, con los topes de ritmo de siempre; si no hay conversación, no sale.
 */
export function recordatorioWhatsappActivo(env = process.env) {
  return seguimientoLinksActivo(env) && env.LINKS_PAGO_RECORDATORIO_WHATSAPP === '1';
}

/**
 * Las tutoras redactoras en Moodle (CRM#1026 del 360, línea de #687): en su ficha de
 * Tutores y en el «Mi campus» de la propia redactora, si su cuenta de cada campus está
 * lista y si es «Profesor» (`editingteacher`, como las tutoras de hoy) de los cursos
 * que redacta (sus productos, con su curso de Moodle unido). Solo LEE del Moodle (las
 * mismas funciones que «Mi campus»); no matricula ni cambia roles.
 * Aún sin aprobar: en producción no se montan las rutas salvo con
 * REDACTORAS_MOODLE_EN_PRODUCCION=1.
 */
export function redactorasMoodleActivo(env = process.env) {
  return enPruebasOAprobado('REDACTORAS_MOODLE_EN_PRODUCCION', env);
}

/**
 * Suspensiones y reactivaciones de Moodle en la ficha del alumno (CRM#531): recibir el
 * aviso `estado_alumno` del plugin 1.13.0, apuntarlo, el estado y el historial en la
 * ficha, el filtro «Suspendidos» de Clientes y la campana a la gestora.
 *
 * Va con su propio interruptor, ADEMÁS del del plugin: el plugin puede aprobarse para los
 * mensajes antes que esto, y esto necesita la migración 333. Apagado, el CRM contesta al aviso como uno que aún no lo
 * conoce (400): el plugin lo da por perdido sin reintentar, así que no se atasca nada.
 * Se aprueba con SUSPENSIONES_MOODLE_EN_PRODUCCION=1 (y PLUGIN_MOODLE_EN_PRODUCCION=1).
 */
export function suspensionesMoodleActivas(env = process.env) {
  return pluginMoodleActivo(env) && enPruebasOAprobado('SUSPENSIONES_MOODLE_EN_PRODUCCION', env);
}
