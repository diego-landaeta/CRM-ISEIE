import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { enteroEnv } from './mcp.config.js';

/**
 * Enlaces externos de los cursos de Moodle (#335): cuales son, de que tipo y,
 * si se pide, si responden.
 *
 * COMPROBAR UN ENLACE ES HACER UNA PETICION A UNA DIRECCION QUE ESCRIBIO OTRA
 * PERSONA (un tutor, desde Moodle). Eso es la puerta clasica del SSRF: un enlace
 * a `http://169.254.169.254/` o a `http://localhost:5432/` haria que el servidor
 * del CRM pregunte por cosas que solo ve desde dentro. Por eso:
 *
 *   · solo http y https, y solo los puertos 80 y 443;
 *   · el nombre se resuelve ANTES y TODAS las direcciones tienen que ser
 *     publicas (nada de loopback, redes privadas, enlace local ni CGNAT);
 *   · NUNCA se sigue una redireccion sola: se sigue a mano, hasta 3 saltos, y
 *     cada salto pasa de nuevo por las mismas comprobaciones;
 *   · tiempo maximo corto por enlace, pocos a la vez y un tope de enlaces por
 *     peticion;
 *   · no se lee el cuerpo y no se mandan cookies ni cabeceras de sesion.
 *
 * Limite conocido: entre que se resuelve el nombre y que `fetch` se conecta hay
 * un instante en que un DNS malicioso podria cambiar la respuesta (rebinding).
 * Cierra del todo con una salida a Internet sin ruta a la red interna.
 */

// ─── Clasificar ───────────────────────────────────────────────────────────

const HOSTS = {
  youtube: /^(?:(?:www|m|music)\.)?youtube(?:-nocookie)?\.com$|^youtu\.be$/i,
  vimeo: /^(?:(?:www|player)\.)?vimeo\.com$/i,
  drive: /^(?:drive|docs|sheets|slides|forms)\.google\.com$|^drive\.usercontent\.google\.com$/i,
};

/** youtube | vimeo | drive | enlace, por el dominio. */
export function tipoDeEnlace(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return 'enlace';
  }
  for (const [tipo, re] of Object.entries(HOSTS)) if (re.test(host)) return tipo;
  return 'enlace';
}

/**
 * Las URLs http(s) que hay dentro de un trozo de HTML (la descripcion de un
 * modulo del curso: una etiqueta con un video incrustado, por ejemplo). Solo
 * `href` y `src`, sin repetidas.
 */
export function extraerUrls(html) {
  if (!html || typeof html !== 'string') return [];
  const vistas = new Set();
  const re = /\b(?:href|src)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const crudo = (m[1] || m[2]).replace(/&amp;/g, '&').trim();
    const url = crudo.startsWith('//') ? `https:${crudo}` : crudo;
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      vistas.add(new URL(url).href);
    } catch { /* una URL rota no es un recurso */ }
  }
  return [...vistas];
}

// ─── Direcciones que NO se tocan ──────────────────────────────────────────

function ipv4EsPrivada(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127
    || (a === 100 && b >= 64 && b <= 127) // CGNAT
    || (a === 169 && b === 254) // enlace local y metadatos de la nube
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0)
    || (a === 198 && (b === 18 || b === 19))
    || a >= 224 // multicast y reservadas
  );
}

/** true si la IP (v4 o v6) no es una direccion publica de Internet. */
export function esIpPrivada(ip) {
  const tipo = net.isIP(ip);
  if (tipo === 4) return ipv4EsPrivada(ip);
  if (tipo !== 6) return true; // lo que no es una IP valida, no se toca
  const s = ip.toLowerCase();
  // IPv4 metida en IPv6 (::ffff:127.0.0.1 o ::ffff:7f00:1).
  const mapeada = s.match(/^(?:0*:)*:?ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapeada) return ipv4EsPrivada(mapeada[1]);
  const hex = s.match(/^(?:0*:)*:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const n = (parseInt(hex[1], 16) << 16) | parseInt(hex[2], 16);
    return ipv4EsPrivada([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'));
  }
  return s === '::' || s === '::1'
    || /^f[cd]/.test(s) // fc00::/7
    || /^fe[89ab]/.test(s) // fe80::/10
    || /^ff/.test(s) // multicast
    || /^(?:0*:)+[0-9a-f]{1,4}$/.test(s); // ::algo (compatibles v4, descartadas)
}

const HOST_INTERNO = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|home\.arpa)$/i;

/** Pasa la URL por las reglas de arriba, resolviendo el nombre. Devuelve null si vale, o el motivo. */
export async function motivoDeBloqueo(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'no es una URL';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'solo se comprueban enlaces http y https';
  if (u.username || u.password) return 'lleva usuario y contraseña en la URL';
  if (u.port && u.port !== '80' && u.port !== '443') return 'puerto no permitido';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return esIpPrivada(host) ? 'dirección privada o local' : null;
  if (HOST_INTERNO.test(host) || !host.includes('.')) return 'nombre interno o local';
  let direcciones;
  try {
    direcciones = await lookup(host, { all: true });
  } catch {
    return 'no resuelve';
  }
  if (!direcciones.length) return 'no resuelve';
  if (direcciones.some((d) => esIpPrivada(d.address))) return 'resuelve a una dirección privada o local';
  return null;
}

// ─── Comprobar ────────────────────────────────────────────────────────────

export const limiteEnlaces = () => Math.min(enteroEnv('MCP_MOODLE_MAX_ENLACES', 30), 100);
export const timeoutEnlaceMs = () => enteroEnv('MCP_MOODLE_ENLACE_TIMEOUT_MS', 4000);
const MAX_SALTOS = 3;
const AGENTE = 'Mozilla/5.0 (compatible; CRM-ComprobadorDeEnlaces/1.0)';

/**
 * YouTube y Vimeo contestan 200 a un video borrado (la pagina existe); su
 * «oEmbed» contesta 404 si el video no esta. Son dos dominios fijos nuestros,
 * no una direccion de fuera.
 */
export function urlDeComprobacion(url, tipo) {
  const canonica = urlCanonica(url, tipo);
  if (tipo === 'youtube') return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(canonica)}`;
  if (tipo === 'vimeo') return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(canonica)}`;
  return url;
}

/**
 * La direccion «de ver» de un video, que es la unica que entiende el oEmbed.
 *
 * Moodle guarda los videos incrustados como `youtube.com/embed/ID` o
 * `player.vimeo.com/video/ID`, y el oEmbed contesta 404 a esas formas aunque el
 * video exista: probado contra el Moodle de Psiko, tres videos vivos salian como
 * «rotos». Se pasan a `watch?v=ID` / `vimeo.com/ID` antes de preguntar. Si la
 * direccion no encaja con ninguna forma conocida, se deja tal cual.
 */
export function urlCanonica(url, tipo) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  const host = u.hostname.replace(/^(www|m)\./, '');
  const partes = u.pathname.split('/').filter(Boolean);
  if (tipo === 'youtube') {
    if (host === 'youtu.be' && partes[0]) return `https://www.youtube.com/watch?v=${partes[0]}`;
    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (partes[0] === 'embed' && partes[1] === 'videoseries' && u.searchParams.get('list')) {
        return `https://www.youtube.com/playlist?list=${u.searchParams.get('list')}`;
      }
      if (['embed', 'v', 'shorts', 'live'].includes(partes[0]) && partes[1]) return `https://www.youtube.com/watch?v=${partes[1]}`;
    }
  }
  if (tipo === 'vimeo' && host === 'player.vimeo.com' && partes[0] === 'video' && /^\d+$/.test(partes[1] || '')) {
    const h = u.searchParams.get('h');
    return `https://vimeo.com/${partes[1]}${h ? `/${h}` : ''}`;
  }
  return url;
}

async function pedir(url, metodo) {
  const res = await fetch(url, {
    method: metodo,
    redirect: 'manual',
    credentials: 'omit',
    headers: { 'User-Agent': AGENTE, Accept: '*/*', ...(metodo === 'GET' ? { Range: 'bytes=0-0' } : {}) },
    signal: AbortSignal.timeout(timeoutEnlaceMs()),
  });
  // El cuerpo no interesa: se suelta sin leerlo.
  try { await res.body?.cancel(); } catch { /* ya estaba cerrado */ }
  return res;
}

/** El estado en palabras a partir del codigo HTTP final. */
function estadoDeStatus(status) {
  if (status >= 200 && status < 400) return 'ok';
  if (status === 404 || status === 410) return 'roto';
  if (status === 401 || status === 403 || status === 429) return 'restringido'; // existe, pero no deja mirar
  if (status >= 500) return 'error_servidor';
  return 'roto';
}

/**
 * ¿Responde este enlace? Devuelve {estado, http?, detalle?}.
 *
 *   ok · roto (404/410 o no resuelve) · restringido (401/403/429: existe pero
 *   pide acceso o no deja mirar, NO es lo mismo que roto) · error_servidor (5xx)
 *   · no_responde (tiempo agotado o conexion rechazada) · bloqueado (no se
 *   comprueba por seguridad: ver la cabecera) .
 */
export async function comprobarEnlace(url, tipo = tipoDeEnlace(url)) {
  let actual = urlDeComprobacion(url, tipo);
  for (let salto = 0; salto <= MAX_SALTOS; salto += 1) {
    const motivo = await motivoDeBloqueo(actual);
    if (motivo) {
      // Que no resuelva es un enlace roto de verdad; lo demas, un enlace que
      // no se mira.
      return motivo === 'no resuelve'
        ? { estado: 'roto', detalle: 'el dominio no existe' }
        : { estado: 'bloqueado', detalle: motivo };
    }
    let res;
    try {
      res = await pedir(actual, 'HEAD');
      // Muchos servidores no atienden HEAD: se repite con un GET de un byte.
      if ([400, 403, 405, 501].includes(res.status)) res = await pedir(actual, 'GET');
    } catch (err) {
      const tiempo = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { estado: 'no_responde', detalle: tiempo ? 'tiempo agotado' : 'conexión rechazada o fallida' };
    }
    if (res.status >= 300 && res.status < 400) {
      const destino = res.headers?.get?.('location');
      if (!destino) return { estado: 'ok', http: res.status };
      if (salto === MAX_SALTOS) return { estado: 'roto', http: res.status, detalle: 'demasiadas redirecciones' };
      try {
        actual = new URL(destino, actual).href;
      } catch {
        return { estado: 'roto', http: res.status, detalle: 'redirige a una URL no válida' };
      }
      continue;
    }
    return { estado: estadoDeStatus(res.status), http: res.status };
  }
  return { estado: 'roto', detalle: 'demasiadas redirecciones' };
}

/**
 * Corre `fn` sobre cada elemento con, como mucho, `limite` a la vez, y devuelve
 * los resultados en el mismo orden.
 */
export async function mapConLimite(items, limite, fn) {
  const salida = new Array(items.length);
  let siguiente = 0;
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente;
      siguiente += 1;
      salida[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limite, items.length)) }, trabajador));
  return salida;
}
