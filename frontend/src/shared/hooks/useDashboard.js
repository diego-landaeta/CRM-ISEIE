import { useState, useEffect, useCallback } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';

// Suma campo a campo dos objetos de stats (raw, plurales del backend)
function mergeStats(a, b) {
  const keys = ['total', 'nuevos', 'por_contactar', 'contactados', 'en_seguimiento', 'convertidos', 'no_interesados', 'sin_asignar'];
  const out = { ...a };
  for (const k of keys) out[k] = Number(out[k] || 0) + Number(b?.[k] || 0);
  return out;
}

function mergeToday(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    nuevos_hoy: Number(a.nuevos_hoy || 0) + Number(b.nuevos_hoy || 0),
    nuevos_semana: Number(a.nuevos_semana || 0) + Number(b.nuevos_semana || 0),
    inactivos: Number(a.inactivos || 0) + Number(b.inactivos || 0),
    cobros_vencidos: Number(a.cobros_vencidos || 0) + Number(b.cobros_vencidos || 0),
    ingresos_hoy: Number(a.ingresos_hoy || 0) + Number(b.ingresos_hoy || 0),
    reminders_pendientes: [
      ...(a.reminders_pendientes || []),
      ...(b.reminders_pendientes || []),
    ],
  };
}

// Normaliza un lead del listado: backend devuelve `status` y `canal_detectado`
export function normalizeLead(lead) {
  if (!lead) return lead;
  return {
    ...lead,
    estado: lead.status || lead.estado,
    origen: lead.canal_detectado || lead.origen || 'directo',
  };
}

// El backend devuelve plurales (nuevos, contactados, ...) — convertir a singulares
export function normalizeStats(raw) {
  const d = raw || {};
  const total = Number(d.total) || 0;
  const convertido = Number(d.convertidos) || 0;
  const noInteresado = Number(d.no_interesados) || 0;
  return {
    total,
    nuevo: Number(d.nuevos) || 0,
    por_contactar: Number(d.por_contactar) || 0,
    contactado: Number(d.contactados) || 0,
    en_seguimiento: Number(d.en_seguimiento) || 0,
    convertido,
    no_interesado: noInteresado,
    conversionRate: total > 0 ? Math.round((convertido / total) * 100) : 0,
    abandonRate: total > 0 ? Math.round((noInteresado / total) * 100) : 0,
  };
}

export function useDashboard() {
  const { activeProject, projects, isAllProjects } = useProjectContext();
  const pid = activeProject?.id;
  const allProjectsKey = isAllProjects ? (projects || []).map((p) => p.id).join(',') : '';

  const [stats, setStats] = useState(null);
  const [recentLeads, setRecentLeads] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async () => {
    if (isAllProjects) {
      // Modo "Todos los proyectos": agrega stats y today por cada proyecto.
      // Para leads recientes pide en multi con projectIds=csv.
      if (!projects || projects.length === 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const ids = projects.map((p) => p.id);
        const statsPromises = ids.map((id) => client.get(`/leads/stats?projectId=${id}`).catch(() => ({ success: false })));
        const todayPromises = ids.map((id) => client.get(`/leads/today?projectId=${id}`).catch(() => ({ success: false })));
        const leadsRes = await client.get(`/leads?projectIds=${ids.join(',')}&limit=10&page=1`).catch(() => ({ success: false }));

        const statsResults = await Promise.all(statsPromises);
        const todayResults = await Promise.all(todayPromises);

        let mergedRaw = {};
        statsResults.forEach((r) => { if (r.success) mergedRaw = mergeStats(mergedRaw, r.data || {}); });
        setStats(normalizeStats(mergedRaw));

        let mergedToday = null;
        todayResults.forEach((r) => { if (r.success) mergedToday = mergeToday(mergedToday, r.data || {}); });
        if (mergedToday?.reminders_pendientes) {
          // Ordena por fecha asc; vencidos primero
          mergedToday.reminders_pendientes.sort((a, b) => {
            if (a.vencido !== b.vencido) return a.vencido ? -1 : 1;
            return new Date(a.fecha_recordatorio || 0).getTime() - new Date(b.fecha_recordatorio || 0).getTime();
          });
        }
        setToday(mergedToday);

        if (leadsRes.success) setRecentLeads((leadsRes.data || []).map(normalizeLead));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!pid) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [statsRes, leadsRes, todayRes] = await Promise.all([
        client.get(`/leads/stats?projectId=${pid}`),
        client.get(`/leads?projectId=${pid}&limit=5&page=1`),
        client.get(`/leads/today?projectId=${pid}`).catch(() => ({ success: false })),
      ]);

      if (statsRes.success) setStats(normalizeStats(statsRes.data));
      if (leadsRes.success) setRecentLeads((leadsRes.data || []).map(normalizeLead));
      if (todayRes.success) setToday(todayRes.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [pid, isAllProjects, allProjectsKey]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const s = stats || {};
  const kpis = {
    leadsNuevos: { value: s.nuevo || 0, change: '--', trend: 'up' },
    conversiones: {
      value: s.convertido || 0,
      rate: `${s.conversionRate || 0}%`,
      trend: 'up',
    },
    ingresosMes: { value: '--', change: '--', trend: 'up' },
    tasaAbandono: {
      value: s.no_interesado || 0,
      change: `${s.abandonRate || 0}%`,
      trend: 'down',
    },
  };

  return {
    kpis,
    leadsSemana: [],
    conversionProyecto: [],
    leadsRecientes: recentLeads,
    stats: s,
    today,
    loading,
    error,
    refetch: fetchDashboard,
  };
}
