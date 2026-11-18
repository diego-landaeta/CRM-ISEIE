import { z } from 'zod';
import { AppError } from '../../shared/utils/AppError.js';
import { listaDelAmbito, campusDeTodos } from '../../shared/utils/ambito.js';
import * as service from './salud.service.js';

/*
  LA SALUD DE LAS CONEXIONES (CRM#533). Solo para ver.

  Los campus salen de quien pide, como el estado de #218: un admin, los suyos
  (con una empresa arriba, los suyos de esa empresa); el superadmin, todos los
  activos menos los de pruebas, salvo que elija uno. Nunca una clave.
*/

async function campusDelAmbito(req) {
  return (await listaDelAmbito(req)) || campusDeTodos(req);
}

// GET /api/integrations/salud?issuerId=N | projectId=N | projectIds=1,2 | nada
export async function salud(req, res, next) {
  try {
    res.json({ success: true, data: await service.saludDeLosCampus(await campusDelAmbito(req)) });
  } catch (err) { next(err); }
}

const comprobarSchema = z.object({
  // Un campus («Comprobar» de su fila) o, sin él, todos los de la vista.
  projectId: z.coerce.number().int().positive().optional(),
}).strict();

// POST /api/integrations/salud/comprobar   { projectId? }   (+ el ámbito en la query)
export async function comprobar(req, res, next) {
  try {
    const parsed = comprobarSchema.safeParse(req.body || {});
    if (!parsed.success) throw new AppError(parsed.error.errors[0].message, 400, 'VALIDATION_ERROR');
    const lista = await campusDelAmbito(req);
    let ids = lista;
    if (parsed.data.projectId) {
      // Fuera de lo suyo, como si no existiera: no se confirma que haya un campus con ese id.
      if (!lista.includes(parsed.data.projectId)) throw new AppError('Campus no encontrado', 404, 'NOT_FOUND');
      ids = [parsed.data.projectId];
    }
    const comprobados = await service.comprobarAhora(ids.filter((n) => n > 0));
    res.json({ success: true, data: await service.saludDeLosCampus(lista), comprobados });
  } catch (err) { next(err); }
}
