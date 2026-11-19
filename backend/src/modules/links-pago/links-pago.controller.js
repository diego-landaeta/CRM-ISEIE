import * as model from './links-pago.model.js';
import * as service from './links-pago.service.js';
import {
  listarSchema, idSchema, configQuerySchema, configBodySchema, crearSchema, anularSchema, webhookAccionSchema,
} from './links-pago.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { query } from '../../shared/config/db.js';
import { tienePermiso } from '../../shared/middleware/permissions.js';
import { listaDelAmbito, campusDeTodos, campusParaRecortar } from '../../shared/utils/ambito.js';
import { alcanceComercial, dentroDelAlcance, personasDentro } from '../../shared/utils/roles.js';

/*
  QUIÉN VE QUÉ LINK (CRM#680, criterio 6 de Diego).

  «Cada gestora ve solo sus links; admin y superadmin, los de su alcance
  (`listaDelAmbito`), con su permiso en `catalogo.js`.»

  Dos recortes, como en el resto del CRM, y se aplican los dos:
    · campus: los de la persona (`listaDelAmbito` / `campusParaRecortar`);
    · personas: con `links_pago.ver_todos`, su alcance comercial (null = todas
      las de sus campus; quien lleva un equipo, el suyo). Sin él, solo los
      links que creó ella (o los de su equipo, si lo lleva).

  Siempre con la sesión, nunca con lo que diga la URL.
*/
async function personasQueVe(req) {
  const alcance = await alcanceComercial(req.user);
  if (await tienePermiso(req, 'links_pago.ver_todos')) return alcance;
  return alcance || [Number(req.user.userId)];
}

function fallo(parsed) {
  return new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
}

// GET /api/links-pago
export async function listar(req, res, next) {
  try {
    const parsed = listarSchema.safeParse(req.query);
    if (!parsed.success) throw fallo(parsed);
    const { estado, leadId, conversionId, createdBy, page, limit } = parsed.data;

    const projectIds = (await listaDelAmbito(req)) || await campusDeTodos(req);
    const creadores = await personasQueVe(req);
    // Pedir los de una persona fuera del alcance no da error: da los del alcance.
    // `personasDentro` es el `acotarAlAlcance` de MultiCRM: null (todas) o una lista.
    const { rows, total } = await model.listar({
      projectIds,
      creadores: personasDentro(creadores, createdBy),
      createdBy: null,
      estado, leadId, conversionId, page, limit,
    });
    res.json({
      success: true,
      data: rows,
      pagination: { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  } catch (err) { next(err); }
}

// GET /api/links-pago/:id
// Fuera de su campus o de su alcance es un 404, como si no existiera: no se
// confirma que haya un link de otra empresa o de otra gestora con ese id.
async function linkSuyo(req) {
  const parsed = idSchema.safeParse(req.params);
  if (!parsed.success) throw fallo(parsed);
  const link = await model.porId(parsed.data.id);
  const noEsta = new AppError('Link de pago no encontrado', 404, 'NOT_FOUND');
  if (!link) throw noEsta;

  const campus = await campusParaRecortar(req);
  if (campus && !campus.includes(Number(link.project_id))) throw noEsta;
  if (!dentroDelAlcance(await personasQueVe(req), link.created_by)) throw noEsta;
  return link;
}

export async function detalle(req, res, next) {
  try {
    const link = await linkSuyo(req);
    const [eventos, cobros] = await Promise.all([model.eventos(link.id), model.cobros(link.id)]);
    res.json({ success: true, data: { ...link, eventos, cobros } });
  } catch (err) { next(err); }
}

// ─── Configuración del campus (Integraciones › Links de pago) ───────────────

// GET /api/links-pago/config?projectId=N
// El campus ya lo ha comprobado `projectAccess` (req.projectId). Lo lee también
// quien crea links: la pantalla de crear necesita las monedas y la caducidad.
export async function verConfig(req, res, next) {
  try {
    const parsed = configQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const cfg = await model.config(parsed.data.projectId);
    if (!cfg) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: { project_id: parsed.data.projectId, ...cfg } });
  } catch (err) { next(err); }
}

// Quién cambió qué: son reglas de dinero. Se espera a apuntarlo, pero si falla
// no tumba el cambio, que ya está hecho.
function anotar(req, action, details) {
  return query(
    'INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
    [req.user.userId, action, JSON.stringify(details), req.ip || null],
  ).catch((err) => logger.warn({ err: err.message, action }, 'Links de pago: no se pudo anotar el cambio'));
}

// PUT /api/links-pago/config — solo lo que venga; lo demás, como estaba.
export async function guardarConfig(req, res, next) {
  try {
    const parsed = configBodySchema.safeParse({ ...req.body, projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const { projectId, ...pedidos } = parsed.data;
    const cambios = Object.fromEntries(Object.entries(pedidos).filter(([, v]) => v !== undefined));
    if (cambios.monedas) cambios.monedas = [...new Set(cambios.monedas)];
    const antes = await model.config(projectId);
    if (!antes) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');

    // Las reglas entre campos, con lo que ya hay: así el mensaje es claro y no
    // el de un CHECK de la base.
    const despues = { ...antes, ...cambios };
    if (despues.caducidad_dias > despues.caducidad_max_dias) {
      throw new AppError(`La caducidad por defecto (${despues.caducidad_dias} días) no puede pasar de la máxima (${despues.caducidad_max_dias}).`, 400, 'VALIDATION_ERROR');
    }
    if (!despues.monedas.includes(despues.moneda_defecto)) {
      throw new AppError(`La moneda por defecto (${despues.moneda_defecto}) tiene que estar entre las admitidas (${despues.monedas.join(', ')}).`, 400, 'VALIDATION_ERROR');
    }
    const ahora = await model.guardarConfig(projectId, cambios);

    // Quién cambió qué y de cuánto a cuánto: son reglas de dinero.
    const cambiado = Object.keys(cambios).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(ahora[k]));
    logger.info({ userId: req.user.userId, projectId, cambiado }, 'Links de pago: configuración cambiada');
    if (cambiado.length) {
      await anotar(req, cambiado.length === 1 && cambiado[0] === 'descuento_max_pct' ? 'links_pago.descuento_max' : 'links_pago.config', {
        project_id: projectId,
        antes: Object.fromEntries(cambiado.map((k) => [k, antes[k]])),
        ahora: Object.fromEntries(cambiado.map((k) => [k, ahora[k]])),
      });
    }
    res.json({ success: true, data: { project_id: projectId, ...ahora } });
  } catch (err) { next(err); }
}

// ─── Crear y anular (fase 2) ────────────────────────────────────────────────

/*
  El prospecto o la venta, si la persona puede crearle un link: de uno de SUS
  campus y, si solo ve lo suyo, suyo (responsable del prospecto o vendedora de
  la venta). Si no, 404, como si no existiera.
*/
async function destinoSuyo(req, { leadId, conversionId }) {
  const noEsta = (que) => new AppError(`${que} no encontrado`, 404, 'NOT_FOUND');
  let destino;
  if (conversionId) {
    const v = await model.venta(conversionId);
    if (!v) throw noEsta('Venta');
    if (leadId && Number(leadId) !== Number(v.lead_id)) throw new AppError('Esa venta no es de ese prospecto', 400, 'VALIDATION_ERROR');
    destino = { projectId: Number(v.project_id), leadId: v.lead_id, conversionId: v.id,
      duenos: [v.vendedora_id, v.responsable_id], que: 'Venta' };
  } else {
    const l = await model.lead(leadId);
    if (!l) throw noEsta('Prospecto');
    destino = { projectId: Number(l.project_id), leadId: l.id, conversionId: null,
      duenos: [l.responsable_id], que: 'Prospecto' };
  }
  const campus = await campusParaRecortar(req);
  if (campus && !campus.includes(destino.projectId)) throw noEsta(destino.que);
  const alcance = await alcanceComercial(req.user);
  if (alcance && !destino.duenos.some((d) => d != null && dentroDelAlcance(alcance, d))) throw noEsta(destino.que);
  return destino;
}

// POST /api/links-pago
export async function crear(req, res, next) {
  try {
    const parsed = crearSchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const b = parsed.data;
    const destino = await destinoSuyo(req, b);

    const prod = await model.producto(b.productId);
    // Un curso de otro campus no vale: el precio y el nombre serían de otro sitio.
    if (!prod || Number(prod.project_id) !== destino.projectId) {
      throw new AppError('Ese curso no es del catálogo de este campus', 400, 'VALIDATION_ERROR');
    }
    const cfg = await model.config(destino.projectId);
    const reglas = service.comprobarReglas({
      cfg, prod, importe: b.importe, moneda: b.moneda, caducidadDias: b.caducidad_dias,
      modalidad: b.modalidad, esAdmin: await tienePermiso(req, 'links_pago.configurar'),
      // Desde una venta, el tope de descuento se mide contra lo pendiente (fase 3).
      pendiente: destino.conversionId ? await model.pendienteDeVenta(destino.conversionId) : undefined,
    });
    const link = await service.crear({
      projectId: destino.projectId, leadId: destino.leadId, conversionId: destino.conversionId,
      prod, reglas, importe: b.importe, userId: Number(req.user.userId),
    });
    res.status(201).json({ success: true, data: link });
  } catch (err) { next(err); }
}

// POST /api/links-pago/:id/anular { motivo }
// Quien lo creó, o quien ve los de los demás en su alcance. Lo ajeno, 404.
export async function anular(req, res, next) {
  try {
    const link = await linkSuyo(req);
    const parsed = anularSchema.safeParse(req.body || {});
    if (!parsed.success) throw fallo(parsed);
    const hecho = await service.anular(link, { userId: Number(req.user.userId), motivo: parsed.data.motivo });
    res.json({ success: true, data: hecho });
  } catch (err) { next(err); }
}

// ─── El webhook de la cuenta (solo quien configura) ─────────────────────────

// GET /api/links-pago/webhook?projectId=N
export async function verWebhook(req, res, next) {
  try {
    const parsed = configQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const data = await service.verWebhook(parsed.data.projectId, { campusVisibles: await campusParaRecortar(req) });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// PUT /api/links-pago/webhook { projectId, accion }
export async function cambiarWebhook(req, res, next) {
  try {
    const parsed = webhookAccionSchema.safeParse({ ...req.body, projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const { projectId, accion } = parsed.data;
    const data = await service.cambiarWebhook(projectId, accion, { campusVisibles: await campusParaRecortar(req) });
    if (data.cambiado) {
      logger.info({ userId: req.user.userId, projectId, accion, endpointId: data.endpoint_id }, 'Links de pago: webhook de Stripe cambiado');
      await anotar(req, 'links_pago.webhook', { project_id: projectId, accion, endpoint_id: data.endpoint_id, activo: data.activo });
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

