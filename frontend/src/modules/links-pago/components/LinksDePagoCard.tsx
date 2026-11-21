import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LinkSimple, Plus, Copy, XCircle } from '@phosphor-icons/react';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { SOLO_EN_PRUEBAS } from '@/shared/lib/enPruebas';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import CrearLinkAsistente, { copiarLink as copiar, errorDe } from './CrearLinkAsistente';
import {
  listarLinks, anularLink,
  type LinkDePago, type EstadoLink,
} from '../api/linksPago.api';

/*
  LINKS DE PAGO EN LA FICHA (#680, fase 2).

  En la ficha del prospecto y en la de la venta: los links que se le han
  mandado, del más nuevo al más viejo, y el botón para crear uno. Pago único;
  las cuotas llegan en la fase 4.

  La gestora no configura nada de Stripe: elige curso, importe (dentro del tope
  de descuento del campus), moneda y caducidad. Lo demás lo pone el admin en
  Integraciones › Links de pago. El servidor vuelve a comprobarlo todo.

  Sale si el servidor tiene los links encendidos (`/auth/me`; en producción,
  LINKS_PAGO_EN_PRODUCCION=1) y la persona tiene permiso de links. La etiqueta
  «PRUEBAS» solo en /staging y en local.
*/

export const ESTADOS: Record<EstadoLink, { texto: string; tono: string }> = {
  creado: { texto: 'Pendiente', tono: 'bg-info-soft text-info-soft-foreground' },
  abierto: { texto: 'Abierto', tono: 'bg-info-soft text-info-soft-foreground' },
  pagado: { texto: 'Pagado', tono: 'bg-success-soft text-success-soft-foreground' },
  pagado_parcial: { texto: 'Pagado en parte', tono: 'bg-warning-soft text-warning-soft-foreground' },
  caducado: { texto: 'Caducado', tono: 'bg-muted text-muted-foreground' },
  anulado: { texto: 'Anulado', tono: 'bg-destructive-soft text-destructive-soft-foreground' },
};

export function dinero(n: unknown, moneda: string) {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR' }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${moneda}`;
  }
}

export function cuando(d: string | null) {
  return d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

interface Props {
  projectId?: number | null;
  leadId?: number;
  conversionId?: number;
  /**
   * Ya no se usan (19/11): el asistente lee el curso y lo pendiente de la venta
   * del servidor (`/links-pago/ventas-del-prospecto`). Se aceptan para no romper
   * a quien los pase.
   */
  productoId?: number | null;
  pendiente?: number;
  /** En la ficha de la venta: con su recorrido guiado y «Ver recorrido» (18/11). */
  conRecorrido?: boolean;
}

export default function LinksDePagoCard({ leadId, conversionId, conRecorrido = false }: Props) {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const puedeCrear = can('links_pago.crear');
  const puedeVer = encendidos && (puedeCrear || can('links_pago.ver_todos'));
  const [links, setLinks] = useState<LinkDePago[]>([]);
  const [cargando, setCargando] = useState(true);
  const [creando, setCreando] = useState(false);
  const [anulando, setAnulando] = useState<LinkDePago | null>(null);
  const [anulandoBusy, setAnulandoBusy] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await listarLinks(conversionId ? { conversionId } : { leadId });
      setLinks(r.data || []);
    } catch { /* la ficha sigue sirviendo */ } finally { setCargando(false); }
  }, [leadId, conversionId]);

  useEffect(() => { if (puedeVer) cargar(); }, [cargar, puedeVer]);
  // Un link creado desde la cabecera de la ficha (BotonCrearLink): a la lista.
  useEffect(() => {
    if (!puedeVer) return undefined;
    const alCrear = () => cargar();
    window.addEventListener('links-pago:creado', alCrear);
    return () => window.removeEventListener('links-pago:creado', alCrear);
  }, [cargar, puedeVer]);

  if (!puedeVer) return null;

  async function confirmarAnular(motivo: string) {
    if (!anulando) return;
    setAnulandoBusy(true);
    setErrorAnular(null);
    try {
      await anularLink(anulando.id, motivo);
      toast({ title: 'Link anulado', description: 'Ya no se puede pagar.' });
      setAnulando(null);
      cargar();
    } catch (e) {
      setErrorAnular(errorDe(e));
    } finally { setAnulandoBusy(false); }
  }

  return (
    <div className="bg-card p-5 rounded-lg border border-border" data-recorrido="links-pago">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <LinkSimple size={16} weight="regular" aria-hidden="true" /> Links de pago
          {SOLO_EN_PRUEBAS && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-warning-soft text-warning-soft-foreground">PRUEBAS</span>
          )}
        </h3>
        <span className="flex flex-wrap items-center gap-2">
          {conRecorrido && <VerRecorrido id="link-de-pago" listo={!cargando} compacto />}
          {puedeCrear && (
            <button type="button" onClick={() => setCreando(true)} data-recorrido="links-crear"
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              <Plus size={14} weight="bold" aria-hidden="true" /> Crear link de pago
            </button>
          )}
        </span>
      </div>

      <div data-recorrido="links-lista">
      {cargando && <p className="text-xs text-muted-foreground">Cargando…</p>}
      {!cargando && links.length === 0 && (
        <p className="text-sm text-muted-foreground">Todavía no se le ha mandado ningún link de pago.</p>
      )}
      {!cargando && links.length > 0 && (
        <ul className="divide-y divide-border">
          {links.map((l) => {
            const vivo = l.estado === 'creado' || l.estado === 'abierto';
            const est = ESTADOS[l.estado] || ESTADOS.creado;
            return (
              <li key={l.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${est.tono}`}>{est.texto}</span>
                <span className="font-semibold tabular-nums">{dinero(l.importe, l.moneda)}</span>
                {Number(l.descuento_pct) > 0 && (
                  <span className="text-xs text-muted-foreground">−{Number(l.descuento_pct)} %</span>
                )}
                <span className="text-xs text-muted-foreground truncate max-w-[220px]" title={l.product_nombre || ''}>{l.product_nombre || '—'}</span>
                {!conversionId && (l.conversion_id
                  ? <Link to={`/ventas/${l.conversion_id}`} className="text-xs underline">Venta n.º {l.conversion_id}</Link>
                  : <span className="text-xs text-muted-foreground">sin venta</span>)}
                <span className="text-xs text-muted-foreground basis-full sm:basis-auto">
                  {l.creado_por_nombre || '—'} · {cuando(l.created_at)}
                  {vivo && l.caduca_el && <> · caduca {cuando(l.caduca_el)}</>}
                  {l.estado === 'pagado' && l.pagado_el && <> · pagado {cuando(l.pagado_el)}</>}
                  {l.estado === 'caducado' && l.caduca_el && <> · caducó {cuando(l.caduca_el)} sin pagar</>}
                  {l.estado === 'anulado' && <> · anulado{l.anulado_por_nombre ? ` por ${l.anulado_por_nombre}` : ''}: {l.motivo_anulacion}</>}
                </span>
                <span className="ml-auto flex items-center gap-1.5">
                  {vivo && l.url && (
                    <button type="button" onClick={() => copiar(l.url!)}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
                      <Copy size={13} weight="bold" aria-hidden="true" /> Copiar
                    </button>
                  )}
                  {vivo && (
                    <button type="button" onClick={() => { setErrorAnular(null); setAnulando(l); }}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold text-destructive hover:bg-destructive-soft">
                      <XCircle size={13} weight="bold" aria-hidden="true" /> Anular
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      </div>

      {creando && (
        <CrearLinkAsistente
          leadId={leadId} conversionId={conversionId}
          onClose={() => setCreando(false)}
          onCreado={() => cargar()}
        />
      )}

      <PromptDialog
        open={!!anulando}
        title="Anular el link de pago"
        message="Se desactiva en Stripe y el cliente ya no podrá pagarlo. Queda apuntado quién lo anuló y por qué."
        label="Motivo"
        placeholder="Por ejemplo: se equivocó de curso"
        confirmLabel="Anular link"
        minLength={3}
        maxLength={500}
        error={errorAnular}
        loading={anulandoBusy}
        onConfirm={confirmarAnular}
        onCancel={() => setAnulando(null)}
      />
    </div>
  );
}
