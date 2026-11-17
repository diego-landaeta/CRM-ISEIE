import * as model from './salud.model.js';
import { recordTestResult } from './integrations.model.js';
import { PROBAR } from './integrations.controller.js';
import { decrypt } from '../../shared/utils/crypto.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * LA SALUD DE LAS CONEXIONES DE CADA CAMPUS (CRM#533).
 *
 * Manuel (29/10): «saber de un vistazo qué conexión de cada campus está caída o
 * tiene el token caducado, antes de que falle algo sin que nadie se entere». El
 * caso real: el token de Moodle de FONO no valía y no se supo hasta #335.
 *
 * Una fila por campus y una casilla por conexión. Cada casilla dice:
 *
 *   estado       bien · atencion · caida · sin_datos · sin_configurar (los
 *                mismos que el panel de Estado, `status/piezas.service.js`)
 *   resumen      una frase
 *   ultimaSenal  la última vez que esa conexión hizo su trabajo DE VERDAD
 *   motivo       el error concreto, si falla (token caducado, HTTP 401…)
 *
 * DOS VELOCIDADES, A PROPÓSITO:
 *
 *   · Ver (`saludDeLosCampus`) solo lee la base: rastros que las integraciones
 *     ya dejaban (la sincronización de Stripe, las importaciones de WooCommerce,
 *     el sync de Meta, el último uso de cada webhook…) y el resultado de la
 *     última prueba. Ni una llamada a fuera: abrir la pantalla no cuesta nada.
 *
 *   · Comprobar (`comprobarAhora`) sí llama a Stripe, Brevo, Moodle y la tienda,
 *     con las MISMAS pruebas de «Probar conexión» (`PROBAR`), y apunta lo que
 *     contestan en `last_test_*` (como el botón de cada tarjeta) y en
 *     `conexiones_salud` (con la última vez que fue bien). Con freno: lo
 *     comprobado hace menos de un minuto no se vuelve a pedir.
 *
 * NUNCA SALE UNA CLAVE. Se descifran para saber si se pueden descifrar y para
 * probarlas; a la respuesta solo llega un sí o un no. Los motivos pasan por
 * `limpiarMotivo`, que tapa cualquier cosa con forma de clave o de correo.
 */

export const CONEXIONES = [
  { clave: 'stripe', titulo: 'Stripe' },
  { clave: 'moodle', titulo: 'Moodle' },
  { clave: 'woocommerce', titulo: 'WooCommerce' },
  { clave: 'brevo', titulo: 'Brevo' },
  { clave: 'meta', titulo: 'Meta Ads' },
  { clave: 'admision', titulo: 'Webhook de admisión' },
  { clave: 'transferencias', titulo: 'Webhook de transferencias' },
];

/** El peor manda: si algo está caído, la fila no puede decir que todo va bien. */
export const GRAVEDAD = { bien: 0, sin_configurar: 0, sin_datos: 1, atencion: 2, caida: 3 };

/** Lo comprobado hace menos de esto no se vuelve a pedir (dos clics seguidos, dos pestañas). */
export const CADENCIA_MS = 60 * 1000;
/** Ninguna prueba espera más: un proveedor colgado no cuelga la pantalla. */
export const TOPE_MS = 10 * 1000;
/** Cuántos campus se comprueban a la vez. */
const A_LA_VEZ = 6;

// ─── Utilidades ──────────────────────────────────────────────────────────────

const iso = (v) => (v ? new Date(v).toISOString() : null);
const ms = (v) => (v ? new Date(v).getTime() : null);
const horasDesde = (v, ahora) => (v ? (ahora - new Date(v).getTime()) / 3600000 : null);

/** La más reciente de varias fechas (las nulas no cuentan). */
export function masReciente(...fechas) {
  const validas = fechas.filter(Boolean).map((f) => new Date(f)).filter((d) => !Number.isNaN(d.getTime()));
  if (!validas.length) return null;
  return new Date(Math.max(...validas.map((d) => d.getTime()))).toISOString();
}

/** «hace 5 min», «hace 3 h», «hace 2 días». */
export function hace(fecha, ahora = Date.now()) {
  const h = horasDesde(fecha, ahora);
  if (h === null) return 'nunca';
  const min = Math.max(0, Math.round(h * 60));
  if (min < 60) return `hace ${min} min`;
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/**
 * El motivo de un fallo, sin nada que no deba verse: claves de Stripe, secretos
 * de webhook, claves de WooCommerce, tokens en una URL, cabeceras y correos.
 * Los mensajes de Stripe, Moodle o la tienda no deberían traerlos, pero el motivo
 * viene de fuera y esta pantalla no puede fiarse.
 */
export function limpiarMotivo(texto) {
  if (texto == null || texto === '') return null;
  return String(texto)
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]+/g, '[clave]')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, '[secreto]')
    .replace(/\b(ck|cs)_[A-Za-z0-9]{16,}/g, '[clave]')
    .replace(/\b(xkeysib|xsmtpsib)-[A-Za-z0-9-]+/g, '[clave]')
    .replace(/((?:ws)?token|consumer_key|consumer_secret|api[-_]?key|access_token|password|secret)=([^&\s"']+)/gi, '$1=[oculto]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [oculto]')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]')
    .slice(0, 300);
}

/** ¿Se puede descifrar? Sin devolver el valor. */
export function sePuedeDescifrar(cifrado, iv, tag) {
  if (!cifrado || !iv || !tag) return false;
  try { decrypt(cifrado, iv, tag); return true; } catch { return false; }
}

/**
 * La última prueba de una conexión: la de su tarjeta (`last_test_*`) o la de
 * «Comprobar ahora» (`conexiones_salud`), la más reciente. Con la última buena,
 * que solo sabe `conexiones_salud`.
 */
export function ultimaPrueba(integ, comprobacion) {
  const deLaTarjeta = integ?.last_test_at && integ.last_test_status
    ? { ok: integ.last_test_status === 'success', mensaje: integ.last_test_message, at: iso(integ.last_test_at) }
    : null;
  const delPanel = comprobacion
    ? { ok: comprobacion.ok === true, mensaje: comprobacion.mensaje, at: iso(comprobacion.comprobado_at) }
    : null;
  const prueba = !deLaTarjeta ? delPanel : !delPanel ? deLaTarjeta
    : ms(delPanel.at) >= ms(deLaTarjeta.at) ? delPanel : deLaTarjeta;
  if (!prueba) return null;
  const ultimoOk = masReciente(comprobacion?.ultimo_ok_at, deLaTarjeta?.ok ? deLaTarjeta.at : null, prueba.ok ? prueba.at : null);
  return { ...prueba, ultimoOk };
}

function casilla(estado, resumen, extra = {}) {
  return {
    estado,
    resumen,
    ultimaSenal: extra.ultimaSenal ?? null,
    queSenal: extra.queSenal ?? null,
    motivo: limpiarMotivo(extra.motivo),
    comprobado: extra.comprobado ?? null,
    ...(extra.datos ? { datos: extra.datos } : {}),
  };
}

// ─── Cada conexión ───────────────────────────────────────────────────────────

/**
 * El webhook de Stripe del CRM (`/api/stripe-webhook/<campus>`).
 *
 * Hoy existen en Stripe pero DESACTIVADOS (16/11): hasta que se encienda, lo
 * normal es que no llegue nada, y eso no es un fallo — los cobros entran por el
 * sondeo cada cinco minutos. Por eso no pinta la casilla de rojo: se dice.
 * Lo que sí la pone en ámbar es que llegue un aviso y se rechace.
 */
export function evaluarWebhookStripe({ secreto, recepcion }, ahora = Date.now()) {
  const ultimoAviso = iso(recepcion?.ultimo_at);
  const ultimoAceptado = iso(recepcion?.ultimo_aceptado_at);
  const base = { ultimoAviso, ultimoAceptado };
  if (secreto === 'no_descifrable') {
    return { ...base, estado: 'no_descifrable', grave: true, texto: 'El secreto del webhook no se puede descifrar: si Stripe avisa, se rechazará. Vuelve a pegarlo en Integraciones.' };
  }
  if (recepcion && recepcion.resultado !== 'aceptado' && horasDesde(recepcion.ultimo_at, ahora) < 24 * 7) {
    return { ...base, estado: 'rechazado', grave: true, texto: `El último aviso (${hace(recepcion.ultimo_at, ahora)}) se rechazó: ${recepcion.motivo || 'sin motivo'}.` };
  }
  if (secreto === 'sin') {
    return { ...base, estado: 'sin_secreto', grave: false, texto: 'Webhook sin secreto: si Stripe avisa, se rechaza. Los cobros entran igual por el sondeo cada 5 min.' };
  }
  if (!ultimoAceptado) {
    return { ...base, estado: 'desactivado', grave: false, texto: 'Webhook desactivado: no ha llegado ningún aviso. Los cobros entran por el sondeo cada 5 min.' };
  }
  if (horasDesde(ultimoAceptado, ahora) > 72) {
    return { ...base, estado: 'desactivado', grave: false, texto: `Webhook desactivado o sin avisos desde ${hace(ultimoAceptado, ahora)}. Los cobros entran por el sondeo.` };
  }
  return { ...base, estado: 'activo', grave: false, texto: `Webhook activo: último aviso ${hace(ultimoAceptado, ahora)}.` };
}

export function evaluarStripe({ integ, descifrable, secreto, sync, recepcion, comprobacion }, ahora = Date.now()) {
  const tieneClave = !!integ?.encrypted_value;
  const webhook = evaluarWebhookStripe({ secreto, recepcion }, ahora);
  const datos = { ultimoCargo: iso(sync?.ultimo_cobro), webhook };
  if (!tieneClave) {
    if (recepcion) {
      return casilla('atencion', 'Llegan avisos de Stripe pero el campus no tiene clave', {
        ultimaSenal: iso(recepcion.ultimo_at), queSenal: 'Último aviso', motivo: recepcion.motivo, datos,
      });
    }
    return casilla('sin_configurar', 'Sin clave de Stripe', { datos });
  }
  const prueba = ultimaPrueba(integ, comprobacion);
  const ultimaSenal = masReciente(sync?.last_sync_at, prueba?.ultimoOk);
  const comun = { ultimaSenal, queSenal: 'Última sincronización o prueba buena', comprobado: prueba?.at ?? null, datos };

  if (!descifrable) {
    return casilla('caida', 'La clave guardada no se puede descifrar', { ...comun, motivo: 'Hay que volver a pegarla en Integraciones (¿ha cambiado ENCRYPTION_KEY?).' });
  }
  if (integ.active === false) {
    return casilla('atencion', 'Clave guardada pero apagada: el sondeo no la usa', comun);
  }
  let r;
  const h = horasDesde(sync?.last_sync_at, ahora);
  if (sync?.last_error) {
    r = casilla('caida', 'La sincronización de cobros falla', { ...comun, motivo: sync.last_error });
  } else if (prueba && !prueba.ok && !(ms(sync?.last_sync_at) > ms(prueba.at))) {
    r = casilla('caida', 'La última prueba de la clave falló', { ...comun, motivo: prueba.mensaje });
  } else if (h === null) {
    r = casilla('sin_datos', 'Clave guardada, sin sincronizar todavía', comun);
  } else if (h > 2) {
    // El sondeo corre cada 5 minutos: dos horas sin nada ya no es un parpadeo.
    r = casilla('atencion', `Sin sincronizar desde ${hace(sync.last_sync_at, ahora)}`, comun);
  } else {
    const cargo = sync?.ultimo_cobro ? `último cargo ${hace(sync.ultimo_cobro, ahora)}` : 'sin cargos todavía';
    r = casilla('bien', `Cobros al día (${cargo})`, comun);
  }
  if (webhook.grave && r.estado === 'bien') {
    r = { ...r, estado: 'atencion', motivo: limpiarMotivo(webhook.texto) };
  }
  return r;
}

function moodleDeIntegraciones({ integ, descifrable, plugin, comprobacion }, ahora) {
  if (!integ && !plugin) return casilla('sin_configurar', 'Campus sin conectar');
  const datos = plugin ? { plugin: { activo: plugin.activo !== false, version: plugin.version_plugin || null, ultimoAviso: iso(plugin.ultimo_aviso_at) } } : undefined;
  if (!integ?.encrypted_value) {
    return casilla(plugin ? 'atencion' : 'sin_configurar', 'Falta el token del campus', {
      ultimaSenal: masReciente(plugin?.ultimo_aviso_at, plugin?.sincronizado_at), queSenal: 'Último aviso del plugin', datos,
    });
  }
  const prueba = ultimaPrueba(integ, comprobacion);
  const comun = {
    ultimaSenal: masReciente(prueba?.ultimoOk, plugin?.ultimo_aviso_at, plugin?.sincronizado_at),
    queSenal: 'Última prueba buena o aviso del plugin',
    comprobado: prueba?.at ?? null,
    datos,
  };
  if (!descifrable) {
    return casilla('caida', 'El token guardado no se puede descifrar', { ...comun, motivo: 'Hay que volver a pegarlo en Integraciones (¿ha cambiado ENCRYPTION_KEY?).' });
  }
  if (prueba && !prueba.ok) return casilla('caida', 'No conecta con el campus', { ...comun, motivo: prueba.mensaje });
  if (plugin?.sincronizacion_error) {
    return casilla('atencion', 'El repaso del plugin falla', { ...comun, motivo: plugin.sincronizacion_error });
  }
  if (!prueba) return casilla('sin_datos', 'Token guardado, sin probar', comun);
  const conPlugin = plugin && plugin.activo !== false ? ` · plugin ${plugin.version_plugin || 'activo'}` : '';
  return casilla('bien', `Conectado (probado ${hace(prueba.at, ahora)})${conPlugin}`, comun);
}

/**
 * Una clave de Configuración › Claves (`api_credentials`): si se puede leer y
 * qué contestó la última vez que se comprobó desde aquí. Su «Probar» de allí
 * solo mira que se descifre, así que no cuenta como prueba.
 */
export function parteDeClave({ descifrable, comprobacion }, que, ahora = Date.now()) {
  const prueba = ultimaPrueba(null, comprobacion);
  if (!descifrable) {
    return { estado: 'caida', resumen: `${que}: no se puede leer`, motivo: 'Hay que volver a guardarla en Configuración › Claves (¿ha cambiado ENCRYPTION_KEY o le falta algún dato?).', prueba };
  }
  if (prueba && !prueba.ok) return { estado: 'caida', resumen: `${que}: no conecta`, motivo: prueba.mensaje, prueba };
  if (!prueba) return { estado: 'sin_datos', resumen: `${que}: guardada, sin probar`, motivo: null, prueba };
  return { estado: 'bien', resumen: `${que}: conecta (probada ${hace(prueba.at, ahora)})`, motivo: null, prueba };
}

/** La casilla de una conexión junto con su clave de Configuración › Claves: manda la peor. */
export function conClaveDeClaves(base, parte, que) {
  if (!parte) return base;
  const sinBase = base.estado === 'sin_configurar';
  const pesaMas = sinBase || (GRAVEDAD[parte.estado] ?? 0) > (GRAVEDAD[base.estado] ?? 0);
  let motivo = base.motivo;
  if (sinBase) motivo = parte.motivo;
  else if (pesaMas && parte.motivo) motivo = `${que}: ${parte.motivo}`;
  return {
    ...base,
    estado: pesaMas ? parte.estado : base.estado,
    resumen: sinBase ? parte.resumen : `${base.resumen} · ${parte.resumen}`,
    motivo: limpiarMotivo(motivo),
    ultimaSenal: masReciente(base.ultimaSenal, parte.prueba?.ultimoOk),
    queSenal: base.queSenal || 'Última prueba buena',
    comprobado: masReciente(base.comprobado, parte.prueba?.at),
  };
}

/**
 * Moodle tiene DOS sitios donde guardar su token, y los dos se usan: el de
 * Integraciones (tutoras, consultas, el plugin) y el de Configuración › Claves
 * que lee el MCP (#335 — ahí estaba el de FONO que no valía). Se miran los dos.
 */
export function evaluarMoodle({ integ, descifrable, plugin, comprobacion, mcp = null }, ahora = Date.now()) {
  const base = moodleDeIntegraciones({ integ, descifrable, plugin, comprobacion }, ahora);
  return conClaveDeClaves(base, mcp ? parteDeClave(mcp, 'Clave del MCP', ahora) : null, 'Clave del MCP');
}

export function evaluarWooCommerce({ wc, comprobacion }, ahora = Date.now()) {
  if (!wc) return casilla('sin_configurar', 'Sin tienda conectada');
  const comun = {
    ultimaSenal: masReciente(wc.ultimo_run_ok, wc.last_sync_at, wc.pedidos_at, comprobacion?.ultimo_ok_at),
    queSenal: 'Última importación o comprobación buena',
    comprobado: iso(comprobacion?.comprobado_at),
  };
  if (wc.active === false) return casilla('atencion', 'Tienda conectada pero apagada', comun);
  const runAt = masReciente(wc.run_fin, wc.run_inicio);
  const comprobacionMasNueva = comprobacion && ms(comprobacion.comprobado_at) > (ms(runAt) || 0);
  if (comprobacion && !comprobacion.ok && comprobacionMasNueva) {
    return casilla('caida', 'La tienda no contesta', { ...comun, motivo: comprobacion.mensaje });
  }
  if (wc.run_estado === 'error') {
    if (comprobacionMasNueva && comprobacion.ok) {
      return casilla('atencion', 'La tienda contesta, pero la última importación falló', { ...comun, motivo: wc.run_error });
    }
    return casilla('caida', 'La última importación falló', { ...comun, motivo: wc.run_error });
  }
  if (wc.run_estado === 'running' && horasDesde(wc.run_inicio, ahora) > 2) {
    return casilla('atencion', 'Una importación lleva más de 2 h en marcha', comun);
  }
  if (!wc.run_estado && !comprobacion) return casilla('sin_datos', 'Conectada, sin importar ni comprobar todavía', comun);
  const sinClave = wc.tiene_clave ? '' : ' (sin claves de la API: lee la web)';
  return casilla('bien', `Conectada${sinClave}`, comun);
}

function brevoDelCampusODelCrm({ integ, descifrable, comprobacion, delCrm }, ahora) {
  if (integ?.encrypted_value) {
    const prueba = ultimaPrueba(integ, comprobacion);
    const comun = { ultimaSenal: prueba?.ultimoOk ?? null, queSenal: 'Última prueba buena', comprobado: prueba?.at ?? null, datos: { cuenta: 'propia' } };
    if (!descifrable) return casilla('caida', 'La clave guardada no se puede descifrar', { ...comun, motivo: 'Hay que volver a pegarla en Integraciones.' });
    if (prueba && !prueba.ok) return casilla('caida', 'La clave de Brevo del campus no vale', { ...comun, motivo: prueba.mensaje });
    if (!prueba) return casilla('sin_datos', 'Clave propia guardada, sin probar', comun);
    return casilla('bien', `Clave propia válida (probada ${hace(prueba.at, ahora)})`, comun);
  }
  // Sin clave propia, el campus manda con la cuenta del CRM: la misma para todos.
  const crm = delCrm || {};
  const comun = {
    ultimaSenal: masReciente(crm.correos?.ultimo_ok, crm.prueba?.ultimoOk),
    queSenal: 'Último correo enviado (cuenta del CRM)',
    comprobado: crm.prueba?.at ?? null,
    datos: { cuenta: 'crm' },
  };
  if (!crm.configurada) return casilla('sin_configurar', 'Sin Brevo: ni clave del campus ni del CRM');
  if (crm.prueba && !crm.prueba.ok) return casilla('caida', 'La clave de Brevo del CRM no vale', { ...comun, motivo: crm.prueba.mensaje });
  const ok = Number(crm.correos?.ok_24h || 0);
  const fallos = Number(crm.correos?.fallos_24h || 0);
  if (fallos > 0 && ok === 0) return casilla('caida', `Cuenta del CRM: ${fallos} correos fallidos en 24 h y ninguno enviado`, comun);
  if (fallos > 0) return casilla('atencion', `Cuenta del CRM: ${ok} enviados y ${fallos} fallidos en 24 h`, comun);
  if (!crm.prueba && !crm.correos?.ultimo_ok) return casilla('sin_datos', 'Cuenta del CRM, sin probar ni enviar todavía', comun);
  return casilla('bien', `Cuenta del CRM (${ok} enviados en 24 h)`, comun);
}

/**
 * Brevo: la cuenta de la MARCA (Configuración › Claves, con la que salen los
 * correos del campus con su remitente), la clave de Integraciones (la de las
 * facturas) y, si no hay ninguna, la cuenta del CRM, que es una para todos.
 */
export function evaluarBrevo({ integ, descifrable, comprobacion, delCrm, marca = null }, ahora = Date.now()) {
  const base = brevoDelCampusODelCrm({ integ, descifrable, comprobacion, delCrm }, ahora);
  return conClaveDeClaves(base, marca ? parteDeClave(marca, 'Cuenta de la marca', ahora) : null, 'Cuenta de la marca');
}

export function evaluarMeta(m, ahora = Date.now()) {
  const cuentas = Number(m?.cuentas || 0);
  if (!cuentas) return casilla('sin_configurar', 'Sin cuenta publicitaria enlazada');
  const conError = Number(m.con_error || 0);
  const comun = { ultimaSenal: iso(m.ultimo), queSenal: 'Última sincronización' };
  const plural = cuentas > 1 ? 's' : '';
  if (conError >= cuentas) return casilla('caida', 'La sincronización falla', { ...comun, motivo: m.motivo });
  if (conError > 0) return casilla('atencion', `${conError} de ${cuentas} cuentas con error`, { ...comun, motivo: m.motivo });
  const h = horasDesde(m.ultimo, ahora);
  if (h === null) return casilla('sin_datos', 'Enlazada, sin sincronizar todavía', comun);
  // La tarea corre cada 3 h: doce son cuatro vueltas perdidas.
  if (h > 12) return casilla('atencion', `Sin sincronizar desde ${hace(m.ultimo, ahora)}`, comun);
  return casilla('bien', `${cuentas} cuenta${plural} al día`, comun);
}

export function evaluarAdmision(a, ahora = Date.now()) {
  if (!a || !Number(a.activos || 0)) return casilla('sin_configurar', 'Sin webhook de admisión');
  const comun = { ultimaSenal: iso(a.ultimo), queSenal: 'Último aviso recibido' };
  if (!a.ultimo) return casilla('sin_datos', 'Sin avisos todavía', comun);
  if (horasDesde(a.ultimo, ahora) > 24 * 30) return casilla('atencion', `Sin avisos desde ${hace(a.ultimo, ahora)}`, comun);
  return casilla('bien', `${Number(a.usos || 0)} avisos; el último ${hace(a.ultimo, ahora)}`, comun);
}

/** Los webhooks de transferencias que valen para un campus: el suyo, el de su empresa y los de todas. */
export function webhooksDelCampus(webhooks, c) {
  return (webhooks || []).filter((w) => w.ambito === 'todas'
    || (w.ambito === 'empresa' && c.sociedad_emisora_id != null && Number(w.issuer_id) === Number(c.sociedad_emisora_id))
    || (w.ambito === 'campus' && Number(w.project_id) === Number(c.id)));
}

export function evaluarTransferencias(lista, ahora = Date.now()) {
  if (!lista?.length) return casilla('sin_configurar', 'Sin webhook de transferencias');
  const comun = { ultimaSenal: masReciente(...lista.map((w) => w.ultimo_ok)), queSenal: 'Último aviso entregado' };
  const conEnvio = lista.filter((w) => w.estado);
  if (!conEnvio.length) return casilla('sin_datos', 'Sin envíos todavía', comun);
  const ultimo = conEnvio.reduce((a, b) => (ms(b.cuando) > ms(a.cuando) ? b : a));
  const motivoDe = (w) => w.error || (w.http_status ? `El destino contestó HTTP ${w.http_status}` : null);
  if (ultimo.estado === 'fallido') return casilla('caida', 'El último aviso no llegó', { ...comun, motivo: motivoDe(ultimo) });
  const fallidos = conEnvio.filter((w) => w.estado === 'fallido');
  if (fallidos.length) {
    return casilla('atencion', `${fallidos.length} de ${lista.length} webhooks con el último aviso fallido`, { ...comun, motivo: motivoDe(fallidos[0]) });
  }
  return casilla('bien', `Último aviso ${hace(ultimo.cuando, ahora)}`, comun);
}

export function peorDe(casillas) {
  const peor = Object.values(casillas).reduce((max, c) => Math.max(max, GRAVEDAD[c.estado] ?? 0), 0);
  return Object.keys(GRAVEDAD).find((k) => GRAVEDAD[k] === peor) || 'bien';
}

// ─── Brevo del CRM (una para todos) ──────────────────────────────────────────

/** La última prueba de la clave de Brevo del CRM. En memoria: es una sola y se repite con un clic. */
let pruebaBrevoDelCrm = null;

/** La clave de Brevo del CRM, como la coge `brevo.service`: la de la base y, si no hay, la del .env. */
function claveBrevoDelCrm(filaGlobal) {
  if (filaGlobal) {
    try { return decrypt(filaGlobal.encrypted_value, filaGlobal.iv, filaGlobal.auth_tag); } catch { return null; }
  }
  const env = process.env.BREVO_API_KEY;
  return env && env !== 'test' ? env : null;
}

/** El valor de la clave «moodle» de Configuración › Claves: un JSON con la dirección y el token. */
export function leerMoodleDeClaves(fila) {
  try {
    const o = JSON.parse(decrypt(fila.encrypted_value, fila.iv, fila.auth_tag));
    const url = String(o?.url ?? o?.sitio ?? '').trim();
    const token = String(o?.token ?? o?.wstoken ?? '').trim();
    return url && token ? { url, token } : null;
  } catch {
    return null;
  }
}

// ─── Ver ─────────────────────────────────────────────────────────────────────

/** Una consulta que falla no tumba la pantalla: esa conexión sale sin datos. */
async function leer(nombre, promesa, porDefecto) {
  try { return await promesa; } catch (err) {
    logger.warn({ err: err.message, nombre }, 'salud de las conexiones: no se pudo leer');
    return porDefecto;
  }
}

const porCampus = (filas) => new Map((filas || []).map((f) => [Number(f.project_id), f]));

export async function saludDeLosCampus(ids, { ahora = Date.now() } = {}) {
  const campus = ids?.length ? await model.campus(ids) : [];
  const lista = campus.map((c) => Number(c.id));
  if (!lista.length) return { comprobado: new Date(ahora).toISOString(), conexiones: CONEXIONES, campus: [] };

  const [integ, claves, stripe, recepciones, comprobaciones, plugin, woo, meta, admision, transferencias, correos] = await Promise.all([
    leer('integraciones', model.integraciones(lista), []),
    leer('claves', model.credenciales(lista), []),
    leer('stripe', model.stripe(lista), []),
    leer('recepciones', model.recepciones(lista, 'stripe'), []),
    leer('comprobaciones', model.comprobaciones(lista), []),
    leer('plugin de Moodle', model.pluginMoodle(lista), []),
    leer('woocommerce', model.wooCommerce(lista), []),
    leer('meta', model.meta(lista), []),
    leer('admision', model.admision(lista), []),
    leer('transferencias', model.transferencias(), []),
    leer('correos', model.correosDelCrm(), {}),
  ]);

  const integDe = (pid, prov) => integ.find((i) => Number(i.project_id) === pid && i.provider === prov) || null;
  const comprobacionDe = (pid, con) => comprobaciones.find((x) => Number(x.project_id) === pid && x.conexion === con) || null;
  const stripeDe = porCampus(stripe);
  const recepcionDe = porCampus(recepciones);
  const pluginDe = porCampus(plugin);
  const wooDe = porCampus(woo);
  const metaDe = porCampus(meta);
  const admisionDe = porCampus(admision);
  const claveDe = (pid, servicio) => claves.find((k) => Number(k.project_id) === pid && k.service === servicio) || null;
  const brevoGlobal = claves.find((k) => k.project_id == null && k.service === 'brevo') || null;
  const delCrm = {
    configurada: !!brevoGlobal || !!(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY !== 'test'),
    prueba: pruebaBrevoDelCrm,
    correos,
  };

  const filas = campus.map((c) => {
    const pid = Number(c.id);
    const iStripe = integDe(pid, 'stripe');
    const iMoodle = integDe(pid, 'moodle');
    const iBrevo = integDe(pid, 'brevo');
    const pub = iStripe?.config_public || {};
    const secreto = pub.webhook_secret_encrypted
      ? (sePuedeDescifrar(pub.webhook_secret_encrypted, pub.webhook_secret_iv, pub.webhook_secret_auth_tag) ? 'con' : 'no_descifrable')
      : (pub.webhook_secret ? 'con' : 'sin');
    const descifra = (i) => sePuedeDescifrar(i?.encrypted_value, i?.iv, i?.auth_tag);
    const kMoodle = claveDe(pid, 'moodle');
    const kBrevo = claveDe(pid, 'brevo');

    const casillas = {
      stripe: evaluarStripe({
        integ: iStripe, descifrable: descifra(iStripe), secreto,
        sync: stripeDe.get(pid), recepcion: recepcionDe.get(pid), comprobacion: comprobacionDe(pid, 'stripe'),
      }, ahora),
      moodle: evaluarMoodle({
        integ: iMoodle, descifrable: descifra(iMoodle), plugin: pluginDe.get(pid), comprobacion: comprobacionDe(pid, 'moodle'),
        mcp: kMoodle ? { descifrable: !!leerMoodleDeClaves(kMoodle), comprobacion: comprobacionDe(pid, 'moodle_mcp') } : null,
      }, ahora),
      woocommerce: evaluarWooCommerce({ wc: wooDe.get(pid), comprobacion: comprobacionDe(pid, 'woocommerce') }, ahora),
      brevo: evaluarBrevo({
        integ: iBrevo, descifrable: descifra(iBrevo), comprobacion: comprobacionDe(pid, 'brevo'), delCrm,
        marca: kBrevo ? { descifrable: descifra(kBrevo), comprobacion: comprobacionDe(pid, 'brevo_marca') } : null,
      }, ahora),
      meta: evaluarMeta(metaDe.get(pid), ahora),
      admision: evaluarAdmision(admisionDe.get(pid), ahora),
      transferencias: evaluarTransferencias(webhooksDelCampus(transferencias, c), ahora),
    };
    return { id: pid, nombre: c.nombre, type: c.type, peor: peorDe(casillas), casillas };
  });

  return { comprobado: new Date(ahora).toISOString(), conexiones: CONEXIONES, campus: filas };
}

// ─── Comprobar ahora ─────────────────────────────────────────────────────────

function conTiempo(promesa, ms = TOPE_MS) {
  let reloj;
  return Promise.race([
    promesa,
    new Promise((_, no) => { reloj = setTimeout(() => no(new Error(`No ha contestado en ${Math.round(ms / 1000)} s.`)), ms); reloj.unref?.(); }),
  ]).finally(() => clearTimeout(reloj));
}

/**
 * La tienda, con UNA petición de solo lectura: un producto de la API de
 * WooCommerce si hay claves; si no (las que leen solo la web), la portada de la
 * API de WordPress. Los mensajes son nuestros: la URL lleva las claves y no se
 * repite en ninguno.
 */
export async function probarWooCommerce(creds, { fetchImpl = fetch } = {}) {
  const base = String(creds?.store_url || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(base)) return { ok: false, message: 'La dirección de la tienda no es válida.' };
  const conClave = !!(creds.consumer_key && creds.consumer_secret);
  const url = conClave
    ? `${base}/wp-json/wc/v3/products?per_page=1&consumer_key=${encodeURIComponent(creds.consumer_key)}&consumer_secret=${encodeURIComponent(creds.consumer_secret)}`
    : `${base}/wp-json/`;
  let r;
  try {
    r = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TOPE_MS) });
  } catch (err) {
    const tarde = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    return { ok: false, message: tarde ? `La tienda no ha contestado en ${Math.round(TOPE_MS / 1000)} s.` : 'No se ha podido llegar a la tienda.' };
  }
  if (r.ok) {
    return { ok: true, message: conClave ? 'La API de WooCommerce contesta con estas claves.' : 'La web contesta (sin claves de la API de WooCommerce).' };
  }
  if (r.status === 401 || r.status === 403) {
    return { ok: false, message: `WooCommerce no acepta las claves (HTTP ${r.status}): revisa que sigan activas y con permiso de lectura.` };
  }
  if (r.status === 404) return { ok: false, message: 'La tienda no tiene la API de WooCommerce en esa dirección (HTTP 404).' };
  return { ok: false, message: `La tienda ha contestado con un error HTTP ${r.status}.` };
}

const reciente = (fecha, ahora) => fecha && ahora - new Date(fecha).getTime() < CADENCIA_MS;

async function apuntar(projectId, conexion, resultado, { conTarjeta }) {
  const mensaje = limpiarMotivo(resultado.message) || (resultado.ok ? 'OK' : 'Falló sin motivo');
  if (conTarjeta) {
    // La misma anotación que «Probar conexión»: la tarjeta del campus lo enseña igual.
    await recordTestResult({ projectId, provider: conexion, status: resultado.ok ? 'success' : 'error', message: mensaje });
  }
  await model.guardarComprobacion({ projectId, conexion, ok: !!resultado.ok, mensaje });
}

async function probarUna(fn) {
  try { return await conTiempo(Promise.resolve().then(fn)); } catch (err) {
    return { ok: false, message: err?.message || String(err) };
  }
}

/** Las conexiones de UN campus que se pueden probar contra fuera. */
async function comprobarCampus(projectId, { ahora, probar, fetchImpl }) {
  const [integ, claves, comprobaciones, woo] = await Promise.all([
    model.integraciones([projectId]),
    model.credenciales([projectId]).catch(() => []),
    model.comprobaciones([projectId]).catch(() => []),
    model.credencialesWoo(projectId).catch(() => null),
  ]);
  const ya = (con) => reciente(comprobaciones.find((x) => x.conexion === con)?.comprobado_at, ahora);
  const hechas = [];
  const tareas = integ
    .filter((i) => i.encrypted_value && probar[i.provider] && !ya(i.provider))
    .map(async (i) => {
      let resultado;
      let clave = null;
      try { clave = decrypt(i.encrypted_value, i.iv, i.auth_tag); } catch { clave = null; }
      if (!clave) resultado = { ok: false, message: 'La clave guardada no se puede descifrar.' };
      else resultado = await probarUna(() => probar[i.provider](clave, i.config_public || {}));
      await apuntar(projectId, i.provider, resultado, { conTarjeta: true });
      hechas.push(i.provider);
    });
  // Las de Configuración › Claves: el Moodle del MCP y la cuenta de Brevo de la marca.
  // Sin anotar en `api_credentials`: allí «Probar» significa otra cosa (que se descifre).
  const deClaves = [
    { servicio: 'moodle', conexion: 'moodle_mcp', probarCon: (fila) => {
      const m = leerMoodleDeClaves(fila);
      return m ? () => probar.moodle(m.token, { url: m.url }) : null;
    } },
    { servicio: 'brevo', conexion: 'brevo_marca', probarCon: (fila) => {
      let clave = null;
      try { clave = decrypt(fila.encrypted_value, fila.iv, fila.auth_tag); } catch { clave = null; }
      return clave ? () => probar.brevo(clave) : null;
    } },
  ];
  for (const d of deClaves) {
    const fila = claves.find((k) => Number(k.project_id) === projectId && k.service === d.servicio);
    if (!fila || !probar[d.servicio] || ya(d.conexion)) continue;
    tareas.push((async () => {
      const fn = d.probarCon(fila);
      const resultado = fn ? await probarUna(fn) : { ok: false, message: 'La clave guardada no se puede leer.' };
      await apuntar(projectId, d.conexion, resultado, { conTarjeta: false });
      hechas.push(d.conexion);
    })());
  }
  if (woo?.store_url && woo.active !== false && !ya('woocommerce')) {
    tareas.push((async () => {
      const resultado = await probarUna(() => probarWooCommerce(woo, { fetchImpl }));
      await apuntar(projectId, 'woocommerce', resultado, { conTarjeta: false });
      hechas.push('woocommerce');
    })());
  }
  await Promise.all(tareas);
  return hechas;
}

const enMarcha = new Map();

/**
 * «Comprobar ahora»: prueba contra fuera lo que se puede probar de cada campus
 * (Stripe, Brevo de Integraciones y de la marca, Moodle de Integraciones y del
 * MCP, y la tienda) y la clave de Brevo del CRM.
 * Lo de los webhooks y los sincronizadores no se prueba: su señal es la última
 * vez que funcionaron, y eso ya está en la base.
 *
 * Seis campus a la vez y cada prueba con su tope. Un campus que ya se está
 * comprobando (otra pestaña) no se pide dos veces: se espera al mismo.
 */
export async function comprobarAhora(ids, { ahora = Date.now(), probar = PROBAR, fetchImpl = fetch } = {}) {
  const resultado = {};
  const cola = [...new Set((ids || []).map(Number).filter((n) => n > 0))];

  const brevo = (async () => {
    if (reciente(pruebaBrevoDelCrm?.at, ahora) || !probar.brevo) return;
    const global = await model.credenciales([]).then((f) => f.find((k) => k.project_id == null && k.service === 'brevo') || null).catch(() => null);
    const clave = claveBrevoDelCrm(global);
    if (!clave) return;
    const r = await probarUna(() => probar.brevo(clave));
    const at = new Date().toISOString();
    pruebaBrevoDelCrm = {
      ok: !!r.ok, mensaje: limpiarMotivo(r.message), at,
      ultimoOk: r.ok ? at : (pruebaBrevoDelCrm?.ultimoOk ?? null),
    };
  })();

  async function trabajador() {
    while (cola.length) {
      const pid = cola.shift();
      if (!enMarcha.has(pid)) {
        enMarcha.set(pid, comprobarCampus(pid, { ahora, probar, fetchImpl }).finally(() => enMarcha.delete(pid)));
      }
      try { resultado[pid] = await enMarcha.get(pid); } catch (err) {
        logger.warn({ projectId: pid, err: err.message }, 'salud de las conexiones: no se pudo comprobar el campus');
        resultado[pid] = [];
      }
    }
  }
  await Promise.all([brevo, ...Array.from({ length: A_LA_VEZ }, trabajador)]);
  return resultado;
}

export const _internos = {
  reiniciar() { pruebaBrevoDelCrm = null; enMarcha.clear(); },
  get pruebaBrevoDelCrm() { return pruebaBrevoDelCrm; },
};
