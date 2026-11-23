import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { LinkSimple, Plus, Copy, XCircle, ArrowSquareOut } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import Paginacion from '@/shared/components/ui/Paginacion';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ambitoComoObjeto } from '@/shared/lib/ambitoInforme';
import { useLinksPagoEncendidos } from '@/shared/lib/linksPago';
import CrearLinkAsistente, { copiarLink, errorDe, resumenDelPlan } from '../components/CrearLinkAsistente';
import { DatosDeSeguimiento, BotonRenovar } from '../components/SeguimientoDelLink';
import EnviarLink from '../components/EnviarLink';
import EmbudoLinks from '../components/EmbudoLinks';
import { ESTADOS, dinero, cuando } from '../components/LinksDePagoCard';
import { listarTodos, anularLink, conectarStripe, type LinkDePago, type EstadoLink, type ConectarStripe } from '../api/linksPago.api';
import AvisoConectarStripe, { AvisoCobroAutoApagado } from '../components/AvisoConectarStripe';
// Los links creados directamente en Stripe y sus cobros por vincular (CRM#1019).
import LinksDeStripe from '../components/LinksDeStripe';

/*
  LA PANTALLA «LINKS DE PAGO» (Comercial › Links de pago; Diego, 19/11).

  «No sé cómo hacer los enlaces de pago, tampoco hay una opción en el menú.»
  Hasta hoy un link solo se creaba desde una tarjeta al final de la ficha. Aquí
  están todos los del alcance de quien mira (cada gestora los suyos; con «ver
  todos», los de sus campus), con su estado, el alumno, el programa, la venta a
  la que van, el importe, quién lo creó, cuándo caduca y cuándo se pagó; y el
  botón grande «Crear link de pago», que abre el asistente.
*/

const FILTROS: Array<{ v: EstadoLink | ''; t: string }> = [
  { v: '', t: 'Todos' },
  { v: 'creado', t: 'Pendientes' },
  { v: 'abierto', t: 'Abiertos' },
  { v: 'pagado', t: 'Pagados' },
  { v: 'caducado', t: 'Caducados' },
  { v: 'anulado', t: 'Anulados' },
];

export default function LinksDePagoPage() {
  const { can } = usePermission();
  const encendidos = useLinksPagoEncendidos();
  const { activeProject, activeIssuerId } = useProjectContext();
  // El id y no el objeto: un objeto nuevo en cada pintada volvería a pedir la lista sin fin.
  const proyectoId = activeProject?.id ?? null;
  const puedeCrear = can('links_pago.crear');
  const [estado, setEstado] = useState<EstadoLink | ''>('');
  const [pagina, setPagina] = useState(1);
  const [limite, setLimite] = useState(25);
  const [links, setLinks] = useState<LinkDePago[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Abierto, y cómo sale elegido el pago (los dos atajos, CRM#982).
  const [creando, setCreando] = useState<false | 'unico' | 'cuotas'>(false);
  const [anulando, setAnulando] = useState<LinkDePago | null>(null);
  const [anulandoBusy, setAnulandoBusy] = useState(false);
  const [errorAnular, setErrorAnular] = useState<string | null>(null);
  // CRM#992: los campus del ámbito que no pueden cobrar cuotas solas por su clave de Stripe.
  const [conectar, setConectar] = useState<ConectarStripe | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await listarTodos({
        estado, page: pagina, limit: limite,
        ambito: ambitoComoObjeto({ activeIssuerId: activeIssuerId ?? null, activeProject: { id: proyectoId } }),
      });
      setLinks(r.data || []);
      setTotal(r.pagination?.total ?? (r.data || []).length);
    } catch (e) {
      setError(`No se han podido cargar los links: ${errorDe(e)}`);
    } finally { setCargando(false); }
  }, [estado, pagina, limite, activeIssuerId, proyectoId]);

  useEffect(() => { if (encendidos) cargar(); }, [cargar, encendidos]);

  // El aviso «Conectar Stripe para cobros automáticos» (CRM#992), con el mismo
  // ámbito que la lista. Si no se puede saber, no se dice nada: no es la lista.
  useEffect(() => {
    if (!encendidos) return undefined;
    let vigente = true;
    setConectar(null);
    conectarStripe(ambitoComoObjeto({ activeIssuerId: activeIssuerId ?? null, activeProject: { id: proyectoId } }))
      .then((r) => { if (vigente) setConectar(r.data || null); })
      .catch(() => { if (vigente) setConectar(null); });
    return () => { vigente = false; };
  }, [encendidos, activeIssuerId, proyectoId]);

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

  if (!encendidos) {
    return (
      <div className="space-y-6">
        <PageHeader title="Links de pago" />
        <p className="text-sm text-muted-foreground">Los links de pago no están encendidos en este servidor.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Links de pago"
        subtitle="Elige el curso y si paga de una vez o en cuotas, y manda el link. Al pagarlo, el CRM crea la ficha y la venta solo."
        actions={(
          <span className="flex flex-wrap items-center gap-2">
            <VerRecorrido id="links-pago" listo={!cargando} compacto />
            {puedeCrear && (
              <button type="button" onClick={() => setCreando('unico')} data-recorrido="links-pantalla-crear"
                className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                <Plus size={16} weight="bold" aria-hidden="true" /> Crear link de pago
              </button>
            )}
          </span>
        )}
      />

      {conectar?.activo === false && <AvisoCobroAutoApagado motivo={conectar.motivo} />}
      {conectar?.activo === true && Array.isArray(conectar.campus) && conectar.campus.length > 0 && (
        <AvisoConectarStripe campus={conectar.campus} />
      )}

      {/*
        LOS DOS RECORRIDOS (CRM#982, Diego 21/11: «son dos recorridos, hay que
        hacerlos»): abren el asistente con el pago ya elegido.
      */}
      {puedeCrear && (
        <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="Formas de cobrar con un link">
          <button type="button" onClick={() => setCreando('unico')} data-recorrido="links-pantalla-unico"
            className="text-left rounded-lg border border-border bg-card p-3 hover:bg-muted">
            <span className="block text-sm font-semibold">Pago único, con otro importe o descuento</span>
            <span className="block text-xs text-muted-foreground">Sale el precio del curso: cámbialo o descuenta en € o en %. El link cobra el total.</span>
          </button>
          <button type="button" onClick={() => setCreando('cuotas')} data-recorrido="links-pantalla-inicial"
            className="text-left rounded-lg border border-border bg-card p-3 hover:bg-muted">
            <span className="block text-sm font-semibold">Inicial + cuotas</span>
            <span className="block text-xs text-muted-foreground">El link cobra la inicial y Stripe cobra lo que queda en cuotas iguales, una al mes.</span>
          </button>
        </div>
      )}

      {/* El resumen por gestora y por campus (CRM#987). */}
      <EmbudoLinks ambito={ambitoComoObjeto({ activeIssuerId: activeIssuerId ?? null, activeProject: { id: proyectoId } })} />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado" data-recorrido="links-pantalla-filtros">
        {FILTROS.map((f) => (
          <button key={f.v || 'todos'} type="button" onClick={() => { setEstado(f.v); setPagina(1); }}
            aria-pressed={estado === f.v}
            className={`h-8 px-3 rounded-full text-xs font-semibold border ${estado === f.v ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}>
            {f.t}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="text-sm rounded-md border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground px-3 py-2">{error}</p>}

      <div className="bg-card rounded-lg border border-border" data-recorrido="links-pantalla-lista">
        {cargando && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
        {!cargando && links.length === 0 && !error && (
          <div className="p-8 text-center space-y-3">
            <LinkSimple size={28} className="mx-auto text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {estado ? 'No hay links con ese estado.' : 'Todavía no se ha creado ningún link de pago.'}
            </p>
            {puedeCrear && !estado && (
              <button type="button" onClick={() => setCreando('unico')}
                className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
                <Plus size={14} weight="bold" aria-hidden="true" /> Crear el primero
              </button>
            )}
          </div>
        )}
        {!cargando && links.length > 0 && (
          <ul className="divide-y divide-border">
            {links.map((l) => {
              const vivo = l.estado === 'creado' || l.estado === 'abierto';
              const est = ESTADOS[l.estado] || ESTADOS.creado;
              return (
                <li key={l.id} className="p-3 sm:px-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-link-id={l.id}>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${est.tono}`}>{est.texto}</span>
                  <span className="font-semibold tabular-nums">
                    {dinero(l.importe, l.moneda)}
                    {/* Con descuento (CRM#982), el precio de antes, tachado. */}
                    {l.descuento_tipo && Number(l.descuento_importe) > 0 && l.precio_original != null && (
                      <s className="font-normal text-xs text-muted-foreground ml-1" title="Precio antes del descuento">{dinero(l.precio_original, l.moneda)}</s>
                    )}
                    {l.modalidad === 'cuotas' && l.num_cuotas
                      ? <span className="font-normal text-xs text-muted-foreground">
                        {l.importe_inicial != null ? ` · ${resumenDelPlan(l)}` : ` en ${l.num_cuotas} cuotas (${dinero(l.importe_cuota, l.moneda)} con el link)`}
                      </span>
                      : null}
                  </span>
                  {/* Un link sin prospecto (20/11): al pagarse, el CRM le pone el prospecto y la venta que crea. */}
                  {l.lead_id
                    ? <Link to={`/leads/${l.lead_id}`} className="font-medium underline-offset-2 hover:underline truncate max-w-[200px]">{l.lead_nombre || `Prospecto ${l.lead_id}`}</Link>
                    : <span className="text-muted-foreground italic">Sin prospecto todavía</span>}
                  <span className="text-xs text-muted-foreground truncate max-w-[240px]" title={l.product_nombre || ''}>{l.product_nombre || '—'}</span>
                  {l.conversion_id
                    ? <Link to={`/ventas/${l.conversion_id}`} className="text-xs underline" title={l.venta_producto_nombre || ''}>Venta n.º {l.conversion_id}</Link>
                    : <span className="text-xs text-muted-foreground">{l.estado === 'creado' || l.estado === 'abierto' ? 'la venta se crea al pagar' : 'sin venta'}</span>}
                  <span className="text-xs text-muted-foreground basis-full sm:basis-auto">
                    {l.project_nombre ? `${l.project_nombre} · ` : ''}{l.creado_por_nombre || '—'} · {cuando(l.created_at)}
                    {vivo && l.caduca_el && <> · caduca {cuando(l.caduca_el)}</>}
                    {l.estado === 'pagado' && l.pagado_el && <> · pagado {cuando(l.pagado_el)}</>}
                    {l.estado === 'caducado' && l.caduca_el && <> · caducó {cuando(l.caduca_el)}</>}
                    {l.estado === 'anulado' && <> · anulado: {l.motivo_anulacion}</>}
                  </span>
                  <DatosDeSeguimiento link={l} />
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    {vivo && l.url && (
                      <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[240px]" title={l.url}>{l.url.replace(/^https?:\/\//, '')}</span>
                    )}
                    <BotonRenovar link={l} onRenovado={() => cargar()} />
                    <EnviarLink link={l} />
                    {vivo && l.url && (
                      <>
                        <button type="button" onClick={() => copiarLink(l.url!)}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
                          <Copy size={13} weight="bold" aria-hidden="true" /> Copiar
                        </button>
                        <a href={l.url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
                          <ArrowSquareOut size={13} weight="bold" aria-hidden="true" /> Abrir
                        </a>
                        <button type="button" onClick={() => { setErrorAnular(null); setAnulando(l); }}
                          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold text-destructive hover:bg-destructive-soft">
                          <XCircle size={13} weight="bold" aria-hidden="true" /> Anular
                        </button>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {total > limite && (
        <Paginacion pagina={pagina} limite={limite} total={total} onPagina={setPagina}
          onLimite={(n) => { setLimite(n); setPagina(1); }} unidad="links" />
      )}

      {/* ─── CRM#1019: los links creados directamente en Stripe y sus cobros por vincular ─── */}
      <LinksDeStripe ambito={ambitoComoObjeto({ activeIssuerId: activeIssuerId ?? null, activeProject: { id: proyectoId } })} />
      {/* ─── fin CRM#1019 ─── */}

      {creando && (
        <CrearLinkAsistente formaInicial={creando} onClose={() => setCreando(false)} onCreado={() => cargar()} />
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
