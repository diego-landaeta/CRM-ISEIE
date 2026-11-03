import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { proyectosDelAmbito } from '../../shared/utils/ambito.js';
import { preguntar } from './preguntar.service.js';

const preguntaSchema = z.object({
  pregunta: z.string({ required_error: 'Escribe una pregunta' })
    .trim()
    .min(3, 'La pregunta es demasiado corta')
    .max(500, 'La pregunta es demasiado larga (máximo 500 caracteres)'),
});

/** Qué estado HTTP lleva cada fallo. El mensaje ya viene escrito para quien lee. */
const ESTADO = {
  SIN_CLAVE: 503,
  TOPE: 429,
  IA_NO_RESPONDE: 502,
  SIN_RESPUESTA: 422,
};

/**
 * POST /api/ia-analisis/preguntar?projectId=…|issuerId=…   { pregunta }
 *
 * EL ALCANCE SALE DE LA SESION, no del cuerpo (#245). `proyectosDelAmbito`
 * recorta por los campus de quien pregunta —un admin de una empresa solo mide
 * los suyos, y pedir uno ajeno es un 403— y eso es lo que se le pasa a las
 * consultas. Lo que el modelo diga de proyectos no cuenta.
 */
export async function preguntarCtrl(req, res, next) {
  try {
    const r = preguntaSchema.safeParse(req.body);
    if (!r.success) throw new AppError(r.error.issues[0].message, 400, 'VALIDATION_ERROR');

    const alcance = await proyectosDelAmbito(req);
    const respuesta = await preguntar({
      pregunta: r.data.pregunta,
      alcance,
      userId: req.user.userId,
    });

    if (!respuesta.ok) {
      return res.status(ESTADO[respuesta.codigo] || 500).json({
        success: false, error: respuesta.mensaje, code: respuesta.codigo, gasto: respuesta.gasto,
      });
    }
    return res.json({ success: true, data: respuesta });
  } catch (err) {
    return next(err);
  }
}
