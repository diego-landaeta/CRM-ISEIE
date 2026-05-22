import { z } from 'zod';
import * as model from './wc.model.js';
import * as catModel from '../product-categories/category.model.js';
import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { inspectSchema, resolvePath } from '../connectors/connectors.adapters.js';
import { TARGETS_CATALOG, TRANSFORMS_CATALOG } from '../connectors/connectors.targets.js';
import { scrapeProductPage } from './html-scraper.js';
import { fetchCptAll, mapCptItemToProduct, findSeoPageForProduct } from './wp-rest.js';

const credsSchema = z.object({
  project_id: z.number().int().positive(),
  store_url: z.string().url(),
  consumer_key: z.string().min(1),
  consumer_secret: z.string().optional(),
  active: z.boolean().optional(),
  auto_sync_enabled: z.boolean().optional(),
  sync_interval_minutes: z.number().int().min(5).max(1440).optional(),
  default_currency: z.enum(['EUR', 'USD', 'GBP', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'BOB', 'VES', 'BRL', 'JPY', 'CHF']).optional(),
  // WP REST API (para sacar ACF / pages / CPTs personalizados)
  wp_user: z.string().max(100).optional().nullable(),
  wp_app_password: z.string().max(500).optional().nullable(),
  source_strategy: z.enum(['wc_only', 'wc_plus_cpt']).optional(),
  cpt_endpoints: z.array(z.string()).max(20).optional(),
  // Scraper HTML del permalink
  scraper_enabled: z.boolean().optional(),
  scrape_strategy: z.enum(['plain_text', 'preserve_html']).optional(),
  section_keywords: z.record(z.string(), z.array(z.string())).optional(),
});

function pid(req) {
  const p = parseInt(req.query.projectId);
  if (isNaN(p) || p <= 0) throw new AppError('projectId requerido (entero positivo)', 400, 'PROJECT_REQUIRED');
  return p;
}

export const getCreds = async (req, res, next) => {
  try {
    const c = await model.getCreds(pid(req));
    if (!c) return res.json({ success: true, data: null });
    res.json({ success: true, data: { ...c, consumer_secret: '****' } });
  } catch (e) { next(e); }
};
export const upsertCreds = async (req, res, next) => {
  try {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.errors[0];
      const fieldPath = first.path.join('.');
      throw new AppError(`Campo invalido: ${fieldPath} - ${first.message}`, 400, 'VALIDATION_ERROR');
    }
    const r = await model.upsertCreds(parsed.data.project_id, parsed.data);
    res.json({ success: true, data: { ...r, consumer_secret: '****' } });
  } catch (e) { next(e); }
};
export const deleteCreds = async (req, res, next) => {
  try { await model.deleteCreds(pid(req)); res.json({ success: true }); } catch (e) { next(e); }
};

export const listMappings = async (req, res, next) => {
  try { res.json({ success: true, data: await model.listMappings(pid(req)) }); } catch (e) { next(e); }
};
export const setMappings = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const arr = req.body?.mappings;
    if (!Array.isArray(arr)) throw new AppError('mappings debe ser array', 400, 'VALIDATION_ERROR');
    res.json({ success: true, data: await model.setMappings(projectId, arr) });
  } catch (e) { next(e); }
};

export const listRuns = async (req, res, next) => {
  try { res.json({ success: true, data: await model.listRuns(pid(req)) }); } catch (e) { next(e); }
};

export const getCurrentRun = async (req, res, next) => {
  try {
    const run = await model.getCurrentRun(pid(req));
    res.json({ success: true, data: run });
  } catch (e) { next(e); }
};

// ============================================================
// Helpers WC API con paginacion y categorias
// ============================================================

const PER_PAGE = 100;
const MAX_PAGES = 50;  // hard limit de seguridad: 5000 productos max por sync

function buildAuthQS(creds) {
  return `consumer_key=${encodeURIComponent(creds.consumer_key)}&consumer_secret=${encodeURIComponent(creds.consumer_secret)}`;
}

// Trae TODAS las paginas de un endpoint de WC
async function fetchAllPages(baseUrl, qs) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `${baseUrl}?per_page=${PER_PAGE}&page=${page}&${qs}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WC fetch ${res.status} en pagina ${page}: ${body.slice(0, 200)}`);
    }
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < PER_PAGE) break;  // ultima pagina
  }
  return all;
}

async function fetchWcProducts(creds) {
  const base = `${creds.store_url.replace(/\/$/, '')}/wp-json/wc/v3/products`;
  return fetchAllPages(base, buildAuthQS(creds));
}

async function fetchWcCategories(creds) {
  const base = `${creds.store_url.replace(/\/$/, '')}/wp-json/wc/v3/products/categories`;
  return fetchAllPages(base, buildAuthQS(creds));
}

// Sincroniza categorias WC -> product_categories. Devuelve map { wcId: localId }
async function syncCategories(projectId, wcCategories) {
  const wcMap = new Map();         // wcId -> localId
  const byWcId = new Map(wcCategories.map(c => [c.id, c]));

  // Resolver en orden topologico: padres primero
  const resolved = new Set();
  const queue = [...wcCategories];
  let safety = 0;
  while (queue.length > 0 && safety++ < 1000) {
    const c = queue.shift();
    const parentWcId = c.parent || 0;
    if (parentWcId !== 0 && !resolved.has(parentWcId) && byWcId.has(parentWcId)) {
      queue.push(c);  // re-encolar, padre aun no procesado
      continue;
    }
    const parentLocalId = parentWcId === 0 ? null : (wcMap.get(parentWcId) || null);
    const localId = await model.upsertCategoryByWcId(projectId, c.id, c.name, parentLocalId);
    wcMap.set(c.id, localId);
    resolved.add(c.id);
  }
  return wcMap;
}

// ============================================================
// Parser del menu HTML del sitio publico - extrae jerarquia N niveles
// ============================================================

// Parsea un fragmento HTML <ul>...</ul> de menu WP y devuelve arbol jerarquico
// Cada nodo: { label, href, children: [] }
function parseMenuHtml(html) {
  // Encuentra el primer <ul class="menu" ...> o <ul id="menu-..."> o el mas grande
  const ulMatch = html.match(/<ul[^>]*(?:class="[^"]*menu[^"]*"|id="menu-[^"]+")[^>]*>([\s\S]*?)<\/ul>(?=\s*(?:<\/nav>|<\/div>|<nav))/i)
    || html.match(/<ul[^>]*menu[^>]*>([\s\S]*)/i);
  const startHtml = ulMatch ? ulMatch[1] : html;

  // State machine: avanza por <li>...</li> con anidamiento de <ul>
  function extractItems(s) {
    const items = [];
    let i = 0;
    while (i < s.length) {
      const liStart = s.indexOf('<li', i);
      if (liStart === -1) break;
      const liOpen = s.indexOf('>', liStart);
      if (liOpen === -1) break;

      // Buscar </li> respetando <li> anidados
      let depth = 1;
      let j = liOpen + 1;
      while (j < s.length && depth > 0) {
        const nextOpen = s.indexOf('<li', j);
        const nextClose = s.indexOf('</li>', j);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          j = s.indexOf('>', nextOpen) + 1;
        } else {
          depth--;
          if (depth === 0) {
            const inner = s.substring(liOpen + 1, nextClose);
            // Extraer label y href del primer <a> directo (no anidado en otro li/ul)
            const aMatch = inner.match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
            if (aMatch) {
              const href = aMatch[1];
              const label = aMatch[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
              // Sub-menu: el primer <ul> dentro del li (despues del </a>)
              const afterA = inner.substring(inner.indexOf('</a>') + 4);
              const subUl = afterA.match(/<ul[^>]*sub-menu[^>]*>([\s\S]*)<\/ul>/i);
              const children = subUl ? extractItems(subUl[1]) : [];
              if (label && href) items.push({ label, href, children });
            }
            i = nextClose + 5;
            break;
          }
          j = nextClose + 5;
        }
      }
      if (depth > 0) break;
    }
    return items;
  }
  return extractItems(startHtml);
}

async function fetchMenuTree(storeUrl) {
  const url = storeUrl.replace(/\/$/, '');
  const r = await fetch(url, { headers: { 'User-Agent': 'CRM-ISEIE-Bot/1.0' } });
  if (!r.ok) return [];
  const html = await r.text();
  // Buscar el <nav> principal (mas grande)
  const navs = [...html.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/gi)].map(m => m[1]);
  const navHtml = navs.length ? navs.reduce((a, b) => a.length > b.length ? a : b) : html;
  return parseMenuHtml(navHtml);
}

async function fetchPageProductSlugs(pageUrl) {
  try {
    const r = await fetch(pageUrl, { headers: { 'User-Agent': 'CRM-ISEIE-Bot/1.0' } });
    if (!r.ok) return new Set();
    const html = await r.text();
    const slugs = new Set();
    const re = /href="([^"]+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[1];
      // Solo URLs del mismo dominio que apunten a productos (no a otras landings)
      const slugMatch = u.match(/^https?:\/\/[^/]+\/([a-z0-9][a-z0-9-]+)\/?$/i);
      if (slugMatch && /(curso|master|m[aá]ster|diplomado|programa|formacion|formaci[oó]n)/i.test(slugMatch[1])) {
        slugs.add(slugMatch[1]);
      }
    }
    return slugs;
  } catch { return new Set(); }
}

// Recorre arbol del menu, crea categorias N niveles, devuelve lista plana de hojas con su URL
// Anota arbol del menu con productos detectados por rama. PODA: descarta ramas sin productos.
async function annotateMenuWithProducts(menuTree, slugToProduct) {
  async function annotate(items) {
    const result = [];
    for (const item of items) {
      const productIds = new Set();
      let children = [];
      if (item.children?.length > 0) {
        children = await annotate(item.children);
        for (const c of children) for (const pid of c.productIds) productIds.add(pid);
      } else {
        // Hoja: visitar landing y match slugs
        const slugs = await fetchPageProductSlugs(item.href);
        for (const slug of slugs) {
          const pid = slugToProduct.get(slug);
          if (pid) productIds.add(pid);
        }
      }
      // Descartar ramas vacias (Blog, Contacto, Inicio, etc.)
      if (productIds.size === 0) continue;
      result.push({ ...item, children, productIds });
    }
    return result;
  }
  return annotate(menuTree);
}

// Crea solo categorias de ramas con productos, asigna productos a hojas.
// pathPrefix garantiza external_id unico aunque dos items del menu tengan mismo href
async function syncAnnotatedTree(projectId, annotated, parentLocalId = null, pathPrefix = '') {
  let cats = 0;
  let assigned = 0;
  for (let i = 0; i < annotated.length; i++) {
    const item = annotated[i];
    // Path unico por posicion en arbol -> previene self-loops por colision de href
    const path = `${pathPrefix}/${i}:${item.label.slice(0, 40)}`;
    const externalId = `menu:${path}`;
    const localId = await catModel.upsertExternal({
      project_id: projectId,
      parent_id: parentLocalId,
      nombre: item.label,
      source: 'wp_menu',
      external_id: externalId,
      external_url: item.href,
      orden: i,
    });
    cats++;
    if (item.children?.length > 0) {
      const r = await syncAnnotatedTree(projectId, item.children, localId, path);
      cats += r.cats;
      assigned += r.assigned;
    } else {
      for (const pid of item.productIds) {
        await query(
          `UPDATE products SET categoria_id = $1, updated_at = NOW() WHERE id = $2 AND project_id = $3`,
          [localId, pid, projectId]
        );
        assigned++;
      }
    }
  }
  return { cats, assigned };
}

// Limpia TODAS las categorias (cualquier source) sin productos directos ni descendientes con productos
async function pruneEmptyCategories(projectId) {
  let total = 0;
  while (true) {
    const { rowCount } = await query(
      `DELETE FROM product_categories WHERE project_id = $1 AND id IN (
         SELECT c.id FROM product_categories c
         WHERE c.project_id = $1 AND c.active = true
           AND NOT EXISTS (SELECT 1 FROM products p WHERE p.categoria_id = c.id AND p.active = true)
           AND NOT EXISTS (SELECT 1 FROM product_categories cc WHERE cc.parent_id = c.id)
       )`,
      [projectId]
    );
    if (!rowCount || rowCount === 0) break;
    total += rowCount;
  }
  return total;
}

// Normaliza slug WC para matchear con permalinks del frontend
function slugVariants(slug) {
  if (!slug) return [];
  const variants = new Set([slug]);
  // Quitar sufijo -N y -N-N final iterativamente
  let s = slug;
  while (/-\d+$/.test(s)) {
    s = s.replace(/-\d+$/, '');
    variants.add(s);
  }
  return [...variants];
}

// Construye el mapa slug -> product.id a partir de productos en DB
async function buildSlugToProductMap(projectId) {
  const { rows: prods } = await query(
    `SELECT id, wc_meta->>'slug' AS slug FROM products
     WHERE project_id = $1 AND wc_product_id IS NOT NULL`,
    [projectId]
  );
  const map = new Map();
  for (const p of prods) {
    for (const v of slugVariants(p.slug)) {
      if (!map.has(v)) map.set(v, p.id);
    }
  }
  return map;
}

// Mapea producto WC -> datos para insertar.
// `defaultCurrency` aplica si el producto WC no trae moneda en su payload.
function mapWcProduct(wp, categoryMap, defaultCurrency = 'EUR') {
  // Tipo de programa: meta `_cpt_sync_level` (cursos/masters/diplomados) si existe
  const levelMeta = (wp.meta_data || []).find(m => m.key === '_cpt_sync_level');
  const tipoPrograma = levelMeta?.value || null;

  // Categoria raiz y subcategoria (primera con parent != 0)
  const cats = wp.categories || [];
  let categoriaLocalId = null;
  let subcategoriaLocalId = null;
  for (const c of cats) {
    const localId = categoryMap.get(c.id);
    if (!localId) continue;
    if (categoriaLocalId === null) {
      categoriaLocalId = localId;
    } else {
      subcategoriaLocalId = localId;
      break;
    }
  }

  return {
    nombre: wp.name,
    precio: parseFloat(wp.price || wp.regular_price || 0),
    moneda: defaultCurrency,
    descripcion: wp.short_description || wp.description || null,
    sku: wp.sku || null,
    url_info: wp.permalink || null,  // Enlace al producto en la web publica
    categoria_id: categoriaLocalId,
    subcategoria_id: subcategoriaLocalId,
    meta: {
      wc_status: wp.status,
      wc_type: wp.type,
      tipo_programa: tipoPrograma,
      categories_wc: cats.map(c => ({ id: c.id, name: c.name, slug: c.slug })),
      variations: wp.variations,
      permalink: wp.permalink,
      slug: wp.slug,
    },
  };
}

// Funcion reutilizable: ejecuta el import completo (categorias + productos +
// scraper + CPT + menu). Usada por importNow (setImmediate) y por el scheduler
// (wooCommerceSyncScheduler) para que ambos apliquen field_mapping y scraper.
export async function runFullImport(creds, projectId, runId) {
      try {
        // 1. Sincronizar categorias primero
        logger.info({ projectId, runId }, 'WC: descargando categorias');
        const wcCategories = await fetchWcCategories(creds);
        const categoryMap = await syncCategories(projectId, wcCategories);
        logger.info({ projectId, count: wcCategories.length }, 'WC: categorias sincronizadas');

        // 2. Descargar todos los productos paginados
        logger.info({ projectId }, 'WC: descargando productos (paginado)');
        const wcProducts = await fetchWcProducts(creds);
        logger.info({ projectId, count: wcProducts.length }, 'WC: productos descargados');

        // 3. Upsert productos con categoria + sku
        let created = 0, updated = 0, skipped = 0;
        // Si hay field_mapping configurado, sus campos GANAN sobre el mapeo automatico.
        const userMapping = creds.field_mapping || {};
        const hasUserMapping = Object.keys(userMapping).length > 0;

        // Scraping habilitado en este proyecto?
        const scraperOn = !!creds.scraper_enabled;
        let sectionKeywords = creds.section_keywords;
        // Postgres JSONB a veces se deserializa como string si pg-types no esta configurado
        if (typeof sectionKeywords === 'string') {
          try { sectionKeywords = JSON.parse(sectionKeywords); } catch { sectionKeywords = {}; }
        }
        if (!sectionKeywords || typeof sectionKeywords !== 'object') sectionKeywords = {};
        const scrapeStrategy = creds.scrape_strategy || 'plain_text';
        let scrapedOk = 0, scrapedFail = 0, scrapedHits = 0;
        const sampleKw = Object.entries(sectionKeywords).slice(0, 3).map(([k,v]) => `${k}=${Array.isArray(v)?v.length:typeof v}`);
        logger.info({ projectId, scraperOn, kwCount: Object.keys(sectionKeywords).length, sampleKw, scrapeStrategy }, 'WC: estado scraper al iniciar import');

        for (const wp of wcProducts) {
          if (!wp.name) { skipped++; continue; }
          const auto = mapWcProduct(wp, categoryMap, creds.default_currency || 'EUR');
          // userMapping se resuelve despues del scrape (mas abajo) si hay scraper activo,
          // porque el path puede apuntar a scraper.sections.X
          const userMapped = (hasUserMapping && !scraperOn) ? applyWcFieldMapping(wp, userMapping) : {};
          const finalMapped = {
            ...auto,
            ...userMapped,
            meta: auto.meta,
            categoria_id: userMapped.categoria_id || auto.categoria_id,
            subcategoria_id: auto.subcategoria_id,
          };

          // Si scraper activo, decidir la URL a scrapear:
          //   - Si tenemos WP auth, intentar resolver la "page SEO" rica asociada
          //   - Si no, usar el permalink del product directo
          let urlToScrape = wp.permalink;
          let scrapeSource = 'wc_permalink';
          if (scraperOn && creds.wp_user && creds.wp_app_password) {
            try {
              const seoPage = await findSeoPageForProduct(wp, creds.store_url, creds.wp_user, creds.wp_app_password, {
                cptEndpoints: Array.isArray(creds.cpt_endpoints) ? creds.cpt_endpoints : [],
              });
              if (seoPage && seoPage.link && seoPage.link !== wp.permalink) {
                urlToScrape = seoPage.link;
                scrapeSource = `seo_page_id=${seoPage.id}`;
                finalMapped.source_type = 'seo_page';
                finalMapped.source_id = seoPage.id;
                // CRUCIAL: la URL publica util del producto es la SEO page,
                // no el permalink WC que termina en -1234-2.
                finalMapped.url_info = seoPage.link;
              }
            } catch (_) {}
          }
          if (scraperOn && urlToScrape) {
            try {
              if (scrapedOk + scrapedFail < 3) {
                logger.info({ wcId: wp.id, urlToScrape, scrapeSource }, 'WC: scrape arrancando');
              }
              const scraped = await scrapeProductPage(urlToScrape, sectionKeywords, {
                strategy: scrapeStrategy, timeoutMs: 20000,
              });
              if (!scraped.error) {
                scrapedOk++;
                // meta_box: si existe, sobrescribe valores especificos
                if (scraped.meta_box) {
                  const mb = scraped.meta_box;
                  if (mb.duracion?.text)     finalMapped.duracion         = mb.duracion.text;
                  if (mb.horas?.text)        finalMapped.horas            = mb.horas.text;
                  if (mb.fecha_inicio?.text) finalMapped.fecha_inicio_texto = mb.fecha_inicio.text;
                  if (mb.num_modulos?.value) finalMapped.num_modulos      = mb.num_modulos.value;
                  if (mb.modalidad?.text)    finalMapped.modalidad        = mb.modalidad.text;
                }
                // Mapear sections al esquema fijo de products._texto
                const SECTION_TO_COLUMN = {
                  presentacion:        'presentacion_texto',
                  objetivos:           'objetivos_texto',
                  beneficios:          'beneficios_texto',
                  dirigido_a:          'dirigido_a_texto',
                  para_que_te_prepara: 'para_que_te_prepara_texto',
                  por_que_estudiar:    'por_que_estudiar_texto',
                  modulos:             'modulos_texto',
                  metodologia:         'metodologia_texto',
                  faqs:                'faqs_texto',
                  profesores:          'profesores_texto',
                };
                const otrasSecciones = {};
                let hitCount = 0;
                for (const [key, val] of Object.entries(scraped.sections || {})) {
                  if (!val) continue;
                  hitCount++;
                  const col = SECTION_TO_COLUMN[key];
                  if (col) finalMapped[col] = val;
                  else otrasSecciones[key] = val;
                }
                if (hitCount > 0) scrapedHits++;
                if (Object.keys(otrasSecciones).length > 0) finalMapped.otras_secciones = otrasSecciones;

                // Si no tenemos num_modulos del meta_box pero si modulos_texto, contar
                if (!finalMapped.num_modulos && finalMapped.modulos_texto) {
                  const matches = finalMapped.modulos_texto.match(/\bM[oó]dulo\s+\d+\b/gi);
                  if (matches && matches.length > 0) {
                    const nums = new Set(matches.map(s => s.match(/\d+/)[0]));
                    finalMapped.num_modulos = nums.size;
                  }
                }
                // Imagen og como fallback si no hay imagen
                if (scraped.imagen_og && !finalMapped.image_url) finalMapped.image_url = scraped.imagen_og;

                // Aplicar mapping del admin AHORA que tenemos scraped (sus paths
                // pueden referirse a scraper.sections.X o scraper.meta_box.X.text)
                if (hasUserMapping) {
                  // Si el mapping del usuario tiene rutas cpt.acf.*, traemos el CPT
                  let cptForMapping = null;
                  const usesCpt = Object.values(userMapping).some((v) => typeof v === 'string' && v.startsWith('cpt.'));
                  if (usesCpt) {
                    try {
                      const metaArr = Array.isArray(wp.meta_data) ? wp.meta_data : [];
                      const cptId = metaArr.find((m) => m.key === '_cpt_sync_source_id')?.value;
                      const cptSlug = metaArr.find((m) => m.key === '_cpt_sync_level')?.value;
                      if (cptId && cptSlug && creds.wp_user && creds.wp_app_password) {
                        const cptUrl = `${creds.store_url.replace(/\/$/, '')}/wp-json/wp/v2/${cptSlug}/${cptId}?context=edit`;
                        const auth = 'Basic ' + Buffer.from(`${creds.wp_user}:${creds.wp_app_password}`).toString('base64');
                        const cr = await fetch(cptUrl, { headers: { Authorization: auth } });
                        if (cr.ok) cptForMapping = await cr.json();
                      }
                    } catch (_) { /* opcional */ }
                  }
                  const userMappedRich = applyMappingWithScraper(wp, scraped, userMapping, cptForMapping);
                  Object.assign(finalMapped, userMappedRich);
                }
              } else {
                scrapedFail++;
              }
            } catch (sErr) {
              scrapedFail++;
              logger.warn({ err: sErr.message, url: wp.permalink }, 'WC: scrape fallo (no bloqueante)');
            }
          }

          try {
            const r = await model.upsertProductFromWc({ projectId, wcId: wp.id, data: finalMapped });
            if (r.action === 'created') created++;
            else if (r.action === 'updated') updated++;
          } catch (perItemErr) {
            skipped++;
            logger.warn(
              { err: perItemErr.message, wcId: wp.id, wcName: wp.name, projectId },
              'WC: producto saltado por error per-item'
            );
          }
        }
        if (scraperOn) {
          logger.info({ projectId, scrapedOk, scrapedFail, scrapedHits }, 'WC: scraping completado');
        }

        // --- Fase CPT (sitios con CPTs custom + ACF rico) ---------------
        let cptCreated = 0, cptUpdated = 0, cptSkipped = 0;
        if (creds.source_strategy === 'wc_plus_cpt' && Array.isArray(creds.cpt_endpoints) && creds.cpt_endpoints.length > 0) {
          if (!creds.wp_user || !creds.wp_app_password) {
            logger.warn({ projectId }, 'WC: source_strategy=wc_plus_cpt pero faltan wp_user/wp_app_password');
          } else {
            for (const cptSlug of creds.cpt_endpoints) {
              try {
                logger.info({ projectId, cptSlug }, 'WP CPT: descargando');
                const items = await fetchCptAll(creds.store_url, cptSlug, creds.wp_user, creds.wp_app_password, { perPage: 100, maxPages: 50, contextEdit: true });
                logger.info({ projectId, cptSlug, count: items.length }, 'WP CPT: items descargados');
                for (const item of items) {
                  if (!item || !item.id) { cptSkipped++; continue; }
                  const mapped = mapCptItemToProduct(item, { cptSlug, defaultCurrency: creds.default_currency || 'EUR' });
                  if (!mapped.nombre) { cptSkipped++; continue; }
                  // Aplicar field_mapping si lo hubiera
                  if (hasUserMapping) {
                    const userMapped = applyWcFieldMapping(item, userMapping);
                    Object.assign(mapped, userMapped);
                  }
                  try {
                    // wcId del CPT = source_id (lo guardamos en wc_product_id para idempotencia)
                    // Prefijado para no chocar con IDs WC: cptSlug+id
                    const fakeWcId = -1 * (cptSlug.charCodeAt(0) * 100000 + item.id);
                    const r = await model.upsertProductFromWc({ projectId, wcId: fakeWcId, data: mapped });
                    if (r.action === 'created') cptCreated++;
                    else if (r.action === 'updated') cptUpdated++;
                  } catch (perItemErr) {
                    cptSkipped++;
                    logger.warn({ err: perItemErr.message, cptSlug, itemId: item.id }, 'WP CPT: item saltado');
                  }
                }
              } catch (cptErr) {
                logger.warn({ err: cptErr.message, cptSlug }, 'WP CPT: fetch fallo (no bloquea el resto)');
              }
            }
            logger.info({ projectId, cptCreated, cptUpdated, cptSkipped }, 'WP CPT: import completado');
          }
        }
        // Sumar al total
        created += cptCreated;
        updated += cptUpdated;
        skipped += cptSkipped;
        // 4. Pasada extra: scrap del menu HTML - solo crea ramas con productos
        let menuStats = { cats: 0, assigned: 0, pruned: 0 };
        try {
          logger.info({ projectId }, 'WC: scrapeo menu HTML');
          const menuTree = await fetchMenuTree(creds.store_url);
          if (menuTree.length > 0) {
            const slugMap = await buildSlugToProductMap(projectId);
            const annotated = await annotateMenuWithProducts(menuTree, slugMap);
            const r = await syncAnnotatedTree(projectId, annotated);
            menuStats = { cats: r.cats, assigned: r.assigned };
            logger.info({ projectId, ...menuStats }, 'WC: menu sincronizado');
          }
        } catch (menuErr) {
          logger.warn({ err: menuErr.message, projectId }, 'WC: scrap del menu fallo (no bloquea import)');
        }

        // 5. Pasada final: borrar categorias huerfanas (cualquier source, sin productos ni descendientes)
        try {
          const pruned = await pruneEmptyCategories(projectId);
          menuStats.pruned = pruned;
          logger.info({ projectId, pruned }, 'WC: categorias vacias eliminadas');
        } catch (e) {
          logger.warn({ err: e.message, projectId }, 'WC: pruneEmpty fallo');
        }

        await model.finishRun(runId, {
          status: 'success',
          total_fetched: wcProducts.length,
          total_created: created,
          total_updated: updated,
          total_skipped: skipped,
        });
        logger.info({ projectId, created, updated, skipped, total: wcProducts.length, menu: menuStats }, 'WC import OK');
      } catch (err) {
        logger.error({ err: err.message, runId }, 'WC import error');
        await model.finishRun(runId, { status: 'error', error_message: err.message?.slice(0, 1000) });
      }
}

// Endpoint que dispara runFullImport en background y responde inmediatamente
export const importNow = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const creds = await model.getCreds(projectId);
    if (!creds || !creds.active) throw new AppError('Credenciales WC no configuradas', 400, 'NO_CREDS');
    const run = await model.startRun(projectId, req.user.id);
    res.json({ success: true, data: { run_id: run.id, status: 'running' } });
    setImmediate(() => runFullImport(creds, projectId, run.id));
  } catch (e) { next(e); }
};

export const previewWc = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const creds = await model.getCreds(projectId);
    if (!creds) throw new AppError('Credenciales WC no configuradas', 400, 'NO_CREDS');

    const customUrl = req.query.url;
    const base = `${creds.store_url.replace(/\/$/, '')}/wp-json/wc/v3/products`;

    // Total
    const totalUrl = `${base}?per_page=1&${buildAuthQS(creds)}`;
    const totalRes = await fetch(totalUrl);
    const total = parseInt(totalRes.headers.get('x-wp-total') || '0');

    let sample = [];
    let firstItem = {};

    if (customUrl && typeof customUrl === 'string') {
      // Buscar el producto cuyo permalink termine con el slug de la URL dada
      const slug = String(customUrl).replace(/\/$/, '').split('/').pop();
      if (slug) {
        const r = await fetch(`${base}?slug=${encodeURIComponent(slug)}&${buildAuthQS(creds)}`);
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr.length > 0) {
            sample = arr;
            firstItem = arr[0];
          }
        }
      }
      // Fallback: si no encontramos por slug, buscar por search del titulo limpio
      if (!firstItem.id) {
        const r = await fetch(`${base}?search=${encodeURIComponent(slug.replace(/-/g, ' '))}&per_page=3&${buildAuthQS(creds)}`);
        if (r.ok) {
          const arr = await r.json();
          if (Array.isArray(arr) && arr.length > 0) {
            sample = arr;
            firstItem = arr[0];
          }
        }
      }
    }

    if (!firstItem.id) {
      // Fallback: primera pagina normal
      const r = await fetch(`${base}?per_page=3&${buildAuthQS(creds)}`);
      if (!r.ok) throw new AppError(`WC respondio ${r.status}`, 502, 'WC_ERROR');
      sample = await r.json();
      firstItem = sample[0] || {};
    }

    // Schema completo del producto + sugeridos auto-detectados + targets disponibles
    const schema = inspectSchema(firstItem);
    const sugeridos = autoSuggestWcMapping(firstItem);
    const targets = TARGETS_CATALOG.product.filter(t => t.key !== 'moneda');

    // Si el producto WC apunta a un CPT custom (meta_data._cpt_sync_source_id +
    // _cpt_sync_level), traemos el CPT con sus ACF para que el admin pueda mapear
    // campos como cpt.acf.horas, cpt.acf.objetivos, etc.
    let cptItem = null;
    try {
      const metaArr = Array.isArray(firstItem.meta_data) ? firstItem.meta_data : [];
      const cptId = metaArr.find((m) => m.key === '_cpt_sync_source_id')?.value;
      const cptSlug = metaArr.find((m) => m.key === '_cpt_sync_level')?.value;
      if (cptId && cptSlug && creds.wp_user && creds.wp_app_password) {
        const cptUrl = `${creds.store_url.replace(/\/$/, '')}/wp-json/wp/v2/${cptSlug}/${cptId}?context=edit`;
        const auth = 'Basic ' + Buffer.from(`${creds.wp_user}:${creds.wp_app_password}`).toString('base64');
        const cr = await fetch(cptUrl, { headers: { Authorization: auth } });
        if (cr.ok) cptItem = await cr.json();
      }
    } catch (_) { /* opcional, no bloquea */ }

    // Si el scraper esta activo, intentar tambien scrapear la SEO page de este producto
    let scraped = null;
    if (creds.scraper_enabled && firstItem.permalink) {
      try {
        let urlToScrape = firstItem.permalink;
        if (creds.wp_user && creds.wp_app_password) {
          const seo = await findSeoPageForProduct(firstItem, creds.store_url, creds.wp_user, creds.wp_app_password, {
            cptEndpoints: Array.isArray(creds.cpt_endpoints) ? creds.cpt_endpoints : [],
          });
          if (seo && seo.link) urlToScrape = seo.link;
        }
        const keywords = creds.section_keywords || {};
        const stratg = creds.scrape_strategy || 'plain_text';
        scraped = await scrapeProductPage(urlToScrape, keywords, { strategy: stratg, timeoutMs: 15000 });
        scraped.url_used = urlToScrape;
      } catch (sErr) {
        scraped = { error: sErr.message };
      }
    }

    // Targets enriquecidos: anadir todos los _texto + meta_box + atributos del scraper
    const enrichedTargets = [...targets];
    const SCRAPER_FIELDS = [
      { key: 'presentacion_texto', label: 'Presentacion (texto)', group: 'Scraper' },
      { key: 'objetivos_texto', label: 'Objetivos (texto)', group: 'Scraper' },
      { key: 'beneficios_texto', label: 'Beneficios (texto)', group: 'Scraper' },
      { key: 'dirigido_a_texto', label: 'Dirigido a (texto)', group: 'Scraper' },
      { key: 'para_que_te_prepara_texto', label: 'Para que te prepara (texto)', group: 'Scraper' },
      { key: 'por_que_estudiar_texto', label: 'Por que estudiar (texto)', group: 'Scraper' },
      { key: 'modulos_texto', label: 'Modulos / Temario (texto)', group: 'Scraper' },
      { key: 'metodologia_texto', label: 'Metodologia (texto)', group: 'Scraper' },
      { key: 'faqs_texto', label: 'FAQs (texto)', group: 'Scraper' },
      { key: 'profesores_texto', label: 'Profesores (texto)', group: 'Scraper' },
      { key: 'duracion', label: 'Duracion', group: 'Scraper meta_box' },
      { key: 'horas', label: 'Horas', group: 'Scraper meta_box' },
      { key: 'num_modulos', label: 'No de Modulos', group: 'Scraper meta_box' },
      { key: 'fecha_inicio_texto', label: 'Fecha de inicio', group: 'Scraper meta_box' },
      { key: 'modalidad', label: 'Modalidad (Online/Presencial)', group: 'Scraper meta_box' },
    ];
    for (const sf of SCRAPER_FIELDS) {
      if (!enrichedTargets.find((t) => t.key === sf.key)) enrichedTargets.push({ ...sf, type: 'string' });
    }

    // Si tenemos scrape exitoso, enriquecer los sugeridos con campos del scraper
    if (scraped && !scraped.error) {
      if (scraped.url_used && scraped.url_used !== firstItem.permalink) {
        sugeridos.url_info = 'scraper.url_used';   // SEO page > carrito WC
      }
      if (scraped.imagen_og) sugeridos.image_url = 'scraper.imagen_og';
      if (scraped.sections) {
        for (const [k, v] of Object.entries(scraped.sections)) {
          if (v) sugeridos[`${k}_texto`] = `scraper.sections.${k}`;
        }
      }
      if (scraped.meta_box) {
        if (scraped.meta_box.duracion)     sugeridos.duracion           = 'scraper.meta_box.duracion.text';
        if (scraped.meta_box.horas)        sugeridos.horas              = 'scraper.meta_box.horas.text';
        if (scraped.meta_box.fecha_inicio) sugeridos.fecha_inicio_texto = 'scraper.meta_box.fecha_inicio.text';
        if (scraped.meta_box.num_modulos)  sugeridos.num_modulos        = 'scraper.meta_box.num_modulos.value';
        if (scraped.meta_box.modalidad)    sugeridos.modalidad          = 'scraper.meta_box.modalidad.text';
      }
    }

    // Si tenemos un CPT vinculado, anadir sugerencias mapeando ACF -> targets CRM.
    if (cptItem && cptItem.acf && typeof cptItem.acf === 'object') {
      const acf = cptItem.acf;
      const collect = (...keys) => keys.filter((k) => acf[k] != null && String(acf[k]).trim() !== '').map((k) => `cpt.acf.${k}`);
      const collectByPrefix = (prefix) => {
        const keys = Object.keys(acf).filter((k) => {
          if (!k.startsWith(prefix)) return false;
          const rest = k.slice(prefix.length);
          return /^_?\d*_?$/.test(rest);
        }).sort();
        return keys.filter((k) => acf[k] != null && String(acf[k]).trim() !== '').map((k) => `cpt.acf.${k}`);
      };

      const setSug = (target, paths) => {
        if (sugeridos[target] || paths.length === 0) return;
        sugeridos[target] = paths.length === 1 ? paths[0] : paths;
      };

      setSug('horas', collect('horas'));
      setSug('duracion', collect('duracion_', 'duracion'));
      setSug('num_modulos', collect('modulos_', 'modulos'));
      setSug('fecha_inicio_texto', collect('fecha_de_inicio', 'fecha_inicio'));
      setSug('presentacion_texto', collect('h2_presentacion'));
      setSug('objetivos_texto', collect('objetivos'));
      setSug('por_que_estudiar_texto', collect('texto_por_que_estudiar'));
      setSug('dirigido_a_texto', collect('textos_profesionales', 'encabezados_profesionales_a_quien_esta_dirigido'));
      setSug('modulos_texto', collect('columna_1_modulos', 'columna_2_modulos_', 'columna_2_modulos'));
      setSug('beneficios_texto', collectByPrefix('beneficio'));
      setSug('faqs_texto', collect('preguntas_faqs'));
    }

    // Vista previa del mapping aplicado
    const currentMapping = creds.field_mapping && Object.keys(creds.field_mapping).length > 0
      ? creds.field_mapping
      : sugeridos;
    const mapped_preview = applyMappingWithScraper(firstItem, scraped, currentMapping, cptItem);

    // Schema del CPT (solo claves ACF - el resto del WP REST es ruido para el mapping)
    let cptSchema = null;
    if (cptItem && cptItem.acf && typeof cptItem.acf === 'object') {
      const acfEntries = Object.entries(cptItem.acf).map(([k, v]) => {
        const type = Array.isArray(v) ? 'array' : (typeof v === 'object' && v ? 'object' : typeof v);
        const sample = type === 'object' || type === 'array' ? '(combinado)' : (v == null ? null : String(v).slice(0, 80).replace(/\n/g, ' '));
        return { path: `cpt.acf.${k}`, label: k, type, sample };
      });
      cptSchema = {
        slug: cptItem.type || null,
        id: cptItem.id || null,
        title: cptItem.title?.rendered || cptItem.title || null,
        acf_fields: acfEntries,
      };
    }

    res.json({
      success: true,
      data: {
        count: total,
        sample,
        schema,
        targets: enrichedTargets,
        transforms: TRANSFORMS_CATALOG,
        sugeridos,
        current_mapping: creds.field_mapping || {},
        mapped_preview,
        scraped,
        cpt: cptSchema,
      },
    });
  } catch (e) { next(e); }
};

// POST /api/woocommerce/auto-discover-cpts?projectId=X
const SYSTEM_TYPE_SLUGS = new Set([
  'post','page','attachment','nav_menu_item','wp_block','wp_template',
  'wp_template_part','wp_global_styles','wp_navigation','wp_font_family',
  'wp_font_face','elementor_library','elementor_snippet','e-floating-buttons',
  'rm_content_editor','product','product_variation','shop_order','shop_coupon',
]);

export const autoDiscoverCpts = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const creds = await model.getCreds(projectId);
    if (!creds) throw new AppError('Credenciales WC no configuradas', 400, 'NO_CREDS');
    if (!creds.wp_user || !creds.wp_app_password) {
      throw new AppError('Faltan wp_user y wp_app_password en las credenciales (necesarios para CPTs con ACF en context=edit)', 400, 'NO_WP_AUTH');
    }
    const baseUrl = creds.store_url.replace(/\/$/, '');
    const auth = 'Basic ' + Buffer.from(`${creds.wp_user}:${creds.wp_app_password}`).toString('base64');

    // 1) Lista de tipos del WP
    const typesRes = await fetch(`${baseUrl}/wp-json/wp/v2/types`, { headers: { Authorization: auth } });
    if (!typesRes.ok) throw new AppError(`WP types respondio ${typesRes.status}`, 502, 'WP_TYPES_ERROR');
    const types = await typesRes.json();

    const candidates = [];
    for (const [slug, info] of Object.entries(types)) {
      if (SYSTEM_TYPE_SLUGS.has(slug)) continue;
      const restBase = (info && info.rest_base) || slug;
      candidates.push({ slug, rest_base: restBase, name: info?.name || slug });
    }

    // 2) Para cada candidato, intentar fetch /wp-json/wp/v2/{rest_base}?per_page=1&context=edit
    const detected = [];
    for (const c of candidates) {
      try {
        const r = await fetch(`${baseUrl}/wp-json/wp/v2/${c.rest_base}?per_page=1&context=edit`, { headers: { Authorization: auth } });
        if (!r.ok) continue;
        const arr = await r.json();
        const item = Array.isArray(arr) && arr[0];
        if (!item) continue;
        const acf = item.acf && typeof item.acf === 'object' && !Array.isArray(item.acf) ? item.acf : null;
        const acfCount = acf ? Object.keys(acf).length : 0;
        if (acfCount > 0) {
          detected.push({
            slug: c.rest_base,
            name: c.name,
            sample_id: item.id,
            sample_title: (item.title && item.title.rendered) || c.name,
            acf_fields_count: acfCount,
            has_meta_link: false,
          });
        }
      } catch (_) { /* skip */ }
    }

    // 3) Comprobar si los productos WC vienen vinculados a CPTs via _cpt_sync_source_id
    let cptSyncEnabled = false;
    let metaCptLevels = new Set();
    try {
      const wcAuth = buildAuthQS(creds);
      const wpRes = await fetch(`${baseUrl}/wp-json/wc/v3/products?per_page=10&${wcAuth}`);
      if (wpRes.ok) {
        const wpProducts = await wpRes.json();
        for (const p of wpProducts) {
          const m = Array.isArray(p.meta_data) ? p.meta_data : [];
          const lvl = m.find((x) => x.key === '_cpt_sync_level')?.value;
          if (lvl) { cptSyncEnabled = true; metaCptLevels.add(lvl); }
        }
      }
    } catch (_) { /* ignore */ }

    // 3b) FALLBACK: si los productos WC declaran levels pero los CPTs no aparecen en /types
    const detectedSlugs = new Set(detected.map((d) => d.slug));
    for (const lvl of metaCptLevels) {
      if (detectedSlugs.has(lvl)) continue;
      try {
        const r = await fetch(`${baseUrl}/wp-json/wp/v2/${lvl}?per_page=1&context=edit`, { headers: { Authorization: auth } });
        if (!r.ok) continue;
        const arr = await r.json();
        const item = Array.isArray(arr) && arr[0];
        if (!item) continue;
        const acf = item.acf && typeof item.acf === 'object' && !Array.isArray(item.acf) ? item.acf : null;
        const acfCount = acf ? Object.keys(acf).length : 0;
        if (acfCount > 0) {
          detected.push({
            slug: lvl,
            name: lvl,
            sample_id: item.id,
            sample_title: (item.title && item.title.rendered) || lvl,
            acf_fields_count: acfCount,
            has_meta_link: true,
          });
        }
      } catch (_) { /* skip */ }
    }

    // 4) Si la WC tiene meta _cpt_sync_level, priorizamos esos slugs
    let recommendedSlugs = detected.map((d) => d.slug);
    if (cptSyncEnabled && metaCptLevels.size > 0) {
      const detectedSet = new Set(recommendedSlugs);
      recommendedSlugs = [...metaCptLevels].filter((s) => detectedSet.has(s));
      if (recommendedSlugs.length === 0) recommendedSlugs = detected.map((d) => d.slug);
    }

    // 5) Aplicar: si user marca apply=true, guardamos cpt_endpoints y source_strategy
    const apply = String(req.query.apply || req.body?.apply || '').toLowerCase() === 'true';
    let applied = false;
    if (apply && recommendedSlugs.length > 0) {
      await query(
        `UPDATE wc_credentials
         SET cpt_endpoints = $1::jsonb,
             source_strategy = 'wc_plus_cpt',
             updated_at = NOW()
         WHERE project_id = $2`,
        [JSON.stringify(recommendedSlugs), projectId]
      );
      applied = true;
    }

    res.json({
      success: true,
      data: {
        detected,
        cpt_sync_enabled: cptSyncEnabled,
        meta_cpt_levels: [...metaCptLevels],
        recommended_slugs: recommendedSlugs,
        applied,
      },
    });
  } catch (e) { next(e); }
};

// PUT /api/woocommerce/mapping?projectId=X - guarda el mapeo configurable
export const saveMapping = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const mapping = req.body?.field_mapping;
    if (!mapping || typeof mapping !== 'object') {
      throw new AppError('field_mapping debe ser un objeto', 400, 'VALIDATION_ERROR');
    }
    await query(
      `UPDATE wc_credentials SET field_mapping = $1, updated_at = NOW() WHERE project_id = $2`,
      [JSON.stringify(mapping), projectId]
    );
    res.json({ success: true, data: { field_mapping: mapping } });
  } catch (e) { next(e); }
};

// POST /api/woocommerce/scrape-preview?projectId=X
export const scrapePreview = async (req, res, next) => {
  try {
    const projectId = pid(req);
    const url = req.body?.url;
    if (!url || typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new AppError('url requerida (http/https)', 400, 'VALIDATION_ERROR');
    }
    const creds = await model.getCreds(projectId);
    if (!creds) throw new AppError('Configura primero WC creds del proyecto', 400, 'NO_CREDS');
    const keywords = creds.section_keywords || {};
    const strategy = creds.scrape_strategy || 'plain_text';
    const result = await scrapeProductPage(url, keywords, { strategy });
    res.json({ success: true, data: result });
  } catch (e) { next(e); }
};

// Detecta automaticamente el mapping inicial basado en el JSON de un producto WC
function autoSuggestWcMapping(item) {
  if (!item) return {};
  const sug = {
    nombre: 'name',
    descripcion: 'short_description',
    precio: 'price',
    sku: 'sku',
    url_info: 'permalink',
  };
  // Solo anadir si existen en el item
  return Object.fromEntries(
    Object.entries(sug).filter(([, path]) => item[path] !== undefined)
  );
}

// Aplica un field_mapping a un producto WC, devuelve objeto con valores resueltos
function applyWcFieldMapping(item, mapping) {
  const out = {};
  for (const [crmField, source] of Object.entries(mapping || {})) {
    const path = typeof source === 'string' ? source : source?.source;
    if (!path) continue;
    const v = resolvePath(item, path);
    if (v !== undefined && v !== null) out[crmField] = v;
  }
  return out;
}

// Resuelve un valor desde un mapping que puede apuntar a:
//   - path del item WC (ej "name", "regular_price")
//   - "scraper.url_used" -> scraped.url_used (link SEO page resuelto)
//   - "scraper.titulo" -> scraped.titulo (h1 de la SEO page)
//   - "scraper.imagen_og" -> scraped.imagen_og
//   - "scraper.sections.{key}" -> scraped.sections[key]
//   - "scraper.meta_box.{key}.text|value|iso_date" -> scraped.meta_box[key].xxx
// Extrae texto de un valor ACF: string, array (join \n), o dict (values join \n\n).
function acfTextValue(v) {
  if (v == null) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter(Boolean).join('\n');
  if (typeof v === 'object') {
    return Object.values(v).filter((x) => x && typeof x === 'string').join('\n\n') || undefined;
  }
  return String(v);
}

function resolveMappingPath(path, item, scraped, cpt) {
  if (!path || typeof path !== 'string') return undefined;
  if (path === 'scraper.url_used')     return scraped?.url_used;
  if (path === 'scraper.titulo')       return scraped?.titulo;
  if (path === 'scraper.imagen_og')    return scraped?.imagen_og;
  if (path === 'scraper.meta_description') return scraped?.meta_description;
  if (path.startsWith('scraper.sections.')) {
    const key = path.slice('scraper.sections.'.length);
    return scraped?.sections?.[key];
  }
  if (path.startsWith('scraper.meta_box.')) {
    const rest = path.slice('scraper.meta_box.'.length);
    const [key, attr = 'text'] = rest.split('.');
    return scraped?.meta_box?.[key]?.[attr];
  }
  // CPT ACF: paths como cpt.acf.horas, cpt.acf.objetivos, etc.
  if (path.startsWith('cpt.acf.')) {
    const key = path.slice('cpt.acf.'.length);
    return acfTextValue(cpt?.acf?.[key]);
  }
  if (path === 'cpt.title') return cpt?.title?.rendered || cpt?.title || undefined;
  if (path === 'cpt.link')  return cpt?.link || cpt?.permalink || undefined;
  return resolvePath(item, path);
}

function applyMappingWithScraper(item, scraped, mapping, cpt) {
  const out = {};
  for (const [crmField, source] of Object.entries(mapping || {})) {
    // El source puede ser:
    //  - string: una sola ruta. Resuelve normal.
    //  - string[]: lista de rutas. Las resuelve todas y las concatena con \n\n.
    //  - { source: ... }: forma legacy.
    let paths;
    if (Array.isArray(source)) paths = source;
    else if (typeof source === 'string') paths = [source];
    else if (source && typeof source === 'object') {
      paths = Array.isArray(source.source) ? source.source : (source.source ? [source.source] : []);
    } else continue;

    const values = paths
      .map((p) => resolveMappingPath(p, item, scraped, cpt))
      .filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (values.length === 0) continue;
    out[crmField] = values.length === 1 ? values[0] : values.map(String).join('\n\n');
  }
  return out;
}
