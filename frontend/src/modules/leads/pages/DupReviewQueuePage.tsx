import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowsClockwise, CheckCircle, X, GitMerge, Warning, ArrowSquareOut } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const MergeLeadDialog = lazy(() => import('../components/MergeLeadDialog'));

interface QueueItem {
  id: number;
  lead_id: number;
  original_lead_id: number;
  project_id: number;
  match_by_email: boolean;
  match_by_phone: boolean;
  source: string;
  status: string;
  created_at: string;
  lead_nombre: string | null;
  lead_email: string | null;
  lead_telefono: string | null;
  lead_responsable_nombre: string | null;
  lead_status: string | null;
  lead_producto: string | null;
  reincidente: boolean;
  original_nombre: string | null;
  original_email: string | null;
  original_status: string | null;
  original_responsable_nombre: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DupReviewQueuePage() {
  const navigate = useNavigate();
  const { activeProject } = useAuth() as { activeProject: { id?: number; nombre?: string } | null };
  const projectId = activeProject?.id;
  const [items, setItems] = useState<QueueItem[]>([]);
  const [counts, setCounts] = useState<{ pending: number; approved: number; merged: number; rejected: number }>({ pending: 0, approved: 0, merged: 0, rejected: 0 });
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'merged' | 'rejected'>('pending');
  const [loading, setLoading] = useState(true);
  const [mergeFor, setMergeFor] = useState<QueueItem | null>(null);
  const [rejectFor, setRejectFor] = useState<QueueItem | null>(null);
  const [rejectNotas, setRejectNotas] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  function load() {
    if (!projectId) return;
    setLoading(true);
    client.get<QueueItem[]>('/leads/review-queue', { params: { projectId, status: statusFilter } })
      .then((r: any) => { setItems(r?.data || []); setCounts(r?.counts || { pending: 0, approved: 0, merged: 0, rejected: 0 }); })
      .catch(() => { setItems([]); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [projectId, statusFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(it: QueueItem) {
    console.log('[dup-review] approve click', { queueId: it.id, leadId: it.lead_id });
    setBusyId(it.id);
    try {
      const res = await client.post(`/leads/review-queue/${it.id}/decide`, { action: 'approve' });
      console.log('[dup-review] approve OK', res);
      toast({ title: 'Aprobado', description: `Lead #${it.lead_id} validado y queda activo.` });
      load();
    } catch (err: any) {
      console.error('[dup-review] approve ERR', err);
      toast({ title: 'Error al aprobar', description: err?.data?.error || err?.message || 'fallo desconocido', variant: 'destructive' });
    } finally { setBusyId(null); }
  }

  async function reject() {
    if (!rejectFor) { console.warn('[dup-review] reject sin rejectFor'); return; }
    console.log('[dup-review] reject click', { queueId: rejectFor.id, leadId: rejectFor.lead_id, notas: rejectNotas });
    setBusyId(rejectFor.id);
    try {
      const res = await client.post(`/leads/review-queue/${rejectFor.id}/decide`, { action: 'reject', notas: rejectNotas.trim() || null });
      console.log('[dup-review] reject OK', res);
      toast({ title: 'Descartado', description: `Lead #${rejectFor.lead_id} soft-deleted.` });
      setRejectFor(null); setRejectNotas('');
      load();
    } catch (err: any) {
      console.error('[dup-review] reject ERR', err);
      toast({ title: 'Error al descartar', description: err?.data?.error || err?.message || 'fallo desconocido', variant: 'destructive' });
    } finally { setBusyId(null); }
  }

  if (!projectId || projectId === -1) {
    return <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-6 text-center text-sm text-amber-800 dark:text-amber-300">Selecciona un proyecto.</div>;
  }

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Revisión de duplicados</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Leads que llegaron por webhook con datos duplicados. El webhook nunca se bloqueó (Make recibió 200 OK). Decide si conservas, fusionas con el original o descartas.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2 flex-wrap">
        {([
          { key: 'pending', label: 'Pendientes', tone: 'amber', count: counts.pending },
          { key: 'approved', label: 'Aprobados', tone: 'emerald', count: counts.approved },
          { key: 'merged', label: 'Fusionados', tone: 'blue', count: counts.merged },
          { key: 'rejected', label: 'Descartados', tone: 'red', count: counts.rejected },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setStatusFilter(f.key)}
            className={`h-9 px-3 rounded-md text-sm font-semibold flex items-center gap-2 ${
              statusFilter === f.key ? 'bg-primary text-primary-foreground' : 'bg-muted/50 hover:bg-muted text-foreground'
            }`}
          >
            {f.label}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
              statusFilter === f.key ? 'bg-white/20' : 'bg-card border border-border'
            }`}>{f.count}</span>
          </button>
        ))}
        <button onClick={load} className="ml-auto h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted flex items-center gap-1.5">
          <ArrowsClockwise size={14} /> Refrescar
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 bg-muted/40 rounded animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted-foreground">
          <CheckCircle size={40} weight="duotone" className="mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-semibold">Sin {statusFilter === 'pending' ? 'pendientes' : 'registros'}</p>
          <p className="text-xs mt-1">Los duplicados que entren por webhook aparecerán aquí.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((it) => (
            <li key={it.id} className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-start gap-4">
                {/* Lado nuevo */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Warning size={16} weight="duotone" className="text-amber-500" />
                    <h3 className="text-sm font-semibold">Lead nuevo #{it.lead_id}</h3>
                    {it.reincidente && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300 font-semibold">REINCIDENTE</span>}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{it.source}</span>
                  </div>
                  <p className="text-sm font-medium">{it.lead_nombre || '— sin nombre —'}</p>
                  <p className="text-xs text-muted-foreground">{it.lead_email || it.lead_telefono || '—'}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Producto: <strong>{it.lead_producto || '—'}</strong> · Gestor: {it.lead_responsable_nombre || 'sin asignar'} · Estado: {it.lead_status || '—'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">Llegó: {fmtDate(it.created_at)}</p>
                  <p className="text-[11px] mt-1">
                    Match por: {it.match_by_email && <span className="font-semibold">email</span>}{it.match_by_email && it.match_by_phone ? ' + ' : ''}{it.match_by_phone && <span className="font-semibold">teléfono</span>}
                  </p>
                </div>

                {/* Flecha */}
                <div className="text-muted-foreground text-2xl pt-6">≈</div>

                {/* Lado original */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle size={16} weight="duotone" className="text-emerald-500" />
                    <h3 className="text-sm font-semibold">Original #{it.original_lead_id || '?'}</h3>
                    <button onClick={() => navigate(`/leads/${it.original_lead_id}`)} title="Abrir original"
                      className="p-0.5 rounded hover:bg-muted">
                      <ArrowSquareOut size={12} />
                    </button>
                  </div>
                  <p className="text-sm font-medium">{it.original_nombre || '— sin nombre —'}</p>
                  <p className="text-xs text-muted-foreground">{it.original_email || '—'}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Gestor: {it.original_responsable_nombre || 'sin asignar'} · Estado: {it.original_status || '—'}
                  </p>
                </div>
              </div>

              {statusFilter === 'pending' && (
                <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border">
                  <button onClick={() => approve(it)} disabled={busyId === it.id}
                    className="h-9 px-3 rounded-md bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5">
                    <CheckCircle size={14} weight="bold" /> Aprobar (queda activo)
                  </button>
                  <button onClick={() => setMergeFor(it)} disabled={busyId === it.id}
                    className="h-9 px-3 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                    <GitMerge size={14} weight="bold" /> Fusionar al original
                  </button>
                  <button onClick={() => { setRejectFor(it); setRejectNotas(''); }} disabled={busyId === it.id}
                    className="h-9 px-3 rounded-md border border-red-200 dark:border-red-900 text-red-600 text-sm font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 flex items-center gap-1.5">
                    <X size={14} weight="bold" /> Descartar
                  </button>
                  <button onClick={() => navigate(`/leads/${it.lead_id}`)} className="ml-auto text-xs text-primary hover:underline">
                    Ver ficha del nuevo →
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Fusionar usa el dialog existente: el original es winner, este nuevo es loser */}
      <Suspense fallback={null}>
        {mergeFor && (
          <MergeLeadDialog
            open={!!mergeFor}
            winner={{ id: mergeFor.original_lead_id, nombre: mergeFor.original_nombre } as any}
            projectId={mergeFor.project_id}
            initialLoserId={mergeFor.lead_id}
            onClose={() => setMergeFor(null)}
            onMerged={() => { setMergeFor(null); load(); }}
          />
        )}
      </Suspense>

      {/* Dialog rechazar */}
      {rejectFor && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setRejectFor(null)} />
          <div className="relative bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold">Descartar lead #{rejectFor.lead_id}</h3>
            <p className="text-xs text-muted-foreground">El lead se marcará como eliminado (soft-delete). Si es un error puedes restaurarlo después desde Papelera.</p>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Motivo (opcional)</label>
              <textarea value={rejectNotas} onChange={(e) => setRejectNotas(e.target.value)} rows={3}
                placeholder="Ej: claramente es spam / lead duplicado de prueba / etc."
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none" />
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectFor(null)} className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">Cancelar</button>
              <button onClick={reject} disabled={busyId === rejectFor.id}
                className="h-9 px-4 rounded-md bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                {busyId === rejectFor.id ? 'Descartando…' : 'Descartar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
