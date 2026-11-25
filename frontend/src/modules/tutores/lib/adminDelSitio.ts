/*
  La cuenta de administración del sitio de un campus, enlazada a una tutora como EXCEPCIÓN
  (Diego, 24/11/2026): la confirma en su ficha quien gestiona tutores, y en ese campus la
  tutora ve todo desde el CRM pero responde y corrige en Moodle, porque el plugin del CRM
  no envía ni califica como el administrador del sitio. Los textos, iguales que en el
  servidor (`tutor.campus.js`). Aparte de las llamadas a la API para que una prueba que
  las sustituye no se quede sin ellos.
*/
export const AVISO_EXCEPCION_ADMIN = 'Es la cuenta de administración del sitio; se enlaza igual porque ella da clase con ella.';
export const SOLO_DESDE_MOODLE = 'Es la cuenta de administración del sitio: responde y corrige desde Moodle.';
/**
 * Con el plugin 1.11.7 (CRM#1118) el campus puede tenerla en «Administradoras que dan clase»:
 * entonces responde y corrige desde el CRM, en los cursos donde da clase.
 */
export const ADMIN_PERMITIDA = 'Es la cuenta de administración del sitio; el campus la deja responder y corregir desde el CRM en los cursos donde da clase.';
