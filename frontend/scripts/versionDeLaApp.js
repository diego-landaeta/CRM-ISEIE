// La versión que enseña el CRM: la de Novedades (25/11/2026).
//
// POR QUÉ. Con la 3.0.0 en producción, el menú decía «BETA 1.0.0» y el login
// «v0.1.0 Beta». Antes el número salía de las etiquetas de Git, pero el build
// de producción clona con `--depth 1`: sin etiquetas, y con el último commit
// sin «vX.Y.Z ·» en el título, caía al `package.json`, que decía 1.0.0. Y el
// login y el manual llevaban el «v0.1.0 Beta» escrito a mano desde abril.
//
// UNA SOLA FUENTE. La versión es la primera de Novedades
// (`backend/src/modules/novedades/versiones.js`, `ACTUAL.version`): la que
// Diego publica. Al añadir otra versión arriba, el menú, el login, el manual,
// `/api/health` y el MCP la enseñan solos. Sin variable de entorno que la pise.
// Solo si el fichero no está (una copia del frontal suelta), el `package.json`.
import fs from 'node:fs';
import path from 'node:path';

const SEMVER = /^\d+\.\d+\.\d+$/;

/** La ruta de las Novedades desde la carpeta del frontal. */
export function rutaDeNovedades(cwd) {
  return path.join(cwd, '..', 'backend', 'src', 'modules', 'novedades', 'versiones.js');
}

/**
 * La primera versión de la lista de Novedades, leída del texto del fichero.
 * La lista va de la más nueva a la más vieja, así que la primera es la actual.
 */
export function versionDeNovedades(texto) {
  const m = /["']?version["']?\s*:\s*["'](\d+\.\d+\.\d+)["']/.exec(String(texto || ''));
  return m ? m[1] : null;
}

export function versionDeLaApp({ cwd = process.cwd() } = {}) {
  try {
    const v = versionDeNovedades(fs.readFileSync(rutaDeNovedades(cwd), 'utf8'));
    if (v) return v;
  } catch { /* sin backend al lado: al paquete */ }
  try {
    const paquete = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    const v = String(paquete.version || '').replace(/^v/, '');
    return SEMVER.test(v) ? v : '';
  } catch {
    return '';
  }
}
