import { query } from '../../shared/config/db.js';
import { deducirCanal } from './canal.js';

/*
  LO QUE RELLENÓ EL PROSPECTO, PARA EL AVISO A SU GESTORA.

  Yosbely (ICTESS, 19/11/2026): el correo «Nuevo prospecto asignado» solo traía
  el nombre, el correo, el teléfono y el campus. Del lead 4851 no decía que
  preguntaba por el «Curso en Instrumentación Industrial» ni que había escrito
  «Precio», y todo eso ya estaba en el CRM: `producto_interes_id`, `notas`,
  `custom_fields`, `landing_url` y `lead_utms`. La gestora tenía que abrir la
  ficha para saber a quién iba a llamar.

  Aquí se resume la fila del lead en lo que una persona lee: el programa, su
  mensaje, la página desde la que escribió, por dónde entró y el resto de
  campos del formulario, sin las claves técnicas (IP, navegador, id del
  formulario…) ni lo que ya sale arriba (nombre, correo, teléfono, programa).
  Lo que no está no sale.
*/

/** Las columnas que hacen falta. Una fila por lead: `lead_utms` es única por `lead_id`. */
export async function cargarLeadParaElAviso(leadId) {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.email, l.telefono, l.notas, l.custom_fields, l.landing_url,
            l.whatsapp_usuario, pr.nombre AS programa,
            u.utm_source, u.utm_medium, u.canal_detectado, u.landing_url AS utm_landing_url, u.referrer
       FROM leads l
       LEFT JOIN products pr ON pr.id = l.producto_interes_id
       LEFT JOIN lead_utms u ON u.lead_id = l.id
      WHERE l.id = $1
      LIMIT 1`,
    [leadId],
  );
  return rows[0] || null;
}

// Quita tildes, pasa a minúsculas y deja solo letras y números separados por «_».
const clave = (k) => String(k || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const soloDigitos = (v) => String(v || '').replace(/\D/g, '');
const comparable = (v) => clave(v);

// Lo que pone Elementor, WordPress o el propio CRM y no ha escrito la persona.
const TECNICAS = new Set([
  'form_id', 'form_name', 'formulario', 'date', 'time', 'fecha', 'hora', 'remote_ip', 'ip', 'powered_by',
  'user_agent', 'useragent', 'page_url', 'url', 'landing', 'landing_url', 'pagina', 'page', 'referrer',
  'referer', 'page_title', 'post_id', 'queried_id', 'referer_title', 'fbclid', 'gclid', 'ttclid',
  'msclkid', 'wbraid', 'gbraid', 'fbp', 'fbc', 'recaptcha', 'g_recaptcha_response', 'honeypot', 'nonce',
  'token', 'origen', 'canal', 'fuente', 'source', 'porcentaje_resuelto', 'plan_pago_enviado',
  'venta_marcada', 'id', 'lead_id', 'project_id', 'proyecto', 'sku', 'producto_interes_id',
  'producto_interes_sku', 'responsable', 'responsable_id', 'responsable_email', 'responsable_nombre',
]);
const PREFIJOS_TECNICOS = ['utm_', 'acept', 'acepto', 'privacidad', 'politica', 'consent', 'gdpr', 'rgpd', 'terminos', 'terms', 'field_'];

// El campo de mensaje del formulario.
const MENSAJE = /(mensaje|message|comentario|consulta|pregunta|duda|deseas_saber|quieres_saber|observacion)/;

const NOMBRE_VACIO = /^(s\s*\/?\s*n|sn|sin nombre|-+)$/i;

function esFormularioWeb(cf) {
  return !!(cf && (cf.form_id || cf.form_name || cf['Powered by'] || cf.powered_by));
}

function bonita(k) {
  const s = String(k).trim();
  // «¿Qué deseas saber?» o «Número de teléfono» ya vienen escritas para leer.
  if (/\s/.test(s) || /[¿?]/.test(s)) return s;
  const t = s.replace(/[_-]+/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function valorLegible(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  if (Array.isArray(v)) {
    const partes = v.filter((x) => ['string', 'number'].includes(typeof x)).map((x) => String(x).trim()).filter(Boolean);
    return partes.length ? partes.join(', ') : null;
  }
  if (typeof v === 'object') {
    // Elementor a veces manda { value: … } por campo.
    if ('value' in v) return valorLegible(v.value);
    return null;
  }
  const s = String(v).trim();
  if (!s) return null;
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/** La dirección para leer: dominio y ruta, sin parámetros de seguimiento. Solo http(s). */
export function paginaLegible(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return `${u.origin}${u.pathname}`.replace(/\/$/, '') || null;
  } catch {
    return null;
  }
}

const PUBLICIDAD = {
  meta_ads: 'anuncio de Meta (Facebook o Instagram)',
  google_ads: 'anuncio de Google',
  tiktok_ads: 'anuncio de TikTok',
  chatgpt_ia: 'ChatGPT',
  organico: 'buscador (orgánico)',
  referido: 'enlace desde otra web',
};
const CANALES = new Set([...Object.keys(PUBLICIDAD), 'directo', 'whatsapp']);

function publicidadDe(fila, canal) {
  if (fila.canal_detectado && fila.canal_detectado !== 'directo') return PUBLICIDAD[fila.canal_detectado] || null;
  if (canal && CANALES.has(canal) && canal !== 'directo') return PUBLICIDAD[canal] || null;
  // Sin canal guardado (el alta por webhook no lo deduce): las UTM de la página.
  const url = fila.landing_url || fila.utm_landing_url;
  if (!url) return null;
  let utm = {};
  try {
    const p = new URL(url).searchParams;
    utm = { utm_source: p.get('utm_source'), utm_medium: p.get('utm_medium') };
  } catch { return null; }
  const c = deducirCanal({ ...utm, landing_url: url });
  return PUBLICIDAD[c] || null;
}

/**
 * Resume la fila del lead (la de `cargarLeadParaElAviso`) en lo que lee la gestora.
 *
 * @param {object} fila   el lead: nombre, email, telefono, notas, custom_fields, landing_url,
 *                        whatsapp_usuario, programa y lo de `lead_utms`
 * @param {string} [canal] por dónde lo dio de alta el CRM: 'formulario', 'webhook' o el canal de Make
 * @returns {{ programa, mensaje, pagina, entrada, campos: {etiqueta, valor}[], soloTelefono, porWhatsapp, sinNombre }}
 */
export function resumenParaElAviso(fila = {}, canal = null) {
  const f = fila || {};
  const cf = f.custom_fields && typeof f.custom_fields === 'object' && !Array.isArray(f.custom_fields) ? f.custom_fields : {};
  const programa = valorLegible(f.programa);
  const formulario = esFormularioWeb(cf) || canal === 'formulario';
  const porWhatsapp = canal === 'whatsapp' || f.canal_detectado === 'whatsapp'
    || String(f.utm_source || '').toLowerCase() === 'whatsapp' || !!f.whatsapp_usuario;

  // Su mensaje: las notas, o el campo de mensaje del formulario si no hay notas.
  let mensaje = valorLegible(f.notas);
  let claveMensaje = null;
  if (!mensaje) {
    const k = Object.keys(cf).find((x) => MENSAJE.test(clave(x)) && valorLegible(cf[x]));
    if (k) { mensaje = valorLegible(cf[k]); claveMensaje = k; }
  }

  // Lo que ya sale arriba no se repite abajo.
  const yaDichos = new Set([f.nombre, f.email, programa, mensaje].filter(Boolean).map(comparable));
  const telefonos = new Set([f.telefono, f.whatsapp_usuario].map(soloDigitos).filter((d) => d.length >= 6));

  const campos = [];
  const vistos = new Set();
  for (const [k, v] of Object.entries(cf)) {
    if (k === claveMensaje) continue;
    const ck = clave(k);
    if (!ck || k.startsWith('_') || TECNICAS.has(ck) || PREFIJOS_TECNICOS.some((p) => ck.startsWith(p))) continue;
    const valor = valorLegible(v);
    if (!valor) continue;
    const cv = comparable(valor);
    if (yaDichos.has(cv)) continue;
    const dig = soloDigitos(valor);
    // El mismo teléfono con o sin prefijo («Número de teléfono» de Elementor).
    if (dig.length >= 6 && [...telefonos].some((t) => t.endsWith(dig) || dig.endsWith(t))) continue;
    // Un campo de nombre, correo o programa que no repite el de arriba (otro
    // correo, otro curso) sí se enseña: es información nueva.
    const id = `${ck}=${cv}`;
    if (vistos.has(id)) continue;
    vistos.add(id);
    campos.push({ etiqueta: bonita(k), valor });
    if (campos.length >= 15) break;
  }

  const pagina = paginaLegible(f.landing_url) || paginaLegible(f.utm_landing_url);

  let base;
  if (formulario) {
    const nombreForm = valorLegible(cf.form_name);
    base = `Formulario de la web${nombreForm ? ` «${nombreForm}»` : ''}`;
  } else if (porWhatsapp) base = 'WhatsApp';
  else if (canal === 'webhook') base = 'Conexión de la web (webhook)';
  else if (canal === 'manual') base = 'Alta a mano en el CRM';
  else base = 'Make (alta automática)';
  const publicidad = publicidadDe(f, canal);
  const entrada = publicidad ? `${base} · ${publicidad}` : base;

  const sinCorreo = !valorLegible(f.email);
  const conTelefono = !!(valorLegible(f.telefono) || valorLegible(f.whatsapp_usuario));
  const soloTelefono = sinCorreo && conTelefono && !formulario && !pagina && !campos.length;

  return {
    programa,
    mensaje,
    pagina,
    entrada,
    campos,
    soloTelefono,
    porWhatsapp,
    sinNombre: !valorLegible(f.nombre) || NOMBRE_VACIO.test(String(f.nombre).trim()) || cf._sin_nombre === true,
  };
}

export default { cargarLeadParaElAviso, resumenParaElAviso, paginaLegible };
