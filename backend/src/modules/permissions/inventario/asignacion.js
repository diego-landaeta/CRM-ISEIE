/**
 * Lo que el inventario no puede leer de un guardia (#423).
 *
 * Desde la fase 4 cada ruta lleva su `puede('clave')` en su propio fichero, y
 * el inventario lo lee de ahí (`regla` del guardia). Aquí queda solo lo demás:
 *
 *   PROPIAS       rutas sin permiso a propósito: lo de cada uno (su sesión, sus
 *                 avisos, su foto, su ficha). Toda persona con sesión.
 *   PUBLICAS_CON_CLAVE
 *                 rutas sin sesión del CRM que miran dentro a quién pertenece
 *                 la llave (el MCP, con la URL o el token personal).
 *   CONDICIONES   la clave de cada acción con condición (`manuales.js`), que se
 *                 pide además de la de su ruta.
 *
 * Una ruta con sesión que no tenga `puede` ni esté en PROPIAS hace fallar
 * `catalogoPermisos.test.js`: o lleva su permiso o se declara aquí.
 */
export const PROPIA = 'propia';

export const PROPIAS = {
  auth: ['POST /logout', 'GET /me', 'POST /change-password', 'PATCH /me'],
  commissions: ['GET /me', 'GET /me/stats'],
  // Una consulta, su tutor o administración de su campus (exigirVer); la
  // bandeja y escribir a un alumno, lo de cada tutor.
  consultas: ['GET /mias', 'GET /adjuntos/:id', 'POST /mensajes/:mensajeId/reintentar', 'POST /alumnos/:id/escribir',
    'GET /:id', 'POST /:id/responder', 'POST /:id/cerrar'],
  mcp: ['GET /panel/', 'DELETE /panel/tokens/:id', 'PATCH /panel/conexiones/:id'],
  notifications: ['GET /', 'GET /unread-count', 'GET /preferences', 'PUT /preferences', 'PATCH /read-group',
    'PATCH /:id/read', 'PATCH /mark-all-read'],
  // El catálogo y las vistas los lee la pantalla de cualquiera («Mis
  // preferencias»); la ficha, la suya cualquiera y la de otro con «Ver
  // usuarios» (lo mira el controlador).
  permissions: ['GET /catalogo', 'GET /personas/:id', 'GET /system-defaults', 'GET /role-views/:roleKey'],
  // La ficha del tutor: la suya, cualquier tutor; la de otro, con «Gestionar
  // colaboraciones» (condición `tutores.ficha_ajena`).
  tutores: ['GET /:id', 'PATCH /:id/perfil', 'GET /:id/campus'],
  users: ['POST /:id/avatar', 'DELETE /:id/avatar', 'GET /:id/views', 'PATCH /:id/views', 'GET /mis-avisos', 'PATCH /mis-avisos'],
  whatsapp: ['GET /usuarios', 'GET /sonando'],
};

export const PUBLICAS_CON_CLAVE = {
  mcp: { 'POST /': 'mcp.usar', 'POST /u/:secreto': 'mcp.usar' },
};

/**
 * Rutas cuyo guardia deja pasar con una clave U OTRA y el controlador estrecha
 * según lo que se pida. WhatsApp: la ruta acepta «Usar su WhatsApp» o
 * «Supervisar»; la sesión PROPIA exige usar (chat.controller.js · usuarioObjetivo)
 * y la de otra persona, supervisar (condición `whatsapp.supervisar`). La fila de
 * la ruta es la sesión propia. El banco no: ahí vale cualquiera de las dos.
 */
export const ESTRECHA_EL_CONTROLADOR = {
  whatsapp: (relativa) => (relativa.includes(' /banco') ? undefined : 'whatsapp.usar'),
  // Alumnos sin mensajes y métricas: lo suyo pide «Atender sus consultas»; las
  // de todos (?todas=1), «Ver el panel» (condición `consultas.las_de_todos`).
  consultas: (relativa) => (/ \/(alumnos-sin-mensajes|metricas)$/.test(relativa) ? 'consultas.atender' : undefined),
};

/**
 * Rutas que, además de su permiso, son de un TUTOR: lo suyo de Consultas (su
 * carga, sus alumnos, sus métricas) no existe para quien no lo es, tampoco para
 * el superadmin (alcance, consultas.controller.js · exigirSerTutor/quienYAmbito).
 */
export const SOLO_DEL_TUTOR = {
  consultas: ['GET /carga', 'POST /carga', 'GET /alumnos-sin-mensajes', 'GET /metricas'],
};

/** La clave de cada acción con condición (las `PUERTAS` con `condicion`). */
export const CONDICIONES = {
  'invoices.rectificativa': 'facturas.gestionar',
  'invoices.proforma_sin_aprobacion': 'facturas.emitir',
  'conversions.emitir_al_cobrar': 'facturas.emitir',
  'certifex.imprenta': 'diplomas.imprenta',
  'leads.borrar_cualquiera': 'leads.delete_cualquiera',
  'tutores.ficha_ajena': 'tutores.gestionar',
  'tutores.correo': 'tutores.cambiar_correo',
  'users.empresas': 'users.empresas',
  'users.cambiar_rol': 'users.excepciones',
  'mcp.rechazar_ajenas': 'mcp.supervisar',
  'whatsapp.supervisar': 'whatsapp.supervisar',
  'whatsapp.plantillas_compartidas': 'whatsapp.plantillas_compartidas',
  'connectors.sistema': 'connectors.sistema',
  'webhooks-salientes.todas': 'webhooks_salientes.todas',
  'sales.sin_gestora': 'conversions.sin_gestora',
  'reports.puesto_ajeno': 'reports.puesto_ajeno',
  'consultas.las_de_todos': 'consultas.view',
};

/**
 * La clave (o claves) de una fila del inventario: la de su `puede`, o lo que
 * diga esta lista. `undefined` si no tiene ninguna y no está declarada.
 */
export function claveDe(fila, { comoGuardia = false } = {}) {
  if (fila.tipo === 'condicion') return CONDICIONES[fila.puerta];
  const delCodigo = (fila.guardias || []).find((g) => g.tipo === 'puede');
  if (delCodigo) {
    // `comoGuardia`: lo que deja pasar la ruta, sin lo que estrecha el controlador
    // (lo que hace falta como base de una acción con condición).
    const estrecha = !comoGuardia && delCodigo.claves.length > 1 && ESTRECHA_EL_CONTROLADOR[fila.modulo]?.(fila.relativa);
    if (estrecha) return estrecha;
    return delCodigo.claves.length === 1 ? delCodigo.claves[0] : delCodigo.claves;
  }
  if (fila.publica) return PUBLICAS_CON_CLAVE[fila.modulo]?.[fila.relativa] || null;
  if (PROPIAS[fila.modulo]?.includes(fila.relativa)) return PROPIA;
  return undefined;
}
