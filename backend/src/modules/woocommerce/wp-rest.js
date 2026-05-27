// ============================================================
// Cliente WP REST API con Basic Auth (user + Application Password).
// Para sacar ACF, CPTs custom y taxonomias custom desde sitios WP.
// ============================================================

import { logger } from '../../shared/utils/logger.js';

function basicHeader(user, pass) {
  if (!user || !pass) return null;
  // Compatibilidad: las App Passwords nativas tienen espacios; algunos
  // mu-plugins usan claves sin espacios. Aceptamos ambas tal cual.
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return `Basic ${token}`;
}

async function getJson(url, auth, timeoutMs = 25000) {
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const headers = { 'User-Agent': 'CRM-Importer/1.0', Accept: 'application/json' };
    if (auth) headers.Authorization = auth;
    const res = await fetch(url, { headers, signal: ac.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${url.slice(-60)} : ${body.slice(0, 120)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(to);
  }
}

/**
 * Encuentra la "page SEO" asociada a un product WC.
 *
 * Logica:
 *   1. Quita el sufijo numerico del slug del product (-14121, -2105-2, etc.)
 *   2. Busca /wp/v2/pages?slug={limpio}
 *   3. Si no encuentra, busca /wp/v2/pages?search={titulo_limpio} y devuelve la primera
 *
 * Devuelve { id, slug, link } o null.
 */
export async function findSeoPageForProduct(product, baseUrl, user, pass, opts = {}) {
  if (!product || !product.slug) return null;
  const auth = basicHeader(user, pass);
  const root = baseUrl.replace(/\/$/, '');
  // Probamos en /pages + en cualquier CPT pasado en opts.cptEndpoints (ej. cursos,
  // diplomados, masters). Esto es lo que arregla casos como ICTESS: las landing
  // ricas viven en CPTs, no en pages.
  const types = ['pages', ...(Array.isArray(opts.cptEndpoints) ? opts.cptEndpoints : [])];

  // 1) Slug del product sin sufijo numerico tipo "-14121" o "-2105-2"
  const cleanSlug = product.slug.replace(/(-\d+)+$/, '');

  for (const type of types) {
    const base = `${root}/wp-json/wp/v2/${type}`;
    if (cleanSlug !== product.slug) {
      try {
        const arr = await getJson(`${base}?slug=${encodeURIComponent(cleanSlug)}&_fields=id,slug,link`, auth, 10000);
        if (Array.isArray(arr) && arr.length > 0) {
          return { id: arr[0].id, slug: arr[0].slug, link: arr[0].link, type };
        }
      } catch (_) {}
    }
    try {
      const arr = await getJson(`${base}?slug=${encodeURIComponent(product.slug)}&_fields=id,slug,link`, auth, 10000);
      if (Array.isArray(arr) && arr.length > 0) {
        return { id: arr[0].id, slug: arr[0].slug, link: arr[0].link, type };
      }
    } catch (_) {}
  }

  // 3) Busqueda por titulo - solo en /pages (los CPTs custom no siempre indexan search)
  if (product.name) {
    const base = `${root}/wp-json/wp/v2/pages`;
    const cleanTitle = String(product.name).replace(/^M[aá]ster\s+en\s+/i, '').replace(/^Curso\s+(?:de|en|sobre)\s+/i, '').slice(0, 80);
    try {
      const arr = await getJson(`${base}?search=${encodeURIComponent(cleanTitle)}&per_page=3&_fields=id,slug,link,title`, auth, 10000);
      if (Array.isArray(arr) && arr.length > 0) {
        const productCleanSlug = product.slug.replace(/(-\d+)+$/, '');
        const best = arr.find((p) => p.slug && (p.slug === productCleanSlug || p.slug.includes(productCleanSlug.split('-').slice(0, 4).join('-'))));
        if (best) return { id: best.id, slug: best.slug, link: best.link, type: 'pages' };
      }
    } catch (_) {}
  }

  return null;
}

/** Lista items de un CPT (todas las paginas). */
export async function fetchCptAll(baseUrl, cptSlug, user, pass, opts = {}) {
  const { perPage = 100, maxPages = 50, contextEdit = true } = opts;
  const auth = basicHeader(user, pass);
  const base = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/${cptSlug}`;
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = `${base}?per_page=${perPage}&page=${page}${contextEdit ? '&context=edit&acf_format=standard' : ''}`;
    try {
      const items = await getJson(url, auth);
      if (!Array.isArray(items) || items.length === 0) break;
      all.push(...items);
      if (items.length < perPage) break;
    } catch (err) {
      logger.warn({ cptSlug, page, err: err.message }, 'WP REST: error trayendo pagina');
      break;
    }
  }
  return all;
}

/**
 * Trae todas las páginas WordPress bajo unos parent IDs específicos.
 * Útil para sitios sin WC ni CPTs donde cada "producto" es una página
 * estándar bajo /cursos, /masters, /diplomados (caso ISEIE).
 *
 * Para cada parent, pagina hasta agotar. Devuelve items con la SAME shape
 * que fetchWcProducts para que el resto del flujo de import sea idéntico:
 *   { id, name, slug, permalink, short_description, description, meta_data:[] }
 *
 * REST API es endpoint OFICIAL y estable de WP — no falla.
 * Si una página individual falla, se omite y se sigue (graceful degradation).
 */
export async function fetchWpPagesByParents(baseUrl, parentIds, opts = {}) {
  const { perPage = 100, maxPages = 50 } = opts;
  const base = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/pages`;
  const all = [];
  const seen = new Set();
  for (const parentId of parentIds) {
    for (let page = 1; page <= maxPages; page++) {
      const url = `${base}?parent=${parentId}&per_page=${perPage}&page=${page}&_fields=id,slug,link,title,excerpt,content,parent,date,modified`;
      try {
        const items = await getJson(url, null, 25000);
        if (!Array.isArray(items) || items.length === 0) break;
        for (const it of items) {
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          // Adapta al shape esperado por el resto del flujo (similar a WC product).
          all.push({
            id: it.id,
            name: it.title?.rendered || it.slug,
            slug: it.slug,
            permalink: it.link,
            short_description: it.excerpt?.rendered || '',
            description: it.content?.rendered || '',
            price: '0',
            sku: null,
            status: 'publish',
            type: 'wp_page',
            categories: [],
            meta_data: [
              { key: '_wp_page_parent', value: it.parent },
              { key: '_wp_page_modified', value: it.modified },
            ],
            // dejamos info original para auditoría
            _wp_raw: { id: it.id, parent: it.parent, modified: it.modified },
          });
        }
        if (items.length < perPage) break;
      } catch (err) {
        logger.warn({ parentId, page, err: err.message }, 'WP REST pages: error en paginación, sigo con el siguiente parent');
        break;
      }
    }
  }
  return all;
}

/** Resuelve un termino de taxonomia custom (devuelve {name, slug, parent}). */
const _termCache = new Map();
export async function resolveTaxonomyTerm(baseUrl, taxSlug, termId, user, pass) {
  const key = `${baseUrl}|${taxSlug}|${termId}`;
  if (_termCache.has(key)) return _termCache.get(key);
  const auth = basicHeader(user, pass);
  const url = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2/${taxSlug}/${termId}`;
  try {
    const t = await getJson(url, auth, 10000);
    const result = t && t.name ? { id: t.id, name: t.name, slug: t.slug, parent: t.parent || 0 } : null;
    _termCache.set(key, result);
    return result;
  } catch (err) {
    logger.warn({ taxSlug, termId, err: err.message }, 'WP REST: term no resuelto');
    _termCache.set(key, null);
    return null;
  }
}

/**
 * Mapea un item de CPT (con ACF directo) al shape esperado por upsertProductFromWc.
 * Estrategia: si los ACF estan presentes, usarlos directo. Si no, fallback.
 */
export function mapCptItemToProduct(item, opts = {}) {
  const acf = (item.acf && typeof item.acf === 'object' && !Array.isArray(item.acf)) ? item.acf : {};
  const title = (item.title && item.title.rendered) || (typeof item.title === 'string' ? item.title : null);
  const slug = item.slug || null;
  const permalink = item.link || item.permalink || null;

  // Helpers para extraer texto de ACF (que puede ser string HTML o objeto/dict)
  const acfText = (key) => {
    const v = acf[key];
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.join('\n');
    if (typeof v === 'object') {
      // dict de items (objeto_1, objeto_2...) -> concatenar
      return Object.values(v).filter(x => x && typeof x === 'string').join('\n\n');
    }
    return String(v);
  };

  const horas = acfText('horas') || null;
  const duracion = acfText('duracion_') || acfText('duracion') || null;
  const precio = acfText('precio') || null;
  const fechaInicio = acfText('fecha_de_inicio') || acfText('fecha_inicio') || null;
  const numModulos = (() => {
    const v = acf.modulos_ ?? acf.modulos ?? null;
    if (v == null) return null;
    const n = parseInt(String(v).match(/\d+/)?.[0] || '');
    return isFinite(n) ? n : null;
  })();

  // Secciones desde ACF (concatenar variantes)
  const concatAcf = (...keys) => {
    const parts = keys.map(k => acfText(k)).filter(Boolean);
    return parts.length > 0 ? parts.join('\n\n') : null;
  };

  return {
    nombre: title,
    sku: null,
    precio: precio ? parseFloat(String(precio).replace(/[^\d.,]/g, '').replace(',', '.')) || null : null,
    descripcion: acfText('h2_presentacion') || null,
    url_info: permalink,
    moneda: opts.defaultCurrency || 'EUR',
    duracion,
    horas,
    fecha_inicio_texto: fechaInicio,
    num_modulos: numModulos,
    image_url: null,  // se rellena con featured_media si lo resolvemos
    presentacion_texto:       concatAcf('h2_presentacion','texto_por_que_estudiar'),
    objetivos_texto:          acfText('objetivos'),
    beneficios_texto:         concatAcf('beneficio_1_','beneficio_2','beneficio_3','beneficio_4','beneficio_5'),
    dirigido_a_texto:         concatAcf('textos_profesionales','encabezados_profesionales_a_quien_esta_dirigido'),
    para_que_te_prepara_texto: null,
    por_que_estudiar_texto:   acfText('texto_por_que_estudiar'),
    modulos_texto:            concatAcf('columna_1_modulos','columna_2_modulos_'),
    metodologia_texto:        null,
    faqs_texto:               (() => {
      const preg = acf.preguntas_faqs || {};
      const resp = acf.respuestas || {};
      if (typeof preg !== 'object') return null;
      const pairs = [];
      const pregKeys = Object.keys(preg).sort();
      const respKeys = Object.keys(resp || {}).sort();
      for (let i = 0; i < pregKeys.length; i++) {
        const q = preg[pregKeys[i]];
        const a = resp[respKeys[i]];
        if (q) pairs.push(`${q}${a ? '\n' + a : ''}`);
      }
      return pairs.length ? pairs.join('\n\n') : null;
    })(),
    profesores_texto:         null,
    otras_secciones:          null,
    raw_acf:                  Object.keys(acf).length > 0 ? acf : null,
    source_type:              opts.cptSlug || 'cpt',
    source_id:                item.id,
    wc_meta: {
      cpt_slug: opts.cptSlug,
      cpt_id: item.id,
      slug,
      title,
      permalink,
    },
  };
}
