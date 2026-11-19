/*
  CONECTAR UN CAMPUS CON UN CÓDIGO (#679), como local_certifex.

  Lo que antes eran seis pasos a mano (servicio, usuarios autorizados, token, pegar
  el token en Integraciones, crear la clave, pegar dirección y clave en el Moodle)
  queda en dos: instalar el plugin y pegar el código que da el CRM. El plugin crea
  su servicio y su token y se presenta aquí; el CRM comprueba que es un Moodle de
  verdad con el plugin, guarda la conexión y le devuelve su clave.
*/
import dns from 'node:dns/promises';
import net from 'node:net';
import { query } from '../../shared/config/db.js';
import { encrypt } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';
import { llamar, urlDelCampus } from '../../shared/services/moodle.client.js';
import * as integraciones from '../integrations/integrations.model.js';
import { emparejar, avisarDisponibilidad } from './consultas.plugin.js';

const sinBarra = (u) => urlDelCampus(u).replace(/^https?:\/\//i, '').toLowerCase();

/** ¿Dirección de la red interna? (loopback, privadas, enlace local, CGNAT, sin especificar). */
export function ipInterna(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith('::ffff:')) return ipInterna(x.slice(7));
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80');
  }
  return true;
}

/**
 * Antes de que el CRM llame a la dirección que trae el plugin: https y fuera de la red
 * interna, para que un código filtrado no sirva para sondear el servidor por dentro.
 * En local (`MOODLE_PERMITIR_RED_LOCAL=true`, nunca en producción) se acepta un Moodle en Docker.
 */
export async function sitioPermitido(sitio, { resolver = (h) => dns.lookup(h, { all: true }) } = {}) {
  const NO = { ok: false, error: 'La dirección del campus no es válida: tiene que ser https y pública.' };
  let u;
  try { u = new URL(String(sitio)); } catch { return NO; }
  if (u.username || u.password) return NO;
  const local = process.env.MOODLE_PERMITIR_RED_LOCAL === 'true' && process.env.NODE_ENV !== 'production';
  if (local) return /^https?:$/.test(u.protocol) ? { ok: true } : NO;
  if (u.protocol !== 'https:') return NO;
  try {
    const ips = await resolver(u.hostname);
    if (!ips.length || ips.some((d) => ipInterna(d.address))) return NO;
  } catch { return NO; }
  return { ok: true };
}

/** El Moodle que ya tiene conectado el campus, o null. */
export async function urlActual(projectId) {
  const { rows } = await query(
    `SELECT config_public->>'url' AS url FROM project_integrations WHERE project_id = $1 AND provider = 'moodle'`, [projectId]);
  return rows[0]?.url || null;
}

/** ¿Es el Moodle que dice ser, con el plugin, y el token vale? */
export async function comprobarMoodle(sitio, token, opciones = {}) {
  try {
    const info = await llamar({ url: sitio, token }, 'core_webservice_get_site_info', {}, opciones);
    const funciones = new Set((info?.functions || []).map((f) => f.name));
    if (!funciones.has('local_crm_enviar_mensaje')) {
      return { ok: false, error: 'El token no es del servicio CRM del plugin: vuelve a pulsar «Conectar» en el Moodle.' };
    }
    if (info?.siteurl && sinBarra(info.siteurl) !== sinBarra(sitio)) {
      return { ok: false, error: `La dirección no coincide con la del Moodle (${info.siteurl}).` };
    }
    return { ok: true, sitename: info?.sitename || null };
  } catch (err) {
    // El detalle, al registro; a quien conecta, un mensaje igual para todo (no da pistas de la red).
    logger.warn({ sitio, err: err?.message }, 'consultas/plugin: no se ha podido entrar en el campus al conectar');
    return { ok: false, error: 'El CRM no ha podido entrar en el campus con ese token. Comprueba que la dirección es la del Moodle y vuelve a pulsar «Conectar».' };
  }
}

/** Deja el campus conectado en Integraciones, con «Leer las consultas» encendido. */
export async function guardarIntegracion(projectId, sitio, token) {
  const { rows } = await query(
    `SELECT config_public FROM project_integrations WHERE project_id = $1 AND provider = 'moodle'`, [projectId]);
  const antes = rows[0]?.config_public || {};
  const enc = encrypt(token);
  await integraciones.upsert({
    projectId, provider: 'moodle', active: true,
    encrypted_value: enc.encrypted, iv: enc.iv, auth_tag: enc.authTag,
    config_public: {
      ...antes,
      url: urlDelCampus(sitio),
      consultas: true,
      consultas_desde: antes.consultas && antes.consultas_desde ? antes.consultas_desde : new Date().toISOString(),
      conectado_con_plugin: new Date().toISOString(),
    },
  });
}

/** Lo que pide el punto público: el emparejamiento con sus dependencias reales. */
export async function conectarCampus(datos) {
  const r = await emparejar(datos, { sitioPermitido, comprobar: comprobarMoodle, urlActual, guardarIntegracion });
  if (r.ok) {
    logger.info({ projectId: r.projectId, sitio: datos.sitio }, 'consultas/plugin: campus conectado con código');
    // Después de contestar al plugin (que aún está guardando su clave): la lista de «No disponible».
    setTimeout(() => avisarDisponibilidad([r.projectId]).catch(() => {}), 5000);
  }
  else logger.warn({ sitio: datos?.sitio, error: r.error }, 'consultas/plugin: conexión rechazada');
  return r;
}
