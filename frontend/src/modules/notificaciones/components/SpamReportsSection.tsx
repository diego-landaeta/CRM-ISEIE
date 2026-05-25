import { useEffect, useState, useCallback } from 'react';
import { Flag, CheckCircle, X, ArrowSquareOut } from '@phosphor-icons/react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';

interface SpamReport {
  id: number;
  lead_id: number;
  motivo: string | null;
  status: string;
  created_at: string;
  lead_nombre: string;
  lead_email: string;
  lead_telefono: string | null;
  proyecto_nombre: string;
  proyecto_slug: string;
  reportado_por_nombre: string;
  reportado_por_email: string;
}

export default function SpamReportsSection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [reports, setReports] = useState<SpamReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<SpamReport[]>('/leads/spam-reports');
      if (res.success) setReports(res.data || []);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      if (e?.status !== 403) toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role === 'superadmin') fetchReports();
  }, [user?.role, fetchReports]);

  if (user?.role !== 'superadmin') return null;

  async function resolve(reportId: number, action: 'confirm' | 'dismiss') {
    setResolvingId(reportId);
    try {
      const res = await client.patch(`/leads/spam-reports/${reportId}`, { action });
      if (res.success) {
        toast({
          title: action === 'confirm' ? 'Confirmado como spam' : 'Reporte descartado',
          description: action === 'confirm' ? 'El lead ha sido eliminado.' : 'El lead sigue activo.',
        });
        setReports((prev) => prev.filter((r) => r.id !== reportId));
      }
    } catch (err: unknown) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally {
      setResolvingId(null);
    }
  }

  if (loading) return <div className="text-sm text-muted-foreground p-4">Cargando reportes…</div>;

  return (
    <section className="border border-orange-200 dark:border-orange-900 bg-orange-50/40 dark:bg-orange-950/20 rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 flex items-center justify-center">
          <Flag size={18} weight="duotone" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold text-base">Reportes de spam pendientes</h2>
          <p className="text-xs text-muted-foreground">
            {reports.length === 0 ? 'No hay reportes pendientes de revisar' : `${reports.length} reporte${reports.length !== 1 ? 's' : ''} esperando tu decisión`}
          </p>
        </div>
      </div>

      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">Todo limpio. Cuando una gestora reporte un lead como spam aparecerá aquí.</p>
      ) : (
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <button
                      onClick={() => navigate(`/leads/${r.lead_id}`)}
                      className="font-semibold text-sm hover:text-primary inline-flex items-center gap-1"
                    >
                      {r.lead_nombre}
                      <ArrowSquareOut size={11} weight="bold" />
                    </button>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{r.proyecto_nombre}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.lead_email || '(sin email)'} {r.lead_telefono ? `· ${r.lead_telefono}` : ''}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Reportado por <strong className="text-foreground">{r.reportado_por_nombre}</strong> el {new Date(r.created_at).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {r.motivo && <p className="text-xs mt-1.5 p-2 rounded bg-muted/50 italic">"{r.motivo}"</p>}
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <button
                    onClick={() => resolve(r.id, 'confirm')}
                    disabled={resolvingId === r.id}
                    title="Confirmar — elimina el lead como spam"
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md bg-red-600 text-white text-[11px] font-semibold hover:bg-red-700 disabled:opacity-50"
                  >
                    <CheckCircle size={12} weight="bold" />
                    Confirmar
                  </button>
                  <button
                    onClick={() => resolve(r.id, 'dismiss')}
                    disabled={resolvingId === r.id}
                    title="Descartar — el lead sigue activo"
                    className="inline-flex items-center gap-1 px-2.5 h-7 rounded-md border border-border bg-card text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                  >
                    <X size={12} weight="bold" />
                    Descartar
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
