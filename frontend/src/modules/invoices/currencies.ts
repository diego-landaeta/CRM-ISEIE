// Divisas admitidas al emitir una factura en moneda internacional.
// La lista arranca con las que realmente se cobran por Stripe en los proyectos;
// el resto son las habituales de LATAM. El símbolo es solo para mostrar.
export interface Currency { code: string; label: string; symbol: string }

export const CURRENCIES: Currency[] = [
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'USD', label: 'Dólar estadounidense', symbol: '$' },
  { code: 'MXN', label: 'Peso mexicano', symbol: '$' },
  { code: 'COP', label: 'Peso colombiano', symbol: '$' },
  { code: 'CLP', label: 'Peso chileno', symbol: '$' },
  { code: 'ARS', label: 'Peso argentino', symbol: '$' },
  { code: 'PEN', label: 'Sol peruano', symbol: 'S/' },
  { code: 'DOP', label: 'Peso dominicano', symbol: 'RD$' },
  { code: 'CRC', label: 'Colón costarricense', symbol: '₡' },
  { code: 'PAB', label: 'Balboa panameño', symbol: 'B/.' },
  { code: 'GBP', label: 'Libra esterlina', symbol: '£' },
  { code: 'BOB', label: 'Boliviano', symbol: 'Bs' },
  { code: 'UYU', label: 'Peso uruguayo', symbol: '$U' },
  { code: 'PYG', label: 'Guaraní', symbol: '₲' },
  { code: 'GTQ', label: 'Quetzal', symbol: 'Q' },
  { code: 'HNL', label: 'Lempira', symbol: 'L' },
  { code: 'NIO', label: 'Córdoba', symbol: 'C$' },
  { code: 'VES', label: 'Bolívar', symbol: 'Bs.' },
  { code: 'BRL', label: 'Real brasileño', symbol: 'R$' },
  { code: 'CAD', label: 'Dólar canadiense', symbol: '$' },
];

export const currencyLabel = (code?: string | null): string => {
  const c = CURRENCIES.find((x) => x.code === (code || 'EUR'));
  return c ? `${c.code} · ${c.label}` : (code || 'EUR');
};

// Formatea un importe en su divisa (es-ES, con el código detrás salvo el euro).
export const fmtMoneda = (importe: number | string | null | undefined, code?: string | null): string => {
  const n = Number(importe || 0);
  const cur = code || 'EUR';
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: cur }).format(n);
  } catch {
    return `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  }
};
