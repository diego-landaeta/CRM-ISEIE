import { logger } from '../shared/utils/logger.js';
import { revisar, limpiarAuditoria, configAlertas } from '../modules/mcp/mcp.alertas.js';
import { vigilar } from './latido.js';

/**
 * Vigilancia del MCP de Claude (#195): cada 5 minutos revisa las consultas
 * nuevas y avisa por correo de lo raro (ver mcp.alertas.js). Una vez al día,
 * además, borra la auditoría más vieja que MCP_AUDITORIA_MESES (12).
 */

const TICK_MS = parseInt(process.env.MCP_ALERTAS_TICK_MS || String(5 * 60 * 1000), 10);
const UN_DIA = 24 * 60 * 60 * 1000;
let ultimaLimpieza = 0;

export async function vuelta() {
  const resumen = await revisar();
  if (Date.now() - ultimaLimpieza > UN_DIA) {
    Object.assign(resumen, await limpiarAuditoria());
    ultimaLimpieza = Date.now();
  }
  return resumen;
}

export function startMcpVigilanciaScheduler() {
  if (process.env.MCP_VIGILANCIA_DISABLED === '1') {
    logger.info('Vigilancia del MCP desactivada (MCP_VIGILANCIA_DISABLED=1)');
    return;
  }
  vigilar('mcp_vigilancia', 'Alertas y limpieza de la auditoría del MCP de Claude', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS, ...configAlertas() }, 'Vigilancia del MCP iniciada');
}
