import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import {
  correo, parrafo, boton, nota, enlace, esc,
} from '../shared/services/email-plantilla.service.js';
import { NO_ESCRIBIR_A_TUTORES } from '../shared/config/frenoTutores.js';
import { sinMensajes } from '../modules/consultas/consultas.alumnos.js';
import { cargaDe } from '../modules/consultas/consultas.carga.js';
import { marcaDelTutor } from '../modules/consultas/consultas.plazos.js';
import { vigilar } from './latido.js';

/**
 * El resumen semanal al tutor (#189), los lunes: cuántos alumnos le faltan por
 * contactar (los más antiguos, con nombre), sus consultas abiertas y, si toca,
 * que actualice su carga de trabajo (decisión 9: una vez por semana).
 *
 * Respeta el freno de correos a tutores (Diego, 15/09): con él puesto no sale
 * nada; se apunta en el registro. Se apaga con CONSULTAS_RESUMEN_DISABLED=1.
 */

const HORA = parseInt(process.env.CONSULTAS_RESUMEN_HORA || '9', 10);
const TICK_MS = parseInt(process.env.CONSULTAS_RESUMEN_TICK_MS || String(30 * 60 * 1000), 10);

/** El resumen de un tutor, o null si no hay nada que decirle. */
export async function resumenDelTutor(tutorId) {
  const [faltan, carga] = await Promise.all([sinMensajes({ tutorId }), cargaDe(tutorId)]);
  const abiertas = carga.datosReales?.consultas_abiertas || 0;
  if (!faltan.length && !abiertas && !carga.desactualizada) return null;
  return { faltan, abiertas, cargaDesactualizada: carga.desactualizada };
}

export async function enviarResumenes(hoy = new Date()) {
  const { rows } = await query(
    // Solo tutores de campus que leen consultas: a los demás no se les habla
    // de Consultas.
    `SELECT DISTINCT u.id, u.nombre, u.email
       FROM users u JOIN tutor_campus tc ON tc.tutor_id = u.id AND tc.estado = 'activa'
       JOIN project_integrations pi ON pi.project_id = tc.project_id AND pi.provider = 'moodle'
        AND pi.active AND COALESCE((pi.config_public->>'consultas')::boolean, false)
      WHERE u.active`);
  const lunes = hoy.toISOString().slice(0, 10);
  let mandados = 0;
  let frenados = 0;
  for (const t of rows) {
    const r = await resumenDelTutor(t.id);
    if (!r) continue;
    if (NO_ESCRIBIR_A_TUTORES) {
      frenados += 1;
      logger.info({ tutorId: t.id, sinMensajes: r.faltan.length, abiertas: r.abiertas }, 'consultas: resumen semanal sin enviar (freno de correos a tutores)');
      continue;
    }
    const lista = r.faltan.slice(0, 10).map((a) => `· ${esc(a.alumno_nombre || 'Alumno')} (${esc(a.curso_nombre || a.campus)}), ${a.dias} días`).join('<br>');
    const marca = await marcaDelTutor(t.id);
    const { htmlContent, textContent } = correo({
      proyecto: marca.proyecto,
      titulo: 'Tu semana en Consultas',
      saludo: t.nombre || null,
      resumen: `${r.faltan.length} alumnos sin contactar · ${r.abiertas} consultas abiertas`,
      bloques: [
        r.faltan.length ? parrafo(`Tienes <strong>${r.faltan.length}</strong> alumnos a los que aún no has escrito:<br>${lista}${r.faltan.length > 10 ? '<br>…' : ''}`) : '',
        r.abiertas ? parrafo(`Y <strong>${r.abiertas}</strong> consultas esperando respuesta.`) : '',
        r.cargaDesactualizada ? nota('Tu carga de trabajo lleva más de una semana sin actualizar: actualízala en Consultas → Mi carga.') : '',
        boton({ texto: 'Abrir Consultas', url: enlace('consultas') }),
      ],
    });
    const e = await sendEmail({
      to: t.email, subject: `[${marca.campus || 'CRM'}] Tu semana en Consultas`, htmlContent, textContent,
      tags: ['consultas', 'tutor', 'semanal'], projectId: marca.projectId, clave: `consultas-semana-${t.id}-${lunes}`,
    }).catch((err) => ({ sent: false, error: err.message }));
    if (e?.sent) mandados += 1;
  }
  return { tutores: rows.length, mandados, frenados };
}

let hecho = null;

/** El día de la semana (1 = lunes), la hora y la fecha, en Madrid: el servidor puede ir en UTC. */
export function enMadrid(fecha) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', weekday: 'short', hour: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(fecha).map((x) => [x.type, x.value]));
  const dias = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
  return { diaSemana: dias[partes.weekday], hora: Number(partes.hour), dia: `${partes.year}-${partes.month}-${partes.day}` };
}

async function vuelta() {
  const hoy = new Date();
  // Los lunes, desde su hora de Madrid, una vez. La clave del correo lleva el
  // día, así que ni un reinicio el mismo lunes lo repite.
  const { diaSemana, hora, dia } = enMadrid(hoy);
  if (diaSemana !== 1 || hora < HORA || hecho === dia) return null;
  hecho = dia;
  return enviarResumenes(hoy);
}

export function startConsultasResumenScheduler() {
  if (process.env.CONSULTAS_RESUMEN_DISABLED === '1') {
    logger.info('Resumen semanal de consultas desactivado (CONSULTAS_RESUMEN_DISABLED=1)');
    return;
  }
  vigilar('consultas_resumen', 'Resumen semanal de consultas al tutor', vuelta, TICK_MS);
}
