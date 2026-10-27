/**
 * Las cinco casillas de antes, como excepciones del catálogo (#423, fase 5).
 *
 * Es la regla de la migración 239, escrita una vez en JS para poder probarla:
 * la prueba `casillasMigracion423.test.js` pasa la migración sobre personas de
 * prueba y exige que deje EXACTAMENTE estas excepciones. Cada línea copia la
 * comprobación de antes (inventario/legado.js · manual): se da la excepción
 * solo a quien la casilla le abría algo que su rol no le daba ya.
 *
 *   factura_manager        → facturas.emitir   (no admin ni superadmin: ya lo tienen)
 *                            facturas.cola      (no superadmin: el admin NO la tenía)
 *                            facturas.gestionar (solo gestoras: antes no valía con otro rol)
 *   editar_fechas_factura  → facturas.editar_fechas (no admin ni superadmin)
 *   gestor_colaboraciones  → tutores.gestionar  (no admin ni superadmin)
 *                            La columna se queda: decide además el reparto,
 *                            las listas y WhatsApp (comportamiento).
 *   usa_mcp                → mcp.usar          (no admin, superadmin ni tutor)
 *   usa_whatsapp = false   → whatsapp.usar NO  (a quien su rol se lo daba, también al superadmin)
 *
 * Solo el rol PRINCIPAL, como miraban las comprobaciones de antes.
 */
const ADMIN = ['admin', 'superadmin'];

/** `{ clave: bool }` que la migración le pone a esta persona. */
export function excepcionesDeCasillas(u) {
  const out = {};
  const rol = u.role;
  if (u.factura_manager === true) {
    if (!ADMIN.includes(rol)) out['facturas.emitir'] = true;
    if (rol !== 'superadmin') out['facturas.cola'] = true;
    if (rol === 'gestor') out['facturas.gestionar'] = true;
  }
  if (u.editar_fechas_factura === true && !ADMIN.includes(rol)) out['facturas.editar_fechas'] = true;
  if (u.gestor_colaboraciones === true && !ADMIN.includes(rol)) out['tutores.gestionar'] = true;
  if (u.usa_mcp === true && ![...ADMIN, 'tutor'].includes(rol)) out['mcp.usar'] = true;
  // También al superadmin (Diego, 26/10/2026: «Carlos y Vladys siguen sin WhatsApp»): su
  // «no» por persona gana en WhatsApp (resolver.js).
  if (u.usa_whatsapp === false && ['admin', 'gestor', 'soporte', 'superadmin'].includes(rol)) out['whatsapp.usar'] = false;
  return out;
}
