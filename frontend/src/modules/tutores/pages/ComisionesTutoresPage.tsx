import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, ArrowsClockwise, Warning, Info, CheckCircle, ArrowCounterClockwise, CaretRight, Envelope, Bank, Copy, PaperPlaneTilt } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import Entregables from '../components/Entregables';
import LoQueFactura from '../components/LoQueFactura';
import AvisarTutorDialog from '../components/AvisarTutorDialog';
import { useProyectosDelAmbito } from '@/shared/hooks/useAmbito';
import usePermission from '@/shared/hooks/usePermission';
// El recorrido guiado de la pantalla (CRM-ISEIE#619, gemela de CRM#941).
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import {
  tutoresApi,
  type ComisionReal, type ResumenComision, type AjustesTutores, type PagoSinFormacion,
} from '../api/tutores.api';

// Lo que hay que pagarle a cada tutor este mes, y el botón de darlo por pagado.
//
// Esto YA es dinero: cada línea es una comisión escrita en la base, atada a un
// cobro concreto. No se recalcula sola cambiando un porcentaje — lo devengado,
// devengado está.
//
// Se paga POR PERSONA y no por curso: al final es una transferencia por tutor,
// aunque dé cuatro formaciones. Por eso la fila principal es el tutor y el
// desglose por curso vive dentro.

const euros = (n: number | string) =>
  Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const soloFecha = (f: string | null) => (f ? String(f).slice(0, 10) : null);

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: 'Pendiente',
  notificada: 'Notificada',
  falta_factura: 'Falta factura',
  pagada: 'Pagada',
  revertida: 'Revertida',
};


function mesActual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

function mesLegible(p: string) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const [a, m] = p.split('-');
  return `${meses[Number(m) - 1] || m} de ${a}`;
}

export default function ComisionesTutoresPage() {
  const { user } = useAuth() as { user: { role?: string; gestor_colaboraciones?: boolean } | null };
  const { activeProject, activeIssuer, activeIssuerId } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuer: { id?: number; nombre?: string } | null;
    activeIssuerId: number | null;
  };
  // Los campus de la empresa elegida. Aqui no hay sociedades en el selector
  // --un solo proyecto--, asi que no llega a aparecer; va igual para que los dos
  // CRM lleven el mismo codigo.
  const campus = useProyectosDelAmbito<{ id: number; nombre: string }>();
  const [soloCampus, setSoloCampus] = useState<number | null>(null);
  useEffect(() => { setSoloCampus(null); }, [activeIssuerId, activeProject?.id]);
  const esAdmin = ['admin', 'superadmin'].includes(user?.role || '');
  // «Gestionar colaboraciones» del catálogo (#423; antes, admin o la casilla).
  const { can } = usePermission();
  const puede = can('tutores.gestionar');
  const elegido = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;
  const projectId = elegido ?? soloCampus;
  const issuerId = !projectId ? activeIssuerId : null;

  const [periodo, setPeriodo] = useState(mesActual());
  const [resumen, setResumen] = useState<ResumenComision[]>([]);
  const [lineas, setLineas] = useState<ComisionReal[]>([]);
  const [sinFormacion, setSinFormacion] = useState<PagoSinFormacion[]>([]);
  const [ajustes, setAjustes] = useState<AjustesTutores | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);
  const [cambiando, setCambiando] = useState<number | null>(null);
  // «Avisar al tutor»: la fila de la que se abre el diálogo (CRM#165 / CRM-ISEIE#188).
  const [avisando, setAvisando] = useState<ResumenComision | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const finDeMes = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0)
        .toISOString().slice(0, 10);
      const [r, l, a, sf] = await Promise.all([
        tutoresApi.resumenComisiones({ periodo, projectId, issuerId }),
        tutoresApi.comisiones({ periodo, projectId, issuerId }),
        // Los ajustes son de quien gestiona tutores; sin eso, 403 (#631).
        puede ? tutoresApi.ajustes() : Promise.resolve({ success: false, data: null }),
        tutoresApi.pagosSinFormacion(`${periodo}-01`, finDeMes, projectId, issuerId),
      ]);
      setResumen(r.success ? (r.data || []) : []);
      setLineas(l.success ? (l.data || []) : []);
      setAjustes(a.success ? a.data : null);
      setSinFormacion(sf.success ? (sf.data || []) : []);
    } finally { setCargando(false); }
  }, [periodo, projectId, issuerId, puede]);

  useEffect(() => { if (puede) cargar(); }, [cargar, puede]);

  const total = useMemo(() => ({
    pendiente: resumen.reduce((s, r) => s + Number(r.pendiente), 0),
    pagada: resumen.reduce((s, r) => s + Number(r.pagada), 0),
    base: resumen.reduce((s, r) => s + Number(r.base), 0),
    sinAtribuir: sinFormacion.reduce((s, p) => s + Number(p.importe), 0),
  }), [resumen, sinFormacion]);

  async function calcular() {
    setTrabajando(true);
    try {
      const finDeMes = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0)
        .toISOString().slice(0, 10);
      const r = await tutoresApi.calcularComisiones({
        desde: `${periodo}-01`, hasta: finDeMes, projectId,
        projectIds: !projectId && activeIssuerId ? campus.map((c) => c.id) : null,
      });
      if (!r.success) throw new Error(r.error || 'no se pudo');
      toast({
        title: r.data!.creadas > 0 ? `${r.data!.creadas} comisiones nuevas` : 'Nada nuevo que calcular',
        description: r.data!.creadas > 0
          ? `${euros(r.data!.importe)} para ${r.data!.tutores} ${r.data!.tutores === 1 ? 'tutor' : 'tutores'}.`
          : 'Todos los cobros de este mes ya tenían su comisión.',
      });
      cargar();
    } catch (e) {
      toast({ title: 'No se ha podido calcular', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setTrabajando(false); }
  }

  async function pagar(r: ResumenComision) {
    setTrabajando(true);
    try {
      const res = await tutoresApi.liquidar({ periodo: r.periodo, tutorId: r.tutor_id });
      if (!res.success) throw new Error(res.error || 'no se pudo');
      toast({
        title: `${r.tutor}: ${euros(res.data!.importe)} marcados como pagados`,
        description: `${res.data!.liquidadas} ${res.data!.liquidadas === 1 ? 'línea' : 'líneas'} de ${mesLegible(r.periodo)}.`,
      });
      cargar();
    } catch (e) {
      toast({ title: 'No se ha podido marcar', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setTrabajando(false); }
  }

  /** Pendiente ⇄ Notificada ⇄ Falta factura. Nada mas: pagar y revertir van por
   *  su lado porque mueven dinero y dejan rastro de quien y cuando. */
  async function cambiarEstado(c: ComisionReal, estado: string) {
    setCambiando(c.id);
    try {
      const r = await tutoresApi.cambiarEstadoComision(c.id, estado);
      if (!r?.success) throw new Error('no');
      toast({ title: `Marcada como ${(ETIQUETA_ESTADO[estado] || estado).toLowerCase()}` });
      await cargar();
    } catch (err) {
      toast({
        title: 'No se ha podido cambiar',
        description: (err as { message?: string })?.message || 'Vuelve a intentarlo.',
        variant: 'destructive',
      });
    } finally { setCambiando(null); }
  }

  async function revertir(c: ComisionReal) {
    const motivo = window.prompt('¿Por qué se revierte? Queda escrito con tu nombre.');
    if (motivo === null) return;
    const r = await tutoresApi.revertirComision(c.id, motivo);
    if (r.success) { toast({ title: 'Comisión revertida' }); cargar(); }
    else toast({ title: 'No se ha podido revertir', description: r.error || '', variant: 'destructive' });
  }

  // Copiar el IBAN sin abrir nada. Se avisa de que se copio: si no, nadie sabe
  // si el clic hizo algo y acaba copiandolo a mano igualmente.
  async function copiarIban(iban: string) {
    try {
      await navigator.clipboard.writeText(iban);
      toast({ title: 'IBAN copiado', description: iban });
    } catch {
      toast({ title: 'No se pudo copiar', description: iban, variant: 'destructive' });
    }
  }

  if (!puede) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Esta pantalla es para administradores y gestores de colaboraciones.
      </div>
    );
  }

  return (
    // El recorrido trae cada parte a la vista: en el móvil, por debajo de la barra
    // fija de arriba (h-14), no escondida detrás (#619).
    <div className="space-y-3 [&_[data-recorrido]]:scroll-mt-20 lg:[&_[data-recorrido]]:scroll-mt-4">
      <PageHeader
        title="Comisiones de tutores"
        subtitle={projectId
          ? `${mesLegible(periodo)} · ${elegido ? (activeProject?.nombre || 'este proyecto') : (campus.find((c) => c.id === projectId)?.nombre || 'este campus')}`
          : activeIssuer
          ? `${mesLegible(periodo)} · los ${campus.length} campus de ${activeIssuer.nombre}`
          : `${mesLegible(periodo)} · todos los proyectos`}
        actions={(
          <>
            <VerRecorrido id="comisiones-tutores" listo={!cargando} />
            {/* El campus y el mes juntos: lo que señala el paso «El mes» (igual que el 360). */}
            <div data-recorrido="comtutores-periodo" className="flex items-center gap-2">
              {activeIssuer && !elegido && campus.length > 1 && (
                <select
                  value={soloCampus ?? ''}
                  onChange={(e) => setSoloCampus(e.target.value ? Number(e.target.value) : null)}
                  aria-label="Filtrar por campus"
                  className="h-9 px-2 rounded-md border border-border bg-card text-sm">
                  <option value="">Todos los campus</option>
                  {campus.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
              <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
                aria-label="Mes"
                className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            </div>
            <Button variant="outline" size="sm" onClick={calcular} disabled={trabajando} data-recorrido="comtutores-calcular">
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" />
              {trabajando ? 'Calculando…' : 'Calcular'}
            </Button>
          </>
        )}
      />

      <div data-recorrido="comtutores-tarjetas" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Coins} iconBg="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          label="Por pagar" value={euros(total.pendiente)} />
        <KpiCard icon={CheckCircle} iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          label="Ya pagado este mes" value={euros(total.pagada)} />
        <KpiCard icon={Coins} iconBg="bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          label="Cobrado de sus formaciones" value={euros(total.base)} />
      </div>

      {ajustes && (
        <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-2 text-sm">
          <Info size={16} weight="fill" className="text-muted-foreground shrink-0" />
          <span className="text-muted-foreground">
            Se paga un porcentaje de lo <strong className="text-foreground">cobrado de verdad</strong>, nunca
            de lo vendido. No se genera nada anterior al{' '}
            <strong className="text-foreground tabular-nums">{soloFecha(String(ajustes.aplica_desde))}</strong>,
            ni anterior a la fecha de inicio de cada tutor.
          </span>
        </div>
      )}

      {/* El dinero que no se puede atribuir. Se enseña a proposito: esconderlo
          haria parecer cuadrado un mes que no lo esta. */}
      {sinFormacion.length > 0 && (
        <div data-recorrido="comtutores-sin-formacion" className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
          <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5 text-sm">
            <Warning size={16} weight="fill" />
            {euros(total.sinAtribuir)} cobrados sin saber de qué formación son
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
            {sinFormacion.length} {sinFormacion.length === 1 ? 'cobro' : 'cobros'} de ventas que no están atadas
            al catálogo. Nadie cobra comisión por ellos. Se arregla eligiendo la formación en cada venta:
            {' '}{sinFormacion.slice(0, 3).map((p) => `#${p.venta} ${p.alumno}`).join(' · ')}
            {sinFormacion.length > 3 ? ` y ${sinFormacion.length - 3} más` : ''}.
          </p>
        </div>
      )}

      <div data-recorrido="comtutores-lista" className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">
            {cargando ? 'cargando…' : `${resumen.length} ${resumen.length === 1 ? 'tutor' : 'tutores'} en ${mesLegible(periodo)}`}
          </span>
          <span className="text-lg font-bold tabular-nums">{euros(total.pendiente)}</span>
        </div>

        {!cargando && resumen.length === 0 ? (
          <EmptyState icon={Coins} title="Ninguna comisión este mes"
            description="Pulsa Calcular para crearlas a partir de los cobros. Si sigue vacío: o no hay tutores con formaciones, o sus fechas de inicio son posteriores, o los cobros no están atados al catálogo." />
        ) : (
          <div className="divide-y divide-border">
            {resumen.map((r, i) => {
              const suyas = lineas.filter((l) => l.tutor_id === r.tutor_id);
              const desplegado = abierto === r.tutor_id;
              return (
                <div key={`${r.periodo}-${r.tutor_id}`}>
                  {/* La primera fila: el paso «Pagar y avisar» del recorrido (#619, #188). */}
                  <div data-recorrido={i === 0 ? 'comtutores-fila' : undefined} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    {/* Con un ancho minimo, como en el 360: con `min-w-0` el nombre se
                        encogia a «L…» en cuanto la fila llevaba el boton de avisar. */}
                    <button type="button" onClick={() => setAbierto(desplegado ? null : r.tutor_id)}
                      className="flex items-center gap-2 min-w-[13rem] flex-1 text-left">
                      <CaretRight size={14} weight="bold"
                        className={`shrink-0 text-muted-foreground transition-transform ${desplegado ? 'rotate-90' : ''}`} />
                      <span className="min-w-0">
                        <span className="font-semibold block truncate">{r.tutor}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {r.lineas} {r.lineas === 1 ? 'cobro' : 'cobros'} · base {euros(r.base)}
                          {Number(r.pagada) > 0 && ` · ${euros(r.pagada)} ya pagados`}
                          {Number(r.revertida) > 0 && ` · ${euros(r.revertida)} revertidos`}
                        </span>
                      </span>
                    </button>

                    {/* El correo y la cuenta, en su propio hueco de la fila.
                        Van FUERA del boton que despliega: dentro, copiar el IBAN
                        abriria y cerraria el detalle de paso. */}
                    <span className="hidden md:flex items-center gap-1.5 min-w-0 basis-64 text-xs text-muted-foreground">
                      {r.tutor_email
                        ? <>
                            <Envelope size={13} weight="bold" className="shrink-0 opacity-70" />
                            <span className="truncate" title={r.tutor_email}>{r.tutor_email}</span>
                          </>
                        : <span className="italic opacity-60">sin correo</span>}
                    </span>

                    <span className="hidden md:flex items-center gap-1.5 min-w-0 basis-56 text-xs text-muted-foreground">
                      {r.tutor_iban
                        ? <button type="button" title="Copiar el IBAN"
                            onClick={(e) => { e.stopPropagation(); copiarIban(r.tutor_iban!); }}
                            className="inline-flex items-center gap-1.5 min-w-0 hover:text-foreground">
                            <Bank size={13} weight="bold" className="shrink-0 opacity-70" />
                            <span className="font-mono tabular-nums truncate">{r.tutor_iban}</span>
                            <Copy size={11} weight="bold" className="shrink-0 opacity-50" />
                          </button>
                        : <span className="italic opacity-60">sin IBAN</span>}
                    </span>

                    <span className="text-base font-bold tabular-nums shrink-0">{euros(r.pendiente)}</span>

                    {esAdmin && can('tutores.liquidar') && Number(r.pendiente) > 0 && (
                      <Button size="sm" disabled={trabajando} onClick={() => pagar(r)}>
                        <CheckCircle size={14} weight="bold" className="mr-1.5" /> Marcar pagado
                      </Button>
                    )}
                    {/* «Avisar al tutor» (CRM#165 / CRM-ISEIE#188). Va junto a pagar
                        y no dentro del desplegable: es la otra cosa que se hace
                        con una fila. Lo que pide el servidor: `tutores.avisar` y
                        gestionar colaboraciones (`exigirGestion`), no liquidar. */}
                    {puede && can('tutores.avisar') && Number(r.pendiente) > 0 && (
                      <Button size="sm" variant="outline"
                        title={r.tutor_email ? `Escribir a ${r.tutor_email}` : 'Este tutor no tiene correo en su ficha'}
                        onClick={() => setAvisando(r)}>
                        <PaperPlaneTilt size={14} weight="bold" className="mr-1.5" />
                        Avisar al tutor
                      </Button>
                    )}

                    {/* Que ya se le avisó, quién y cuántas veces, al lado: no en el
                        estado del dinero, que sigue debiéndosele hasta que se pague. */}
                    {r.avisado_at && (
                      <span className="text-xs text-muted-foreground shrink-0" title={r.avisado_at}>
                        avisado el {soloFecha(r.avisado_at)}
                        {r.avisado_por_nombre ? ` por ${r.avisado_por_nombre}` : ''}
                        {(r.avisos_enviados || 0) > 1 ? ` (${r.avisos_enviados} veces)` : ''}
                      </span>
                    )}
                    {Number(r.pendiente) === 0 && r.ultima_liquidacion && (
                      <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">
                        pagado el {soloFecha(r.ultima_liquidacion)}
                      </span>
                    )}
                  </div>

                  {desplegado && (
                    <div className="px-4 pb-3 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left uppercase tracking-wide text-[10px] text-muted-foreground border-b border-border">
                            <th className="py-1.5 pr-3 font-semibold">Cobro</th>
                            <th className="py-1.5 px-3 font-semibold">Alumno</th>
                            <th className="py-1.5 px-3 font-semibold">Formación</th>
                            {!projectId && <th className="py-1.5 px-3 font-semibold">Proyecto</th>}
                            <th className="py-1.5 px-3 font-semibold text-right">Base</th>
                            <th className="py-1.5 px-3 font-semibold text-right">%</th>
                            <th className="py-1.5 px-3 font-semibold text-right">Comisión</th>
                            {/* Lo que ha entregado de esa formacion. Diego lo
                                pidio justo aqui: es la fila donde se pulsa
                                «Marcar pagado». */}
                            <th className="py-1.5 px-3 font-semibold">Entregado</th>
                            <th className="py-1.5 px-3 font-semibold">Estado</th>
                            <th className="py-1.5 pl-3" />
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {suyas.map((l) => (
                            <tr key={l.id} className={l.estado === 'revertida' ? 'opacity-50 line-through' : ''}>
                              <td className="py-1.5 pr-3 tabular-nums">{soloFecha(l.fecha_cobro)}</td>
                              <td className="py-1.5 px-3 truncate max-w-[10rem]">{l.alumno}</td>
                              <td className="py-1.5 px-3 truncate max-w-[16rem]">{l.formacion}</td>
                              {!projectId && <td className="py-1.5 px-3 text-muted-foreground">{l.proyecto}</td>}
                              <td className="py-1.5 px-3 text-right tabular-nums">{euros(l.base_calculo)}</td>
                              <td className="py-1.5 px-3 text-right tabular-nums">{Number(l.pct)} %</td>
                              <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{euros(l.importe)}</td>
                              <td className="py-1.5 px-3">
                                <Entregables valor={l} soloLectura />
                              </td>
                              <td className="py-1.5 px-3">
                                {l.estado === 'pagada' ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    pagada {soloFecha(l.fecha_liquidacion)}
                                  </span>
                                ) : l.estado === 'revertida' ? (
                                  <span className="text-muted-foreground">revertida</span>
                                ) : puede ? (
                                  // Los tres estados del seguimiento, editables aqui mismo.
                                  // Pagada y revertida NO estan en la lista: esas dos mueven
                                  // dinero y tienen su propio boton, con su rastro.
                                  <select
                                    value={l.estado}
                                    disabled={cambiando === l.id}
                                    onChange={(e) => cambiarEstado(l, e.target.value)}
                                    aria-label={`Estado de la comisión de ${l.alumno}`}
                                    className={`h-7 px-1.5 rounded border border-border bg-background text-xs font-semibold
                                      focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 ${
                                        l.estado === 'falta_factura'
                                          ? 'text-red-600 dark:text-red-400'
                                          : l.estado === 'notificada'
                                            ? 'text-sky-600 dark:text-sky-400'
                                            : 'text-amber-600 dark:text-amber-400'
                                      }`}
                                  >
                                    <option value="pendiente">Pendiente</option>
                                    <option value="notificada">Notificada</option>
                                    <option value="falta_factura">Falta factura</option>
                                  </select>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                    {ETIQUETA_ESTADO[l.estado] || l.estado}
                                  </span>
                                )}
                              </td>
                              <td className="py-1.5 pl-3 text-right">
                                {esAdmin && can('tutores.liquidar') && l.estado !== 'revertida' && (
                                  <button type="button" onClick={() => revertir(l)}
                                    title="Revertir esta comisión"
                                    className="text-muted-foreground hover:text-red-600">
                                    <ArrowCounterClockwise size={13} weight="bold" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {/* Lo que el profesional tiene que facturar. El mismo
                          cuadro lo ve el tutor en «Mis cursos». */}
                      <LoQueFactura
                        className="mt-3"
                        base={suyas
                          .filter((x) => x.estado !== 'revertida' && x.estado !== 'pagada')
                          .reduce((a, x) => a + Number(x.importe), 0)}
                        // Con el mes ya pagado dice «Todo pagado», en vez de
                        // quedarse en blanco y parecer un fallo (Diego, 13/10).
                        comisiones={suyas}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* La vista previa y el envío (CRM#165 / CRM-ISEIE#188): primero se ve el
          correo tal cual sale, y si ya se le mandó el de ese mes, se dice. */}
      {avisando && (
        <AvisarTutorDialog
          tutorId={avisando.tutor_id}
          periodo={avisando.periodo}
          ambito={{ projectId, issuerId }}
          onClose={() => setAvisando(null)}
          onEnviado={() => { setAvisando(null); cargar(); }}
        />
      )}
    </div>
  );
}
