// Descargable combinado "Prospectos + Ventas" (Análisis › Reportes).
// Trae TODOS los prospectos del período INCLUYENDO los convertidos (ventas),
// que en el listado operativo de Prospectos quedan ocultos. Para análisis del
// owner en un solo archivo, sin sobrecargar Prospectos. Reutiliza las columnas
// del export universal (getLeadExportColumns). ISEIE no tiene runExport → el
// CSV se construye aquí igual que en ExportDialog.
import client from '@/shared/api/client';
import type { Lead } from '@/shared/types';
import type { ExportColumn } from '@/shared/lib/export';
import { getLeadExportColumns } from '@/modules/leads/lib/leadFormat';

export interface ReportLeadFilters {
  projectId?: number;
  dateFrom?: string;
  dateTo?: string;
  /** Incluir los leads ya convertidos (ventas). Por defecto true en este reporte. */
  includeConverted?: boolean;
}

// El backend mapea el estado como `status`; el export usa `estado`.
function normalize(row: Record<string, unknown>): Lead {
  return {
    ...row,
    estado: (row.status as string) || (row.estado as string),
    origen: (row.canal_detectado as string) || (row.origen as string) || 'directo',
  } as unknown as Lead;
}

/** Pagina /leads (limit 500) hasta traer TODO lo filtrado. */
export async function fetchLeadsForReport(f: ReportLeadFilters): Promise<Lead[]> {
  const PAGE = 500;
  const all: Lead[] = [];
  let page = 1;
  for (let guard = 0; guard < 100; guard++) {
    const p = new URLSearchParams();
    if (f.projectId) p.set('projectId', String(f.projectId));
    if (f.dateFrom) p.set('dateFrom', f.dateFrom);
    if (f.dateTo) p.set('dateTo', f.dateTo);
    if (f.includeConverted) p.set('includeConverted', 'true');
    p.set('page', String(page));
    p.set('limit', String(PAGE));
    const res = await client.get(`/leads?${p.toString()}`);
    if (!res.success) break;
    const batch = ((res.data as Record<string, unknown>[]) || []).map(normalize);
    all.push(...batch);
    const total = (res as { pagination?: { total?: number } }).pagination?.total ?? all.length;
    if (batch.length < PAGE || all.length >= total) break;
    page += 1;
  }
  return all;
}

function cell(col: ExportColumn<Lead>, row: Lead): string {
  const v = col.value(row);
  if (v == null) return '';
  if (col.type === 'date') {
    const d = new Date(v as string);
    return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('es-ES');
  }
  return String(v);
}

function toCsv(rows: Lead[], cols: ExportColumn<Lead>[]): string {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const head = cols.map((c) => esc(c.label)).join(',');
  const body = rows.map((r) => cols.map((c) => esc(cell(c, r))).join(',')).join('\n');
  return head + '\n' + body;
}

/** Trae las filas y dispara la descarga CSV con las columnas del export universal. */
export async function downloadLeadsReport(
  f: ReportLeadFilters,
  opts: { filename?: string } = {},
): Promise<number> {
  const rows = await fetchLeadsForReport({ includeConverted: true, ...f });
  const cols = getLeadExportColumns();
  const csv = toCsv(rows, cols);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${opts.filename || `prospectos-ventas-${new Date().toISOString().slice(0, 10)}`}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
