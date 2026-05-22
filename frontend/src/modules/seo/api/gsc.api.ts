// Google Search Console API client (CRM-106)
// Contrato definido en docs/03-api-endpoints.md > Google Search Console
// Backend pendiente (modulo `gsc` por implementar). Mientras tanto, USE_MOCKS=true.

import client from '@/shared/api/client';
import { gscMetricsMock, gscConsolidatedMock } from '../mocks/gsc.mock';

const USE_MOCKS = true; // Cambiar a false cuando Diego termine el modulo backend

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export type GscDimension = 'query' | 'page' | 'device';

export interface GscMetricsParams {
  fechaDesde?: string;
  fechaHasta?: string;
  dimension?: GscDimension;
}

export interface GscTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscMetrics {
  totals: GscTotals;
  rows: GscRow[];
  lastUpdate: string;
}

export interface ConsolidatedMonth {
  mes: string;
  organicTraffic: number;
  paidTraffic: number;
  totalLeads: number;
}

export interface GscConsolidated {
  months: ConsolidatedMonth[];
}

import type { ApiResponse } from '@/shared/api/client';

export async function getGscMetrics(projectId: string | number, params: GscMetricsParams = {}): Promise<ApiResponse<GscMetrics>> {
  if (USE_MOCKS) {
    await delay(300);
    return { success: true, data: gscMetricsMock(projectId, params) };
  }
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  return client.get<GscMetrics>(`/gsc/metrics/${projectId}${qs ? '?' + qs : ''}`);
}

export async function getGscConsolidated(projectId: string | number): Promise<ApiResponse<GscConsolidated>> {
  if (USE_MOCKS) {
    await delay(300);
    return { success: true, data: gscConsolidatedMock(projectId) };
  }
  return client.get<GscConsolidated>(`/gsc/consolidated/${projectId}`);
}
