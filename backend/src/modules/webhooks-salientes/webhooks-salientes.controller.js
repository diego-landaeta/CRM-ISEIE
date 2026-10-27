import * as model from './webhooks-salientes.model.js';
import * as service from './webhooks-salientes.service.js';
import {
  crearWebhookSchema, cambiarWebhookSchema, listarEnviosSchema, METODOS_QUE_DISPARAN, EVENTO_DE,
} from './webhooks-salientes.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { tieneRol } from '../../shared/utils/roles.js';
import { campusDeLaPersona } from '../../shared/utils/ambito.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';

/*
  QUIÉN PUEDE (Diego, 15/10: solo super admin y admin).

  · Super admin: todo, y es el único que hace, ve o toca uno de TODAS LAS
    EMPRESAS.
  · Admin: los de sus campus (`user_projects`) y los de una empresa en la que
    está ENTERA. Un webhook de empresa manda los cobros de todos sus campus,
    con nombre, correo y DNI de cada cliente: quien no ve uno de esos campus no
    puede ni verlo ni ponerlo. La misma regla que «tocar» en Conectores.

  Quién entra lo dicen las rutas, con sus permisos del catálogo
  (`webhooks_salientes.*`, #423; de serie, admin). No va `projectAccess`: ese mira UN campus de la petición, y un
  webhook puede ser de una empresa o de todas. La comprobación equivalente se
  hace aquí, con el ámbito del propio webhook.
*/

const esSuperadmin = (req) => tieneRol(req.user, 'superadmin');
const misCampus = async (req) => (esSuperadmin(req) ? null : campusDeLaPersona(req.user?.userId));
const prohibido = (msg) => new AppError(msg, 403, 'FORBIDDEN');

function idDe(valor, que = 'id') {
  const id = Number.parseInt(valor, 10);
  if (!Number.isInteger(id) || id <= 0) throw new AppError(`${que} inválido`, 400, 'INVALID_ID');
  return id;
}

function validar(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/** Deja el ámbito en su forma: con «todas» no hay empresa ni campus, con «empresa» no hay campus… */
function normalizarAmbito({ ambito, issuer_id, project_id }) {
  if (ambito === 'todas') return { ambito, issuer_id: null, project_id: null };
  if (ambito === 'empresa') {
    if (!issuer_id) throw new AppError('Elige la empresa del webhook', 400, 'VALIDATION_ERROR');
    return { ambito, issuer_id, project_id: null };
  }
  if (!project_id) throw new AppError('Elige el campus del webhook', 400, 'VALIDATION_ERROR');
  return { ambito: 'campus', issuer_id: null, project_id };
}

/** Si esta persona puede tener un webhook con ese ámbito. Lanza si no. */
async function comprobarAmbito(req, { ambito, issuer_id, project_id }) {
  if (ambito === 'todas' && !(await tienePermiso(req, 'webhooks_salientes.todas'))) {
    throw prohibido('Un webhook de todas las empresas solo lo puede crear, ver o cambiar un super admin.');
  }
  if (ambito === 'empresa' && !(await model.existeEmpresa(issuer_id))) {
    throw new AppError('Esa empresa no existe', 400, 'VALIDATION_ERROR');
  }
  if (ambito === 'campus' && !(await model.existeCampus(project_id))) {
    throw new AppError('Ese campus no existe', 400, 'VALIDATION_ERROR');
  }
  const mios = await misCampus(req);
  if (!mios) return;
  if (ambito === 'campus' && !mios.includes(Number(project_id))) {
    throw prohibido('Ese campus no es tuyo: solo puedes usar los campus en los que estás.');
  }
  if (ambito === 'empresa') {
    const suyos = await model.campusDeLaEmpresa(issuer_id);
    if (!suyos.length || !suyos.every((id) => mios.includes(id))) {
      throw prohibido('Para un webhook de toda la empresa tienes que estar en todos sus campus.');
    }
  }
}

/** El webhook, si existe y esta persona puede con él. */
async function elWebhook(req, id) {
  const w = await model.porId(id);
  if (!w) throw new AppError('Ese webhook no existe', 404, 'NOT_FOUND');
  await comprobarAmbito(req, w);
  return w;
}

/** Lo que se le enseña a la pantalla. El secreto, nunca: solo su cola. */
function publico(w) {
  if (!w) return w;
  return {
    id: w.id,
    nombre: w.nombre,
    url: w.url,
    activo: w.activo,
    ambito: w.ambito,
    issuer_id: w.issuer_id,
    empresa: w.empresa || null,
    project_id: w.project_id,
    proyecto: w.proyecto || null,
    metodos: w.metodos,
    secreto_cola: w.secreto_cola || null,
    creado_por: w.creado_por,
    creado_por_nombre: w.creado_por_nombre || null,
    created_at: w.created_at,
    updated_at: w.updated_at,
    ultimo_envio_at: w.ultimo_envio_at || null,
    fallidos_30_dias: Number(w.fallidos_30_dias || 0),
  };
}

/** GET /api/webhooks-salientes?projectId=&issuerId= */
export async function listar(req, res, next) {
  try {
    const projectId = req.query.projectId ? idDe(req.query.projectId, 'Campus') : null;
    const issuerId = req.query.issuerId ? idDe(req.query.issuerId, 'Empresa') : null;
    const mios = await misCampus(req);
    if (mios && !mios.length) return res.json({ success: true, data: [] });
    const filas = await model.listar({ misCampus: mios, projectId, issuerId });
    res.json({ success: true, data: filas.map(publico) });
  } catch (err) { next(err); }
}

/** GET /api/webhooks-salientes/ejemplo — lo que se documenta en la pantalla. */
export async function ejemplo(_req, res, next) {
  try {
    res.json({
      success: true,
      data: {
        metodos: METODOS_QUE_DISPARAN,
        eventos: EVENTO_DE,
        cabeceras: service.CABECERAS,
        payload: { ...service.payloadDeEjemplo({ prueba: false, idempotencyKey: 'cobro-12345-webhook-3' }), enviado_at: new Date().toISOString() },
      },
    });
  } catch (err) { next(err); }
}

export async function uno(req, res, next) {
  try {
    res.json({ success: true, data: publico(await elWebhook(req, idDe(req.params.id))) });
  } catch (err) { next(err); }
}

/** POST — el secreto (generado o pegado) sale en la respuesta y es la única vez. */
export async function crear(req, res, next) {
  try {
    const d = validar(crearWebhookSchema, req.body);
    const ambito = normalizarAmbito(d);
    await comprobarAmbito(req, ambito);
    const secreto = d.secreto || service.generarSecreto();
    const w = await model.crear({
      ...d, ...ambito, secreto: service.cifrarSecreto(secreto), userId: req.user?.userId ?? null,
    });
    res.status(201).json({ success: true, data: { ...publico(w), secreto } });
  } catch (err) { next(err); }
}

/** PATCH — con `regenerar_secreto` o un `secreto` pegado, el nuevo sale una vez. */
export async function cambiar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    const d = validar(cambiarWebhookSchema, req.body);
    const actual = await elWebhook(req, id);
    const cambios = { ...d };
    delete cambios.secreto;
    delete cambios.regenerar_secreto;
    if (d.ambito !== undefined || d.issuer_id !== undefined || d.project_id !== undefined) {
      const ambito = normalizarAmbito({
        ambito: d.ambito ?? actual.ambito,
        issuer_id: d.issuer_id !== undefined ? d.issuer_id : actual.issuer_id,
        project_id: d.project_id !== undefined ? d.project_id : actual.project_id,
      });
      await comprobarAmbito(req, ambito);
      Object.assign(cambios, ambito);
    }
    const secreto = d.secreto || (d.regenerar_secreto ? service.generarSecreto() : null);
    if (secreto) cambios.secreto = service.cifrarSecreto(secreto);
    const w = await model.cambiar(id, { ...cambios, userId: req.user?.userId ?? null });
    if (!w) throw new AppError('Ese webhook no existe', 404, 'NOT_FOUND');
    res.json({ success: true, data: { ...publico(w), ...(secreto ? { secreto } : {}) } });
  } catch (err) { next(err); }
}

export async function borrar(req, res, next) {
  try {
    const id = idDe(req.params.id);
    await elWebhook(req, id);
    await model.borrar(id);
    res.json({ success: true, data: { id } });
  } catch (err) { next(err); }
}

/** POST /:id/prueba — «Enviar prueba»: un payload de ejemplo con `"prueba": true`. */
export async function prueba(req, res, next) {
  try {
    const w = await elWebhook(req, idDe(req.params.id));
    const envio = await service.enviarPrueba(w, req.user?.userId ?? null);
    res.json({ success: true, data: envio });
  } catch (err) { next(err); }
}

/**
 * GET /envios?webhookId=&estado=&limit=&projectId=&issuerId= — los últimos, solo de los webhooks
 * que puede ver y, con una empresa o un campus elegidos arriba, solo de los de ese ámbito: los
 * mismos que enseña la pantalla. Diego, 21/10: con ICTESS elegido salían los de Academia IA.
 */
export async function envios(req, res, next) {
  try {
    const f = validar(listarEnviosSchema, req.query);
    const mios = await misCampus(req);
    if (mios && !mios.length) return res.json({ success: true, data: [] });
    const ambito = { projectId: f.projectId ?? null, issuerId: f.projectId ? null : (f.issuerId ?? null) };
    const conAmbito = Boolean(ambito.projectId || ambito.issuerId);
    let webhookIds = null;
    if (mios || conAmbito) {
      webhookIds = (await model.listar({ misCampus: mios, ...ambito })).map((w) => w.id);
      if (!webhookIds.length) return res.json({ success: true, data: [] });
    }
    const campusContexto = conAmbito ? await model.campusDeContexto(ambito) : null;
    if (f.webhookId) await elWebhook(req, f.webhookId);
    res.json({ success: true, data: await model.listarEnvios({
      webhookIds, campusContexto, webhookId: f.webhookId, estado: f.estado, limit: f.limit,
    }) });
  } catch (err) { next(err); }
}

/** POST /envios/:envioId/reenviar — solo uno fallido. */
export async function reenviar(req, res, next) {
  try {
    const envioId = idDe(req.params.envioId, 'Envío');
    const e = await model.envioPorId(envioId);
    if (!e) throw new AppError('Ese envío no existe', 404, 'NOT_FOUND');
    await elWebhook(req, e.webhook_id);
    if (e.estado !== 'fallido') {
      throw new AppError('Solo se reenvía un envío fallido.', 409, 'NO_FALLIDO');
    }
    const r = await service.reenviar(envioId, req.user?.userId ?? null);
    res.json({ success: true, data: r });
  } catch (err) { next(err); }
}
