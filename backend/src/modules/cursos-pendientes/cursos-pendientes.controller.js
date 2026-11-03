import { z } from 'zod';
import * as service from './cursos-pendientes.service.js';
import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito, comoLista } from '../../shared/utils/ambito.js';

const entero = z.coerce.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha tiene que ser AAAA-MM-DD');

const crearSchema = z.object({
  project_id: entero,
  nombre: z.string().trim().min(1).max(255),
  tipo: z.enum(['curso', 'diplomado', 'master']).optional(),
  product_id: entero.nullable().optional(),
  url_prevista: z.string().trim().max(2000).nullable().optional(),
  lead_id: entero.nullable().optional(),
  conversion_id: entero.nullable().optional(),
});

const modificarSchema = z.object({
  tutor_id: entero.nullable().optional(),
  fecha_comprometida: fecha.optional(),
  motivo: z.string().trim().max(1000).optional(),
  estado: z.enum(['en_desarrollo', 'cancelado', 'cerrado', 'publicado']).optional(),
  tipo: z.enum(['curso', 'diplomado', 'master']).optional(),
  avance_foto: z.boolean().optional(),
  avance_video: z.boolean().optional(),
  avance_modulos: z.coerce.number().int().optional(),
  notas: z.string().max(5000).nullable().optional(),
}).strict();

const publicarSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  sin_comprobar: z.boolean().optional(),
});

const sumarSchema = z.object({ lead_id: entero, conversion_id: entero.nullable().optional() });
const marcarSchema = z.object({
  estado: z.enum(['en_espera', 'habilitada', 'cancelada']).optional(),
  avisada: z.boolean().optional(),
});

function leer(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/**
 * Los campus que pide la pantalla, recortados a los de la persona. Una tutora no
 * se recorta por campus (ve los cursos que le han asignado), solo se filtra si
 * pide uno.
 */
async function campus(req) {
  if (req.user?.role === 'tutor') {
    const id = req.query.projectId ? Number(req.query.projectId) : null;
    return id ? [id] : null;
  }
  return comoLista(...Object.values(await proyectosDelAmbito(req)));
}

export async function listar(req, res, next) {
  try {
    const q = req.query;
    res.json({ success: true, data: await service.listar(req.user, {
      projectIds: await campus(req),
      estado: q.estado || null,
      tipo: q.tipo || null,
      abiertos: q.abiertos === 'true' ? true : q.abiertos === 'false' ? false : null,
      soloRetrasados: q.soloRetrasados === 'true',
      tutorId: q.tutorId ? Number(q.tutorId) : null,
    }) });
  } catch (err) { next(err); }
}

export async function resumen(req, res, next) {
  try {
    res.json({ success: true, data: await service.resumen(req.user, { projectIds: await campus(req) }) });
  } catch (err) { next(err); }
}

export async function detalle(req, res, next) {
  try { res.json({ success: true, data: await service.detalle(req.user, entero.parse(req.params.id)) }); } catch (err) { next(err); }
}

export async function crear(req, res, next) {
  try {
    const r = await service.crear(req.user, leer(crearSchema, req.body));
    res.status(r.nuevo ? 201 : 200).json({ success: true, data: r });
  } catch (err) { next(err); }
}

export async function modificar(req, res, next) {
  try {
    const cambios = leer(modificarSchema, req.body);
    res.json({ success: true, data: await service.modificar(req.user, entero.parse(req.params.id), cambios) });
  } catch (err) { next(err); }
}

export async function publicar(req, res, next) {
  try {
    const { url, sin_comprobar: sinComprobar } = leer(publicarSchema, req.body);
    res.json({ success: true, data: await service.publicar(req.user, entero.parse(req.params.id), { url, sinComprobar }) });
  } catch (err) { next(err); }
}

export async function sumarAlumna(req, res, next) {
  try {
    const d = leer(sumarSchema, req.body);
    res.status(201).json({ success: true, data: await service.sumarAlumna(req.user, entero.parse(req.params.id), d) });
  } catch (err) { next(err); }
}

export async function marcarAlumna(req, res, next) {
  try {
    const d = leer(marcarSchema, req.body);
    res.json({ success: true, data: await service.marcarAlumna(req.user, entero.parse(req.params.id), entero.parse(req.params.alumnaId), d) });
  } catch (err) { next(err); }
}
