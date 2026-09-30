import crypto from 'crypto';
import * as model from './certifex.model.js';
import { recibirSchema, listarSchema, actualizarSchema } from './certifex.validation.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyAdmins } from '../notifications/notifications.service.js';

function parsear(schema, datos) {
  const r = schema.safeParse(datos);
  if (!r.success) throw new AppError(r.error.errors[0].message, 400, 'VALIDATION_ERROR');
  return r.data;
}

/**
 * ¿La peticion trae el secreto que compartimos con Certifex?
 *
 * Comparacion en tiempo constante, sobre el sha256 de los dos para que la longitud
 * no se filtre. Sin `CERTIFEX_WEBHOOK_SECRETO` en el .env la entrada esta CERRADA:
 * un 404, como si no existiera. Mejor que aceptar cualquier cosa por olvido.
 */
export function secretoValido(presentado) {
  const esperado = (process.env.CERTIFEX_WEBHOOK_SECRETO || '').trim();
  if (!esperado || typeof presentado !== 'string' || !presentado) return false;
  const a = crypto.createHash('sha256').update(presentado).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * PUBLICO, con secreto: Certifex entrega aqui cada consulta de su web.
 *
 * El aviso va por la CAMPANA, no por correo, igual que los tickets de soporte: el
 * equipo mira la campana cada dia, y un correo a un buzon que no existe seria dar el
 * aviso por hecho sin que llegue a nadie. Entra como ACCION (ver notifications/tipos.js):
 * alguien tiene que contestar.
 *
 * Un reintento de Certifex con la misma consulta no la duplica ni vuelve a avisar.
 */
export async function recibir(req, res, next) {
  try {
    if (!(process.env.CERTIFEX_WEBHOOK_SECRETO || '').trim()) {
      throw new AppError('No encontrado', 404, 'NOT_FOUND');
    }
    if (!secretoValido(req.get('X-Certifex-Secreto'))) {
      throw new AppError('No autorizado', 401, 'UNAUTHORIZED');
    }
    const d = parsear(recibirSchema, req.body);
    const { consulta, nueva } = await model.recibir(d);

    if (nueva) {
      const quien = consulta.tipo === 'centro' && consulta.organizacion ? consulta.organizacion : consulta.nombre;
      notifyAdmins({
        type: 'certifex_consulta',
        title: consulta.tipo === 'centro' ? `Certifex: ${quien} quiere inscribir su campus` : `Certifex: consulta de ${quien}`,
        message: consulta.mensaje.slice(0, 180),
        link_path: '/matriculas/certificaciones?vista=consultas',
        metadata: { consultaId: consulta.id, certifexId: consulta.certifexId, tipo: consulta.tipo },
      }).catch((e) => logger.error({ err: e.message, consultaId: consulta.id }, 'Aviso de consulta Certifex: error'));
    }

    res.status(nueva ? 201 : 200).json({ success: true, data: { id: consulta.id, duplicada: !nueva } });
  } catch (err) { next(err); }
}

export async function listar(req, res, next) {
  try {
    const f = parsear(listarSchema, req.query);
    const [data, nuevas] = await Promise.all([model.listar(f), model.recuentoNuevas()]);
    res.json({ success: true, data: { ...data, nuevas } });
  } catch (err) { next(err); }
}

export async function actualizar(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new AppError('Consulta no encontrada', 404, 'NOT_FOUND');
    const d = parsear(actualizarSchema, req.body);
    const c = await model.actualizar(id, d, req.user.userId);
    if (!c) throw new AppError('Consulta no encontrada', 404, 'NOT_FOUND');
    res.json({ success: true, data: c });
  } catch (err) { next(err); }
}
