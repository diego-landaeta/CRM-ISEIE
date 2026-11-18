import * as model from './links-pago.model.js';
import { listarSchema, idSchema, configQuerySchema, configBodySchema } from './links-pago.validation.js';
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
export async function detalle(req, res, next) {
  try {
    const parsed = idSchema.safeParse(req.params);
    if (!parsed.success) throw fallo(parsed);
    const link = await model.porId(parsed.data.id);
    const noEsta = new AppError('Link de pago no encontrado', 404, 'NOT_FOUND');
    if (!link) throw noEsta;

    const campus = await campusParaRecortar(req);
    if (campus && !campus.includes(Number(link.project_id))) throw noEsta;
    if (!dentroDelAlcance(await personasQueVe(req), link.created_by)) throw noEsta;

    const [eventos, cobros] = await Promise.all([model.eventos(link.id), model.cobros(link.id)]);
    res.json({ success: true, data: { ...link, eventos, cobros } });
  } catch (err) { next(err); }
}

// GET /api/links-pago/config?projectId=N
// El campus ya lo ha comprobado `projectAccess` (req.projectId).
export async function verConfig(req, res, next) {
  try {
    const parsed = configQuerySchema.safeParse({ projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const pct = await model.descuentoMaximo(parsed.data.projectId);
    if (pct === null) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    res.json({ success: true, data: { project_id: parsed.data.projectId, descuento_max_pct: pct } });
  } catch (err) { next(err); }
}

// PUT /api/links-pago/config
export async function guardarConfig(req, res, next) {
  try {
    const parsed = configBodySchema.safeParse({ ...req.body, projectId: req.projectId });
    if (!parsed.success) throw fallo(parsed);
    const { projectId, descuento_max_pct: pct } = parsed.data;
    const antes = await model.descuentoMaximo(projectId);
    if (antes === null) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
    const ahora = await model.guardarDescuentoMaximo(projectId, pct);

    // Quién cambió el tope y de cuánto a cuánto: es una regla de dinero.
    logger.info({ userId: req.user.userId, projectId, antes, ahora }, 'Links de pago: descuento máximo cambiado');
    query(
      `INSERT INTO user_activity_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)`,
      [req.user.userId, 'links_pago.descuento_max',
        JSON.stringify({ project_id: projectId, antes, ahora }), req.ip || null],
    ).catch((err) => logger.warn({ err: err.message }, 'Links de pago: no se pudo anotar el cambio de descuento'));

    res.json({ success: true, data: { project_id: projectId, descuento_max_pct: ahora } });
  } catch (err) { next(err); }
}
