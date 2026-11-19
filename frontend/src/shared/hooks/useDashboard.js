import { useState, useEffect, useCallback } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useIdsDelAmbito } from '@/shared/hooks/useAmbito';
import client from '@/shared/api/client';

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
    // Abiertos sin gestora: la alerta del Dashboard (gemela de CRM#884).
    sin_asignar: Number(d.sin_asignar) || 0,
    conversionRate: total > 0 ? Math.round((convertido / total) * 100) : 0,
    abandonRate: total > 0 ? Math.round((noInteresado / total) * 100) : 0,
  };
}

export function useDashboard() {
  const { activeProject, projects, isAllProjects } = useProjectContext();
  const pid = activeProject?.id;
  // Con una empresa elegida, «todos» son sus campus y ninguno mas.
  const idsDelAmbito = useIdsDelAmbito();
  const allProjectsKey = isAllProjects ? idsDelAmbito.join(',') : '';

  const [stats, setStats] = useState(null);
  const [recentLeads, setRecentLeads] = useState([]);
  const [today, setToday] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async () => {
    if (isAllProjects) {
      // Modo "Todos los proyectos" o una EMPRESA: TRES peticiones, no 2·N+1.
      //
      // #224: con CEDIA la pestaña se quedaba más de 30 s sin pintar nada.
      // Aquí se pedían stats y today UNA VEZ POR CAMPUS —siete campus,
      // catorce peticiones, y cada today son seis consultas seguidas en el
      // servidor— y la pantalla entera esperaba a la última para sumarlas en
      // el navegador. Ahora el servidor recibe la lista y suma en una sola
      // consulta (`project_id = ANY(...)`), igual que ya hacía el listado.
      if (idsDelAmbito.length === 0) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const csv = idsDelAmbito.join(',');
        const [statsRes, todayRes, leadsRes] = await Promise.all([
          client.get(`/leads/stats?projectIds=${csv}`).catch(() => ({ success: false })),
          client.get(`/leads/today?projectIds=${csv}`).catch(() => ({ success: false })),
          client.get(`/leads?projectIds=${csv}&limit=10&page=1`).catch(() => ({ success: false })),
        ]);

        setStats(normalizeStats(statsRes.success ? statsRes.data : {}));
        // Los recordatorios ya vienen ordenados del servidor: fecha ascendente,
        // los vencidos primero.
        setToday(todayRes.success ? todayRes.data : null);

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
