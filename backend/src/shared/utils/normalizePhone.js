// Normaliza un teléfono a formato E.164 con prefijo `+`.
//
// Reglas:
//   1. Limpia espacios, guiones, paréntesis, puntos, .0 final de Excel
//   2. Si arranca con "00" → reemplaza por "+"
//   3. Si arranca con dígito (sin +) → agrega "+"
//   4. Si ya arranca con "+" → mantiene
//   5. Si tiene menos de 7 dígitos → devuelve null (inválido)
//
// Ejemplos:
//   "+34 600 12 34 56"  → "+34600123456"
//   "0034600123456"     → "+34600123456"
//   "34600123456"       → "+34600123456"
//   "573044726552"      → "+573044726552"
//   "573044726552.0"    → "+573044726552"  (Excel decimal artifact)
//   ""                  → null
//   "No suministrado"   → null
//
// IMPORTANTE: para ALMACENAR, NO toca el "1" de México mobile ni el "9" de
// Argentina mobile (respeta el formato como llega del webhook).
// Para COMPARAR (deduplicación), usar phoneCanonical() que sí los quita:
// "+521..."  → "+52..." (MX móvil con/sin "1" se ven iguales)
// "+549..."  → "+54..." (AR móvil con/sin "9" se ven iguales)
// Esto evita que el mismo número entre dos veces como duplicado fantasma.

export function normalizePhone(raw) {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  // "No suministrado" o similar
  if (/no\s*suministrad/i.test(s)) return null;
  // .0 de Excel
  if (s.endsWith('.0')) s = s.slice(0, -2);
  // Quitar separadores comunes
  s = s.replace(/[\s\-().·]/g, '');
  // Reemplazar 00 internacional por +
  if (s.startsWith('00')) s = '+' + s.slice(2);
  // Si no tiene +, agregarlo
  const hasPlus = s.startsWith('+');
  const digits = hasPlus ? s.slice(1) : s;
  // Validar que el resto sean solo dígitos
  if (!/^\d+$/.test(digits)) return null;
  // Mínimo 7 dígitos (sin el +)
  if (digits.length < 7) return null;
  // Quitar ceros iniciales después del + (raro pero ocurre)
  const cleanDigits = digits.replace(/^0+/, '');
  if (cleanDigits.length < 7) return null;
  return '+' + cleanDigits;
}

/**
 * Versión canónica del teléfono SOLO para comparación de duplicados.
 * Aplica las reglas de WhatsApp Business para que dos formas del mismo
 * número (con/sin el dígito de móvil de país) colapsen a la misma cadena.
 *
 * - México (+52): el "1" después del 52 es el indicador de móvil que
 *   WhatsApp añade a veces. "+5215512345678" y "+525512345678" son el
 *   mismo número físico.
 * - Argentina (+54): el "9" después del 54 es el equivalente para móviles.
 *   "+5491112345678" y "+541112345678" son el mismo número.
 *
 * Si el teléfono no es MX/AR o ya está sin el dígito, lo devuelve igual.
 * Devuelve null si el input no es normalizable.
 */
export function phoneCanonical(raw) {
  const norm = normalizePhone(raw);
  if (!norm) return null;
  // norm viene como "+<digits>". Trabajo sin el "+".
  let digits = norm.slice(1);
  // México móvil: 52 + 1 + 10 dígitos (total 13) → quitar el "1".
  if (digits.length === 13 && digits.startsWith('521')) {
    digits = '52' + digits.slice(3);
  }
  // Argentina móvil: 54 + 9 + 10 dígitos (total 13) → quitar el "9".
  else if (digits.length === 13 && digits.startsWith('549')) {
    digits = '54' + digits.slice(3);
  }
  return '+' + digits;
}

export default normalizePhone;
