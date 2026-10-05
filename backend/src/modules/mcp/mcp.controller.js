import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import * as model from './mcp.model.js';
import {
  diasDeVidaToken, configRotacion, MAX_TOKENS_VIVOS, ROLES_CON_ACCESO, ROLES_QUE_ADMINISTRAN, ROLES_SIN_MCP,
  generarToken, puedeUsarMcp,
} from './mcp.acceso.js';
import { HERRAMIENTAS } from './mcp.tools.js';
import * as desbloqueo from './mcp.desbloqueo.js';
import { accesoSchema, actividadSchema, crearTokenSchema, idSchema } from './mcp.validation.js';
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
        tokens: tieneAcceso ? await model.listarTokens(user.id) : [],
        // Código de desbloqueo (#192): si hace falta y cuánto dura cada cosa.
        codigo: (({ obligatorio, minutosCodigo, inactividadMin, maximoMin }) =>
          ({ obligatorio, minutosCodigo, inactividadMin, maximoMin }))(desbloqueo.config()),
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
