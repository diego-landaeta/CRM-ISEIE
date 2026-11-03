import { useEffect, useState, useCallback } from 'react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import EstadoDeLaSincronizacion from '../components/EstadoDeLaSincronizacion';
import { toast } from '@/shared/hooks/useToast';
import {
  CreditCard, EnvelopeSimple, CheckCircle, WarningCircle, Eye, EyeSlash,
  ArrowSquareOut, FloppyDisk, PlugsConnected, Trash, Question, GraduationCap,
} from '@phosphor-icons/react';

// ─── Tipos ────────────────────────────────────────────────────────────────
type Provider = 'stripe' | 'brevo' | 'moodle';
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

// Nace activa: no hay interruptor en pantalla, asi que guardar una clave
// significa querer usarla. Con active:false la fila quedaba inactiva y el
// sincronizador de Stripe no la veia.
// La direccion real del webhook. La pantalla enseñaba
// /api/integrations/stripe/webhook, que no existe en ningun sitio: la ruta
// buena es /api/stripe-webhook/<projectId>, montada aparte por ser publica.
// Quien copiara la anterior a Stripe la configuro contra la nada.
function urlWebhook(projectId: number | null | undefined): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined)
    || `${window.location.origin}/api`;
  const raiz = base.replace(/\/+$/, '');
  return `${raiz}/stripe-webhook/${projectId ?? ''}`;
}

/**
 * Los eventos que el CRM ATIENDE, sacados de `handleWebhookEvent`.
 *
 * La pantalla pedia marcar `checkout.session.completed`, `invoice.paid` y
 * `payout.paid`, y de esos tres no se procesa NINGUNO: caen en el `default` y
 * se descartan. Quien siguiera el tutorial marcaba tres casillas inutiles y se
 * dejaba sin marcar los `charge.*`, que son los que traen el dinero.
 *
 * Si se anade un `case` alli, hay que anadirlo aqui. No hay forma de compartir
 * la lista —una vive en el servidor y esta en el navegador— asi que queda dicho.
 */
const EVENTOS_DEL_WEBHOOK = [
  'charge.succeeded', 'charge.updated', 'charge.refunded', 'charge.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed',
  'payment_intent.succeeded', 'payment_intent.payment_failed',
] as const;

const EMPTY = (provider: Provider): Integration => ({
  provider, active: true, has_secret: false, secret_preview: null,
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
        subtitle={`Configura conexiones externas (Stripe, Brevo, el campus Moodle) para ${activeProject?.nombre || 'el proyecto activo'}.`}
      />

      <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-900 rounded-lg p-4 text-sm space-y-2">
        <p className="font-semibold text-blue-900 dark:text-blue-300 flex items-center gap-1.5">
          <Question size={14} weight="bold" /> Cómo funciona esta página
        </p>
        <div className="text-blue-900/90 dark:text-blue-300/90 text-xs space-y-1.5">
          <p><strong>1) Guardar credenciales</strong> — pegas la API key y se cifra en DB con AES-256. No se descarga ningún dato.</p>
          <p><strong>2) Probar conexión</strong> — el CRM hace 1 request a la API del proveedor para validar la key. Si responde 200, queda <em>Conectado</em>.</p>
          <p><strong>3) Uso real:</strong></p>
          <ul className="list-disc list-inside pl-2 space-y-0.5">
            <li><strong>Stripe:</strong> con el access token guardado, el CRM sondea los cobros cada cinco minutos y los deja en <em>Pagos Stripe</em> para asociarlos a una venta. El webhook es <em>opcional</em>: sirve para no esperar esos cinco minutos, y sin su secreto de firma se rechaza.</li>
            <li><strong>Campus (Moodle):</strong> las consultas de alumnos. Con el token del campus, el CRM comprueba que cada tutor es usuario del campus de su proyecto.</li>
            <li><strong>Brevo:</strong> envía emails transaccionales (lead asignado, recordatorios, confirmación de pago) usando el From email validado. La automatización de resúmenes diarios / SLA 30min está en desarrollo.</li>
          </ul>
          <p className="text-amber-700 dark:text-amber-400 pt-1">
            <strong>⚠ Importante:</strong> cada proyecto tiene sus propias credenciales. Cambiá el proyecto en el sidebar antes de configurar para no mezclar cuentas.
          </p>
        </div>
      </div>

      {!pid ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
          Selecciona un proyecto en el sidebar para configurar sus integraciones.
        </div>
      ) : (
        <div className="space-y-5">
          <StripeCard projectId={pid} />
          <BrevoCard projectId={pid} />
          <MoodleCard projectId={pid} />
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
  // Lo que ya habia guardado, enmascarado. Sirve para distinguir «no lo ha
  // tocado» de «ha escrito uno nuevo»: sin esto se reenviaria el enmascarado
  // como si fuera el secreto de verdad.
  const [webhookPrevio, setWebhookPrevio] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<Integration>(`/integrations/stripe?projectId=${projectId}`);
      if (res.success) {
        setData(res.data || EMPTY('stripe'));
        const previo = (res.data?.config_public?.webhook_secret_preview as string) || '';
        setWebhookSecret(previo);
        setWebhookPrevio(previo);
      }
    } catch {/* ignore */} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        projectId, provider: 'stripe',
        // Siempre activa: no hay interruptor en pantalla, guardar una clave es
        // querer usarla. Con el valor anterior la fila se quedaba apagada y el
        // sincronizador de Stripe no la encontraba.
        active: true,
        config_public: {
          ...(data?.config_public || {}),
          webhook_url: urlWebhook(projectId),
        },
      };
      if (apiKey.trim()) body.api_key = apiKey.trim();
      // Solo si ha escrito uno nuevo: si sigue el enmascarado, no se toca.
      if (webhookSecret.trim() && webhookSecret.trim() !== webhookPrevio) {
        body.webhook_secret = webhookSecret.trim();
      }
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
          <p className="text-xs text-muted-foreground">Los cobros entran <strong>por consulta</strong>: con el access token guardado, el CRM le pregunta a Stripe cada cinco minutos. Stripe no tiene que avisar de nada.</p>
        </div>
        <StatusPill data={data} />
      </div>

      <div className="p-5 space-y-4">
        <button onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Question size={12} weight="bold" /> {showHelp ? 'Ocultar tutorial' : 'Cómo sacar el access token de Stripe'}
        </button>
        {showHelp && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-3">
            <div>
              <p className="font-semibold mb-1">📋 Resumen — qué hace y qué no</p>
              <ul className="list-disc list-inside space-y-0.5 pl-1 text-muted-foreground">
                <li><strong>Al guardar:</strong> sólo se valida (1 request a <code className="px-1 rounded bg-card">/v1/balance</code>) y se cifra en DB. No baja datos.</li>
                <li><strong>Proyectos IA:</strong> el dashboard hace live fetch de MRR, suscripciones, cobros fallidos.</li>
                <li><strong>Webhook automático de pagos → conversiones:</strong> EN DESARROLLO (necesita endpoint que escuche <code className="px-1 rounded bg-card">checkout.session.completed</code> / <code className="px-1 rounded bg-card">invoice.paid</code>). Por ahora la URL es informativa.</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold mb-1">🔑 Paso 1 — Sacar el access token</p>
              <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground">
                <li>Entra a <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-0.5 hover:underline">dashboard.stripe.com/apikeys <ArrowSquareOut size={10} weight="bold" /></a></li>
                <li><strong>Lo recomendado:</strong> «Create restricted key». Marca <strong>Read</strong> en <em>Charges</em> y en <em>Balance</em>, y deja todo lo demás en <em>None</em>. Sale una <code className="px-1 rounded bg-card">rk_live_…</code>.</li>
                <li><strong>Por qué restringida:</strong> el CRM solo lee. Con la <code className="px-1 rounded bg-card">sk_live_…</code> le das además permiso para cobrar, devolver y transferir, que no usa nunca. <span className="text-red-600 dark:text-red-400 font-semibold">Si se filtra, esa es toda la diferencia.</span></li>
                <li><strong>Para probar:</strong> activa «Modo prueba» arriba a la izquierda y usa la clave de test (<code className="px-1 rounded bg-card">sk_test_…</code>). Ahí no hay dinero de verdad.</li>
                <li>Pégala abajo en <em>Access token</em>, pulsa <strong>Guardar</strong> y luego <strong>Probar conexión</strong>.</li>
              </ol>
            </div>

            <div>
              <p className="font-semibold mb-1">🔔 Paso 2 — Webhook</p>
              <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground">
                <li>En Stripe → <strong>Developers</strong> → <strong>Webhooks</strong> → <strong>"Add endpoint"</strong>.</li>
                <li>URL del endpoint:<br/><code className="px-1 rounded bg-card text-[10px] break-all">{urlWebhook(projectId)}</code>
                  {!projectId && <span className="text-amber-700 dark:text-amber-400"> — elige antes un proyecto: la dirección lleva su número.</span>}</li>
                <li>Eventos a escuchar:{' '}
                  {EVENTOS_DEL_WEBHOOK.map((e, i) => (
                    <span key={e}>{i > 0 && ', '}<code className="px-1 rounded bg-card">{e}</code></span>
                  ))}.</li>
                <li>Copia el <strong>"Signing secret"</strong> (<code className="px-1 rounded bg-card">whsec_…</code>) y pégalo abajo en <em>Webhook Signing Secret</em>.</li>
                <li>Verifica con Stripe CLI antes de poner live: <code className="px-1 rounded bg-card">stripe listen --forward-to {urlWebhook(projectId)}</code></li>
              </ol>
              <p className="mt-1.5 text-[11px]">
                <strong>Sin el secreto configurado el CRM rechaza el webhook</strong>, a propósito: sin
                firma, esa dirección sería un formulario público para inventar cobros. Mientras tanto los
                cobros entran igual por el sondeo, cada 5 minutos.
              </p>
            </div>

            <div>
              <p className="font-semibold mb-1">🔄 Paso 3 — Cómo se cruzan los datos con el CRM</p>
              <ul className="list-disc list-inside space-y-0.5 pl-1 text-muted-foreground">
                <li><strong>Por consulta (lo normal):</strong> cada cinco minutos el CRM pide a Stripe los cargos nuevos con el access token. No hace falta nada más.</li>
                <li><strong>Por webhook (opcional):</strong> Stripe envía el evento → el CRM verifica la firma con el Signing Secret. Solo ahorra la espera.</li>
                <li>Busca el cliente por email en la tabla <code className="px-1 rounded bg-card">leads</code> del proyecto.</li>
                <li>Si existe → crea/actualiza <code className="px-1 rounded bg-card">conversions</code> + <code className="px-1 rounded bg-card">conversion_payments</code>.</li>
                <li>Si no existe → registra el pago como huérfano para que la gestora lo asocie manualmente.</li>
              </ul>
            </div>

            <p className="text-amber-700 dark:text-amber-400 pt-1 border-t border-border/50">
              <strong>⚠ Seguridad:</strong> nunca compartas la <code className="px-1 rounded bg-card">sk_live_…</code> por chat o email. Si se filtra, rotala desde el dashboard de Stripe.
            </p>
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Access token {data?.has_secret && <span className="font-normal text-muted-foreground/80 ml-1">(actualmente: <code className="bg-muted px-1 rounded text-[10px]">{data.secret_preview}</code> — deja vacío para no cambiar)</span>}
          </label>
          {/* CLAVE RESTRINGIDA DE SOLO LECTURA, NO LA SECRETA.

              El CRM solo LEE de Stripe: consulta el saldo para probar la
              conexion y lista cargos para el sondeo. Con una `sk_live_` se le
              esta dando ademas permiso para mover dinero --cobrar, devolver,
              transferir-- que no usa nunca. Si esa clave se filtra, la
              diferencia entre las dos es toda la diferencia. */}
          <p className="text-[11px] text-muted-foreground mb-1.5">
            Usa una <strong>clave restringida de solo lectura</strong> (<code className="px-1 rounded bg-muted">rk_…</code>)
            con permiso de lectura en <em>Charges</em> y <em>Balance</em>. El CRM no cobra ni
            devuelve nada: con la clave secreta le estarías dando permisos que no usa.
          </p>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data?.has_secret ? 'Sin cambios' : 'rk_live_… (recomendado) o sk_test_…'}
              className="w-full h-10 pl-3 pr-10 rounded-md border border-border bg-card text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* EL WEBHOOK ES OPCIONAL, Y CONVIENE QUE LO PAREZCA.

            Se pedia como si fuera un paso obligatorio del alta, y no lo es:
            los cobros entran por el sondeo con solo el access token. El
            webhook unicamente ahorra la espera de cinco minutos.

            Importa porque se puede conectar SIN webhook --sin secreto de firma--.
            Presentarlo como obligatorio dejaba el alta a
            medias en apariencia, y empujaba a publicar un endpoint que sin
            secreto se rechaza igual. Va plegado. */}
        <details className="rounded-md border border-border bg-muted/20 p-3">
          <summary className="text-[11px] font-semibold cursor-pointer select-none">
            Webhook <span className="font-normal text-muted-foreground">— opcional, solo para no esperar los cinco minutos</span>
          </summary>
          <div className="pt-3">
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Secreto de firma del webhook
          </label>
          <input
            value={webhookSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="whsec_..."
            className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Sin este secreto <strong>el webhook se rechaza</strong>: sin el no hay forma de
            saber si un aviso viene de Stripe o de cualquiera que conozca la direccion.
            Mientras falte, los cobros siguen entrando por la sincronizacion, con
            hasta cinco minutos de retraso.
          </p>
          <label className="text-[11px] font-semibold text-muted-foreground mt-3 mb-1 block">
            Direccion que hay que pegar en Stripe
          </label>
          <code className="block w-full px-3 py-2 rounded-md border border-border bg-muted/40 text-xs font-mono break-all">
            {urlWebhook(projectId)}
          </code>
          </div>
        </details>

        <TestStatus data={data} />

        {/* Como va el cron. «Probar conexion» dice que la clave sirve AHORA;
            esto dice si los cobros estan entrando de verdad, que es otra
            pregunta y la que importa cuando no hay webhook. */}
        <EstadoDeLaSincronizacion projectId={projectId} />

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={test} disabled={testing || !data?.has_secret}
            title={!data?.has_secret ? 'Guarda primero el access token' : 'Probar conexión con Stripe'}
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
        // Siempre activa: no hay interruptor en pantalla, guardar una clave es
        // querer usarla. Con el valor anterior la fila se quedaba apagada y el
        // sincronizador de Stripe no la encontraba.
        active: true,
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

// ─── Campus (Moodle) ───────────────────────────────────────────────────────
// Consultas de alumnos (#187): el campus del proyecto. La dirección va en
// config_public.url y el token, cifrado, como las demás claves. Con él, el CRM
// comprueba que el correo de cada tutor es usuario del campus.
function MoodleCard({ projectId }: { projectId: number }) {
  const [data, setData] = useState<Integration | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [token, setToken] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [url, setUrl] = useState('');
  // #188: leer las consultas de los alumnos de este campus.
  const [consultas, setConsultas] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await client.get<Integration>(`/integrations/moodle?projectId=${projectId}`);
      if (res.success) {
        const d = res.data || EMPTY('moodle');
        setData(d);
        setUrl((d.config_public?.url as string) || '');
        setConsultas(String(d.config_public?.consultas) === 'true');
      }
    } catch {/* ignore */} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!url.trim()) {
      toast({ title: 'Falta la dirección del campus', description: 'Escríbela en «Dirección del campus» (por ejemplo, https://iseie.com/campus).', variant: 'destructive' });
      return;
    }
    if (!data?.has_secret && !token.trim()) {
      toast({ title: 'Falta el token', description: 'Pega en «Token del campus» el token del servicio web del Moodle.', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        projectId, provider: 'moodle', active: true,
        config_public: { url: url.trim(), consultas },
      };
      if (token.trim()) body.api_key = token.trim();
      const res = await client.put<Integration>('/integrations', body);
      if (res.success) {
        setData(res.data);
        setUrl((res.data?.config_public?.url as string) || url.trim());
        setToken('');
        toast({ title: 'Campus guardado', description: 'El token queda cifrado. Pulsa «Probar conexión».' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha podido guardar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await client.post<{ ok: boolean; message: string }>(`/integrations/moodle/test?projectId=${projectId}`);
      if (res.success) {
        toast({ title: '✓ Conexión OK', description: res.data?.message });
      } else {
        toast({ title: 'La prueba ha fallado', description: res.data?.message || (res as { error?: string }).error || 'El campus no ha contestado.', variant: 'destructive' });
      }
      await load();
    } catch (e: unknown) {
      const err = e as { data?: { error?: string } };
      toast({ title: 'La prueba ha fallado', description: err?.data?.error || 'Error de red', variant: 'destructive' });
    } finally { setTesting(false); }
  }

  async function clear() {
    if (!confirm('¿Quitar el campus (Moodle) de este proyecto? Se dejará de comprobar a sus tutores.')) return;
    try {
      await client.delete(`/integrations/moodle?projectId=${projectId}`);
      toast({ title: 'Campus quitado' });
      setData(EMPTY('moodle')); setToken(''); setUrl('');
    } catch (e: unknown) {
      const err = e as { message?: string };
      toast({ title: 'No se ha podido quitar', description: err?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
          <GraduationCap size={22} weight="duotone" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base">Campus (Moodle)</h3>
          <p className="text-xs text-muted-foreground">Consultas de alumnos: comprobar que cada tutor es usuario del campus de este proyecto.</p>
        </div>
        <StatusPill data={data} />
      </div>

      <div className="p-5 space-y-4">
        <button onClick={() => setShowHelp((v) => !v)}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Question size={12} weight="bold" /> {showHelp ? 'Ocultar tutorial' : 'Cómo obtener el token del campus'}
        </button>
        {showHelp && (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-2">
            <p className="font-semibold">En el Moodle del campus, con un usuario administrador:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1 text-muted-foreground">
              <li><strong>Administración del sitio → Servidor → Servicios web</strong>: que estén habilitados los servicios web y el protocolo <strong>REST</strong>.</li>
              <li><strong>Servicios externos → Agregar</strong>: un servicio para el CRM, habilitado.</li>
              <li>En ese servicio, <strong>Funciones → Agregar</strong>: <code className="px-1 rounded bg-card">core_webservice_get_site_info</code> y <code className="px-1 rounded bg-card">core_user_get_users_by_field</code>. Solo leen.</li>
              <li><strong>Administrar tokens → Crear token</strong> para ese servicio y cópialo.</li>
              <li>Pega abajo la dirección del campus y el token, guarda y pulsa <strong>«Probar conexión»</strong>.</li>
            </ol>
          </div>
        )}

        <div>
          <label htmlFor={`moodle-url-${projectId}`} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Dirección del campus *</label>
          <input id={`moodle-url-${projectId}`} value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off"
            placeholder="https://iseie.com/campus"
            className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
        </div>

        <div>
          <label htmlFor={`moodle-token-${projectId}`} className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Token del campus * {data?.has_secret && <span className="font-normal text-muted-foreground/80 ml-1">(actualmente: <code className="bg-muted px-1 rounded text-[10px]">{data.secret_preview}</code> — deja vacío para no cambiar)</span>}
          </label>
          <div className="relative">
            <input
              id={`moodle-token-${projectId}`}
              type={showKey ? 'text' : 'password'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              placeholder={data?.has_secret ? 'Sin cambios' : 'El token del servicio web'}
              className="w-full h-10 pl-3 pr-10 rounded-md border border-border bg-card text-sm font-mono"
            />
            <button type="button" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? 'Ocultar el token' : 'Ver el token'}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              {showKey ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="rounded-md border border-border p-3 space-y-1">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" checked={consultas} onChange={(e) => setConsultas(e.target.checked)} />
            Leer las consultas de este campus
          </label>
          <p className="text-xs text-muted-foreground">
            Cada 5 minutos el CRM lee los mensajes que los alumnos escriben a sus tutores en el campus y los pone en «Consultas».
            Solo lo escrito desde que se marca (no el historial). El token tiene que poder leer los mensajes de todos
            (usuario administrador) y su servicio, tener <code>core_message_get_conversations</code> y <code>core_message_get_conversation_messages</code>,
            y para «Alumnos sin mensajes», <code>core_enrol_get_users_courses</code> y <code>core_enrol_get_enrolled_users</code>.
            «Probar conexión» dice si falta alguna.
          </p>
          {consultas && data?.config_public?.consultas_desde && (
            <p className="text-xs text-muted-foreground">Leyendo desde el {fmt(String(data.config_public.consultas_desde))}.</p>
          )}
        </div>

        <TestStatus data={data} />

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={test} disabled={testing || !data?.has_secret}
            title={!data?.has_secret ? 'Guarda primero el token' : 'Probar la conexión con el campus'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <PlugsConnected size={14} weight="bold" /> {testing ? 'Probando…' : 'Probar conexión'}
          </button>
          {data?.has_secret && (
            <button onClick={clear}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-red-300 dark:border-red-900 bg-card text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 ml-auto">
              <Trash size={14} weight="bold" /> Quitar
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
