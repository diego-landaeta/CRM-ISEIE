import client from '@/shared/api/client';

export interface MetaPortfolio {
  id: number;
  business_id: string;
  nombre?: string | null;
  last_synced_at?: string | null;
  last_sync_status?: 'ok' | 'error' | 'in_progress' | null;
  last_sync_error?: string | null;
  created_at: string;
}

export interface MetaPortfolioDiscoveredAccount {
  id: number;
  ad_account_id: string;
  nombre?: string | null;
  estado: 'nueva' | 'asignada' | 'ignorada' | 'sin_acceso';
  campus_sugerido_id?: number | null;
  campus_sugerido_nombre?: string | null;
  meta_ad_account_id?: number | null;
  created_at: string;
  updated_at: string;
}

export const metaPortfolioApi = {
  list() {
    return client.get<MetaPortfolio[]>(`/meta-ads/portfolios`);
  },
  connect(payload: { business_id: string; nombre?: string; access_token: string }) {
    return client.post<MetaPortfolio>(`/meta-ads/portfolios`, payload);
  },
  disconnect(portfolioId: number) {
    return client.delete(`/meta-ads/portfolios/${portfolioId}`);
  },
  sync(portfolioId: number) {
    return client.post<{ cuentasVistas: number; nuevas: number }>(`/meta-ads/portfolios/${portfolioId}/sync`, {});
  },
  listDiscovered(portfolioId: number) {
    return client.get<MetaPortfolioDiscoveredAccount[]>(`/meta-ads/portfolios/${portfolioId}/discovered`);
  },
  assign(discoveredId: number, projectId: number) {
    return client.post(`/meta-ads/portfolios/discovered/${discoveredId}/assign`, { project_id: projectId });
  },
  ignore(discoveredId: number) {
    return client.post(`/meta-ads/portfolios/discovered/${discoveredId}/ignore`, {});
  },
};