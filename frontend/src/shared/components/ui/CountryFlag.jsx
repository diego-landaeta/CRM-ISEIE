// Bandera de país en PNG (descargada de flagcdn.com, servida estática desde /flags).
// Resuelve el código ISO a partir del slug del proyecto: 'iseie-es' → 'es'.
// Si no hay match, devuelve null y el componente padre puede mostrar un fallback.

export const COUNTRY_CODES = ['es', 'mx', 'co', 'cl', 'ec', 'pe', 'pa', 'cr', 'ar', 'br', 'cn'];

export function codeFromSlug(slug) {
  if (!slug) return null;
  const m = String(slug).match(/iseie-([a-z]{2})$/i);
  if (!m) return null;
  const code = m[1].toLowerCase();
  return COUNTRY_CODES.includes(code) ? code : null;
}

export default function CountryFlag({ code, slug, className = '' }) {
  const c = code || codeFromSlug(slug);
  if (!c) return null;
  return (
    <img
      src={`/flags/${c}.png`}
      alt={c.toUpperCase()}
      className={`object-cover ${className}`}
      width={40}
      height={30}
      loading="lazy"
    />
  );
}
