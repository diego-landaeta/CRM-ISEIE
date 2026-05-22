import { query } from '../../shared/config/db.js';

export async function findAll({ projectId }) {
  const { rows } = await query(
    `SELECT s.*, COUNT(r.id) FILTER (WHERE r.status = 'active') as active_runs,
            COUNT(r.id) FILTER (WHERE r.status = 'completed') as completed_runs
       FROM email_sequences s
       LEFT JOIN email_sequence_runs r ON r.sequence_id = s.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at DESC`,
    [projectId]
  );
  return rows;
}

export async function findById(id) {
  const { rows } = await query(`SELECT * FROM email_sequences WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function create(data) {
  const { rows } = await query(
    `INSERT INTO email_sequences (project_id, nombre, trigger_event, trigger_filter, steps, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [data.project_id, data.nombre, data.trigger_event,
     JSON.stringify(data.trigger_filter || {}), JSON.stringify(data.steps || []),
     data.active !== false, data.created_by || null]
  );
  return rows[0];
}

export async function update(id, fields) {
  const allowed = ['nombre', 'trigger_event', 'trigger_filter', 'steps', 'active'];
  const jsonbFields = new Set(['trigger_filter', 'steps']);
  const sets = []; const params = []; let idx = 1;
  for (const k of allowed) {
    if (fields[k] !== undefined) {
      sets.push(`${k} = $${idx++}`);
      params.push(jsonbFields.has(k) ? JSON.stringify(fields[k]) : fields[k]);
    }
  }
  if (!sets.length) return null;
  sets.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await query(`UPDATE email_sequences SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`, params);
  return rows[0];
}

export async function remove(id) {
  await query(`DELETE FROM email_sequences WHERE id = $1`, [id]);
}

// ====== Runs ======
export async function listRuns({ projectId, leadId, sequenceId, status }) {
  const conditions = []; const params = []; let idx = 1;
  if (projectId) { conditions.push(`s.project_id = $${idx++}`); params.push(projectId); }
  if (leadId) { conditions.push(`r.lead_id = $${idx++}`); params.push(leadId); }
  if (sequenceId) { conditions.push(`r.sequence_id = $${idx++}`); params.push(sequenceId); }
  if (status) { conditions.push(`r.status = $${idx++}`); params.push(status); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const { rows } = await query(
    `SELECT r.*, s.nombre as sequence_nombre, s.steps, l.nombre as lead_nombre, l.email as lead_email
       FROM email_sequence_runs r
       JOIN email_sequences s ON s.id = r.sequence_id
       LEFT JOIN leads l ON l.id = r.lead_id
       ${where}
       ORDER BY r.next_send_at ASC NULLS LAST, r.id DESC LIMIT 200`,
    params
  );
  return rows;
}

export async function startRun(sequenceId, leadId) {
  const seq = await findById(sequenceId);
  if (!seq || !seq.active || !Array.isArray(seq.steps) || seq.steps.length === 0) return null;
  const firstDelay = Number(seq.steps[0]?.delay_hours || 0);
  const nextSend = new Date(Date.now() + firstDelay * 3600 * 1000);
  const { rows } = await query(
    `INSERT INTO email_sequence_runs (sequence_id, lead_id, current_step, next_send_at, status)
     VALUES ($1, $2, 0, $3, 'active')
     ON CONFLICT (lead_id, sequence_id) DO NOTHING
     RETURNING *`,
    [sequenceId, leadId, nextSend]
  );
  return rows[0] || null;
}

export async function stopRun(runId) {
  await query(`UPDATE email_sequence_runs SET status = 'stopped', updated_at = NOW() WHERE id = $1`, [runId]);
}

export async function advanceRun(runId, lastError = null) {
  const { rows } = await query(`SELECT r.*, s.steps FROM email_sequence_runs r JOIN email_sequences s ON s.id = r.sequence_id WHERE r.id = $1`, [runId]);
  const r = rows[0];
  if (!r) return null;
  const nextStep = r.current_step + 1;
  if (nextStep >= r.steps.length) {
    await query(`UPDATE email_sequence_runs SET status = 'completed', last_sent_at = NOW(), updated_at = NOW(), last_error = $2 WHERE id = $1`, [runId, lastError]);
  } else {
    const delay = Number(r.steps[nextStep]?.delay_hours || 0);
    const nextSend = new Date(Date.now() + delay * 3600 * 1000);
    await query(`UPDATE email_sequence_runs SET current_step = $2, next_send_at = $3, last_sent_at = NOW(), last_error = $4, updated_at = NOW() WHERE id = $1`, [runId, nextStep, nextSend, lastError]);
  }
}

export async function findDueRuns(limit = 50) {
  const { rows } = await query(
    `SELECT r.*, s.steps, s.project_id, l.email as lead_email, l.nombre as lead_nombre
       FROM email_sequence_runs r
       JOIN email_sequences s ON s.id = r.sequence_id
       LEFT JOIN leads l ON l.id = r.lead_id
      WHERE r.status = 'active'
        AND r.next_send_at IS NOT NULL
        AND r.next_send_at <= NOW()
      ORDER BY r.next_send_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}
