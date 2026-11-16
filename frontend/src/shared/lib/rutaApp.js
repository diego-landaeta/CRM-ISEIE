/**
 * La dirección completa de una pantalla del CRM, para un `<a href>` corriente
 * (los que abren en otra pestaña, o los que viven fuera del Router).
 *
 * Un `href` escrito a mano no sabe en qué base se ha compilado el frontal
 * (`VITE_BASE_PATH`). El de duplicados del alta de prospecto llevaba `/crm/`
 * puesto a mano, copiado de MultiCRM, donde la base es /crm/; aquí la base es
 * `/` y caía en «Página no encontrada» (CRM#633, ISEIE#360). Con esto la base
 * sale de la propia compilación.
 *
 * La prueba `enlacesSinRutasRotas` mira también las rutas que pasan por aquí.
 */
export function rutaApp(ruta) {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}
