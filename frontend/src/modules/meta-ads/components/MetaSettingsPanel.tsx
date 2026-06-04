import { useState } from 'react';
import { Key, ArrowsClockwise, Plugs, Warning, CheckCircle, Info, ArrowSquareOut, Copy, Eye, EyeSlash } from '@phosphor-icons/react';
import { metaApi, MetaAccount } from '../api/metaAds.api';
import { toast } from '@/shared/hooks/useToast';

interface Props {
  projectId: number;
  account: MetaAccount;
  onChanged: () => void;
  onDisconnect: () => void;
}

// Submenú "Configuración" del módulo Meta Ads.
// Permite rotar el access_token sin perder datos, ver metadatos de la cuenta,
// re-conectar a OTRA cuenta (con confirmación de borrado de datos), o desconectar.
export default function MetaSettingsPanel({ projectId, account, onChanged, onDisconnect }: Props) {
  const [section, setSection] = useState<'token' | 'cuenta' | 'avanzado'>('token');

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-bold tracking-tight">Configuración Meta Ads</h3>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Gestiona el token, cambia de cuenta o desconecta. Todos los cambios se hacen aquí — el token nunca se edita en SSH ni en DB directamente.
        </p>
      </div>

      <div className="px-4 pt-3 flex gap-1 border-b border-border">
        <TabBtn active={section === 'token'} onClick={() => setSection('token')} icon={Key}>Token</TabBtn>
        <TabBtn active={section === 'cuenta'} onClick={() => setSection('cuenta')} icon={Info}>Cuenta</TabBtn>
        <TabBtn active={section === 'avanzado'} onClick={() => setSection('avanzado')} icon={Plugs}>Avanzado</TabBtn>
      </div>

      <div className="p-4">
        {section === 'token' && <TokenSection projectId={projectId} account={account} onChanged={onChanged} />}
        {section === 'cuenta' && <AccountInfoSection account={account} />}
        {section === 'avanzado' && <AdvancedSection projectId={projectId} account={account} onDisconnect={onDisconnect} onChanged={onChanged} />}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, children }: any) {
  return (
    <button onClick={onClick}
      className={`px-3 py-2 text-xs font-semibold rounded-t-md border-b-2 flex items-center gap-1.5 transition-colors ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}>
      <Icon size={13} weight="duotone" /> {children}
    </button>
  );
}

// ────────────────────────────────────────────────────────────
// Sección: rotar token

function TokenSection({ projectId, account, onChanged }: { projectId: number; account: MetaAccount; onChanged: () => void }) {
  const [newToken, setNewToken] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleRotate() {
    if (!newToken || newToken.length < 20) {
      toast({ title: 'Token vacío o demasiado corto', variant: 'destructive' });
      return;
    }
    if (!confirm(`Rotar el token de "${account.ad_account_nombre || account.ad_account_id}"?\n\nEl token antiguo dejará de funcionar (revócalo manualmente en Meta después). Los datos sincronizados se mantienen.`)) return;
    setSaving(true);
    try {
      await metaApi.updateToken({ project_id: projectId, access_token: newToken.trim() });
      toast({ title: 'Token rotado', description: 'El nuevo token está activo. Revoca el antiguo en Business Manager.' });
      setNewToken('');
      onChanged();
    } catch (err: any) {
      toast({ title: 'No se pudo rotar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded p-3 text-xs flex gap-2">
        <Warning size={14} className="text-amber-600 flex-shrink-0 mt-0.5" weight="duotone" />
        <div>
          <p className="font-semibold mb-0.5">¿Cuándo rotar el token?</p>
          <ul className="list-disc ml-4 space-y-0.5 text-amber-900 dark:text-amber-200">
            <li>Si el token se filtró (chat, screenshot, log).</li>
            <li>Si Meta avisa de caducidad / actividad sospechosa.</li>
            <li>Cuando rotas las credenciales del System User en Business Manager.</li>
          </ul>
        </div>
      </div>

      <details className="border border-border rounded-lg">
        <summary className="px-3 py-2 cursor-pointer text-xs font-semibold flex items-center gap-2">
          <Info size={13} weight="duotone" className="text-blue-600" />
          Generar token nuevo en Business Manager (pasos)
        </summary>
        <ol className="list-decimal ml-8 mr-4 my-3 text-xs space-y-1 leading-relaxed">
          <li>Entra a <a href="https://business.facebook.com/settings/system-users" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">Business Manager → Usuarios del sistema <ArrowSquareOut size={10} /></a>.</li>
          <li>Selecciona el System User existente (el que ya conectaste).</li>
          <li>Pulsa <strong>Generar token nuevo</strong>, elige la misma app, marca permisos: <code className="bg-muted px-1 rounded">ads_read</code> + <code className="bg-muted px-1 rounded">business_management</code>, caducidad <strong>Nunca</strong>.</li>
          <li>Copia el token, pégalo aquí abajo y pulsa <strong>Rotar</strong>.</li>
          <li>Cuando confirmes que el nuevo funciona, vuelve a Business Manager y <strong>revoca el token antiguo</strong> (botón "Revocar" junto al token viejo en la lista).</li>
        </ol>
      </details>

      <div>
        <label className="text-xs font-semibold text-muted-foreground mb-1 block">Nuevo Access Token</label>
        <div className="relative">
          <textarea
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            rows={3}
            placeholder="EAAxxxxxxxxxxxxxxxxxxxxxx…"
            className="w-full px-3 py-2 pr-10 rounded-md border border-border bg-card text-xs font-mono resize-none"
            style={{ WebkitTextSecurity: show ? 'none' : 'disc' } as React.CSSProperties}
          />
          <button type="button" onClick={() => setShow(!show)}
            className="absolute top-2 right-2 text-muted-foreground hover:text-foreground" title={show ? 'Ocultar' : 'Mostrar'}>
            {show ? <EyeSlash size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">
          Se valida contra Meta antes de guardarse. La cuenta de anuncios (<code className="bg-muted px-1 rounded">{account.ad_account_id}</code>) no cambia.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-border">
        <button onClick={handleRotate} disabled={saving || !newToken}
          className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-1.5">
          <ArrowsClockwise size={14} weight="bold" className={saving ? 'animate-spin' : ''} />
          {saving ? 'Validando con Meta…' : 'Rotar token'}
        </button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sección: datos de la cuenta (solo lectura)

function AccountInfoSection({ account }: { account: MetaAccount }) {
  function copy(v?: string | null) {
    if (!v) return;
    navigator.clipboard.writeText(v).then(() => toast({ title: 'Copiado' }));
  }
  const rows: Array<[string, string | null | undefined, boolean]> = [
    ['Ad Account ID', account.ad_account_id, true],
    ['Nombre', account.ad_account_nombre, false],
    ['Moneda', account.currency, false],
    ['Zona horaria', account.timezone_name, false],
    ['Último sync', account.last_synced_at ? new Date(account.last_synced_at).toLocaleString('es-ES') : '—', false],
    ['Estado último sync', account.last_sync_status || '—', false],
    ['Backfill 90d', account.backfill_done ? 'Completado' : 'Pendiente / en progreso', false],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([label, value, copyable]) => (
        <div key={label} className="flex items-center justify-between gap-3 py-2 border-b border-border last:border-0">
          <span className="text-xs font-semibold text-muted-foreground">{label}</span>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono truncate max-w-xs" title={value || ''}>{value || '—'}</span>
            {copyable && value && (
              <button onClick={() => copy(value)} className="text-muted-foreground hover:text-foreground" title="Copiar">
                <Copy size={12} />
              </button>
            )}
          </div>
        </div>
      ))}
      {account.last_sync_error && (
        <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded p-3 text-xs mt-3">
          <Warning size={13} className="inline mr-1 text-red-600" weight="duotone" />
          <span className="font-semibold">Último error:</span> {account.last_sync_error}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Sección: avanzado — reconectar a otra cuenta, desconectar todo

function AdvancedSection({ projectId, account, onDisconnect, onChanged }: { projectId: number; account: MetaAccount; onDisconnect: () => void; onChanged: () => void }) {
  const [reconnectOpen, setReconnectOpen] = useState(false);
  const [newAdAccount, setNewAdAccount] = useState('');
  const [newToken, setNewToken] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleReconnect() {
    if (!newAdAccount.match(/^act_\d+$/)) {
      toast({ title: 'Ad Account ID inválido (act_XXXX)', variant: 'destructive' });
      return;
    }
    if (!newToken || newToken.length < 20) {
      toast({ title: 'Token requerido', variant: 'destructive' });
      return;
    }
    if (!confirm(`Cambiar la cuenta conectada de "${account.ad_account_id}" a "${newAdAccount}"?\n\nSe borrarán todas las campañas/métricas/asociaciones de la cuenta actual y arrancará un backfill nuevo de 90d.`)) return;
    setSaving(true);
    try {
      // Disconnect explícito borra todo, luego connect crea desde cero
      await metaApi.disconnect(projectId);
      await metaApi.connect({ project_id: projectId, ad_account_id: newAdAccount.trim(), access_token: newToken.trim() });
      toast({ title: 'Cuenta cambiada', description: 'Backfill de 90 días iniciado en background.' });
      setReconnectOpen(false);
      setNewAdAccount(''); setNewToken('');
      onChanged();
    } catch (err: any) {
      toast({ title: 'No se pudo reconectar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="border border-border rounded-lg p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Cambiar a otra cuenta de anuncios</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Útil si te equivocaste de cuenta o quieres asociar este proyecto a otra. <strong>Borra todos los datos actuales</strong> y arranca un backfill nuevo.
            </p>
          </div>
          <button onClick={() => setReconnectOpen(!reconnectOpen)}
            className="h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted flex-shrink-0">
            {reconnectOpen ? 'Cancelar' : 'Cambiar cuenta'}
          </button>
        </div>
        {reconnectOpen && (
          <div className="mt-3 pt-3 border-t border-border space-y-3">
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Nuevo Ad Account ID</label>
              <input value={newAdAccount} onChange={(e) => setNewAdAccount(e.target.value.trim())}
                placeholder="act_1234567890"
                className="w-full h-9 px-2 rounded-md border border-border bg-card text-xs font-mono" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Token para la nueva cuenta</label>
              <textarea value={newToken} onChange={(e) => setNewToken(e.target.value)} rows={2}
                placeholder="EAAxxx…"
                className="w-full px-2 py-1.5 rounded-md border border-border bg-card text-xs font-mono resize-none" />
            </div>
            <div className="flex justify-end">
              <button onClick={handleReconnect} disabled={saving}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50">
                {saving ? 'Cambiando…' : 'Borrar actual y conectar nueva'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="border border-red-200 dark:border-red-900 rounded-lg p-3 bg-red-50/40 dark:bg-red-950/10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-red-700 dark:text-red-300">Desconectar completamente</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Borra credenciales, campañas, métricas diarias y asociaciones. La cuenta sigue activa en Meta — solo eliminamos el vínculo desde el CRM.
            </p>
          </div>
          <button onClick={onDisconnect}
            className="h-8 px-3 rounded-md border border-red-300 dark:border-red-800 bg-card text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 flex-shrink-0">
            Desconectar
          </button>
        </div>
      </div>
    </div>
  );
}
