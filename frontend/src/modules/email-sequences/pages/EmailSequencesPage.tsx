import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Select from '@/shared/components/ui/Select';
import { Envelope, Plus, Trash, X, Play, Pause, FloppyDisk, FileText } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { emailTemplatesApi, type EmailTemplate } from '@/modules/email-templates/api/templates.api';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

type TriggerEvent = 'lead_created' | 'status_changed' | 'conversion_created' | 'manual';

interface SequenceStep {
  delay_hours: number;
  subject: string;
  body: string;
  // CRM-185 fase 3: si se elige una plantilla, el scheduler la renderiza
  // con datos del lead. subject/body inline se ignoran si template_id esta.
  template_id?: number | null;
}

interface EmailSequence {
  id?: number;
  project_id?: number;
  nombre: string;
  trigger_event: TriggerEvent;
  trigger_filter?: Record<string, unknown>;
  steps: SequenceStep[];
  active: boolean;
  active_runs?: number;
  completed_runs?: number;
}

const TRIGGERS: ReadonlyArray<{ v: TriggerEvent; label: string }> = [
  { v: 'lead_created', label: 'Cuando se crea un lead' },
  { v: 'status_changed', label: 'Cuando cambia el estado' },
  { v: 'conversion_created', label: 'Cuando se convierte' },
  { v: 'manual', label: 'Manual (lanzar a mano)' },
];

export default function EmailSequencesPage() {
  const { activeProject } = useProjectContext();
  const [sequences, setSequences] = useState<EmailSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailSequence | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EmailSequence | null>(null);

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await client.get(`/secuencias-email?projectId=${activeProject.id}`);
      if (res.success) setSequences((res.data as EmailSequence[]) || []);
    } catch (err: any) {
      toast({ title: 'Error cargando secuencias', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleSave(seq: EmailSequence): Promise<void> {
    if (!activeProject?.id) return;
    try {
      if (seq.id) await client.patch(`/secuencias-email/${seq.id}`, seq);
      else await client.post('/secuencias-email', { ...seq, project_id: activeProject.id });
      toast({ title: 'Guardado' });
      setEditing(null);
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  async function handleToggle(s: EmailSequence): Promise<void> {
    try { await client.patch(`/secuencias-email/${s.id}`, { active: !s.active }); load(); }
    catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  function handleDelete(s: EmailSequence): void { setPendingDelete(s); }
  async function doDelete(): Promise<void> {
    if (!pendingDelete) return;
    try { await client.delete(`/secuencias-email/${pendingDelete.id}`); load(); }
    catch { /* silencioso */ }
    finally { setPendingDelete(null); }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Secuencias de email"
        subtitle={`${sequences.length} secuencias en ${activeProject?.nombre || 'este proyecto'}`}
        actions={
          <button
            onClick={() => setEditing({ nombre: '', trigger_event: 'lead_created', trigger_filter: {}, steps: [{ delay_hours: 0, subject: '', body: '' }], active: true })}
            aria-label="Nueva secuencia"
            className="flex items-center gap-1 h-9 px-3 sm:px-4 rounded-xl bg-primary text-primary-foreground text-sm font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nueva secuencia</span>
          </button>
        }
      />

      {loading ? <SkeletonTable rows={3} columns={3} /> :
        sequences.length === 0 ? (
          <EmptyState icon={Envelope} title="Sin secuencias" description="Crea una para enviar emails de seguimiento automaticos" />
        ) : (
          <div className="grid gap-3">
            {sequences.map(s => (
              <div key={s.id} className="bg-card border border-border rounded-2xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold">{s.nombre}</h3>
                    {!s.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-bold">PAUSADA</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{TRIGGERS.find(t => t.v === s.trigger_event)?.label || s.trigger_event} - {s.steps?.length || 0} pasos - {s.active_runs || 0} activas, {s.completed_runs || 0} completadas</p>
                </div>
                <button
                  onClick={() => handleToggle(s)}
                  aria-label={s.active ? 'Pausar secuencia' : 'Reanudar secuencia'}
                  title={s.active ? 'Pausar' : 'Reanudar'}
                  className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {s.active ? <Pause size={16} /> : <Play size={16} />}
                </button>
                <button
                  onClick={() => setEditing(s)}
                  className="h-9 px-3 rounded bg-muted text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  Editar
                </button>
                <button
                  onClick={() => handleDelete(s)}
                  aria-label="Eliminar secuencia"
                  className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                >
                  <Trash size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

      {editing && <SequenceEditor seq={editing} onSave={handleSave} onClose={() => setEditing(null)} />}
      <Suspense fallback={null}>
        <ConfirmDialog
          open={pendingDelete !== null}
          title="Eliminar secuencia?"
          message="Se eliminara la secuencia y todos sus pasos."
          confirmLabel="Eliminar"
          tone="destructive"
          onConfirm={doDelete}
          onCancel={() => setPendingDelete(null)}
        />
      </Suspense>
    </div>
  );
}

interface SequenceEditorProps {
  seq: EmailSequence;
  onSave: (seq: EmailSequence) => void | Promise<void>;
  onClose: () => void;
}

function SequenceEditor({ seq, onSave, onClose }: SequenceEditorProps) {
  const { activeProject } = useProjectContext();
  const [s, setS] = useState<EmailSequence>({ ...seq, steps: seq.steps?.length ? seq.steps : [{ delay_hours: 0, subject: '', body: '' }] });
  // CRM-185 fase 3: lista de plantillas activas del proyecto para el selector.
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);

  useEffect(() => {
    if (!activeProject?.id) return;
    let cancelled = false;
    emailTemplatesApi.list(activeProject.id, false)
      .then(res => { if (!cancelled && res.success && res.data) setTemplates(res.data); })
      .catch(() => { /* silencioso, plantillas son opcionales */ });
    return () => { cancelled = true; };
  }, [activeProject?.id]);

  function updateStep(i: number, field: keyof SequenceStep, value: string | number | null): void {
    const next = [...s.steps];
    next[i] = { ...next[i], [field]: value };
    setS({ ...s, steps: next });
  }
  function addStep(): void { setS({ ...s, steps: [...s.steps, { delay_hours: 24, subject: '', body: '' }] }); }
  function removeStep(i: number): void { setS({ ...s, steps: s.steps.filter((_, idx) => idx !== i) }); }

  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="seq-editor-title" className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 id="seq-editor-title" className="font-extrabold">{s.id ? 'Editar' : 'Nueva'} secuencia</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar editor"
            className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <input
            value={s.nombre}
            onChange={e => setS({ ...s, nombre: e.target.value })}
            placeholder="Nombre de la secuencia"
            aria-label="Nombre de la secuencia"
            className="w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <Select<TriggerEvent>
            value={s.trigger_event}
            onChange={(v) => setS({ ...s, trigger_event: v })}
            options={TRIGGERS.map(t => ({ value: t.v, label: t.label }))}
            ariaLabel="Evento que dispara la secuencia"
          />

          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-xs font-bold uppercase text-muted-foreground">Pasos</p>
            {s.steps.map((step, i) => {
              const usingTemplate = step.template_id != null && step.template_id > 0;
              return (
              <div key={i} className="bg-muted/30 border border-border rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold">Paso {i + 1}</span>
                  <input
                    type="number"
                    min="0"
                    value={step.delay_hours}
                    onChange={e => updateStep(i, 'delay_hours', Number(e.target.value))}
                    aria-label={`Horas de retraso del paso ${i + 1}`}
                    className="w-20 h-8 px-2 rounded border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <span className="text-xs text-muted-foreground">horas tras anterior</span>
                  {s.steps.length > 1 && (
                    <button
                      onClick={() => removeStep(i)}
                      aria-label={`Quitar paso ${i + 1}`}
                      className="ml-auto p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
                    >
                      <Trash size={12} />
                    </button>
                  )}
                </div>
                {templates.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <FileText size={11} className="text-muted-foreground" />
                    <Select<number | null>
                      value={step.template_id ?? null}
                      onChange={(v) => updateStep(i, 'template_id', v)}
                      options={[
                        { value: null, label: '- Sin plantilla (usar texto manual) -' },
                        ...templates.map(t => ({ value: t.id as number, label: t.name })),
                      ]}
                      ariaLabel={`Plantilla del paso ${i + 1}`}
                      size="sm"
                      className="flex-1"
                    />
                  </div>
                )}
                <input
                  value={step.subject || ''}
                  onChange={e => updateStep(i, 'subject', e.target.value)}
                  placeholder={usingTemplate ? 'Ignorado - la plantilla provee el asunto' : 'Asunto'}
                  disabled={usingTemplate}
                  aria-label={`Asunto del paso ${i + 1}`}
                  className="w-full h-8 px-2 rounded border border-border bg-card text-xs focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40"
                />
                <textarea
                  value={step.body || ''}
                  onChange={e => updateStep(i, 'body', e.target.value)}
                  placeholder={usingTemplate ? 'Ignorado - la plantilla provee el cuerpo' : 'Cuerpo HTML del email'}
                  disabled={usingTemplate}
                  rows={3}
                  aria-label={`Cuerpo del paso ${i + 1}`}
                  className="w-full px-2 py-1.5 rounded border border-border bg-card text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-40"
                />
              </div>
              );
            })}
            <button
              type="button"
              onClick={addStep}
              className="flex items-center gap-1 h-9 px-3 rounded bg-muted text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <Plus size={12} /> Anadir paso
            </button>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onSave(s)}
              className="flex items-center gap-1 h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <FloppyDisk size={14} weight="bold" /> Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
