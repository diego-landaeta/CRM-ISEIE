// Adaptadores por tipo de conector. Cada adaptador sabe:
//   - fetchSample(config)  -> trae 1-3 items de muestra (para mapping visual)
//   - fetchAll(config)     -> trae TODOS los items (con paginacion)
// El mapping field_mapping y la importacion al CRM se hace en el service.

import { logger } from '../../shared/utils/logger.js';

// Helper: resuelve "a.b.c" sobre obj. Soporta:
//   - Notacion bracket: a.b[2].c
//   - Wildcard array: a.b[*].c -> devuelve array de valores
//   - meta_data search: meta_data{key=foo}.value (busca en array de objetos por key)
export function resolvePath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let acc = obj;
  for (const part of parts) {
    if (acc === undefined || acc === null) return undefined;

    // Wildcard [*] - itera sobre array
    if (part.endsWith('[*]')) {
      const key = part.slice(0, -3);
      const arr = key ? acc[key] : acc;
      if (!Array.isArray(arr)) return undefined;
      // El resto del path se aplica a cada item
      const restIdx = parts.indexOf(part) + 1;
      const restPath = parts.slice(restIdx).join('.');
      if (!restPath) return arr;
      return arr.map(item => resolvePath(item, restPath));
    }

    // meta_data{key=foo}.value - buscar en array por keypair
    const searchMatch = part.match(/^([^{]+)\{([^=]+)=([^}]+)\}$/);
    if (searchMatch) {
      const [, arrKey, searchKey, searchVal] = searchMatch;
      const arr = acc[arrKey];
      if (!Array.isArray(arr)) return undefined;
      acc = arr.find(item => String(item?.[searchKey]) === searchVal);
      continue;
    }

    // Bracket simple [N]
    const bracketMatch = part.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!bracketMatch) return undefined;
    let val = acc[bracketMatch[1]];
    if (bracketMatch[2] !== undefined && Array.isArray(val)) val = val[parseInt(bracketMatch[2])];
    acc = val;
  }
  return acc;
}

// Aplica una transformacion al valor extraido
// Transformaciones soportadas: trim, lowercase, uppercase, parseInt, parseFloat,
// stripHtml, slug, regex:patron -> captura el grupo 1
export function applyTransform(value, transform) {
  if (value === undefined || value === null) return value;
  if (!transform) return value;
  switch (transform) {
    case 'trim':       return String(value).trim();
    case 'lowercase':  return String(value).toLowerCase();
    case 'uppercase':  return String(value).toUpperCase();
    case 'parseInt':   return parseInt(value) || null;
    case 'parseFloat': return parseFloat(value) || null;
    case 'stripHtml':  return String(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    case 'slug':       return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    default:
      if (transform.startsWith('regex:')) {
        const re = new RegExp(transform.slice(6));
        const m = String(value).match(re);
        return m ? (m[1] ?? m[0]) : null;
      }
      return value;
  }
}

// Recorre recursivamente un objeto y devuelve todos los paths posibles con sus tipos
// Util para que el frontend muestre un tree-view del JSON sample
export function inspectSchema(obj, prefix = '', maxDepth = 5) {
  if (maxDepth <= 0 || obj === null || obj === undefined) return [];
  const paths = [];
  if (Array.isArray(obj)) {
    paths.push({ path: prefix || '$', type: 'array', length: obj.length, sample: obj[0] });
    if (obj.length > 0) {
      const itemPaths = inspectSchema(obj[0], `${prefix}[0]`, maxDepth - 1);
      paths.push(...itemPaths);
      // Wildcard alternativo mas util para mapping
      if (typeof obj[0] === 'object') {
        for (const key of Object.keys(obj[0] || {})) {
          paths.push({ path: `${prefix}[*].${key}`, type: 'wildcard', sample: obj[0][key] });
        }
      }
    }
    return paths;
  }
  if (typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj)) {
      const fullPath = prefix ? `${prefix}.${key}` : key;
      const type = Array.isArray(val) ? 'array' : typeof val;
      const sample = type === 'string' && val.length > 80 ? val.slice(0, 80) + '...' : val;
      paths.push({ path: fullPath, type, sample: type === 'object' || type === 'array' ? `<${type}>` : sample });
      if (type === 'object' || type === 'array') {
        paths.push(...inspectSchema(val, fullPath, maxDepth - 1));
      }
    }
    return paths;
  }
  return [{ path: prefix, type: typeof obj, sample: obj }];
}

// Adaptador WooCommerce - products o orders
async function wcRequest(config, endpoint, params = {}) {
  const base = config.base_url?.replace(/\/$/, '') || '';
  if (!base) throw new Error('config.base_url requerida');
  const qs = new URLSearchParams({
    consumer_key: config.consumer_key || '',
    consumer_secret: config.consumer_secret || '',
    ...params,
  });
  const url = `${base}/wp-json/wc/v3/${endpoint}?${qs}`;
  const r = await fetch(url, { headers: { 'User-Agent': 'CRM-ISEIE-Connector/1.0' } });
  if (!r.ok) throw new Error(`WC API ${r.status}: ${await r.text().catch(() => '')}`.slice(0, 300));
  return { items: await r.json(), total: parseInt(r.headers.get('x-wp-total') || '0') };
}

// Adaptador WP REST generico - custom post types con plugin ACF to REST API
async function wpRequest(config, endpoint, params = {}) {
  const base = config.base_url?.replace(/\/$/, '') || '';
  if (!base) throw new Error('config.base_url requerida');
  const qs = new URLSearchParams(params);
  const url = `${base}/wp-json/${endpoint}?${qs}`;
  const headers = { 'User-Agent': 'CRM-ISEIE-Connector/1.0' };
  // Auth: basic con application password si esta configurada
  if (config.wp_user && config.wp_app_password) {
    const token = Buffer.from(`${config.wp_user}:${config.wp_app_password}`).toString('base64');
    headers['Authorization'] = `Basic ${token}`;
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`WP API ${r.status}: ${await r.text().catch(() => '')}`.slice(0, 300));
  return { items: await r.json(), total: parseInt(r.headers.get('x-wp-total') || '0') };
}

// Adaptador generico para cualquier API REST/JSON
async function customRequest(config, params = {}) {
  if (!config.url) throw new Error('config.url requerida');
  const url = config.url + (config.url.includes('?') ? '&' : '?') + new URLSearchParams(params).toString();
  const headers = { 'User-Agent': 'CRM-ISEIE-Connector/1.0', ...(config.headers || {}) };
  if (config.bearer_token) headers['Authorization'] = `Bearer ${config.bearer_token}`;
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`API ${r.status}`);
  const data = await r.json();
  // Si la respuesta tiene un wrapper, extraerlo segun config.items_path
  const items = config.items_path ? resolvePath(data, config.items_path) : data;
  return { items: Array.isArray(items) ? items : [items], total: items?.length || 0 };
}

const PER_PAGE = 100;
const MAX_PAGES = 50;

async function fetchAllPagesWc(config, endpoint, extraParams = {}) {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { items } = await wcRequest(config, endpoint, { per_page: PER_PAGE, page, ...extraParams });
    if (!Array.isArray(items) || items.length === 0) break;
    all.push(...items);
    if (items.length < PER_PAGE) break;
  }
  return all;
}

export async function fetchSample(connector) {
  const { type, config } = connector;
  switch (type) {
    case 'woocommerce_products': {
      const { items, total } = await wcRequest(config, 'products', { per_page: 3 });
      return { items, total };
    }
    case 'woocommerce_orders': {
      const { items, total } = await wcRequest(config, 'orders', { per_page: 3 });
      return { items, total };
    }
    case 'wp_rest': {
      const endpoint = config.endpoint || 'wp/v2/posts';
      const { items, total } = await wpRequest(config, endpoint, { per_page: 3 });
      return { items, total };
    }
    case 'acf': {
      // ACF to REST API: requiere plugin instalado. Endpoint tipico /acf/v3/{post_type}/{id}
      const endpoint = config.endpoint || 'acf/v3/posts';
      const { items, total } = await wpRequest(config, endpoint, { per_page: 3 });
      return { items, total };
    }
    case 'custom_api': {
      const { items, total } = await customRequest(config);
      return { items: items.slice(0, 3), total };
    }
    default:
      throw new Error(`Tipo de conector desconocido: ${type}`);
  }
}

export async function fetchAll(connector) {
  const { type, config } = connector;
  switch (type) {
    case 'woocommerce_products':
      return fetchAllPagesWc(config, 'products');
    case 'woocommerce_orders':
      return fetchAllPagesWc(config, 'orders');
    case 'wp_rest':
    case 'acf': {
      const endpoint = config.endpoint || (type === 'acf' ? 'acf/v3/posts' : 'wp/v2/posts');
      const all = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const { items } = await wpRequest(config, endpoint, { per_page: PER_PAGE, page });
        if (!Array.isArray(items) || items.length === 0) break;
        all.push(...items);
        if (items.length < PER_PAGE) break;
      }
      return all;
    }
    case 'custom_api': {
      const { items } = await customRequest(config);
      return items;
    }
    default:
      throw new Error(`Tipo de conector desconocido: ${type}`);
  }
}
