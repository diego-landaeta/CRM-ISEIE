import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../../shared/utils/logger.js';
import { HERRAMIENTAS } from './mcp.tools.js';
import * as model from './mcp.model.js';

/**
 * El servidor MCP del CRM.
 *
 * SIN SESIONES. Se crea un servidor por peticion, con el ambito de la persona
 * metido dentro. Asi no hay estado en memoria que se mezcle entre personas ni
 * que se pierda cuando PM2 reinicia, y el ambito de cada llamada es el que
 * dice la base en ese momento, no el de cuando se abrio la conexion.
 */

/** Tope de lo que se le devuelve a Claude en una respuesta. */
const MAX_CARACTERES = 100_000;

function comoTexto(datos) {
  const texto = JSON.stringify(datos, null, 1);
  if (texto.length <= MAX_CARACTERES) return texto;
  return texto.slice(0, MAX_CARACTERES)
    + '\n…[respuesta recortada: usa filtros, fechas o un límite menor para ver el resto]';
}

export function crearServidor({ ambito, tokenId }) {
  const server = new McpServer(
    { name: 'crm-iseih', version: '1.0.0' },
    {
      instructions:
        'CRM del ecosistema ISEIE/ISEIH. Solo consulta: no se puede crear, cambiar ni borrar nada. '
        + 'Empieza por «mis_proyectos» para saber a qué campus y empresas tienes acceso. '
        + 'Importes en euros salvo que se indique moneda. Fechas en formato AAAA-MM-DD.',
    }
  );

  for (const h of HERRAMIENTAS) {
    server.registerTool(
      h.nombre,
      {
        title: h.titulo,
        description: h.descripcion,
        inputSchema: h.entrada,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async (args) => {
        const inicio = Date.now();
        let ok = true;
        let error = null;
        try {
          const datos = await h.ejecutar(ambito, args || {});
          return { content: [{ type: 'text', text: comoTexto(datos) }] };
        } catch (err) {
          ok = false;
          // Los errores de ambito y de validacion se le cuentan a Claude tal
          // cual; uno de base de datos NO: puede llevar nombres de tablas o
          // trozos de SQL, y eso se queda en el log.
          const operativo = err.isOperational === true;
          error = err.message;
          if (!operativo) logger.error({ err, herramienta: h.nombre, userId: ambito.userId }, 'MCP: fallo en herramienta');
          return {
            isError: true,
            content: [{ type: 'text', text: operativo ? err.message : 'Error interno al consultar el CRM.' }],
          };
        } finally {
          model.registrarAuditoria({
            userId: ambito.userId, tokenId, herramienta: h.nombre, parametros: args || null,
            ok, error, duracionMs: Date.now() - inicio,
          }).catch((err) => logger.warn({ err: err.message }, 'MCP: no se pudo guardar la auditoria'));
        }
      }
    );
  }
  return server;
}

/** POST /api/mcp — una peticion MCP (JSON-RPC) de Claude. */
export async function atenderPeticion(req, res) {
  const server = crearServidor(req.mcp);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  // `close()` devuelve una promesa: si falla al cortar el cliente a medias, se
  // anota y ya. Una promesa rota aqui no puede llevarse el CRM entero.
  res.on('close', () => {
    Promise.resolve()
      .then(() => transport.close())
      .then(() => server.close())
      .catch((err) => logger.warn({ err: err.message }, 'MCP: error al cerrar la conexion'));
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.error({ err }, 'MCP: error atendiendo la peticion');
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null });
    }
  }
}

/** GET y DELETE: sin sesiones no hay flujo que abrir ni que cerrar. */
export function metodoNoPermitido(_req, res) {
  res.status(405).set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Método no permitido' }, id: null });
}
