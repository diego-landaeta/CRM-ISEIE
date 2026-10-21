import { useCallback, useEffect, useState } from 'react';
import {
  Plus, ArrowClockwise, Trash, PencilSimple, PaperPlaneTilt, Bank, XCircle, Copy, Key, ListBullets, WarningCircle,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';
import { lista } from '@/shared/lib/lista';
import { copyToClipboard } from '@/shared/lib/clipboard';
import {
  webhooksSalientesApi, METODOS_WEBHOOK,
  type WebhookSaliente, type EnvioWebhook, type CampusConEmpresa,
} from '../api/webhooksSalientes.api';
import DialogoWebhook from '../components/DialogoWebhook';
import RegistroEnvios from '../components/RegistroEnvios';
import EjemploPayload from '../components/EjemploPayload';

/**
 * Conexión → «Webhook de transferencias» (Diego, 15/10; migración 206).
 *
 * «Necesito que creemos como un webhook, que se debe configurar cuando hacen
 * pago por transferencias, que debe enviar ciertos datos a un webhook. Es como
 * tener un apartado en Conexión para enviar esos datos ÚNICAMENTE CUANDO SE
 * PONGA DATOS POR TRANSFERENCIA BANCARIA / DEPÓSITO BANCARIO».
 *
 * Es lo contrario de Conectores: allí el CRM va a buscar datos fuera; aquí el
 * CRM avisa a fuera. Y lo contrario de Webhooks de Captación: allí alguien de
 * fuera empuja al CRM.
 *
 * Solo super admin y admin (lo corta el servidor). Un admin ve y gestiona los de
 * sus campus y los de una empresa en la que está entera; el de todas las
 * empresas, solo el super admin.
 */

const nombreMetodo = (m: string) => METODOS_WEBHOOK.find((x) => x.id === m)?.label || m;

function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return d < 31 ? `hace ${d} día${d > 1 ? 's' : ''}` : `hace ${Math.floor(d / 30)} meses`;
}

/** De quién es: todas las empresas, una empresa entera o un campus. */
function ParaQuien({ w }: { w: WebhookSaliente }) {
  if (w.ambito === 'todas') {
    return <span className="whitespace-nowrap rounded bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info-soft-foreground">Todas las empresas</span>;
  }
  if (w.ambito === 'empresa') {
    return <span className="whitespace-nowrap rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success-soft-foreground">Toda {w.empresa || 'la empresa'}</span>;
  }
  return <span className="whitespace-nowrap rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{w.proyecto || 'Un campus'}</span>;
}

/** El secreto recién creado: se enseña aquí una vez y no vuelve. */
function SecretoUnaVez({ nombre, secreto, onCerrar }: { nombre: string; secreto: string; onCerrar: () => void }) {
  return (
    <div role="status" className="space-y-2 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p className="flex items-center gap-2 font-semibold"><Key size={15} /> Secreto de «{nombre}»: cópialo ahora</p>
      <p className="text-xs">
        No se vuelve a enseñar. Pégalo en el sistema que recibe para comprobar la cabecera <code>X-CRM-Firma</code>.
        Si lo pierdes, edita el webhook y genera otro.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">{secreto}</code>
        <button type="button"
          onClick={async () => toast({ title: (await copyToClipboard(secreto)) ? 'Secreto copiado' : 'No se pudo copiar' })}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
          <Copy size={14} /> Copiar
        </button>
        <button type="button" onClick={onCerrar}
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
          Ya lo he guardado
        </button>
      </div>
    </div>
  );
}

export default function WebhookTransferenciasPage() {
  const { activeProject, activeIssuerId, activeIssuer, isAllProjects } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuerId: number | null;
    activeIssuer: { nombre?: string } | null;
    isAllProjects: boolean;
  };
  const { user, projects } = useAuth() as { user: { role?: string } | null; projects: CampusConEmpresa[] };
  const conEmpresa = Boolean(activeIssuerId);
  const projectId = !conEmpresa && !isAllProjects && activeProject?.id && activeProject.id !== TODOS_LOS_PROYECTOS
    ? activeProject.id : null;
  const esSuperadmin = user?.role === 'superadmin';

  const [webhooks, setWebhooks] = useState<WebhookSaliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `undefined` = cerrado; `null` = alta; un webhook = cambio.
  const [editando, setEditando] = useState<WebhookSaliente | null | undefined>(undefined);
  const [secretoNuevo, setSecretoNuevo] = useState<{ nombre: string; secreto: string } | null>(null);
  const [probando, setProbando] = useState<number | null>(null);
  const [versionRegistro, setVersionRegistro] = useState(0);
  const [verEnviosDe, setVerEnviosDe] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await webhooksSalientesApi.listar(
        ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject: projectId ? { id: projectId } : null }),
      );
      if (r.success) setWebhooks(lista<WebhookSaliente>(r.data));
      else setError(r.error || 'No se pudieron cargar los webhooks');
    } catch (e: any) {
      setError(e?.data?.error || e?.message || 'No se pudieron cargar los webhooks');
    } finally { setCargando(false); }
  }, [activeIssuerId, projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function probar(w: WebhookSaliente) {
    setProbando(w.id);
    try {
      const r = await webhooksSalientesApi.probar(w.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      const e = r.data as EnvioWebhook;
      toast(e?.estado === 'enviado'
        ? { title: 'Prueba entregada', description: `El destino contestó ${e.http_status}.` }
        : { title: 'La prueba no entró', description: e?.error || 'Mira el registro de envíos.', variant: 'destructive' });
      setVerEnviosDe(w.id);
      setVersionRegistro((v) => v + 1);
      cargar();
    } catch (err: any) {
      toast({ title: 'No se pudo enviar la prueba', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setProbando(null); }
  }

  async function borrar(w: WebhookSaliente) {
    if (!window.confirm(`Se va a borrar el webhook «${w.nombre}» y su registro de envíos. Los cobros no se tocan. ¿Seguir?`)) return;
    try {
      const r = await webhooksSalientesApi.borrar(w.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      toast({ title: 'Webhook borrado' });
      if (verEnviosDe === w.id) setVerEnviosDe(null);
      cargar();
      setVersionRegistro((v) => v + 1);
    } catch (e: any) {
      toast({ title: 'No se pudo borrar', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  async function encender(w: WebhookSaliente) {
    try {
      const r = await webhooksSalientesApi.cambiar(w.id, { activo: !w.activo });
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      toast({ title: w.activo ? 'Webhook apagado' : 'Webhook encendido' });
      cargar();
    } catch (e: any) {
      toast({ title: 'No se pudo cambiar', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  // De quién se está mirando, dicho como lo dice la pantalla.
  const deQuien = conEmpresa
    ? `toda la empresa ${activeIssuer?.nombre || ''}`.trim()
    : projectId ? `${activeProject?.nombre || 'este campus'} (y de su empresa)` : 'todas las empresas';
  const hostDe = (u: string) => { try { return new URL(u).hostname; } catch { return u; } };

  const botonNuevo = (
    <button type="button" onClick={() => setEditando(null)}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
      <Plus size={15} weight="bold" /> Nuevo webhook
    </button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Webhook de transferencias"
        subtitle={`Avisa a otro sistema cuando se apunta un cobro por transferencia o depósito bancario · ${conEmpresa
          ? activeIssuer?.nombre || 'Empresa'
          : projectId ? activeProject?.nombre || '' : 'Todos los proyectos'}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={cargar} disabled={cargando}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold hover:bg-muted disabled:opacity-50">
              <ArrowClockwise size={15} className={cargando ? 'animate-spin' : ''} /> Actualizar
            </button>
            {botonNuevo}
          </div>
        }
      />

      <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        Sale <strong>solo</strong> cuando se apunta un cobro con forma de pago <strong>transferencia bancaria</strong> o
        {' '}<strong>depósito bancario</strong>: al dar de alta una venta con su primer pago, al registrar un abono, al
        marcar una proforma como cobrada, al cobrar una cuota o al cambiar una cuota cobrada a una de esas dos formas.
        Con tarjeta, Stripe, efectivo, Bizum o PayPal no se envía nada. Una venta con forma de pago transferencia pero
        sin nada pagado tampoco avisa: avisará el cobro cuando llegue.
      </p>

      {/* Diego, 19/10: «pon que se vea claro ese webhook». De un vistazo: de quién se mira,
          si ahora mismo se avisa a alguien y a quién. */}
      {!cargando && !error && (
        webhooks.some((w) => w.activo) ? (
          <div className="rounded-md border border-success/40 bg-success-soft p-3 text-sm text-success-soft-foreground" role="status">
            <p className="font-semibold">
              Las transferencias y depósitos de {deQuien} se avisan a {webhooks.filter((w) => w.activo).length === 1 ? 'este destino' : 'estos destinos'}:
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {webhooks.filter((w) => w.activo).map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-1.5">
                  <ParaQuien w={w} /> <span className="font-semibold">{w.nombre}</span>
                  <span className="font-mono opacity-80">→ {hostDe(w.url)}</span>
                  <span className="opacity-80">· último envío {hace(w.ultimo_envio_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground" role="status">
            <p>
              <strong>Ahora mismo no se avisa a nadie</strong> de las transferencias y depósitos de {deQuien}
              {webhooks.length ? ' (hay webhooks, pero están apagados)' : ''}. Pulsa «Nuevo webhook» y pon la dirección que debe recibirlos.
            </p>
            {botonNuevo}
          </div>
        )
      )}

      {secretoNuevo && (
        <SecretoUnaVez nombre={secretoNuevo.nombre} secreto={secretoNuevo.secreto} onCerrar={() => setSecretoNuevo(null)} />
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
          <XCircle size={16} weight="fill" className="shrink-0" /> {error}
        </div>
      )}

      {cargando && !webhooks.length ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : !webhooks.length ? (
        <EmptyState
          icon={Bank}
          title="Todavía no hay ningún webhook de transferencias"
          description="Un webhook manda los datos del cobro —importe, cliente, venta, campus, empresa y cuenta de destino— a la dirección que digas (Make, tu contabilidad, otro programa) cada vez que alguien apunta una transferencia o un depósito."
          action={botonNuevo}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {webhooks.map((w) => (
            <div key={w.id} className="space-y-3 rounded-md border border-border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Bank size={18} weight="duotone" className="text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-semibold">{w.nombre}</h3>
                    <ParaQuien w={w} />
                    {!w.activo && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Apagado</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={w.url}>{w.url}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Se envía con: {w.metodos.map(nombreMetodo).join(' y ')}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/80">
                    Secreto …{w.secreto_cola || '????'}
                    {w.creado_por_nombre ? ` · creado por ${w.creado_por_nombre}` : ''}
                    {` · último envío ${hace(w.ultimo_envio_at)}`}
                  </p>
                  {w.fallidos_30_dias > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-warning-soft-foreground">
                      <WarningCircle size={12} weight="fill" /> {w.fallidos_30_dias} fallido{w.fallidos_30_dias > 1 ? 's' : ''} en 30 días
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" title="Editar" aria-label="Editar" onClick={() => setEditando(w)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                    <PencilSimple size={15} />
                  </button>
                  <button type="button" title="Borrar" aria-label="Borrar" onClick={() => borrar(w)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <Trash size={15} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-border pt-2">
                <button type="button" onClick={() => encender(w)}
                  className="inline-flex h-7 items-center rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted">
                  {w.activo ? 'Apagar' : 'Encender'}
                </button>
                <button type="button" onClick={() => setVerEnviosDe(w.id)}
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted">
                  <ListBullets size={12} /> Ver envíos
                </button>
                <button type="button" onClick={() => probar(w)} disabled={probando === w.id}
                  className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  <PaperPlaneTilt size={12} /> {probando === w.id ? 'Enviando…' : 'Enviar prueba'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {webhooks.length > 0 && (
        <RegistroEnvios
          webhooks={webhooks}
          version={versionRegistro}
          webhookId={verEnviosDe}
          onWebhookId={setVerEnviosDe}
          projectId={projectId}
          issuerId={conEmpresa ? activeIssuerId : null}
        />
      )}

      <EjemploPayload />

      {editando !== undefined && (
        <DialogoWebhook
          webhook={editando}
          projectId={projectId}
          issuerId={activeIssuerId}
          proyectos={projects || []}
          esSuperadmin={esSuperadmin}
          onCerrar={() => setEditando(undefined)}
          onGuardado={(w) => {
            setEditando(undefined);
            if (w?.secreto) setSecretoNuevo({ nombre: w.nombre, secreto: w.secreto });
            cargar();
          }}
        />
      )}
    </div>
  );
}
