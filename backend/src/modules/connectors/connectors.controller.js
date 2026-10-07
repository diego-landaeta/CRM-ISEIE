import { z } from 'zod';
import * as model from './connectors.model.js';
import * as service from './connectors.service.js';
import { generarToken } from '../mcp/mcp.acceso.js';
import * as mcpModel from '../mcp/mcp.model.js';
import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito, comoLista } from '../../shared/utils/ambito.js';

// `mcp`: «Servidor MCP» — no trae datos: da una URL para Claude, como la de
// Diana (modules/mcp), acotada al «Para quién» del conector. Diego, 29/09: «es
// para que dé la API y yo meterla en Claude y hacer mis consultas allí».
// Solo consulta, con todos los límites de aquel MCP.
const VALID_TYPES = ['woocommerce_products', 'woocommerce_orders', 'wp_rest', 'acf', 'custom_api', 'mcp'];
const ALCANCES = ['campus', 'empresa', 'sistema'];
const VALID_DESTINATIONS = ['product', 'lead', 'matricula', 'category'];

const createSchema = z.object({
  project_id:   z.number().int().positive(),
  type:         z.enum(VALID_TYPES),
  label:        z.string().min(1).max(150),
  destination:  z.enum(VALID_DESTINATIONS).default('product'),
  config:       z.record(z.any()).optional(),
  field_mapping: z.record(z.any()).optional(),
  alcance:      z.enum(ALCANCES).default('campus'),
  issuer_id:    z.number().int().positive().nullable().optional(),
});

const updateSchema = z.object({
  label:         z.string().min(1).max(150).optional(),
  destination:   z.enum(VALID_DESTINATIONS).optional(),
  config:        z.record(z.any()).optional(),
  field_mapping: z.record(z.any()).optional(),
  active:        z.boolean().optional(),
  alcance:       z.enum(ALCANCES).optional(),
  issuer_id:     z.number().int().positive().nullable().optional(),
  project_id:    z.number().int().positive().optional(),
});

/**
 * «PARA QUIÉN» LO DECIDE CÓMO ESTÁ LA PERSONA EN LAS EMPRESAS (Diego, 29/09).
 *
 *   · Super admin: todo, y es el único que hace o toca uno de todo el sistema.
 *   · Admin: solo los campus que tiene asignados (`user_projects`). Uno de
 *     TODA una empresa solo si está en TODOS sus campus: el conector lleva
 *     datos a cualquiera de ellos, y no puede llevarlos a uno que él no ve.
 *
 * Antes esto solo lo hacía la pantalla, que ofrece lo suyo; por la API se
 * podía pedir cualquier campus.
 */
const esSuperadmin = (req) => req.user?.role === 'superadmin';
const misCampus = (req) => (esSuperadmin(req) ? null : model.campusDeLaPersona(req.user?.userId));
const noEsTuyo = (que) => new AppError(`${que} no es tuyo: solo puedes usar los campus y empresas en los que estás.`, 403, 'FORBIDDEN');

async function estaEnTodaLaEmpresa(mios, issuerId) {
  const suyos = await model.campusDeLaEmpresa(issuerId);
  return suyos.length > 0 && suyos.every((id) => mios.includes(id));
}

/**
 * De quién es el conector: un campus, una empresa o todo el sistema. En uno de
 * empresa, el campus por defecto tiene que ser de esa empresa: si no, lo
 * importado podría acabar en un campus de otra sociedad.
 */
async function alcanceValido(req, { alcance = 'campus', issuer_id = null, project_id }) {
  if (alcance === 'sistema' && !esSuperadmin(req)) {
    throw new AppError('Solo un super admin puede hacer un conector de todo el sistema', 403, 'FORBIDDEN');
  }
  const mios = await misCampus(req);
  if (alcance === 'campus') {
    if (mios && !mios.includes(Number(project_id))) throw noEsTuyo('Ese campus');
    return { alcance, issuer_id: null };
  }
  if (alcance === 'sistema') return { alcance, issuer_id: null };
  if (!issuer_id) throw new AppError('Elige la empresa del conector', 400, 'VALIDATION_ERROR');
  if (mios && !(await estaEnTodaLaEmpresa(mios, issuer_id))) {
    throw new AppError('Para un conector de toda la empresa tienes que estar en todos sus campus.', 403, 'FORBIDDEN');
  }
  if (!(await model.campusEsDeLaEmpresa(project_id, issuer_id))) {
    throw new AppError('El campus por defecto tiene que ser de esa empresa', 400, 'VALIDATION_ERROR');
  }
  return { alcance, issuer_id };
}

/**
 * Si la persona puede VER un conector (listarlo, abrirlo, probarlo) o
 * TOCARLO (cambiarlo, borrarlo, importar). Ver: el de su campus y el de una
 * empresa en la que tiene algún campus. Tocar: el de su campus y el de una
 * empresa en la que está entera. Los de TODO EL SISTEMA, ni verlos: solo el
 * super admin (Diego, 29/09: «Antonio solo puede consultar y ver los de su
 * empresa; en cambio Manuel Casas puede ver TODO en todos lados»).
 */
async function acceso(req, c, que) {
  if (!c) throw new AppError('No encontrado', 404, 'NOT_FOUND');
  if (esSuperadmin(req)) return c;
  if (c.alcance === 'sistema') {
    throw new AppError('Este conector es de todo el sistema: solo lo ve y lo cambia un super admin', 403, 'FORBIDDEN');
  }
  const mios = await misCampus(req);
  if (c.alcance === 'empresa') {
    const suyos = await model.campusDeLaEmpresa(c.issuer_id);
    const ok = que === 'tocar' ? suyos.every((id) => mios.includes(id)) : suyos.some((id) => mios.includes(id));
    if (!ok) throw noEsTuyo('Ese conector');
    return c;
  }
  if (!mios.includes(Number(c.project_id))) throw noEsTuyo('Ese conector');
  return c;
}

/**
 * Las credenciales del conector NO salen de aqui.
 *
 * `config` guarda el `consumer_secret` de WooCommerce, la contrasena de
 * aplicacion de WordPress y el `bearer_token` de una API propia — y el modelo
 * las devuelve enteras, tanto al listar como al pedir una. O sea que estaban
 * viajando al navegador en cada carga de la pantalla, en texto plano.
 *
 * Se tapan AQUI y no en el modelo a proposito: `previewConnector` y el importador
 * leen del modelo y necesitan el valor de verdad para llamar al API externo. Lo
 * que no puede salir es por la puerta HTTP.
 *
 * Se manda `true`/`false` en vez del valor: la pantalla necesita saber si hay
 * algo guardado —para decir «•••• guardado, escribe para cambiarlo»— pero no
 * necesita el secreto para nada.
 *
 * Es la misma regla del panel de claves (#80): el valor no se devuelve nunca en
 * un listado.
 */
const SECRETOS = ['consumer_secret', 'wp_app_password', 'bearer_token', 'password', 'api_key', 'token'];

function sinSecretos(conector) {
  if (!conector) return conector;
  const config = { ...(conector.config || {}) };
  const guardados = {};
  for (const clave of Object.keys(config)) {
    if (!SECRETOS.includes(clave)) continue;
    guardados[clave] = Boolean(config[clave]);
    delete config[clave];
  }
  return { ...conector, config, secretos_guardados: guardados };
}

function cid(req) {
  const id = parseInt(req.params.id);
  if (isNaN(id) || id <= 0) throw new AppError('id inválido', 400, 'INVALID_ID');
  return id;
}

/** Si puede cambiar y borrar este conector: la misma regla que `acceso(…, 'tocar')`. */
async function puedeTocar(req, c, mios) {
  if (esSuperadmin(req)) return true;
  if (c.alcance === 'sistema') return false;
  if (c.alcance === 'empresa') {
    const suyos = await model.campusDeLaEmpresa(c.issuer_id);
    return suyos.length > 0 && suyos.every((id) => mios.includes(id));
  }
  return mios.includes(Number(c.project_id));
}

/**
 * Con un campus, los suyos. Con una EMPRESA (`issuerId`), los de todos sus
 * campus —Diego, 29/09: «no puedo estar con la empresa»—. Y SIN NINGUNO, con
 * «Todos los proyectos» arriba, todo lo que la persona puede ver: el super
 * admin, todo; un admin, lo de sus campus y sus empresas (Diego, 29/09: «que
 * funcione por empresa y todos los proyectos»).
 *
 * `?tipo=mcp` son las conexiones de Claude (Conexión → MCP) y `?tipo=datos` los
 * que traen datos (Conexión → Conectores).
 */
export async function list(req, res, next) {
  try {
    const { projectId, projectIds } = await proyectosDelAmbito(req);
    let ids = comoLista(projectId, projectIds);
    if (ids && ids.some((id) => !Number.isInteger(id))) {
      throw new AppError('Campus o empresa no válidos', 400, 'VALIDATION_ERROR');
    }
    const tipo = ['mcp', 'datos'].includes(req.query.tipo) ? req.query.tipo : null;
    // Un admin, solo sus campus: el de otro no se le enseña aunque lo pida.
    const mios = await misCampus(req);
    if (mios) {
      if (projectId && !mios.includes(Number(projectId))) throw noEsTuyo('Ese campus');
      ids = (ids || mios).filter((id) => mios.includes(id));
      if (!ids.length) return res.json({ success: true, data: [] });
    }
    const conectores = await model.listByAmbito(ids, { tipo, incluirSistema: esSuperadmin(req) });
    // En los «Servidor MCP», si esta persona ya tiene su URL (solo el inicio del
    // token y cuándo la usó Claude por última vez: la URL entera no se guarda).
    const deMcp = conectores.filter((c) => c.type === 'mcp').map((c) => c.id);
    const suyas = deMcp.length ? await mcpModel.tokensDeConectores(req.user?.userId, deMcp) : [];
    const porConector = new Map(suyas.map((t) => [t.connector_id, t]));
    res.json({
      success: true,
      data: await Promise.all(conectores.map(async (c) => ({
        ...sinSecretos(c),
        puede_tocar: await puedeTocar(req, c, mios),
        ...(c.type === 'mcp' ? { mcp_mio: porConector.get(c.id) || null } : {}),
      }))),
    });
  } catch (err) { next(err); }
}

export async function getById(req, res, next) {
  try {
    const c = await acceso(req, await model.findById(cid(req)), 'ver');
    res.json({ success: true, data: sinSecretos(c) });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const alcance = await alcanceValido(req, parsed.data);
    const c = await model.create({ ...parsed.data, ...alcance, created_by: req.user?.userId ?? null });
    // «Servidor MCP»: la URL para Claude sale ya, y es la única vez que se ve entera.
    const mcp = c.type === 'mcp' ? await urlNueva(req, c) : undefined;
    res.status(201).json({ success: true, data: { ...sinSecretos(c), ...(mcp ? { mcp } : {}) } });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');

    // GUARDAR NO PUEDE BORRAR EL SECRETO QUE NO SE MANDO.
    //
    // `update` reemplaza `config` entero. Como la pantalla lo recibe SIN los
    // secretos —los tapa `sinSecretos`— devolverlo tal cual al cambiar la
    // etiqueta dejaria el conector sin `consumer_secret` y sin decir nada: la
    // proxima importacion fallaria con un 401 y nadie relacionaria las dos cosas.
    //
    // Asi que el `config` que llega se FUSIONA sobre el guardado. Mandar una
    // clave la cambia; no mandarla la deja como estaba. Para borrarla de verdad
    // se manda vacia, que es explicito.
    const datos = { ...parsed.data };
    const actual = await acceso(req, await model.findById(cid(req)), 'tocar');
    if (datos.config) {
      datos.config = { ...(actual.config || {}), ...datos.config };
    }
    if (datos.alcance !== undefined || datos.issuer_id !== undefined || datos.project_id !== undefined) {
      Object.assign(datos, await alcanceValido(req, {
        alcance: datos.alcance ?? actual.alcance,
        issuer_id: datos.issuer_id !== undefined ? datos.issuer_id : actual.issuer_id,
        project_id: datos.project_id ?? actual.project_id,
      }));
    }

    const c = await model.update(cid(req), datos);
    if (!c) throw new AppError('No encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: sinSecretos(c) });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await acceso(req, await model.findById(cid(req)), 'tocar');
    await model.remove(cid(req));
    res.json({ success: true });
  } catch (err) { next(err); }
}

/**
 * La URL de ESTA persona para Claude en un conector «Servidor MCP».
 *
 * Es un token del MCP de Diana (`mcp_tokens`, se guarda solo su huella) atado
 * al conector: Claude ve lo de la persona DENTRO del «Para quién» del conector
 * (lo comprueba `verificarTokenMcp` en cada consulta). Una por persona y
 * conector: pedir otra revoca la anterior. Cada admin que pueda ver el conector
 * saca la suya, y con ella ve solo sus campus.
 */
async function urlNueva(req, c) {
  const userId = req.user?.userId;
  await mcpModel.revocarTokensDelConector(userId, c.id);
  const { token, hash, prefijo } = generarToken();
  await mcpModel.crearToken({ userId, nombre: `Conector: ${c.label}`.slice(0, 100), hash, prefijo, dias: null, connectorId: c.id });
  return { token, prefijo };
}

/** POST /api/connectors/:id/mcp-url — una URL nueva para Claude (la anterior deja de valer). */
export async function mcpUrl(req, res, next) {
  try {
    const c = await acceso(req, await model.findById(cid(req)), 'ver');
    if (c.type !== 'mcp') throw new AppError('Este conector no es un Servidor MCP', 400, 'VALIDATION_ERROR');
    res.status(201).json({ success: true, data: await urlNueva(req, c) });
  } catch (err) { next(err); }
}

const NO_IMPORTA = new AppError('Un Servidor MCP no trae datos: es la URL para consultar desde Claude.', 400, 'MCP_NO_IMPORTA');

// Trae 1-3 items de muestra del API externo + sugerencias de mapping
export async function preview(req, res, next) {
  try {
    const c = await acceso(req, await model.findById(cid(req)), 'ver');
    if (c.type === 'mcp') throw NO_IMPORTA;
    const data = await service.previewConnector(cid(req));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// Ejecuta el import asíncrono (responde 202 con jobId conceptual)
export async function runImport(req, res, next) {
  try {
    const id = cid(req);
    const c = await acceso(req, await model.findById(id), 'tocar');
    if (c.type === 'mcp') throw NO_IMPORTA;
    res.status(202).json({ success: true, data: { connector_id: id, status: 'running' } });
    // Background
    setImmediate(async () => {
      try {
        const result = await service.importFromConnector(id);
        // El log ya queda en service. El frontend hace polling de last_sync_at + last_sync_status
      } catch (err) {
        // ya se registra en recordSync 'error'
      }
    });
  } catch (err) { next(err); }
}
