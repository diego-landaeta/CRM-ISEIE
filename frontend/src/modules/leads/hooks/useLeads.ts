import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import client from '@/shared/api/client';
import type { ApiResponse, Lead, LeadStatus, LeadOrigen, Interaction, Reminder, Utms } from '@/shared/types';

type StatusHistoryEntry = NonNullable<Lead['statusHistory']>[number];

interface AuditLogEntry {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by_user_id?: number | null;
  changed_by_nombre?: string | null;
}

const PAGE_SIZE = 20;

const URL_DEFAULTS: { q: string; estado: string; origen: string; resp: string; prod: string; from: string; to: string; sort: string; page: number; dup: string; rein: string } = {
  q: '',
  estado: '',
  origen: '',
  resp: '',
  prod: '',
  from: '',
  to: '',
  sort: 'recent_value',
  page: 1,
  dup: '',
  rein: '',
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
  filterDup: boolean;
  setFilterDup: (v: boolean) => void;
  filterReincidente: boolean;
  setFilterReincidente: (v: boolean) => void;
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
    origen: (lead.canal_detectado as LeadOrigen | undefined) || ((lead as { utms?: { canal_detectado?: LeadOrigen } }).utms?.canal_detectado as LeadOrigen | undefined) || (lead.origen as LeadOrigen | undefined) || ('directo' as LeadOrigen),
  };
}

export function useLeads(): UseLeadsResult {
  const { activeProject } = useProjectContext() as {
    activeProject: { id?: number | null };
  };
  const pid = activeProject?.id;

  const [urlFilters, setUrlFilters] = useUrlFilters(URL_DEFAULTS);
  const { q: search, estado: filterEstado, origen: filterOrigen, resp: filterResponsable, prod: filterProducto, from: dateFrom, to: dateTo, sort: sortRaw, page, dup: filterDup, rein: filterReincidente } = urlFilters as {
    q: string; estado: string; origen: string; resp: string; prod: string; from: string; to: string; sort: string; page: number; dup: string; rein: string;
  };
  const sortMode = (['value', 'recent', 'urgency', 'recent_value'].includes(sortRaw) ? sortRaw : 'recent_value') as 'value' | 'recent' | 'urgency' | 'recent_value';

  const setSearch = useCallback((v: string) => setUrlFilters({ q: v, page: 1 }), [setUrlFilters]);
  const setFilterEstado = useCallback((v: string) => setUrlFilters({ estado: v, page: 1 }), [setUrlFilters]);
  const setFilterOrigen = useCallback((v: string) => setUrlFilters({ origen: v, page: 1 }), [setUrlFilters]);
  const setFilterResponsable = useCallback((v: string) => setUrlFilters({ resp: v, page: 1 }), [setUrlFilters]);
  const setFilterProducto = useCallback((v: string) => setUrlFilters({ prod: v, page: 1 }), [setUrlFilters]);
  const setDateRange = useCallback((from: string, to: string) => setUrlFilters({ from, to, page: 1 }), [setUrlFilters]);
  const setSortMode = useCallback((m: 'value' | 'recent' | 'urgency' | 'recent_value') => setUrlFilters({ sort: m, page: 1 }), [setUrlFilters]);
  const setFilterDup = useCallback((v: boolean) => setUrlFilters({ dup: v ? '1' : '', page: 1 }), [setUrlFilters]);
  const setFilterReincidente = useCallback((v: boolean) => setUrlFilters({ rein: v ? '1' : '', page: 1 }), [setUrlFilters]);
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
      if (filterDup === '1') params.set('duplicated', 'true');
      if (filterReincidente === '1') params.set('reincidente', 'true');

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
  }, [pid, page, debouncedSearch, filterEstado, filterOrigen, filterResponsable, filterProducto, dateFrom, dateTo, sortMode, filterDup, filterReincidente]);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const fetchStats = useCallback(async (): Promise<void> => {
    if (!pid) return;
    try {
      // Mandamos los mismos filtros que el listado para que los chips reflejen
      // el subconjunto filtrado, no el total global del proyecto.
      const p = new URLSearchParams();
      p.set('projectId', String(pid));
      if (debouncedSearch) p.set('search', debouncedSearch);
      if (filterOrigen) p.set('canal', filterOrigen);
      if (filterResponsable && filterResponsable !== 'unassigned') p.set('responsableId', filterResponsable);
      if (filterProducto) p.set('productId', filterProducto);
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo) p.set('dateTo', dateTo);
      const res = await client.get<Record<string, number>>(`/leads/stats?${p.toString()}`);
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
  }, [pid, debouncedSearch, filterOrigen, filterResponsable, filterProducto, dateFrom, dateTo]);

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
    filterDup: filterDup === '1',
    setFilterDup,
    filterReincidente: filterReincidente === '1',
    setFilterReincidente,
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
  _ts?: number;
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
  const auditLog = ((lead as unknown) as { auditLog?: AuditLogEntry[] })?.auditLog || [];

  // Etiquetas humanas por campo + emojis para el timeline
  const FIELD_LABELS: Record<string, { label: string; emoji: string }> = {
    nombre: { label: 'Nombre', emoji: '📝' },
    email: { label: 'Email', emoji: '✉️' },
    telefono: { label: 'Teléfono', emoji: '📞' },
    notas: { label: 'Notas', emoji: '🗒️' },
    producto_interes_id: { label: 'Producto de interés', emoji: '📦' },
    canal: { label: 'Canal', emoji: '🛰️' },
    responsable_id: { label: 'Responsable', emoji: '👤' },
    custom_fields: { label: 'Campos custom', emoji: '⚙️' },
  };
  function fmtVal(v: string | null | undefined): string {
    if (v == null || v === '') return '∅';
    if (v.length > 60) return v.slice(0, 60) + '…';
    return v;
  }

  const timelineStatus: TimelineItem[] = statusHistory.map((h: StatusHistoryEntry, i: number) => ({
    id: `s-${h.id || i}`,
    action: `Estado cambiado a ${h.status_nuevo}${h.changed_by_nombre ? ' por ' + h.changed_by_nombre : ''}`,
    date: h.changed_at ? new Date(h.changed_at).toLocaleString('es-ES') : '',
    _ts: h.changed_at ? new Date(h.changed_at).getTime() : 0,
    source: 'Sistema',
    color: '#4361ee',
  }));
  const timelineAudit: TimelineItem[] = auditLog.map((a, i: number) => {
    const meta = FIELD_LABELS[a.field_name] || { label: a.field_name, emoji: '📝' };
    return {
      id: `a-${a.id || i}`,
      action: `${meta.emoji} ${meta.label}: ${fmtVal(a.old_value)} → ${fmtVal(a.new_value)}${a.changed_by_nombre ? ' · por ' + a.changed_by_nombre : ''}`,
      date: a.changed_at ? new Date(a.changed_at).toLocaleString('es-ES') : '',
      _ts: a.changed_at ? new Date(a.changed_at).getTime() : 0,
      source: 'Edición',
      color: '#7c3aed',
    };
  });

  const timeline: TimelineItem[] = [...timelineStatus, ...timelineAudit]
    .sort((a, b) => ((b as { _ts?: number })._ts || 0) - ((a as { _ts?: number })._ts || 0));

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
