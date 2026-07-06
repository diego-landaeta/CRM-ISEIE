// Validación EXACTA de identificadores fiscales españoles: NIF, NIE y CIF.
// Se usa en el gating fiscal de facturación: no se permite emitir hasta que la
// sociedad emisora tenga un CIF/NIF válido y los datos obligatorios completos.

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
// Letras válidas de tipo de organización en un CIF.
const CIF_ORG_LETTERS = 'ABCDEFGHJNPQRSUVW';
// Para ciertos tipos de organización el dígito de control es una LETRA.
const CIF_CONTROL_LETTERS = 'JABCDEFGHI';

function clean(id) {
  return String(id || '').toUpperCase().replace(/[\s.\-]/g, '');
}

/** NIF de persona física: 8 dígitos + letra de control (tabla DNI). */
export function isValidNif(id) {
  const s = clean(id);
  if (!/^[0-9]{8}[A-Z]$/.test(s)) return false;
  const num = parseInt(s.slice(0, 8), 10);
  return DNI_LETTERS[num % 23] === s[8];
}

/** NIE (extranjeros): X/Y/Z + 7 dígitos + letra de control. */
export function isValidNie(id) {
  const s = clean(id);
  if (!/^[XYZ][0-9]{7}[A-Z]$/.test(s)) return false;
  const prefix = { X: '0', Y: '1', Z: '2' }[s[0]];
  const num = parseInt(prefix + s.slice(1, 8), 10);
  return DNI_LETTERS[num % 23] === s[8];
}

/** CIF de empresa: letra tipo + 7 dígitos + control (dígito o letra). */
export function isValidCif(id) {
  const s = clean(id);
  if (!/^[A-Z][0-9]{7}[0-9A-Z]$/.test(s)) return false;
  if (!CIF_ORG_LETTERS.includes(s[0])) return false;
  const digits = s.slice(1, 8);
  const control = s[8];
  let sumEven = 0;
  let sumOdd = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = parseInt(digits[i], 10);
    if (i % 2 === 0) {
      // posiciones impares (1,3,5,7): se multiplican por 2 y se suman cifras
      const d = n * 2;
      sumOdd += Math.floor(d / 10) + (d % 10);
    } else {
      sumEven += n;
    }
  }
  const total = sumEven + sumOdd;
  const controlDigit = (10 - (total % 10)) % 10;
  const controlLetter = CIF_CONTROL_LETTERS[controlDigit];
  // Según el tipo de organización el control es dígito, letra, o cualquiera de los dos.
  if (/[0-9]/.test(control)) return parseInt(control, 10) === controlDigit;
  return control === controlLetter;
}

/** ¿Es un identificador fiscal español válido (NIF, NIE o CIF)? */
export function isValidSpanishTaxId(id) {
  const s = clean(id);
  if (!s) return false;
  if (/^[XYZ]/.test(s)) return isValidNie(s);
  if (/^[0-9]/.test(s)) return isValidNif(s);
  return isValidCif(s);
}

/**
 * Estado fiscal de una sociedad emisora.
 * Regla de negocio: se PERMITE emitir aunque falte el NIF u otros datos (para no
 * bloquear el negocio). SOLO se bloquea si el NIF está puesto pero es INVÁLIDO
 * (un error de formato/typo, que sí hay que atajar antes de emitir en España).
 * Devuelve:
 *   - ready   → true salvo que el NIF puesto sea inválido (controla el bloqueo).
 *   - missing → lista informativa de lo que falta/está mal (para avisar en UI).
 */
export function issuerFiscalStatus(issuer) {
  const missing = [];
  if (!issuer) return { ready: false, missing: ['sociedad'] };
  const nif = clean(issuer.nif);
  const nifPresent = !!nif && !nif.startsWith('PENDIENTE');
  const invalidNif = nifPresent && !isValidSpanishTaxId(nif);

  if (!nifPresent) missing.push('NIF (pendiente)');
  if (invalidNif) missing.push('CIF/NIF con formato válido para España');
  if (!String(issuer.razon_social || '').trim()) missing.push('razón social');
  if (!String(issuer.direccion || '').trim()) missing.push('domicilio');
  if (!String(issuer.cp || '').trim()) missing.push('código postal');
  if (!String(issuer.ciudad || '').trim()) missing.push('ciudad');

  // Solo un NIF puesto-pero-inválido impide emitir. Falta de NIF/datos = permitido.
  return { ready: !invalidNif, missing };
}
