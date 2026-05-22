import { query } from '../config/db.js';
import { AppError } from '../utils/AppError.js';

export async function projectAccess(req, _res, next) {
  const projectId = req.params.projectId || req.body.projectId || req.query.projectId;
  if (!projectId) {
    return next(new AppError('projectId requerido', 400, 'MISSING_PROJECT'));
  }

  if (req.user.role === 'superadmin' || req.user.role === 'soporte') {
    req.projectId = Number(projectId);
    return next();
  }

  const { rows } = await query(
    'SELECT 1 FROM user_projects WHERE user_id = $1 AND project_id = $2 AND active = true',
    [req.user.userId, projectId]
  );

  if (rows.length === 0) {
    return next(new AppError('No tienes acceso a este proyecto', 403, 'PROJECT_FORBIDDEN'));
  }

  req.projectId = Number(projectId);
  next();
}
