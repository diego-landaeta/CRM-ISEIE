import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../../shared/utils/logger.js';
import { HERRAMIENTAS } from './mcp.tools.js';
import * as model from './mcp.model.js';
import { z } from 'zod';
import * as desbloqueo from './mcp.desbloqueo.js';
import { protegerDatos, recortarFilas } from './mcp.privacidad.js';
import { MENSAJE_APAGADO } from './mcp.interruptor.js';

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

/**
 * Lo que contesta cualquier herramienta con el interruptor apagado (#196).
 *
 * La aclaración es un DATO, no una orden: con la frase sola, Claude rellenaba
 * el «qué hago» por su cuenta y pedía un código de desbloqueo que no tiene que
 * ver con esto. Una orden («repite esta frase») la rechazaba por venir de una
 * herramienta.
 */
const ACLARACION_APAGADO = 'Lo activa un administrador desde el panel del CRM. No tiene que ver con el código de desbloqueo: no hace falta pedirlo.';
const RESPUESTA_APAGADO = {
  isError: true,
  content: [{ type: 'text', text: `${MENSAJE_APAGADO}. ${ACLARACION_APAGADO}` }],
};

export function crearServidor({ ambito, tokenId, origen = {}, apagado = false }) {
  const server = new McpServer(
    { name: 'crm-iseih', version: '1.0.0' },
    {
      instructions: apagado ? `${MENSAJE_APAGADO}. ${ACLARACION_APAGADO}` :
        'CRM del ecosistema ISEIE/ISEIH. Solo consulta: no se puede crear, cambiar ni borrar nada. '
        + 'Empieza por «mis_proyectos» para saber a qué campus y empresas tienes acceso. '
        + 'Importes en euros salvo que se indique moneda. Fechas en formato AAAA-MM-DD. '
        + 'Los correos y teléfonos salen enmascarados y, en los listados, los clientes con nombre abreviado: '
        + 'pide datos_completos: true solo si la persona necesita contactar a alguien (queda registrado).',
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
          // Interruptor apagado (#196): ningún dato, solo el aviso.
          if (apagado) {
            ok = false;
            error = 'MCP_APAGADO';
            return RESPUESTA_APAGADO;
          }
          // Segundo factor (#192): con el interruptor encendido, sin desbloquear
          // no sale ningún dato. Se mira en cada llamada contra la base.
          const barrera = await barreraDeDesbloqueo(tokenId);
          if (barrera) {
            ok = false;
            error = barrera;
            return { isError: true, content: [{ type: 'text', text: barrera }] };
          }
          const datos = await h.ejecutar(ambito, args || {});
          // Menos datos personales y un máximo de filas por respuesta (#196).
          const protegidos = protegerDatos(datos, {
            completos: args?.datos_completos === true,
            nombresDeLista: h.listasDeClientes || [],
          });
          const { datos: recortados, recortes } = recortarFilas(protegidos);
          const aviso = recortes.length
            ? `\n[Solo se muestran las primeras ${recortes[0].quedan} filas de ${recortes.map((r) => `«${r.lista}» (había ${r.tenia})`).join(', ')}. `
              + 'Acota con filtros o fechas (o pide la página siguiente, en las consultas que tienen páginas). '
              + 'Dile a la persona que la lista está incompleta.]'
            : '';
          return { content: [{ type: 'text', text: comoTexto(recortados) + aviso }] };
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
            ok, error, duracionMs: Date.now() - inicio, origen,
          }).catch((err) => logger.warn({ err: err.message }, 'MCP: no se pudo guardar la auditoria'));
        }
      }
    );
  }

  // Solo con el código obligatorio: si no, Claude ve las mismas herramientas
  // que antes y no se le ofrece una que no sirve. Y nunca con el MCP apagado
  // (#196): viéndola, Claude le pedía a la persona un código que no hace falta.
  if (desbloqueo.config().obligatorio && !apagado) registrarDesbloquear(server, { ambito, tokenId, origen });
  return server;
}

/**
 * null si se puede consultar; si no, el mensaje que verá Claude.
 * Con el interruptor apagado no mira nada: el MCP sigue como antes.
 */
async function barreraDeDesbloqueo(tokenId) {
  if (!desbloqueo.config().obligatorio) return null;
  const estado = await desbloqueo.estadoDeLaConexion(tokenId);
  if (estado.bloqueado) {
    return `Esta conexión está bloqueada hasta las ${horaLocal(estado.bloqueado_hasta)} por fallar el código demasiadas veces.`;
  }
  if (!estado.desbloqueado) return desbloqueo.MENSAJE_SIN_DESBLOQUEAR;
  await desbloqueo.marcarUsoDesbloqueo(tokenId);
  return null;
}

const horaLocal = (fecha) => new Date(fecha).toLocaleTimeString('es-ES', {
  hour: '2-digit', minute: '2-digit', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
});

/**
 * La herramienta `desbloquear(codigo)`. Va aparte de HERRAMIENTAS porque no es
 * una consulta: cambia el estado de la conexión (por eso no lleva readOnlyHint,
 * y por eso las pruebas de «todo es de solo lectura» no la cuentan: solo existe
 * con MCP_CODIGO_OBLIGATORIO encendido). NUNCA se guarda el código en la
 * auditoría, ni siquiera el que falla.
 */
function registrarDesbloquear(server, { ambito, tokenId, origen }) {
  server.registerTool(
    'desbloquear',
    {
      title: 'Desbloquear con el código del CRM',
      description: 'Desbloquea esta conexión con el código que la persona saca en el CRM → Conexión → MCP → «Código para Claude». '
        + 'Úsala cuando una consulta conteste que hace falta un código, y pídeselo a la persona: no lo inventes.',
      inputSchema: { codigo: z.string().min(4).max(20).describe('El código que te dé la persona, por ejemplo K7QM-2XPA') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ codigo }) => {
      const inicio = Date.now();
      let ok = false;
      let error = null;
      try {
        const r = await desbloqueo.intentarDesbloqueo({ userId: ambito.userId, tokenId, codigo });
        const { inactividadMin } = desbloqueo.config();
        if (r.resultado === 'ok') {
          ok = true;
          return { content: [{ type: 'text', text:
            `Desbloqueado. Ya puedes consultar el CRM. Se vuelve a bloquear tras ${inactividadMin / 60} h sin uso `
            + `o, como muy tarde, a las ${horaLocal(r.caducaMaxAt)}.` }] };
        }
        if (r.resultado === 'incorrecto') {
          error = 'CODIGO_INCORRECTO';
          return { isError: true, content: [{ type: 'text', text:
            `El código no vale: está mal escrito, ha caducado (dura ${desbloqueo.config().minutosCodigo} minutos) o ya se usó. `
            + `Pide a la persona uno nuevo. Quedan ${r.quedan} intentos antes de bloquear la conexión.` }] };
        }
        if (r.resultado === 'bloqueada') {
          error = 'BLOQUEADA';
          desbloqueo.avisarBloqueo({ userId: ambito.userId, tokenId, hasta: r.hasta });
          return { isError: true, content: [{ type: 'text', text:
            `Demasiados códigos incorrectos: la conexión queda bloqueada hasta las ${horaLocal(r.hasta)}. Se ha avisado por correo.` }] };
        }
        error = 'YA_BLOQUEADA';
        return { isError: true, content: [{ type: 'text', text:
          `Esta conexión está bloqueada hasta las ${horaLocal(r.hasta)} por fallar el código demasiadas veces.` }] };
      } catch (err) {
        error = err.message;
        logger.error({ err, userId: ambito.userId }, 'MCP: fallo al desbloquear');
        return { isError: true, content: [{ type: 'text', text: 'Error interno al comprobar el código.' }] };
      } finally {
        model.registrarAuditoria({
          userId: ambito.userId, tokenId, herramienta: 'desbloquear', parametros: null,
          ok, error, duracionMs: Date.now() - inicio, origen,
        }).catch((err) => logger.warn({ err: err.message }, 'MCP: no se pudo guardar la auditoria'));
      }
    }
  );
}

/** POST /api/mcp — una peticion MCP (JSON-RPC) de Claude. */
export async function atenderPeticion(req, res) {
  const server = crearServidor({ ...req.mcp, apagado: req.mcpApagado === true });
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
