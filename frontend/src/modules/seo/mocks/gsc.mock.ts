// Mock data realista para CRM-106 (Google Search Console)
import type { GscMetrics, GscConsolidated, GscMetricsParams, GscRow } from '../api/gsc.api';

interface SampleProjectMetrics {
  totals: { clicks: number; impressions: number; ctr: number; position: number };
  queries: GscRow[];
}

const SAMPLE_METRICS: Record<string | number, SampleProjectMetrics> = {
  // ISEIE España (mock SEO data)
  1: {
    totals: { clicks: 12_480, impressions: 358_400, ctr: 3.48, position: 12.4 },
    queries: [
      { key: 'master psicologia forense online', clicks: 1_240, impressions: 18_400, ctr: 6.74, position: 4.2 },
      { key: 'curso psicologia clinica', clicks: 980, impressions: 22_100, ctr: 4.43, position: 6.8 },
      { key: 'psicologia general sanitaria', clicks: 720, impressions: 14_200, ctr: 5.07, position: 5.4 },
      { key: 'master psicologia distancia', clicks: 680, impressions: 12_800, ctr: 5.31, position: 5.9 },
      { key: 'estudiar psicologia online', clicks: 540, impressions: 18_900, ctr: 2.86, position: 8.7 },
      { key: 'psicologo forense titulacion', clicks: 480, impressions: 10_400, ctr: 4.62, position: 6.1 },
      { key: 'curso psicologia infantil', clicks: 420, impressions: 14_800, ctr: 2.84, position: 9.3 },
      { key: 'master psicologia precio', clicks: 380, impressions: 8_200, ctr: 4.63, position: 7.0 },
      { key: 'master psicologia clinica', clicks: 340, impressions: 11_600, ctr: 2.93, position: 10.2 },
      { key: 'psicologia online universidad', clicks: 320, impressions: 16_400, ctr: 1.95, position: 13.4 },
      { key: 'master psicologia juridica', clicks: 280, impressions: 7_800, ctr: 3.59, position: 8.5 },
      { key: 'curso psicologo deportivo', clicks: 240, impressions: 6_400, ctr: 3.75, position: 9.1 },
      { key: 'psicologia clinica oposiciones', clicks: 220, impressions: 9_200, ctr: 2.39, position: 11.8 },
      { key: 'master neuropsicologia online', clicks: 200, impressions: 5_400, ctr: 3.70, position: 7.6 },
      { key: 'psicologia educativa master', clicks: 180, impressions: 6_800, ctr: 2.65, position: 12.4 },
      { key: 'master psicologo terapia', clicks: 160, impressions: 4_900, ctr: 3.27, position: 10.8 },
      { key: 'curso psicologia gratis online', clicks: 140, impressions: 12_400, ctr: 1.13, position: 18.2 },
      { key: 'psicologia forense uned', clicks: 120, impressions: 5_200, ctr: 2.31, position: 14.0 },
      { key: 'master psicologia dual', clicks: 100, impressions: 3_400, ctr: 2.94, position: 11.2 },
      { key: 'titulo oficial psicologo', clicks: 90, impressions: 4_800, ctr: 1.88, position: 16.5 },
    ],
  },
  // ISEIH
  2: {
    totals: { clicks: 8_240, impressions: 218_600, ctr: 3.77, position: 11.2 },
    queries: [
      { key: 'grado superior integracion social online', clicks: 920, impressions: 14_500, ctr: 6.34, position: 3.8 },
      { key: 'tcae a distancia', clicks: 780, impressions: 19_200, ctr: 4.06, position: 5.6 },
      { key: 'fp sanidad online', clicks: 640, impressions: 16_800, ctr: 3.81, position: 6.4 },
      { key: 'auxiliar enfermeria online', clicks: 540, impressions: 13_400, ctr: 4.03, position: 7.1 },
      { key: 'tecnico cuidados auxiliares', clicks: 420, impressions: 9_800, ctr: 4.29, position: 6.8 },
      { key: 'fp sanidad distancia', clicks: 380, impressions: 12_400, ctr: 3.06, position: 9.4 },
      { key: 'iseih opiniones', clicks: 320, impressions: 4_800, ctr: 6.67, position: 2.4 },
      { key: 'grado superior sanidad', clicks: 280, impressions: 11_200, ctr: 2.50, position: 11.8 },
      { key: 'fp tcae online', clicks: 240, impressions: 8_600, ctr: 2.79, position: 10.4 },
      { key: 'integracion social fp', clicks: 220, impressions: 7_400, ctr: 2.97, position: 9.8 },
    ],
  },
  // Fono Aprende
  3: {
    totals: { clicks: 4_120, impressions: 98_400, ctr: 4.19, position: 9.8 },
    queries: [
      { key: 'logopedia infantil online', clicks: 720, impressions: 12_400, ctr: 5.81, position: 4.5 },
      { key: 'master logopedia', clicks: 440, impressions: 6_800, ctr: 6.47, position: 4.0 },
      { key: 'curso logopedia adultos', clicks: 320, impressions: 8_200, ctr: 3.90, position: 7.2 },
      { key: 'logopeda titulacion', clicks: 260, impressions: 5_400, ctr: 4.81, position: 5.8 },
      { key: 'fonologia infantil curso', clicks: 200, impressions: 4_800, ctr: 4.17, position: 7.5 },
      { key: 'logopedia distancia', clicks: 180, impressions: 6_200, ctr: 2.90, position: 10.4 },
      { key: 'master logopedia online', clicks: 160, impressions: 4_400, ctr: 3.64, position: 8.8 },
      { key: 'curso logopedia ninos', clicks: 140, impressions: 5_800, ctr: 2.41, position: 12.6 },
    ],
  },
  default: { totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 }, queries: [] },
};

interface ConsolidatedMonthSample { mes: string; organicTraffic: number; paidTraffic: number; totalLeads: number }

const SAMPLE_CONSOLIDATED: { default: ConsolidatedMonthSample[] } = {
  // 12 meses, organic + paid + leads — Psiko (proyecto activo del usuario)
  default: (() => {
    const now = new Date();
    const months: ConsolidatedMonthSample[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const seasonality = 1 + Math.sin((i / 12) * Math.PI * 2) * 0.25;
      months.push({
        mes,
        organicTraffic: Math.round((6_500 + i * 280) * seasonality),
        paidTraffic: Math.round((2_800 + i * 120) * seasonality),
        totalLeads: Math.round((28 + i * 1.4) * seasonality),
      });
    }
    return months;
  })(),
};

export function gscMetricsMock(projectId: string | number, params: GscMetricsParams = {}): GscMetrics {
  const data = SAMPLE_METRICS[projectId] || SAMPLE_METRICS.default;
  const desde = params.fechaDesde ? new Date(params.fechaDesde) : new Date(Date.now() - 28 * 86400000);
  const hasta = params.fechaHasta ? new Date(params.fechaHasta) : new Date(Date.now() - 3 * 86400000);
  const days = Math.max(1, Math.round((hasta.getTime() - desde.getTime()) / 86400000));
  const factor = Math.min(1, days / 28);

  // Ultima actualizacion = ayer hace 3 dias (delay GSC)
  const lastUpdate = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  return {
    totals: {
      clicks: Math.round(data.totals.clicks * factor),
      impressions: Math.round(data.totals.impressions * factor),
      ctr: data.totals.ctr,
      position: data.totals.position,
    },
    rows: data.queries.map(q => ({
      ...q,
      clicks: Math.round(q.clicks * factor),
      impressions: Math.round(q.impressions * factor),
    })),
    lastUpdate,
  };
}

export function gscConsolidatedMock(projectId: string | number): GscConsolidated {
  // Para todos los proyectos usamos la misma curva (escalada por id)
  const factor = projectId == 1 ? 1 : projectId == 2 ? 0.65 : 0.32;
  return {
    months: SAMPLE_CONSOLIDATED.default.map(m => ({
      mes: m.mes,
      organicTraffic: Math.round(m.organicTraffic * factor),
      paidTraffic: Math.round(m.paidTraffic * factor),
      totalLeads: Math.round(m.totalLeads * factor),
    })),
  };
}
