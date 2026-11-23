/**
 * El país de entrada de un prospecto (#221): la regla, en UN solo sitio.
 *
 * Manuel quiere medir prospectos y ventas por país y separar el retargeting de
 * Meta por país. Las webs de Psiko Aprende y Fono Aprende tienen un subdominio
 * por país (`cl.fonoaprende.com`, `mx.fonoaprende.com`…), así que el país sale
 * de la dirección por la que entró la persona y de una tabla de su campus:
 *
 *     projects.paises_por_subdominio = { "cl": "CL", "mx": "MX", "co": "CO", "pe": "PE" }
 *
 * prefijo de subdominio → código ISO 3166-1 de dos letras. Añadir un país es
 * añadir una línea a esa tabla desde la configuración del campus: ni código ni
 * despliegue. El nombre («Chile», «México») no se guarda: lo pone quien lo
 * enseña (`Intl.DisplayNames`), así que vale para cualquier país sin catálogo.
 *
 * LA REGLA
 *   · Se mira el host de la dirección de entrada, sin `www.`.
 *   · Si tiene subdominio (tres partes o más), su primera parte es el prefijo:
 *     `cl.fonoaprende.com` → `cl`; `www.cl.fonoaprende.com` → `cl`.
 *   · El dominio raíz (`fonoaprende.com`, `www.fonoaprende.com`) no tiene país.
 *   · Un prefijo que el campus no tiene en su tabla, tampoco: no se adivina.
 *   · Sin dirección, sin país. No se inventa.
 *
 * Lo usan el alta de un prospecto (`createLeadWithRoundRobin`, por donde pasan
 * TODAS las puertas: webhook, Make, formularios, alta manual, admisión) y el
 * guion que lo aplica hacia atrás (`scripts/rellenar-pais-origen.mjs`).
 */
import { hostDe } from './canal.js';

/** Valor del filtro para «los que no tienen país». */
export const SIN_PAIS = 'sin_pais';

const PREFIJO_VALIDO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CODIGO_VALIDO = /^[A-Z]{2}$/;

/** El prefijo de subdominio de una dirección: `cl` de `https://cl.fonoaprende.com/curso`. */
export function prefijoDeEntrada(url) {
  const host = hostDe(url);
  if (!host) return null;
  const partes = host.split('.');
  if (partes.length < 3) return null;          // dominio raíz: sin prefijo
  if (/^\d+$/.test(partes[partes.length - 1])) return null;   // una IP no es un subdominio
  return partes[0] || null;
}

/**
 * La tabla de un campus, limpia: claves en minúscula y códigos en mayúscula, y
 * fuera lo que no sea válido (`www` nunca cuenta). Acepta el JSON tal como
 * viene de la base, también `null` o un texto.
 */
export function normalizarMapa(mapa) {
  let m = mapa;
  if (typeof m === 'string') {
    try { m = JSON.parse(m); } catch { return {}; }
  }
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  const limpio = {};
  for (const [k, v] of Object.entries(m)) {
    const prefijo = String(k || '').trim().toLowerCase();
    const codigo = String(v || '').trim().toUpperCase();
    if (prefijo === 'www' || !PREFIJO_VALIDO.test(prefijo) || !CODIGO_VALIDO.test(codigo)) continue;
    limpio[prefijo] = codigo;
  }
  return limpio;
}

/** El código de país de una dirección según la tabla de su campus; null si no hay. */
export function deducirPais(url, mapa) {
  const prefijo = prefijoDeEntrada(url);
  if (!prefijo) return null;
  return normalizarMapa(mapa)[prefijo] || null;
}

/**
 * El país de un prospecto que entra ahora: la tabla de su campus y la dirección.
 *
 * `db` es el pool o el cliente de la transacción del alta. La tabla se lee con
 * `to_jsonb(p)` A PROPÓSITO: si la migración 279 aún no está en una base, la
 * columna no existe, la lectura da null y el alta sigue como siempre. Un error
 * aquí abortaría la transacción entera y perderíamos el prospecto.
 */
export async function paisDeEntrada(db, projectId, url) {
  if (!projectId || !url) return null;
  const { rows } = await db.query(
    `SELECT to_jsonb(p) -> 'paises_por_subdominio' AS mapa FROM projects p WHERE p.id = $1`,
    [projectId]
  );
  return deducirPais(url, rows[0]?.mapa);
}

/**
 * El filtro por país tal como llega de la pantalla: un código ISO (`CL`), o
 * `sin_pais`. Cualquier otra cosa, sin filtro.
 */
export function leerFiltroPais(valor) {
  if (typeof valor !== 'string') return null;
  const v = valor.trim();
  if (v === SIN_PAIS) return SIN_PAIS;
  const codigo = v.toUpperCase();
  return CODIGO_VALIDO.test(codigo) ? codigo : null;
}

/**
 * La expresión SQL del país de un prospecto, con `sin_pais` en vez de NULL para
 * que el filtro sea siempre `= $n` (un solo parámetro, también para «sin país»).
 *   sqlPaisDelLead('l')         → del prospecto con alias `l`
 *   sqlPaisDeLaVenta('c')       → del prospecto de la venta con alias `c`
 * Una venta sin prospecto (cliente cargado a mano) cuenta como «sin país».
 */
export const sqlPaisDelLead = (alias = 'l') => `COALESCE(${alias ? `${alias}.` : ''}pais_origen, '${SIN_PAIS}')`;
export const sqlPaisDeLaVenta = (alias = 'c') =>
  `COALESCE((SELECT lpais.pais_origen FROM leads lpais WHERE lpais.id = ${alias || 'conversions'}.lead_id), '${SIN_PAIS}')`;

/**
 * Aplicar la regla HACIA ATRÁS, sin tocar la base: recibe las filas y dice qué
 * cambiaría. Lo usa `scripts/rellenar-pais-origen.mjs`, que es quien lee y escribe.
 *
 *   · Solo rellena los que NO tienen país. Uno que ya lo tiene no se toca: por
 *     eso se puede pasar las veces que haga falta.
 *   · Prueba las direcciones de cada prospecto por orden (la de la ficha, la de
 *     su origen, la que mandó Make en el envío…) y se queda con la primera que
 *     da país.
 *   · No inventa: sin dirección, o sin tabla en su campus, o con un prefijo que
 *     la tabla no tiene, se queda como está y se cuenta aparte.
 *
 * `filas`: { lead_id, project_id, pais_origen, urls: [{ url, fuente }] }.
 * `mapas`: { [project_id]: tabla del campus }.
 * Devuelve { cambios: [{ lead_id, pais, fuente, url }], yaTenian, sinUrl, sinTabla, sinPais }.
 */
export function planearPaises(filas, mapas) {
  const cambios = [];
  let yaTenian = 0;
  let sinUrl = 0;
  let sinTabla = 0;
  let sinPais = 0;
  for (const f of filas) {
    if (f.pais_origen) { yaTenian += 1; continue; }
    const urls = (f.urls || []).filter((u) => u && typeof u.url === 'string' && u.url.trim());
    if (!urls.length) { sinUrl += 1; continue; }
    const mapa = normalizarMapa(mapas?.[f.project_id]);
    if (!Object.keys(mapa).length) { sinTabla += 1; continue; }
    const hit = urls.map((u) => ({ ...u, pais: deducirPais(u.url, mapa) })).find((u) => u.pais);
    if (!hit) { sinPais += 1; continue; }
    cambios.push({ lead_id: f.lead_id, pais: hit.pais, fuente: hit.fuente, url: hit.url });
  }
  return { cambios, yaTenian, sinUrl, sinTabla, sinPais };
}
