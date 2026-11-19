import * as P from '../../shared/services/email-plantilla.service.js';

/*
  Confirmación de datos del diploma (#768) · el correo al alumno.

  Con la plantilla común y la marca de SU campus, y por `sendEmail` con el
  `projectId`: sale por la cuenta y el remitente de esa marca, y pasa por el
  freno de los entornos de pruebas como cualquier otro. Solo sale de verdad con
  DIPLOMA_CONFIRMACION_ENVIAR_CORREO (ver config).

  El documento va TAPADO (solo los últimos caracteres): un correo se reenvía, se
  queda en buzones compartidos… Para comprobarlo entero está la página del enlace.
*/

const fmtFecha = (d) => new Date(d).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'long', year: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
});

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;

const dos = (x) => String(x).padStart(2, '0');

/**
 * Un DATE de la base como «AAAA-MM-DD», sin pasar por husos: `pg` lo da como Date a
 * la medianoche LOCAL del servidor, y convertirlo a ISO (UTC) lo movía al día de antes.
 */
export function diaTexto(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : `${v.getFullYear()}-${dos(v.getMonth() + 1)}-${dos(v.getDate())}`;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

/** «10 de noviembre de 2026» de un «AAAA-MM-DD», el mismo día en cualquier huso. */
const fmtDia = (v) => {
  const d = diaTexto(v);
  if (!d) return null;
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** «•••••678Z»: los cuatro últimos a la vista, el resto tapado. Cortos, todo tapado. */
export function documentoTapado(doc) {
  const s = String(doc || '').trim();
  if (!s) return null;
  if (s.length <= 4) return '•'.repeat(s.length);
  return `${'•'.repeat(Math.min(s.length - 4, 8))}${s.slice(-4)}`;
}

/** La página del enlace: una pantalla pública del CRM. */
export const urlDeLaPagina = (token) => P.enlace(`confirmar-diploma/${token}`);

const marcaDe = (p) => (p ? { id: p.id, nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji } : {});

/**
 * El correo con los datos y el enlace. `fila`: la confirmación; `proyecto`: el
 * del campus (para la marca), o null.
 */
export function armarPeticion({ fila, proyecto, token, reenvio = false }) {
  const filas = [
    ['Nombre completo', fila.nombre_propuesto || 'Sin nombre: corrígelo en el enlace'],
    ['Documento de identidad', documentoTapado(fila.documento_propuesto) || 'Sin documento: escríbelo en el enlace'],
    ['Curso', fila.curso_nombre || '—'],
    ['Horas', fila.horas ? `${fila.horas} h` : '—'],
    ['Fecha', fmtDia(fila.fecha_diploma) || 'la del día de emisión'],
  ];
  const tabla = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 16px">${
    filas.map(([k, v]) => `<tr><td style="padding:6px 8px 6px 0;color:#5b6572;white-space:nowrap;vertical-align:top">${P.esc(k)}</td>`
      + `<td style="padding:6px 0;font-weight:600">${P.esc(v)}</td></tr>`).join('')
  }</table>`;
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(proyecto),
    titulo: 'Revisa los datos de tu diploma',
    saludo: primerNombre(fila.nombre_propuesto),
    resumen: 'Antes de emitir tu diploma, confirma que tus datos están bien.',
    bloques: [
      reenvio ? P.parrafo('Te mandamos un enlace nuevo: el anterior ya no sirve.') : null,
      P.parrafo('¡Enhorabuena por terminar tu formación! Antes de emitir tu diploma, revisa los datos con los que saldrá:'),
      tabla,
      P.boton({ texto: 'Confirmar o corregir mis datos', url: urlDeLaPagina(token) }),
      P.nota(`El enlace es personal y sirve una sola vez. Puedes usarlo hasta el <strong>${P.esc(fmtFecha(fila.caduca_at))}</strong>. `
        + 'Si no contestas, emitiremos el diploma con estos datos.'),
    ],
  });
  return { asunto: `${proyecto?.nombre ? `${proyecto.nombre} · ` : ''}revisa los datos de tu diploma`, htmlContent, textContent };
}
