import { logger } from '../shared/utils/logger.js';
import { sendMcpCaducidadEmail } from '../shared/services/brevo.service.js';
import * as mcpModel from '../modules/mcp/mcp.model.js';
import { configRotacion } from '../modules/mcp/mcp.acceso.js';
import { vigilar } from './latido.js';

/**
 * Rotación de las URLs del MCP de Claude (#194). En cada vuelta:
 *
 *   1. Revoca las que llevan MCP_TOKEN_SIN_USO_DIAS (30) sin usarse. Una llave
 *      que nadie usa es justo la que alguien puede tener sin que se note.
 *   2. Avisa por correo de las que caducan dentro de MCP_TOKEN_AVISO_DIAS (7),
 *      un correo por persona y una sola vez por URL.
 *
 * Que caduquen no necesita vuelta: la puerta del MCP ya mira `expires_at` en
 * cada consulta.
 *
 * Cada 6 horas basta: lo que se mide son días, y así un reinicio del servidor
 * no retrasa un aviso más de unas horas.
 */

const TICK_MS = parseInt(process.env.MCP_ROTACION_TICK_MS || String(6 * 60 * 60 * 1000), 10);

export async function vuelta() {
  const { diasAviso, diasSinUso } = configRotacion();
  const resumen = { revocadasSinUso: 0, avisosEnviados: 0, avisosFallidos: 0 };

  if (diasSinUso) {
    const revocadas = await mcpModel.revocarSinUso(diasSinUso);
    resumen.revocadasSinUso = revocadas.length;
    if (revocadas.length) {
      logger.info({ revocadas: revocadas.map((r) => ({ id: r.id, userId: r.user_id, prefijo: r.prefijo })), diasSinUso },
        'MCP: URLs revocadas por no usarse');
    }
  }

  if (diasAviso) {
    const enlace = `${process.env.CRM_BASE_URL || 'http://localhost:5173/crm'}/conexion/mcp`;
    for (const p of await mcpModel.porCaducarSinAviso(diasAviso)) {
      try {
        const r = await sendMcpCaducidadEmail({ persona: p, urls: p.urls, enlace });
        // Solo se marca avisado si el correo SALIÓ: si no, se reintenta en la
        // siguiente vuelta en vez de quedarse sin aviso para siempre.
        // `sendEmail` contesta { sent: true|false, reason }; sin clave de Brevo,
        // con el freno de pruebas o tras agotar los reintentos, sent es false.
        if (!r || r.sent !== true) throw new Error(r?.reason || 'el correo no salió');
        await mcpModel.marcarAvisoCaducidad(p.urls.map((u) => u.id));
        resumen.avisosEnviados += 1;
      } catch (err) {
        resumen.avisosFallidos += 1;
        logger.warn({ err: err.message, userId: p.user_id }, 'MCP: no se pudo avisar de la caducidad');
      }
    }
  }
  return resumen;
}

export function startMcpRotacionScheduler() {
  if (process.env.MCP_ROTACION_DISABLED === '1') {
    logger.info('Rotación de URLs del MCP desactivada (MCP_ROTACION_DISABLED=1)');
    return;
  }
  // Como el resto: la primera vuelta espera un ciclo, para que un reinicio no
  // dispare correos.
  vigilar('mcp_rotacion', 'Caducidad y URLs sin usar del MCP de Claude', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS, ...configRotacion() }, 'Rotación de URLs del MCP iniciada');
}
