import { query } from '../../shared/config/db.js';
import * as model from './status.model.js';

// Verifica el estado real de cada componente del sistema
async function runHealthChecks() {
  const checks = {};

  // API — si este código ejecuta, la API está up
  checks.api = 'operational';

  // DB
  try {
    await query('SELECT 1');
    checks.db = 'operational';
  } catch {
    checks.db = 'major';
  }

  // Email (Brevo)
  checks.email = process.env.BREVO_API_KEY ? 'operational' : 'degraded';

  // Storage (R2)
  checks.storage = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) ? 'operational' : 'degraded';

  // IA (Claude)
  checks.ia = process.env.ANTHROPIC_API_KEY ? 'operational' : 'degraded';

  return checks;
}

export async function getSystemStatus() {
  const [components, activeIncidents, healthChecks] = await Promise.all([
    model.getComponents(),
    model.getActiveIncidents(),
    runHealthChecks(),
  ]);

  // Los componentes sin incidente activo usan el health check en tiempo real
  // Los que tienen incidente activo usan el status del incidente
  const affectedSlugs = new Set(activeIncidents.flatMap(i => i.affects));

  const enrichedComponents = components.map(c => ({
    ...c,
    status: affectedSlugs.has(c.slug) ? c.status : (healthChecks[c.slug] || c.status),
  }));

  const hasActiveIncident = activeIncidents.some(i => i.severity === 'critical');
  const hasWarning = activeIncidents.length > 0;

  const globalStatus = hasActiveIncident ? 'major' : hasWarning ? 'degraded' : 'operational';

  return {
    global_status: globalStatus,
    components: enrichedComponents,
    active_incidents: activeIncidents,
  };
}

export async function getIncidentHistory(limit = 30) {
  return model.getIncidents({ limit });
}

export async function createIncident(data) {
  const incident = await model.createIncident(data);
  // Actualizar status del componente si es crítico
  if (data.affects?.length && data.severity === 'critical') {
    for (const slug of data.affects) {
      await model.updateComponentStatus(slug, 'major');
    }
  }
  return incident;
}

export async function updateIncident(id, data) {
  const incident = await model.updateIncident(id, data);
  // Si se resuelve, volver los componentes a operational
  if (data.status === 'resolved' && incident?.affects?.length) {
    for (const slug of incident.affects) {
      await model.updateComponentStatus(slug, 'operational');
    }
  }
  return incident;
}

export async function updateComponent(slug, status) {
  return model.updateComponentStatus(slug, status);
}

export async function getErrors(limit = 100) {
  return model.getRecentErrors(limit);
}
