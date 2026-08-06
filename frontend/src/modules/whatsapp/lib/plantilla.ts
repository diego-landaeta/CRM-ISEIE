import type { ProspectoCola } from '../api/whatsapp.api';

// Rellena una plantilla con los datos del prospecto.
//
// Variables de llave simple, insensibles a mayúsculas: {nombre}, {nombreCompleto},
// {producto}, {proyecto}, {email}, {telefono}.
//
// NO se reutiliza renderTemplate de email-templates: aquel escapa HTML siempre
// —hace falta para un correo— y aquí convertiría «Máster & Diplomado» en
// «Máster &amp; Diplomado» dentro del chat.
export function rellenar(
  texto: string,
  prospecto: ProspectoCola,
  nombreProyecto?: string | null,
): string {
  const completo = (prospecto.nombre || '').trim();
  const valores: Record<string, string> = {
    nombre: completo.split(/\s+/)[0] || '',
    nombrecompleto: completo,
    producto: prospecto.producto && prospecto.producto !== '—'
      ? prospecto.producto
      : 'nuestros programas',
    proyecto: nombreProyecto || '',
    email: prospecto.email || '',
    telefono: prospecto.telefono || '',
  };
  return texto.replace(/\{(\w+)\}/g, (entero, clave: string) => {
    const v = valores[clave.toLowerCase()];
    return v === undefined ? entero : v;
  });
}

/** Días desde el último contacto. null si nunca se le escribió. */
export function diasSinContacto(p: ProspectoCola): number | null {
  if (!p.ultimo_contacto) return null;
  const ms = Date.now() - new Date(p.ultimo_contacto).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
