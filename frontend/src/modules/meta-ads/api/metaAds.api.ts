import client from '@/shared/api/client';

export interface MetaAccount {
  id: number;
  project_id: number;
  ad_account_id: string;
  ad_account_nombre?: string | null;
  currency?: string | null;
  timezone_name?: string | null;
  last_synced_at?: string | null;
  last_sync_status?: 'ok' | 'error' | 'in_progress' | null;
  last_sync_error?: string | null;
  backfill_done?: boolean;
}

export interface MetaCampaign {
  campaign_id: string;
  nombre: string;
  objective?: string | null;
  status?: string | null;
  effective_status?: string | null;
  daily_budget?: number | null;
  lifetime_budget?: number | null;
  start_time?: string | null;
  stop_time?: string | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_leads: number;
  cpl: number | null;
  ctr: number | null;
}

export interface MetaDashboard {
  daily: Array<{ date: string; spend: number; impressions: number; clicks: number; leads: number }>;
  totals: { spend: number; impressions: number; clicks: number; leads: number; cpl: number | null; ctr: number | null };
}

export interface MetaAdSet {
  adset_id: string;
  campaign_id: string;
  nombre: string;
  status?: string | null;
  effective_status?: string | null;
  optimization_goal?: string | null;
  billing_event?: string | null;
  daily_budget?: number | null;
  lifetime_budget?: number | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_leads: number;
  cpl: number | null;
  ctr: number | null;
}

export interface MetaAd {
  ad_id: string;
  adset_id: string;
  campaign_id: string;
  nombre: string;
  status?: string | null;
  effective_status?: string | null;
  creative_id?: string | null;
  created_time?: string | null;
  total_spend: number;
  total_impressions: number;
  total_clicks: number;
  total_leads: number;
  cpl: number | null;
  ctr: number | null;
}

export interface MetaRoiRow {
  campaign_id: string;
  nombre: string;
  status?: string | null;
  spend: number;
  leads_meta: number;
  ventas: number;
  facturado: number;
  cobrado: number;
  ganancia: number;
  roi_pct: number | null;
  n_productos_asociados: number;
  productos_nombres?: string | null;
}

export const metaApi = {
  // Multi-cuenta: lista todas las cuentas conectadas al proyecto.
  accounts(projectId: number) {
    return client.get<MetaAccount[]>(`/meta-ads/accounts`, { params: { projectId } });
  },
  // Legacy 1:1 — primera cuenta, mantenido por retro-compat.
  account(projectId: number) {
    return client.get<MetaAccount | null>(`/meta-ads/account`, { params: { projectId } });
  },
  connect(payload: { project_id: number; ad_account_id: string; access_token: string }) {
    return client.post(`/meta-ads/connect`, payload);
  },
  updateToken(accountId: number, access_token: string) {
    return client.patch(`/meta-ads/accounts/${accountId}/token`, { access_token });
  },
  disconnect(accountId: number) {
    return client.delete(`/meta-ads/accounts/${accountId}`);
  },
  sync(accountId: number) {
    return client.post(`/meta-ads/accounts/${accountId}/sync`, {});
  },
  backfill(accountId: number, days = 90) {
    return client.post(`/meta-ads/accounts/${accountId}/backfill`, { days });
  },
  campaigns(projectId: number, opts: { status?: string; dateFrom?: string; dateTo?: string; accountId?: number } = {}) {
    return client.get<MetaCampaign[]>(`/meta-ads/campaigns`, { params: { projectId, ...opts } });
  },
  adsets(projectId: number, campaignId: string, opts: { dateFrom?: string; dateTo?: string } = {}) {
    return client.get<MetaAdSet[]>(`/meta-ads/campaigns/${encodeURIComponent(campaignId)}/adsets`, { params: { projectId, ...opts } });
  },
  ads(projectId: number, adsetId: string, opts: { dateFrom?: string; dateTo?: string } = {}) {
    return client.get<MetaAd[]>(`/meta-ads/adsets/${encodeURIComponent(adsetId)}/ads`, { params: { projectId, ...opts } });
  },
  dashboard(projectId: number, opts: { dateFrom?: string; dateTo?: string; accountId?: number } = {}) {
    return client.get<MetaDashboard>(`/meta-ads/dashboard`, { params: { projectId, ...opts } });
  },
  associations(projectId: number, campaignId?: string) {
    return client.get(`/meta-ads/associations`, { params: { projectId, campaignId } });
  },
  setAssociations(payload: { project_id: number; campaign_id: string; product_ids: number[] }) {
    return client.post(`/meta-ads/associations`, payload);
  },
  adsetAssociations(projectId: number, adsetId: string) {
    return client.get(`/meta-ads/adset-associations`, { params: { projectId, adsetId } });
  },
  setAdSetAssociations(payload: { project_id: number; adset_id: string; product_ids: number[] }) {
    return client.post(`/meta-ads/adset-associations`, payload);
  },
  roi(projectId: number, opts: { dateFrom?: string; dateTo?: string } = {}) {
    return client.get<MetaRoiRow[]>(`/meta-ads/roi`, { params: { projectId, ...opts } });
  },
  productsView(projectId: number, opts: { dateFrom?: string; dateTo?: string } = {}) {
    return client.get(`/meta-ads/products-view`, { params: { projectId, ...opts } });
  },
};
