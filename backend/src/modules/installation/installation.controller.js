import { query } from '../../shared/config/db.js';
import { listAllBundles, resolveActiveModules } from '../../bundles/manifest.js';
import { AppError } from '../../shared/utils/AppError.js';

export async function getInstallation(_req, res, next) {
  try {
    const { rows } = await query(`SELECT * FROM installation_bundles WHERE id = 1`);
    const inst = rows[0] || { active_bundles: [], license_type: 'unknown' };
    res.json({
      success: true,
      data: {
        installation: inst,
        availableBundles: listAllBundles(),
        activeModules: Array.from(resolveActiveModules(inst.active_bundles || [])),
      },
    });
  } catch (err) { next(err); }
}

export async function updateInstallation(req, res, next) {
  try {
    const { active_bundles, customer_name, notes, expires_at, license_type } = req.body || {};
    if (active_bundles && !Array.isArray(active_bundles)) {
      throw new AppError('active_bundles debe ser array', 400, 'VALIDATION_ERROR');
    }
    const sets = []; const params = []; let i = 1;
    if (active_bundles) {
      // 'core' siempre va incluido
      const bundles = Array.from(new Set(['core', ...active_bundles]));
      sets.push(`active_bundles = $${i++}`); params.push(bundles);
    }
    if (customer_name !== undefined) { sets.push(`customer_name = $${i++}`); params.push(customer_name); }
    if (notes !== undefined) { sets.push(`notes = $${i++}`); params.push(notes); }
    if (expires_at !== undefined) { sets.push(`expires_at = $${i++}`); params.push(expires_at); }
    if (license_type !== undefined) { sets.push(`license_type = $${i++}`); params.push(license_type); }
    if (!sets.length) throw new AppError('Sin cambios', 400, 'NO_CHANGES');
    sets.push(`updated_at = NOW()`);
    const { rows } = await query(`UPDATE installation_bundles SET ${sets.join(', ')} WHERE id = 1 RETURNING *`, params);
    res.json({
      success: true,
      data: {
        installation: rows[0],
        activeModules: Array.from(resolveActiveModules(rows[0].active_bundles || [])),
        warning: 'Reinicia el API para que los cambios tengan efecto en routing',
      },
    });
  } catch (err) { next(err); }
}
