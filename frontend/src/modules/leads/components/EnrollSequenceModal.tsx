import { useEffect, useState } from 'react';
import { X, Envelope, CheckCircle } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface Sequence {
  id: number;
  nombre: string;
  active: boolean;
  steps?: unknown[];
  steps_count?: number;
  trigger_event?: string | null;
}

interface Props {
  leadId: number | string | null;
  open: boolean;
  onClose: () => void;
  onEnrolled?: () => void;
}

export default function EnrollSequenceModal({ leadId, open, onClose, onEnrolled }: Props) {
  const { activeProject } = useProjectContext();
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [enrolling, setEnrolling] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setSelected(null);
    (async () => {
      try {
        // En modo "Todos los proyectos" activeProject.id es -1, no sirve.
        // Resolvemos el project_id del lead.
        let pid = activeProject?.id && activeProject.id > 0 ? activeProject.id : null;
        if (!pid && leadId != null) {
          const leadRes = await client.get(`/leads/${leadId}`);
          if (leadRes.success) pid = leadRes.data?.project_id;
        }
        if (!pid) { setLoading(false); return; }
        const res = await client.get(`/email-sequences?projectId=${pid}`);
        if (!cancelled && res.success) {
          setSequences((res.data || []).filter((s) => s.active));
        }
      } catch (err) {
        if (!cancelled) toast({ title: 'Error', description: err.message, variant: 'destructive' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, activeProject?.id, leadId]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function enroll() {
    if (!selected) return;
    setEnrolling(true);
    try {
      const res = await client.post('/email-sequences/runs/start', {
        sequence_id: selected,
        lead_id: leadId,
      });
      if (res.success) {
        if (res.data) {
          toast({ title: 'Enrolado en secuencia' });
          onEnrolled?.();
        } else {
          toast({ title: 'Ya estaba enrolado', description: 'Este lead ya tiene esta secuencia activa.' });
          onClose();
        }
      }
    } catch (err) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setEnrolling(false);
    }
  }

  if (!open) return null;

  return (
    <Portal>
      <div role="dialog" aria-label="Enrolar en secuencia" aria-modal="true" className="fixed inset-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative bg-card rounded-lg border border-border shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
          <header className="flex items-start justify-between p-5 border-b border-border">
            <div>
              <h2 className="font-semibold text-base">Enrolar en secuencia</h2>
              <p className="text-xs text-muted-foreground">Elige una secuencia activa</p>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <X size={18} weight="bold" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            {loading && <p className="text-sm text-muted-foreground text-center py-6">Cargando secuencias...</p>}
            {!loading && sequences.length === 0 && (
              <div className="text-center py-6">
                <Envelope size={32} className="mx-auto text-muted-foreground mb-2" weight="thin" />
                <p className="text-sm text-muted-foreground">No hay secuencias activas en este proyecto.</p>
              </div>
            )}
            {!loading && sequences.length > 0 && (
              <ul className="space-y-2">
                {sequences.map((s) => {
                  const isSelected = selected === s.id;
                  const steps = Array.isArray(s.steps) ? s.steps.length : 0;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(s.id)}
                        className={`w-full text-left p-3 rounded-lg border transition-colors flex items-start gap-3 ${
                          isSelected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:bg-muted/50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded-full flex-shrink-0 mt-0.5 flex items-center justify-center ${
                          isSelected ? 'bg-primary text-primary-foreground' : 'border-2 border-border'
                        }`}>
                          {isSelected && <CheckCircle size={14} weight="fill" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold truncate">{s.nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            {steps} {steps === 1 ? 'email' : 'emails'} · trigger: {s.trigger_event}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <footer className="p-4 border-t border-border flex gap-2">
            <button onClick={onClose} className="flex-1 h-10 rounded-lg border border-border text-sm font-medium bg-secondary hover:bg-muted transition-colors">
              Cancelar
            </button>
            <button
              onClick={enroll}
              disabled={!selected || enrolling}
              className="flex-1 h-10 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50 hover:opacity-90 transition-opacity"
            >
              {enrolling ? 'Enrolando...' : 'Enrolar'}
            </button>
          </footer>
        </div>
      </div>
    </Portal>
  );
}
