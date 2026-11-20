import * as P from '../../shared/services/email-plantilla.service.js';

/*
  Cobro automático de las cuotas (#680, 309) · los dos correos al alumno.

  Con la plantilla común y la marca de SU campus (norma del 10/10). Salen por
  `sendEmail` con el `projectId`: por la cuenta y el remitente de esa marca, y
  con el freno de los entornos de pruebas, como cualquier otro.
*/

const euros = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fecha = (d) => {
  const [a, m, dia] = String(d).slice(0, 10).split('-');
  return `${dia}/${m}/${a}`;
};
const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;
export const marcaDe = (v) => ({ id: v.project_id, nombre: v.campus, slug: v.slug, logo_url: v.logo_url, emoji: v.emoji });
const tarjetaDe = (ca) => `${ca?.tarjeta_marca ? `${String(ca.tarjeta_marca).toUpperCase()} ` : ''}****${ca?.tarjeta_ultimos4 || '····'}`;

/**
 * Lo que se le dice al alumno, por qué no salió el cobro. Sin jerga de Stripe.
 */
export function motivoParaElAlumno(codigo) {
  switch (codigo) {
    case 'insufficient_funds': return 'la tarjeta no tenía saldo suficiente';
    case 'authentication_required': return 'tu banco pide que confirmes tú el pago';
    case 'expired_card': return 'la tarjeta ha caducado';
    case 'lost_card':
    case 'stolen_card':
    case 'pickup_card': return 'el banco ha bloqueado la tarjeta';
    case 'incorrect_cvc':
    case 'incorrect_number':
    case 'invalid_account': return 'los datos de la tarjeta ya no son válidos';
    default: return 'el banco ha rechazado el cobro';
  }
}

/** La tarjeta queda guardada: qué se le va a cobrar y cuándo. */
export function armarTarjetaGuardada({ v, ca, cuotas }) {
  const lista = cuotas.slice(0, 24).map((c) => `Cuota ${c.numero}: ${euros(c.importe)} el ${fecha(c.vence)}`);
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(v),
    titulo: 'Tus próximas cuotas se cobrarán solas',
    saludo: primerNombre(v.lead_nombre),
    resumen: `Hemos guardado tu tarjeta ${tarjetaDe(ca)} para las próximas cuotas.`,
    bloques: [
      P.parrafo(`Gracias por tu pago${v.producto_nombre ? ` de <strong>${P.esc(v.producto_nombre)}</strong>` : ''}. Como aceptaste al pagar, `
        + `hemos guardado tu tarjeta <strong>${P.esc(tarjetaDe(ca))}</strong> y cobraremos en ella cada cuota en su fecha, sin que tengas que hacer nada.`),
      lista.length ? P.nota(lista.map(P.esc).join('<br>')) : null,
      P.parrafo('Si un cobro no sale, te avisaremos y te mandaremos un link para pagar esa cuota.'),
      P.nota('Si prefieres que dejemos de cobrarlas así, contesta a tu asesor y lo quitamos.'),
    ],
  });
  return { asunto: `${v.campus || 'Tu plan de pago'} · tus próximas cuotas se cobrarán solas`, htmlContent, textContent };
}

/** El cobro de una cuota no ha salido: por qué y el link para pagarla. */
export function armarCobroFallido({ v, ca, intento, url, reintentoEl }) {
  const motivo = motivoParaElAlumno(intento.error_codigo);
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(v),
    titulo: `No hemos podido cobrar tu cuota ${intento.cuota_numero}`,
    saludo: primerNombre(v.lead_nombre),
    resumen: `No hemos podido cobrar ${euros(intento.importe)} con tu tarjeta ${tarjetaDe(ca)}: ${motivo}.`,
    bloques: [
      P.parrafo(`Hoy tocaba cobrar la cuota ${intento.cuota_numero} de ${v.producto_nombre ? `<strong>${P.esc(v.producto_nombre)}</strong>` : 'tu programa'}, `
        + `de <strong>${P.esc(euros(intento.importe))}</strong>, con tu tarjeta ${P.esc(tarjetaDe(ca))}, y no ha salido: ${P.esc(motivo)}.`),
      url ? P.boton({ texto: 'Pagar la cuota', url }) : null,
      url ? P.nota('Con este link pagas solo esta cuota. Puedes usar la misma tarjeta u otra.') : null,
      reintentoEl
        ? P.parrafo(`Si no la pagas antes, volveremos a intentarlo una vez el ${P.esc(fecha(reintentoEl))}.`)
        : null,
      P.nota('Si tienes cualquier duda, contesta a tu asesor.'),
    ],
  });
  return { asunto: `${v.campus || 'Tu plan de pago'} · no hemos podido cobrar tu cuota ${intento.cuota_numero}`, htmlContent, textContent };
}
