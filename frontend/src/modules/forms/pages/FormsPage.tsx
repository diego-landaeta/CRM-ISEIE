import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { useSearchParams } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import Select from '@/shared/components/ui/Select';
import { Globe, Plus, Trash, Copy, X, FloppyDisk, Code, Power } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

type TemplateKind = 'contacto_basico' | 'lead_con_producto' | 'custom';

interface FormConfig {
  color?: string;
  button_label?: string;
  success_msg?: string;
  redirect_url?: string;
}

interface FormDef {
  id?: number;
  project_id?: number;
  nombre: string;
  kind: 'form';
  template_kind: TemplateKind;
  config: FormConfig;
  schema?: Record<string, unknown>;
  field_mapping?: Record<string, unknown>;
  active: boolean;
  embed_id?: string;
  submissions_count?: number;
}

const KINDS: ReadonlyArray<{ v: TemplateKind; label: string }> = [
  { v: 'contacto_basico', label: 'Contacto básico (nombre + email + teléfono)' },
  { v: 'lead_con_producto', label: 'Lead con producto de interés' },
  { v: 'custom', label: 'Custom (campos manuales)' },
];

export default function FormsPage() {
  const { activeProject } = useProjectContext();
  const [forms, setForms] = useState<FormDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FormDef | null>(null);
  const [embedFor, setEmbedFor] = useState<FormDef | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormDef | null>(null);

  const load = useCallback(async () => {
    if (!activeProject?.id) return;
    setLoading(true);
    try {
      const res = await client.get(`/forms?projectId=${activeProject.id}&kind=form`);
      if (res.success) setForms((res.data as FormDef[]) || []);
    } finally { setLoading(false); }
  }, [activeProject?.id]);

  useEffect(() => { load(); }, [load]);

  // CRM-147: quick-add via ?new=1 desde el FAB.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing({ nombre: '', kind: 'form', template_kind: 'contacto_basico', config: { color: '#4361ee', button_label: 'Enviar', success_msg: 'Gracias!' }, schema: {}, field_mapping: {}, active: true });
      const next = new URLSearchParams(searchParams);
      next.delete('new');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  async function handleSave(f: FormDef): Promise<void> {
    if (!activeProject?.id) return;
    try {
      if (f.id) await client.patch(`/forms/${f.id}`, f);
      else await client.post('/forms', { ...f, project_id: activeProject.id });
      toast({ title: 'Guardado' });
      setEditing(null); load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  function handleDelete(f: FormDef): void {
    setDeleteTarget(f);
  }

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await client.delete(`/forms/${deleteTarget.id}`);
      toast({ title: 'Eliminado' });
      load();
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally {
      setDeleteTarget(null);
    }
  }

  async function toggleActive(f: FormDef): Promise<void> {
    try {
      await client.patch(`/forms/${f.id}`, { active: !f.active });
      toast({ title: f.active ? 'Form apagado' : 'Form encendido' });
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Forms"
        subtitle={`${forms.length} en ${activeProject?.nombre || 'este proyecto'}`}
        actions={
          <button
            onClick={() => setEditing({ nombre: '', kind: 'form', template_kind: 'contacto_basico', config: { color: '#4361ee', button_label: 'Enviar', success_msg: 'Gracias!' }, schema: {}, field_mapping: {}, active: true })}
            aria-label="Nuevo form"
            className="inline-flex items-center gap-1.5 h-9 px-3 sm:px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo form</span>
          </button>
        }
      />

      {loading ? <SkeletonTable rows={3} columns={3} /> :
        forms.length === 0 ? (
          <EmptyState icon={Globe} title="Sin forms" description="Crea uno y embebelo en tu landing." />
        ) : (
          <div className="grid gap-3">
            {forms.map(f => (
              <div key={f.id} className={`bg-card border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 ${!f.active ? 'opacity-60 border-border' : 'border-border'}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-bold">{f.nombre}</h3>
                    {!f.active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-bold">INACTIVO</span>}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 break-words sm:truncate">
                    {KINDS.find(k => k.v === f.template_kind)?.label || f.template_kind} · {f.submissions_count || 0} submissions · <code>{f.embed_id}</code>
                  </p>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
                  <button
                    onClick={() => toggleActive(f)}
                    className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold ${f.active ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}
                    title={f.active ? 'Apagar form' : 'Encender form'}
                  >
                    <Power size={12} weight="bold" /> {f.active ? 'ON' : 'OFF'}
                  </button>
                  <button onClick={() => setEmbedFor(f)} className="flex items-center gap-1 px-3 py-1.5 rounded bg-muted text-xs font-bold">
                    <Code size={12} /> Embed
                  </button>
                  <button onClick={() => setEditing(f)} className="px-3 py-1.5 rounded bg-muted text-xs font-bold">Editar</button>
                  <button onClick={() => handleDelete(f)} className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500" aria-label="Eliminar"><Trash size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

      {editing && <FormEditor form={editing} onSave={handleSave} onClose={() => setEditing(null)} />}
      {embedFor && <EmbedDialog form={embedFor} onClose={() => setEmbedFor(null)} />}
      <Suspense fallback={null}>
        <ConfirmDialog
          open={!!deleteTarget}
          title="Eliminar form"
          message={`¿Eliminar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer.`}
          confirmLabel="Eliminar"
          tone="destructive"
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      </Suspense>
    </div>
  );
}

interface FormEditorProps {
  form: FormDef;
  onSave: (f: FormDef) => void | Promise<void>;
  onClose: () => void;
}

function FormEditor({ form, onSave, onClose }: FormEditorProps) {
  const [f, setF] = useState<FormDef>({ ...form, kind: 'form', config: form.config || {} });

  function saveAndClose(): void {
    onSave({ ...f, kind: 'form' });
  }

  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="form-editor-title" className="bg-card rounded-2xl border border-border max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 id="form-editor-title" className="font-extrabold">{f.id ? 'Editar' : 'Nuevo'} form</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <input value={f.nombre} onChange={e => setF({ ...f, nombre: e.target.value })} placeholder="Nombre interno" className="w-full h-10 px-3 rounded-lg border border-border bg-muted/30 text-sm" />

          <Select<TemplateKind>
            value={f.template_kind}
            onChange={(v) => setF({ ...f, template_kind: v })}
            options={KINDS.map(k => ({ value: k.v, label: k.label }))}
            ariaLabel="Tipo de plantilla"
          />

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">Texto del boton</span>
              <input value={f.config.button_label || ''} onChange={e => setF({ ...f, config: { ...f.config, button_label: e.target.value } })} placeholder="Enviar" className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
            </label>
            <label className="block text-xs">
              <span className="font-bold uppercase text-muted-foreground">Color principal</span>
              <input type="color" value={f.config.color || '#4361ee'} onChange={e => setF({ ...f, config: { ...f.config, color: e.target.value } })} className="mt-1 w-full h-9 rounded-lg border border-border bg-muted/30" />
            </label>
          </div>
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">Mensaje de exito</span>
            <input value={f.config.success_msg || ''} onChange={e => setF({ ...f, config: { ...f.config, success_msg: e.target.value } })} placeholder="Gracias!" className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
          </label>
          <label className="block text-xs">
            <span className="font-bold uppercase text-muted-foreground">URL de redireccion (opcional)</span>
            <input value={f.config.redirect_url || ''} onChange={e => setF({ ...f, config: { ...f.config, redirect_url: e.target.value } })} placeholder="https://..." className="mt-1 w-full h-9 px-3 rounded-lg border border-border bg-muted/30 text-sm" />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} />
            Activo
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-bold">Cancelar</button>
            <button onClick={saveAndClose} className="flex items-center gap-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-bold"><FloppyDisk size={14} weight="bold" /> Guardar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface EmbedDialogProps {
  form: FormDef;
  onClose: () => void;
}

function EmbedDialog({ form, onClose }: EmbedDialogProps) {
  async function copy(text: string): Promise<void> {
    const ok = await copyToClipboard(text);
    toast({ title: ok ? 'Copiado' : 'No se pudo copiar — usa Ctrl+C', variant: ok ? undefined : 'destructive' });
  }

  const apiBase = `${window.location.origin}${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/api/forms/public/${form.embed_id}`;
  const iframeSrc = `${window.location.origin}/embed/form/${form.embed_id}`;
  const iframeHtml = `<iframe src="${iframeSrc}" width="100%" height="500" frameborder="0"></iframe>`;
  const scriptHtml = `<div id="crm-form-${form.embed_id}"></div>\n<script src="${window.location.origin}/embed/form.js" data-form-id="${form.embed_id}"></script>`;
  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="form-embed-title" className="bg-card rounded-2xl border border-border max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 id="form-embed-title" className="font-extrabold">Embed: {form.nombre}</h3>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-muted" aria-label="Cerrar"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 text-xs">
          <div>
            <p className="font-bold uppercase text-muted-foreground mb-1">URL API publico</p>
            <div className="flex gap-2"><code className="flex-1 p-2 bg-muted/40 rounded overflow-x-auto">{apiBase}</code><button onClick={() => copy(apiBase)} aria-label="Copiar URL API" className="p-2 rounded bg-muted"><Copy size={12} /></button></div>
          </div>
          <div>
            <p className="font-bold uppercase text-muted-foreground mb-1">Iframe</p>
            <div className="flex gap-2"><code className="flex-1 p-2 bg-muted/40 rounded overflow-x-auto">{iframeHtml}</code><button onClick={() => copy(iframeHtml)} aria-label="Copiar iframe" className="p-2 rounded bg-muted"><Copy size={12} /></button></div>
          </div>
          <div>
            <p className="font-bold uppercase text-muted-foreground mb-1">Script (Shadow DOM)</p>
            <div className="flex gap-2"><code className="flex-1 p-2 bg-muted/40 rounded overflow-x-auto whitespace-pre">{scriptHtml}</code><button onClick={() => copy(scriptHtml)} aria-label="Copiar script" className="p-2 rounded bg-muted"><Copy size={12} /></button></div>
          </div>
          <p className="text-muted-foreground italic">Embed JS y página iframe pendientes; el endpoint API ya funciona y puedes integrarlo desde JS propio.</p>
        </div>
      </div>
    </div>
  );
}
