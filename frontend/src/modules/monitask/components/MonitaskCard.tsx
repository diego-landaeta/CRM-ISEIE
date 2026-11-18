import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import {
  Timer, Eye, EyeSlash, FloppyDisk, PlugsConnected, Trash, ArrowsClockwise, Question, CheckCircle, WarningCircle, Copy,
} from '@phosphor-icons/react';
import { monitaskApi, errorDe, type EstadoMonitask } from '../api/monitask.api';

// La etiqueta «PRUEBAS» (en ISEIE no hay componente compartido para esto).
const EtiquetaEnPruebas = () => <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning-soft-foreground">PRUEBAS</span>;

/*
  MONITASK EN INTEGRACIONES (#236).

  Es de todo el CRM, no de un campus: la cuenta de Monitask es una. Por eso va
  fuera de las tarjetas del campus elegido. Solo sale si el servidor tiene
  MONITASK_ACTIVO encendido (si no, /monitask/estado contesta 404) y a quien
  puede configurarla.

  Pasos: pegar el Client ID y el Client Secret de la aplicación de Monitask
  (el secreto se cifra), guardar y pulsar «Conectar con Monitask». Monitask
  pregunta si se da permiso y vuelve aquí con ?monitask=conectado.
*/

const MOTIVOS: Record<string, string> = {
  sin_estado: 'Monitask no devolvió la comprobación de la petición.',
  estado_no_valido: 'La vuelta no corresponde a un «Conectar» de este CRM (o ya se usó). Pulsa otra vez «Conectar con Monitask».',
  caducado: 'Pasaron más de 10 minutos desde que pulsaste «Conectar». Vuelve a pulsarlo.',
  denegado: 'En Monitask no se dio el permiso.',
  sin_codigo: 'Monitask no mandó el código de acceso.',
  token: 'Monitask no dio el acceso: revisa el Client Secret y que la «Redirect Uri» de la aplicación sea exactamente la de abajo.',
  error: 'Algo falló al completar la conexión.',
};

function fmt(d: string | null): string {
  if (!d) return 'Nunca';
  return new Date(d).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function MonitaskCard() {
  const { can } = usePermission();
  const [estado, setEstado] = useState<EstadoMonitask | null>(null);
  const [clientId, setClientId] = useState('');
  const [secreto, setSecreto] = useState('');
  const [margen, setMargen] = useState('10');
  const [verSecreto, setVerSecreto] = useState(false);
  const [ayuda, setAyuda] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'guardar' | 'conectar' | 'sync' | 'quitar'>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await monitaskApi.estado();
      const e = r.data || null;
      setEstado(e);
      if (e) {
        setClientId(e.client_id || '');
        setMargen(String(e.margen_pct ?? 10));
      }
      return e;
    } catch {
      setEstado(null);   // apagado o sin permiso: la tarjeta no sale
      return null;
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  // La vuelta del OAuth: ?monitask=conectado|error&motivo=…
  useEffect(() => {
    const qs = new URLSearchParams(window.location.search);
    const r = qs.get('monitask');
    if (!r) return;
    if (r === 'conectado') toast({ title: 'Monitask conectado', description: 'Se está trayendo el último mes de horas y actividad.' });
    else toast({ title: 'No se pudo conectar Monitask', description: MOTIVOS[qs.get('motivo') || 'error'] || MOTIVOS.error, variant: 'destructive' });
    qs.delete('monitask'); qs.delete('motivo');
    const limpia = `${window.location.pathname}${qs.toString() ? `?${qs}` : ''}`;
    window.history.replaceState(null, '', limpia);
  }, []);

  // Mientras sincroniza, se mira cada pocos segundos cómo va.
  useEffect(() => {
    if (!estado?.sincronizando) return undefined;
    const t = setInterval(() => { cargar(); }, 4000);
    return () => clearInterval(t);
  }, [estado?.sincronizando, cargar]);

  if (!estado?.activo || !can('monitask.configurar')) return null;

  async function guardar() {
    setOcupado('guardar');
    try {
      const body: { client_id: string; client_secret?: string; margen_pct?: number } = { client_id: clientId.trim() };
      if (secreto.trim()) body.client_secret = secreto.trim();
      const m = Number(margen.replace(',', '.'));
      if (Number.isFinite(m)) body.margen_pct = m;
      const r = await monitaskApi.guardar(body);
      setEstado(r.data || null);
      setSecreto('');
      toast({ title: 'Monitask guardado', description: 'El secreto queda cifrado en la base.' });
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(null); }
  }

  async function conectar() {
    setOcupado('conectar');
    try {
      const r = await monitaskApi.autorizar();
      if (r.data?.url) window.location.assign(r.data.url);
    } catch (e) {
      toast({ title: 'No se pudo empezar la conexión', description: errorDe(e), variant: 'destructive' });
      setOcupado(null);
    }
  }

  async function sincronizar() {
    setOcupado('sync');
    try {
      const r = await monitaskApi.sincronizar();
      toast({ title: 'Sincronizando con Monitask', description: `Del ${r.data?.desde} al ${r.data?.hasta}. Tarda unos segundos por persona.` });
      await cargar();
    } catch (e) {
      toast({ title: 'No se pudo sincronizar', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(null); }
  }

  async function quitar(todo: boolean) {
    const pregunta = todo
      ? '¿Borrar la aplicación de Monitask y la conexión? Las horas ya traídas se quedan.'
      : '¿Desconectar Monitask? Habrá que volver a pulsar «Conectar» para seguir trayendo horas.';
    if (!confirm(pregunta)) return;
    setOcupado('quitar');
    try {
      const r = await monitaskApi.desconectar(todo);
      setEstado(r.data || null);
      if (todo) { setClientId(''); setSecreto(''); }
      toast({ title: todo ? 'Monitask eliminado' : 'Monitask desconectado' });
    } catch (e) {
      toast({ title: 'Error', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(null); }
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); toast({ title: 'Copiado' }); } catch { /* sin portapapeles */ }
  }

  const s = estado.ultima_sync;
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-info-soft text-info-soft-foreground flex items-center justify-center flex-shrink-0">
          <Timer size={22} weight="duotone" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-base flex items-center gap-2">Monitask <EtiquetaEnPruebas /></h3>
          <p className="text-xs text-muted-foreground">
            Para todo el CRM, no por campus. Cada noche trae las horas, el % de actividad, los proyectos y las tareas
            de cada persona (nunca las capturas) y las coteja con las facturas de colaboradores.
            Se ven en <Link to="/equipo/actividad" className="text-primary hover:underline">Equipo › Actividad</Link>.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${estado.conectada ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground'}`}>
          {estado.conectada ? <CheckCircle size={12} weight="bold" /> : <WarningCircle size={12} weight="bold" />}
          {estado.conectada ? 'Conectado' : 'Sin conectar'}
        </span>
      </div>

      <div className="p-5 space-y-4">
        <button onClick={() => setAyuda((v) => !v)} className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline">
          <Question size={12} weight="bold" /> {ayuda ? 'Ocultar los pasos' : 'Cómo se conecta'}
        </button>
        {ayuda && (
          <ol className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1 list-decimal list-inside text-muted-foreground">
            <li>En <strong>app.monitask.com/developer</strong>, en la aplicación de este CRM, pon como <strong>Redirect Uri</strong> exactamente la dirección de abajo.</li>
            <li>Que tenga marcados, como mínimo, los scopes <strong>ExternalApi</strong> y <strong>offline_access</strong>.</li>
            <li>Pega aquí su <strong>Client ID</strong> y su <strong>Client Secret</strong> y pulsa <strong>Guardar</strong>.</li>
            <li>Pulsa <strong>Conectar con Monitask</strong> con el usuario <strong>administrador</strong> de la cuenta de Monitask y acepta.</li>
            <li>Al volver se trae el último mes. Después, en <strong>Equipo › Actividad › Personas</strong>, revisa quién es quién.</li>
          </ol>
        )}

        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1">Redirect Uri (para la aplicación de Monitask)</p>
          {estado.redirect_uri ? (
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2 py-1.5 rounded bg-muted text-xs break-all">{estado.redirect_uri}</code>
              <button onClick={() => copiar(estado.redirect_uri || '')} title="Copiar"
                className="p-1.5 rounded border border-border hover:bg-muted"><Copy size={14} /></button>
            </div>
          ) : (
            <p className="text-xs text-destructive">Falta CRM_BASE_URL en el servidor: sin ella no se sabe a dónde vuelve Monitask.</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2">
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Client ID *</label>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm font-mono" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Margen del cotejo (%)</label>
            <input value={margen} onChange={(e) => setMargen(e.target.value)} inputMode="decimal"
              className="w-full h-10 px-3 rounded-md border border-border bg-card text-sm" />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">
            Client Secret {estado.tiene_secreto && (
              <span className="font-normal ml-1">(guardado, termina en <code className="bg-muted px-1 rounded text-[10px]">{estado.secreto_cola}</code> — deja vacío para no cambiarlo)</span>
            )}
          </label>
          <div className="relative">
            <input type={verSecreto ? 'text' : 'password'} value={secreto} onChange={(e) => setSecreto(e.target.value)}
              placeholder={estado.tiene_secreto ? 'Sin cambios' : 'El secreto de la aplicación (se ve una sola vez en Monitask)'}
              className="w-full h-10 pl-3 pr-10 rounded-md border border-border bg-card text-sm font-mono" />
            <button type="button" onClick={() => setVerSecreto((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground">
              {verSecreto ? <EyeSlash size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground space-y-1">
          {estado.conectada && (
            <p>Conectado {estado.conectada_at ? `el ${fmt(estado.conectada_at)}` : ''}{estado.conectada_por ? ` por ${estado.conectada_por}` : ''}.
              {estado.renueva_sola ? ' El acceso se renueva solo.' : ' Sin renovación: habrá que volver a conectar cuando caduque.'}</p>
          )}
          <p>Última sincronización: {estado.sincronizando ? 'en marcha…' : fmt(estado.ultima_sync_at)}
            {s && !estado.sincronizando && s.personas !== undefined && ` · ${s.personas} personas, ${s.dias} días${s.avisos ? `, ${s.avisos} avisos` : ''}`}
            {s?.sin_actividad && ' · Monitask no dio el % de actividad'}</p>
          {estado.ultimo_error && (
            <p className="text-destructive">Último error ({fmt(estado.ultimo_error_at)}): {estado.ultimo_error}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
          <button onClick={guardar} disabled={!!ocupado || !clientId.trim() || (!estado.tiene_secreto && !secreto.trim())}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
            <FloppyDisk size={14} weight="bold" /> {ocupado === 'guardar' ? 'Guardando…' : 'Guardar'}
          </button>
          <button onClick={conectar} disabled={!!ocupado || !estado.client_id || !estado.tiene_secreto || !estado.redirect_uri}
            title={!estado.tiene_secreto ? 'Guarda primero el Client ID y el secreto' : 'Ir a Monitask a dar permiso'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <PlugsConnected size={14} weight="bold" /> {estado.conectada ? 'Volver a conectar' : 'Conectar con Monitask'}
          </button>
          <button onClick={sincronizar} disabled={!!ocupado || !estado.conectada || estado.sincronizando}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <ArrowsClockwise size={14} weight="bold" /> {estado.sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
          {estado.conectada && (
            <button onClick={() => quitar(false)} disabled={!!ocupado}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50 ml-auto">
              Desconectar
            </button>
          )}
          {(estado.client_id || estado.tiene_secreto) && (
            <button onClick={() => quitar(true)} disabled={!!ocupado}
              className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-destructive/30 bg-card text-sm font-semibold text-destructive hover:bg-destructive-soft ${estado.conectada ? '' : 'ml-auto'}`}>
              <Trash size={14} weight="bold" /> Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
