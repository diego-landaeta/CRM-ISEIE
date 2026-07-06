// Motor fiscal (spec REQ-FIS-02): determina el régimen de IVA aplicable a una
// factura combinando el tratamiento fiscal del PRODUCTO (exento vs 21% en España)
// con la UBICACIÓN y el TIPO del cliente. Lógica pura y testeable; los % de IVA y
// las coletillas viven en la tabla `fiscal_regimenes` (parametrizada, REQ-FIS-03).

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Estados miembro de la UE (sin España): nombre normalizado + ISO-2.
const UE = new Set([
  'alemania', 'austria', 'belgica', 'bulgaria', 'chipre', 'croacia', 'dinamarca',
  'eslovaquia', 'eslovenia', 'estonia', 'finlandia', 'francia', 'grecia', 'hungria',
  'irlanda', 'italia', 'letonia', 'lituania', 'luxemburgo', 'malta', 'paises bajos',
  'holanda', 'polonia', 'portugal', 'republica checa', 'chequia', 'rumania', 'suecia',
  'de', 'at', 'be', 'bg', 'cy', 'hr', 'dk', 'sk', 'si', 'ee', 'fi', 'fr', 'gr',
  'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'cz', 'ro', 'se',
]);

export function isEspana(pais) {
  const p = norm(pais);
  return !p || /^(espana|spain|es)$/.test(p) || p.includes('espana') || p.includes('spain');
}

// Canarias, Ceuta y Melilla están fuera del IVA peninsular (IGIC/IPSI).
export function isTerritorioSinIva(cp, provincia) {
  const c = String(cp || '').trim();
  if (/^(35|38|51|52)\d{3}$/.test(c) || /^(35|38|51|52)$/.test(c)) return true;
  return /(canarias|palmas|tenerife|ceuta|melilla)/.test(norm(provincia));
}

export function isUE(pais) {
  return UE.has(norm(pais));
}

/**
 * Devuelve la CLAVE del régimen aplicable:
 *   es_21 · es_exento · canarias · ue_b2b · ue_b2c · fuera_ue
 */
export function resolveRegimenClave({ productoExento = false, pais, cp, provincia, tipo, viesValido = false } = {}) {
  if (isEspana(pais)) {
    if (isTerritorioSinIva(cp, provincia)) return 'canarias';
    return productoExento ? 'es_exento' : 'es_21';
  }
  if (isUE(pais)) {
    const esEmpresa = norm(tipo) === 'empresa';
    return (esEmpresa && viesValido) ? 'ue_b2b' : 'ue_b2c';
  }
  return 'fuera_ue';
}
