import { construirAmbito, huella, pareceToken, puedeUsarMcp } from './mcp.acceso.js';
import * as model from './mcp.model.js';

/**
 * La puerta del MCP: el token personal, de una de estas dos formas:
 *
 *   · Cabecera `Authorization: Bearer crm_mcp_…` (Claude Code, o Claude
 *     Desktop por configuracion).
 *   · URL personal `/api/mcp/u/crm_mcp_…` (Claude Desktop con «Agregar
 *     conector personalizado»). Ese formulario solo pide una URL: no tiene
 *     donde poner una cabecera, y sin token Claude intenta OAuth y falla
 *     (probado el 28/09 con un tunel). La URL personal ES la llave; por eso
 *     se tapa en cuanto llega (ver `urlPersonal`) y no queda en ningun registro.
 *
 * No se usa el JWT del CRM: dura 8 horas y vive en la memoria del navegador.
 * Claude necesita algo que se pegue una vez en su configuracion.
 *
 * En CADA peticion se vuelve a mirar en la base si la persona sigue activa,
 * si sigue teniendo acceso y cuales son sus campus. Quitarle la casilla o un
 * campus tiene efecto en la siguiente pregunta, no cuando caduque el token.
 *
 * Los errores van en JSON-RPC y con 401/403: es lo que entiende un cliente MCP.
 */
function rechazar(res, status, message) {
  return res.status(status).json({ jsonrpc: '2.0', error: { code: -32001, message }, id: null });
}

/**
 * Para `/u/:secreto`: guarda el token y lo TAPA en la URL de la peticion.
 *
 * Todo lo que escribe el registro sale de `req.path`/`req.originalUrl` (el
 * errorHandler anota la ruta de cada rechazo). Si el secreto se quedara ahi,
 * cualquiera con acceso a los logs podria entrar como esa persona.
 */
export function urlPersonal(req, _res, next) {
  const secreto = req.params.secreto;
  req.mcpTokenDeUrl = secreto;
  req.url = req.url.replace(secreto, '***');
  req.originalUrl = req.originalUrl.replace(secreto, '***');
  next();
}

export async function verificarTokenMcp(req, res, next) {
  try {
    const cabecera = req.headers.authorization || '';
    const token = req.mcpTokenDeUrl
      || (cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : null);
    if (!pareceToken(token)) {
      res.set('WWW-Authenticate', 'Bearer realm="crm-mcp"');
      return rechazar(res, 401, req.mcpTokenDeUrl
        ? 'URL de MCP no válida. Cópiala de nuevo del CRM: Conexión → MCP.'
        : 'Falta el token MCP. Créalo en el CRM: Conexión → MCP.');
    }

    const vivo = await model.findTokenVivo(huella(token));
    if (!vivo) {
      res.set('WWW-Authenticate', 'Bearer realm="crm-mcp", error="invalid_token"');
      return rechazar(res, 401, 'Token MCP no válido, caducado o revocado.');
    }

    const user = await model.findUserById(vivo.user_id);
    if (!puedeUsarMcp(user)) {
      return rechazar(res, 403, 'Tu usuario no tiene acceso al MCP del CRM.');
    }

    let proyectos = await model.proyectosDeLaPersona(user);
    // Una URL sacada de un conector «Servidor MCP» (Conectores, migración 184):
    // lo de la persona DENTRO del «Para quién» del conector. Nunca más de lo
    // que ya ve la persona; si el conector se borra o se apaga, deja de valer.
    if (vivo.connector_id) {
      const limite = await model.campusDelConector(vivo.connector_id);
      if (!limite) return rechazar(res, 401, 'El conector de esta URL ya no existe o está apagado.');
      if (limite.ids) proyectos = proyectos.filter((p) => limite.ids.includes(Number(p.id)));
    }
    const origen = { ip: req.ip, cliente: req.headers['user-agent'] || null };
    req.mcp = { ambito: construirAmbito(user, proyectos), tokenId: vivo.token_id, origen };
    // Desde dónde (#194). req.ip ya viene del X-Forwarded-For de nginx
    // (`trust proxy`); el cliente es el User-Agent: «Claude-User» desde
    // Claude Desktop o claude.ai, «claude-code/…» desde Claude Code.
    model.marcarUso(vivo.token_id, origen).catch(() => {});
    next();
  } catch (err) {
    next(err);
  }
}
