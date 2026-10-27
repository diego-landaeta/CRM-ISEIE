/**
 * Las claves que ANTES de #423 ya hacían algo (QA de Diego, 22/10, punto 5:
 * «no se archiva ninguna clave en uso»). Sacadas del código de `staging` del
 * 22/10:
 *
 *   EN_EL_SERVIDOR  las miraba una ruta (checkPermission, rolOPermiso,
 *                   resolvePermission) o un servicio (Tareas).
 *   EN_LA_PANTALLA  las miraba el frontal con `can()`: enseñaban o escondían
 *                   un botón. Lo guardado sobre ellas en una excepción o en un
 *                   rol a medida YA tenía efecto, aunque fuera solo en pantalla.
 *
 * La migración 239 no archiva nada de esto (lo comprueba
 * `clavesEnUso423.test.js`, que además exige que esté en el catálogo). Lo que
 * no está aquí no lo miraba nadie: guardado o no, no cambiaba nada.
 */
export const EN_EL_SERVIDOR = [
  'leads.delete', 'facturas_colaborador.%', 'diplomas.view', 'diplomas.emit', 'tasks.%', 'conversions.sin_gestora',
];

export const EN_LA_PANTALLA = [
  'clients.create', 'clients.delete', 'clients.export',
  'conversions.edit',
  'leads.assign', 'leads.create', 'leads.edit', 'leads.export',
  'products.create', 'products.delete', 'products.edit',
  'woocommerce.sync',
];

/** Los patrones de la 239 (`LIKE`), los dos juntos. */
export const EN_USO_ANTES = [...EN_EL_SERVIDOR, ...EN_LA_PANTALLA];

const casa = (patron, clave) => (patron.endsWith('.%') ? clave.startsWith(patron.slice(0, -1)) : clave === patron);

/** ¿Se miraba esta clave antes de #423? */
export function enUsoAntes(clave) {
  return EN_USO_ANTES.some((p) => casa(p, clave));
}

/** ¿Solo la miraba la pantalla (y ninguna ruta)? */
export function soloEnLaPantallaAntes(clave) {
  return EN_LA_PANTALLA.includes(clave);
}

/**
 * Tareas (QA de Diego, punto 6): `tasks.*` solo surtía efecto a quien pasaba la
 * puerta de las rutas, superadmin, admin o colaborador (roles de más
 * incluidos). Lo guardado a cualquier otro no hacía nada, y la 239 lo archiva.
 * Es la misma regla que la migración; `tareasMigracion423.test.js` lo comprueba.
 */
export const ROLES_DEL_TABLERO = ['superadmin', 'admin', 'colaborador'];

/** ¿La 239 archiva esta excepción de tareas? `roles`: su rol y sus roles de más. */
export function tareasSinEfectoAntes(clave, roles) {
  return clave.startsWith('tasks.') && !roles.some((r) => ROLES_DEL_TABLERO.includes(r));
}
