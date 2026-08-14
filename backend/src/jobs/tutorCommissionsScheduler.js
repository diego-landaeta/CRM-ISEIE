import { logger } from '../shared/utils/logger.js';
import * as tutores from '../modules/tutores/tutor.model.js';

// Las comisiones de los tutores, calculadas solas.
//
// Se RECONCILIA en vez de crear la comision en el momento del cobro. Da igual
// por donde entre el dinero —Stripe, una cuota marcada a mano, una carga
// masiva— o si el CRM estaba parado a esa hora: en la siguiente pasada se
// recogen los cobros que aun no tienen comision.
//
// Repetirlo no cuesta nada: el indice unico (payment_id, tutor_id) impide en la
// BASE DE DATOS que un mismo cobro genere dos veces la comision del mismo tutor.
// Por eso esto puede correr cada pocas horas sin miedo, y por eso el boton de la
// pantalla tampoco duplica nada.
//
// Se miran los ULTIMOS MESES y no todo el historico: un cobro de marzo no va a
// aparecer de repente en noviembre, y recorrerlo entero cada vez solo gasta
// disco. Para recuperar algo mas viejo esta el boton, que acepta fechas.

const TICK_MS = parseInt(process.env.TUTOR_COMMISSIONS_TICK_MS || String(6 * 60 * 60 * 1000)); // 6 h
const MESES_ATRAS = parseInt(process.env.TUTOR_COMMISSIONS_MESES || '3');

let corriendo = false;

function haceMeses(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

export async function calcularComisionesTutores() {
  // Si la pasada anterior sigue en marcha no se lanza otra encima. No haria
  // daño —el indice unico lo impide— pero si dos consultas pesadas a la vez.
  if (corriendo) return null;
  corriendo = true;
  const desde = haceMeses(MESES_ATRAS);
  const hasta = new Date().toISOString().slice(0, 10);
  try {
    const r = await tutores.reconciliar({ desde, hasta });
    if (r.creadas > 0) {
      logger.info(
        { creadas: r.creadas, importe: r.importe, tutores: r.tutores, periodos: r.periodos },
        'Comisiones de tutores creadas'
      );
    }
    return r;
  } catch (e) {
    // Se avisa fuerte y no se reintenta en el momento: si algo va mal aqui, en
    // la siguiente pasada se recoge solo. Insistir en bucle sobre dinero es peor
    // que esperar unas horas.
    logger.error({ err: e.message, desde, hasta }, 'Comisiones de tutores: FALLO');
    return null;
  } finally {
    corriendo = false;
  }
}

export function startTutorCommissionsScheduler() {
  if (process.env.TUTOR_COMMISSIONS_DISABLED === '1') {
    logger.info('Comisiones de tutores: scheduler desactivado (TUTOR_COMMISSIONS_DISABLED=1)');
    return;
  }
  // Un minuto de margen al arrancar: si el proceso se reinicia varias veces
  // seguidas —un despliegue, por ejemplo— no se dispara una consulta pesada en
  // cada arranque.
  setTimeout(calcularComisionesTutores, 60 * 1000);
  setInterval(calcularComisionesTutores, TICK_MS);
  logger.info({ tickMs: TICK_MS, mesesAtras: MESES_ATRAS }, 'Comisiones de tutores: scheduler iniciado');
}
