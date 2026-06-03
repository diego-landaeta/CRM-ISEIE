import { useState } from 'react';
import { CheckCircle, Warning, Info, ArrowSquareOut } from '@phosphor-icons/react';
import { metaApi } from '../api/metaAds.api';
import { toast } from '@/shared/hooks/useToast';

interface Props {
  projectId: number;
  projectName?: string;
  onConnected?: () => void;
}

export default function ConnectWizard({ projectId, projectName, onConnected }: Props) {
  const [adAccountId, setAdAccountId] = useState('');
  const [token, setToken] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; data?: any; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleConnect() {
    if (!adAccountId.match(/^act_\d+$/)) {
      toast({ title: 'Ad Account ID inválido', description: 'Formato: act_XXXXXXXXXX', variant: 'destructive' });
      return;
    }
    if (!token || token.length < 20) {
      toast({ title: 'Token requerido', variant: 'destructive' });
      return;
    }
    setSaving(true);
    setTestResult(null);
    try {
      const res = await metaApi.connect({ project_id: projectId, ad_account_id: adAccountId.trim(), access_token: token.trim() });
      const data = (res as any)?.data;
      toast({ title: 'Cuenta conectada', description: `${data?.ad_account_nombre || adAccountId} — backfill 90 días iniciado en background` });
      onConnected?.();
    } catch (err: any) {
      toast({ title: 'No se pudo conectar', description: err?.data?.error || err?.message || 'Error', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Conectar Meta Ads</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Para extraer métricas de campañas de Facebook/Instagram del proyecto <strong>{projectName || `#${projectId}`}</strong>.
          Solo lectura — el CRM nunca pausa, modifica ni crea anuncios.
        </p>
      </div>

      <details className="border border-border rounded-lg" open>
        <summary className="px-4 py-3 cursor-pointer text-sm font-semibold flex items-center gap-2">
          <Info size={16} weight="duotone" className="text-blue-600" />
          ¿Cómo obtener el Access Token y el Ad Account ID? (paso a paso)
        </summary>
        <div className="px-4 pb-4 text-sm space-y-3 border-t border-border pt-3 leading-relaxed">
          <div>
            <p className="font-semibold mb-1">1. Encuentra tu Ad Account ID</p>
            <p>Entra a <a href="https://business.facebook.com/adsmanager/" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Administrador de Anuncios <ArrowSquareOut size={11} /></a>. En la barra de arriba verás el ID con formato <code className="bg-muted px-1.5 py-0.5 rounded text-xs">act_XXXXXXXXXX</code>. Cópialo entero (con el prefijo <code>act_</code>).</p>
          </div>
          <div>
            <p className="font-semibold mb-1">2. Genera un Token de Usuario del Sistema (no caduca)</p>
            <ol className="list-decimal ml-5 space-y-1">
              <li>Entra a <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Business Manager → Usuarios del sistema <ArrowSquareOut size={11} /></a>.</li>
              <li>Pulsa <strong>Añadir</strong>, crea uno con rol <strong>Administrador</strong> o <strong>Empleado</strong>.</li>
              <li>Asigna la cuenta de anuncios (la del paso 1) al usuario del sistema con permisos <strong>Gestionar cuenta de anuncios</strong>.</li>
              <li>Pulsa <strong>Generar token nuevo</strong>. Selecciona tu app (o usa la app por defecto del Business Manager). Marca los permisos:
                <ul className="list-disc ml-5 mt-1">
                  <li><code className="bg-muted px-1 rounded">ads_read</code></li>
                  <li><code className="bg-muted px-1 rounded">read_insights</code></li>
                  <li><code className="bg-muted px-1 rounded">business_management</code></li>
                </ul>
              </li>
              <li>Selecciona <strong>Caducidad: Nunca</strong>. Pulsa <strong>Generar</strong> y copia el token (no se vuelve a mostrar).</li>
            </ol>
          </div>
          <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-3 text-xs">
            <Warning size={14} className="inline mr-1 text-amber-600" />
            El token es sensible: se guarda <strong>cifrado AES-256</strong> en la base de datos. Solo admin/superadmin puede acceder a esta pantalla.
          </div>
        </div>
      </details>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Ad Account ID *</label>
          <input
            value={adAccountId}
            onChange={(e) => setAdAccountId(e.target.value.trim())}
            placeholder="act_1234567890"
            className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-muted-foreground mb-1 block">Access Token (System User, sin caducidad) *</label>
          <textarea
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            placeholder="EAAxxxxxxxxxxxxxxxxxxxxxx..."
            className="w-full px-3 py-2 rounded-md border border-border bg-card text-sm font-mono resize-none"
          />
        </div>
      </div>

      {testResult && (
        <div className={`rounded-md p-3 text-sm ${testResult.ok ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-red-800 dark:text-red-300'}`}>
          {testResult.ok ? (
            <>
              <CheckCircle size={16} weight="duotone" className="inline mr-1.5" />
              Conexión OK · {testResult.data?.nombre} · {testResult.data?.currency}
            </>
          ) : (
            <>
              <Warning size={16} weight="duotone" className="inline mr-1.5" />
              {testResult.error}
            </>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <button
          onClick={handleConnect}
          disabled={saving || testing || !adAccountId || !token}
          className="h-10 px-5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? 'Conectando…' : 'Conectar y empezar backfill (90 días)'}
        </button>
      </div>
    </div>
  );
}
