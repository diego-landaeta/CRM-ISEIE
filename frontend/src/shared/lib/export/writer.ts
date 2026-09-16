// Writer universal: XLSX, CSV, JSON (CRM-196).
import type { ExportRequest, ExportColumn, ExportColumnConfig } from './types';

function resolveColumns<T>(req: ExportRequest<T>): { col: ExportColumn<T>; cfg: ExportColumnConfig }[] {
  const byKey = new Map(req.columns.map((c) => [c.key, c]));
  return req.config
    .filter((c) => c.included)
    .map((cfg) => ({ col: byKey.get(cfg.key), cfg }))
    .filter((x): x is { col: ExportColumn<T>; cfg: ExportColumnConfig } => Boolean(x.col));
}

function toScalar(value: unknown, type: string | undefined): string | number | boolean | Date | null {
  if (value == null) return null;
  if (type === 'date') {
    if (value instanceof Date) return value;
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d;
  }
  if (type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    return isNaN(n) ? null : n;
  }
  if (type === 'boolean') return Boolean(value);
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return String(value);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 100);
}

async function writeXlsx<T>(req: ExportRequest<T>): Promise<void> {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const cols = resolveColumns(req);

  // API v4 de write-excel-file: pasamos `objects` + `columns`, donde cada column
  // tiene `header` (cell) + `cell(obj)` (cell). Usamos el atajo del segundo overload:
  // writeXlsxFile<T>(rows, { columns, sheet, fileName? }) — fileName solo en universal/node;
  // en browser usamos `.toFile(name)`.
  const columnsConfig = cols.map(({ col, cfg }) => {
    type Cons = StringConstructor | NumberConstructor | DateConstructor | BooleanConstructor;
    let runtimeType: Cons = String;
    if (col.type === 'number') runtimeType = Number;
    else if (col.type === 'date') runtimeType = Date;
    else if (col.type === 'boolean') runtimeType = Boolean;

    // Ancho por defecto: las columnas de fecha/número necesitan un mínimo o
    // Excel las muestra como "####" (celda demasiado angosta para el valor).
    // Para texto dejamos que la lib estime, con un mínimo razonable por header.
    const fallbackWidth = col.type === 'date' ? 13
      : col.type === 'number' ? 12
      : Math.min(40, Math.max(12, String(cfg.label || col.label).length + 2));
    return {
      width: col.width ?? fallbackWidth,
      header: { value: cfg.label || col.label, type: String, fontWeight: 'bold' as const },
      cell: (row: T) => {
        const scalar = toScalar(col.value(row), col.type);
        if (scalar == null) return null;
        return { value: scalar, type: runtimeType };
      },
    };
  });

  const filename = req.filename.endsWith('.xlsx') ? req.filename : `${req.filename}.xlsx`;
  // El tipado de la lib es estricto; usamos cast porque la mezcla de constructores tipados
  // por columna (String/Number/Date/Boolean) es difícil de expresar en el genérico Object.
  type WriteApi = (
    objects: T[],
    options: { columns: typeof columnsConfig; sheet?: string; dateFormat?: string },
  ) => { toFile: (name: string) => Promise<void> };
  const writer = writeXlsxFile as unknown as WriteApi;
  await writer(req.rows, {
    columns: columnsConfig,
    sheet: 'Datos',
    dateFormat: 'yyyy-mm-dd',
  }).toFile(filename);
}

function writeCsv<T>(req: ExportRequest<T>): void {
  const cols = resolveColumns(req);
  const headers = cols.map(({ cfg, col }) => csvEscape(cfg.label || col.label));
  const rows = req.rows.map((row) =>
    cols.map(({ col }) => {
      const scalar = toScalar(col.value(row), col.type);
      if (scalar instanceof Date) return csvEscape(scalar.toISOString());
      return csvEscape(scalar == null ? '' : String(scalar));
    }).join(','),
  );
  const csv = [headers.join(','), ...rows].join('\n');
  // BOM para que Excel detecte UTF-8
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const filename = req.filename.endsWith('.csv') ? req.filename : `${req.filename}.csv`;
  triggerDownload(blob, filename);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function writeJson<T>(req: ExportRequest<T>): void {
  const cols = resolveColumns(req);
  const data = req.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    cols.forEach(({ col, cfg }) => {
      const raw = col.value(row);
      const scalar = toScalar(raw, col.type);
      obj[cfg.label || col.label] = scalar instanceof Date ? scalar.toISOString() : scalar;
    });
    return obj;
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8;' });
  const filename = req.filename.endsWith('.json') ? req.filename : `${req.filename}.json`;
  triggerDownload(blob, filename);
}

export async function runExport<T>(req: ExportRequest<T>): Promise<void> {
  if (req.format === 'xlsx') return writeXlsx(req);
  if (req.format === 'csv') return writeCsv(req);
  if (req.format === 'json') return writeJson(req);
  throw new Error(`Formato no soportado: ${req.format}`);
}
