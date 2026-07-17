import { useState, useMemo, useEffect } from 'react';
import { X, Download, FileCsv, FileXls } from '@phosphor-icons/react';

export interface ExportColumn {
  key: string;
  label: string;
  /** Extractor opcional; si no, toma `row[key]`. */
  get?: (row: any) => any;
  default?: boolean;
}

export interface ExportDialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  filename?: string;
  rows?: any[];
  columns?: ExportColumn[];
  context?: string;
}

type Format = 'csv' | 'tsv' | 'json';

function fmtVal(v: any): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    try { return JSON.stringify(v); } catch { return String(v); }
  }
  return String(v);
}

function toCsv(rows: any[], cols: ExportColumn[], sep = ','): string {
  const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const header = cols.map((c) => escape(c.label)).join(sep);
  const body = rows.map((r) =>
    cols.map((c) => escape(fmtVal(c.get ? c.get(r) : r?.[c.key]))).join(sep)
  ).join('\n');
  return '﻿' + header + '\n' + body;
}

function toJson(rows: any[], cols: ExportColumn[]): string {
  return JSON.stringify(
    rows.map((r) => {
      const out: Record<string, any> = {};
      cols.forEach((c) => { out[c.key] = c.get ? c.get(r) : r?.[c.key]; });
      return out;
    }),
    null, 2
  );
}

export default function ExportDialog({ open, onClose, title = 'Exportar', filename = 'export', rows = [], columns = [] }: ExportDialogProps) {
  const [format, setFormat] = useState<Format>('csv');
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(columns.map((c) => [c.key, c.default !== false]))
  );

  const cols = useMemo(() => columns.filter((c) => selected[c.key]), [columns, selected]);

  // Bloquear scroll del fondo mientras el diálogo está abierto.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  function download() {
    const today = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      const blob = new Blob([toJson(rows, cols)], { type: 'application/json' });
      trigger(blob, `${filename}_${today}.json`);
    } else {
      const sep = format === 'tsv' ? '\t' : ',';
      const blob = new Blob([toCsv(rows, cols, sep)], { type: 'text/csv;charset=utf-8' });
      trigger(blob, `${filename}_${today}.${format}`);
    }
    onClose();
  }

  function trigger(blob: Blob, name: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  const visibleCount = cols.length;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-semibold text-lg flex items-center gap-2"><Download size={18} weight="duotone" className="text-primary" /> {title}</h2>
            <p className="text-xs text-muted-foreground mt-1">{rows.length} fila{rows.length === 1 ? '' : 's'} disponibles.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Formato</div>
            <div className="grid grid-cols-3 gap-2">
              {(['csv', 'tsv', 'json'] as Format[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md text-xs font-semibold border transition-colors ${
                    format === f ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  {f === 'json' ? <FileXls size={13} /> : <FileCsv size={13} />}
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {columns.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Columnas</div>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={() => setSelected(Object.fromEntries(columns.map((c) => [c.key, true])))} className="text-primary hover:underline">Todas</button>
                  <span className="text-muted-foreground/40">·</span>
                  <button onClick={() => setSelected(Object.fromEntries(columns.map((c) => [c.key, false])))} className="text-muted-foreground hover:text-foreground">Ninguna</button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto overscroll-contain rounded-lg border border-border divide-y divide-border">
                {columns.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/40 transition-colors">
                    <input
                      type="checkbox"
                      checked={!!selected[c.key]}
                      onChange={(e) => setSelected((s) => ({ ...s, [c.key]: e.target.checked }))}
                      className="w-4 h-4"
                    />
                    <span className="flex-1">{c.label}</span>
                    <span className="text-[10px] text-muted-foreground/60 font-mono">{c.key}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 rounded-md border border-border text-sm font-medium hover:bg-muted transition-colors"
          >Cancelar</button>
          <button
            type="button"
            onClick={download}
            disabled={rows.length === 0 || visibleCount === 0}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <Download size={13} weight="bold" />
            Descargar {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
