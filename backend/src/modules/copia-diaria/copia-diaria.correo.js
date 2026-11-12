import * as P from '../../shared/services/email-plantilla.service.js';
import { CRM_CORREOS } from '../../shared/config/crm.js';

/**
 * El correo de la copia diaria, con la plantilla y la marca del CRM, como todos.
 *
 * Lleva lo justo para saber si la copia es normal (tamaño, tablas, filas) y
 * cómo se restaura. La contraseña NO va: es la de COPIA_DIARIA_CLAVE en el
 * servidor, y quien recibe el correo ya la tiene guardada aparte.
 */

export const megas = (bytes) => `${(Number(bytes) / (1024 * 1024)).toLocaleString('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} MB`;
const miles = (n) => Number(n).toLocaleString('es-ES');

/** «12/11/2026», del «2026-11-12» del día de la copia. */
export const fechaCorta = (dia) => dia.split('-').reverse().join('/');

const fechaHora = (d, zona) => d.toLocaleString('es-ES', {
  timeZone: zona, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});

const codigo = (texto) => `<code style="font-family:Consolas,Menlo,monospace;font-size:13px;background:#f4f4f5;padding:1px 5px;border-radius:4px">${P.esc(texto)}</code>`;

export function asuntoDeLaCopia(dia) {
  return `Copia de la base · ${CRM_CORREOS.nombre} · ${fechaCorta(dia)}`;
}

/**
 * @param {object} c
 * @param {string} c.dia            «2026-11-12»
 * @param {string} c.base           nombre de la base
 * @param {string} c.fichero        nombre del zip
 * @param {string} c.dentro         nombre del .sql que va dentro
 * @param {number} c.bytes          tamaño del zip cifrado
 * @param {number} c.bytesSql       tamaño del SQL sin comprimir
 * @param {number} c.tablas
 * @param {number} c.filas          aproximadas
 * @param {string} c.sha256
 * @param {number} c.guardadas      cuántas se guardan en el servidor
 * @param {string} c.zona
 * @param {{ url: string, caduca: Date } | null} c.enlace  null = va adjunta
 * @param {number} c.maxAdjuntoBytes
 */
export function correoDeLaCopia(c) {
  const adjunta = !c.enlace;
  const bloques = [
    P.parrafo(`Esta es la copia de hoy de la base <strong>${P.esc(c.base)}</strong>, hecha a las ${P.esc(fechaHora(new Date(), c.zona))}.`),
    P.tarjetas([
      { etiqueta: 'Tamaño (cifrada)', valor: megas(c.bytes) },
      { etiqueta: 'Tablas', valor: miles(c.tablas) },
      { etiqueta: 'Filas (aprox.)', valor: miles(c.filas) },
    ]),
    adjunta
      ? P.parrafo(`Va <strong>adjunta</strong>: ${P.esc(c.fichero)}.`)
      : P.parrafo(`Pesa más de ${megas(c.maxAdjuntoBytes)} y no cabe en el correo: se descarga del servidor con este enlace, que caduca el ${P.esc(fechaHora(c.enlace.caduca, c.zona))}.`),
    adjunta ? '' : P.boton({ texto: 'Descargar la copia cifrada', url: c.enlace.url }),
    P.nota(`Va cifrada con AES-256. La contraseña <strong>no</strong> va en este correo: es la de ${codigo('COPIA_DIARIA_CLAVE')} del servidor.${adjunta ? '' : ' El enlace solo da el fichero cifrado.'}`),
    P.seccion('Cómo se restaura'),
    P.parrafo(`1. Abre el zip con <strong>7-Zip</strong> o <strong>WinRAR</strong> y la contraseña. Sale ${codigo(c.dentro)} (${megas(c.bytesSql)}). En Linux: ${codigo(`7z x ${c.fichero}`)}; el ${codigo('unzip')} de siempre no abre AES.`),
    P.parrafo(`2. Restáurala en una base <strong>nueva y vacía</strong>, nunca encima de la de producción: ${codigo('createdb -U postgres crm_restaurada')} y después ${codigo(`psql -U postgres -d crm_restaurada -v ON_ERROR_STOP=1 -f ${c.dentro}`)}.`),
    P.parrafo('3. Comprueba que está lo que buscas. Para volver a ella del todo: para la API, renombra las bases (la de ahora a «_vieja» y la restaurada a su nombre) y arráncala de nuevo.'),
    P.parrafo('Va sin dueño ni permisos: al restaurarla, todo queda a nombre de quien la restaura. Si la app usa otro usuario, dale permiso sobre las tablas o restaura con ese usuario.'),
    P.nota(`En el servidor se guardan las ${miles(c.guardadas)} últimas. Huella SHA-256 del zip: ${codigo(c.sha256)}`),
  ];
  return P.correo({
    proyecto: CRM_CORREOS.marca || { nombre: CRM_CORREOS.nombre },
    titulo: `Copia de la base del ${fechaCorta(c.dia)}`,
    resumen: `${megas(c.bytes)} · ${miles(c.tablas)} tablas · ${adjunta ? 'adjunta' : 'con enlace de descarga'}`,
    bloques,
  });
}
