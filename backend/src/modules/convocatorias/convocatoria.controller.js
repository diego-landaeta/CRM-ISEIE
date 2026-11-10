import * as Conv from './convocatoria.service.js';
import { listaDelAmbito, campusDeTodos } from '../../shared/utils/ambito.js';
import {
  crearConvocatoriaSchema, editarConvocatoriaSchema,
  ofrecerSchema, actualizarOfrecimientoSchema,
} from './convocatoria.validation.js';

// A quién se le recorta. Igual que en los informes: lo decide el servidor, no
// lo que llegue por la URL. Una gestora solo ve lo suyo.
function deQuien(req) {
  const rol = req.user?.role;
  if (rol === 'admin' || rol === 'superadmin') {
    return req.query.gestoraId ? Number(req.query.gestoraId) : null;
  }
  return req.user?.userId || -1;
}

// Los campus del embudo y de los pendientes: los que pida, dentro de los suyos;
// sin pedir ninguno, los suyos (antes, los de todas las empresas).
const proyectos = (req) => listaDelAmbito(req);

export async function listar(req, res, next) {
  try {
    const data = await Conv.listar(req.projectId, {
      incluirInactivas: req.query.incluirInactivas === 'true',
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// GET /api/convocatorias/ambito — las de todos los campus de quien pide, para
// «Todos» o una empresa (#218, Diego 04/11). Crear sigue siendo de un campus.
export async function listarDelAmbito(req, res, next) {
  try {
    const campus = (await listaDelAmbito(req)) || await campusDeTodos(req);
    const data = await Conv.listar(campus, {
      incluirInactivas: req.query.incluirInactivas === 'true',
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function crear(req, res, next) {
  try {
    const data = await Conv.crear(req.projectId, crearConvocatoriaSchema.parse(req.body));
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function editar(req, res, next) {
  try {
    const data = await Conv.editar(Number(req.params.id), req.projectId,
      editarConvocatoriaSchema.parse(req.body));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function ofrecer(req, res, next) {
  try {
    const datos = ofrecerSchema.parse(req.body);
    const data = await Conv.ofrecer(Number(req.params.id), {
      ...datos, ofrecidaPor: req.user?.userId || null,
    });
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function actualizarOfrecimiento(req, res, next) {
  try {
    const data = await Conv.actualizarOfrecimiento(Number(req.params.id),
      actualizarOfrecimientoSchema.parse(req.body));
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function deLead(req, res, next) {
  try {
    res.json({ success: true, data: await Conv.ofrecimientosDeLead(Number(req.params.leadId)) });
  } catch (err) { next(err); }
}

export async function pendientes(req, res, next) {
  try {
    const data = await Conv.pendientesDeRespuesta({
      projectIds: await proyectos(req), asesoraId: deQuien(req),
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function embudo(req, res, next) {
  try {
    const re = /^\d{4}-\d{2}-\d{2}$/;
    const data = await Conv.embudo({
      convocatoriaId: req.query.convocatoriaId ? Number(req.query.convocatoriaId) : null,
      projectIds: await proyectos(req),
      from: re.test(req.query.from || '') ? req.query.from : null,
      to: re.test(req.query.to || '') ? req.query.to : null,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
