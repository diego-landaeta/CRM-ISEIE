// Aliases comunes de campos de lead, en español, inglés y variantes habituales
// de Elementor, Contact Form 7, WPForms, Gravity Forms, formularios custom, etc.
//
// Auto-detecta el campo destino a partir del label/key de origen aunque no haya
// field_mapping explícito.

const ALIASES = {
  nombre: [
    'nombre', 'name', 'full name', 'fullname', 'tu nombre', 'tu_nombre',
    'first_name', 'firstname', 'nombre completo', 'nombre y apellidos',
    'nombres', 'nombres y apellidos', 'apellidos', 'apellido', 'surname',
    'tus datos', 'datos personales',
  ],
  email: [
    'email', 'e-mail', 'mail', 'correo', 'correo electronico', 'correo electrónico',
    'tu email', 'tu_email', 'your_email', 'email_address', 'emailaddress',
    'direccion email', 'dirección email', 'contact_email', 'user_email',
  ],
  telefono: [
    'telefono', 'teléfono', 'tel', 'phone', 'phone_number', 'phonenumber',
    'tu telefono', 'tu teléfono', 'movil', 'móvil', 'celular', 'whatsapp',
    'wa', 'numero', 'número', 'mobile', 'cellphone', 'tel_number',
    'numero telefono', 'número teléfono',
  ],
  // Prefijo de país (campo virtual). Si llega solo, se concatena al telefono.
  _phone_prefix: [
    'prefijo', 'prefijo pais', 'prefijo país', 'pais prefijo', 'país prefijo',
    'country_code', 'countrycode', 'phone_prefix', 'phoneprefix',
    'codigo pais', 'código país', 'dial_code', 'dialcode', 'cc',
    'prefix', 'prefijo telefono', 'prefijo teléfono',
  ],
  notas: [
    'mensaje', 'message', 'notas', 'notes', 'comentario', 'comentarios',
    'comment', 'comments', 'tu mensaje', 'tu_mensaje', 'consulta', 'pregunta',
    'cuentanos', 'cuéntanos', 'descripcion', 'descripción', 'description',
    'que necesitas', 'qué necesitas', 'observaciones',
  ],
  producto_interes_id: [
    'producto', 'product', 'curso', 'course', 'interes', 'interés',
    'producto_interes', 'producto_interés', 'curso_interes', 'master',
    'diplomado', 'programa', 'formacion', 'formación',
  ],
  utm_source: ['utm_source', 'source', 'origen', 'fuente'],
  utm_medium: ['utm_medium', 'medium', 'medio'],
  utm_campaign: ['utm_campaign', 'campaign', 'campana', 'campaña'],
  landing_url: [
    'landing_url', 'landing', 'url', 'page_url', 'origen_url', 'origin_url',
    'referrer', 'referer', 'page',
  ],
  dni: ['dni', 'nif', 'id', 'documento', 'document', 'id_number', 'identification'],
  empresa: ['empresa', 'company', 'organization', 'organizacion', 'organización'],
  pais: ['pais', 'país', 'country'],
  ciudad: ['ciudad', 'city', 'localidad', 'locality'],
};

// Normaliza label/key para matching: lowercase, trim, sin acentos, sin caracteres no alfanuméricos
function normalize(s) {
  if (typeof s !== 'string') return '';
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita acentos
    .replace(/[^a-z0-9 ]+/g, ' ')                       // espacios en lugar de chars raros
    .replace(/\s+/g, ' ')
    .trim();
}

// Busca el campo destino para un label/key dado. null si no matchea.
export function detectField(label) {
  const norm = normalize(label);
  if (!norm) return null;
  for (const [target, aliases] of Object.entries(ALIASES)) {
    for (const alias of aliases) {
      if (norm === alias || norm === normalize(alias)) return target;
    }
  }
  return null;
}

// Toma un objeto plano { Label: Value, ... } y devuelve { nombre, email, ... } detectando campos.
// Las keys que no matchean ningún alias se dejan en `_unmapped` para que vayan a custom_fields.
export function autoMap(obj) {
  const result = {};
  const unmapped = {};
  for (const [key, val] of Object.entries(obj || {})) {
    if (val === null || val === undefined || val === '') continue;
    const target = detectField(key);
    if (target) {
      // Si ya hay valor, no sobreescribir (primera ocurrencia gana)
      if (result[target] === undefined) result[target] = String(val).trim();
    } else {
      unmapped[key] = val;
    }
  }
  if (Object.keys(unmapped).length > 0) result._unmapped = unmapped;
  return result;
}
