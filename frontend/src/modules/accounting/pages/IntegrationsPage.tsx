import { useEffect, useState, useCallback } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { toast } from '@/shared/hooks/useToast';
import {
  CreditCard, EnvelopeSimple, CheckCircle, WarningCircle, Eye, EyeSlash,
  ArrowSquareOut, FloppyDisk, PlugsConnected, Trash, Question,
} from '@phosphor-icons/react';

// ─── Tipos ────────────────────────────────────────────────────────────────
type Provider = 'stripe' | 'brevo';
interface Integration {
  id?: number;
  project_id?: number;
  provider: Provider;
  active: boolean;
  has_secret: boolean;
  secret_preview: string | null;
  config_public: Record<string, string>;
  last_test_status: 'success' | 'error' | null;
  last_test_message: string | null;
  last_test_at: string | null;
}

const EMPTY = (provider: Provider): Integration => ({
  provider, active: false, has_secret: false, secret_preview: null,
  config_public: {}, last_test_status: null, last_test_message: null, last_test_at: null,
});

function fmt(d: string | null): string {
  if (!d) return 'Nunca';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function IntegrationsPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } };
  const pid = activeProject?.id;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={(
          <span className="flex items-center gap-2">
            Integraciones
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">PRUEBAS</span>
          </span>
        ) as unknown as string}
        subtitle={`Configura conexiones externas (Stripe, Brevo) para ${activeProject?.nombre || 'el proyecto activo'}.`}
      />

      <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-3 text-sm">
        <p className="font-semibold text-amber-900 dark:text-amber-300 mb-1">⚠ Zona en pruebas</p>
        <p className="text-amber-800 dark:text-amber-400 text-xs">
          Estas integraciones aún no se usan en producción. Puedes guardar tus credenciales y probar la conexión;
          la activación real (envío de emails / sync de pagos) se hará cuando lo confirmes.
        </p>
      </div>

      {!pid ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
          Selecciona un proyecto en el sidebar para configurar sus integraciones.
        </div>
      ) : (
        <div className="space-y-5">
          <StripeCard projectId={pid} />
          <BrevoCard projectId={pid} />
        </div>
      )}
    </div>
  );
}

// ─── Stripe ───────────────────────────────────────────────────────────────
function StripeCard({ projectId }: { projectId: number }) {
  const [data, setData] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<Integration>(`/integrations/stripe?projectId=${projectId}`);
      if (res.success) {
        setData(res.data || EMPTY('stripe'));
        setWebhookSecret((res.data?.config_public?.webhook_secret_preview as string) || '');
      }
    } catch {/* ignore */} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        projectId, provider: 'stripe',
        active: data?.active ?? true,
        config_public: {
          ...(data?.config_public || {}),
          webhook_url: window.location.origin + '/api/integrations/stripe/webhook',  // URL final (informativo)
        },
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const res = await client.put<Integration>('/integrations', body);
      if (res.success) {
        setData(res.data);
        setApiKey('');
        toast({ title: 'Stripe guardado', description: 'Credenciales cifradas en DB.' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await client.post<{ ok: boolean; message: string; livemode?: boolean }>(`/integrations/stripe/test?projectId=${projectId}`);
      if (res.success) {
        toast({ title: '✓ Conexión OK', description: res.data?.message });
      } else {
        toast({ title: 'Test falló', description: (res as { error?: string }).error || 'Error desconocido', variant: 'destructive' });
      }
      await load();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: 'Test falló', description: err?.data?.error || 'Error de red', variant: 'destructive' });
    } finally { setTesting(false); }
  }

  async function clear() {
    if (!confirm('¿Borrar las credenciales de Stripe de este proyecto?')) return;
    try {
      await client.delete(`/integrations/stripe?projectId=${projectId}`);
      toast({ title: 'Stripe eliminado' });
      setData(EMPTY('stripe'));
      setApiKey('');
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 flex items-center justify-center flex-shrink-0">
          <CreditCard size={22} weight="duotone" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base">Stripe</h3>
          <p className="text-xs text-muted-foreground">Importar payouts y comisiones de pasarela como egresos automáticos.</p>
        </div>
        <StatusPill data={data} />
      </div>

      <div className="p-5 space-y-4">
        <button onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Question size={12} weight="bold" /> {showHelp ? 'Ocultar tutorial' : 'Cómo obtener mi API key de Stripe'}
        </button>
        {showHelp && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
            <p className="font-semibold">Pasos para obtener tu API key:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Entra a <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">dashboard.stripe.com/apikeys <ArrowSquareOut size={10} weight="bold" /></a></li>
              <li>Para pruebas: arriba a la izquierda, activa <strong>"Modo prueba"</strong> y copia la "Secret key" (empieza por <code className="px-1 rounded bg-card">sk_test_...</code>).</li>
              <li>Para producción: desactiva modo prueba y copia la "Secret key live" (<code className="px-1 rounded bg-card">sk_live_...</code>). <strong>Ojo:</strong> con esta tendrás acceso real a movimientos de dinero.</li>
              <li>Pega la key abajo, guarda y pulsa <strong>"Probar conexión"</strong>. Si la cuenta responde, listo.</li>
            </ol>
            <p className="font-semibold pt-1">Webhook (opcional, para sync automático):</p>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground" start={5}>
              <li>En Stripe → Developers → Webhooks → "Add endpoint".</li>
              <li>URL del endpoint: <code className="px-1 rounded bg-card text-[10px] break-all">{window.location.origin}/api/integrations/stripe/webhook</code></li>
              <li>Eventos a escuchar: <code className="px-1 rounded bg-card">payout.paid</code>, <code className="px-1 rounded bg-card">balance.available</code>.</li>
              <li>Copia el <strong>"Signing secret"</strong> (empieza por <code className="px-1 rounded bg-card">whsec_...</code>) y pégalo abajo.</li>
            </ol>
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            API Key {data?.has_secret && <span className="font-normal text-muted-foreground/80 ml-1">(actualmente: <code className="bg-muted px-1 rounded text-[10px]">{data.secret_preview}</code> — deja vacío para no cambiar)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data?.has_secret ? 'Sin cambios' : 'sk_test_... o sk_live_...'}
              className="w-full h-10 pl-3 pr-10 rounded-md border border-border bg-card text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Webhook Signing Secret <span className="text-muted-foreground/60 font-normal">(opcional)</span>
          </label>
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_..."
            className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm font-mono"
          />
        </div>

        <TestStatus data={data} />

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={test} disabled={testing || !data?.has_secret}
            title={!data?.has_secret ? 'Guarda primero la API key' : 'Probar conexión con Stripe'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <PlugsConnected size={14} weight="bold" /> {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {data?.has_secret && (
            <button onClick={clear}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-300 dark:border-red-900 bg-card text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto">
              <Trash size={14} weight="bold" /> Eliminar
            </button>
          )}
        </div>
      </div>
      {loading && <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border">Cargando…</div>}
    </div>
  );
}

// ─── Brevo ────────────────────────────────────────────────────────────────
function BrevoCard({ projectId }: { projectId: number }) {
  const [data, setData] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [fromEmail, setFromEmail] = useState('');
  const [fromName, setFromName] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<Integration>(`/integrations/brevo?projectId=${projectId}`);
      if (res.success) {
        const d = res.data || EMPTY('brevo');
        setData(d);
        setFromEmail((d.config_public?.from_email as string) || '');
        setFromName((d.config_public?.from_name as string) || '');
      }
    } catch {/* ignore */} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        projectId, provider: 'brevo',
        active: data?.active ?? true,
        config_public: {
          from_email: fromEmail.trim() || null,
          from_name: fromName.trim() || null,
        },
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const res = await client.put<Integration>('/integrations', body);
      if (res.success) {
        setData(res.data);
        setApiKey('');
        toast({ title: 'Brevo guardado', description: 'Credenciales cifradas en DB.' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'Error', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await client.post<{ ok: boolean; message: string; email?: string }>(`/integrations/brevo/test?projectId=${projectId}`);
      if (res.success) {
        toast({ title: '✓ Conexión OK', description: res.data?.message });
      } else {
        toast({ title: 'Test falló', description: (res as { error?: string }).error || 'Error desconocido', variant: 'destructive' });
      }
      await load();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: 'Test falló', description: err?.data?.error || 'Error de red', variant: 'destructive' });
    } finally { setTesting(false); }
  }

  async function clear() {
    if (!confirm('¿Borrar las credenciales de Brevo de este proyecto?')) return;
    try {
      await client.delete(`/integrations/brevo?projectId=${projectId}`);
      toast({ title: 'Brevo eliminado' });
      setData(EMPTY('brevo')); setApiKey(''); setFromEmail(''); setFromName('');
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 flex items-center justify-center flex-shrink-0">
          <EnvelopeSimple size={22} weight="duotone" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base">Brevo (Sendinblue)</h3>
          <p className="text-xs text-muted-foreground">Enviar correos transaccionales: lead asignado, recordatorios, confirmación de pago.</p>
        </div>
        <StatusPill data={data} />
      </div>

      <div className="p-5 space-y-4">
        <button onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Question size={12} weight="bold" /> {showHelp ? 'Ocultar tutorial' : 'Cómo obtener mi API key de Brevo'}
        </button>
        {showHelp && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
            <p className="font-semibold">Pasos para obtener tu API key:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Entra a <a href="https://app.brevo.com/settings/keys/api" target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">app.brevo.com/settings/keys/api <ArrowSquareOut size={10} weight="bold" /></a></li>
              <li>Pulsa <strong>"Generar una nueva clave API"</strong>. Ponle un nombre que reconozcas (ej. "CRM ISEIH").</li>
              <li>Copia la clave generada (empieza por <code className="px-1 rounded bg-card">xkeysib-...</code>) y pégala abajo. <strong>Solo se muestra una vez.</strong></li>
              <li>Rellena <strong>From email</strong> con un correo verificado en tu cuenta Brevo (ej. <code className="px-1 rounded bg-card">noreply@iseih.com</code>). Para verificarlo, ve a Senders → Add domain.</li>
              <li>Rellena <strong>From name</strong> con el nombre que verán los destinatarios (ej. "ISEIH" o "CRM ISEIH").</li>
              <li>Guarda y pulsa <strong>"Probar conexión"</strong>. Si la cuenta responde, la API key es válida.</li>
            </ol>
            <p className="text-amber-700 dark:text-amber-400 pt-1">
              <strong>Importante:</strong> el correo de "From email" debe estar validado en Brevo, sino los envíos rebotarán.
            </p>
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            API Key {data?.has_secret && <span className="font-normal text-muted-foreground/80 ml-1">(actualmente: <code className="bg-muted px-1 rounded text-[10px]">{data.secret_preview}</code> — deja vacío para no cambiar)</span>}
          </label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data?.has_secret ? 'Sin cambios' : 'xkeysib-...'}
              className="w-full h-10 pl-3 pr-10 rounded-md border border-border bg-card text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">From email *</label>
            <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)}
              placeholder="noreply@iseih.com"
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">From name</label>
            <input value={fromName} onChange={(e) => setFromName(e.target.value)}
              placeholder="ISEIH"
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
          </div>
        </div>

        <TestStatus data={data} />

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={test} disabled={testing || !data?.has_secret}
            title={!data?.has_secret ? 'Guarda primero la API key' : 'Probar conexión con Brevo'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <PlugsConnected size={14} weight="bold" /> {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {data?.has_secret && (
            <button onClick={clear}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-300 dark:border-red-900 bg-card text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto">
              <Trash size={14} weight="bold" /> Eliminar
            </button>
          )}
        </div>
      </div>
      {loading && <div className="px-5 py-3 text-xs text-muted-foreground border-t border-border">Cargando…</div>}
    </div>
  );
}

// ─── UI helpers ───────────────────────────────────────────────────────────
function StatusPill({ data }: { data: Integration | null }) {
  if (!data?.has_secret) return (
    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-muted text-muted-foreground">
      Sin configurar
    </span>
  );
  if (data.last_test_status === 'success') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
      <CheckCircle size={10} weight="fill" /> Conectado
    </span>
  );
  if (data.last_test_status === 'error') return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-400">
      <WarningCircle size={10} weight="fill" /> Error
    </span>
  );
  return (
    <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-400">
      Guardado · sin probar
    </span>
  );
}

function TestStatus({ data }: { data: Integration | null }) {
  if (!data?.last_test_at) return null;
  const ok = data.last_test_status === 'success';
  return (
    <div className={`text-xs p-2 rounded-md ${ok ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400' : 'bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-400'}`}>
      <div className="flex items-center gap-1.5">
        {ok ? <CheckCircle size={12} weight="fill" /> : <WarningCircle size={12} weight="fill" />}
        <strong>Último test:</strong> <span>{fmt(data.last_test_at)}</span>
      </div>
      <p className="mt-0.5 ml-5 break-words">{data.last_test_message || '(sin mensaje)'}</p>
    </div>
  );
}
