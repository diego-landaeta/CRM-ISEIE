// Stripe Monitor API client (CRM-108)
// Contrato definido en docs/03-api-endpoints.md > Stripe Monitor
// Backend pendiente (modulo `ia-monitor` por implementar). Mientras tanto, USE_MOCKS=true.

import client, { type ApiResponse } from '@/shared/api/client';
import { stripeMetricsMock } from '../mocks/stripe.mock';

const USE_MOCKS = false; // Backend listo (con fallback si falta STRIPE_API_KEY)

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

export interface StripeEvolutionPoint {
  mes: string;
  mrr: number;
  activeSubs: number;
  newSubs: number;
  cancelledSubs: number;
  churnRate: number;
}

export interface StripeMetrics {
  mrr: number;
  activeSubs: number;
  newSubs: number;
  cancelledSubs: number;
  failedPayments: number;
  churnRate: number;
  evolution12Months: StripeEvolutionPoint[];
}

export async function getStripeMetrics(projectId: string | number): Promise<ApiResponse<StripeMetrics>> {
  if (USE_MOCKS) {
    await delay(300);
    return { success: true, data: stripeMetricsMock(projectId) };
  }
  return client.get<StripeMetrics>(`/ia/metrics/${projectId}`);
}
