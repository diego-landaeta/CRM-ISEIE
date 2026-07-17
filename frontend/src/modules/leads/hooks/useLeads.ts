import { useState, useEffect, useCallback, useRef } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import useUrlFilters from '@/shared/hooks/useUrlFilters';
import client from '@/shared/api/client';
import type { Lead, LeadStatus, LeadOrigen } from '@/shared/types';

const PAGE_SIZE = 20;

const URL_DEFAULTS: { q: string; estado: string; origen: string; resp: string; prod: string; multi: string; from: string; to: string; sort: string; dir: string; page: number; dup: string; rein: string } = {
  q: '',
  estado: '',
  origen: '',
  resp: '',
  prod: '',
  multi: '',  // CSV de project ids (vacío = sólo proyecto activo)
  from: '',
  to: '',
  sort: 'recent',  // default: CRONOLÓGICO puro (fecha)
  dir: 'desc',     // default: más reciente primero
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
  sin_asignar: number;
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
  sortDir: 'asc' | 'desc';
  setSortDir: (d: 'asc' | 'desc') => void;
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
  const { activeProject, projects, isAllProjects } = useProjectContext() as {
    activeProject: { id?: number | null; isAll?: boolean };
    projects: Array<{ id: number }>;
    isAllProjects: boolean;
  };
  const pid = activeProject?.id;

  const [urlFilters, setUrlFilters] = useUrlFilters(URL_DEFAULTS);
  const { q: search, estado: filterEstado, origen: filterOrigen, resp: filterResponsable, prod: filterProducto, multi: multiRaw, from: dateFrom, to: dateTo, sort: sortRaw, dir: dirRaw, page, dup: filterDup, rein: filterReincidente } = urlFilters as {
    q: string; estado: string; origen: string; resp: string; prod: string; multi: string; from: string; to: string; sort: string; dir: string; page: number; dup: string; rein: string;
  };
  // Default CRONOLÓGICO ('recent') descendente = más reciente primero.
  const sortMode = (['value', 'recent', 'urgency', 'recent_value'].includes(sortRaw) ? sortRaw : 'recent') as 'value' | 'recent' | 'urgency' | 'recent_value';
  const sortDir = (dirRaw === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
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
  const setSortDir = useCallback((d: 'asc' | 'desc') => setUrlFilters({ dir: d, page: 1 }), [setUrlFilters]);
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
    // Modo "Todos los proyectos": cruza todos los IDs del usuario, SALVO que
    // el filtro "Proyecto" tenga una selección — esa manda (bug: antes se ignoraba).
    const effectiveIds = isAllProjects
      ? (selectedProjectIds.length > 0 ? selectedProjectIds : (projects || []).map((p) => p.id))
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
      if (sortDir) params.set('dir', sortDir);
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
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      setError(err?.message || String(err));
      setLeads([]);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [pid, page, debouncedSearch, filterEstado, filterOrigen, filterResponsable, filterProducto, multiRaw, isAllProjects, projects, dateFrom, dateTo, sortMode, sortDir, filterDup, filterReincidente]);

  useEffect(() => () => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const fetchStats = useCallback(async (): Promise<void> => {
    try {
      // Construye el querystring con los mismos filtros del listado para que
      // los chips reflejen el subconjunto filtrado, no el total global.
      const buildFilters = (): string => {
        const p = new URLSearchParams();
        if (debouncedSearch) p.set('search', debouncedSearch);
        if (filterOrigen) p.set('canal', filterOrigen);
        if (filterResponsable && filterResponsable !== 'unassigned') p.set('responsableId', filterResponsable);
        if (filterProducto) p.set('productId', filterProducto);
        if (dateFrom) p.set('dateFrom', dateFrom);
        if (dateTo) p.set('dateTo', dateTo);
        const qs = p.toString();
        return qs ? `&${qs}` : '';
      };
      const extra = buildFilters();
      let merged: Record<string, number> = {};
      if (isAllProjects) {
        if (!projects || projects.length === 0) return;
        // Respeta la selección del filtro "Proyecto" (igual que fetchLeads).
        const statProjects = selectedProjectIds.length > 0
          ? projects.filter((p) => selectedProjectIds.includes(p.id))
          : projects;
        const results = await Promise.all(
          statProjects.map((p) => client.get(`/leads/stats?projectId=${p.id}${extra}`).catch(() => ({ success: false } as any)))
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
        const res = await client.get(`/leads/stats?projectId=${pid}${extra}`);
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
  }, [pid, isAllProjects, projects, multiRaw, debouncedSearch, filterOrigen, filterResponsable, filterProducto, dateFrom, dateTo]);

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
    sortDir,
    setSortDir,
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

  // Token de request: evita que una respuesta lenta de un lead anterior pise
  // los datos del lead actual (race condition al navegar rápido entre fichas).
  const reqIdRef = useRef(0);

  const fetchLead = useCallback(async (): Promise<void> => {
    if (!id) return;
    const myReq = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await client.get(`/leads/${id}`);
      if (reqIdRef.current !== myReq) return; // respuesta obsoleta: ignorar
      if (res.success) {
        setLead(normalizeLead(res.data));
      }
    } catch (err: any) {
      if (reqIdRef.current !== myReq) return; // respuesta obsoleta: ignorar
      setError(err?.message || String(err));
      setLead(null);
    } finally {
      if (reqIdRef.current === myReq) setLoading(false);
    }
  }, [id]);

  // Al cambiar de id, limpiamos el lead anterior para no mostrar datos de otra ficha
  // mientras carga la nueva.
  useEffect(() => {
    setLead(null);
    fetchLead();
  }, [fetchLead]);

  const interacciones = lead?.interactions || [];
  const reminders = lead?.reminders || [];
  const recordatorio = reminders[0] || null;
  const utms = lead?.utms || null;
  const statusHistory = lead?.statusHistory || [];
  const auditLog = ((lead as unknown) as { auditLog?: any[] })?.auditLog || [];

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
  const fmtVal = (v: string | null | undefined) => (v == null || v === '' ? '∅' : (v.length > 60 ? v.slice(0, 60) + '…' : v));

  const timelineStatus: TimelineItem[] = statusHistory.map((h: any, i: number) => ({
    id: `s-${h.id || i}`,
    action: `Estado cambiado a ${h.status_nuevo}${h.changed_by_nombre ? ' por ' + h.changed_by_nombre : ''}`,
    date: h.changed_at ? new Date(h.changed_at).toLocaleString('es-ES') : '',
    _ts: h.changed_at ? new Date(h.changed_at).getTime() : 0,
    source: 'Sistema',
    color: '#4361ee',
  }));
  const timelineAudit: TimelineItem[] = auditLog.map((a: any, i: number) => {
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
    .sort((a, b) => ((b as any)._ts || 0) - ((a as any)._ts || 0));

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
