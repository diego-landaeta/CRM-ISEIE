// Template HTML de factura ISEIE (single page con overflow a multipage).
// Replica el diseño de las facturas oficiales que el cliente proporcionó:
// emisor a la izquierda, número/fecha a la derecha, bloque "FACTURA A:"
// con datos del cliente según tipo (persona_natural / empresa / contado),
// tabla descripción-importe, totales con IVA exento (0%), datos registrales
// al pie y sello circular ISEIE bottom-right.
//
// Diferencias clave vs el template heredado del CRM hermano (deprecado):
//   - Cabecera institucional simple (no bandas rosa-palo ni clip-path).
//   - 3 tipos de factura controlados por `data.tipo`.
//   - IVA siempre 0% por exención art.20 L37/1992 (formación).
//   - Sello ISEIE en lugar de firma manuscrita.
//   - Datos registrales en una línea pequeña al pie.

export const ISEIE_EMISOR = {
  nombre: 'ISEIE INNOVATION SCHOOL S.L.',
  nif:    'B67799247',
  direccion: 'AV. ARAGÓN 30-8-5º, 46021, VALENCIA',
};

export const ISEIE_DATOS_REGISTRALES =
  'Datos Registrales: Escritura otorgada en el registro mercantil de VALÈNCIA. ' +
  'Tomo: 11081, Libro: 8359, Folio: 197, Sección: 1, Hoja: V201399 ' +
  'Inscripción o anotación: 1 / Fecha: 23/11/2021 Año Pre.: 2021';

export const ISEIE_IVA_EXENTO_TEXT =
  'Esta formación está exenta en virtud del art. 20, punto 9 de la ley IVA 37/1992';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtFechaES(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

function fmtEur(n) {
  const num = Number(n || 0);
  return num.toFixed(2).replace('.', ',') + ' €';
}

export function buildIseieInvoiceHtml(data, { logoDataUrl, selloDataUrl, fontsCss } = {}) {
  const tipo = (data.tipo || (data.cliente_razon_social ? 'empresa' : (data.cliente_nombre ? 'persona_natural' : 'contado')));
  const numero = data.numero ?? data.numero_factura ?? '';
  const fecha = fmtFechaES(data.fecha);

  const lineas = (data.lineas && data.lineas.length > 0)
    ? data.lineas
    : (data.concepto
        ? [{ descripcion: data.concepto.descripcion, cantidad: 1, precio: data.concepto.importe }]
        : []);

  const subtotal = lineas.reduce(
    (s, l) => s + (parseFloat(l.precio || 0) * parseInt(l.cantidad || 1)),
    0
  );
  const iva = 0;
  const total = subtotal + iva;

  // Bloque "FACTURA A:" varía por tipo.
  let facturaABlock = '';
  if (tipo === 'persona_natural') {
    facturaABlock = `
      <div class="factura-a">
        <h2>FACTURA A:</h2>
        <div class="cli-row"><span class="cli-label">NOMBRE Y APELLIDO:</span> ${esc(data.cliente_nombre || '')}</div>
        <div class="cli-row"><span class="cli-label">DIRECCIÓN:</span> ${esc(data.cliente_direccion || '')}</div>
        <div class="cli-row"><span class="cli-label">NÚMERO TELEFÓNICO:</span> ${esc(data.cliente_telefono || '')}</div>
        <div class="cli-row"><span class="cli-label">DNI:</span> ${esc(data.cliente_dni || '')}</div>
      </div>`;
  } else if (tipo === 'empresa') {
    facturaABlock = `
      <div class="factura-a">
        <h2>FACTURA A:</h2>
        <div class="cli-row"><span class="cli-label">RAZÓN SOCIAL:</span> ${esc(data.cliente_razon_social || '')}</div>
        <div class="cli-row"><span class="cli-label">DIRECCIÓN:</span> ${esc(data.cliente_direccion || '')}</div>
        <div class="cli-row"><span class="cli-label">NÚMERO TELEFÓNICO:</span> ${esc(data.cliente_telefono || '')}</div>
        <div class="cli-row"><span class="cli-label">NIF:</span> ${esc(data.cliente_nif || '')}</div>
      </div>`;
  } else {
    // contado: no hay bloque cliente, en su lugar título grande "FACTURA DE CONTADO"
    facturaABlock = `<div class="factura-contado-title"><h2>FACTURA DE CONTADO</h2></div>`;
  }

  const lineasHtml = lineas.length > 0
    ? lineas.map((l) => `
        <tr>
          <td class="col-desc">${esc(l.descripcion || '')}</td>
          <td class="col-importe">${l.precio ? fmtEur(parseFloat(l.precio || 0) * parseInt(l.cantidad || 1)) : ''}</td>
        </tr>`).join('')
    : `<tr><td class="col-desc">&nbsp;</td><td class="col-importe">&nbsp;</td></tr>`;

  // Si solo hay 1 línea, añadimos una fila vacía para que la tabla luzca como el PDF.
  const lineasFillerHtml = lineas.length <= 1
    ? `<tr><td class="col-desc">&nbsp;</td><td class="col-importe">&nbsp;</td></tr>`
    : '';

  const contadoExtraHtml = tipo === 'contado'
    ? `<div class="iva-exento-note">${esc(ISEIE_IVA_EXENTO_TEXT)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<style>
  ${fontsCss || ''}
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  html, body {
    width: 210mm; min-height: 297mm;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', Arial, sans-serif;
    color: #111;
    background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: 210mm; min-height: 297mm;
    padding: 18mm 16mm 14mm 16mm;
    position: relative;
    background: #fff;
  }

  /* ── Header: emisor (izquierda) + logo (derecha) ── */
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8mm;
  }
  .emisor {
    font-size: 9.5pt;
    line-height: 1.45;
  }
  .emisor .nombre { font-weight: 700; }
  .emisor .field-label { font-weight: 700; }
  .logo-box {
    width: 50mm;
    text-align: right;
  }
  .logo-box img {
    max-width: 100%;
    max-height: 20mm;
    object-fit: contain;
  }

  /* ── Número + fecha (alineados a la derecha bajo el logo) ── */
  .meta {
    text-align: right;
    margin-bottom: 12mm;
    font-size: 10pt;
  }
  .meta .row { margin: 1mm 0; }
  .meta .label { font-weight: 700; margin-right: 6mm; }
  .meta .value-numero {
    font-weight: 700;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  /* ── FACTURA A: bloque cliente ── */
  .factura-a {
    margin-bottom: 8mm;
  }
  .factura-a h2,
  .factura-contado-title h2 {
    font-size: 22pt;
    font-weight: 700;
    margin-bottom: 5mm;
    letter-spacing: 0.5pt;
  }
  .cli-row {
    font-size: 10pt;
    margin: 2mm 0;
  }
  .cli-row .cli-label { font-weight: 700; }
  .factura-contado-title {
    margin: 4mm 0 10mm;
  }

  /* ── Tabla descripción / importe ── */
  table.items {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin-bottom: 0;
  }
  table.items th {
    background: #f5f5f5;
    font-weight: 700;
    font-size: 10pt;
    padding: 3mm 4mm;
    text-align: left;
    border: 1px solid #d4d4d4;
  }
  table.items th.col-importe { text-align: center; }
  table.items td {
    padding: 4mm;
    font-size: 10pt;
    border-left: 1px solid #d4d4d4;
    border-right: 1px solid #d4d4d4;
    vertical-align: top;
    min-height: 12mm;
  }
  table.items td.col-desc { width: 60%; }
  table.items td.col-importe { width: 40%; text-align: right; }
  table.items tr:last-child td {
    border-bottom: 1px solid #d4d4d4;
  }

  /* ── Caja de totales (IVA + total) en columna derecha ── */
  .totals-wrapper {
    display: flex;
    justify-content: flex-end;
    margin-top: -1px;
  }
  .totals {
    width: 40%;
    border: 1px solid #d4d4d4;
    border-top: none;
    padding: 4mm 5mm;
    font-size: 10pt;
  }
  .totals .totals-row {
    display: flex;
    justify-content: space-between;
    margin: 1.5mm 0;
  }
  .totals .totals-row .label { font-weight: 700; }
  .totals .totals-row.total-final {
    font-weight: 700;
    border-top: 1px solid #d4d4d4;
    margin-top: 2mm;
    padding-top: 2mm;
  }

  /* ── Nota exención IVA (solo contado) ── */
  .iva-exento-note {
    margin-top: 8mm;
    font-size: 10pt;
    font-weight: 700;
  }

  /* ── Observaciones ── */
  .observaciones {
    margin-top: 12mm;
    font-size: 10pt;
  }
  .observaciones .label { font-weight: 700; }

  /* ── Sello bottom-right ── */
  .sello {
    position: absolute;
    right: 16mm;
    bottom: 30mm;
    width: 32mm;
    height: 32mm;
  }
  .sello img {
    width: 100%; height: 100%;
    object-fit: contain;
  }

  /* ── Datos registrales al pie ── */
  .datos-registrales {
    position: absolute;
    left: 16mm; right: 16mm; bottom: 10mm;
    font-size: 7pt;
    color: #555;
    line-height: 1.35;
    text-align: left;
  }
</style>
</head>
<body>
  <div class="page">

    <div class="header">
      <div class="emisor">
        <div class="nombre">${esc(ISEIE_EMISOR.nombre)}</div>
        <div><span class="field-label">NIF:</span> ${esc(ISEIE_EMISOR.nif)}</div>
        <div><span class="field-label">DIRECCIÓN:</span> ${esc(ISEIE_EMISOR.direccion)}</div>
      </div>
      ${tipo === 'contado' && logoDataUrl
        ? `<div class="logo-box"><img src="${logoDataUrl}" alt="ISEIE"/></div>`
        : ''}
    </div>

    <div class="meta">
      <div class="row"><span class="label">N° de factura</span><span class="value-numero">${esc(numero)}</span></div>
      <div class="row"><span class="label">Fecha</span><span class="value-fecha">${esc(fecha)}</span></div>
    </div>

    ${facturaABlock}

    <table class="items">
      <thead>
        <tr>
          <th class="col-desc">DESCRIPCIÓN</th>
          <th class="col-importe">IMPORTE</th>
        </tr>
      </thead>
      <tbody>
        ${lineasHtml}
        ${lineasFillerHtml}
      </tbody>
    </table>

    <div class="totals-wrapper">
      <div class="totals">
        <div class="totals-row"><span class="label">IVA:</span><span>0%</span></div>
        <div class="totals-row"><span class="label">TOTAL IVA:</span><span>${fmtEur(iva)}</span></div>
        <div class="totals-row total-final"><span class="label">TOTAL FACTURA:</span><span>${fmtEur(total)}</span></div>
      </div>
    </div>

    ${contadoExtraHtml}

    <div class="observaciones">
      <span class="label">Observaciones:</span> ${esc(data.notas || data.observaciones || '')}
    </div>

    ${selloDataUrl ? `<div class="sello"><img src="${selloDataUrl}" alt="Sello ISEIE"/></div>` : ''}

    <div class="datos-registrales">${esc(ISEIE_DATOS_REGISTRALES)}</div>
  </div>
</body>
</html>`;
}
