// Scraper de paginas de productos. Extrae lo que SI esta en HTML server-side
// (sin necesidad de JS): meta description, og:image, duracion, salidas, etc.
//
// Devuelve un objeto plano que se MERGEA al producto WC con prefijo `_page.*`
// para que el usuario lo pueda mapear como cualquier otro campo.
//
// Si el sitio activa el plugin "ACF to REST API", el ACF estara disponible
// directamente en wp.acf.* y este scraper se vuelve menos critico.

const FETCH_TIMEOUT_MS = 15000;
const cache = new Map();  // LRU simple por URL
const CACHE_MAX = 500;

function firstMatch(html, regex, idx = 1) {
  const m = html.match(regex);
  return m ? (m[idx] || '').trim() : null;
}

function allMatches(html, regex, idx = 1) {
  const out = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
  while ((m = re.exec(html)) !== null) {
    out.push((m[idx] || '').trim());
  }
  return out;
}

export async function extractFromProductPage(url) {
  if (!url) return {};
  if (cache.has(url)) return cache.get(url);

  let html = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'CRM-ISEIE-Scraper/1.0 (compatible; bot)' },
    });
    clearTimeout(timer);
    if (!r.ok) return {};
    html = await r.text();
  } catch {
    return {};
  }

  const data = {
    meta_description: firstMatch(html, /<meta\s+name=["']description["']\s+content=["']([^"']{20,400})["']/i),
    og_title:        firstMatch(html, /<meta\s+property=["']og:title["']\s+content=["']([^"']{3,300})["']/i),
    og_image:        firstMatch(html, /<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i),
    og_description:  firstMatch(html, /<meta\s+property=["']og:description["']\s+content=["']([^"']{20,400})["']/i),
    canonical:       firstMatch(html, /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i),
    horas:           firstMatch(html, /(\d{2,4})\s*horas?\b/i),
    creditos:        firstMatch(html, /(\d{1,3})\s*cr[eé]ditos?\b/i),
    modalidad:       firstMatch(html, /Modalidad[:\s]+(Online|Presencial|Mixta|Semi-?presencial|H[ií]brida)/i),
    titulacion:      firstMatch(html, /Titulaci[oó]n[:\s]+([^<\n.]{5,150})/i),
    profesores:      allMatches(html, /<h[34][^>]*>([A-ZÀ-ſ][a-zÀ-ſ]+(?:\s[A-ZÀ-ſ][a-zÀ-ſ]+){1,3})<\/h[34]>/g)
                       .filter(p => !/(?:Inicio|Curso|Master|M[aá]ster|Diplomado|Coaching|Psicolog[ií]a)/i.test(p))
                       .slice(0, 20),
  };

  // Limpiar undefined/null
  const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== ''));

  // Cache LRU
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(url, clean);
  return clean;
}

export function clearCache() { cache.clear(); }
