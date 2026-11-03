import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { logger } from '../../shared/utils/logger.js';
import { HERRAMIENTAS } from './mcp.tools.js';
import * as model from './mcp.model.js';
import { z } from 'zod';
import * as desbloqueo from './mcp.desbloqueo.js';
import * as alertas from './mcp.alertas.js';
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

export function crearServidor({ ambito, tokenId, conexion = null, origen = {}, apagado = false }) {
  const server = new McpServer(
    { name: 'crm-iseih', version: '1.0.0' },
    {
      instructions: apagado ? `${MENSAJE_APAGADO}. ${ACLARACION_APAGADO}` :
        'CRM del ecosistema ISEIE/ISEIH. Solo consulta: no se puede crear, cambiar ni borrar nada. '
        + 'Empieza por «mis_proyectos» para saber a qué campus y empresas tienes acceso. '
        + 'Importes en euros salvo que se indique moneda. Fechas en formato AAAA-MM-DD. '
        + 'Las herramientas «moodle_*» consultan el Moodle de cada campus: si un campus sale en «campus_con_error» (sin Moodle, token no válido o sin respuesta), '
        + 'díselo a la persona; nunca lo cuentes como cero cursos o cero alumnos. '
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
          const barrera = await barreraDeDesbloqueo(tokenId, conexion);
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
  if (desbloqueo.config().obligatorio && !apagado) registrarDesbloquear(server, { ambito, tokenId, conexion, origen });
  return server;
}

/**
 * null si se puede consultar; si no, el mensaje que verá Claude.
 * Con el código apagado no mira nada: el MCP sigue como antes.
 *
 * #326: hace falta las DOS cosas en ESTE Claude conectado: que el dueño de la
 * URL lo haya autorizado y que se haya desbloqueado con el código (o desde el
 * panel). Sin caducidad por horas. `conexion` la trae mcp.auth.js, leída de la
 * base en esta misma petición.
 */
async function barreraDeDesbloqueo(tokenId, conexion) {
  if (!desbloqueo.config().obligatorio) return null;
  const estado = await desbloqueo.estadoDeLaConexion(tokenId);
  if (estado.bloqueado) {
    return `Esta conexión está bloqueada hasta las ${horaLocal(estado.bloqueado_hasta)} por fallar el código demasiadas veces.`;
  }
  if (!conexion) return desbloqueo.mensajeSinDesbloquear(await desbloqueo.nombreDeLaUrl(tokenId));
  if (conexion.estado === 'rechazada') return desbloqueo.MENSAJE_RECHAZADA;
  if (conexion.estado !== 'autorizada') return desbloqueo.MENSAJE_PENDIENTE;
  // #260: el código es de una URL, así que el mensaje dice de cuál.
  if (!conexion.desbloqueada_at) return desbloqueo.mensajeSinDesbloquear(await desbloqueo.nombreDeLaUrl(tokenId));
  return null;
}

const { horaLocal } = desbloqueo;

/**
 * La herramienta `desbloquear(codigo)`. Va aparte de HERRAMIENTAS porque no es
 * una consulta: cambia el estado de la conexión (por eso no lleva readOnlyHint,
 * y por eso las pruebas de «todo es de solo lectura» no la cuentan: solo existe
 * con MCP_CODIGO_OBLIGATORIO encendido). NUNCA se guarda el código en la
 * auditoría, ni siquiera el que falla.
 */
function registrarDesbloquear(server, { ambito, tokenId, conexion, origen }) {
  server.registerTool(
    'desbloquear',
    {
      title: 'Desbloquear con el código del CRM',
      description: 'Desbloquea esta conexión con el código que la persona saca en el CRM → Conexión → MCP, en la fila de la URL con la que está conectado este Claude (botón «Sacar código»). '
        + 'El código solo vale para esa URL. Úsala cuando una consulta conteste que hace falta un código, y pídeselo a la persona: no lo inventes.',
      inputSchema: { codigo: z.string().min(4).max(20).describe('El código que te dé la persona, por ejemplo K7QM-2XPA') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ codigo }) => {
      const inicio = Date.now();
      let ok = false;
      let error = null;
      try {
        // Sin conexión (no debería pasar: mcp.auth.js ya no deja entrar con la
        // llave de la URL sola) no hay nada que desbloquear.
        if (!conexion) {
          error = 'SIN_CONEXION';
          return { isError: true, content: [{ type: 'text', text: desbloqueo.mensajeSinDesbloquear(await desbloqueo.nombreDeLaUrl(tokenId)) }] };
        }
        if (conexion.estado === 'rechazada') {
          error = 'CONEXION_RECHAZADA';
          return { isError: true, content: [{ type: 'text', text: desbloqueo.MENSAJE_RECHAZADA }] };
        }
        const r = await desbloqueo.intentarDesbloqueo({ userId: ambito.userId, tokenId, conexionId: conexion.id, codigo });
        if (r.resultado === 'ok') {
          ok = true;
          // Sin caducidad por horas (#326): vale mientras este Claude siga
          // autorizado. Si aún no lo está, el código ya queda puesto.
          return { content: [{ type: 'text', text: conexion.estado === 'autorizada'
            ? 'Desbloqueado. Ya puedes consultar el CRM. No volverá a pedir el código mientras esta conexión de Claude siga autorizada.'
            : 'Código correcto. Falta un paso: esta conexión de Claude está pendiente de autorizar. Pide a la persona que la autorice '
              + 'en el CRM → Conexión → MCP, debajo de su URL; después ya podrás consultar sin volver a pedir el código.' }] };
        }
        if (r.resultado === 'de_otra_persona') {
          // Diego, 13/10: un error propio, para que Claude sepa qué decir, y
          // la alerta de «URL compartida» a quien vigila. No cuenta como fallo.
          error = 'CODIGO_DE_OTRA_PERSONA';
          alertas.alertarUrlCompartida({ tokenId, urlDe: r.urlDe, usadaPor: r.codigoDe });
          return { isError: true, content: [{ type: 'text', text:
            `Ese código es de otra persona: esta URL del MCP es de ${r.urlDe.nombre}; usa tu propia URL. `
            + 'Cada persona tiene su URL y sus códigos, y un código solo vale con la URL de quien lo sacó. '
            + 'Pide a la persona que conecte su Claude con SU URL (CRM → Conexión → MCP; la pone en Claude, en Configuración → Conectores) '
            + 'y use allí su código. Este intento no cuenta como fallo.' }] };
        }
        if (r.resultado === 'de_otra_url') {
          // #260: un código bueno, pero de otra URL de la misma persona. Cuenta como fallo.
          error = 'CODIGO_DE_OTRA_URL';
          return { isError: true, content: [{ type: 'text', text:
            `Ese código es de otra URL de la persona («${r.urlDe}»), no de la que usa este Claude. `
            + 'Pídele el código de la fila de la URL con la que está conectado este Claude (CRM → Conexión → MCP → «Sacar código»). '
            + `Quedan ${r.quedan} intentos antes de bloquear la conexión.` }] };
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
