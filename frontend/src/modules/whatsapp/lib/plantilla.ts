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
  /**
   * Los datos de SU formación (#129).
   *
   * Solo los que el CRM tiene de verdad. El importe y el plan de pagos NO están
   * aquí a propósito: la migración 151 lo dejó dicho —«rellenarlos con datos que
   * el CRM no tiene sería peor que dejarlos: se enviarían cifras inventadas»— y
   * por eso siguen yendo [entre corchetes], que la gestora completa antes de
   * enviar.
   *
   * Las plazas sí, porque desde el #86 se cuentan de las ventas.
   */
  plazas?: number | null;
  cierre?: string | null;
  inicio?: string | null;
}

/** Los huecos que el CRM sabe rellenar, para enseñarlos donde se escribe. */
export const VARIABLES = [
  { clave: 'nombre', pista: 'el nombre de pila' },
  { clave: 'nombreCompleto', pista: 'nombre y apellidos' },
  { clave: 'producto', pista: 'la formación que le interesa' },
  { clave: 'proyecto', pista: 'la marca' },
  { clave: 'email', pista: 'su correo' },
  { clave: 'telefono', pista: 'su teléfono' },
  { clave: 'plazas', pista: 'las que quedan libres, contadas ahora' },
  { clave: 'cierre', pista: 'cuándo cierra la convocatoria' },
  { clave: 'inicio', pista: 'cuándo empieza' },
] as const;

/**
 * La clave de un hueco, sin tildes y en minúscula.
 *
 * Hace falta porque la pantalla de plantillas ofrecía `{teléfono}` —con tilde—
 * y `rellenar` no lo rellenaba NUNCA: `\w` no casa con `é`, así que ese hueco
 * viajaba tal cual hasta el cliente. Quien copiara ese nombre de la lista
 * escribía un mensaje roto sin enterarse.
 *
 * Se arregla aceptando las dos formas en vez de cambiar la lista: puede haber
 * plantillas guardadas con la tilde y romperlas ahora sería peor.
 */
const sinTilde = (s: string) => s.toLowerCase()
  .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i')
  .replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u');

/** Cómo se dice en un mensaje una fecha que viene de la base. */
function comoFecha(v: string | null | undefined): string {
  if (!v) return '';
  // Llega como 'YYYY-MM-DD' (el CRM fuerza las DATE a texto para que no bailen
  // de día según la zona horaria). Se parte a mano: `new Date('2026-03-12')` lo
  // interpreta en UTC y en España se pintaría el 11.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return String(v);
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]}`;
}

export function rellenar(
  texto: string,
  prospecto: DatosParaRellenar,
  nombreProyecto?: string | null,
): string {
  const completo = (prospecto.nombre || '').trim();
  // Las plazas se cortan en cero de cara al cliente. En el catálogo pueden salir
  // negativas —significa que la convocatoria está sobrevendida, y eso el
  // administrador tiene que verlo— pero «quedan -2 plazas» en un WhatsApp no.
  const plazas = prospecto.plazas == null ? null : Math.max(0, Number(prospecto.plazas));
  const valores: Record<string, string> = {
    nombre: completo.split(/\s+/)[0] || '',
    nombrecompleto: completo,
    producto: prospecto.producto && prospecto.producto !== '—'
      ? prospecto.producto
      : 'nuestros programas',
    proyecto: nombreProyecto || '',
    email: prospecto.email || '',
    telefono: prospecto.telefono || '',
    plazas: plazas == null ? '' : String(plazas),
    cierre: comoFecha(prospecto.cierre),
    inicio: prospecto.inicio || '',
  };
  // Con `\p{L}` y la bandera unicode: con `\w`, `{teléfono}` no se reconocía ni
  // como hueco.
  return texto.replace(/\{([\p{L}\d_]+)\}/gu, (entero, clave: string) => {
    const v = valores[sinTilde(clave)];
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
  // La misma expresión que en `rellenar`, o el aviso de «te falta un dato» no
  // vería los huecos con tilde y dejaría pasar justo los que no se rellenan.
  for (const m of rellenado.matchAll(/\{([\p{L}\d_]+)\}/gu)) vacios.add(sinTilde(m[1]));
  for (const m of texto.matchAll(/\{([\p{L}\d_]+)\}/gu)) {
    const clave = sinTilde(m[1]);
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
