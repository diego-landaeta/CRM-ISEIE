/**
 * Todas las rutas del CRM y lo que las protege HOY (#423, fase 1).
 *
 * No es una lista escrita a mano: monta el router de cada módulo y lo recorre.
 * Cada guardia lleva pegada su regla (`conRegla`, shared/middleware/auth.js),
 * así que lo que sale aquí es lo que el código hace, no lo que alguien recuerda.
 *
 * Una ruta nueva entra sola. Un guardia nuevo sin regla sale como
 * `sin_regla` y la prueba `inventarioPermisos.test.js` falla hasta que se
 * clasifica: si no sabemos quién pasa, no podemos decir quién puede.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const MODULOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Middleware que no decide QUIÉN entra: límites, subida de archivos, formato.
// Se nombran para que un guardia nuevo sin regla no se cuele entre ellos.
export const TECNICOS = new Set([
  'multerMiddleware', 'validatePdfMagicBytes', 'rateLimit', 'limite', 'recibir',
  'codigoConFormato', 'urlPersonal', 'metodoNoPermitido', 'jsonParser', 'urlencodedParser', 'textParser',
  'comprobarInterruptor', 'verificarTokenMcp', 'metadatosServidor', 'rawParser',
  'recibirArchivoSubido', 'guardarCuerpoCrudo',
  // Guardas de ALCANCE POR CAMPUS de facturas (IDOR): no deciden quien tiene el permiso (lo dice el
  // `puede(...)` de la misma ruta), solo recortan a SUS campus lo que ya tenia permiso para tocar.
  'facturaDeSuCampus', 'campusDelCuerpo', 'prospectoDelParametro', 'ventaDelParametro',
  // Subida de archivos (multer) de las consultas y del webhook de admisión.
  'conAdjuntos', 'conArchivos',
  // El projectId de Integraciones, que sea un número (QA del 22/10, punto 5).
  'projectIdConFormato',
  // Guardas de ALCANCE POR CAMPUS (IDOR): no deciden quien tiene el permiso (eso lo dice el `puede(...)`
  // de la misma ruta), solo recortan a SUS campus lo que ya tenia permiso para tocar.
  'puedeCrearEn', 'deSuCampus',
]);

/** El trozo de ruta de un `router.use('/panel', sub)`, sacado de su expresión. */
function prefijoDeCapa(capa) {
  // Express 4 guarda «/panel» como /^\/panel\/?(?=\/|$)/i
  const src = capa.regexp?.source || '';
  const fin = src.indexOf('\\/?(?=');
  if (!src.startsWith('^') || fin < 0) return '';
  return src.slice(1, fin).split('\\/').join('/');
}

function nombreDe(fn) {
  return fn?.name && fn.name !== 'anonymous' ? fn.name : null;
}

/** Lo que dice un middleware de quién pasa, o por qué no cuenta. */
export function reglaDe(fn) {
  if (fn?.regla) return fn.regla;
  // express-rate-limit devuelve funciones sin nombre; se reconocen por su API.
  if (typeof fn?.resetKey === 'function') return null;
  const n = nombreDe(fn);
  if (n && TECNICOS.has(n)) return null;
  return { tipo: 'sin_regla', nombre: n || 'anónima' };
}

function recorrer(pila, base, previas, salida) {
  const delRouter = [...previas];
  for (const capa of pila) {
    if (capa.route) {
      const fns = capa.route.stack.map((s) => s.handle);
      const controlador = fns[fns.length - 1];
      const intermedias = fns.slice(0, -1);
      const guardias = [...delRouter, ...intermedias.map(reglaDe).filter(Boolean)];
      for (const metodo of Object.keys(capa.route.methods)) {
        salida.push({
          metodo: metodo.toUpperCase(),
          ruta: base + capa.route.path,
          guardias,
          controlador: nombreDe(controlador) || null,
        });
      }
    } else if (capa.handle?.stack) {
      recorrer(capa.handle.stack, base + prefijoDeCapa(capa), delRouter, salida);
    } else {
      const r = reglaDe(capa.handle);
      if (r) delRouter.push(r);
    }
  }
}

/**
 * Las rutas de todos los módulos, en orden de módulo y de declaración.
 * `{ modulo, metodo, ruta, guardias: [regla…], controlador, publica }`
 */
export async function leerRutas() {
  const dirs = fs.readdirSync(MODULOS)
    .filter((d) => fs.existsSync(path.join(MODULOS, d, 'index.js')))
    .sort();
  const todas = [];
  for (const d of dirs) {
    const fichero = path.join(MODULOS, d, 'index.js');
    // Node quiere una URL file://; Vitest, la ruta tal cual (con la URL, los
    // espacios de la carpeta llegan como %20 y no encuentra el fichero).
    const mod = (await import(process.env.VITEST ? fichero : pathToFileURL(fichero).href)).default;
    const montajes = [{ prefijo: mod.prefix, router: mod.router }];
    if (mod.publicMount) montajes.push({ prefijo: mod.publicMount.prefix, router: mod.publicMount.router });
    for (const { prefijo, router } of montajes) {
      const salida = [];
      recorrer(router.stack, prefijo, [], salida);
      for (const r of salida) {
        todas.push({ modulo: d, prefijo, ...r, publica: !r.guardias.some((g) => g.tipo === 'token') });
      }
    }
  }
  return todas;
}
