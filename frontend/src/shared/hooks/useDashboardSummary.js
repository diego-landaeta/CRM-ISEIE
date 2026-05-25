import { useEffect, useState } from 'react';
import client from '@/shared/api/client';

// Summary agregado del dashboard: 4 KPIs (leads, conversiones, ingresos, tasa)
// con trend % vs periodo anterior + sparkline semanal de 8 puntos cada uno.
// Backend: GET /api/leads/dashboard-summary?projectId=X&days=30.
export function useDashboardSummary(projectId, days = 30) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .get('/leads/dashboard-summary', { params: { projectId, days } })
      .then((r) => { if (!cancelled) setData(r?.data || null); })
      .catch((err) => { if (!cancelled) setError(err); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, days]);

  return { data, loading, error };
}
