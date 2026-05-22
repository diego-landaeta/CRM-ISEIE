import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import client from '@/shared/api/client';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { PlugsConnected, Plus, Copy, Trash, X } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import { copyToClipboard } from '@/shared/lib/clipboard';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

interface WebhookToken {
  id: number;
  token: string;
  notas?: string;
  active: boolean;
  uses_count?: number;
  last_used_at?: string;
  field_mapping?: Record<string, string>;
  sample_payload?: any;
}

interface Project {
  id: number;
}

const MATRICULA_TARGETS = [
  { key: 'dni', label: 'DNI / Identificación' },
  { key: 'titulo', label: 'Título / Programa' },
  { key: 'email', label: 'Email' },
  { key: 'notas', label: 'Notas / Comentarios' },
];

export default function WebhooksTab({ project }: { project: Project | null | undefined }) {
  const [tokens, setTokens] = useState<WebhookToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WebhookToken | null>(null);
  const [pendingDelete, setPendingDelete] = useState<WebhookToken | null>(null);

  const load = useCallback(async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const res = await client.get(`/webhook-tokens?projectId=${project.id}&kind=matriculas`);
      if (res.success) setTokens(res.data);
    } catch (err: any) {
      toast({ title: 'Error cargando webhooks de admisión', description: err?.data?.error || err.message, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [project?.id]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate(data: Partial<WebhookToken>) {
    if (!project?.id) return;
    try {
      await client.post('/webhook-tokens', { project_id: project.id, kind: 'matriculas', ...data });
      toast({ title: 'Webhook creado' });
      setCreating(false);
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  async function handleUpdate(t: WebhookToken, data: Partial<WebhookToken>) {
    try {
      await client.patch(`/webhook-tokens/${t.id}`, data);
      toast({ title: 'Guardado' });
      setEditing(null);
      load();
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }
  function handleDelete(t: WebhookToken) { setPendingDelete(t); }
  async function doDelete() {
    if (!pendingDelete) return;
    try { await client.delete(`/webhook-tokens/${pendingDelete.id}`); load(); }
    catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
    finally { setPendingDelete(null); }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Crea webhooks para recibir solicitudes de admisión desde formularios externos. Cada solicitud crea una matrícula en estado <strong>solicitud_admision</strong>. Dedupe automático por DNI o email.</p>
        <button
          onClick={() => setCreating(true)}
          aria-label="Nuevo webhook"
          className="flex items-center gap-1 h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Plus size={14} weight="bold" /> <span className="hidden sm:inline">Nuevo webhook</span>
        </button>
      </div>

      {loading ? <SkeletonTable rows={3} columns={3} /> : tokens.length === 0 ? (
        <EmptyState icon={PlugsConnected} title="Sin webhooks" description="Crea uno para recibir solicitudes desde tu formulario de admisión externo" />
      ) : (
        <div className="space-y-2">
          {tokens.map(t => <WebhookCard key={t.id} token={t} onEdit={() => setEditing(t)} onDelete={() => handleDelete(t)} />)}
        </div>
      )}

      {(creating || editing) && (
        <WebhookEditor token={editing} onSave={editing ? (d => handleUpdate(editing, d)) : handleCreate} onClose={() => { setCreating(false); setEditing(null); }} />
      )}
      <Suspense fallback={null}>
        <ConfirmDialog
          open={pendingDelete !== null}
          title="¿Eliminar webhook?"
          message="Las solicitudes pendientes no se borrarán, pero el webhook dejará de aceptar nuevas."
          confirmLabel="Eliminar"
          tone="destructive"
          onConfirm={doDelete}
          onCancel={() => setPendingDelete(null)}
        />
      </Suspense>
    </div>
  );
}

function WebhookCard({ token, onEdit, onDelete }: { token: WebhookToken; onEdit: () => void; onDelete: () => void }) {
  const url = `${window.location.origin}${(import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '')}/api/webhook-tokens/receive/${token.token}`;
  return (
    <div className="bg-card border border-border rounded-2xl p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="font-bold text-sm">{token.notas || 'Webhook admisión'}</p>
          <p className="text-xs text-muted-foreground">{token.uses_count || 0} usos · última vez: {token.last_used_at ? new Date(token.last_used_at).toLocaleString('es-ES') : 'nunca'}{!token.active && ' · INACTIVO'}</p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={onEdit}
            className="h-9 px-3 rounded bg-muted text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            Editar
          </button>
          <button
            onClick={onDelete}
            aria-label="Eliminar webhook"
            className="h-9 w-9 inline-flex items-center justify-center rounded hover:bg-red-50 dark:hover:bg-red-950/40 text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40"
          >
            <Trash size={14} />
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        <code className="flex-1 p-2 bg-muted/40 rounded text-[11px] overflow-x-auto break-all">{url}</code>
        <button
          onClick={async () => { const ok = await copyToClipboard(url); toast({ title: ok ? 'Copiado' : 'Usa Ctrl+C', variant: ok ? undefined : 'destructive' }); }}
          aria-label="Copiar URL del webhook"
          className="p-2 rounded bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <Copy size={12} />
        </button>
      </div>
      {Object.keys(token.field_mapping || {}).length > 0 && (
        <pre className="text-[10px] p-2 bg-muted/30 rounded overflow-x-auto">{JSON.stringify(token.field_mapping, null, 2)}</pre>
      )}
    </div>
  );
}

interface EditorProps {
  token: WebhookToken | null;
  onSave: (data: Partial<WebhookToken>) => void;
  onClose: () => void;
}

function WebhookEditor({ token, onSave, onClose }: EditorProps) {
  const [notas, setNotas] = useState<string>(token?.notas || '');
  const [active, setActive] = useState<boolean>(token ? token.active : true);
  const [mapping, setMapping] = useState<Record<string, string>>(token?.field_mapping || {});
  const [samplePayload, setSamplePayload] = useState<any>(token?.sample_payload || null);
  const [listening, setListening] = useState(false);
  const [mapPath, setMapPath] = useState<string | null>(null);
  const pollRef = useState<{ current: ReturnType<typeof setInterval> | null }>({ current: null })[0];

  async function startListening() {
    if (!token?.id) {
      toast({ title: 'Guarda primero el webhook para iniciar la escucha', variant: 'destructive' });
      return;
    }
    try {
      await client.post(`/webhook-tokens/${token.id}/listen`);
      setListening(true);
      pollRef.current = setInterval(async () => {
        try {
          const r = await client.get(`/webhook-tokens/${token.id}/status`);
          if (r.success && r.data.sample_payload) {
            setSamplePayload(r.data.sample_payload);
            setListening(false);
            if (pollRef.current) clearInterval(pollRef.current);
            toast({ title: 'Payload recibido', description: 'Mapea los campos clickeando.' });
          }
        } catch {}
      }, 2000);
    } catch (err: any) { toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' }); }
  }

  async function stopListening() {
    if (token?.id) await client.post(`/webhook-tokens/${token.id}/listen/stop`);
    if (pollRef.current) clearInterval(pollRef.current);
    setListening(false);
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, [pollRef]);

  function save() {
    onSave({ notas, active, field_mapping: mapping });
  }

  const url = token?.token ? `${window.location.origin}${(import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '')}/api/webhook-tokens/receive/${token.token}` : null;

  return (
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="webhook-editor-title" className="bg-card rounded-2xl border border-border max-w-3xl w-full max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 id="webhook-editor-title" className="font-extrabold">{token ? 'Editar' : 'Nuevo'} webhook de admisión</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar editor"
            className="p-1.5 rounded hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <input value={notas} onChange={e => setNotas(e.target.value)} placeholder="Nombre / Descripción (ej: Form admisión web 2026)" className="w-full h-9 px-3 rounded-lg border border-border bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40" />

          {url && (
            <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-2">
              <p className="text-[11px] font-bold uppercase text-muted-foreground">URL del webhook</p>
              <div className="flex gap-2">
                <code className="flex-1 p-2 bg-card rounded text-[11px] overflow-x-auto break-all">{url}</code>
                <button
                  onClick={async () => { const ok = await copyToClipboard(url); toast({ title: ok ? 'Copiado' : 'Usa Ctrl+C', variant: ok ? undefined : 'destructive' }); }}
                  aria-label="Copiar URL"
                  className="p-2 rounded bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  <Copy size={12} />
                </button>
              </div>
            </div>
          )}

          {token?.id && (
            <div className="p-4 rounded-xl border-2 border-dashed border-border bg-muted/10">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-bold text-sm">Capturar estructura del payload</p>
                  <p className="text-xs text-muted-foreground">Estilo Make/Zapier: pulsa "Esperar payload", manda una petición de prueba al URL, y los campos aparecen para mapear con un click.</p>
                </div>
                {!listening ? (
                  <button onClick={startListening} className="h-9 px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40">Esperar payload</button>
                ) : (
                  <button onClick={stopListening} className="h-9 px-3 rounded-lg bg-amber-500 text-white text-xs font-bold whitespace-nowrap animate-pulse focus:outline-none focus:ring-2 focus:ring-amber-500/40">Escuchando... (cancelar)</button>
                )}
              </div>
              {listening && <p className="text-xs text-amber-600 mt-2">→ Manda ahora un POST de prueba al URL de arriba con tu sistema externo o curl.</p>}
            </div>
          )}

          {samplePayload && (
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">Payload capturado · Click en un campo para mapearlo</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="border border-border rounded-xl p-3 bg-muted/10 max-h-64 overflow-y-auto">
                  <PayloadTree obj={samplePayload} path="" onSelect={(path) => setMapPath(path)} mapping={mapping} />
                </div>
                <div className="border border-border rounded-xl p-3 space-y-2">
                  <p className="text-[11px] font-bold uppercase text-muted-foreground">Mapping CRM</p>
                  {MATRICULA_TARGETS.map(t => (
                    <div key={t.key} className="flex items-center gap-2 text-xs">
                      <span className="w-32 font-bold">{t.label}</span>
                      <code className="flex-1 px-2 py-1 bg-muted/40 rounded text-[10px]">{mapping[t.key] || '(sin mapear)'}</code>
                      {mapping[t.key] && (
                        <button
                          onClick={() => { const m = { ...mapping }; delete m[t.key]; setMapping(m); }}
                          aria-label={`Quitar mapping de ${t.label}`}
                          className="text-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/40 rounded"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!samplePayload && (
            <div>
              <p className="text-[11px] font-bold uppercase text-muted-foreground mb-1">Mapping manual (opcional)</p>
              <p className="text-xs text-muted-foreground mb-2">Si no quieres usar la captura, escribe el JSON directamente.</p>
              <textarea defaultValue={JSON.stringify(mapping, null, 2)} onBlur={e => { try { setMapping(JSON.parse(e.target.value || '{}')); } catch {} }} rows={5} className="w-full px-3 py-2 rounded-lg border border-border bg-muted/30 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/40" />
            </div>
          )}

          <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Activo</label>
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <button onClick={onClose} className="h-9 px-4 rounded-lg text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40">Cancelar</button>
            <button onClick={save} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-xs font-bold focus:outline-none focus:ring-2 focus:ring-primary/40">Guardar</button>
          </div>
        </div>
      </div>
      <PromptDialog
        open={!!mapPath}
        title="Mapear campo del payload"
        message={mapPath ? <>Selecciona a qué campo del CRM mapear <code className="font-mono text-foreground">{mapPath}</code>.</> : null}
        options={MATRICULA_TARGETS.map(t => ({ value: t.key, label: t.label }))}
        confirmLabel="Mapear"
        onConfirm={(target: string) => {
          if (target && MATRICULA_TARGETS.find(t => t.key === target)) {
            setMapping({ ...mapping, [target]: mapPath as string });
          }
          setMapPath(null);
        }}
        onCancel={() => setMapPath(null)}
      />
    </div>
  );
}

interface PayloadTreeProps {
  obj: any;
  path: string;
  onSelect: (path: string) => void;
  mapping: Record<string, string>;
}

function PayloadTree({ obj, path, onSelect, mapping }: PayloadTreeProps) {
  if (obj === null || obj === undefined) return <span className="text-muted-foreground italic">null</span>;
  if (typeof obj !== 'object') {
    const usedAs = Object.entries(mapping || {}).find(([, v]) => v === path)?.[0];
    return (
      <button
        onClick={() => onSelect(path)}
        className={`text-left px-1.5 py-0.5 rounded text-[11px] font-mono hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/40 ${usedAs ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : ''}`}
        title={usedAs ? `Mapeado a: ${usedAs}` : 'Click para mapear'}
      >
        {String(obj).slice(0, 80)}{usedAs && ` ← ${usedAs}`}
      </button>
    );
  }
  if (Array.isArray(obj)) {
    return (
      <ul className="ml-3 space-y-0.5">
        {obj.slice(0, 5).map((v, i) => (
          <li key={i} className="text-[11px]">
            <span className="text-muted-foreground">[{i}]:</span> <PayloadTree obj={v} path={`${path}.${i}`.replace(/^\./, '')} onSelect={onSelect} mapping={mapping} />
          </li>
        ))}
        {obj.length > 5 && <li className="text-[10px] text-muted-foreground italic">... +{obj.length - 5} más</li>}
      </ul>
    );
  }
  return (
    <ul className="space-y-0.5">
      {Object.entries(obj).map(([k, v]) => {
        const childPath = path ? `${path}.${k}` : k;
        return (
          <li key={k} className="text-[11px]">
            <span className="font-bold text-foreground">{k}:</span> <PayloadTree obj={v} path={childPath} onSelect={onSelect} mapping={mapping} />
          </li>
        );
      })}
    </ul>
  );
}
