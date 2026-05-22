import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import client from '@/shared/api/client';
import type { Lead, LeadStatus, LeadOrigen } from '@/shared/types';

const PAGE_SIZE = 20;

const URL_DEFAULTS: { q: string; estado: string; origen: string; resp: string; prod: string; multi: string; from: string; to: string; sort: string; page: number } = {
  q: '',
  estado: '',
  origen: '',
  resp: '',
  prod: '',
  multi: '',  // CSV de project ids (vacío = sólo proyecto activo)
  from: '',
  to: '',
  sort: 'recent_value',  // default: día más reciente arriba, dentro del día los caros primero
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
  selectedProjectIds: number[];
  setSelectedProjectIds: (ids: number[]) => void;
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
  const { activeProject, projects, isAllProjects } = useProjectContext() as {
    activeProject: { id?: number | null; isAll?: boolean };
    projects: Array<{ id: number }>;
    isAllProjects: boolean;
  };
  const pid = activeProject?.id;

  const [urlFilters, setUrlFilters] = useUrlFilters(URL_DEFAULTS);
  const { q: search, estado: filterEstado, origen: filterOrigen, resp: filterResponsable, prod: filterProducto, multi: multiRaw, from: dateFrom, to: dateTo, sort: sortRaw, page } = urlFilters as {
    q: string; estado: string; origen: string; resp: string; prod: string; multi: string; from: string; to: string; sort: string; page: number;
  };
  const sortMode = (['value', 'recent', 'urgency', 'recent_value'].includes(sortRaw) ? sortRaw : 'recent_value') as 'value' | 'recent' | 'urgency' | 'recent_value';
  const selectedProjectIds: number[] = multiRaw
    ? multiRaw.split(',').map((x) => Number(x)).filter((x) => x > 0)
    : [];

  const setSearch = useCallback((v: string) => setUrlFilters({ q: v, page: 1 }), [setUrlFilters]);
  const setFilterEstado = useCallback((v: string) => setUrlFilters({ estado: v, page: 1 }), [setUrlFilters]);
  const setFilterOrigen = useCallback((v: string) => setUrlFilters({ origen: v, page: 1 }), [setUrlFilters]);
  const setFilterResponsable = useCallback((v: string) => setUrlFilters({ resp: v, page: 1 }), [setUrlFilters]);
  const setFilterProducto = useCallback((v: string) => setUrlFilters({ prod: v, page: 1 }), [setUrlFilters]);
  const setSelectedProjectIds = useCallback((ids: number[]) => setUrlFilters({ multi: ids.length ? ids.join(',') : '', page: 1 }), [setUrlFilters]);
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
    // Modo "Todos los proyectos": cruza todos los IDs del usuario.
    const effectiveIds = isAllProjects
      ? (projects || []).map((p) => p.id)
      : selectedProjectIds;
    const hasMulti = effectiveIds.length > 0;
    if (!hasMulti && !pid) return;
    if (isAllProjects && (!projects || projects.length === 0)) return;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (hasMulti) {
        params.set('projectIds', effectiveIds.join(','));
      } else {
        params.set('projectId', String(pid));
      }
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
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || String(err));
      setLeads([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [pid, page, debouncedSearch, filterEstado, filterOrigen, filterResponsable, filterProducto, multiRaw, isAllProjects, projects, dateFrom, dateTo, sortMode]);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      let merged: Record<string, number> = {};
      if (isAllProjects) {
        if (!projects || projects.length === 0) return;
        const results = await Promise.all(
          projects.map((p) => client.get(`/leads/stats?projectId=${p.id}`).catch(() => ({ success: false } as any)))
        );
        results.forEach((r: any) => {
          if (r.success) {
            const d = r.data || {};
            for (const k of ['total', 'nuevos', 'por_contactar', 'contactados', 'en_seguimiento', 'convertidos', 'no_interesados', 'sin_asignar']) {
              merged[k] = (merged[k] || 0) + Number(d[k] || 0);
            }
          }
        });
      } else {
        if (!pid) return;
        const res = await client.get(`/leads/stats?projectId=${pid}`);
        if (!res.success) return;
        merged = res.data || {};
      }
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
  }, [pid, isAllProjects, projects]);

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
    selectedProjectIds,
    setSelectedProjectIds,
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
  interacciones: any[];
  reminders: any[];
  recordatorio: any;
  utms: any;
  statusHistory: any[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  updateStatus: (status: string, motivo?: string) => Promise<any>;
  addInteraction: (tipo: string, nota: string, fecha?: string) => Promise<any>;
  addReminder: (fecha_recordatorio: string, nota: string) => Promise<any>;
  completeReminder: (reminderId: number) => Promise<any>;
  reassign: (responsable_id: number) => Promise<any>;
  updateLead: (fields: Partial<Lead>) => Promise<any>;
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
      const res = await client.get(`/leads/${id}`);
      if (res.success) {
        setLead(normalizeLead(res.data));
      }
    } catch (err: any) {
      setError(err?.message || String(err));
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

  const timeline: TimelineItem[] = statusHistory.map((h: any, i: number) => ({
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

  const updateStatus = useCallback(async (status: string, motivo?: string): Promise<any> => {
    const body: { status: string; motivo?: string } = { status };
    if (motivo) body.motivo = motivo;
    const res = await client.patch(`/leads/${id}/status`, body);
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const addInteraction = useCallback(async (tipo: string, nota: string, fecha?: string): Promise<any> => {
    const res = await client.post(`/leads/${id}/interactions`, { tipo, nota, fecha: fecha || undefined });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const addReminder = useCallback(async (fecha_recordatorio: string, nota: string): Promise<any> => {
    const res = await client.post(`/leads/${id}/reminders`, { fecha_recordatorio, nota });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const completeReminder = useCallback(async (reminderId: number): Promise<any> => {
    const res = await client.patch(`/leads/reminders/${reminderId}/complete`);
    if (res.success) await fetchLead();
    return res;
  }, [fetchLead]);

  const reassign = useCallback(async (responsable_id: number): Promise<any> => {
    const res = await client.patch(`/leads/${id}/reassign`, { responsable_id });
    if (res.success) await fetchLead();
    return res;
  }, [id, fetchLead]);

  const updateLead = useCallback(async (fields: Partial<Lead>): Promise<any> => {
    const res = await client.patch(`/leads/${id}`, fields);
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
