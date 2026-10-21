import { Fragment, useCallback, useEffect, useState } from 'react';
import { ArrowClockwise, PaperPlaneTilt, CaretDown, CaretRight } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';
import { toast } from '@/shared/hooks/useToast';
import { lista } from '@/shared/lib/lista';
import { cn } from '@/shared/lib/utils';
import {
  webhooksSalientesApi, type EnvioWebhook, type EstadoEnvio, type WebhookSaliente,
} from '../api/webhooksSalientes.api';

/**
 * Los últimos envíos: a qué webhook, qué cobro, cómo acabó, con qué código y
 * cuántos intentos. Uno fallido se puede reenviar (con su misma clave, así que
 * quien recibe no lo cuenta dos veces si en realidad le llegó).
 */

const ESTADOS: Record<EstadoEnvio, { texto: string; clase: string }> = {
  enviado: { texto: 'Enviado', clase: 'bg-success-soft text-success-soft-foreground' },
  pendiente: { texto: 'Reintentará', clase: 'bg-warning-soft text-warning-soft-foreground' },
  enviando: { texto: 'Enviando', clase: 'bg-info-soft text-info-soft-foreground' },
  fallido: { texto: 'Fallido', clase: 'bg-destructive-soft text-destructive-soft-foreground' },
};

const fecha = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  : '—');

interface Props {
  webhooks: WebhookSaliente[];
  /** Cambia cuando hay que releer (una prueba, un webhook nuevo…). */
  version: number;
  /** El webhook elegido desde su tarjeta («Ver envíos»). */
  webhookId: number | null;
  onWebhookId: (id: number | null) => void;
  /** El ámbito elegido arriba: solo los envíos de esa empresa o ese campus (21/10). */
  projectId?: number | null;
  issuerId?: number | null;
}

export default function RegistroEnvios({ webhooks, version, webhookId, onWebhookId, projectId = null, issuerId = null }: Props) {
  const [envios, setEnvios] = useState<EnvioWebhook[]>([]);
  const [estado, setEstado] = useState<EstadoEnvio | ''>('');
  const [cargando, setCargando] = useState(false);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [reenviando, setReenviando] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await webhooksSalientesApi.envios({ webhookId, estado, limit: 50, projectId, issuerId });
      if (r.success) setEnvios(lista<EnvioWebhook>(r.data));
    } catch (e: any) {
      toast({ title: 'No se pudo cargar el registro', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [webhookId, estado, projectId, issuerId]);

  useEffect(() => { cargar(); }, [cargar, version]);

  async function reenviar(e: EnvioWebhook) {
    setReenviando(e.id);
    try {
      const r = await webhooksSalientesApi.reenviar(e.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      const nuevo = r.data as EnvioWebhook;
      toast(nuevo?.estado === 'enviado'
        ? { title: 'Reenviado', description: `El destino contestó ${nuevo.http_status}.` }
        : { title: 'Sigue sin entrar', description: nuevo?.error || 'Se volverá a intentar.', variant: 'destructive' });
      cargar();
    } catch (err: any) {
      toast({ title: 'No se pudo reenviar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setReenviando(null); }
  }

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Últimos envíos</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-56">
            <Select<string>
              size="sm"
              value={webhookId ? String(webhookId) : ''}
              onChange={(v) => onWebhookId(v ? Number(v) : null)}
              options={[{ value: '', label: 'Todos los webhooks' }, ...webhooks.map((w) => ({ value: String(w.id), label: w.nombre }))]}
              ariaLabel="Webhook"
            />
          </div>
          <div className="w-40">
            <Select<EstadoEnvio | ''>
              size="sm"
              value={estado}
              onChange={setEstado}
              options={[{ value: '', label: 'Cualquier estado' },
                ...(Object.keys(ESTADOS) as EstadoEnvio[]).map((k) => ({ value: k, label: ESTADOS[k].texto }))]}
              ariaLabel="Estado"
            />
          </div>
          <button type="button" onClick={cargar} disabled={cargando} title="Actualizar"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-bold hover:bg-muted disabled:opacity-50">
            <ArrowClockwise size={14} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!envios.length ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          {cargando ? 'Cargando…' : 'Todavía no hay envíos. Saldrán aquí en cuanto se apunte un cobro por transferencia o depósito, o al pulsar «Enviar prueba».'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-left text-muted-foreground">
              <tr>
                <th className="w-6 px-2 py-2" />
                <th className="px-2 py-2 font-semibold">Cuándo</th>
                <th className="px-2 py-2 font-semibold">Webhook</th>
                <th className="px-2 py-2 font-semibold">Evento</th>
                <th className="px-2 py-2 font-semibold">Cobro</th>
                <th className="px-2 py-2 font-semibold">Estado</th>
                <th className="px-2 py-2 font-semibold">HTTP</th>
                <th className="px-2 py-2 font-semibold">Intentos</th>
                <th className="px-2 py-2 font-semibold">Detalle</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {envios.map((e) => {
                const est = ESTADOS[e.estado] || ESTADOS.pendiente;
                const desplegado = abierto === e.id;
                return (
                  <Fragment key={e.id}>
                    <tr className="border-t border-border align-top">
                      <td className="px-2 py-2">
                        <button type="button" onClick={() => setAbierto(desplegado ? null : e.id)}
                          aria-label={desplegado ? 'Ocultar el payload' : 'Ver el payload'} aria-expanded={desplegado}
                          className="text-muted-foreground hover:text-foreground">
                          {desplegado ? <CaretDown size={12} /> : <CaretRight size={12} />}
                        </button>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fecha(e.created_at)}</td>
                      <td className="px-2 py-2">{e.webhook_nombre || `#${e.webhook_id}`}</td>
                      <td className="px-2 py-2 whitespace-nowrap font-mono">
                        {e.evento}
                        {e.prueba && (
                          <span className="ml-1.5 rounded bg-info-soft px-1.5 py-0.5 font-sans text-[10px] font-semibold text-info-soft-foreground">prueba</span>
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{e.payment_id ? `#${e.payment_id}` : '—'}</td>
                      <td className="px-2 py-2">
                        <span className={cn('whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold', est.clase)}>{est.texto}</span>
                        {e.estado === 'pendiente' && e.proximo_intento_at && (
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">a las {fecha(e.proximo_intento_at)}</span>
                        )}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{e.http_status ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{e.intentos}</td>
                      <td className="max-w-[18rem] px-2 py-2">
                        <span className="line-clamp-2 break-words text-muted-foreground" title={e.error || e.respuesta || ''}>
                          {e.error || e.respuesta || (e.enviado_at ? `Entregado ${fecha(e.enviado_at)}` : '—')}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {e.estado === 'fallido' && (
                          <button type="button" onClick={() => reenviar(e)} disabled={reenviando === e.id}
                            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted disabled:opacity-50">
                            <PaperPlaneTilt size={12} /> {reenviando === e.id ? 'Reenviando…' : 'Reenviar'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {desplegado && (
                      <tr className="border-t border-border bg-muted/30">
                        <td colSpan={10} className="px-3 py-2">
                          <p className="mb-1 text-[10px] text-muted-foreground">
                            Clave de idempotencia: <code>{e.idempotency_key}</code>
                            {e.reenviado_at && ` · reenviado ${fecha(e.reenviado_at)}${e.reenviado_por_nombre ? ` por ${e.reenviado_por_nombre}` : ''}`}
                          </p>
                          <pre className="max-h-72 overflow-auto rounded bg-background p-2 text-[11px] leading-snug">
                            {JSON.stringify(e.payload, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
