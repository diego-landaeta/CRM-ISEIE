/**
 * Helpers de periodo para el filtro de mes/año en CommissionsPage (CRM-138).
 * Extraídos del archivo de la página para poder testearlos sin montar React.
 */
import type { ExportColumn } from '@/shared/lib/export';

export interface CommissionRow {
  id: number;
  created_at?: string | null;
  user_nombre?: string | null;
  lead_nombre?: string | null;
  product_nombre?: string | null;
  producto_contratado?: string | null;
  importe_base?: number | string | null;
  pct?: number | null;
  importe_comision?: number | string | null;
  estado?: 'pendiente' | 'pagado' | 'cancelado' | null;
  fecha_pago?: string | null;
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

export function isInMonth(dateStr: string | null | undefined, year: number, month: number): boolean {
  if (!dateStr) return false;
  // Si viene como ISO con T (timestamp) parsear solo la parte de fecha (YYYY-MM-DD).
  // Esto evita que un "2026-01-31T23:30:00Z" se desplace a febrero por timezone local.
  const datePart = String(dateStr).split('T')[0];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    return y === year && mo === month;
  }
  // Fallback: parseo Date estándar (formatos no-ISO)
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === year && d.getMonth() + 1 === month;
}

/**
 * Convierte una lista de comisiones a CSV. Toma un periodo (label) que
 * aparece como cabecera del CSV y se usa también para componer el filename.
 */
export function buildCommissionsCsv(
  items: CommissionRow[],
  period: string,
): { csv: string; filename: string } {
  const sep = (row: Array<string | number | null | undefined>) =>
    row.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
  const rows: Array<Array<string | number | null | undefined>> = [
    [`Comisiones — ${period}`],
    ['Fecha', 'Gestor', 'Cliente', 'Producto', 'Base cobrada (€)', '%', 'Comisión (€)', 'Estado', 'Fecha pago'],
    ...items.map((r) => [
      r.created_at ? new Date(r.created_at).toLocaleDateString('es-ES') : '',
      r.user_nombre || '',
      r.lead_nombre || '',
      r.product_nombre || r.producto_contratado || '',
      Number(r.importe_base || 0).toFixed(2),
      r.pct ?? '',
      Number(r.importe_comision || 0).toFixed(2),
      r.estado || '',
      r.fecha_pago ? new Date(r.fecha_pago).toLocaleDateString('es-ES') : '',
    ]),
  ];
  return {
    csv: rows.map(sep).join('\n'),
    filename: `comisiones-${period.replace(/\s+/g, '_').toLowerCase()}.csv`,
  };
}

// Columnas para el export universal (CRM-196).
export function getCommissionExportColumns(): ExportColumn<CommissionRow>[] {
  return [
    { key: 'created_at', label: 'Fecha', type: 'date', value: (r) => r.created_at || null },
    { key: 'user_nombre', label: 'Gestor', type: 'string', value: (r) => r.user_nombre || '' },
    { key: 'lead_nombre', label: 'Cliente', type: 'string', value: (r) => r.lead_nombre || '' },
    { key: 'producto', label: 'Producto', type: 'string', value: (r) => r.product_nombre || r.producto_contratado || '' },
    { key: 'importe_base', label: 'Base cobrada (€)', type: 'number', value: (r) => Number(r.importe_base || 0) },
    { key: 'pct', label: '%', type: 'number', value: (r) => r.pct ?? null },
    { key: 'importe_comision', label: 'Comisión (€)', type: 'number', value: (r) => Number(r.importe_comision || 0) },
    { key: 'estado', label: 'Estado', type: 'string', value: (r) => r.estado || '' },
    { key: 'fecha_pago', label: 'Fecha pago', type: 'date', value: (r) => r.fecha_pago || null },
  ];
}
