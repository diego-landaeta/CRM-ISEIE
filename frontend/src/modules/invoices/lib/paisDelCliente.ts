/*
  El país del cliente de una factura, sin inventarlo.

  Diego, 23/11/2026: la 2026/1008 de ISEIE (Mariano, de Buenos Aires) acababa
  la dirección con «, España», y en el 360 había 66 así. Si la ficha no traía
  país, las pantallas ponían 'España'. Ahora: el de la ficha; si no hay, el del
  prefijo del teléfono, solo con «+» o «00» (un móvil español escrito sin
  prefijo no se confunde con otro país); si tampoco, vacío, y se pide.

  Mismo mapa que `phoneToCountryName` del servidor (shared/utils/countryPrefix.js).
*/
const PAISES: Record<string, string> = {
  '34': 'España', '351': 'Portugal', '33': 'Francia', '39': 'Italia',
  '49': 'Alemania', '44': 'Reino Unido',
  '52': 'México', '54': 'Argentina', '55': 'Brasil', '56': 'Chile',
  '57': 'Colombia', '58': 'Venezuela',
  '51': 'Perú', '53': 'Cuba', '591': 'Bolivia', '593': 'Ecuador',
  '594': 'Guyana Francesa', '595': 'Paraguay', '598': 'Uruguay',
  '502': 'Guatemala', '503': 'El Salvador', '504': 'Honduras',
  '505': 'Nicaragua', '506': 'Costa Rica', '507': 'Panamá',
  '1809': 'República Dominicana', '1829': 'República Dominicana', '1849': 'República Dominicana',
  '1787': 'Puerto Rico', '1939': 'Puerto Rico',
  '1': 'Estados Unidos / Canadá',
};

export function paisPorTelefono(telefono: string | null | undefined): string | null {
  let s = String(telefono ?? '').trim().replace(/[\s\-().·]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) return null;
  const digitos = s.slice(1);
  for (const n of [4, 3, 2, 1]) {
    const p = PAISES[digitos.slice(0, n)];
    if (p) return p;
  }
  return null;
}

/** El de la ficha; si no hay, el del teléfono; si tampoco, ''. */
export function paisDelCliente(pais: string | null | undefined, telefono: string | null | undefined): string {
  const p = String(pais ?? '').trim();
  if (p && p !== '—') return p;
  return paisPorTelefono(telefono) || '';
}
