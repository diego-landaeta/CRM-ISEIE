import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import client from '@/shared/api/client';
import type { ApiResponse, Lead, LeadStatus, LeadOrigen, Interaction, Reminder, Utms } from '@/shared/types';

type StatusHistoryEntry = NonNullable<Lead['statusHistory']>[number];

const PAGE_SIZE = 20;

const URL_DEFAULTS: { q: string; estado: string; origen: string; resp: string; prod: string; from: string; to: string; sort: string; page: number } = {
  q: '',
  estado: '',
  origen: '',
  resp: '',
  prod: '',
  from: '',
  to: '',
  sort: 'recent_value',
  page: 1,
};

export interface LeadStats {
  total: number;
  nuevo: number;
  por_contactar: number;
  contactado: number;
  en_seguimiento: number;
  convertido: number;
  no_interesado: number;
}

export interface UseLeadsResult {
  leads: Lead[];
  stats: Partial<LeadStats>;
  total: number;
  page: number;
  totalPages: number;
  setPage: (v: number | ((prev: number) => number)) => void;
  search: string;
  setSearch: (v: string) => void;
  filterEstado: string;
  setFilterEstado: (v: string) => void;
  filterOrigen: string;
  setFilterOrigen: (v: string) => void;
  filterResponsable: string;
  setFilterResponsable: (v: string) => void;
  filterProducto: string;
  setFilterProducto: (v: string) => void;
  dateFrom: string;
  dateTo: string;
  setDateRange: (from: string, to: string) => void;
  sortMode: 'value' | 'recent' | 'urgency' | 'recent_value';
  setSortMode: (m: 'value' | 'recent' | 'urgency' | 'recent_value') => void;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// Backend devuelve `status` y `canal_detectado`; UI usa `estado` y `origen`.
function normalizeLead<T extends Partial<Lead>>(lead: T): T {
  if (!lead) return lead;
  return {
    ...lead,
    estado: (lead.status as LeadStatus | undefined) || (lead.estado as LeadStatus | undefined),
    origen: (lead.canal_detectado as LeadOrigen | undefined) || (lead.origen as LeadOrigen | undefined) || ('directo' as LeadOrigen),
  };
}

export function useLeads(): UseLeadsResult {
  const { activeProject } = useProjectContext() as {
    activeProject: { id?: number | null };
  };
  const pid = activeProject?.id;

  const [urlFilters, setUrlFilters] = useUrlFilters(URL_DEFAULTS);
  const { q: search, estado: filterEstado, origen: filterOrigen, resp: filterResponsable, prod: filterProducto, from: dateFrom, to: dateTo, sort: sortRaw, page } = urlFilters as {
    q: string; estado: string; origen: string; resp: string; prod: string; from: string; to: string; sort: string; page: number;
  };
  const sortMode = (['value', 'recent', 'urgency', 'recent_value'].includes(sortRaw) ? sortRaw : 'recent_value') as 'value' | 'recent' | 'urgency' | 'recent_value';

  const setSearch = useCallback((v: string) => setUrlFilters({ q: v, page: 1 }), [setUrlFilters]);
  const setFilterEstado = useCallback((v: string) => setUrlFilters({ estado: v, page: 1 }), [setUrlFilters]);
  const setFilterOrigen = useCallback((v: string) => setUrlFilters({ origen: v, page: 1 }), [setUrlFilters]);
  const setFilterResponsable = useCallback((v: string) => setUrlFilters({ resp: v, page: 1 }), [setUrlFilters]);
  const setFilterProducto = useCallback((v: string) => setUrlFilters({ prod: v, page: 1 }), [setUrlFilters]);
  const setDateRange = useCallback((from: string, to: string) => setUrlFilters({ from, to, page: 1 }), [setUrlFilters]);
  const setSortMode = useCallback((m: 'value' | 'recent' | 'urgency' | 'recent_value') => setUrlFilters({ sort: m, page: 1 }), [setUrlFilters]);
  const setPage = useCallback((v: number | ((prev: number) => number)) => {
    const next = typeof v === 'function' ? v(page) : v;
    setUrlFilters({ page: Number(next) || 1 });
  }, [page, setUrlFilters]);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [stats, setStats] = useState<Partial<LeadStats>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 350);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [search]);

  const abortRef = useRef<AbortController | null>(null);

  const fetchLeads = useCallback(async (): Promise<void> => {
    if (!pid) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('projectId', String(pid));
      params.set('page', String(page));
      params.set('limit', String(PAGE_SIZE));
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (filterEstado) params.set('status', filterEstado);
      if (filterOrigen) params.set('canal', filterOrigen);
      if (filterResponsable === 'unassigned') params.set('unassigned', 'true');
      else if (filterResponsable) params.set('responsableId', filterResponsable);
      if (filterProducto) params.set('productId', filterProducto);
      if (dateFrom) params.set('dateFrom', dateFrom);
      if (dateTo) params.set('dateTo', dateTo);
      if (sortMode) params.set('sort', sortMode);

      const res = await client.get(`/leads?${params.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.success) {
        setLeads(((res.data as Lead[]) || []).map(normalizeLead));
        if (res.pagination) {
          setTotal(res.pagination.total || 0);
          setTotalPages(res.pagination.totalPages || 1);
        }
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e?.name === 'AbortError') return;
      setError(e?.message || String(err));
      setLeads([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [pid, page, debouncedSearch, filterEstado, filterOrigen, filterResponsable, filterProducto, dateFrom, dateTo, sortMode]);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const fetchStats = useCallback(async (): Promise<void> => {
    if (!pid) return;
    try {
      const res = await client.get<Record<string, number>>(`/leads/stats?projectId=${pid}`);
      if (!res.success) return;
      const merged = res.data || {};
      setStats({
        total: Number(merged.total) || 0,
        nuevo: Number(merged.nuevos) || 0,
        por_contactar: Number(merged.por_contactar) || 0,
        contactado: Number(merged.contactados) || 0,
        en_seguimiento: Number(merged.en_seguimiento) || 0,
        convertido: Number(merged.convertidos) || 0,
        no_interesado: Number(merged.no_interesados) || 0,
      } as Partial<LeadStats>);
    } catch {
      // Stats son secundarios, no bloquear UI
    }
  }, [pid]);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    leads,
    stats,
    total,
    page,
    totalPages,
    setPage,
    search,
    setSearch,
    filterEstado,
    setFilterEstado,
    filterOrigen,
    setFilterOrigen,
    filterResponsable,
    setFilterResponsable,
    filterProducto,
    setFilterProducto,
    dateFrom,
    dateTo,
    setDateRange,
    sortMode,
    setSortMode,
    loading,
    error,
    refetch: fetchLeads,
  };
}

export interface TimelineItem {
  id: string | number;
  action: string;
  date: string;
  source: string;
  color: string;
}

export interface UseLeadDetailResult {
  lead: Lead | null;
  timeline: TimelineItem[];
  interacciones: Interaction[];
  reminders: Reminder[];
  recordatorio: Reminder | null;
  utms: Utms | null;
  statusHistory: StatusHistoryEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateStatus: (status: string, motivo?: string) => Promise<ApiResponse<Lead>>;
  addInteraction: (tipo: string, nota: string, fecha?: string) => Promise<ApiResponse<Interaction>>;
  addReminder: (fecha_recordatorio: string, nota: string) => Promise<ApiResponse<Reminder>>;
  completeReminder: (reminderId: number) => Promise<ApiResponse<Reminder>>;
  reassign: (responsable_id: number) => Promise<ApiResponse<Lead>>;
  updateLead: (fields: Partial<Lead>) => Promise<ApiResponse<Lead>>;
}

export function useLeadDetail(id: number | string | null | undefined): UseLeadDetailResult {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLead = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await client.get<Lead>(`/leads/${id}`);
      if (res.success && res.data) {
        setLead(normalizeLead(res.data));
      }
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e?.message || String(err));
      setLead(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchLead();
  }, [fetchLead]);

  const interacciones = lead?.interactions || [];
  const reminders = lead?.reminders || [];
  const recordatorio = reminders[0] || null;
  const utms = lead?.utms || null;
  const statusHistory = lead?.statusHistory || [];

  const timeline: TimelineItem[] = statusHistory.map((h: StatusHistoryEntry, i: number) => ({
    id: h.id || i,
    action: `Estado cambiado a ${h.status_nuevo}${h.changed_by_nombre ? ' por ' + h.changed_by_nombre : ''}`,
    date: h.changed_at ? new Date(h.changed_at).toLocaleString('es-ES') : '',
    source: 'Sistema',
    color: ['#4361ee', '#059669', '#d97706', '#7c3aed'][i % 4],
  }));

  if (timeline.length === 0 && lead) {
    timeline.push({
      id: 1,
      action: 'Lead creado',
      date: lead.created_at ? new Date(lead.created_at).toLocaleString('es-ES') : '',
      source: 'Sistema',
      color: '#4361ee',
    });
  }

  const updateStatus = useCallback(async (status: string, motivo?: string): Promise<ApiResponse<Lead>> => {
    const body: { status: string; motivo?: string } = { status };
    if (motivo) body.motivo = motivo;
    const res = await client.patch<Lead>(`/leads/${id}/status`, body);
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const addInteraction = useCallback(async (tipo: string, nota: string, fecha?: string): Promise<ApiResponse<Interaction>> => {
    const res = await client.post<Interaction>(`/leads/${id}/interactions`, { tipo, nota, fecha: fecha || undefined });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const addReminder = useCallback(async (fecha_recordatorio: string, nota: string): Promise<ApiResponse<Reminder>> => {
    const res = await client.post<Reminder>(`/leads/${id}/reminders`, { fecha_recordatorio, nota });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const completeReminder = useCallback(async (reminderId: number): Promise<ApiResponse<Reminder>> => {
    const res = await client.patch<Reminder>(`/leads/reminders/${reminderId}/complete`);
    if (res.success) await fetchLead();
    return res;
  }, [fetchLead]);

  const reassign = useCallback(async (responsable_id: number): Promise<ApiResponse<Lead>> => {
    const res = await client.patch<Lead>(`/leads/${id}/reassign`, { responsable_id });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const updateLead = useCallback(async (fields: Partial<Lead>): Promise<ApiResponse<Lead>> => {
    const res = await client.patch<Lead>(`/leads/${id}`, fields);
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  return {
    lead,
    timeline,
    interacciones,
    reminders,
    recordatorio,
    utms,
    statusHistory,
    loading,
    error,
    refetch: fetchLead,
    updateStatus,
    addInteraction,
    addReminder,
    completeReminder,
    reassign,
    updateLead,
  };
}
