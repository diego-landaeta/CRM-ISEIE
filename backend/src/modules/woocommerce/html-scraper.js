// ============================================================
// Scraper generico de HTML para paginas de producto/curso WP.
//
// Filosofia:
//   - No asume estructura rigida.
//   - El admin configura `section_keywords` (JSONB en wc_credentials).
//   - Para cada seccion logica del CRM, el scraper busca en los <h2>
//     que contengan cualquiera de los keywords, recorta el bloque hasta
//     el siguiente <h2> y guarda el texto/HTML tal cual.
//   - Los modulos, profesores, FAQs, etc. son TEXTO unificado, no entidades
//     separadas.
//   - El meta_box devuelve TANTO el texto crudo COMO un valor normalizado
//     (numero + unidad, fecha ISO, etc.) para que el admin elija.
// ============================================================

import { logger } from '../../shared/utils/logger.js';

/** Normaliza texto: quita acentos para comparacion de keywords. */
function normalizeForMatch(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Limpia HTML -> texto plano colapsado. */
function htmlToText(s) {
  return String(s || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parsea un valor de meta_box y lo normaliza:
 *   "12 meses"     -> { text: "12 meses", value: 12, unit: "meses", type: "duration" }
 *   "1500 horas"   -> { text: "1500 horas", value: 1500, unit: "horas", type: "hours" }
 *   "10 Modulos"   -> { text: "10 Modulos", value: 10, unit: "modulos", type: "count" }
 *   "10-06-2026"   -> { text: "10-06-2026", iso_date: "2026-06-10", type: "date" }
 *   "Online"       -> { text: "Online", type: "text" }
 *   "EUR 1500"     -> { text: "EUR 1500", value: 1500, unit: "EUR", type: "currency" }
 */
function parseMetaValue(label, rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const norm = normalizeForMatch(label);

  // Detectar fecha (dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd)
  const dateMatch = text.match(/(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dateMatch && (norm.includes('fecha') || norm.includes('inicio'))) {
    let [, d, m, y] = dateMatch;
    if (y.length === 2) y = '20' + y;
    const iso = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
    return { text, iso_date: iso, type: 'date' };
  }

  // Detectar precio / currency
  if (norm.includes('precio') || norm.includes('coste')) {
    const m = text.match(/([\d.,]+)/);
    if (m) {
      const num = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
      const cur = text.match(/[€$]|EUR|USD|GBP|MXN/i);
      return { text, value: num, unit: cur ? cur[0].toUpperCase() : null, type: 'currency' };
    }
  }

  // Detectar numero + unidad generico (12 meses / 1500 horas / 10 Modulos / 30 semanas)
  const numUnit = text.match(/^\s*(\d+(?:[.,]\d+)?)\s*([a-zA-ZÀ-ſ]+)?\s*$/);
  if (numUnit) {
    const value = parseFloat(numUnit[1].replace(',', '.'));
    const unit = numUnit[2] ? normalizeForMatch(numUnit[2]) : null;
    let type = 'number';
    if (unit) {
      if (/mes|ano|semana|dia|hora|minuto/.test(unit)) type = 'duration';
      else if (/modulo|leccion|unidad|tema|bloque/.test(unit)) type = 'count';
      else if (/hora/.test(unit)) type = 'hours';
    }
    return { text, value, unit: numUnit[2] || null, type };
  }

  // Fallback: texto plano (Online, Presencial, Mixto, etc.)
  return { text, type: 'text' };
}

/**
 * Encuentra el primer <h2> que contiene cualquiera de las keywords
 * (case + accent insensitive) y devuelve el slice de HTML hasta el siguiente
 * <h2> O hasta el primer indicador de fin de contenido (footer/section close/h1).
 */
/**
 * Devuelve TODOS los slices que matchean los keywords como array de objetos
 * { heading, html }. Si quieres solo el primero o concatenarlos, usa los
 * wrappers mas arriba.
 */
function sliceSectionsByKeywords(html, keywords) {
  if (!keywords || keywords.length === 0) return [];

  // Recolectar TODOS los H2 con su posicion y texto normalizado
  const h2Re = /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi;
  const allH2 = [];
  let m;
  while ((m = h2Re.exec(html)) !== null) {
    allH2.push({
      index: m.index,
      end: m.index + m[0].length,
      text: htmlToText(m[1]),
      norm: normalizeForMatch(htmlToText(m[1])),
    });
  }
  if (allH2.length === 0) return '';

  // Recolectar TODOS los H2 que matchean CUALQUIER keyword del set.
  // No solo el primero: si hay varias secciones equivalentes (p. ej.
  // "Modulos del Curso" Y "Programa Academico" Y "Temario") las unimos.
  const matchedSet = new Set();
  const matches = [];
  for (const kw of keywords) {
    const kwNorm = normalizeForMatch(kw);
    for (const h of allH2) {
      if (matchedSet.has(h.index)) continue;
      if (h.norm.includes(kwNorm)) {
        matchedSet.add(h.index);
        matches.push(h);
      }
    }
  }
  if (matches.length === 0) return '';

  // Filtrar matches que parecen "ruido" (textos genericos tipicos del footer/CTA)
  const NOISE_RE = /\b(unete|crece con|solicita|contacta|encuentra tu|conoce)/i;
  const cleanMatches = matches.filter((h) => !NOISE_RE.test(normalizeForMatch(h.text)));
  const useMatches = cleanMatches.length > 0 ? cleanMatches : matches;

  // Ordenar por posicion en el HTML para preservar el orden natural
  useMatches.sort((a, b) => a.index - b.index);

  // Cortes generales: footer / site-footer (siempre cortan)
  const footerRe = /<footer\b/i;
  const siteFooterRe = /<[^>]+class="[^"]*(?:site-footer|elementor-location-footer)[^"]*"/i;

  // Para cada match, el slice va desde su end hasta el SIGUIENTE H2 de allH2
  // (sea match o no - un h2 distinto siempre cierra seccion), o footer.
  const slices = [];
  for (let i = 0; i < useMatches.length; i++) {
    const h = useMatches[i];
    const start = h.end;
    // Siguiente h2 en allH2 (posicion absoluta)
    const nextH2 = allH2.find((x) => x.index > h.index);
    const nextH2Abs = nextH2 ? nextH2.index : Infinity;
    // Footer / site-footer absolutos
    const after = html.slice(start);
    const footerRel = after.search(footerRe);
    const siteFooterRel = after.search(siteFooterRe);
    const footerAbs = footerRel >= 0 ? start + footerRel : Infinity;
    const siteFooterAbs = siteFooterRel >= 0 ? start + siteFooterRel : Infinity;
    const endAbs = Math.min(nextH2Abs, footerAbs, siteFooterAbs, start + 80000);
    const slice = html.slice(start, endAbs);
    if (slice.trim()) {
      slices.push({ heading: h.text, html: slice });
    }
  }
  return slices;
}

/**
 * Version legacy (compat): devuelve un unico string. Por defecto el PRIMER slice,
 * o si pasas { mode: 'concat' } los concatena todos.
 */
function sliceSectionByKeywords(html, keywords, opts = {}) {
  const slices = sliceSectionsByKeywords(html, keywords);
  if (slices.length === 0) return '';
  if (opts.mode === 'concat' || slices.length === 1) {
    if (slices.length === 1) return slices[0].html;
    return slices.map((s) => `<h3>-- ${s.heading} --</h3>\n${s.html}`).join('\n\n');
  }
  return slices[0].html;
}

/** Extrae title H1 del HTML (primer h1 no vacio). */
function extractH1(html) {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? htmlToText(m[1]).slice(0, 300) : null;
}

/**
 * Extrae el "meta box" buscando multiples patrones:
 *   1. Elementor icon-box-content (title + description)
 *   2. H4/H5 con label seguido del valor en siguiente nodo
 *   3. Texto plano "Label: valor" en widgets de texto
 *
 * Devuelve un objeto con cada label normalizado y su valor parseado:
 *   { duracion: { text:"12 meses", value:12, unit:"meses", type:"duration" }, ... }
 */
function extractMetaBox(html) {
  const LABEL_MAP = {
    duracion: 'duracion',
    horas: 'horas',
    'fecha de inicio': 'fecha_inicio',
    'fecha inicio': 'fecha_inicio',
    'fecha de comienzo': 'fecha_inicio',
    inicio: 'fecha_inicio',
    modulos: 'num_modulos',
    'numero de modulos': 'num_modulos',
    modalidad: 'modalidad',
    precio: 'precio',
    idioma: 'idioma',
    titulacion: 'titulacion',
    'titulo obtenido': 'titulacion',
    creditos: 'creditos',
    'creditos ects': 'creditos',
  };
  const found = {};

  // Patron 1: Elementor icon-box
  const blockRe = /<div\b[^>]*class="[^"]*elementor-icon-box-content[^"]*"[^>]*>([\s\S]{0,4000}?)<\/div>/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[1];
    const titleM = /<(?:h\d|span|div)\b[^>]*class="[^"]*elementor-icon-box-title[^"]*"[^>]*>([\s\S]*?)<\/(?:h\d|span|div)>/i.exec(block);
    const descM = /<(?:p|div|span)\b[^>]*class="[^"]*elementor-icon-box-description[^"]*"[^>]*>([\s\S]*?)<\/(?:p|div|span)>/i.exec(block);
    if (titleM && descM) {
      const label = normalizeForMatch(htmlToText(titleM[1]));
      const value = htmlToText(descM[1]);
      if (LABEL_MAP[label] && value && !found[LABEL_MAP[label]]) {
        found[LABEL_MAP[label]] = parseMetaValue(label, value);
      }
    }
  }

  // Patron 2: H4/H5 label seguido inmediatamente de un parrafo o div
  const h4Re = /<h([45])\b[^>]*>([\s\S]*?)<\/h\1>\s*(<(?:p|div|span)[^>]*>[\s\S]{1,150}?<\/(?:p|div|span)>)?/gi;
  while ((m = h4Re.exec(html)) !== null) {
    const labelText = normalizeForMatch(htmlToText(m[2]));
    const valueRaw = m[3] ? htmlToText(m[3]) : '';
    const key = LABEL_MAP[labelText];
    if (key && valueRaw && !found[key] && valueRaw.length < 100) {
      found[key] = parseMetaValue(labelText, valueRaw);
    }
  }

  // Patron 4: pares consecutivos de <p class="elementor-heading-title">label</p>
  // ... <p class="elementor-heading-title">valor</p> (estructura ICTESS).
  const headingPairRe = /<p[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>([^<]{2,40})<\/p>[\s\S]{1,600}?<p[^>]*class="[^"]*elementor-heading-title[^"]*"[^>]*>([^<]{1,80})<\/p>/gi;
  while ((m = headingPairRe.exec(html)) !== null) {
    const labelText = normalizeForMatch(htmlToText(m[1]));
    const valueRaw = htmlToText(m[2]).trim();
    const key = LABEL_MAP[labelText];
    if (key && valueRaw && !found[key]) {
      found[key] = parseMetaValue(labelText, valueRaw);
    }
  }

  // Patron 3: "Label: valor" en cualquier parrafo del HTML
  const labelColonRe = new RegExp(
    `<(?:p|li|span)[^>]*>\\s*<(?:strong|b)>?\\s*([A-Za-zÀ-ſ\\s]+?)\\s*:?\\s*</?(?:strong|b)?>?\\s*([^<]{1,80})\\s*</(?:p|li|span)>`,
    'gi'
  );
  while ((m = labelColonRe.exec(html)) !== null) {
    const labelText = normalizeForMatch(m[1]);
    const key = LABEL_MAP[labelText];
    if (key && m[2].trim() && !found[key]) {
      found[key] = parseMetaValue(labelText, m[2].trim());
    }
  }

  return found;
}

/** Extrae meta tags utiles del head. */
function extractMetaTags(html) {
  const ogImg = /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html);
  const desc = /<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i.exec(html);
  return {
    imagen_og: ogImg ? ogImg[1] : null,
    meta_description: desc ? desc[1] : null,
  };
}

// Hace fetch con hasta `retries` reintentos ante 5xx, abort o network error.
// Backoff lineal: 600ms, 1500ms. Limita en total a ~timeoutMs total acumulado.
async function fetchHtmlWithRetry(url, timeoutMs, retries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const ac = new AbortController();
      const to = setTimeout(() => ac.abort(), timeoutMs);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CRM-Importer/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'es-ES,es;q=0.9',
        },
        signal: ac.signal,
      });
      clearTimeout(to);
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 + 900 * attempt));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 600 + 900 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error('fetchHtmlWithRetry failed');
}

// Extrae horas/duracion/modulos del cuerpo del HTML cuando NO hay meta_box.
// Busca patrones como "100 horas", "12 meses", "6 modulos" en cualquier parte.
function extractDurationFromBody(html) {
  if (!html) return {};
  const text = htmlToText(html);
  const out = {};
  // Horas
  const horasMatch = text.match(/\b(\d{1,4})\s*horas?\b/i);
  if (horasMatch) out.horas = { text: `${horasMatch[1]} horas`, value: parseInt(horasMatch[1]), unit: 'horas', type: 'hours' };
  // Duracion en meses/semanas/dias
  const durMatch = text.match(/\b(\d{1,3})\s*(meses?|semanas?|d[ií]as?)\b/i);
  if (durMatch) out.duracion = { text: `${durMatch[1]} ${durMatch[2]}`, value: parseInt(durMatch[1]), unit: durMatch[2], type: 'duration' };
  // No de modulos / lecciones / unidades
  const modMatch = text.match(/\b(\d{1,3})\s*(m[oó]dulos?|lecciones?|unidades?|temas?|cap[ií]tulos?|bloques?)\b/i);
  if (modMatch) out.num_modulos = { text: `${modMatch[1]} ${modMatch[2]}`, value: parseInt(modMatch[1]), unit: modMatch[2], type: 'count' };
  // Modalidad
  const modal = text.match(/\b(online|presencial|virtual|mixto|h[ií]brido|semipresencial)\b/i);
  if (modal) out.modalidad = { text: modal[1], type: 'text' };
  return out;
}

/**
 * Scrapea una URL publica y devuelve un objeto estructurado.
 *
 * @param {string} url - permalink del producto/curso
 * @param {object} sectionKeywords - { presentacion: ['presentaci'], modulos: [...], ... }
 * @param {object} opts - { strategy: 'plain_text' | 'preserve_html', timeoutMs: 30000 }
 */
export async function scrapeProductPage(url, sectionKeywords = {}, opts = {}) {
  const { strategy = 'plain_text', timeoutMs = 30000 } = opts;

  let html;
  try {
    html = await fetchHtmlWithRetry(url, timeoutMs);
  } catch (err) {
    logger.warn({ url, err: err.message }, 'scrapeProductPage: fetch fallo tras retries');
    return { error: err.message };
  }

  const result = {
    titulo: extractH1(html),
    meta_box: extractMetaBox(html),
    ...extractMetaTags(html),
    sections: {},
    html_size: html.length,
  };

  // Fallback: si meta_box no capto horas/duracion/modalidad (tipico en
  // disenos sin tabla de specs), intentamos buscar en el cuerpo del HTML.
  try {
    const fb = extractDurationFromBody(html);
    if (!result.meta_box) result.meta_box = {};
    for (const [k, v] of Object.entries(fb)) {
      if (!result.meta_box[k]) result.meta_box[k] = v;
    }
  } catch (_) { /* opcional */ }

  // Para cada seccion logica configurada, extraer TODOS los slices que matchean.
  // - sections.{key}                 -> primer slice (compat)
  // - sections.{key}_2, _3, ...      -> slices adicionales (separados por heading)
  // - sections.{key}__all            -> concatenacion de TODOS con separadores
  // - sections_meta.{key}            -> array con [{heading, length, preview}, ...]
  result.sections_meta = {};
  for (const [crmField, keywords] of Object.entries(sectionKeywords || {})) {
    if (!Array.isArray(keywords) || keywords.length === 0) continue;
    const slices = sliceSectionsByKeywords(html, keywords);
    if (slices.length === 0) continue;
    const toFinal = (s) => {
      const v = strategy === 'preserve_html' ? s.trim() : htmlToText(s);
      return v.slice(0, 50000);
    };
    // Primer slice como valor por defecto del campo
    result.sections[crmField] = toFinal(slices[0].html);
    // Slices adicionales con sufijo _2, _3...
    for (let i = 1; i < slices.length; i++) {
      result.sections[`${crmField}_${i + 1}`] = toFinal(slices[i].html);
    }
    // Variante "__all": concatena los N con separador visible
    if (slices.length > 1) {
      const concatenated = slices.map((s) => `<h3>-- ${s.heading} --</h3>\n${s.html}`).join('\n\n');
      result.sections[`${crmField}__all`] = strategy === 'preserve_html' ? concatenated.trim() : htmlToText(concatenated);
    }
    // Meta: array con info de cada slice para que la UI pueda mostrar lista
    result.sections_meta[crmField] = slices.map((s) => ({
      heading: s.heading,
      length: (strategy === 'preserve_html' ? s.html : htmlToText(s.html)).length,
    }));
  }

  return result;
}

export { htmlToText, sliceSectionByKeywords, extractMetaBox, extractH1, parseMetaValue };
