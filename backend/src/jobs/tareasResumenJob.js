import { logger } from '../shared/utils/logger.js';
import { vigilar } from './latido.js';
import { findAllColumns } from '../modules/tasks/tasks.model.js';
import * as resumenModel from '../modules/tasks/tasks.resumen.model.js';
import { armarCorreoResumen, despacharCorreo, AVISO_TAREAS_RESUMEN } from '../modules/tasks/tasks.emails.js';
import { procesarCambiosDeEstado } from '../modules/tasks/tasks.avisos-estado.js';

/**
 * El resumen de la tarde del tablero (Diego, 26/10/2026: «todos los días de lunes
 * a viernes mande su resumen de lo que hizo y lo que falta»).
 *
 *   · A cada persona con tablero que hoy hizo algo o tiene algo pendiente: del
 *     equipo, encargado o superadmin. Quien no hizo nada y no tiene nada, nada.
 *   · De lunes a viernes, a las 18:00 de Venezuela: TAREAS_RESUMEN_HORA ("18" o
 *     "18:30") en TAREAS_RESUMEN_ZONA (America/Caracas). Si el servidor estaba
 *     parado a esa hora, sale en cuanto vuelve, dentro de las dos horas siguientes.
 *   · Se apaga con TAREAS_RESUMEN_ACTIVO=false (para el entorno) o en «Mis
 *     preferencias» («tareas_resumen», por persona).
 *   · Una vez al día por persona: `task_daily_summaries` (migración 240) se
 *     reserva ANTES de mandar, y además va con clave de idempotencia en el
 *     registro de correos. Un reinicio a las 18:10 no lo repite.
 *
 * Sale por `despacharCorreo`: con TAREAS_CORREOS_ACTIVOS apagado se arma y se
 * registra, pero no llega a Brevo.
 */

const TICK_MS = parseInt(process.env.TAREAS_RESUMEN_TICK_MS || String(10 * 60 * 1000), 10);
const MARGEN_MIN = 120;

export const zonaResumen = () => process.env.TAREAS_RESUMEN_ZONA || 'America/Caracas';

export function resumenActivo(env = process.env) {
  const v = String(env.TAREAS_RESUMEN_ACTIVO ?? 'true').toLowerCase().trim();
  return !['false', '0', 'no', 'off'].includes(v);
}

/** "18" → 1080, "18:30" → 1110 (minutos desde medianoche). */
export function horaDelResumen(env = process.env) {
  const [h, m] = String(env.TAREAS_RESUMEN_HORA || '18').split(':').map((x) => parseInt(x, 10));
  const hh = Number.isFinite(h) && h >= 0 && h < 24 ? h : 18;
  const mm = Number.isFinite(m) && m >= 0 && m < 60 ? m : 0;
  return hh * 60 + mm;
}

/** El día (YYYY-MM-DD), el día de la semana (1 = lunes … 7 = domingo) y el minuto, en la zona. */
export function relojLocal(d = new Date(), zona = zonaResumen()) {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const semana = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[partes.weekday];
  return {
    dia: `${partes.year}-${partes.month}-${partes.day}`,
    semana,
    minuto: Number(partes.hour) * 60 + Number(partes.minute),
  };
}

/** ¿Toca ahora? De lunes a viernes, desde la hora y durante las dos horas siguientes. */
export function tocaResumen(d = new Date(), env = process.env) {
  const { semana, minuto } = relojLocal(d, env.TAREAS_RESUMEN_ZONA || 'America/Caracas');
  if (semana > 5) return false;
  const desde = horaDelResumen(env);
  return minuto >= desde && minuto < desde + MARGEN_MIN;
}

/**
 * Una vuelta. `forzar` se salta la hora y el fin de semana (para probarlo a mano);
 * `soloUserIds` lo limita a esas personas; la barrera de «una vez al día» se
 * respeta siempre.
 */
export async function runTareasResumen({ ahora = new Date(), forzar = false, soloUserIds = null } = {}) {
  if (!forzar && !resumenActivo()) return { omitido: 'apagado' };
  if (!forzar && !tocaResumen(ahora)) return { omitido: 'fuera de hora' };

  const zona = zonaResumen();
  const { dia } = relojLocal(ahora, zona);
  const conRegistro = await resumenModel.existeRegistroResumen();
  if (!conRegistro) logger.warn('Resumen de tareas: falta la migración 240, solo protege la clave del correo');

  let columnas = {};
  try {
    columnas = Object.fromEntries((await findAllColumns()).map((c) => [c.key, c.name]));
  } catch { /* sin columnas, los nombres por defecto */ }

  const gente = await resumenModel.findCandidatosResumen(AVISO_TAREAS_RESUMEN, dia, zona, { soloUserIds });
  let mandados = 0;
  let vacios = 0;
  let repetidos = 0;
  for (const persona of gente) {
    let reservado = false;
    try {
      const datos = await resumenModel.findResumenDelDia(persona.id, dia, zona);
      if (resumenModel.resumenVacio(datos)) { vacios++; continue; }
      if (conRegistro) {
        reservado = await resumenModel.reservarResumen(persona.id, dia);
        if (!reservado) { repetidos++; continue; }
      }
      const c = armarCorreoResumen({ persona, datos, dia, zona, columnas });
      const r = await despacharCorreo({
        to: [{ email: persona.email, name: persona.nombre }],
        subject: c.asunto,
        htmlContent: c.htmlContent,
        textContent: c.textContent,
        tags: ['tareas', 'tareas-resumen'],
        clave: `${AVISO_TAREAS_RESUMEN}-${persona.id}-${dia}`,
      });
      let estado = 'enviado';
      if (r?.simulated) estado = 'simulado';
      else if (r?.reason === 'FRENO_DE_PRUEBAS') estado = 'bloqueado';
      else if (r?.reason === 'YA_ENVIADO') estado = 'enviado';
      else if (!r?.sent) estado = null;
      if (estado === null) {
        // Falló de verdad (Brevo caído, sin clave…): que lo intente la vuelta siguiente.
        if (reservado) await resumenModel.soltarResumen(persona.id, dia);
        logger.warn({ userId: persona.id, motivo: r?.reason }, 'Resumen de tareas: no salió, se reintenta');
        continue;
      }
      if (reservado) await resumenModel.marcarResumen(persona.id, dia, estado);
      if (r?.sent || r?.simulated) mandados++;
    } catch (err) {
      if (reservado) await resumenModel.soltarResumen(persona.id, dia).catch(() => {});
      // Que falle el de una persona no deja sin resumen a las demás.
      logger.error({ err: err.message, userId: persona.id }, 'Fallo mandando el resumen de tareas');
    }
  }
  if (gente.length) logger.info({ dia, candidatos: gente.length, mandados, vacios, repetidos }, 'Resumen de tareas del día');
  return { dia, candidatos: gente.length, mandados, vacios, repetidos };
}

export function startTareasResumenScheduler() {
  // Los correos de cambio de estado que esperan su ventana: cada vuelta recoge los
  // que dejó un reinicio a medias (lo normal es que salgan con su propio temporizador).
  vigilar('tareas_cambio_estado', 'Tareas: correos de cambio de estado', () => procesarCambiosDeEstado(),
    5 * 60 * 1000, { alArrancarMs: 60 * 1000 });

  if (!resumenActivo()) {
    logger.info('Resumen de tareas desactivado (TAREAS_RESUMEN_ACTIVO)');
    return;
  }
  vigilar('tareas_resumen', 'Tareas: resumen de la tarde (lunes a viernes)', () => runTareasResumen(), TICK_MS,
    { alArrancarMs: 2 * 60 * 1000 });
}
