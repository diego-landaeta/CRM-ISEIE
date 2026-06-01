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
// IMPORTANTE: NO toca el "1" de México mobile ni el "9" de Argentina mobile.
// Si llega "+521..." (MX WhatsApp) o "+549..." (AR WhatsApp), los mantiene.
// Si llega "+52..." o "+54..." sin esos dígitos, también los mantiene.
// Esto respeta la decisión del owner de "como llega de iseie".

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

export default normalizePhone;
