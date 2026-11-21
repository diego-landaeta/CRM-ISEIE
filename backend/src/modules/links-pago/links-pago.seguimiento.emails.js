import * as P from '../../shared/services/email-plantilla.service.js';

/*
  SEGUIMIENTO DE LOS LINKS (CRM#984) · lo que se le dice al alumno y a la gestora.

  El correo al alumno, con la plantilla común y la marca de SU campus (norma del
  10/10), y con `projectId` en `sendEmail` para que salga por la cuenta y el
  remitente de esa marca, con el freno de los entornos de pruebas.

  El texto de WhatsApp es el mismo mensaje, corto: saludo, curso, importe,
  caducidad y el link.
*/

/** Lo que paga el alumno con ESTE link: en cuotas, la primera (o la inicial). */
export function importeDelLink(l) {
  return l.modalidad === 'cuotas' && l.importe_cuota != null ? Number(l.importe_cuota) : Number(l.importe);
}

export function dinero(n, moneda = 'EUR') {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: String(moneda || 'EUR').toUpperCase() }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${moneda}`;
  }
}

/** dd/mm/aaaa, en la hora de Madrid (la del CRM). */
export function fecha(ts) {
  if (!ts) return null;
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(new Date(ts));
}

/** dd/mm a las hh:mm, en la hora de Madrid. */
export function fechaYHora(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  const dia = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit' }).format(d);
  const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(d);
  return `${dia} a las ${hora}`;
}

export const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;

export const marcaDe = (l) => ({ id: l.project_id, nombre: l.campus, slug: l.slug, logo_url: l.logo_url, emoji: l.emoji });

/** Qué paga con el link, dicho para el alumno. */
function queSePaga(l) {
  const curso = l.producto_nombre || 'tu programa';
  if (l.modalidad === 'cuotas' && Number(l.num_cuotas) >= 2) return `la primera cuota de ${curso}`;
  return curso;
}

/** El recordatorio de las 24 h o de las 72 h, por correo. */
export function armarRecordatorio({ l, cual }) {
  const importe = dinero(importeDelLink(l), l.moneda);
  const caduca = fecha(l.caduca_el);
  const segundo = cual === '72h';
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(l),
    titulo: segundo ? 'Tu link de pago caduca pronto' : 'Tu link de pago sigue disponible',
    saludo: primerNombre(l.lead_nombre),
    resumen: `Tienes pendiente el pago de ${queSePaga(l)}: ${importe}.${caduca ? ` El link caduca el ${caduca}.` : ''}`,
    bloques: [
      P.parrafo(`Te escribimos porque aún no has completado el pago de <strong>${P.esc(queSePaga(l))}</strong>, `
        + `de <strong>${P.esc(importe)}</strong>. El link es seguro y lo procesa Stripe.`),
      P.boton({ texto: 'Pagar ahora', url: l.url }),
      caduca ? P.nota(`El link caduca el ${P.esc(caduca)}. Después tendrás que pedir uno nuevo a tu asesor.`) : null,
      P.nota('Si ya lo has pagado, no hagas caso de este correo. Si tienes cualquier duda, contesta a tu asesor.'),
    ],
  });
  const asunto = `${l.campus || 'Tu matrícula'} · ${segundo ? 'tu link de pago caduca pronto' : 'tu link de pago sigue disponible'}`;
  return { asunto, htmlContent, textContent };
}

/** El mismo recordatorio, por WhatsApp. */
export function textoRecordatorioWhatsapp({ l, cual }) {
  const nombre = primerNombre(l.lead_nombre);
  const caduca = fecha(l.caduca_el);
  return [
    `Hola${nombre ? ` ${nombre}` : ''}, te recuerdo que tienes pendiente el pago de ${queSePaga(l)}: ${dinero(importeDelLink(l), l.moneda)}.`,
    caduca ? `El link ${cual === '72h' ? 'caduca pronto, el' : 'sigue disponible hasta el'} ${caduca}:` : 'Aquí tienes el link:',
    l.url,
    'Si ya lo has pagado, no hagas caso de este mensaje.',
  ].join('\n');
}

/** El aviso a la gestora: «Laura abrió el link de Psicopedagogía y no pagó». */
export function avisoGestora(l) {
  const quien = l.lead_nombre || 'Tu alumno';
  const curso = l.producto_nombre || 'su curso';
  return {
    title: `${quien} abrió el link de ${curso} y no pagó`,
    message: `Lo abrió el ${fechaYHora(l.abierto_el)} y sigue sin pagar ${dinero(importeDelLink(l), l.moneda)}.`
      + `${l.caduca_el ? ` El link caduca el ${fecha(l.caduca_el)}.` : ''} Es un buen momento para llamarle.`,
  };
}
