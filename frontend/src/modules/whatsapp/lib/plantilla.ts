import type { ProspectoCola } from '../api/whatsapp.api';

// Rellena una plantilla con los datos del prospecto.
//
// Variables de llave simple, insensibles a mayúsculas: {nombre}, {nombreCompleto},
// {producto}, {proyecto}, {email}, {telefono}.
//
// NO se reutiliza renderTemplate de email-templates: aquel escapa HTML siempre
// —hace falta para un correo— y aquí convertiría «Máster & Diplomado» en
// «Máster &amp; Diplomado» dentro del chat.
/**
 * Lo minimo que hace falta para rellenar una plantilla.
 *
 * No se pide un `ProspectoCola` entero a proposito: eso venia de la cola de
 * pendientes, y desde el chat los mismos datos llegan de la ficha de la
 * conversacion, con otra forma. Exigir el tipo grande obligaba a inventarse
 * campos que no se usan solo para poder llamar a esta funcion.
 */
export interface DatosParaRellenar {
  nombre?: string | null;
  email?: string | null;
  telefono?: string | null;
  producto?: string | null;
}

export function rellenar(
  texto: string,
  prospecto: DatosParaRellenar,
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

/**
 * Que huecos se quedarian SIN rellenar con estos datos.
 *
 * Hace falta para avisar antes de mandar: una conversacion sin prospecto no
 * tiene nombre, y sin esto saldria un «Hola {nombre}» tal cual al otro lado.
 * Devuelve los nombres de las variables, ya sin llaves y en minuscula.
 */
export function huecosSinRellenar(
  texto: string,
  prospecto: DatosParaRellenar,
  nombreProyecto?: string | null,
): string[] {
  const rellenado = rellenar(texto, prospecto, nombreProyecto);
  const vacios = new Set<string>();
  // Lo que sigue entre llaves despues de rellenar es lo que no se pudo poner,
  // y ademas lo que quedo vacio porque el dato existia pero estaba en blanco.
  for (const m of rellenado.matchAll(/\{(\w+)\}/g)) vacios.add(m[1].toLowerCase());
  for (const m of texto.matchAll(/\{(\w+)\}/g)) {
    const clave = m[1].toLowerCase();
    if (rellenar(`{${clave}}`, prospecto, nombreProyecto).trim() === '') vacios.add(clave);
  }
  return [...vacios];
}

/** Días desde el último contacto. null si nunca se le escribió. */
export function diasSinContacto(p: ProspectoCola): number | null {
  if (!p.ultimo_contacto) return null;
  const ms = Date.now() - new Date(p.ultimo_contacto).getTime();
  return Math.max(0, Math.floor(ms / 86400000));
}
