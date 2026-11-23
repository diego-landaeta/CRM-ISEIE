import type { LinkDePago } from '../api/linksPago.api';

/*
  EL MENSAJE DEL LINK PARA EL ALUMNO (CRM#983; Diego, 21/11/2026).

  La plantilla con la que sale un link por WhatsApp (o al copiarlo para mandarlo
  a mano): saludo, curso, importe y caducidad, y el link. El mismo texto en el
  chat del CRM, en «Copiar mensaje» de la ficha del prospecto, de la venta y de
  «Links de pago», y en el asistente al crearlo.
*/

function dinero(n: unknown, moneda = 'EUR') {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: (moneda || 'EUR').toUpperCase() }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${moneda}`;
  }
}

function fecha(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Madrid' });
}

const primerNombre = (n: string | null | undefined) => String(n || '').trim().split(/\s+/)[0] || '';

type ParaMensaje = Pick<LinkDePago, 'url' | 'importe' | 'moneda' | 'modalidad' | 'num_cuotas' | 'importe_cuota' | 'caduca_el' | 'product_nombre'>
  & { importe_inicial?: string | number | null; lead_nombre?: string | null };

/** Qué paga con el link, dicho para el alumno. */
function queSePaga(l: ParaMensaje) {
  const curso = l.product_nombre || 'tu programa';
  const n = Number(l.num_cuotas || 0);
  if (l.modalidad === 'cuotas' && n >= 2) {
    const conLink = dinero(l.importe_inicial ?? l.importe_cuota, l.moneda);
    // `num_cuotas` cuenta todos los pagos: con el link va el primero.
    const despues = n - 1;
    return `${curso}: ${l.importe_inicial != null ? 'la inicial' : 'la primera cuota'}, de ${conLink} `
      + `(el total es ${dinero(l.importe, l.moneda)} y ${despues === 1 ? 'la cuota siguiente se cobra sola al mes' : `las ${despues} cuotas siguientes se cobran solas cada mes`})`;
  }
  return `${curso}: ${dinero(l.importe, l.moneda)}`;
}

export function mensajeDelLink(l: ParaMensaje, nombre?: string | null) {
  const quien = primerNombre(nombre ?? l.lead_nombre);
  const caduca = fecha(l.caduca_el);
  return [
    `Hola${quien ? ` ${quien}` : ''}, te paso el link de pago de ${queSePaga(l)}.`,
    `Puedes pagar con tarjeta de forma segura${caduca ? ` hasta el ${caduca}` : ''}:`,
    l.url || '',
    'Cualquier duda, me dices.',
  ].join('\n');
}
