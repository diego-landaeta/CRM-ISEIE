// Enlaces de los anuncios de Meta (#362): de dónde sale la URL de destino de
// cada anuncio y cómo se compara con el enlace de una formación del catálogo.
//
// Todo aquí es puro (sin base ni red) para poder probarlo con los creativos tal
// como los devuelve la Graph API.

/**
 * Meta exige un «link» también en los anuncios de formulario instantáneo, y
 * muchas veces pone este marcador: no es un destino de verdad.
 */
const MARCADORES = new Set(['fb.me', 'www.fb.me']);

function esUrlWeb(url) {
  if (typeof url !== 'string') return false;
  const u = url.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const host = new URL(u).hostname.toLowerCase();
    return !MARCADORES.has(host);
  } catch {
    return false;
  }
}

function sinRepetir(urls) {
  const vistas = new Set();
  const out = [];
  for (const u of urls) {
    const limpia = String(u).trim();
    if (!esUrlWeb(limpia) || vistas.has(limpia)) continue;
    vistas.add(limpia);
    out.push(limpia);
  }
  return out;
}

/**
 * La URL (o URLs) de destino de un creativo de Meta.
 *
 * Formatos que se contemplan (campos de `AdCreative` de la Graph API):
 *   · enlace           object_story_spec.link_data.link (o el del botón)
 *   · carrusel         object_story_spec.link_data.child_attachments[].link:
 *                      se guardan TODAS, en el orden de las tarjetas, y la
 *                      principal es la de la primera tarjeta
 *   · video            object_story_spec.video_data.call_to_action.value.link
 *   · dinamico         asset_feed_spec.link_urls[].website_url (creativo
 *                      dinámico / Advantage+) o template_data.link (catálogo)
 *   · formulario_instantaneo  el botón lleva lead_gen_form_id: NO hay web de
 *                      destino, aunque Meta rellene un «link»
 *   · publicacion_existente   el anuncio usa una publicación ya hecha
 *                      (object_story_id): su enlace no viene en el creativo
 *   · sin_enlace       ninguno de los anteriores
 *
 * Devuelve { formato, url, urls, formulario_id, url_tags }.
 */
export function destinoDelCreativo(creativo) {
  const c = creativo || {};
  const spec = c.object_story_spec || {};
  const link = spec.link_data || {};
  const video = spec.video_data || {};
  const plantilla = spec.template_data || {};
  const feed = c.asset_feed_spec || {};
  const urlTags = c.url_tags || null;

  const ctaLink = link.call_to_action?.value || {};
  const ctaVideo = video.call_to_action?.value || {};
  const formularioId = ctaLink.lead_gen_form_id || ctaVideo.lead_gen_form_id
    || (feed.call_to_actions || []).map((x) => x?.value?.lead_gen_form_id).find(Boolean) || null;

  const resultado = (formato, urls) => {
    const limpias = sinRepetir(urls);
    return { formato, url: limpias[0] || null, urls: limpias, formulario_id: formularioId ? String(formularioId) : null, url_tags: urlTags };
  };

  if (formularioId) return resultado('formulario_instantaneo', []);

  const tarjetas = Array.isArray(link.child_attachments) ? link.child_attachments : [];
  if (tarjetas.length) {
    // Las tarjetas primero; el enlace general («ver más») al final, si es otro.
    return resultado('carrusel', [...tarjetas.map((t) => t?.link || t?.call_to_action?.value?.link), link.link]);
  }
  if (link.link || ctaLink.link) return resultado('enlace', [link.link, ctaLink.link]);
  if (ctaVideo.link) return resultado('video', [ctaVideo.link]);
  if (Array.isArray(feed.link_urls) && feed.link_urls.length) {
    return resultado('dinamico', feed.link_urls.map((l) => l?.website_url));
  }
  if (plantilla.link) return resultado('dinamico', [plantilla.link]);
  // Campos sueltos que Meta rellena en algunos anuncios antiguos.
  if (c.object_url || c.link_url) return resultado('enlace', [c.object_url, c.link_url]);
  if (c.object_story_id || c.effective_object_story_id) return resultado('publicacion_existente', []);
  return resultado('sin_enlace', []);
}

/**
 * Un enlace reducido a lo que identifica la página: sin esquema, sin «www.»,
 * sin parámetros (UTM incluidos: todo lo que va tras «?»), sin «#…» y sin la
 * barra final. Las mayúsculas no cuentan. Vacío si no es un enlace.
 *
 *   https://www.iseih.com/master-x/?utm_source=fb  →  iseih.com/master-x
 */
export function normalizarEnlace(url) {
  if (typeof url !== 'string') return '';
  let s = url.trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^www\./, '');
  s = s.replace(/[?#].*$/, '');
  s = s.replace(/\/+$/, '');
  return s;
}

/**
 * La formación de un conjunto a partir de las URLs de sus anuncios.
 *
 * `urls`: todas las URLs de destino de los anuncios del conjunto.
 * `productos`: [{ id, url_info }] del catálogo del campus.
 *
 * Solo hay formación si las URLs que coinciden con el catálogo apuntan a UNA
 * sola: con varias, o con ninguna, no se asocia (`motivo` lo dice). Las URLs
 * que no son de ninguna formación (la portada, un WhatsApp) no cuentan.
 * Dos formaciones con el mismo enlace también son «varios».
 */
export function formacionDelConjunto(urls, productos) {
  const porEnlace = new Map();
  for (const p of productos || []) {
    const clave = normalizarEnlace(p.url_info);
    if (!clave) continue;
    if (!porEnlace.has(clave)) porEnlace.set(clave, new Set());
    porEnlace.get(clave).add(Number(p.id));
  }
  const encontradas = new Set();
  for (const u of urls || []) {
    const ids = porEnlace.get(normalizarEnlace(u));
    if (ids) for (const id of ids) encontradas.add(id);
  }
  if (encontradas.size === 1) return { productId: [...encontradas][0], motivo: 'uno' };
  return { productId: null, motivo: encontradas.size ? 'varios' : 'ninguno', candidatos: [...encontradas].sort((a, b) => a - b) };
}
