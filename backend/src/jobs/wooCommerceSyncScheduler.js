import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import * as wcModel from '../modules/woocommerce/wc.model.js';
import { runFullImport } from '../modules/woocommerce/wc.controller.js';
import { vigilar } from './latido.js';

const TICK_MS = parseInt(process.env.WC_SYNC_TICK_MS || String(5 * 60 * 1000)); // 5 min default

let running = false;

// La hora de Espana, no la del servidor, que va en UTC. Asi «las 2» siguen
// siendo las 2 de la madrugada de aqui tambien en invierno, sin tocar nada en
// marzo ni en octubre.
function horaEspanola(fecha = new Date()) {
  return parseInt(new Intl.DateTimeFormat('es-ES', {
    timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false,
  }).format(fecha), 10);
}

// Con hora fija, cada proyecto entra a SU hora y no todos a la vez.
//
// Diego, 18/09: «que cada 12 horas se sincronicen, no todas a las 12 horas, si
// no iseie por ejemplo a la 1, iseih a las 2, que sean diferentes».
//
// Sin ancla se mantiene lo de siempre —contar desde la ultima vez—, que
// funciona pero se desplaza: cada vuelta suma lo que tardo la anterior mas el
// margen del reloj, y en una semana ya no sincroniza a la hora que era.
function leToca(creds) {
  const ancla = creds.sync_anchor_hour;
  const intervalo = creds.sync_interval_minutes || 30;
  const desde = creds.last_sync_at
    ? (Date.now() - new Date(creds.last_sync_at).getTime()) / 60000
    : Infinity;

  if (ancla === null || ancla === undefined) return desde >= intervalo;

  const pasoH = Math.max(1, Math.round(intervalo / 60));
  const ahora = horaEspanola();
  const esSuHora = ((((ahora - ancla) % pasoH) + pasoH) % pasoH) === 0;
  // Media vuelta de margen: el reloj mira cada 5 minutos y sin esto entraria
  // doce veces seguidas dentro de la misma hora.
  return esSuHora && desde >= (pasoH * 60) / 2;
}

async function syncProject(creds) {
  if (!leToca(creds)) return;

  let runId = null;
  try {
    const startRes = await wcModel.startRun(creds.project_id, null);
    runId = startRes.id;
    // Reutiliza el mismo flujo que importNow: categorías + productos + scraper
    // + field_mapping + CPT + menú. Antes el auto-sync sólo metía nombre/precio
    // y por eso ICTESS quedó sin horas/módulos/secciones.
    await runFullImport(creds, creds.project_id, runId);
    await query(`UPDATE wc_credentials SET last_sync_at = NOW() WHERE project_id = $1`, [creds.project_id]);
    logger.info({ projectId: creds.project_id }, 'WC auto-sync OK (full import)');
  } catch (err) {
    if (runId) await wcModel.finishRun(runId, { status: 'error', error_message: err.message?.slice(0, 1000) });
    logger.error({ err, projectId: creds.project_id }, 'WC auto-sync error');
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const { rows } = await query(`SELECT * FROM wc_credentials WHERE active = true AND auto_sync_enabled = true`);
    for (const c of rows) await syncProject(c);
  } catch (err) {
    logger.error({ err }, 'WC scheduler tick error');
  } finally { running = false; }
}

export function startWooCommerceSyncScheduler() {
  if (process.env.WC_SYNC_DISABLED === '1') {
    logger.warn('WooCommerce sync scheduler deshabilitado por WC_SYNC_DISABLED=1');
    return;
  }
  vigilar('woocommerce', 'Sincronización de WooCommerce', tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'WooCommerce sync scheduler iniciado');
}
