import { useEffect, useState, useCallback } from 'react';
import DOMPurify from 'dompurify';
import { Plus, EnvelopeSimple, Pencil, Trash, Eye, FloppyDisk, X } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import { emailTemplatesApi, type EmailTemplate, type TemplateVariable } from '../api/templates.api';

const inp = 'w-full h-9 px-3 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all';

export default function EmailTemplatesPage() {
  const { user } = useAuth();
  const { activeProject } = useProjectContext();
  const role = (user as { role?: string } | null)?.role;
  const isAdmin = role === 'superadmin' || role === 'admin';

  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [variables, setVariables] = useState<TemplateVariable[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);
  const [previewHtml, setPreviewHtml] = useState<{ subject: string; body_html: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const [listRes, varsRes] = await Promise.all([
        emailTemplatesApi.list(activeProject.id, true),
        emailTemplatesApi.variables(),
      ]);
      if (listRes.success && listRes.data) setTemplates(listRes.data);
      if (varsRes.success && varsRes.data) setVariables(varsRes.data);
    } finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { refresh(); }, [refresh]);

  async function handleSave(data: { name: string; subject: string; body_html: string; description?: string }) {
    if (!activeProject?.id) return;
    try {
      if (editing && editing !== 'new') {
        await emailTemplatesApi.update(editing.id, activeProject.id, data);
        toast({ title: 'Plantilla actualizada' });
      } else {
        await emailTemplatesApi.create(activeProject.id, data);
        toast({ title: 'Plantilla creada' });
      }
      setEditing(null);
      refresh();
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'No se pudo guardar', variant: 'destructive' });
    }
  }

  async function handleDelete(t: EmailTemplate) {
    if (!activeProject?.id) return;
    if (!confirm(`Eliminar la plantilla "${t.name}"?`)) return;
    try {
      await emailTemplatesApi.remove(t.id, activeProject.id);
      toast({ title: 'Plantilla eliminada' });
      refresh();
    } catch (e: unknown) {
      toast({ title: 'Error', description: e instanceof Error ? e.message : 'No se pudo eliminar', variant: 'destructive' });
    }
  }

  async function handlePreview(t: EmailTemplate) {
    if (!activeProject?.id) return;
    try {
      const res = await emailTemplatesApi.render(t.id, activeProject.id);
      if (res.success && res.data) setPreviewHtml(res.data);
    } catch {
      toast({ title: 'Error generando preview', variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <PageHeader
        title="Plantillas de email"
        subtitle="Reutiliza textos para enviar a leads, variables dinamicas con {{...}}"
        actions={isAdmin ? (
          <button
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90"
          >
            <Plus size={14} weight="bold" /> Nueva plantilla
          </button>
        ) : undefined}
      />

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[1, 2].map(i => <div key={i} className="h-32 bg-muted/30 rounded-xl animate-pulse" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="bg-muted/40 border border-border rounded-xl p-10 text-center">
          <EnvelopeSimple size={32} weight="duotone" className="mx-auto mb-2 text-muted-foreground/60" />
          <p className="text-sm font-medium">No hay plantillas en este proyecto</p>
          <p className="text-xs text-muted-foreground mt-0.5">Crea una y usala desde la ficha de cada lead.</p>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map(t => (
            <article key={t.id} className={`bg-card border border-border rounded-xl p-4 ${!t.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm truncate">{t.name}</h3>
                  <p className="text-[12px] text-muted-foreground truncate">{t.subject}</p>
                </div>
                {!t.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">Inactiva</span>}
              </div>
              {t.description && <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{t.description}</p>}
              <div className="flex gap-1.5 flex-wrap">
                <button
                  onClick={() => handlePreview(t)}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border bg-card text-[11px] hover:bg-muted"
                >
                  <Eye size={11} /> Preview
                </button>
                {isAdmin && (
                  <>
                    <button
                      onClick={() => setEditing(t)}
                      className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border bg-card text-[11px] hover:bg-muted"
                    >
                      <Pencil size={11} /> Editar
                    </button>
                    <button
                      onClick={() => handleDelete(t)}
                      className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border bg-card text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40"
                    >
                      <Trash size={11} /> Eliminar
                    </button>
                  </>
                )}
              </div>
            </article>
          ))}
        </div>
      )}

      {editing && (
        <TemplateEditorDialog
          template={editing === 'new' ? null : editing}
          variables={variables}
          onClose={() => setEditing(null)}
          onSave={handleSave}
        />
      )}

      {previewHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPreviewHtml(null)}>
          <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <div>
                <p className="text-[11px] text-muted-foreground">Asunto</p>
                <h3 className="font-semibold text-sm">{previewHtml.subject}</h3>
              </div>
              <button onClick={() => setPreviewHtml(null)} aria-label="Cerrar" className="p-1.5 rounded-md hover:bg-muted">
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewHtml.body_html) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateEditorDialog({ template, variables, onClose, onSave }: {
  template: EmailTemplate | null;
  variables: TemplateVariable[];
  onClose: () => void;
  onSave: (data: { name: string; subject: string; body_html: string; description?: string }) => Promise<void>;
}) {
  const [name, setName] = useState(template?.name || '');
  const [subject, setSubject] = useState(template?.subject || '');
  const [body, setBody] = useState(template?.body_html || '');
  const [description, setDescription] = useState(template?.description || '');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!name.trim() || !subject.trim() || !body.trim()) {
      toast({ title: 'Faltan campos', description: 'Nombre, asunto y cuerpo son obligatorios', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), subject: subject.trim(), body_html: body, description: description.trim() || undefined });
    } finally { setSaving(false); }
  }

  function insertVar(token: string, target: 'subject' | 'body') {
    if (target === 'subject') setSubject(s => s + token);
    else setBody(b => b + token);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="bg-card rounded-xl border border-border shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h3 className="font-semibold text-sm">{template ? `Editar plantilla - ${template.name}` : 'Nueva plantilla'}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-md hover:bg-muted">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Nombre interno *</label>
            <input value={name} onChange={e => setName(e.target.value)} className={inp} placeholder="ej: Bienvenida tras conversion" maxLength={120} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Asunto *</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} className={inp} placeholder="Hola {{lead.nombre}}, ..." maxLength={500} />
            <VariablePicker variables={variables} onPick={tok => insertVar(tok, 'subject')} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Cuerpo HTML *</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              rows={12}
              maxLength={50000}
              className="w-full px-3 py-2 rounded-md border border-border bg-muted/50 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 font-mono text-[13px]"
              placeholder="<p>Hola {{lead.nombre}},</p><p>...</p>"
            />
            <VariablePicker variables={variables} onPick={tok => insertVar(tok, 'body')} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Descripcion interna (opcional)</label>
            <input value={description || ''} onChange={e => setDescription(e.target.value)} className={inp} placeholder="Cuando usar esta plantilla" maxLength={1000} />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border bg-muted/20">
          <button onClick={onClose} disabled={saving} className="h-9 px-4 rounded-md border border-border bg-card text-sm hover:bg-muted">Cancelar</button>
          <button onClick={submit} disabled={saving} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function VariablePicker({ variables, onPick }: { variables: TemplateVariable[]; onPick: (token: string) => void }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {variables.map(v => (
        <button
          key={v.token}
          type="button"
          onClick={() => onPick(v.token)}
          title={v.desc}
          className="text-[10px] font-mono h-5 px-1.5 rounded bg-muted hover:bg-primary/10 hover:text-primary border border-border transition-colors"
        >
          {v.token}
        </button>
      ))}
    </div>
  );
}
