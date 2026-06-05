// Export CSV con formato Wasapi (plantilla bulk WhatsApp).
// Columnas fijas (orden A-H):
//   A: Nombre
//   B: Email
//   C: Teléfono (E.164 sin + ni espacios — Wasapi acepta así)
//   D: Tipo del producto (Máster | Curso | Diplomado | Doctorado | Sin especificar)
//   E: Producto (nombre limpio sin el prefijo Tipo)
//   F: Estado del lead (label legible)
//   G: Tipo + Producto (concatenación que Wasapi usa en el mensaje)
//   H: País (derivado del prefijo telefónico cuando no hay campo explícito)

// Prefijos telefónicos → país. Ampliable, mantener el orden por longitud desc.
const COUNTRY_CODES = [
  ['593', 'Ecuador'],
  ['591', 'Bolivia'],
  ['507', 'Panamá'],
  ['506', 'Costa Rica'],
  ['505', 'Nicaragua'],
  ['504', 'Honduras'],
  ['503', 'El Salvador'],
  ['502', 'Guatemala'],
  ['598', 'Uruguay'],
  ['595', 'Paraguay'],
  ['58', 'Venezuela'],
  ['57', 'Colombia'],
  ['56', 'Chile'],
  ['54', 'Argentina'],
  ['52', 'México'],
  ['51', 'Perú'],
  ['34', 'España'],
  ['1', 'EE.UU.'],
];

// Etiquetas legibles para los status del lead (mismas que usa la UI).
const STATUS_LABEL = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  en_proceso: 'En Proceso',
  interesado: 'Interesado',
  calificado: 'Calificado',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
  perdido: 'Perdido',
};

// Regex para separar prefijo "Máster ... / Curso ... / Diplomado ..." del resto
// del nombre del producto. La 'i' permite minúsculas/acentos opcionales.
const TIPO_REGEX = /^(Máster|Mаster|Master|Maestría|Maestria|Curso|Diplomado|Doctorado|PhD)\s+/i;

function detectTipo(productoNombre) {
  if (!productoNombre) return 'Sin especificar';
  const m = String(productoNombre).match(TIPO_REGEX);
  if (!m) return 'Sin especificar';
  const norm = m[1].toLowerCase();
  if (norm.startsWith('maestr')) return 'Máster';
  if (norm.startsWith('mast') || norm.startsWith('máster')) return 'Máster';
  if (norm === 'curso') return 'Curso';
  if (norm === 'diplomado') return 'Diplomado';
  if (norm === 'doctorado' || norm === 'phd') return 'Doctorado';
  return 'Sin especificar';
}

function stripTipo(productoNombre) {
  if (!productoNombre) return '';
  return String(productoNombre).replace(TIPO_REGEX, '').trim();
}

// Detecta país por prefijo telefónico (espera teléfono normalizado E.164 sin +).
export function detectCountry(telefonoRaw) {
  if (!telefonoRaw) return '';
  const digits = String(telefonoRaw).replace(/[^\d]/g, '');
  if (!digits) return '';
  for (const [code, country] of COUNTRY_CODES) {
    if (digits.startsWith(code)) return country;
  }
  return '';
}

// Escapa un valor para CSV: si contiene coma, comilla o salto de línea → entre
// comillas; las comillas internas se duplican.
function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Mapea un lead a la fila Wasapi (los 8 valores en orden A-H).
 */
export function leadToWasapiRow(l) {
  const prodNombre = l.producto_nombre || '';
  const tipo = detectTipo(prodNombre);
  const producto = stripTipo(prodNombre);
  const estado = STATUS_LABEL[l.status] || l.status || '';
  const combinado = prodNombre || (tipo !== 'Sin especificar' ? tipo : '');
  const pais = detectCountry(l.telefono);
  return {
    nombre: l.nombre || '',
    email: l.email || '',
    telefono: l.telefono || '',
    tipo,
    producto,
    estado,
    combinado,
    pais,
  };
}

export const WASAPI_HEADERS = ['Nombre', 'Email', 'Teléfono', 'Tipo', 'Producto', 'Estado', 'Tipo + Producto', 'País'];

/**
 * Convierte un array de leads (con join a products) en un CSV Wasapi listo
 * para descargar. Incluye BOM UTF-8 para que Excel lo abra bien.
 *
 * Cada lead debe traer al menos:
 *   { nombre, email, telefono, status, producto_nombre? }
 *
 * @returns {string} CSV completo (con BOM y header).
 */
export function leadsToWasapiCsv(leads, { withHeader = true } = {}) {
  const rows = [];
  if (withHeader) {
    rows.push(['Nombre', 'Email', 'Teléfono', 'Tipo', 'Producto', 'Estado', 'Tipo + Producto', 'País'].map(csvCell).join(','));
  }
  for (const l of leads) {
    const prodNombre = l.producto_nombre || '';
    const tipo = detectTipo(prodNombre);
    const producto = stripTipo(prodNombre);
    const estado = STATUS_LABEL[l.status] || l.status || '';
    const combinado = prodNombre || (tipo !== 'Sin especificar' ? tipo : '');
    const pais = detectCountry(l.telefono);
    rows.push([
      l.nombre || '',
      l.email || '',
      l.telefono || '',
      tipo,
      producto,
      estado,
      combinado,
      pais,
    ].map(csvCell).join(','));
  }
  // BOM para que Excel detecte UTF-8 al abrir sin importar.
  return '﻿' + rows.join('\r\n') + '\r\n';
}

/**
 * Genera un Buffer XLSX (Excel) con el mismo formato Wasapi.
 * El teléfono va como TEXTO para evitar que Excel lo convierta a notación
 * científica (5.93e+11) y rompa el número.
 *
 * Carga exceljs dinámicamente — la lib es ~2MB, no la importamos al boot.
 *
 * @returns {Promise<Buffer>} Buffer del archivo .xlsx
 */
export async function leadsToWasapiXlsx(leads) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Wasapi Export';
  wb.created = new Date();
  const ws = wb.addWorksheet('Leads', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  // Header
  ws.columns = WASAPI_HEADERS.map((name, i) => ({
    header: name,
    key: ['nombre', 'email', 'telefono', 'tipo', 'producto', 'estado', 'combinado', 'pais'][i],
    width: [24, 28, 18, 14, 32, 14, 40, 14][i],
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).alignment = { vertical: 'middle' };

  // Forzar la columna C (teléfono) como TEXTO para que Excel no la convierta a número
  ws.getColumn('telefono').numFmt = '@';

  // Filas
  for (const l of leads) {
    ws.addRow(leadToWasapiRow(l));
  }

  return wb.xlsx.writeBuffer().then((b) => Buffer.from(b));
}
