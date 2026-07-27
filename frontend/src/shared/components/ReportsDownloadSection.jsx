// Sección de reportes descargables. Rango de fechas + una tarjeta por reporte
// con Excel/CSV. Pega a /reports/<key> y arma el archivo en el navegador.
import { useState } from 'react';
import { FileXls, FileCsv, CalendarBlank, ChartBar, UsersThree, Receipt, ListChecks, Invoice, Trophy, Eye, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const ESTADO = {
  nuevo: 'Nuevo', por_contactar: 'Por contactar', contactado: 'Contactado',
  en_seguimiento: 'En seguimiento', convertido: 'Convertido', no_interesado: 'No interesado',
  proxima_convocatoria: 'Próxima convocatoria',
};

const REPORTS = [
  {
    key: 'resumen-mensual', label: 'Resumen mensual', icon: ChartBar,
    desc: 'Por mes: prospectos entrados, convertidos, tasa de conversión, ventas y cobrado.',
    cols: [
      { h: 'Mes', k: 'mes' }, { h: 'Prospectos', k: 'prospectos', t: 'number' },
      { h: 'Convertidos', k: 'convertidos', t: 'number' }, { h: 'Tasa %', k: 'tasa_conversion', t: 'number' },
      { h: 'Ventas €', k: 'ventas', t: 'number' }, { h: 'Cobrado €', k: 'cobrado', t: 'number' },
    ],
  },
  {
    key: 'prospectos', label: 'Prospectos', icon: UsersThree,
    desc: 'Prospectos por fecha de entrada, con el valor estimado del producto de interés.',
    cols: [
      { h: 'Proyecto', k: 'proyecto' }, { h: 'Nombre', k: 'nombre' }, { h: 'Teléfono', k: 'telefono' },
      { h: 'Email', k: 'email' }, { h: 'Estado', k: 'estado', t: 'estado' }, { h: 'Producto', k: 'producto' },
      { h: 'Valor estimado', k: 'valor_estimado', t: 'number' }, { h: 'Responsable', k: 'responsable' },
      { h: 'Fecha entrada', k: 'fecha_entrada', t: 'date' },
    ],
  },
  {
    key: 'ventas', label: 'Ventas (cobros)', icon: Receipt,
    desc: 'Por fecha de PAGO: cada cuota donde cae. Incluye mes de origen, país y pendiente de cobro.',
    cols: [
      { h: 'Fecha pago', k: 'fecha_pago', t: 'date' }, { h: 'Cliente', k: 'cliente' },
      { h: 'Formación', k: 'formacion' }, { h: 'Importe €', k: 'importe', t: 'number' },
      { h: 'Plan de pago', k: 'plan_pago' }, { h: 'Mes origen', k: 'mes_origen' }, { h: 'País', k: 'pais' },
      { h: 'Pendiente €', k: 'pendiente', t: 'number' }, { h: 'Método', k: 'metodo_pago' },
    ],
  },
  {
    key: 'general', label: 'General (todos los contactos)', icon: ListChecks,
    desc: 'Todos: prospectos y convertidos. Valor estimado en prospectos e importe real en clientes.',
    cols: [
      { h: 'Proyecto', k: 'proyecto' }, { h: 'Nombre', k: 'nombre' }, { h: 'Teléfono', k: 'telefono' },
      { h: 'Estado', k: 'estado', t: 'estado' }, { h: 'País', k: 'pais' },
      { h: 'Producto interés', k: 'producto_interes' }, { h: 'Valor estimado', k: 'valor_estimado', t: 'number' },
      { h: 'Producto contratado', k: 'producto_contratado' }, { h: 'Venta total', k: 'venta_total', t: 'number' },
      { h: 'Cobrado', k: 'venta_cobrado', t: 'number' }, { h: 'Pendiente', k: 'venta_pendiente', t: 'number' },
      { h: 'Método', k: 'metodo_pago' }, { h: 'Responsable', k: 'responsable' },
      { h: 'Fecha entrada', k: 'fecha_entrada', t: 'date' },
      { h: 'Fecha venta', k: 'fecha_venta', t: 'date' },
    ],
  },
  {
    key: 'ventas-vendedora', label: 'Ventas por vendedora', icon: Trophy,
    desc: 'Ventas agrupadas por el responsable del lead: nº de ventas, clientes, total, cobrado y pendiente.',
    cols: [
      { h: 'Vendedora', k: 'vendedora' }, { h: 'Ventas', k: 'ventas', t: 'number' },
      { h: 'Clientes', k: 'clientes', t: 'number' }, { h: 'Total €', k: 'total', t: 'number' },
      { h: 'Cobrado €', k: 'cobrado', t: 'number' }, { h: 'Pendiente €', k: 'pendiente', t: 'number' },
    ],
  },
  {
    key: 'general-facturacion', label: 'General + Facturación', icon: Invoice,
    desc: 'Lo mismo que el general, más lo facturado (nº de facturas e importe facturado).',
    cols: [
      { h: 'Proyecto', k: 'proyecto' }, { h: 'Nombre', k: 'nombre' }, { h: 'Teléfono', k: 'telefono' },
      { h: 'Estado', k: 'estado', t: 'estado' }, { h: 'Producto interés', k: 'producto_interes' },
      { h: 'Valor estimado', k: 'valor_estimado', t: 'number' }, { h: 'Producto contratado', k: 'producto_contratado' },
      { h: 'Venta total', k: 'venta_total', t: 'number' }, { h: 'Cobrado', k: 'venta_cobrado', t: 'number' },
      { h: 'Pendiente', k: 'venta_pendiente', t: 'number' }, { h: 'Nº facturas', k: 'num_facturas', t: 'number' },
      { h: 'Facturado', k: 'facturado', t: 'number' }, { h: 'Facturas', k: 'facturas' },
      { h: 'Responsable', k: 'responsable' },
      { h: 'Fecha entrada', k: 'fecha_entrada', t: 'date' }, { h: 'Fecha venta', k: 'fecha_venta', t: 'date' },
    ],
  },
];

// Fecha como texto dd/mm/aaaa (UTC) para que Excel la muestre completa y no como 'jul-26'.
function fmtDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

function scalar(c, row) {
  const v = row[c.k];
  if (v == null || v === '') return SIN_ASIGNAR.has(c.k) ? 'Sin asignar' : null;
  if (c.t === 'number') { const n = Number(v); return Number.isNaN(n) ? null : n; }
  if (c.t === 'date') return fmtDate(v);
  if (c.t === 'estado') return ESTADO[v] || String(v);
  return String(v);
}

// Columnas donde un valor vacío significa "sin asignar" (responsable/vendedora).
const SIN_ASIGNAR = new Set(['responsable', 'vendedora']);

function csvCell(c, row) {
  const v = row[c.k];
  if (v == null || v === '') return SIN_ASIGNAR.has(c.k) ? 'Sin asignar' : '';
  if (c.t === 'estado') return ESTADO[v] || String(v);
  if (c.t === 'date') return fmtDate(v) || '';
  return String(v);
}

// Texto para mostrar en la vista previa (tabla en pantalla).
function cellText(c, row) {
  const v = row[c.k];
  if (v == null || v === '') return SIN_ASIGNAR.has(c.k) ? 'Sin asignar' : '—';
  if (c.t === 'estado') return ESTADO[v] || String(v);
  if (c.t === 'date') return fmtDate(v) || '—';
  if (c.t === 'number') { const n = Number(v); return Number.isNaN(n) ? String(v) : n.toLocaleString('es-ES'); }
  return String(v);
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsDownloadSection({ projectId, projectName }) {
  const [from, setFrom] = useState(() => `${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null); // { report, rows, base }
  const ready = Boolean(from && to);

  // Trae las filas del reporte del backend (compartido por descarga y vista previa).
  async function fetchRows(report) {
    const dFrom = from && to && from > to ? to : from;
    const dTo = from && to && from > to ? from : to;
    const p = new URLSearchParams();
    if (projectId) p.set('projectId', String(projectId));
    if (dFrom) p.set('from', dFrom);
    if (dTo) p.set('to', dTo);
    const res = await client.get(`/reports/${report.key}?${p.toString()}`);
    const rows = res.data || [];
    const sufijo = dFrom || dTo ? `${dFrom || 'inicio'}_${dTo || 'hoy'}` : 'todo';
    return { rows, base: `${report.key}-${projectName || 'crm'}-${sufijo}` };
  }

  async function openPreview(report) {
    setBusy(`${report.key}:preview`);
    try {
      const { rows, base } = await fetchRows(report);
      if (!rows.length) { toast({ title: 'Sin datos en ese período', description: report.label }); return; }
      setPreview({ report, rows, base });
    } catch (err) {
      toast({ title: 'No se pudo cargar la vista previa', description: err?.message, variant: 'destructive' });
    } finally { setBusy(null); }
  }

  // Descarga. Si ya hay filas (desde la vista previa) las reutiliza; si no, las trae.
  async function run(report, format, preloaded) {
    setBusy(`${report.key}:${format}`);
    try {
      const { rows, base } = preloaded || await fetchRows(report);
      if (!rows.length) { toast({ title: 'Sin datos en ese período', description: report.label }); return; }
      if (format === 'xlsx') {
        const writeXlsxFile = (await import('write-excel-file/browser')).default;
        const columns = report.cols.map((c) => ({
          width: c.t === 'date' ? 13 : c.t === 'number' ? 12 : Math.min(42, Math.max(12, c.h.length + 2)),
          header: { value: c.h, type: String, fontWeight: 'bold' },
          cell: (row) => {
            const s = scalar(c, row);
            if (s == null) return null;
            return { value: s, type: c.t === 'number' ? Number : String };
          },
        }));
        await writeXlsxFile(rows, { columns, sheet: 'Datos', dateFormat: 'yyyy-mm-dd' }).toFile(`${base}.xlsx`);
      } else {
        const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
        const head = report.cols.map((c) => esc(c.h)).join(',');
        const body = rows.map((r) => report.cols.map((c) => esc(csvCell(c, r))).join(',')).join('\n');
        downloadBlob(new Blob(['﻿' + head + '\n' + body], { type: 'text/csv;charset=utf-8;' }), `${base}.csv`);
      }
      toast({ title: 'Descarga lista', description: `${report.label}: ${rows.length} fila${rows.length === 1 ? '' : 's'}.` });
    } catch (err) {
      toast({ title: 'No se pudo generar el reporte', description: err?.message, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Reportes descargables</h2>
          <p className="text-xs text-muted-foreground">
            Elige el rango de fechas (Desde y Hasta) y descarga en Excel o CSV.
            {!ready && <span className="text-amber-600 dark:text-amber-500"> Selecciona ambas fechas para habilitar la descarga.</span>}
          </p>
        </div>
        <div className="flex items-end gap-2 rounded-lg border-2 border-primary/40 bg-primary/5 px-3 py-2">
          <span className="hidden lg:block self-center text-xs font-semibold text-primary">Fechas del<br />reporte</span>
          <label className="text-xs font-medium text-foreground">Desde
            <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-2">
              <CalendarBlank size={14} className="text-muted-foreground" />
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-9 bg-transparent text-sm focus:outline-none" />
            </div>
          </label>
          <label className="text-xs font-medium text-foreground">Hasta
            <div className="mt-1 flex items-center gap-1 rounded-md border border-border bg-card px-2">
              <CalendarBlank size={14} className="text-muted-foreground" />
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-9 bg-transparent text-sm focus:outline-none" />
            </div>
          </label>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.key} className="flex flex-col rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon size={16} weight="regular" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-foreground">{r.label}</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">{r.desc}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" disabled={busy !== null || !ready} onClick={() => openPreview(r)}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-60 text-xs font-medium">
                  <Eye size={13} weight="bold" /> {busy === `${r.key}:preview` ? 'Cargando…' : 'Vista previa'}
                </button>
                <button type="button" disabled={busy !== null || !ready} onClick={() => run(r, 'xlsx')}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 text-xs font-semibold">
                  <FileXls size={13} weight="bold" /> {busy === `${r.key}:xlsx` ? 'Generando…' : 'Excel'}
                </button>
                <button type="button" disabled={busy !== null || !ready} onClick={() => run(r, 'csv')}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-60 text-xs font-medium">
                  <FileCsv size={13} weight="bold" /> {busy === `${r.key}:csv` ? 'Generando…' : 'CSV'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Vista previa del reporte (primeras filas) con descarga desde el modal. */}
      {preview && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          <div role="dialog" className="relative bg-card rounded-xl border border-border w-full max-w-5xl max-h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 h-12 border-b border-border">
              <div className="min-w-0">
                <h3 className="text-sm font-bold truncate">{preview.report.label}</h3>
                <p className="text-[11px] text-muted-foreground">{preview.rows.length} fila{preview.rows.length === 1 ? '' : 's'} · mostrando las primeras {Math.min(50, preview.rows.length)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => run(preview.report, 'xlsx', preview)} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 text-xs font-semibold">
                  <FileXls size={13} weight="bold" /> Excel
                </button>
                <button onClick={() => run(preview.report, 'csv', preview)} disabled={busy !== null}
                  className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border bg-card hover:bg-muted text-xs font-medium">
                  <FileCsv size={13} weight="bold" /> CSV
                </button>
                <button onClick={() => setPreview(null)} className="p-1 rounded hover:bg-muted text-muted-foreground"><X size={16} weight="bold" /></button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>{preview.report.cols.map((c) => <th key={c.k} className="text-left px-3 py-2 font-bold whitespace-nowrap">{c.h}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 50).map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30">
                      {preview.report.cols.map((c) => (
                        <td key={c.k} className={`px-3 py-1.5 whitespace-nowrap ${c.t === 'number' ? 'text-right tabular-nums' : ''} ${SIN_ASIGNAR.has(c.k) && (row[c.k] == null || row[c.k] === '') ? 'text-amber-600 dark:text-amber-500 italic' : ''}`}>
                          {cellText(c, row)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
