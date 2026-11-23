import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowsClockwise, ArrowSquareOut, Copy, MagnifyingGlass, StripeLogo, WarningCircle } from '@phosphor-icons/react';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { copiarLink, errorDe } from './CrearLinkAsistente';
import { dinero, cuando } from './LinksDePagoCard';
import {
  listarLinksDeStripe, traerDeStripe, cobrosPorVincular, buscarVentasParaVincular, vincularCobro,
  type LinkDeStripe, type CobroPorVincular, type CandidataDeVenta,
} from '../api/linksDeStripe.api';

/*
  LOS LINKS CREADOS DIRECTAMENTE EN STRIPE (CRM-ISEIE#688, gemela de CRM#1019).

  Diego, 23/11/2026: «sí, crea la tarea para recoger los links de Stripe». Un
  link hecho a mano en el panel de Stripe sale aquí como «Creado en Stripe», con
  lo que cobra, la moneda, si está activo y si admite códigos promocionales.
  Cuando se paga, el CRM busca a quién es por el correo (o el móvil) y lo apunta
  en su venta; si no lo sabe, el cobro queda abajo, en «Cobros de Stripe por
  vincular», para elegir la venta a mano.

  Solo con «Ver los links de todos» (`links_pago.ver_todos`) y en sus campus.
*/

// Las rutas de la ficha y de la venta en este CRM.
const RUTA_PROSPECTO = (id: number) => `/leads/${id}`;
const RUTA_VENTA = (id: number) => `/ventas/${id}`;

type Ambito = { projectId?: number; issuerId?: number };

export default function LinksDeStripe({ ambito }: { ambito: Ambito }) {
  const { can } = usePermission();
  const puede = can('links_pago.ver_todos');
  const projectId = ambito.projectId ?? null;
  const issuerId = ambito.issuerId ?? null;
  const [links, setLinks] = useState<LinkDeStripe[]>([]);
  const [cobros, setCobros] = useState<CobroPorVincular[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);
  const [vinculando, setVinculando] = useState<{ cobro: CobroPorVincular; venta: CandidataDeVenta } | null>(null);
  const [vinculandoBusy, setVinculandoBusy] = useState(false);

  const cargar = useCallback(async () => {
    const a: Ambito = { ...(projectId ? { projectId } : {}), ...(issuerId ? { issuerId } : {}) };
    setCargando(true);
    setError(null);
    try {
      const [l, c] = await Promise.all([listarLinksDeStripe(a), cobrosPorVincular(a)]);
      setLinks(l.data || []);
      setCobros(c.data || []);
    } catch (e) {
      setError(`No se han podido cargar los links de Stripe: ${errorDe(e)}`);
    } finally { setCargando(false); }
  }, [projectId, issuerId]);

  useEffect(() => { if (puede) cargar(); }, [cargar, puede]);

  if (!puede) return null;

  async function traer() {
    if (!projectId) return;
    setTrayendo(true);
    try {
      const r = await traerDeStripe(projectId);
      const d = r.data;
      toast({
        title: 'Links de Stripe al día',
        description: `${d?.links ?? 0} link${d?.links === 1 ? '' : 's'} (${d?.nuevos ?? 0} nuevo${d?.nuevos === 1 ? '' : 's'})${d?.cobros ? ` y ${d.cobros} cobro${d.cobros === 1 ? '' : 's'} recogido${d.cobros === 1 ? '' : 's'}` : ''}.`,
      });
      cargar();
    } catch (e) {
      toast({ title: 'No se han podido traer los links de Stripe', description: errorDe(e), variant: 'destructive' });
    } finally { setTrayendo(false); }
  }

  async function confirmarVincular() {
    if (!vinculando?.venta.conversion_id) return;
    setVinculandoBusy(true);
    try {
      await vincularCobro(vinculando.cobro.id, vinculando.venta.conversion_id);
      toast({ title: 'Cobro vinculado', description: `Apuntado en la venta n.º ${vinculando.venta.conversion_id}. Queda en la cola de facturación.` });
      setVinculando(null);
      cargar();
    } catch (e) {
      toast({ title: 'No se ha podido vincular', description: errorDe(e), variant: 'destructive' });
    } finally { setVinculandoBusy(false); }
  }

  return (
    <div className="space-y-4" data-recorrido="links-pantalla-stripe">
      {/* ─── Cobros de Stripe por vincular ─── */}
      {cobros.length > 0 && (
        <section aria-labelledby="cobros-por-vincular" className="bg-card rounded-lg border border-warning/50">
          <header className="p-3 sm:px-4 flex flex-wrap items-center gap-2 border-b border-border">
            <WarningCircle size={18} className="text-warning" aria-hidden="true" />
            <h2 id="cobros-por-vincular" className="text-sm font-semibold">Cobros de Stripe por vincular ({cobros.length})</h2>
            <p className="basis-full text-xs text-muted-foreground">
              Se pagaron con un link creado en Stripe y el CRM no sabe a qué venta van. Elige la venta: el cobro se apunta en ella (si ya estaba apuntado, se engancha sin sumarlo otra vez).
            </p>
          </header>
          <ul className="divide-y divide-border">
            {cobros.map((c) => (
              <CobroPendiente key={c.id} cobro={c} onElegir={(venta) => setVinculando({ cobro: c, venta })} />
            ))}
          </ul>
        </section>
      )}

      {/* ─── Creados en Stripe ─── */}
      <section aria-labelledby="links-creados-en-stripe" className="bg-card rounded-lg border border-border">
        <header className="p-3 sm:px-4 flex flex-wrap items-center gap-2 border-b border-border">
          <StripeLogo size={18} className="text-muted-foreground" aria-hidden="true" />
          <h2 id="links-creados-en-stripe" className="text-sm font-semibold">Creados en Stripe{links.length ? ` (${links.length})` : ''}</h2>
          <button type="button" onClick={traer} disabled={!projectId || trayendo}
            title={projectId ? 'Leer ahora los links de la cuenta de Stripe de este campus' : 'Elige un campus arriba para traer sus links'}
            className="ml-auto inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
            <ArrowsClockwise size={13} weight="bold" aria-hidden="true" className={trayendo ? 'animate-spin' : ''} />
            {trayendo ? 'Trayendo…' : 'Traer de Stripe'}
          </button>
          <p className="basis-full text-xs text-muted-foreground">
            Los links hechos a mano en el panel de Stripe del campus. Se leen solos cada 30 minutos; al pagarse, el cobro va a la venta de quien paga (por su correo o su móvil).
          </p>
        </header>
        {error && <p role="alert" className="m-3 text-sm rounded-md border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground px-3 py-2">{error}</p>}
        {cargando && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
        {!cargando && !error && links.length === 0 && (
          <p className="p-4 text-sm text-muted-foreground">No hay links creados directamente en Stripe{projectId ? ' en este campus' : ''}.</p>
        )}
        {!cargando && links.length > 0 && (
          <ul className="divide-y divide-border">
            {links.map((l) => (
              <li key={l.id} className="p-3 sm:px-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-link-stripe-id={l.id}>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap bg-muted text-muted-foreground">Creado en Stripe</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${l.activo ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {l.activo ? 'Activo' : 'Desactivado'}
                </span>
                <span className="font-semibold tabular-nums">{l.importe != null ? dinero(l.importe, l.moneda || 'EUR') : 'Importe libre'}</span>
                <span className="text-xs text-muted-foreground truncate max-w-[260px]" title={l.nombre || ''}>{l.nombre || '—'}</span>
                {l.codigos_promocionales && <span className="text-[11px] text-muted-foreground">admite códigos promocionales</span>}
                <span className="text-xs text-muted-foreground basis-full sm:basis-auto">
                  {l.project_nombre ? `${l.project_nombre} · ` : ''}
                  {l.cobros ? `${l.cobros} cobro${l.cobros === 1 ? '' : 's'} · ${dinero(l.cobrado, 'EUR')}` : 'sin cobros'}
                  {l.por_vincular > 0 && <span className="text-warning font-semibold"> · {l.por_vincular} por vincular</span>}
                </span>
                {l.url && (
                  <span className="ml-auto flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => copiarLink(l.url!)}
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
                      <Copy size={13} weight="bold" aria-hidden="true" /> Copiar
                    </button>
                    <a href={l.url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted">
                      <ArrowSquareOut size={13} weight="bold" aria-hidden="true" /> Abrir
                    </a>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={!!vinculando}
        title="Vincular el cobro a la venta"
        message={vinculando ? `${dinero(vinculando.cobro.importe, 'EUR')} de ${vinculando.cobro.nombre || vinculando.cobro.email || 'quien pagó'} a la venta n.º ${vinculando.venta.conversion_id} (${vinculando.venta.lead_nombre || 'sin nombre'}${vinculando.venta.producto ? ` · ${vinculando.venta.producto}` : ''}). Se apunta en ella y queda en la cola de facturación.` : ''}
        confirmLabel="Vincular"
        loading={vinculandoBusy}
        onConfirm={confirmarVincular}
        onCancel={() => setVinculando(null)}
      />
    </div>
  );
}

/** Un cobro de la bandeja: quién pagó, por qué no se vinculó solo, las ventas candidatas y el buscador. */
function CobroPendiente({ cobro, onElegir }: { cobro: CobroPorVincular; onElegir: (v: CandidataDeVenta) => void }) {
  const [texto, setTexto] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<CandidataDeVenta[] | null>(null);
  const [errorBusqueda, setErrorBusqueda] = useState<string | null>(null);
  const candidatas = (cobro.candidatos || []).filter((c) => c.conversion_id);
  const fichas = (cobro.candidatos || []).filter((c) => !c.conversion_id);

  async function buscar(e: React.FormEvent) {
    e.preventDefault();
    if (texto.trim().length < 2) return;
    setBuscando(true);
    setErrorBusqueda(null);
    try {
      const r = await buscarVentasParaVincular(cobro.id, texto.trim());
      setResultados(r.data || []);
    } catch (err) {
      setErrorBusqueda(errorDe(err));
    } finally { setBuscando(false); }
  }

  const BotonVenta = ({ v }: { v: CandidataDeVenta }) => (
    <button type="button" onClick={() => onElegir(v)}
      className="inline-flex flex-wrap items-center gap-1 min-h-8 px-2.5 py-1 rounded-md border border-border bg-card text-xs hover:bg-muted text-left">
      <span className="font-semibold">Venta n.º {v.conversion_id}</span>
      <span className="text-muted-foreground">· {v.lead_nombre || '—'}{v.producto ? ` · ${v.producto}` : ''}</span>
      {v.pendiente != null && <span className="text-muted-foreground">· pendiente {dinero(v.pendiente, 'EUR')}</span>}
    </button>
  );

  return (
    <li className="p-3 sm:px-4 space-y-2 text-sm" data-cobro-por-vincular={cobro.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold tabular-nums">{dinero(cobro.importe, 'EUR')}</span>
        <span>{cobro.nombre || '—'}</span>
        <span className="text-xs text-muted-foreground">{[cobro.email, cobro.telefono].filter(Boolean).join(' · ') || 'sin correo ni móvil'}</span>
        <span className="text-xs text-muted-foreground basis-full sm:basis-auto">
          {cobro.project_nombre ? `${cobro.project_nombre} · ` : ''}{cuando(cobro.cobrado_el)} · {cobro.link_nombre || 'link de Stripe'}
          {cobro.descuento ? ` · descuento ${dinero(cobro.descuento, 'EUR')}${cobro.codigo ? ` (${cobro.codigo})` : ''}` : ''}
        </span>
      </div>
      <p className="text-xs text-warning">{cobro.motivo_texto}.</p>
      {candidatas.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ventas que podrían ser">
          {candidatas.map((v) => <BotonVenta key={v.conversion_id} v={v} />)}
        </div>
      )}
      {fichas.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tiene ficha sin venta: {fichas.map((f, i) => (
            <span key={f.lead_id}>{i > 0 ? ', ' : ''}<Link to={RUTA_PROSPECTO(f.lead_id)} className="underline">{f.lead_nombre || `Prospecto ${f.lead_id}`}</Link></span>
          ))}. Crea su venta y vincúlalo después.
        </p>
      )}
      <form onSubmit={buscar} className="flex flex-wrap items-center gap-1.5">
        <label className="sr-only" htmlFor={`buscar-venta-${cobro.id}`}>Buscar la venta</label>
        <input id={`buscar-venta-${cobro.id}`} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Buscar la venta: nombre, correo, móvil o n.º"
          className="h-8 w-full sm:w-72 rounded-md border border-border bg-background px-2 text-xs" />
        <button type="submit" disabled={buscando || texto.trim().length < 2}
          className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50">
          <MagnifyingGlass size={13} weight="bold" aria-hidden="true" /> {buscando ? 'Buscando…' : 'Buscar'}
        </button>
      </form>
      {errorBusqueda && <p role="alert" className="text-xs text-destructive">{errorBusqueda}</p>}
      {resultados && resultados.length === 0 && <p className="text-xs text-muted-foreground">Ninguna venta del campus encaja.</p>}
      {resultados && resultados.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Ventas encontradas">
          {resultados.map((v) => (
            <span key={v.conversion_id} className="inline-flex items-center gap-1">
              <BotonVenta v={v} />
              <Link to={RUTA_VENTA(v.conversion_id!)} className="text-[11px] underline text-muted-foreground" target="_blank" rel="noopener noreferrer">ver</Link>
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
