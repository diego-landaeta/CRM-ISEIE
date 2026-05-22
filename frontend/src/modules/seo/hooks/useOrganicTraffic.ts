import { useEffect, useState } from 'react';
import { getGscMetrics, getGscConsolidated, type GscMetrics, type GscConsolidated, type GscTotals } from '../api/gsc.api';

export type Preset = '7d' | '14d' | '28d' | '90d';

export const PRESET_PERIODS: Record<Preset, { label: string; days: number }> = {
  '7d': { label: 'Ultimos 7 dias', days: 7 },
  '14d': { label: 'Ultimos 14 dias', days: 14 },
  '28d': { label: 'Ultimos 28 dias', days: 28 },
  '90d': { label: 'Ultimos 90 dias', days: 90 },
};

export interface DateRange { fechaDesde: string; fechaHasta: string }

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

export function rangeFromPreset(preset: Preset, now: number = Date.now()): DateRange {
  // GSC tiene retraso de 3 dias — fechaHasta es 3 dias antes de hoy
  const days = PRESET_PERIODS[preset]?.days ?? 28;
  const hasta = new Date(now - 3 * 86400000);
  const desde = new Date(hasta.getTime() - days * 86400000);
  return { fechaDesde: isoDate(desde), fechaHasta: isoDate(hasta) };
}

interface MetricsState {
  totals: GscTotals | null;
  rows: GscMetrics['rows'];
  lastUpdate: string | null;
}

export function useOrganicTraffic(projectId: string | number | undefined) {
  const [preset, setPreset] = useState<Preset>('28d');
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [metrics, setMetrics] = useState<MetricsState>({ totals: null, rows: [], lastUpdate: null });
  const [consolidated, setConsolidated] = useState<GscConsolidated>({ months: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range: DateRange = customRange || rangeFromPreset(preset);

  useEffect(() => {
    if (!projectId) {
      setMetrics({ totals: null, rows: [], lastUpdate: null });
      setConsolidated({ months: [] });
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      getGscMetrics(projectId, range).then(r => (r.success && r.data) ? r.data : Promise.reject(r.error || 'Error metrics')),
      getGscConsolidated(projectId).then(r => (r.success && r.data) ? r.data : Promise.reject(r.error || 'Error consolidated')),
    ]).then(([m, c]) => {
      setMetrics(m);
      setConsolidated(c);
    }).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [projectId, range.fechaDesde, range.fechaHasta]); // eslint-disable-line

  return {
    metrics,
    consolidated,
    loading,
    error,
    preset, setPreset,
    customRange, setCustomRange,
    range,
  };
}
