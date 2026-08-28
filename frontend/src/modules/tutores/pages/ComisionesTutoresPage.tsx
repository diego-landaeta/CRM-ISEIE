import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, ArrowsClockwise, Warning, Info, CheckCircle, ArrowCounterClockwise, CaretRight, Envelope, Bank, Copy } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
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
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const esAdmin = ['admin', 'superadmin'].includes(user?.role || '');
  const puede = esAdmin || user?.gestor_colaboraciones === true;
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  const [periodo, setPeriodo] = useState(mesActual());
  const [resumen, setResumen] = useState<ResumenComision[]>([]);
  const [lineas, setLineas] = useState<ComisionReal[]>([]);
  const [sinFormacion, setSinFormacion] = useState<PagoSinFormacion[]>([]);
  const [ajustes, setAjustes] = useState<AjustesTutores | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const finDeMes = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)), 0)
        .toISOString().slice(0, 10);
      const [r, l, a, sf] = await Promise.all([
        tutoresApi.resumenComisiones({ periodo, projectId }),
        tutoresApi.comisiones({ periodo, projectId }),
        tutoresApi.ajustes(),
        tutoresApi.pagosSinFormacion(`${periodo}-01`, finDeMes, projectId),
      ]);
      setResumen(r.success ? (r.data || []) : []);
      setLineas(l.success ? (l.data || []) : []);
      setAjustes(a.success ? a.data : null);
      setSinFormacion(sf.success ? (sf.data || []) : []);
    } finally { setCargando(false); }
  }, [periodo, projectId]);

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
      const r = await tutoresApi.calcularComisiones({ desde: `${periodo}-01`, hasta: finDeMes, projectId });
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
    <div className="space-y-3">
      <PageHeader
        title="Comisiones de tutores"
        subtitle={projectId
          ? `${mesLegible(periodo)} · ${activeProject?.nombre || 'este proyecto'}`
          : `${mesLegible(periodo)} · todos los proyectos`}
        actions={(
          <>
            <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            <Button variant="outline" size="sm" onClick={calcular} disabled={trabajando}>
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" />
              {trabajando ? 'Calculando…' : 'Calcular'}
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3">
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

      <div className="bg-card border border-border rounded-lg overflow-hidden">
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
            {resumen.map((r) => {
              const suyas = lineas.filter((l) => l.tutor_id === r.tutor_id);
              const desplegado = abierto === r.tutor_id;
              return (
                <div key={`${r.periodo}-${r.tutor_id}`}>
                  <div className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => setAbierto(desplegado ? null : r.tutor_id)}
                      className="flex items-center gap-2 min-w-0 flex-1 text-left">
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

                    {esAdmin && Number(r.pendiente) > 0 && (
                      <Button size="sm" disabled={trabajando} onClick={() => pagar(r)}>
                        <CheckCircle size={14} weight="bold" className="mr-1.5" /> Marcar pagado
                      </Button>
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
                                {l.estado === 'pagada' ? (
                                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                                    pagada {soloFecha(l.fecha_liquidacion)}
                                  </span>
                                ) : l.estado === 'revertida' ? (
                                  <span className="text-muted-foreground">revertida</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400 font-semibold">pendiente</span>
                                )}
                              </td>
                              <td className="py-1.5 pl-3 text-right">
                                {esAdmin && l.estado !== 'revertida' && (
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
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
