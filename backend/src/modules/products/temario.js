import { getClient, query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { fetchHtmlWithRetry } from '../woocommerce/html-scraper.js';
import { ordenDeLaPosicion } from './formacion.validation.js';

/**
 * El temario de un producto, módulo a módulo, sacado de la página del curso.
 *
 * Diego, 12/10, en el panel de Diplomas: «poner siempre para editar los módulos que
 * aparecerán, o sincronizar a un producto». Los diplomas imprimen los módulos de
 * `product_modules`, y esa tabla estaba VACÍA en todos los campus: el importador del
 * catálogo guarda el temario aplanado en `products.modulos_texto` («Módulo 1: Título
 * contenido contenido Módulo 2: …»), donde ya no se distingue el título del contenido.
 *
 * La página del curso sí lo distingue: cada módulo es un elemento propio que empieza por
 * «Módulo N» y un separador. Medido el 12/10 en una página de cada campus:
 *   ISEIH    <strong>Módulo 1. Envejecimiento cognitivo…      (y <h4> en los másteres)
 *   Psiko    <h4>Módulo 1: Estructura Estándar del Informe…
 *   Fono     <h3>Módulo 1: Psicología de la Identidad de Género…
 *   ISSLOGG  <span>Módulo 1: Limitaciones del forecast…
 *   ISECD    <h3>Módulo 01 — Fundamentos del pentesting web
 *   ISEF     <summary>Módulo 1: El cementerio histórico como patrimonio…
 * ICTESS, Academia IA e ISAEG no separan el temario en «Módulo N»: ahí no sale nada y
 * los módulos se escriben a mano en el panel, que es lo que ya se podía hacer.
 */

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', oacute: 'ó', aacute: 'á', eacute: 'é', iacute: 'í', uacute: 'ú', ntilde: 'ñ', Oacute: 'Ó', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };

const decodificar = (s) => String(s)
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m);

/**
 * Los módulos de una página: `[{ n, titulo }]` en orden, o `[]` si la página no los
 * separa. Solo cuenta si empiezan en el 1 y son al menos dos seguidos: una mención suelta
 * («el módulo 3 trata…») no es un temario.
 */
// «Módulo» como lo escriben las páginas (con tilde, sin ella, en mayúsculas, con entidad).
const MODULO = 'M(?:ó|o|&oacute;|&#243;|&#xf3;|&#211;|&#xd3;)dulo';
// ISEIE (19/10) llama «TEMA 1: …» a los módulos de algunos cursos. Solo se mira si la
// página no tiene ningún «Módulo N».
const TEMA = 'Tema';

function modulosConPalabra(texto, palabra) {
  // Un elemento cuyo texto EMPIEZA por «Módulo N» + separador; el título es lo que sigue
  // hasta la siguiente etiqueta. Las páginas repiten el temario (móvil y escritorio), así
  // que se queda la primera aparición de cada número.
  //  · Delante puede ir el icono del acordeón: ISAEG (19/10) pone
  //    `<button><span class="pe-icon">+</span> MÓDULO 1: …</button>`.
  //  · El título puede ir en el elemento siguiente: Psiko (19/10) pone
  //    `<p><strong>Módulo 1:</strong></p><ul><li><strong>Introducción a…`.
  const re = new RegExp(
    '<(?:h[1-6]|strong|b|summary|span|button|p|div|li|a|dt|label)\\b[^>]*>\\s*(?:<(span|i|em)\\b[^>]*>[^<]{0,3}<\\/\\1>\\s*)?'
    + `${palabra}\\s*0*(\\d{1,3})\\s*(?::|\\.|-|–|—|&ndash;|&mdash;|&#8211;|&#8212;)\\s*`
    + '(?:([^<\\s][^<]{1,299})|(?:<\\/[a-z0-9]+>\\s*)+(?:<[a-z0-9]+\\b[^>]*>\\s*){1,4}([^<]{2,300}))',
    'gi',
  );
  const porNumero = new Map();
  let m;
  while ((m = re.exec(texto)) !== null) {
    const n = Number(m[2]);
    const titulo = decodificar(m[3] ?? m[4] ?? '').replace(/\s+/g, ' ').trim().replace(/[:.\s]+$/, '');
    if (!titulo || porNumero.has(n)) continue;
    porNumero.set(n, titulo.slice(0, 300));
  }
  const lista = [...porNumero.entries()].sort((a, b) => a[0] - b[0]);
  // Seguidos desde el 1: si falta el 1 o hay un salto, se corta ahí.
  const seguidos = [];
  for (const [n, titulo] of lista) {
    if (n !== seguidos.length + 1) break;
    seguidos.push({ n, titulo });
  }
  // Salvo un temario largo con algún número mal puesto en la web: ISEIE (19/10) pasa del
  // «MÓDULO 1» al «MÓDULO 3». Si empieza en el 1, tiene al menos 4 y apenas hay huecos,
  // es el temario entero: se queda en su orden, numerado de nuevo.
  if (seguidos.length < lista.length && lista[0]?.[0] === 1 && lista.length >= 4 && lista.at(-1)[0] <= lista.length + 2) {
    return lista.map(([, titulo], i) => ({ n: i + 1, titulo }));
  }
  return seguidos.length >= 2 ? seguidos : [];
}

export function extraerModulosDeHtml(html) {
  const texto = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const modulos = modulosConPalabra(texto, MODULO);
  return modulos.length ? modulos : modulosConPalabra(texto, TEMA);
}

/**
 * Lee la página del producto y deja sus módulos en `product_modules`, en una transacción
 * (o todos o ninguno). Si la página no los separa, NO borra lo que hubiera: devuelve
 * `{ modulos: [], motivo }` y se escriben a mano en el panel.
 */
export async function sincronizarTemario(productId, { leer = fetchHtmlWithRetry } = {}) {
  const { rows: [p] } = await query('SELECT id, nombre, url_info FROM products WHERE id = $1', [productId]);
  if (!p) throw new AppError('Formación no encontrada en el catálogo.', 404, 'NOT_FOUND');
  if (!p.url_info) return { modulos: [], fuente: null, motivo: 'Esta formación no tiene la dirección de su página en el catálogo.' };

  let html;
  try {
    html = await leer(p.url_info, 20000);
  } catch (err) {
    logger.warn({ err: err.message, productId, url: p.url_info }, 'Temario: no se pudo leer la página');
    return { modulos: [], fuente: p.url_info, motivo: 'No se pudo abrir la página del curso. Prueba más tarde o escribe los módulos a mano.' };
  }
  let modulos = extraerModulosDeHtml(html);
  let fuente = p.url_info;
  // La ficha de la tienda sin temario: se prueba la página del curso (Academia IA).
  for (const alt of modulos.length ? [] : paginasDelCurso(p.url_info)) {
    try {
      const m = extraerModulosDeHtml(await leer(alt, 20000));
      if (m.length) { modulos = m; fuente = alt; break; }
    } catch { /* esa no existe (404) o no abre: la siguiente */ }
  }
  if (!modulos.length) {
    return { modulos: [], fuente: p.url_info, motivo: 'La página del curso no separa el temario en «Módulo 1, 2…»: escribe los módulos a mano.' };
  }

  const c = await getClient();
  try {
    await c.query('BEGIN');
    await c.query('DELETE FROM product_modules WHERE product_id = $1', [productId]);
    for (const [i, mod] of modulos.entries()) {
      await c.query('INSERT INTO product_modules (product_id, titulo, orden) VALUES ($1, $2, $3)', [productId, mod.titulo, ordenDeLaPosicion(i)]);
    }
    await c.query('UPDATE products SET num_modulos = $2, updated_at = NOW() WHERE id = $1', [productId, modulos.length]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
  logger.info({ productId, modulos: modulos.length, url: fuente }, 'Temario sincronizado con la página del curso');
  return { modulos: modulos.map((x) => ({ titulo: x.titulo })), fuente, motivo: null };
}

/**
 * Academia IA (19/10): el catálogo apunta a la ficha de la TIENDA
 * (`academiaia.ai/product/<curso>-16412/`), que no trae el temario; el temario está en la
 * página del CURSO, con el mismo nombre sin el número y bajo su nivel
 * (`/principiantes/`, `/avanzado/` o `/expertos/<curso>/`). Las tres direcciones a probar,
 * o ninguna si la ficha no es de esa tienda.
 */
export function paginasDelCurso(urlInfo) {
  const m = /^https?:\/\/(?:www\.)?academiaia\.ai\/product\/([a-z0-9-]+?)(?:-\d+)?\/?(?:[?#].*)?$/i.exec(String(urlInfo || '').trim());
  if (!m) return [];
  return ['principiantes', 'avanzado', 'expertos'].map((nivel) => `https://academiaia.ai/${nivel}/${m[1]}/`);
}
