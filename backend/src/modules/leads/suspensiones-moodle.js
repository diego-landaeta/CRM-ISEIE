/*
  SUSPENSIONES DE MOODLE EN LA FICHA DEL ALUMNO (CRM#531).

  Lo que el plugin `local_crm` 1.13.0 avisa —cada suspensión y reactivación de la cuenta o
  de una matrícula, con el motivo que dedujo el CRM al recibirlo (consultas.estadoAlumno.js)—
  leído de `moodle_estado_alumno` (migración 333). No llama a ningún campus.

  ESTADO por campus, con el ÚLTIMO aviso de cada cosa (la cuenta y cada curso):
    · suspendido  alguna sigue suspendida: desde cuándo y por qué (la suspensión más reciente);
    · reactivado  ninguna lo está y la última noticia fue una reactivación;
  y si Moodle nunca ha avisado de nada, la ficha dice «Al día».

  El filtro «Suspendidos» de Clientes usa la misma regla (`SUSPENDIDO_EN_MOODLE`).

  Va detrás de SUSPENSIONES_MOODLE_EN_PRODUCCION: apagado, `disponible: false`.
*/
import { query } from '../../shared/config/db.js';
import { suspensionesMoodleActivas } from '../../shared/config/soloEnPruebas.js';

// ¿Está la tabla (migración 333)? Encontrada, no se vuelve a mirar; sin ella, se mira de
// nuevo al minuto: así, aplicada la migración, entra sola sin reiniciar la API.
let hayTabla = false;
let miradoAt = 0;
export function _olvidarTabla() { hayTabla = false; miradoAt = 0; }
async function existeLaTabla() {
  if (hayTabla) return true;
  if (Date.now() - miradoAt < 60_000) return false;
  miradoAt = Date.now();
  try {
    const { rows } = await query(`SELECT to_regclass('public.moodle_estado_alumno') IS NOT NULL AS hay`);
    hayTabla = Boolean(rows[0]?.hay);
  } catch { hayTabla = false; }
  return hayTabla;
}

/**
 * Encendido (SUSPENSIONES_MOODLE_EN_PRODUCCION) Y con la migración 333 aplicada. Sin la
 * tabla, la lista de Clientes no puede romperse por pedir una columna que no existe.
 */
export async function suspensionesListas(env = process.env) {
  return suspensionesMoodleActivas(env) && existeLaTabla();
}

/**
 * El último aviso de cada (campus, ámbito, curso) del alumno. `alias` es el de la tabla
 * de leads de fuera: el fragmento se pega en un WHERE.
 */
const ULTIMOS = (leadSql) => `
  SELECT DISTINCT ON (e.project_id, e.ambito, COALESCE(e.curso_moodle_id, 0)) e.*
    FROM moodle_estado_alumno e
   WHERE e.lead_id = ${leadSql}
   ORDER BY e.project_id, e.ambito, COALESCE(e.curso_moodle_id, 0), e.fecha DESC, e.id DESC`;

/** Condición SQL: el alumno sigue suspendido en Moodle en algún campus (cuenta o curso). */
export const SUSPENDIDO_EN_MOODLE = (alias = 'l') =>
  `EXISTS (SELECT 1 FROM (${ULTIMOS(`${alias}.id`)}) ult WHERE ult.suspendido)`;

const fila = (r) => ({
  id: Number(r.id),
  projectId: Number(r.project_id),
  ambito: r.ambito,
  curso: r.curso_moodle_id ? { id: Number(r.curso_moodle_id), nombre: r.curso_nombre || null } : null,
  suspendido: Boolean(r.suspendido),
  fecha: r.fecha,
  via: r.via || null,
  motivo: r.motivo,
  motivoTexto: r.motivo_texto || null,
});

/**
 * El estado y el historial del alumno, por campus. `campusPermitidos` (null = todos): los
 * campus de quien mira, como el avance en Moodle.
 */
export async function suspensionesDelAlumno(leadId, { campusPermitidos = null, limite = 50 } = {}) {
  const permitidos = Array.isArray(campusPermitidos) ? campusPermitidos.map(Number) : null;
  const { rows: historial } = await query(
    `SELECT e.*, p.nombre AS campus
       FROM moodle_estado_alumno e JOIN projects p ON p.id = e.project_id
      WHERE e.lead_id = $1 AND ($2::int[] IS NULL OR e.project_id = ANY($2::int[]))
      ORDER BY e.fecha DESC, e.id DESC
      LIMIT $3`,
    [leadId, permitidos, limite]);
  const { rows: ultimos } = await query(
    `SELECT u.* FROM (${ULTIMOS('$1')}) u WHERE ($2::int[] IS NULL OR u.project_id = ANY($2::int[]))`,
    [leadId, permitidos]);

  const nombres = new Map(historial.map((r) => [Number(r.project_id), r.campus]));
  const porCampus = new Map();
  for (const r of ultimos) {
    const p = Number(r.project_id);
    if (!porCampus.has(p)) porCampus.set(p, []);
    porCampus.get(p).push(fila(r));
  }
  const campus = [...porCampus.entries()].map(([projectId, items]) => estadoDelCampus(projectId, nombres.get(projectId) || null, items))
    .sort((a, b) => (a.estado === b.estado ? String(a.campus).localeCompare(String(b.campus)) : a.estado === 'suspendido' ? -1 : 1));

  return {
    disponible: true,
    suspendido: campus.some((c) => c.estado === 'suspendido'),
    campus,
    historial: historial.map((r) => ({ ...fila(r), campus: r.campus })),
  };
}

/** El estado de un campus con el último aviso de cada cosa (cuenta y cursos). */
export function estadoDelCampus(projectId, nombre, items) {
  const suspendidos = items.filter((x) => x.suspendido)
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
  if (suspendidos.length) {
    const ultima = suspendidos[0];
    return {
      projectId, campus: nombre, estado: 'suspendido',
      desde: ultima.fecha, motivo: ultima.motivo, motivoTexto: ultima.motivoTexto,
      // Qué está suspendido: la cuenta entera y/o los cursos.
      cuenta: suspendidos.some((x) => x.ambito === 'cuenta'),
      cursos: suspendidos.filter((x) => x.ambito === 'curso').map((x) => x.curso),
    };
  }
  const ultima = [...items].sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0];
  return {
    projectId, campus: nombre, estado: 'reactivado',
    desde: ultima.fecha, motivo: ultima.motivo, motivoTexto: ultima.motivoTexto,
    cuenta: false, cursos: [],
  };
}
