import { query } from '../../shared/config/db.js';
import { AppError } from '../../shared/utils/AppError.js';
import { projectAccess } from '../../shared/middleware/projectAccess.js';

/*
  Un campus o una empresa entera.

  Diego, 22/09: «el proceso comercial es por empresa, también tenerlo en
  cuenta». Con CEDIA puesta, la pantalla enseñaba el muro de «elige un campus»:
  los pasos se guardan por proyecto —`commercial_steps.project_id`— y no había
  forma de decir «los de CEDIA».

  Y sin embargo los siete campus de CEDIA llevan EL MISMO proceso, paso por
  paso: el documento comercial es uno solo. Comprobado en producción y en
  staging, los nueve proyectos tienen la misma huella de pasos. Así que lo que
  hacía falta no era un proceso nuevo por empresa, sino dejar de preguntar.

  Con `issuerId`, el proceso de la empresa ES el de sus campus, y lo que se
  cambia se cambia en todos a la vez. Si algún día uno se separa, la pantalla
  lo dice y deja elegir: eso se ve en `en_campus` de cada paso.
*/

/**
 * Deja en la peticion el ambito de los pasos:
 *
 *   un campus  →  req.projectId = 7,  req.projectIds = [7]
 *   una empresa →  req.projectId = <el primero>, req.projectIds = [1, 2, 3, …]
 *
 * Sin `issuerId` se comporta exactamente como antes.
 */
export async function ambitoDelProceso(req, res, next) {
  const issuerId = Number(req.query?.issuerId || req.body?.issuerId) || null;
  if (!issuerId) {
    // El camino de siempre, con su comprobacion de acceso al proyecto.
    return projectAccess(req, res, () => {
      req.projectIds = req.projectId ? [req.projectId] : [];
      next();
    });
  }

  try {
    const { rows } = await query(
      'SELECT id FROM projects WHERE sociedad_emisora_id = $1 ORDER BY id', [issuerId]);
    let ids = rows.map((r) => r.id);

    // A quien no lo ve todo se le recorta a los campus que son suyos. No es lo
    // mismo que negarle la empresa: puede llevar tres de los siete.
    if (req.user.role !== 'superadmin' && req.user.role !== 'soporte') {
      const { rows: mios } = await query(
        `SELECT project_id FROM user_projects
          WHERE user_id = $1 AND active = true AND project_id = ANY($2::int[])`,
        [req.user.userId, ids.length ? ids : [-1]]
      );
      ids = mios.map((r) => r.project_id);
    }

    if (!ids.length) {
      throw new AppError('No tienes acceso a ningún campus de esta empresa', 403, 'PROJECT_FORBIDDEN');
    }
    req.projectIds = ids;
    req.projectId = ids[0];
    next();
  } catch (err) { next(err); }
}
