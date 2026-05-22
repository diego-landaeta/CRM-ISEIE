// Detección de país por prefijo internacional en un número de teléfono.
// Soporta los códigos más usuales en LATAM + Europa + USA. Mapea al nombre
// del país y una bandera emoji para uso visual en la ficha del lead.

interface CountryInfo {
  code: string;       // ISO 3166-1 alpha-2
  name: string;       // nombre en español
  flag: string;       // emoji bandera
  prefix: string;     // sin el '+'
}

// Ordenado por longitud DESC para que prefijos largos ganen (ej: +52 antes que +5).
const PREFIXES: CountryInfo[] = [
  // 4 dígitos
  // 3 dígitos
  { prefix: '593', code: 'EC', name: 'Ecuador',          flag: '🇪🇨' },
  { prefix: '595', code: 'PY', name: 'Paraguay',         flag: '🇵🇾' },
  { prefix: '598', code: 'UY', name: 'Uruguay',          flag: '🇺🇾' },
  { prefix: '591', code: 'BO', name: 'Bolivia',          flag: '🇧🇴' },
  { prefix: '506', code: 'CR', name: 'Costa Rica',       flag: '🇨🇷' },
  { prefix: '507', code: 'PA', name: 'Panamá',           flag: '🇵🇦' },
  { prefix: '502', code: 'GT', name: 'Guatemala',        flag: '🇬🇹' },
  { prefix: '503', code: 'SV', name: 'El Salvador',      flag: '🇸🇻' },
  { prefix: '504', code: 'HN', name: 'Honduras',         flag: '🇭🇳' },
  { prefix: '505', code: 'NI', name: 'Nicaragua',        flag: '🇳🇮' },
  { prefix: '809', code: 'DO', name: 'Rep. Dominicana',  flag: '🇩🇴' },
  { prefix: '829', code: 'DO', name: 'Rep. Dominicana',  flag: '🇩🇴' },
  { prefix: '849', code: 'DO', name: 'Rep. Dominicana',  flag: '🇩🇴' },
  { prefix: '351', code: 'PT', name: 'Portugal',         flag: '🇵🇹' },
  { prefix: '376', code: 'AD', name: 'Andorra',          flag: '🇦🇩' },
  // 2 dígitos
  { prefix: '34', code: 'ES', name: 'España',            flag: '🇪🇸' },
  { prefix: '52', code: 'MX', name: 'México',            flag: '🇲🇽' },
  { prefix: '54', code: 'AR', name: 'Argentina',         flag: '🇦🇷' },
  { prefix: '55', code: 'BR', name: 'Brasil',            flag: '🇧🇷' },
  { prefix: '56', code: 'CL', name: 'Chile',             flag: '🇨🇱' },
  { prefix: '57', code: 'CO', name: 'Colombia',          flag: '🇨🇴' },
  { prefix: '58', code: 'VE', name: 'Venezuela',         flag: '🇻🇪' },
  { prefix: '51', code: 'PE', name: 'Perú',              flag: '🇵🇪' },
  { prefix: '53', code: 'CU', name: 'Cuba',              flag: '🇨🇺' },
  { prefix: '33', code: 'FR', name: 'Francia',           flag: '🇫🇷' },
  { prefix: '39', code: 'IT', name: 'Italia',            flag: '🇮🇹' },
  { prefix: '49', code: 'DE', name: 'Alemania',          flag: '🇩🇪' },
  { prefix: '41', code: 'CH', name: 'Suiza',             flag: '🇨🇭' },
  { prefix: '44', code: 'GB', name: 'Reino Unido',       flag: '🇬🇧' },
  { prefix: '31', code: 'NL', name: 'Países Bajos',      flag: '🇳🇱' },
  { prefix: '32', code: 'BE', name: 'Bélgica',           flag: '🇧🇪' },
  { prefix: '40', code: 'RO', name: 'Rumanía',           flag: '🇷🇴' },
  { prefix: '43', code: 'AT', name: 'Austria',           flag: '🇦🇹' },
  { prefix: '45', code: 'DK', name: 'Dinamarca',         flag: '🇩🇰' },
  { prefix: '46', code: 'SE', name: 'Suecia',            flag: '🇸🇪' },
  { prefix: '47', code: 'NO', name: 'Noruega',           flag: '🇳🇴' },
  { prefix: '48', code: 'PL', name: 'Polonia',           flag: '🇵🇱' },
  // 1 dígito
  { prefix: '1', code: 'US', name: 'EE.UU./Canadá',      flag: '🇺🇸' },
];

// Ordenamos una sola vez por longitud DESC para asegurar match correcto
PREFIXES.sort((a, b) => b.prefix.length - a.prefix.length);

export function detectCountryFromPhone(phone: string | null | undefined): CountryInfo | null {
  if (!phone) return null;
  // Acepta formatos con + o sin + (ej: "+34 600...", "0034600...", "34600...")
  // Limpia separadores
  let raw = String(phone).replace(/[\s\-().]/g, '');
  if (raw.startsWith('00')) raw = raw.slice(2);
  if (raw.startsWith('+')) raw = raw.slice(1);
  if (!/^\d+$/.test(raw)) return null;

  for (const c of PREFIXES) {
    if (raw.startsWith(c.prefix)) return c;
  }
  return null;
}

export type { CountryInfo };
