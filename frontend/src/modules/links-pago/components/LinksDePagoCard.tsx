import { useCallback, useEffect, useMemo, useState } from 'react';
import { LinkSimple, Plus, Copy, XCircle, CheckCircle } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import Portal from '@/shared/components/ui/portal';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { SOLO_EN_PRUEBAS } from '@/shared/lib/enPruebas';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import {
  listarLinks, crearLink, anularLink, verConfig,
  type LinkDePago, type ConfigLinks, type EstadoLink,
} from '../api/linksPago.api';

/*
  LINKS DE PAGO EN LA FICHA (CRM#680, fase 2).

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

const ESTADOS: Record<EstadoLink, { texto: string; tono: string }> = {
  creado: { texto: 'Pendiente', tono: 'bg-info-soft text-info-soft-foreground' },
  abierto: { texto: 'Abierto', tono: 'bg-info-soft text-info-soft-foreground' },
  pagado: { texto: 'Pagado', tono: 'bg-success-soft text-success-soft-foreground' },
  pagado_parcial: { texto: 'Pagado en parte', tono: 'bg-warning-soft text-warning-soft-foreground' },
  caducado: { texto: 'Caducado', tono: 'bg-muted text-muted-foreground' },
  anulado: { texto: 'Anulado', tono: 'bg-destructive-soft text-destructive-soft-foreground' },
};

function dinero(n: unknown, moneda: string) {
  try {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR' }).format(Number(n || 0));
  } catch {
    return `${Number(n || 0).toFixed(2)} ${moneda}`;
  }
}

function cuando(d: string | null) {
  return d ? new Date(d).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' }) : '—';
}

function errorDe(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red';
}

async function copiar(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast({ title: 'Link copiado', description: 'Pégalo en WhatsApp o en un correo.' });
  } catch {
    toast({ title: 'No se ha podido copiar', description: url, variant: 'destructive' });
  }
}

interface Props {
  projectId: number;
  leadId?: number;
  conversionId?: number;
  /** El curso que sale elegido al abrir (el del prospecto o el de la venta). */
  productoId?: number | null;
  /**
   * Desde una venta: lo que queda por cobrar, en euros. Es el importe sugerido y
   * contra lo que se mide el tope de descuento, como en el servidor (fase 3).
   */
  pendiente?: number;
  /** En la ficha de la venta: con su recorrido guiado y «Ver recorrido» (18/11). */
  conRecorrido?: boolean;
}

export default function LinksDePagoCard({ projectId, leadId, conversionId, productoId, pendiente, conRecorrido = false }: Props) {
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
        <CrearLinkDialog
          projectId={projectId} leadId={leadId} conversionId={conversionId} productoId={productoId}
          pendiente={pendiente}
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

interface Curso { id: number; nombre: string; precio: string | number | null; moneda: string | null }

function CrearLinkDialog({ projectId, leadId, conversionId, productoId, pendiente, onClose, onCreado }: Props & {
  onClose: () => void; onCreado: () => void;
}) {
  const { can } = usePermission();
  const esAdmin = can('links_pago.configurar');
  const [cfg, setCfg] = useState<ConfigLinks | null>(null);
  const [cursos, setCursos] = useState<Curso[]>([]);
  const [cursoId, setCursoId] = useState<string>(productoId ? String(productoId) : '');
  const [importe, setImporte] = useState('');
  const [moneda, setMoneda] = useState('');
  const [dias, setDias] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<LinkDePago | null>(null);

  useEffect(() => {
    let vigente = true;
    verConfig(projectId).then((r) => {
      if (!vigente || !r.data) return;
      setCfg(r.data);
      setMoneda(r.data.moneda_defecto);
      setDias(String(r.data.caducidad_dias));
    }).catch((e) => setError(errorDe(e)));
    client.get<Curso[]>('/products', { params: { projectId, limit: 500 } })
      .then((r) => { if (vigente) setCursos(r.data || []); })
      .catch(() => {});
    return () => { vigente = false; };
  }, [projectId]);

  const curso = useMemo(() => cursos.find((c) => String(c.id) === cursoId) || null, [cursos, cursoId]);

  const desdeVenta = pendiente !== undefined;
  // Importe sugerido (editable): desde una venta, lo pendiente; si no, el precio
  // del catálogo del curso elegido.
  useEffect(() => {
    if (pendiente !== undefined) { if (pendiente > 0) setImporte(String(pendiente)); return; }
    if (curso?.precio != null && Number(curso.precio) > 0) setImporte(String(Number(curso.precio)));
  }, [curso, pendiente]);

  const precio = curso?.precio != null && Number(curso.precio) > 0
    && (!curso.moneda || curso.moneda.toUpperCase() === moneda) ? Number(curso.precio) : null;
  // Contra qué se mide el descuento: lo pendiente de la venta (en euros) o el catálogo.
  const referencia = pendiente !== undefined ? (moneda === 'EUR' && pendiente > 0 ? pendiente : null) : precio;
  const n = Number(importe.replace(',', '.'));
  const descuento = referencia && n > 0 ? Math.max(0, Math.round(((referencia - n) / referencia) * 10000) / 100) : 0;
  const pasaDelTope = !esAdmin && cfg && referencia != null && descuento > cfg.descuento_max_pct;
  const sinPrecio = !esAdmin && curso && referencia == null;

  async function enviar() {
    if (!curso || !(n > 0)) { setError('Elige el curso y escribe el importe.'); return; }
    setEnviando(true);
    setError(null);
    try {
      const r = await crearLink({
        ...(conversionId ? { conversionId } : { leadId }),
        productId: curso.id, importe: n, moneda, caducidad_dias: Number(dias),
      });
      if (r.data) { setHecho(r.data); onCreado(); }
    } catch (e) {
      setError(errorDe(e));
    } finally { setEnviando(false); }
  }

  const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm';

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={enviando ? undefined : onClose} />
        <div role="dialog" aria-modal="true" aria-labelledby="crear-link-titulo"
          className="relative bg-card sm:rounded-lg border border-border w-full max-w-md flex flex-col max-h-[100dvh] overflow-y-auto">
          <div className="px-5 py-4 border-b border-border flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
              <LinkSimple size={18} weight="regular" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="crear-link-titulo" className="font-semibold text-base">Crear link de pago</h3>
              <p className="text-xs text-muted-foreground">Pago único, de la cuenta de Stripe de este campus.</p>
            </div>
          </div>

          {hecho ? (
            <div className="p-5 space-y-3">
              <p className="text-sm flex items-center gap-1.5 font-semibold text-success-soft-foreground">
                <CheckCircle size={16} weight="fill" aria-hidden="true" /> Link creado
              </p>
              <p className="text-sm">
                {dinero(hecho.importe, hecho.moneda)} · caduca {cuando(hecho.caduca_el)}
              </p>
              <div className="flex gap-2">
                <input readOnly value={hecho.url || ''} aria-label="Link de pago" className={`${campo} font-mono text-xs`} onFocus={(e) => e.target.select()} />
                <button type="button" onClick={() => hecho.url && copiar(hecho.url)}
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                  <Copy size={14} weight="bold" aria-hidden="true" /> Copiar
                </button>
              </div>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              <div>
                <label htmlFor="link-curso" className="text-xs text-muted-foreground mb-1 block">Curso</label>
                <select id="link-curso" value={cursoId} onChange={(e) => setCursoId(e.target.value)} className={campo}>
                  <option value="">Elige un curso…</option>
                  {cursos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}{c.precio != null && Number(c.precio) > 0 ? ` — ${dinero(c.precio, c.moneda || 'EUR')}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="link-importe" className="text-xs text-muted-foreground mb-1 block">Importe</label>
                  <input id="link-importe" type="text" inputMode="decimal" value={importe}
                    onChange={(e) => setImporte(e.target.value)} className={`${campo} tabular-nums`} />
                </div>
                <div>
                  <label htmlFor="link-moneda" className="text-xs text-muted-foreground mb-1 block">Moneda</label>
                  <select id="link-moneda" value={moneda} onChange={(e) => setMoneda(e.target.value)} className={campo}
                    disabled={!cfg || cfg.monedas.length < 2}>
                    {(cfg?.monedas || []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="link-dias" className="text-xs text-muted-foreground mb-1 block">
                  Caduca a los (días){cfg ? ` · máximo ${cfg.caducidad_max_dias}` : ''}
                </label>
                <input id="link-dias" type="number" min={1} max={cfg?.caducidad_max_dias} value={dias}
                  onChange={(e) => setDias(e.target.value)} className={`${campo} w-28 tabular-nums`} />
              </div>
              {referencia != null && descuento > 0 && (
                <p className={`text-xs ${pasaDelTope ? 'text-destructive-soft-foreground' : 'text-muted-foreground'}`}>
                  Un {descuento} % menos que {desdeVenta ? 'lo pendiente de la venta' : 'el catálogo'} ({dinero(referencia, moneda)}).
                  {cfg && !esAdmin && ` El máximo en este campus es un ${cfg.descuento_max_pct} %.`}
                </p>
              )}
              {sinPrecio && (
                <p className="text-xs text-destructive-soft-foreground">
                  {!desdeVenta && `Este curso no tiene precio en el catálogo en ${moneda}: el link lo tiene que crear un admin.`}
                  {desdeVenta && moneda !== 'EUR' && `Lo pendiente de la venta está en EUR: un link en ${moneda} lo tiene que crear un admin.`}
                  {desdeVenta && moneda === 'EUR' && 'Esta venta no tiene nada pendiente de cobro: el link lo tiene que crear un admin.'}
                </p>
              )}
              {error && <p role="alert" className="text-xs text-destructive-soft-foreground">{error}</p>}
            </div>
          )}

          <div className="flex justify-end gap-2 p-4 border-t border-border bg-muted/20">
            <button type="button" onClick={onClose} disabled={enviando}
              className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50">
              {hecho ? 'Cerrar' : 'Cancelar'}
            </button>
            {!hecho && (
              <button type="button" onClick={enviar} disabled={enviando || !curso || !(n > 0) || !!pasaDelTope || !!sinPrecio || !cfg}
                className="inline-flex items-center h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
                {enviando ? 'Creando…' : 'Crear link'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
