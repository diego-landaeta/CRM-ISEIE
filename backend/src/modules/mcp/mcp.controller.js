import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './mcp.model.js';
import {
  diasDeVidaToken, configRotacion, MAX_TOKENS_VIVOS, ROLES_CON_ACCESO, ROLES_QUE_ADMINISTRAN, ROLES_SIN_MCP,
  generarToken, puedeUsarMcp,
} from './mcp.acceso.js';
import { HERRAMIENTAS } from './mcp.tools.js';
import * as desbloqueo from './mcp.desbloqueo.js';
import { accesoSchema, actividadSchema, crearTokenSchema, idSchema, interruptorSchema } from './mcp.validation.js';
import * as interruptorModel from './mcp.interruptor.js';
import * as actividadModel from './mcp.actividad.js';

/**
 * El panel «Conexión → MCP» del CRM. Aqui se usa el JWT normal del CRM: es la
 * persona, desde su navegador, gestionando SUS tokens. El MCP en si
 * (`POST /api/mcp`) va con el token personal y no pasa por aqui.
 */

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

async function personaActual(req) {
  const user = await model.findUserById(req.user.userId);
  if (!user) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
  return user;
}

/** GET /api/mcp/panel — lo que necesita la pantalla para pintarse. */
export async function estado(req, res, next) {
  try {
    const user = await personaActual(req);
    const tieneAcceso = puedeUsarMcp(user);
    const proyectos = tieneAcceso ? await model.proyectosDeLaPersona(user) : [];
    const tokens = tieneAcceso ? await model.listarTokens(user.id) : [];
    // Cuándo volverá a pedir el código cada URL (#192, Diego 05/10). Vacío con
    // el código apagado: entonces no se enseña nada.
    const urls = tieneAcceso ? await model.urlsVivasDeLaPersona(user.id) : [];
    const estados = await desbloqueo.estadoParaElPanel([
      ...tokens.filter((t) => t.vivo).map((t) => t.id), ...urls.map((u) => u.id),
    ]);
    res.json({
      success: true,
      data: {
        tieneAcceso,
        puedeAdministrar: ROLES_QUE_ADMINISTRAN.includes(user.role),
        soloLoSuyo: !ROLES_CON_ACCESO.includes(user.role),
        diasDeVida: diasDeVidaToken(),
        diasSinUso: configRotacion().diasSinUso,
        proyectos,
        herramientas: HERRAMIENTAS.map((h) => ({ nombre: h.nombre, titulo: h.titulo, descripcion: h.descripcion })),
        tokens: tokens.map((t) => ({ ...t, codigo: estados.get(t.id) || null })),
        // Interruptor de emergencia (#196): si el MCP está apagado y por qué.
        interruptor: await interruptorModel.estado(),
        puedeApagar: user.role === 'superadmin',
        // Código de desbloqueo (#192): si hace falta y cuánto dura cada cosa.
        // `resumen`: el estado actual en una línea, de todas sus URLs, para el
        // recuadro «Código para Claude».
        codigo: {
          ...(({ obligatorio, minutosCodigo, inactividadMin, maximoMin }) =>
            ({ obligatorio, minutosCodigo, inactividadMin, maximoMin }))(desbloqueo.config()),
          resumen: desbloqueo.resumenParaElPanel(urls, estados),
        },
      },
    });
  } catch (err) { next(err); }
}

/** POST /api/mcp/panel/tokens — crea un token y lo devuelve UNA sola vez. */
export async function crearToken(req, res, next) {
  try {
    const { nombre } = validar(crearTokenSchema, req.body);
    const user = await personaActual(req);
    if (!puedeUsarMcp(user)) throw new AppError('No tienes acceso al MCP del CRM', 403, 'FORBIDDEN');
    if (await model.contarTokensVivos(user.id) >= MAX_TOKENS_VIVOS) {
      throw new AppError(`Ya tienes ${MAX_TOKENS_VIVOS} URLs activas. Revoca alguna antes de crear otra.`, 400, 'MCP_DEMASIADOS_TOKENS');
    }
    const { token, hash, prefijo } = generarToken();
    const creado = await model.crearToken({ userId: user.id, nombre, hash, prefijo, dias: diasDeVidaToken() });
    logger.info({ userId: user.id, tokenId: creado.id }, 'MCP: token creado');
    res.status(201).json({ success: true, data: { ...creado, token } });
  } catch (err) { next(err); }
}

/** DELETE /api/mcp/panel/tokens/:id — revoca uno de SUS tokens. */
export async function revocarToken(req, res, next) {
  try {
    const { id } = validar(idSchema, req.params);
    const ok = await model.revocarToken(id, req.user.userId);
    if (!ok) throw new AppError('Token no encontrado', 404, 'NOT_FOUND');
    logger.info({ userId: req.user.userId, tokenId: id }, 'MCP: token revocado');
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
}

/** GET /api/mcp/panel/personas — quien tiene acceso (solo super admin y admin). */
export async function personas(req, res, next) {
  try {
    const quien = await personaActual(req);
    const lista = await model.listarPersonas(quien);
    res.json({
      success: true,
      data: lista.map((p) => ({
        ...p,
        porRol: ROLES_CON_ACCESO.includes(p.role),
        tieneAcceso: ROLES_CON_ACCESO.includes(p.role) || p.usa_mcp,
      })),
    });
  } catch (err) { next(err); }
}

/**
 * PATCH /api/mcp/panel/personas/:id — enciende o apaga la casilla.
 *
 * Apagarla PAUSA, no borra (decidido con Diana el 28/09). La puerta se cierra
 * en la siguiente consulta porque `puedeUsarMcp` se mira en cada peticion; pero
 * sus URLs no se revocan, asi que si se le devuelve el acceso vuelven a
 * funcionar en su Claude sin tener que crear otra y cambiarla en el conector.
 * Para cortar del todo esta «Revocar» (la persona) o desactivar el usuario.
 */
export async function cambiarAcceso(req, res, next) {
  try {
    const { id } = validar(idSchema, req.params);
    const { usa_mcp } = validar(accesoSchema, req.body);
    const quien = await personaActual(req);
    const persona = await model.findUserById(id);
    if (!persona || !persona.active) throw new AppError('Usuario no encontrado', 404, 'NOT_FOUND');
    if (ROLES_CON_ACCESO.includes(persona.role)) {
      throw new AppError('Super admin y admin ya tienen acceso por su rol.', 400, 'MCP_ACCESO_POR_ROL');
    }
    if (ROLES_SIN_MCP.includes(persona.role)) {
      throw new AppError('Este rol no puede tener acceso al MCP.', 400, 'MCP_ROL_NO_PERMITIDO');
    }
    if (quien.role !== 'superadmin' && !(await model.comparteProyecto(quien.id, persona.id))) {
      throw new AppError('Solo puedes dar acceso a personas de tus campus.', 403, 'FORBIDDEN');
    }
    await model.setUsaMcp(persona.id, usa_mcp);
    logger.info({ por: quien.id, userId: persona.id, usa_mcp }, 'MCP: acceso cambiado');
    res.json({ success: true, data: { id: persona.id, usa_mcp } });
  } catch (err) { next(err); }
}

/**
 * POST /api/mcp/panel/codigo — el código para dárselo a Claude (#192).
 *
 * Solo quien tiene acceso al MCP. Se enseña UNA vez; se guarda su huella.
 * Pedir otro anula el anterior.
 */
export async function crearCodigo(req, res, next) {
  try {
    const user = await personaActual(req);
    if (!puedeUsarMcp(user)) throw new AppError('No tienes acceso al MCP del CRM', 403, 'FORBIDDEN');
    const r = await desbloqueo.crearCodigo(user.id);
    logger.info({ userId: user.id }, 'MCP: código de desbloqueo creado');
    res.status(201).json({ success: true, data: { codigo: r.codigo, caducaAt: r.caducaAt, minutos: r.minutos } });
  } catch (err) { next(err); }
}

/**
 * POST /api/mcp/panel/tokens/:id/desbloquear — «Desbloquear desde aquí» (#192,
 * Diego 05/10, opción 3). Solo una URL SUYA y viva, con el código encendido, y
 * no si está bloqueada por códigos falsos. Queda en la Actividad.
 *
 * Sin `origen` en la auditoría a propósito: el navegador no es un Claude, y la
 * vigilancia (#195) lo tomaría por un cliente nuevo y mandaría una alerta.
 */
export async function desbloquearUrl(req, res, next) {
  const inicio = Date.now();
  try {
    const { id } = validar(idSchema, req.params);
    const user = await personaActual(req);
    if (!puedeUsarMcp(user)) throw new AppError('No tienes acceso al MCP del CRM', 403, 'FORBIDDEN');
    if (!desbloqueo.config().obligatorio) {
      throw new AppError('El código para Claude no está encendido: no hace falta desbloquear.', 400, 'MCP_CODIGO_APAGADO');
    }
    const r = await desbloqueo.desbloquearDesdePanel({ userId: user.id, tokenId: id });
    if (r.resultado === 'no_encontrada') throw new AppError('URL no encontrada', 404, 'NOT_FOUND');
    const ok = r.resultado === 'ok';
    await model.registrarAuditoria({
      userId: user.id, tokenId: id, herramienta: 'desbloquear_panel', parametros: null,
      ok, error: ok ? null : 'YA_BLOQUEADA', duracionMs: Date.now() - inicio,
    });
    if (!ok) {
      throw new AppError(`Esta URL está bloqueada hasta las ${desbloqueo.horaLocal(r.hasta)} por fallar el código demasiadas veces.`, 409, 'MCP_URL_BLOQUEADA');
    }
    logger.info({ userId: user.id, tokenId: id }, 'MCP: URL desbloqueada desde el panel');
    const estado = (await desbloqueo.estadoParaElPanel([id])).get(id) || null;
    res.json({ success: true, data: { id, caducaMaxAt: r.caducaMaxAt, codigo: estado } });
  } catch (err) { next(err); }
}

/**
 * GET /api/mcp/panel/actividad — quién consultó qué con Claude (#195).
 * Solo super admin y admin; un admin, solo lo de sus empresas.
 */
export async function actividad(req, res, next) {
  try {
    const filtros = validar(actividadSchema, req.query);
    const quien = await personaActual(req);
    const [lista, opciones] = await Promise.all([
      actividadModel.listarActividad(quien, filtros),
      actividadModel.opcionesActividad(quien),
    ]);
    res.json({ success: true, data: { ...lista, opciones } });
  } catch (err) { next(err); }
}

/**
 * POST /api/mcp/panel/interruptor — apaga o enciende TODO el MCP al momento
 * (#196). Solo super admin. Queda en la Actividad con quién y por qué.
 */
export async function interruptor(req, res, next) {
  try {
    const { apagado, motivo } = validar(interruptorSchema, req.body);
    if (!apagado && interruptorModel.apagadoPorEnv()) {
      throw new AppError('Está apagado desde el servidor (MCP_DISABLED=1 en el .env): el botón no puede encenderlo.', 409, 'MCP_APAGADO_POR_ENV');
    }
    const estado = await interruptorModel.cambiar({ userId: req.user.userId, apagado, motivo });
    await model.registrarAuditoria({
      userId: req.user.userId, tokenId: null, herramienta: apagado ? 'interruptor_apagar' : 'interruptor_encender',
      parametros: motivo ? { motivo } : null, ok: true, duracionMs: 0,
    });
    res.json({ success: true, data: estado });
  } catch (err) { next(err); }
}
