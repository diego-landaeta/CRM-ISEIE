import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import * as informes from '../modules/reports/report.model.js';
import { vigilar } from './latido.js';

/**
 * El reporte de los lunes, a direccion.
 *
 * Tarea #29. Su criterio de terminado es lo que manda aqui:
 *
 *   «El correo del lunes y el panel dicen lo mismo. Si dicen cosas distintas, en
 *    dos semanas nadie lo abre.»
 *
 * Por eso NO se escribe ni una consulta nueva: se llama a `overview()` y a
 * `ventasPorAsesoraReport()`, que son las mismas que pinta el panel, con el rango
 * de la semana. Asi los numeros cuadran por construccion y no por casualidad —
 * y el dia que alguien cambie como se cuenta una venta, cambian los dos a la vez.
 *
 * Escribir aqui unas consultas «parecidas» habria sido garantizar que en tres
 * meses el correo y la pantalla dijeran cosas distintas.
 *
 * EXCEPCION, y hay que saberla: el dinero NO sale de `overview`.
 *
 * El ticket dice que lo cobrado sale de `conversion_payments` y **nunca** de
 * `conversions.importe_pagado`, porque ese campo declara de mas —209.930 € en
 * ISEIE—. Pero el panel usa justo ese campo: `overview` hace
 * `SUM(importe_pagado) AS cobrado`.
 *
 * O sea que las dos reglas del ticket se contradicen: no se puede cuadrar con el
 * panel Y respetar la regla del dinero, porque el panel la incumple.
 *
 * Gana la del dinero. Este correo va a direccion, y mandarles un ingreso inflado
 * es peor que una discrepancia con una pantalla — sobre todo cuando la pantalla
 * es la que esta mal. Medido en la base de desarrollo: 11.440 € segun el panel
 * contra 4.200 € reales, un 63 % de mas.
 *
 * Lo demas —prospectos, convertidos, ventas— si sale de `overview` y cuadra.
 */

const HORA = parseInt(process.env.REPORTE_SEMANAL_HORA || '8', 10);
const TICK_MS = parseInt(process.env.REPORTE_SEMANAL_TICK_MS || String(30 * 60 * 1000), 10);

let corriendo = false;

/** Lunes a domingo de la semana que acaba de cerrar, y la anterior. */
export function semanas(hoy = new Date()) {
  const d = new Date(hoy);
  d.setHours(0, 0, 0, 0);
  // getDay(): 0 domingo, 1 lunes. Se retrocede al lunes de esta semana.
  const desdeElLunes = (d.getDay() + 6) % 7;
  const lunesDeEsta = new Date(d);
  lunesDeEsta.setDate(d.getDate() - desdeElLunes);

  const fin = new Date(lunesDeEsta);        // domingo pasado
  fin.setDate(lunesDeEsta.getDate() - 1);
  const ini = new Date(fin);                // lunes pasado
  ini.setDate(fin.getDate() - 6);

  const finAnterior = new Date(ini);
  finAnterior.setDate(ini.getDate() - 1);
  const iniAnterior = new Date(finAnterior);
  iniAnterior.setDate(finAnterior.getDate() - 6);

  const iso = (x) => x.toISOString().slice(0, 10);
  return {
    semana: { from: iso(ini), to: iso(fin) },
    anterior: { from: iso(iniAnterior), to: iso(finAnterior) },
  };
}

/** A quien va: direccion, y solo quien no lo haya apagado. */
async function destinatarios() {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email
       FROM users u
      WHERE u.active AND u.email IS NOT NULL
        AND u.role IN ('admin', 'superadmin')
        AND NOT EXISTS (
          SELECT 1 FROM avisos_apagados a
           WHERE a.user_id = u.id AND a.aviso = 'reporte_semanal'
        )
      ORDER BY u.nombre`
  );
  return rows;
}

const num = (v) => Number(v || 0);

/**
 * Lo cobrado DE VERDAD en ese rango: de `conversion_payments`.
 *
 * Se redondea en SQL con ROUND(...,2) y no con `toFixed`, que redondea distinto
 * en el centimo — lo pide el ticket y no es capricho: un reporte que no cuadra
 * al centimo con contabilidad se deja de leer igual que uno que no cuadra en
 * miles.
 */
async function cobradoDeVerdad({ from, to }) {
  const { rows } = await query(
    `SELECT ROUND(COALESCE(SUM(p.importe), 0)::numeric, 2) AS cobrado
       FROM conversion_payments p
      -- La columna se llama fecha, no fecha_pago. Lo caza la primera ejecucion
      -- contra la base; leyendo el codigo no se ve.
      WHERE p.fecha >= $1::date
        AND p.fecha <= $2::date`,
    [from, to]
  );
  return Number(rows[0]?.cobrado || 0);
}

/** La flecha y el porcentaje respecto a la semana anterior. */
export function comparar(ahora, antes) {
  const a = num(ahora);
  const b = num(antes);
  // Sin nada con que comparar no se inventa un porcentaje: de 0 a 5 no es
  // «+500 %», es «antes no habia nada».
  if (b === 0) return { texto: a === 0 ? '=' : 'nuevo', signo: a > 0 ? 'sube' : 'igual' };
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return { texto: 'igual', signo: 'igual' };
  return { texto: `${pct > 0 ? '+' : ''}${pct} %`, signo: pct > 0 ? 'sube' : 'baja' };
}

const eur = (v) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(num(v));

function tarjeta(etiqueta, valor, cmp) {
  const color = cmp.signo === 'sube' ? '#047857' : cmp.signo === 'baja' ? '#b91c1c' : '#6b7280';
  const flecha = cmp.signo === 'sube' ? '▲' : cmp.signo === 'baja' ? '▼' : '·';
  // Tabla y estilos en linea: es lo unico que se ve igual en Gmail, Outlook y
  // el movil. Flex y clases se los come el cliente de correo.
  return `
    <td style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;
               vertical-align:top;min-width:130px">
      <div style="font:12px system-ui;color:#6b7280">${etiqueta}</div>
      <div style="font:600 20px system-ui;color:#111;margin:2px 0">${valor}</div>
      <div style="font:12px system-ui;color:${color}">${flecha} ${cmp.texto}</div>
    </td>`;
}

export function cuerpo({ rango, ahora, antes, porAsesora, cobrado, cobradoAntes }) {
  const l = ahora.leads || {};
  const lAntes = antes.leads || {};
  const c = ahora.conversions || {};
  const cAntes = antes.conversions || {};

  const filas = (porAsesora || []).slice(0, 12).map((a) => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font:14px system-ui">${a.vendedora}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font:14px system-ui;text-align:right">${num(a.ventas)}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;font:14px system-ui;text-align:right">${eur(a.cobrado)}</td>
    </tr>`).join('');

  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;color:#111">
    <h2 style="font-size:18px;margin:0 0 2px">Semana del ${rango.from} al ${rango.to}</h2>
    <p style="font-size:13px;color:#6b7280;margin:0 0 16px">
      Comparado con la semana anterior.
    </p>

    <table cellpadding="0" cellspacing="6" style="border-collapse:separate;width:100%">
      <tr>
        ${tarjeta('Prospectos', num(l.total), comparar(l.total, lAntes.total))}
        ${tarjeta('Convertidos', num(l.convertido), comparar(l.convertido, lAntes.convertido))}
      </tr>
      <tr>
        ${tarjeta('Ventas', num(c.total), comparar(c.total, cAntes.total))}
        ${tarjeta('Cobrado', eur(cobrado), comparar(cobrado, cobradoAntes))}
      </tr>
    </table>

    ${filas ? `
      <h3 style="font-size:15px;margin:22px 0 6px">Por gestora</h3>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse">
        <tr>
          <th style="text-align:left;font:600 12px system-ui;color:#6b7280;padding:0 10px 4px">Gestora</th>
          <th style="text-align:right;font:600 12px system-ui;color:#6b7280;padding:0 10px 4px">Ventas</th>
          <th style="text-align:right;font:600 12px system-ui;color:#6b7280;padding:0 10px 4px">Cobrado</th>
        </tr>
        ${filas}
      </table>` : ''}

    <p style="font-size:12px;color:#9ca3af;margin-top:22px">
      Prospectos, convertidos y ventas salen del panel de Informes.
      <strong>Lo cobrado sale de los pagos registrados</strong>, que es lo que ha
      entrado de verdad — el panel lo calcula de otra forma y sale mas alto.
      Puedes apagar este correo en <em>Mis preferencias</em>.
    </p>
  </div>`;
}

async function vuelta() {
  if (corriendo) return;
  corriendo = true;
  try {
    const hoy = new Date();
    // Lunes, y a la hora. La hora se mira en cada vuelta en vez de programar a
    // una exacta: un reinicio a las 08:05 no se salta el reporte, y la clave
    // impide que salga dos veces.
    if (hoy.getDay() !== 1 || hoy.getHours() !== HORA) return;

    const gente = await destinatarios();
    if (!gente.length) return;

    const { semana, anterior } = semanas(hoy);

    // Las MISMAS funciones que pinta el panel. Ver la cabecera del fichero.
    const [ahora, antes, porAsesora, cobrado, cobradoAntes] = await Promise.all([
      informes.overview({ ...semana }),
      informes.overview({ ...anterior }),
      // `ventasVendedora` y NO `ventasPorAsesoraReport`: la segunda devuelve una
      // fila por VENTA —es el informe descargable de detalle— y salia «Angel M.»
      // cuatro veces con 0 ventas. Esta agrega por gestora, y ademas saca el
      // cobrado de `conversion_payments`, que es la regla del dinero del ticket.
      informes.ventasVendedora({ ...semana }).catch(() => []),
      // El dinero aparte, y a proposito. Ver la cabecera del fichero.
      cobradoDeVerdad(semana),
      cobradoDeVerdad(anterior),
    ]);

    const html = cuerpo({ rango: semana, ahora, antes, porAsesora, cobrado, cobradoAntes });

    for (const persona of gente) {
      try {
        await sendEmail({
          to: persona.email,
          subject: `[CRM] Reporte semanal · ${semana.from} a ${semana.to}`,
          htmlContent: html,
          tags: ['reporte', 'semanal'],
          // Una vez por persona y semana. Con la fecha del lunes dentro: el
          // reporte tiene que llegar cada semana, pero un reinicio no lo repite.
          clave: `reporte-semanal-${persona.id}-${semana.from}`,
        });
      } catch (err) {
        logger.error({ err: err.message, userId: persona.id }, 'Fallo mandando el reporte semanal');
      }
    }
    logger.info({ destinatarios: gente.length, ...semana }, 'Reporte semanal');
  } catch (err) {
    logger.error({ err: err.message }, 'Fallo en el reporte semanal');
  } finally {
    corriendo = false;
  }
}

export function startReporteSemanalScheduler() {
  if (process.env.REPORTE_SEMANAL_DISABLED === '1') {
    logger.info('Reporte semanal desactivado (REPORTE_SEMANAL_DISABLED=1)');
    return;
  }
  vigilar('reporte_semanal', 'Reporte semanal', vuelta, TICK_MS);
  logger.info({ tickMs: TICK_MS, hora: HORA }, 'Reporte semanal iniciado');
}

export const _internos = { semanas, comparar, cuerpo, destinatarios, vuelta };
