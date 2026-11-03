/**
 * Los campos de un envío de Make reconocidos por su nombre habitual (#627).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * Un webhook de Make en modo «active» y sin `field_mapping` rechazaba el envío
 * entero con «field_mapping vacío en modo active». Pasa cada vez que alguien
 * crea el conector, lo pone en activo y no llega a guardar el mapeo: en el CRM
 * del 360, entre el 16/10 y el 02/11, se rechazaron así 27 envíos de cinco campus, y todos
 * traían el correo, el nombre y el teléfono con los nombres de siempre
 * (`email`, `full_name`, `phone_complete`, `course`…).
 *
 * Esa vez no se perdió nadie: esos formularios mandan también al webhook de
 * formularios del CRM, y la ficha ya había entrado por ahí. Pero un campus que
 * solo tenga Make lo habría perdido todo, sin que nadie se enterase.
 *
 * Rechazar no protege nada: el envío ya está aquí y Make no reintenta. Así que,
 * sin mapeo, el CRM busca los campos por su nombre habitual, crea el prospecto
 * y avisa al admin de que falta el mapeo. Si no reconoce ni el correo ni el
 * nombre, sí rechaza, como antes: no hay con qué crear la ficha.
 *
 * QUE NO SE RECONOCE A PROPOSITO
 *
 * `source`: en los formularios de Make es el NOMBRE DE LA WEB («PRO Elements»,
 * «Isslogg»), no el `utm_source`. Tomarlo como UTM pondría el canal mal a cada
 * prospecto. Tampoco `id`, `date`, `time`, `ip` ni `privacy_accepted`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Por orden de preferencia: el primero que venga CON VALOR gana. Por eso
// `landing_url` va antes que `page_url` (la de Make suele llegar vacía y
// entonces se usa la página).
export const NOMBRES_HABITUALES = {
  email: ['email', 'e_mail', 'mail', 'correo', 'correo_electronico', 'email_address',
    'your_email', 'tu_email', 'user_email', 'contact_email'],
  nombre: ['full_name', 'fullname', 'nombre_completo', 'nombre_y_apellidos',
    'nombres_y_apellidos', 'nombre', 'name', 'your_name', 'tu_nombre', 'first_name', 'nombres'],
  telefono: ['phone_complete', 'telefono_completo', 'phone', 'telefono', 'phone_number',
    'tel', 'movil', 'celular', 'mobile', 'whatsapp'],
  producto_interes: ['course', 'curso', 'course_name', 'producto_interes', 'producto',
    'product', 'programa', 'formacion', 'master', 'diplomado'],
  notas: ['message', 'mensaje', 'notas', 'notes', 'comentarios', 'comentario',
    'comments', 'consulta', 'observaciones'],
  landing_url: ['landing_url', 'page_url', 'url', 'pagina', 'page'],
  referrer: ['referrer', 'referer'],
  utm_source: ['utm_source'],
  utm_medium: ['utm_medium'],
  utm_campaign: ['utm_campaign'],
  utm_content: ['utm_content'],
  utm_term: ['utm_term'],
  responsable_email: ['responsable_email', 'asesora_email', 'gestora_email'],
  responsable_nombre: ['responsable_nombre', 'asesora_nombre', 'gestora_nombre', 'asesora', 'gestora'],
};

/** `Correo Electrónico` → `correo_electronico`. */
export function normalizarNombre(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function tieneValor(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === 'object') return false;   // un objeto entero no es un correo ni un nombre
  return String(v).trim() !== '';
}

/**
 * Las rutas del envío que tienen valor: las de primer nivel y las de un objeto
 * anidado una vez (`data.email`), que es como lo mandan algunos escenarios.
 * Las de primer nivel van antes.
 */
function rutasConValor(payload) {
  const directas = [];
  const anidadas = [];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  for (const [k, v] of Object.entries(payload)) {
    if (tieneValor(v)) directas.push({ ruta: k, nombre: normalizarNombre(k) });
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [k2, v2] of Object.entries(v)) {
        if (tieneValor(v2)) anidadas.push({ ruta: `${k}.${k2}`, nombre: normalizarNombre(k2) });
      }
    }
  }
  return [...directas, ...anidadas];
}

/**
 * El `field_mapping` que se deduce de un envío por los nombres de sus campos.
 * Devuelve `{ destino: 'ruta' }`, el mismo formato que guarda el webhook, para
 * aplicarlo con `applyMapping` igual que uno escrito a mano.
 */
export function deducirMapeo(payload) {
  const rutas = rutasConValor(payload);
  const mapeo = {};
  for (const [destino, nombres] of Object.entries(NOMBRES_HABITUALES)) {
    for (const n of nombres) {
      const hit = rutas.find((r) => r.nombre === n);
      if (hit) { mapeo[destino] = hit.ruta; break; }
    }
  }
  return mapeo;
}

/** `true` si con este mapeo se puede crear un prospecto (correo o nombre). */
export function alcanzaParaCrear(mapeo) {
  return Boolean(mapeo && (mapeo.email || mapeo.nombre));
}
