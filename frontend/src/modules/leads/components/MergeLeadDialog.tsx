import { useEffect, useState, useCallback } from 'react';
import { X, GitMerge, Warning, MagnifyingGlass } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface LeadLite {
  id: number;
  nombre: string;
  email?: string | null;
  status?: string;
  responsable_nombre?: string | null;
  created_at?: string;
}

interface Props {
  open: boolean;
  // El winner = lead actual (queda activo)
  winner: LeadLite | null;
  projectId: number | null;
  /** Si viene, pre-selecciona ese lead como loser (caso: vienes desde cola de revisión). */
  initialLoserId?: number | null;
  onClose: () => void;
  onMerged?: (result: { winner_id: number; loser_id: number }) => void;
}

// Diálogo de fusión: buscar candidato → seleccionar → comentario obligatorio → confirmar.
export default function MergeLeadDialog({ open, winner, projectId, initialLoserId, onClose, onMerged }: Props) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<LeadLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<LeadLite | null>(null);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setSearch(''); setResults([]); setSelected(null); setComment(''); }
  }, [open]);

  // Si llega initialLoserId, lo cargamos y pre-seleccionamos como loser.
  useEffect(() => {
    if (!open || !initialLoserId || !projectId) return;
    (async () => {
      try {
        const r = await client.get<LeadLite>(`/leads/${initialLoserId}`);
        if ((r as any).success && (r as any).data) setSelected((r as any).data);
      } catch { /* silent */ }
    })();
  }, [open, initialLoserId, projectId]);

  // Búsqueda — usa el endpoint lookup-by-email si parece email, sino /leads?search
  const runSearch = useCallback(async (q: string) => {
    if (!projectId || q.length < 3) { setResults([]); return; }
    setLoading(true);
    try {
      if (q.includes('@')) {
        const r = await client.get(`/leads/lookup-by-email?email=${encodeURIComponent(q)}&projectId=${projectId}`);
        if (r.success) setResults((r.data || []).filter((l: LeadLite) => l.id !== winner?.id));
      } else {
        const r = await client.get(`/leads?projectId=${projectId}&search=${encodeURIComponent(q)}&limit=10`);
        if (r.success) setResults(((r.data || []) as LeadLite[]).filter(l => l.id !== winner?.id));
      }
    } catch { setResults([]); }
    finally { setLoading(false); }
  }, [projectId, winner?.id]);

  useEffect(() => {
    const t = setTimeout(() => runSearch(search), 400);
    return () => clearTimeout(t);
  }, [search, runSearch]);

  async function handleMerge() {
    console.log('[merge] click', { winnerId: winner?.id, selected: selected?.id, comment, commentLen: comment.trim().length });
    if (!winner || !selected) {
      console.warn('[merge] abort: falta winner o selected', { winner, selected });
      toast({ title: 'Selecciona el lead a fusionar', description: 'Busca y elige el duplicado en la lista de arriba.', variant: 'destructive' });
      return;
    }
    if (comment.trim().length < 3) {
      console.warn('[merge] abort: comentario muy corto', comment);
      toast({ title: 'Comentario obligatorio', description: 'Mínimo 3 caracteres explicando por qué fusionas.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      console.log('[merge] POST', `/leads/${winner.id}/merge`, { loser_id: selected.id });
      const res = await client.post(`/leads/${winner.id}/merge`, {
        loser_id: selected.id,
        comment: comment.trim(),
      });
      console.log('[merge] response', res);
      if (res.success) {
        toast({
          title: 'Leads fusionados',
          description: `Lead #${selected.id} (${selected.nombre}) fusionado en #${winner.id}.`,
        });
        onMerged?.(res.data);
        onClose();
      } else {
        console.error('[merge] success=false', res);
        toast({ title: 'Error al fusionar', description: 'Respuesta inesperada del servidor', variant: 'destructive' });
      }
    } catch (err: any) {
      console.error('[merge] EXCEPCION', err);
      toast({ title: 'Error al fusionar', description: err?.data?.error || err?.message || 'fallo desconocido', variant: 'destructive' });
    } finally { setSaving(false); }
  }

  if (!open || !winner) return null;

  return (
    <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
      <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" className="relative bg-card sm:rounded-lg border border-border w-full max-w-xl flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-border flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
            <GitMerge size={18} weight="regular" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-base">Fusionar duplicado</h3>
            <p className="text-xs text-muted-foreground truncate">
              Lead actual: <strong>#{winner.id} {winner.nombre}</strong> (quedará activo)
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto">
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md p-3 text-[11px] text-amber-800 dark:text-amber-300 flex gap-2">
            <Warning size={14} weight="duotone" className="flex-shrink-0 mt-0.5" />
            <span>Todo el historial (interacciones, recordatorios, conversiones, emails) se moverá al lead actual. El duplicado se borrará (soft) con tu comentario como motivo.</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Buscar el duplicado por nombre o email</label>
            <div className="relative">
              <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ej: vito o victoriano@email.com"
                className="w-full h-10 pl-9 pr-3 rounded-md border border-border bg-muted/40 text-sm"
                autoFocus
              />
            </div>
            {loading && <p className="text-[11px] text-muted-foreground mt-1">Buscando…</p>}
          </div>

          {results.length > 0 && (
            <div className="border border-border rounded-md max-h-64 overflow-y-auto divide-y divide-border">
              {results.map(r => (
                <button
                  key={r.id} type="button"
                  onClick={() => setSelected(r)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted ${selected?.id === r.id ? 'bg-primary/10' : ''}`}
                >
                  <p className="font-semibold">{r.nombre} <span className="text-[10px] text-muted-foreground">#{r.id}</span></p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.email || 'Sin email'} · {r.status || ''}
                    {r.responsable_nombre && ` · Asignado a ${r.responsable_nombre}`}
                  </p>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Comentario (obligatorio, queda en auditoría)</label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Ej: Misma persona — Vito y Victoriano son la misma. Pago único correcto en Vito."
                className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm resize-none"
                minLength={3}
                required
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving}
            className="h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
            Cancelar
          </button>
          <button
            onClick={handleMerge}
            disabled={saving || !selected || comment.trim().length < 3}
            className="h-9 px-4 rounded-md bg-violet-600 text-white text-sm font-semibold hover:bg-violet-700 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <GitMerge size={14} weight="bold" />
            {saving ? 'Fusionando…' : 'Fusionar leads'}
          </button>
        </div>
      </div>
    </div>
  );
}
