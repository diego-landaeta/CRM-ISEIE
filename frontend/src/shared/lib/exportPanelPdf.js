// PDF del panel de Reportes: se descarga directo, sin pasar por el diálogo de
// impresión del navegador.
//
// Lleva lo mismo que el Excel: el resumen comparado con el periodo anterior, la
// evolución del rango y el detalle por asesora. Las gráficas se materializan
// como tablas — un PDF de datos, no una captura de pantalla.

const fmtEur = (n) => new Intl.NumberFormat('es-ES', {
  style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
}).format(Number(n || 0));
const fmtNum = (n) => new Intl.NumberFormat('es-ES').format(Number(n || 0));

function fecha(d) {
  if (!d) return '—';
  const x = new Date(String(d).length === 10 ? `${d}T00:00:00` : d);
  return Number.isNaN(x.getTime()) ? String(d)
    : x.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Nombre legible de cada KPI que devuelve el backend.
const ETIQUETAS = {
  prospectos: 'Prospectos',
  ventas: 'Ventas cerradas',
  vendido: 'Importe vendido',
  ingresos: 'Ingresos cobrados',
  ingresos_venta: '· de ventas nuevas',
  ingresos_cuotas: '· de mensualidades',
  mensualidades: 'Mensualidades cobradas',
  tasa: 'Tasa de conversión',
};
const ES_DINERO = new Set(['vendido', 'ingresos', 'ingresos_venta', 'ingresos_cuotas']);

export async function exportPanelPDF({ panel, asesoras = [], proyecto, rango }) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const PAGE_W = 210, PAGE_H = 297, M = 16;
  const ANCHO = PAGE_W - M * 2;
  let y = M;

  const espacio = (n) => { if (y + n > PAGE_H - M) { doc.addPage(); y = M; } };
  const estilo = (size, weight = 'normal', color = '#0f172a') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', weight);
    doc.setTextColor(color);
  };

  function titulo(txt) {
    espacio(12);
    estilo(13, 'bold');
    doc.text(txt, M, y);
    y += 2;
    doc.setDrawColor('#e2e8f0');
    doc.line(M, y, M + ANCHO, y);
    y += 6;
  }

  // Tabla simple: cols = [{ h, w, align }], filas = string[][]
  function tabla(cols, filas) {
    const alto = 5.4;
    espacio(alto * 2);
    estilo(8, 'bold', '#475569');
    let x = M;
    for (const c of cols) {
      doc.text(String(c.h), c.align === 'right' ? x + c.w - 1 : x, y, { align: c.align || 'left' });
      x += c.w;
    }
    y += 1.5;
    doc.setDrawColor('#cbd5e1');
    doc.line(M, y, M + ANCHO, y);
    y += 3.5;

    estilo(8, 'normal', '#0f172a');
    for (const f of filas) {
      espacio(alto);
      x = M;
      f.forEach((celda, i) => {
        const c = cols[i];
        const txt = String(celda ?? '');
        // Se recorta para que nunca invada la columna siguiente.
        const max = c.w - 2;
        let out = txt;
        while (doc.getTextWidth(out) > max && out.length > 3) out = out.slice(0, -2);
        if (out !== txt) out = `${out}…`;
        doc.text(out, c.align === 'right' ? x + c.w - 1 : x, y, { align: c.align || 'left' });
        x += c.w;
      });
      y += alto;
    }
    y += 3;
  }

  // ── Cabecera ────────────────────────────────────────────────────────────
  estilo(18, 'bold');
  doc.text('Reportes', M, y);
  y += 7;
  estilo(9, 'normal', '#64748b');
  doc.text(`${proyecto || 'Todos los proyectos'} · ${fecha(rango?.from)} – ${fecha(rango?.to)}`, M, y);
  y += 10;

  // ── Resumen ─────────────────────────────────────────────────────────────
  titulo('Resumen del periodo');
  const kpis = panel?.kpis || {};
  const comparable = panel?.rango?.comparable;
  tabla(
    [
      { h: 'Métrica', w: 62 },
      { h: 'Periodo', w: 38, align: 'right' },
      { h: 'Anterior', w: 38, align: 'right' },
      { h: 'Variación', w: 40, align: 'right' },
    ],
    Object.entries(kpis).map(([k, v]) => {
      const dinero = ES_DINERO.has(k);
      const val = dinero ? fmtEur(v.value) : (k === 'tasa' ? `${v.value}%` : fmtNum(v.value));
      const prev = dinero ? fmtEur(v.prev) : (k === 'tasa' ? `${v.prev}%` : fmtNum(v.prev));
      const tr = v.trend == null ? (comparable === false ? 'sin comparar' : '—')
        : `${v.trend >= 0 ? '+' : ''}${v.trend}%`;
      return [ETIQUETAS[k] || k, val, prev, tr];
    }),
  );
  if (comparable === false) {
    estilo(7, 'italic', '#94a3b8');
    espacio(6);
    doc.text('El periodo anterior cae antes del arranque de los datos: no hay comparativa fiable.', M, y);
    y += 6;
  }

  // ── Evolución ───────────────────────────────────────────────────────────
  const serie = panel?.serie || [];
  if (serie.length) {
    const grano = { day: 'día', week: 'semana', month: 'mes' }[panel?.rango?.grano] || 'periodo';
    titulo(`Evolución por ${grano}`);
    tabla(
      [
        { h: 'Periodo', w: 30 },
        { h: 'Prospectos', w: 26, align: 'right' },
        { h: 'Ventas', w: 22, align: 'right' },
        { h: 'Vendido', w: 30, align: 'right' },
        { h: 'Ingresos', w: 30, align: 'right' },
        { h: 'De ventas', w: 30, align: 'right' },
        { h: 'Tasa', w: 10, align: 'right' },
      ],
      serie.map((x) => [
        fecha(x.periodo), fmtNum(x.prospectos), fmtNum(x.ventas),
        fmtEur(x.vendido), fmtEur(x.ingresos), fmtEur(x.ingresos_venta), `${x.tasa}%`,
      ]),
    );
  }

  // ── Asesoras ────────────────────────────────────────────────────────────
  if (asesoras.length) {
    titulo('Asesoras, mes a mes');
    tabla(
      [
        { h: 'Mes', w: 20 },
        { h: 'Asesora', w: 42 },
        { h: 'Leads', w: 18, align: 'right' },
        { h: 'Ventas', w: 18, align: 'right' },
        { h: 'Mensual.', w: 20, align: 'right' },
        { h: 'Tasa', w: 16, align: 'right' },
        { h: 'Vendido', w: 26, align: 'right' },
        { h: 'Cobrado', w: 18, align: 'right' },
      ],
      asesoras.map((a) => [
        a.mes, a.asesora, fmtNum(a.leads), fmtNum(a.ventas), fmtNum(a.mensualidades),
        `${a.tasa_conversion}%`, fmtEur(a.vendido), fmtEur(a.cobrado),
      ]),
    );
  }

  // ── Pie en todas las páginas ────────────────────────────────────────────
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    estilo(7, 'normal', '#94a3b8');
    doc.text(
      'Los prospectos cuentan por fecha de entrada, las ventas por fecha de venta y los cobros por fecha de cobro.',
      M, PAGE_H - 8,
    );
    doc.text(`${i} / ${total}`, PAGE_W - M, PAGE_H - 8, { align: 'right' });
  }

  const nombre = `reportes-${(proyecto || 'crm').replace(/\s+/g, '-')}-${rango?.from}_${rango?.to}.pdf`;
  doc.save(nombre);
  return nombre;
}
