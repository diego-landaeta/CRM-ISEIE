import type { Lead } from '@/shared/types';
import type { ExportColumn } from '@/shared/lib/export';

export { formatDateShort as formatDate } from '@/shared/lib/format';

const AVATAR_COLORS: ReadonlyArray<string> = [
  'bg-rose-100 text-rose-700',
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-violet-100 text-violet-700',
  'bg-teal-100 text-teal-700',
  'bg-pink-100 text-pink-700',
  'bg-indigo-100 text-indigo-700',
];

export function getInitials(name: string | null | undefined): string {
  if (!name) return '??';
  return name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2);
}

export function avatarColor(id: number | string | null | undefined): string {
  return AVATAR_COLORS[Number(id || 0) % AVATAR_COLORS.length];
}

export function formatRelative(
  dateStr: string | null | undefined,
  { future = false }: { future?: boolean } = {},
): string | null {
  if (!dateStr) return null;
  // Strings 'YYYY-MM-DD' se interpretan como local para evitar desfase TZ (-1 dia).
  const m = typeof dateStr === 'string' ? dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = future ? d.getTime() - now.getTime() : now.getTime() - d.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays < 0) return future ? `hace ${-diffDays}d` : null;
  if (diffDays === 0) return 'hoy';
  if (diffDays === 1) return future ? 'mañana' : 'ayer';
  if (diffDays < 7) return future ? `en ${diffDays}d` : `hace ${diffDays}d`;
  if (diffDays < 30) return future ? `en ${Math.round(diffDays / 7)} sem` : `hace ${Math.round(diffDays / 7)} sem`;
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
}

export function cleanPhone(phone: string | null | undefined): string {
  return (phone || '').replace(/[^\d]/g, '');
}

const STATUS_LABELS_ES: Record<string, string> = {
  nuevo: 'Nuevo',
  por_contactar: 'Por contactar',
  contactado: 'Contactado',
  en_seguimiento: 'En seguimiento',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
};

// Columnas para el export universal (CRM-196). Usado por ExportDialog.
export function getLeadExportColumns(): ExportColumn<Lead>[] {
  return [
    { key: 'nombre', label: 'Nombre', type: 'string', value: (l) => l.nombre || '', width: 24 },
    { key: 'email', label: 'Email', type: 'string', value: (l) => l.email || '', width: 28 },
    { key: 'telefono', label: 'Teléfono', type: 'string', value: (l) => l.telefono || '', width: 16 },
    { key: 'estado', label: 'Estado', type: 'string', value: (l) => STATUS_LABELS_ES[l.estado] || l.estado || '' },
    { key: 'canal', label: 'Canal', type: 'string', value: (l) => l.canal || l.canal_detectado || '' },
    { key: 'origen', label: 'Origen', type: 'string', value: (l) => l.origen || '' },
    { key: 'responsable', label: 'Responsable', type: 'string', value: (l) => l.responsable_nombre || '' },
    { key: 'producto_interes', label: 'Producto interés', type: 'string', value: (l) => l.producto_interes || '' },
    { key: 'pais', label: 'País', type: 'string', value: (l) => l.pais || '' },
    { key: 'notas', label: 'Notas', type: 'string', value: (l) => l.notas || '' },
    { key: 'created_at', label: 'Creado', type: 'date', value: (l) => l.created_at || null },
    { key: 'last_interaction_at', label: 'Último contacto', type: 'date', value: (l) => l.last_interaction_at || null },
    { key: 'next_reminder_at', label: 'Próximo recordatorio', type: 'date', value: (l) => l.next_reminder_at || null },
  ];
}

export function exportLeadsCSV(leads: Lead[], filename: string): void {
  const rows = [
    ['Nombre', 'Email', 'Teléfono', 'Estado', 'Canal', 'Responsable', 'Producto interés', 'Notas', 'Creado', 'Último contacto', 'Próximo recordatorio'],
    ...leads.map((l) => [
      l.nombre || '',
      l.email || '',
      l.telefono || '',
      STATUS_LABELS_ES[l.estado] || l.estado || '',
      l.canal || '',
      l.responsable_nombre || '',
      l.producto_interes || '',
      l.notas || '',
      l.created_at ? new Date(l.created_at).toLocaleDateString('es-ES') : '',
      l.last_interaction_at ? new Date(l.last_interaction_at).toLocaleDateString('es-ES') : '',
      l.next_reminder_at ? new Date(l.next_reminder_at).toLocaleDateString('es-ES') : '',
    ]),
  ];
  const csv = rows.map((r) => r.map((v: unknown) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
