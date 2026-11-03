/**
 * El mapeo de un webhook: qué campo del envío va a cada dato del CRM.
 *
 * `field_mapping` es `{ destino: 'ruta.en.el.envio' }`, con rutas separadas por
 * puntos (`data.email`). Sin mapeo, el envío se usa tal cual (vale si el formulario
 * ya manda los nombres del CRM).
 *
 * Estaba dentro de token.controller.js; aparte para usarlo también desde el webhook
 * de admisión (#198) sin importar el controlador.
 */

export function resolvePath(obj, path) {
  if (!path) return undefined;
  return String(path).split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

export function applyMapping(body, mapping) {
  if (!mapping || Object.keys(mapping).length === 0) return body;
  const out = {};
  for (const [target, source] of Object.entries(mapping)) {
    const v = resolvePath(body, source);
    if (v !== undefined) out[target] = v;
  }
  return out;
}
