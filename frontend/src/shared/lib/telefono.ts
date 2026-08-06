// Normalización de teléfonos para el navegador.
//
// Es el mismo criterio que backend/src/shared/utils/normalizePhone.js. Hasta
// ahora el frontal usaba `replace(/[^\d]/g, '')`, que se limita a tirar todo lo
// que no sea un dígito: un número guardado como «0034 600 12 34 56» salía como
// «0034600123456» y el enlace de WhatsApp no llevaba a ninguna parte, porque el
// 00 hay que cambiarlo por el prefijo internacional, no conservarlo.
//
// Se duplica el criterio a propósito: llamar al backend para armar un enlace
// sería absurdo. Lo que no se puede es tener dos criterios distintos, y por eso
// esta función vive en shared y no dentro de un módulo.

/** Devuelve el teléfono en E.164 con «+», o null si no hay número utilizable. */
export function normalizarTelefono(bruto: string | null | undefined): string | null {
  if (bruto == null) return null;
  let s = String(bruto).trim();
  if (!s) return null;
  // Los formularios traen cosas como «No suministrado».
  if (/no\s*suministrad/i.test(s)) return null;
  // Excel convierte los teléfonos a número y deja un .0 al final.
  if (s.endsWith('.0')) s = s.slice(0, -2);
  s = s.replace(/[\s\-().·]/g, '');
  // 00 es la forma internacional antigua del «+».
  if (s.startsWith('00')) s = '+' + s.slice(2);
  const digitos = s.startsWith('+') ? s.slice(1) : s;
  if (!/^\d+$/.test(digitos)) return null;
  const limpio = digitos.replace(/^0+/, '');
  if (limpio.length < 7) return null;
  return '+' + limpio;
}

/** Solo los dígitos, que es lo que quieren wa.me y web.whatsapp.com. */
export function telefonoParaWhatsapp(bruto: string | null | undefined): string | null {
  const n = normalizarTelefono(bruto);
  return n ? n.slice(1) : null;
}

/**
 * Abre el chat de WhatsApp con el texto puesto.
 *
 * Dos decisiones que importan:
 *
 * · Se usa `web.whatsapp.com/send`, no `wa.me`. Todo el CRM usaba wa.me, que en
 *   escritorio da un rodeo y suele intentar abrir la aplicación de escritorio;
 *   /send va directo a la web que la gestora ya tiene abierta y logueada.
 * · La ventana lleva nombre fijo. Al reutilizar siempre la misma, WhatsApp Web
 *   se queda abierto entre prospecto y prospecto en vez de abrir una pestaña
 *   nueva cada vez y volver a cargar la sesión.
 */
export function abrirWhatsapp(telefono: string | null | undefined, texto?: string): boolean {
  const num = telefonoParaWhatsapp(telefono);
  if (!num) return false;
  const url = `https://web.whatsapp.com/send?phone=${num}` +
    (texto ? `&text=${encodeURIComponent(texto)}` : '');
  window.open(url, 'crm-whatsapp');
  return true;
}
