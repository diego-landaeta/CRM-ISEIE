import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { AppError } from '../../shared/utils/AppError.js';

/**
 * LOS ARCHIVOS DEL FORMULARIO DE ADMISIÓN (#198).
 *
 * Cada web manda los documentos (DNI por las dos caras, foto, título, firma) a su
 * manera, y el webhook acepta las tres (Diego, 01/10):
 *   · como archivo (multipart): en el envío ya mapeado llega como
 *     `{ __archivo: 'campo', nombre, tamano }` y se busca en los archivos;
 *   · como imagen en texto: `data:image/png;base64,…` (los campos de firma de
 *     Elementor), o el base64 sin el prefijo;
 *   · como URL de la imagen (Gravity y Elementor suelen mandar el enlace al archivo
 *     subido): el CRM lo descarga.
 *
 * Tipos: JPG, PNG, WEBP y PDF, hasta 10 MB, MIRANDO EL TIPO REAL del contenido, no
 * la extensión ni lo que diga quien lo manda.
 *
 * La URL la elige quien manda el formulario, así que solo se descargan direcciones
 * públicas: nada de 127.0.0.1, la red interna ni los metadatos de la nube. Si no, el
 * webhook serviría para que alguien de fuera leyera servidores internos.
 */

export const MAX_BYTES = 10 * 1024 * 1024;
// El envío entero (datos y documentos), POR DEBAJO de los 20 MB de Nginx (nginx/crm.conf;
// QA de Diego, 22/10): así lo rechaza la aplicación, que dice por qué, y no Nginx con su
// 413 mudo. Antes la aplicación aceptaba 25 MB en JSON y 8 archivos de 10 MB en multipart,
// y todo lo que pasaba de 20 MB se perdía sin explicación.
export const MAX_ENVIO_BYTES = 19 * 1024 * 1024;
// Sin datos durante este tiempo, se corta (el `timeout` del GET, que es de inactividad).
const TIEMPO_MAX_MS = 10_000;
// Y la descarga entera, con sus redirecciones, nunca pasa de este (QA de Diego, 22/10):
// con solo el de inactividad, un servidor que mandara un byte cada 9 s la tenía abierta
// horas, y cada redirección empezaba de cero.
const PLAZO_TOTAL_MS = 20_000;
const MAX_REDIRECCIONES = 3;

/** El tipo real por los primeros bytes: { ext, mime } o null si no es uno admitido. */
export function tipoReal(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' };
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  if (buffer.subarray(0, 4).toString('latin1') === '%PDF') return { ext: 'pdf', mime: 'application/pdf' };
  return null;
}

const rechazo = (motivo) => new AppError(motivo, 400, 'DOCUMENTO_NO_VALIDO');

function comprobado(buffer) {
  if (!buffer?.length) throw rechazo('El archivo está vacío.');
  if (buffer.length > MAX_BYTES) throw rechazo('El archivo pasa de 10 MB.');
  const tipo = tipoReal(buffer);
  if (!tipo) throw rechazo('No es un JPG, PNG, WEBP ni PDF.');
  return { buffer, ...tipo };
}

// ── Imagen en texto ───────────────────────────────────────────────────────────

const DATA_URI = /^data:[\w.+/-]+;base64,([\s\S]*)$/i;
const BASE64_PURO = /^[A-Za-z0-9+/\s]+=*\s*$/;

/** El base64 de un `data:…;base64,` o sin prefijo; null si el texto no lo es. */
function desdeTexto(texto) {
  const m = DATA_URI.exec(texto);
  const b64 = m ? m[1] : (texto.length >= 100 && BASE64_PURO.test(texto) ? texto : null);
  if (b64 === null) return null;
  // Antes de decodificar: 10 MB son ~13,4 M caracteres en base64.
  if (b64.length > Math.ceil(MAX_BYTES / 3) * 4 + 64) throw rechazo('El archivo pasa de 10 MB.');
  return Buffer.from(b64.replace(/\s/g, ''), 'base64');
}

// ── URL ───────────────────────────────────────────────────────────────────────

/**
 * Las direcciones a las que no se descarga nunca: la red interna, el propio
 * equipo, los metadatos de la nube y los rangos reservados. Con `BlockList` y no
 * comparando texto: una IPv4 escrita como IPv6 (`::ffff:7f00:1` es 127.0.0.1, y
 * así la escribe el navegador) se colaba por la comprobación anterior.
 */
const PROHIBIDAS = new net.BlockList();
for (const [ip, mascara] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) PROHIBIDAS.addSubnet(ip, mascara, 'ipv4');
for (const [ip, mascara] of [
  ['::', 127], // :: y ::1
  ['::', 96], // IPv4 «compatible» (::7f00:1)
  ['64:ff9b::', 96], ['64:ff9b:1::', 48], // NAT64: una IPv4 dentro
  ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], // reservadas, Teredo, 6to4
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
]) PROHIBIDAS.addSubnet(ip, mascara, 'ipv6');

/** ¿Es una dirección de la red interna, del propio equipo o de servicio? */
export function ipPrivada(ip) {
  const familia = net.isIP(ip);
  if (!familia) return true; // lo que no es una IP no se da por buena
  // Las IPv4 escritas como IPv6 (::ffff:a.b.c.d) las compara BlockList con las reglas IPv4.
  return PROHIBIDAS.check(ip, familia === 4 ? 'ipv4' : 'ipv6');
}

/** La URL, si es http(s) y su servidor escrito como IP no es interno. */
function urlValida(url) {
  let u;
  try { u = new URL(url); } catch { throw rechazo('La dirección del archivo no es válida.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw rechazo('La dirección del archivo tiene que ser http o https.');
  return u;
}

/**
 * Resolver el nombre Y conectar a esa misma IP. Antes se resolvía para comprobar
 * y `fetch` volvía a resolver al conectar: un dominio preparado podía contestar
 * una IP pública la primera vez y 127.0.0.1 la segunda.
 */
const resolverPublica = (permitirRedLocal) => (hostname, opciones, listo) => {
  dns.lookup(hostname, { all: true }, (err, direcciones) => {
    if (err || !direcciones?.length) return listo(rechazo('No se encuentra el servidor del archivo.'));
    if (!permitirRedLocal && direcciones.some((d) => ipPrivada(d.address))) return listo(rechazo('La dirección del archivo no es pública.'));
    if (opciones?.all) return listo(null, direcciones);
    return listo(null, direcciones[0].address, direcciones[0].family);
  });
};

/**
 * Un GET, sin seguir redirecciones: { status, location, cuerpo } (el cuerpo, ya leído
 * con su tope). `fin`: la hora (ms) a la que se corta, pase lo que pase.
 */
function pedir(u, permitirRedLocal, fin) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !permitirRedLocal && ipPrivada(host)) return Promise.reject(rechazo('La dirección del archivo no es pública.'));
  const cliente = u.protocol === 'https:' ? https : http;
  return new Promise((resolver, rechazar) => {
    let reloj;
    const ok = (v) => { clearTimeout(reloj); resolver(v); };
    const mal = (e) => { clearTimeout(reloj); rechazar(e); };
    const req = cliente.get(u, { lookup: resolverPublica(permitirRedLocal), timeout: TIEMPO_MAX_MS, headers: { 'User-Agent': 'CRM-Admision/1.0' } }, (res) => {
      const status = res.statusCode || 0;
      // De una redirección o un error no hace falta el cuerpo: se corta. Leerlo hasta el
      // final (`resume`) dejaba la conexión abierta sin plazo si el servidor no acababa nunca.
      if (status >= 300 && status < 400) { ok({ status, location: res.headers.location }); return req.destroy(); }
      if (status < 200 || status >= 300) { ok({ status }); return req.destroy(); }
      if (Number(res.headers['content-length']) > MAX_BYTES) { res.destroy(); return mal(rechazo('El archivo pasa de 10 MB.')); }
      const partes = [];
      let total = 0;
      res.on('data', (parte) => {
        total += parte.length;
        if (total > MAX_BYTES) { res.destroy(); mal(rechazo('El archivo pasa de 10 MB.')); return; }
        partes.push(parte);
      });
      res.on('end', () => ok({ status, cuerpo: Buffer.concat(partes) }));
      res.on('error', () => mal(rechazo('No se ha podido descargar el archivo.')));
    });
    req.on('timeout', () => req.destroy(rechazo('No se ha podido descargar el archivo.')));
    req.on('error', (err) => mal(err?.isOperational ? err : rechazo('No se ha podido descargar el archivo.')));
    // Primero el motivo y luego cortar: al cortar llegan otros errores, y la promesa ya está resuelta.
    reloj = setTimeout(() => { mal(rechazo('El archivo tarda demasiado en descargarse.')); req.destroy(); }, Math.max(0, fin - Date.now()));
  });
}

/**
 * Descarga un archivo de una URL pública. `opciones.permitirRedLocal` y
 * `opciones.plazoMs` son para las pruebas (un servidor en 127.0.0.1, y no esperar 20 s).
 */
export async function desdeUrl(url, { permitirRedLocal = false, plazoMs = PLAZO_TOTAL_MS } = {}) {
  let actual = urlValida(url);
  const fin = Date.now() + plazoMs;
  for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
    const res = await pedir(actual, permitirRedLocal, fin);
    if (res.status >= 300 && res.status < 400 && res.location) {
      // Cada salto se vuelve a comprobar: una dirección pública puede redirigir a una interna.
      actual = urlValida(new URL(res.location, actual).toString());
      continue;
    }
    if (res.status < 200 || res.status >= 300) throw rechazo(`El servidor del archivo contestó ${res.status}.`);
    return res.cuerpo;
  }
  throw rechazo('Demasiadas redirecciones al descargar el archivo.');
}

// ── Lo que llegue ─────────────────────────────────────────────────────────────

/** Un archivo del envío, venga como venga. Lanza AppError con el motivo si no vale. */
export async function obtenerArchivo(valor, archivos = [], opciones = {}) {
  // Gravity manda a veces una lista de URLs: vale el primero.
  const v = Array.isArray(valor) ? valor.find((x) => x != null && x !== '') : valor;
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.__archivo) {
    const f = (Number.isInteger(v.__indice) && archivos[v.__indice]?.fieldname === v.__archivo)
      ? archivos[v.__indice] : archivos.find((a) => a.fieldname === v.__archivo);
    if (!f) throw rechazo('No ha llegado el archivo.');
    return comprobado(f.buffer);
  }
  if (typeof v !== 'string') throw rechazo('No es un archivo, una URL ni una imagen en texto.');
  const texto = v.trim();
  // El nombre de un campo de archivo del multipart (mapeado a «campo.__archivo», o a mano).
  const delCampo = archivos.find((a) => a.fieldname === texto);
  if (delCampo) return comprobado(delCampo.buffer);
  if (/^https?:\/\//i.test(texto)) return comprobado(await desdeUrl(texto, opciones));
  const buffer = desdeTexto(texto);
  if (!buffer) throw rechazo('No es un archivo, una URL ni una imagen en texto.');
  return comprobado(buffer);
}

/**
 * El envío para mapear y guardar: los campos de texto tal cual y, por cada archivo
 * del multipart, una marca `{ __archivo, nombre, tamano }` en su campo. Así el modo
 * escucha los enseña y se pueden mapear igual que el resto.
 */
export function conArchivos(body, archivos = []) {
  const out = { ...(body || {}) };
  const porCampo = new Map();
  archivos.forEach((f, i) => {
    const marca = { __archivo: f.fieldname, __indice: i, nombre: f.originalname || null, tamano: f.size ?? f.buffer?.length ?? null };
    porCampo.set(f.fieldname, [...(porCampo.get(f.fieldname) || []), marca]);
  });
  // Varios archivos con el mismo nombre (`fotos[]`): una lista, y vale el primero.
  for (const [campo, marcas] of porCampo) out[campo] = marcas.length === 1 ? marcas[0] : marcas;
  return out;
}
