import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { MoodleError } from '../../shared/services/moodle.client.js';
import { conexionDelCampus } from '../tutores/tutor.campus.js';
import {
  TIPOS, categoriaParaTipo, categoriasGuardadas, configDelCampus, lecturaDelCampus, proponerCategorias, vaciarCacheDelCampus,
} from '../products/formacion.moodle.js';
import * as model from './integrations.model.js';

/**
 * Integraciones › Moodle: en qué categoría del Moodle del campus va el curso de cada tipo
 * de formación (CRM#1113 / CRM-ISEIE#767, fase 2). Se guarda en `config_public` de la
 * integración (`categorias_formacion`), sin migración. Lo usa «Crear en Moodle».
 *
 * Leer las categorías es solo lectura en el Moodle; guardar solo escribe en el CRM.
 */

// GET /api/integrations/moodle/categorias?projectId=
export async function ver(req, res, next) {
  try {
    const pid = req.projectId;
    const conexion = await conexionDelCampus(pid);
    if (!conexion) throw new AppError('Este campus no tiene su Moodle conectado.', 409, 'SIN_MOODLE');
    if (conexion.error) throw new AppError(conexion.error, 409, 'SIN_MOODLE');
    if (req.query.refrescar === '1') vaciarCacheDelCampus();
    let lectura;
    try {
      lectura = await lecturaDelCampus(pid, conexion);
    } catch (err) {
      if (err instanceof MoodleError) throw new AppError(`No se han podido leer las categorías del campus: ${err.message}`, 502, 'MOODLE');
      throw err;
    }
    const guardadas = categoriasGuardadas(await configDelCampus(pid));
    const efectivas = Object.fromEntries(TIPOS.map((t) => [t, categoriaParaTipo(t, { guardadas, categorias: lectura.categorias })]));
    res.json({
      success: true,
      data: {
        // 'moodle': el árbol entero; 'cursos': el token no tiene core_course_get_categories y
        // solo se ven las que tienen algún curso, sin su categoría padre.
        fuente: lectura.fuente,
        categorias: lectura.categorias,
        propuesta: proponerCategorias(lectura.categorias),
        guardadas,
        efectivas,
      },
    });
  } catch (err) { next(err); }
}

const idOVacio = z.union([z.coerce.number().int().nonnegative().max(2147483647), z.null()]).optional();
const guardarSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  categorias: z.object({ curso: idOVacio, diplomado: idOVacio, master: idOVacio }).strict(),
});

// PUT /api/integrations/moodle/categorias  { projectId, categorias: { curso, diplomado, master } }
// Un id (0 = la de por defecto del Moodle) o null (= la que se propone por el nombre).
export async function guardar(req, res, next) {
  try {
    const d = guardarSchema.safeParse(req.body || {});
    if (!d.success) throw new AppError('Las categorías no son válidas', 400, 'VALIDATION_ERROR');
    const pid = req.projectId;
    const fila = await model.get(pid, 'moodle');
    if (!fila) throw new AppError('Este campus no tiene su Moodle conectado.', 409, 'SIN_MOODLE');
    const limpio = categoriasGuardadas({ categorias_formacion: d.data.categorias });
    await model.fundirConfigPublica({ projectId: pid, provider: 'moodle', campos: { categorias_formacion: limpio } });
    res.json({ success: true, data: { guardadas: limpio } });
  } catch (err) { next(err); }
}
