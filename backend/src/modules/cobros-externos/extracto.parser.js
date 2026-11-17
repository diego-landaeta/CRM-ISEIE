/**
 * Leer un extracto del banco (#766): Norma 43 (AEB43, el «Cuaderno 43») o el
 * CSV que descarga la banca online del Santander.
 *
 * Devuelve `{ formato, cuenta, desde, hasta, movimientos: [...] }`. Cada
 * movimiento: { fechaOperacion, fechaValor, importe (con signo: + abono, − cargo),
 * moneda, concepto, referencia }. Aquí no se decide nada: solo se lee.
 */
import { createHash } from 'node:crypto';

/** El texto del fichero: UTF-8 si lo es; si no, Latin-1 (lo normal en la Norma 43). */
export function textoDelFichero(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  const utf8 = b.toString('utf8');
  const texto = utf8.includes('\uFFFD') ? b.toString('latin1') : utf8;
  return texto.replace(/^\uFEFF/, '');
}

/** ¿Parece Norma 43? Su primera línea útil es un registro 11 de cabecera. */
export function esNorma43(texto) {
  const primera = texto.split(/\r?\n/).find((l) => l.trim());
  return !!primera && /^11\d{18}\d{6}\d{6}/.test(primera);
}

const aaMMdd = (s) => {
  if (!/^\d{6}$/.test(s)) return null;
  const a = Number(s.slice(0, 2));
  // Dos cifras de año: del 80 al 99 es el siglo pasado (la norma es de 1988).
  return `${a >= 80 ? 1900 + a : 2000 + a}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
};

// Las divisas de la norma van en código numérico ISO 4217.
const DIVISAS = { '978': 'EUR', '840': 'USD', '826': 'GBP', '756': 'CHF' };

/** Enmascara una cuenta: solo los cuatro últimos dígitos. Nunca se guarda entera. */
export function enmascararCuenta(c) {
  const d = String(c || '').replace(/\D/g, '');
  return d.length >= 4 ? `****${d.slice(-4)}` : null;
}

/**
 * Norma 43. Registros de 80 posiciones:
 *   11  cabecera de cuenta: entidad, oficina, cuenta, fechas, divisa
 *   22  movimiento: fechas, debe(1)/haber(2), importe (14 con 2 decimales),
 *       documento, referencia 1 y 2
 *   23  concepto complementario del movimiento anterior (hasta 5)
 *   24  equivalencia de divisa · 33 final de cuenta · 88 fin de fichero
 */
export function leerNorma43(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.replace(/\s+$/, '')).filter(Boolean);
  const movimientos = [];
  let cuenta = null;
  let moneda = 'EUR';
  let desde = null;
  let hasta = null;
  let actual = null;
  for (const bruta of lineas) {
    const l = bruta.padEnd(80, ' ');
    const tipo = l.slice(0, 2);
    if (tipo === '11') {
      cuenta = enmascararCuenta(l.slice(2, 20));
      desde = aaMMdd(l.slice(20, 26)) || desde;
      hasta = aaMMdd(l.slice(26, 32)) || hasta;
      moneda = DIVISAS[l.slice(47, 50)] || 'EUR';
    } else if (tipo === '22') {
      const signo = l.slice(27, 28) === '1' ? -1 : 1;
      const importe = Number(l.slice(28, 42)) / 100;
      if (!Number.isFinite(importe)) throw new Error(`Norma 43: importe ilegible en «${bruta.slice(0, 42)}…»`);
      actual = {
        fechaOperacion: aaMMdd(l.slice(10, 16)),
        fechaValor: aaMMdd(l.slice(16, 22)),
        importe: signo * importe,
        moneda,
        concepto: '',
        referencia: [l.slice(52, 64).trim(), l.slice(64, 80).trim()].filter((x) => x && !/^0+$/.test(x)).join(' ') || null,
        documento: l.slice(42, 52).trim() || null,
        cuenta,
      };
      if (!actual.fechaOperacion) throw new Error(`Norma 43: fecha ilegible en «${bruta.slice(0, 22)}…»`);
      movimientos.push(actual);
    } else if (tipo === '23' && actual) {
      const trozo = `${l.slice(4, 42).trim()} ${l.slice(42, 80).trim()}`.trim();
      actual.concepto = `${actual.concepto} ${trozo}`.trim();
    }
  }
  if (!movimientos.length && !cuenta) throw new Error('No es un fichero Norma 43 válido: no tiene cabecera de cuenta (registro 11).');
  for (const m of movimientos) {
    // La referencia también dice algo (a veces el nombre de quien envía).
    m.concepto = m.concepto || m.referencia || '';
  }
  return { formato: 'n43', cuenta, desde, hasta, movimientos };
}

// ─── CSV ────────────────────────────────────────────────────────────────────

const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Divide una línea CSV respetando las comillas. */
function partir(linea, sep) {
  const out = [];
  let cur = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (comillas && linea[i + 1] === '"') { cur += '"'; i++; } else comillas = !comillas;
    } else if (c === sep && !comillas) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** «1.234,56», «-45,00», «1234.56», «1,234.56 €» → número. null si no lo es. */
export function leerImporte(s) {
  let t = String(s || '').replace(/[€\s]|EUR/gi, '');
  if (!t) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(t)) { negativo = true; t = t.slice(1, -1); }
  if (t.endsWith('-')) { negativo = true; t = t.slice(0, -1); }
  const ultComa = t.lastIndexOf(',');
  const ultPunto = t.lastIndexOf('.');
  if (ultComa > ultPunto) t = t.replace(/\./g, '').replace(',', '.');
  else if (ultPunto > ultComa && ultComa >= 0) t = t.replace(/,/g, '');
  else if (ultComa < 0 && (t.match(/\./g) || []).length > 1) t = t.replace(/\./g, '');
  if (!/^[+-]?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return negativo ? -Math.abs(n) : n;
}

/** «17/11/2026», «17-11-26», «2026-11-17» → «2026-11-17». */
export function leerFecha(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// Cómo se llama cada columna en las descargas del Santander (y en las de otros
// bancos, que se parecen). Se compara sin tildes ni mayúsculas.
const COLUMNAS = {
  fecha: ['fecha operacion', 'fecha de operacion', 'f. operacion', 'fecha'],
  valor: ['fecha valor', 'f. valor', 'fecha de valor'],
  concepto: ['concepto', 'descripcion', 'movimiento', 'detalle', 'observaciones'],
  importe: ['importe', 'cantidad', 'importe eur', 'importe (eur)'],
  haber: ['haber', 'abono', 'ingreso', 'ingresos'],
  debe: ['debe', 'cargo', 'gasto', 'gastos'],
  referencia: ['referencia', 'referencia 1', 'num. documento', 'documento'],
  divisa: ['divisa', 'moneda'],
};

function columna(cabecera, nombres) {
  for (const n of nombres) {
    const i = cabecera.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
}

export function leerCsv(texto) {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim());
  // Delante de la cabecera, la banca online suele poner el titular, la cuenta
  // y las fechas: se busca la primera línea que tenga «fecha» e «importe»
  // (o «haber»).
  let sep = ';';
  let fila = -1;
  for (let i = 0; i < Math.min(lineas.length, 30); i++) {
    for (const s of [';', ',', '\t']) {
      const cab = partir(lineas[i], s).map(sinTildes);
      if (cab.length >= 3 && cab.some((c) => c.startsWith('fecha')) && cab.some((c) => [...COLUMNAS.importe, ...COLUMNAS.haber].includes(c))) {
        sep = s; fila = i; break;
      }
    }
    if (fila >= 0) break;
  }
  if (fila < 0) {
    throw new Error('No se reconoce el CSV: hace falta una fila de cabecera con «Fecha» e «Importe» (o «Haber»).');
  }
  const cab = partir(lineas[fila], sep).map(sinTildes);
  const col = Object.fromEntries(Object.entries(COLUMNAS).map(([k, v]) => [k, columna(cab, v)]));
  if (col.fecha < 0) col.fecha = cab.findIndex((c) => c.startsWith('fecha'));
  if (col.importe < 0 && col.haber < 0) throw new Error('El CSV no tiene columna de importe ni de haber.');

  // La cuenta, si viene en las líneas de antes de la cabecera.
  let cuenta = null;
  for (const l of lineas.slice(0, fila)) {
    const m = l.replace(/\s/g, '').match(/ES\d{22}|\d{20}/i);
    if (m) { cuenta = enmascararCuenta(m[0]); break; }
  }

  const movimientos = [];
  for (const l of lineas.slice(fila + 1)) {
    const c = partir(l, sep);
    const fecha = leerFecha(c[col.fecha]);
    if (!fecha) continue; // pie, totales, líneas vacías
    let importe = col.importe >= 0 ? leerImporte(c[col.importe]) : null;
    if (importe == null && col.haber >= 0) {
      const h = leerImporte(c[col.haber]);
      const d = col.debe >= 0 ? leerImporte(c[col.debe]) : null;
      if (h) importe = Math.abs(h); else if (d) importe = -Math.abs(d);
    }
    if (importe == null) continue;
    movimientos.push({
      fechaOperacion: fecha,
      fechaValor: col.valor >= 0 ? leerFecha(c[col.valor]) : null,
      importe,
      moneda: col.divisa >= 0 && /^[A-Z]{3}$/i.test(c[col.divisa] || '') ? c[col.divisa].toUpperCase() : 'EUR',
      concepto: col.concepto >= 0 ? c[col.concepto] : '',
      referencia: col.referencia >= 0 ? (c[col.referencia] || null) : null,
      cuenta,
    });
  }
  const fechas = movimientos.map((m) => m.fechaOperacion).sort();
  return { formato: 'csv', cuenta, desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null, movimientos };
}

/** Lee el fichero, sea del formato que sea. */
export function leerExtracto(buffer) {
  const texto = textoDelFichero(buffer);
  if (!texto.trim()) throw new Error('El fichero está vacío.');
  return esNorma43(texto) ? leerNorma43(texto) : leerCsv(texto);
}

/**
 * La huella de cada movimiento: lo que lo identifica aunque llegue en dos
 * extractos que se solapan. Dos movimientos IDÉNTICOS el mismo día (dos
 * transferencias iguales) se distinguen por el orden en que aparecen.
 */
export function huellas(projectId, movimientos) {
  const vistos = new Map();
  return movimientos.map((m) => {
    const base = [projectId, m.cuenta || '', m.fechaOperacion, m.fechaValor || '', m.importe.toFixed(2),
      sinTildes(m.concepto).replace(/\s+/g, ' '), m.referencia || ''].join('|');
    const n = (vistos.get(base) || 0) + 1;
    vistos.set(base, n);
    return createHash('sha256').update(`${base}|${n}`).digest('hex');
  });
}

export function huellaDelFichero(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}
