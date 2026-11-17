/*
  Factura automática (#452) · ¿estos datos valen para una factura?

  Una sola regla para las dos entradas: lo que manda el alumno en el
  formulario y lo que hay en su ficha el día 7. Si la ficha no la pasa, la
  factura NO sale sola: el cobro se queda en la cola para que lo mire una
  persona. Es justo lo que paró la factura automática el 14/09 en el 360:
  salían con lo que hubiera en la ficha —el nombre de relleno con el que se
  crea un prospecto desde WhatsApp, sin NIF, sin dirección—.

  NIF: en España se comprueba de verdad (DNI, NIE y CIF con su letra o dígito
  de control). Fuera de España cada país tiene el suyo (RFC, RUT, CUIT, DNI…)
  y no se puede validar uno a uno: se exige que tenga forma de identificador.
*/

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';

/** «12.345.678-z » → «12345678Z». */
export const limpiarNif = (v) => String(v || '').toUpperCase().replace(/[\s.\-/]/g, '');

export function esDniValido(nif) {
  const m = /^(\d{8})([A-Z])$/.exec(nif);
  return !!m && LETRAS_DNI[Number(m[1]) % 23] === m[2];
}

export function esNieValido(nif) {
  const m = /^([XYZ])(\d{7})([A-Z])$/.exec(nif);
  if (!m) return false;
  const num = Number(`${'XYZ'.indexOf(m[1])}${m[2]}`);
  return LETRAS_DNI[num % 23] === m[3];
}

export function esCifValido(nif) {
  const m = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(nif);
  if (!m) return false;
  const d = m[2].split('').map(Number);
  let suma = 0;
  d.forEach((n, i) => {
    if (i % 2 === 0) { const x = n * 2; suma += Math.floor(x / 10) + (x % 10); } else suma += n;
  });
  const control = (10 - (suma % 10)) % 10;
  const letra = 'JABCDEFGHI'[control];
  // Unas entidades llevan letra, otras número, y algunas cualquiera de los dos.
  if ('PQRSNW'.includes(m[1])) return m[3] === letra;
  if ('ABEH'.includes(m[1])) return m[3] === String(control);
  return m[3] === String(control) || m[3] === letra;
}

export function esNifEspanolValido(v) {
  const nif = limpiarNif(v);
  return esDniValido(nif) || esNieValido(nif) || esCifValido(nif);
}

export const esEspana = (pais) => /^(espa[ñn]a|spain|es)$/i.test(String(pais || '').trim());

/** Fuera de España: algo con forma de identificador fiscal, de 5 a 20 caracteres. */
export function esIdExtranjeroValido(v) {
  const nif = limpiarNif(v);
  return /^[A-Z0-9]{5,20}$/.test(nif) && /\d/.test(nif);
}

export const esCorreo = (v) => /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(String(v || '').trim());

/**
 * ¿Es un nombre de verdad o uno de relleno? Sin letras («+34 600…»), el
 * genérico «Cliente», o una sola palabra para un particular (una factura a
 * nombre de «Mari» no identifica a nadie).
 */
export function motivoNombre(nombre, tipo) {
  const n = String(nombre || '').trim();
  if (!n) return 'falta el nombre';
  if (!/\p{L}/u.test(n)) return 'el nombre no tiene letras';
  if (/^(cliente|contacto|sin nombre|desconocido|whatsapp|prueba)\b/i.test(n)) return 'el nombre es de relleno';
  if (tipo !== 'empresa' && n.split(/\s+/).filter((p) => /\p{L}/u.test(p)).length < 2) {
    return 'falta el apellido';
  }
  return null;
}

/**
 * Lo que falta o está mal, en frases cortas; `[]` = vale para facturar.
 * `d`: { tipo, nombre, nif, direccion, codigo_postal, ciudad, pais, email }.
 */
export function problemas(d = {}) {
  const fuera = [];
  const tipo = d.tipo === 'empresa' ? 'empresa' : 'particular';
  const espana = esEspana(d.pais);
  const nom = motivoNombre(d.nombre, tipo);
  if (nom) fuera.push(nom);
  if (!String(d.nif || '').trim()) fuera.push(tipo === 'empresa' ? 'falta el CIF' : 'falta el NIF');
  else if (espana ? !esNifEspanolValido(d.nif) : !esIdExtranjeroValido(d.nif)) {
    fuera.push(espana ? 'el NIF/CIF no es válido' : 'la identificación fiscal no es válida');
  }
  if (String(d.direccion || '').trim().length < 5) fuera.push('falta la dirección');
  if (!String(d.ciudad || '').trim()) fuera.push('falta la ciudad');
  if (!String(d.pais || '').trim()) fuera.push('falta el país');
  if (espana && !/^\d{5}$/.test(String(d.codigo_postal || '').trim())) fuera.push('falta el código postal');
  if (!esCorreo(d.email)) fuera.push('falta un correo válido');
  return fuera;
}

/** Los datos ya limpios, tal como se guardan y se imprimen. */
export function normalizar(d = {}) {
  const t = (v, max) => (String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null);
  return {
    tipo: d.tipo === 'empresa' ? 'empresa' : 'particular',
    nombre: t(d.nombre, 200),
    nif: limpiarNif(d.nif).slice(0, 50) || null,
    direccion: t(d.direccion, 300),
    codigo_postal: t(d.codigo_postal, 20),
    ciudad: t(d.ciudad, 120),
    pais: t(d.pais, 80),
    email: t(d.email, 255)?.toLowerCase() || null,
  };
}

/**
 * Los datos de la FICHA, con la misma forma. El nombre, como lo pone hoy la
 * factura (`nombreClienteFactura`): la razón social si es empresa.
 */
export function deLaFicha(l = {}) {
  const tipo = l.cliente_tipo === 'empresa' ? 'empresa' : 'particular';
  const razon = tipo === 'empresa' ? String(l.custom_fields?.razon_social || '').trim() : '';
  return normalizar({
    tipo,
    nombre: razon || l.nombre,
    nif: l.identificacion_fiscal,
    direccion: l.direccion_fiscal,
    codigo_postal: l.codigo_postal_fiscal,
    ciudad: l.ciudad_fiscal,
    pais: l.pais_fiscal,
    email: l.email,
  });
}
