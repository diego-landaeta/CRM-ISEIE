import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, ArrowsClockwise, Trash, Plus, X, PaperPlaneTilt, PencilSimple,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

interface MakeWebhook {
  id: number;
  project_id: number;
  slug: string;
  label: string;
  secret: string;
  mode: 'test' | 'active';
  field_mapping: Record<string, string>;
  sample_payload: any;
  sample_received_at: string | null;
  total_received: number;
  total_created: number;
  total_errors: number;
  last_error: string | null;
  active: boolean;
}

interface Delivery {
  id: number;
  received_at: string;
  result: 'accepted' | 'rejected' | 'test_only';
  lead_id: number | null;
  error_message: string | null;
}

// Campos del CRM mapeables. Cualquier otro nombre va a custom_fields.
const KNOWN_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'nombre', label: 'Nombre (requerido)' },
  { key: 'email', label: 'Email' },
  { key: 'telefono', label: 'Telefono' },
  { key: 'responsable_email', label: 'Asesora (email del gestor)' },
  { key: 'responsable_nombre', label: 'Asesora (nombre)' },
  { key: 'producto_interes', label: 'Producto (texto/nombre)' },
  { key: 'producto_interes_sku', label: 'Producto (SKU)' },
  { key: 'landing_url', label: 'Landing URL' },
  { key: 'canal', label: 'Canal' },
  { key: 'notas', label: 'Notas' },
  { key: 'idempotency_key', label: 'Idempotency key (anti-duplicado)' },
  { key: 'utm_source', label: 'UTM Source' },
  { key: 'utm_medium', label: 'UTM Medium' },
  { key: 'utm_campaign', label: 'UTM Campaign' },
];

function jsonKeys(obj: any, prefix = '', max = 50): string[] {
  if (!obj || typeof obj !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...jsonKeys(v, path, max - out.length));
    } else {
      out.push(path);
    }
    if (out.length >= max) break;
  }
  return out;
}

export default function MakeWebhookDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [hook, setHook] = useState<MakeWebhook | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [labelDraft, setLabelDraft] = useState('');
  const [savingLabel, setSavingLabel] = useState(false);
  const [newField, setNewField] = useState('');
  const [showSecret, setShowSecret] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        client.get(`/make-webhooks/${id}`),
        client.get(`/make-webhooks/${id}/deliveries?limit=20`),
      ]);
      if (r1.success) {
        setHook(r1.data);
        setMapping(r1.data.field_mapping || {});
        setLabelDraft(r1.data.label || '');
      }
      if (r2.success) setDeliveries(r2.data || []);
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function save() {
    try {
      const res = await client.patch(`/make-webhooks/${id}`, { field_mapping: mapping });
      if (res.success) {
        toast({ title: 'Mapeo guardado' });
        await load();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    }
  }

  async function saveLabel() {
    if (!labelDraft.trim() || labelDraft === hook?.label) return;
    setSavingLabel(true);
    try {
      const res = await client.patch(`/make-webhooks/${id}`, { label: labelDraft.trim() });
      if (res.success) {
        toast({ title: 'Nombre guardado' });
        await load();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    } finally { setSavingLabel(false); }
  }

  async function changeMode(mode: 'test' | 'active') {
    try {
      const res = await client.patch(`/make-webhooks/${id}`, { mode });
      if (res.success) {
        toast({ title: `Modo ${mode === 'active' ? 'ACTIVO - creara leads' : 'TEST - solo guarda payload'}` });
        await load();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    }
  }

  async function rotateSecret() {
    if (!confirm('Rotar el secret? Make dejara de funcionar hasta que actualices el header X-Make-Secret en tu escenario.')) return;
    try {
      const res = await client.post(`/make-webhooks/${id}/rotate-secret`, {});
      if (res.success) {
        toast({ title: 'Secret rotado', description: 'Actualizalo en tu escenario de Make' });
        await load();
      }
    } catch (err: any) {
      toast({ title: 'Error', description: err?.data?.error, variant: 'destructive' });
    }
  }

  async function deleteHook() {
    if (!confirm('Eliminar este conector? Make dejara de poder enviar leads aqui.')) return;
    await client.delete(`/make-webhooks/${id}`);
    navigate('/make-webhooks');
  }

  function copy(text: string, what: string) {
    navigator.clipboard.writeText(text);
    toast({ title: `${what} copiado` });
  }

  if (loading || !hook) return <div className="p-8 text-muted-foreground">Cargando...</div>;

  const baseUrl = window.location.origin + (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  const webhookUrl = `${baseUrl}/api/webhooks/make/${hook.slug}`;
  const detectedKeys = hook.sample_payload ? jsonKeys(hook.sample_payload) : [];

  return (
    <div className="space-y-5 pb-8">
      <button onClick={() => navigate('/make-webhooks')} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} /> Volver
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="group flex items-center gap-2 max-w-2xl">
            <input
              type="text"
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              placeholder="Nombre del conector"
              title="Clic para editar el nombre"
              className="text-2xl font-bold bg-transparent border-0 border-b-2 border-dashed border-muted-foreground/30 hover:border-primary focus:border-primary focus:border-solid outline-none px-1 py-0.5 -ml-1 min-w-0 flex-1"
            />
            <PencilSimple size={16} weight="regular" className="text-muted-foreground/60 group-hover:text-primary transition-colors flex-shrink-0" />
            {savingLabel && <span className="text-xs text-muted-foreground">guardando...</span>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Conector Make - {hook.total_received} recibidos - {hook.total_created} leads creados - {hook.total_errors} errores
          </p>
        </div>
        <button onClick={deleteHook} className="h-9 px-3 rounded-lg border border-red-200 dark:border-red-800 text-red-600 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1 flex-shrink-0">
          <Trash size={14} /> Eliminar
        </button>
      </div>

      {/* Modo */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2">Modo de operacion</p>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => changeMode('test')}
            className={`p-3 rounded-lg border text-left ${hook.mode === 'test' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-border hover:bg-muted'}`}
          >
            <p className="font-semibold text-sm">TEST</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Solo guarda el payload para inspeccion. NO crea leads.</p>
          </button>
          <button
            onClick={() => changeMode('active')}
            className={`p-3 rounded-lg border text-left ${hook.mode === 'active' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border hover:bg-muted'}`}
          >
            <p className="font-semibold text-sm">ACTIVO</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Aplica el mapeo y crea leads en el CRM.</p>
          </button>
        </div>
      </div>

      {/* URL + Secret */}
      <div className="bg-card border border-border rounded-lg p-4 space-y-3">
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">URL del webhook (configura en Make)</p>
          <div className="flex gap-1">
            <code className="flex-1 px-3 py-2 rounded-md bg-muted text-xs break-all">{webhookUrl}</code>
            <button onClick={() => copy(webhookUrl, 'URL')} className="px-3 rounded-md border border-border hover:bg-muted"><Copy size={14} /></button>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-muted-foreground mb-1">Secret (header <code className="text-[10px]">X-Make-Secret</code>)</p>
          <div className="flex gap-1">
            <code className="flex-1 px-3 py-2 rounded-md bg-muted text-xs break-all">
              {showSecret ? hook.secret : '--------------------------------'}
            </code>
            <button onClick={() => setShowSecret(s => !s)} className="px-3 rounded-md border border-border hover:bg-muted text-xs">{showSecret ? 'Ocultar' : 'Ver'}</button>
            <button onClick={() => copy(hook.secret, 'Secret')} className="px-3 rounded-md border border-border hover:bg-muted"><Copy size={14} /></button>
            <button onClick={rotateSecret} title="Rotar secret" className="px-3 rounded-md border border-border hover:bg-muted"><ArrowsClockwise size={14} /></button>
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md p-3 text-[11px] text-blue-800 dark:text-blue-300">
          <p className="font-semibold mb-1">Configuracion en Make:</p>
          <ol className="list-decimal list-inside space-y-0.5">
            <li>Modulo "HTTP - Make a request"</li>
            <li>Method: <code>POST</code> - URL: la de arriba</li>
            <li>Headers: <code>X-Make-Secret</code> = secret de arriba</li>
            <li>Body type: Raw / JSON - pega tu payload (con la asesora dentro)</li>
            <li>Lanza un test y vuelve aqui para ver el payload capturado y mapear</li>
          </ol>
        </div>
      </div>

      {/* Sample payload + mapeo */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2">
            Ultimo payload recibido {hook.sample_received_at && `(${new Date(hook.sample_received_at).toLocaleString('es-ES')})`}
          </p>
          {hook.sample_payload ? (
            <pre className="text-[11px] bg-muted rounded-md p-3 overflow-auto max-h-96 font-mono">
              {JSON.stringify(hook.sample_payload, null, 2)}
            </pre>
          ) : (
            <p className="text-xs text-muted-foreground italic">Aun no hemos recibido nada. Lanza un test desde Make.</p>
          )}
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-muted-foreground">Mapeo de campos CRM - Make</p>
            <button onClick={save} className="h-7 px-3 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90">Guardar</button>
          </div>

          <div className="space-y-2 max-h-96 overflow-auto">
            {Object.entries(mapping).map(([crmField, path]) => {
              const known = KNOWN_FIELDS.find(f => f.key === crmField);
              return (
                <div key={crmField} className="flex gap-1 items-center text-xs">
                  <div className="w-44 truncate" title={crmField}>
                    <span className="font-semibold">{known?.label || crmField}</span>
                    {!known && <span className="text-[10px] text-violet-600 ml-1">(custom)</span>}
                  </div>
                  <span className="text-muted-foreground">&lt;-</span>
                  <select
                    value={path}
                    onChange={(e) => setMapping({ ...mapping, [crmField]: e.target.value })}
                    className="flex-1 h-7 px-2 rounded-md border border-border bg-muted/50 text-[11px] font-mono"
                  >
                    <option value="">- elegir -</option>
                    {detectedKeys.map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <button onClick={() => { const m = { ...mapping }; delete m[crmField]; setMapping(m); }} className="p-1 text-muted-foreground hover:text-red-600"><X size={12} /></button>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border mt-3 pt-3">
            <p className="text-[11px] font-semibold text-muted-foreground mb-1">Anadir campo</p>
            <div className="flex gap-1">
              <select
                value={newField}
                onChange={(e) => setNewField(e.target.value)}
                className="flex-1 h-8 px-2 rounded-md border border-border bg-muted/50 text-xs"
              >
                <option value="">- campo del CRM -</option>
                {KNOWN_FIELDS.filter(f => !(f.key in mapping)).map(f => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
                <option value="__custom__">+ Campo custom (cualquier nombre)</option>
              </select>
              <button
                onClick={() => {
                  if (!newField) return;
                  if (newField === '__custom__') {
                    const name = prompt('Nombre del campo custom (ej: ciudad, edad, etc):');
                    if (name && !mapping[name]) { setMapping({ ...mapping, [name]: '' }); setNewField(''); }
                  } else if (!mapping[newField]) {
                    setMapping({ ...mapping, [newField]: '' });
                    setNewField('');
                  }
                }}
                className="h-8 px-3 rounded-md bg-primary text-white text-xs font-semibold hover:bg-primary/90"
              >
                <Plus size={12} weight="bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Historial de deliveries */}
      <div className="bg-card border border-border rounded-lg p-4">
        <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-2">
          <PaperPlaneTilt size={14} /> Historial de envios (ultimos 20)
        </p>
        {deliveries.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Sin envios aun.</p>
        ) : (
          <div className="space-y-1">
            {deliveries.map(d => (
              <div key={d.id} className="flex items-center gap-2 text-[11px] py-1 border-b border-border/60 last:border-0">
                <span className={`px-2 py-0.5 rounded font-bold w-20 text-center ${
                  d.result === 'accepted' ? 'bg-emerald-100 text-emerald-700' :
                  d.result === 'rejected' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>{d.result}</span>
                <span className="text-muted-foreground tabular-nums">{new Date(d.received_at).toLocaleString('es-ES')}</span>
                {d.lead_id && <a href={`/leads/${d.lead_id}`} className="text-primary underline">lead #{d.lead_id}</a>}
                {d.error_message && <span className="text-red-600 truncate" title={d.error_message}>- {d.error_message}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
