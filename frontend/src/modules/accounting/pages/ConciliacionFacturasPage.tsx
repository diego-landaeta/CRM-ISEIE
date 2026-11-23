import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Receipt, CurrencyEur, CheckCircle, LinkSimple, ArrowRight } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { toast } from '@/shared/hooks/useToast';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';

const ConfirmDialog = lazy(() => import('@/shared/components/ui/ConfirmDialog'));

/*
  FINANZAS › CONCILIACIÓN › FACTURAS Y COBROS (CRM#905).

  Diego, 18/11: facturas emitidas que no tienen su cobro enlazado (casi todas de
  las cargas de Excel) y cobros sin factura. Dos listas por campus y por mes:

    1. Facturas emitidas sin cobro, con sus cobros candidatos: mismo campus,
       mismo importe, a 7 días o menos y del mismo cliente (venta, correo,
       nombre o NIF). Si casan solo entre ellos, «Seguro».
    2. Cobros sin factura, con su factura candidata; sin ella, «Emitir factura»
       lleva a la cola de facturación de su campus.

  «Enlazar» une la factura con el cobro y su venta, sin tocar número, importe,
  emisora ni datos del cliente. El servidor decide todo (campus, permiso, 409
  si ya está enlazada); la pantalla solo enseña y pregunta.
*/

interface Candidato {
  payment_id: number; fecha: string; importe: number; cliente: string | null; producto: string | null;
  conversion_id: number; dias: number; por: Por; segura: boolean;
}
interface Candidata {
  invoice_id: number; codigo: string; fecha: string; cliente: string | null; dias: number; por: Por; segura: boolean;
}
type Por = 'venta' | 'correo' | 'nif' | 'nombre';
interface Factura {
  id: number; project_id: number; campus: string; codigo: string; fecha: string; total: number; estado: string;
  cliente_nombre: string; cliente_email: string | null; conversion_id: number | null; candidatos: Candidato[];
}
interface Cobro {
  id: number; project_id: number; campus: string; fecha: string; importe: number; metodo: string | null;
  conversion_id: number; lead_id: number | null; cliente: string | null; cliente_email: string | null;
  producto: string | null; de_stripe: boolean; en_cola: boolean; fuera_de_cola: 'al_dia' | 'ejercicio_anterior' | null;
  candidatas: Candidata[];
}
interface Respuesta {
  mes: string | null; dias: number; facturas: Factura[]; cobros: Cobro[];
  resumen: {
    facturas_sin_cobro: number; importe_facturas: number; cobros_sin_factura: number; importe_cobros: number;
    seguras: number; importe_seguras: number;
  };
}

const POR: Record<Por, string> = { venta: 'misma venta', correo: 'mismo correo', nif: 'mismo NIF', nombre: 'mismo nombre' };
const FUERA: Record<string, string> = {
  al_dia: 'Fuera de la cola: anterior a «facturación al día»',
  ejercicio_anterior: 'Fuera de la cola: de un ejercicio anterior',
};

const euros = (n: number) => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const fecha = (f: string | null) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};
const mesActual = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const mensajeDe = (e: unknown) => {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red';
};

function Seguro() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-success-soft text-success-soft-foreground whitespace-nowrap">
      <CheckCircle size={12} weight="bold" /> Seguro
    </span>
  );
}

export default function ConciliacionFacturasPage() {
  const navigate = useNavigate();
  const { activeProject, activeIssuerId, projects, switchProject } = useProjectContext() as {
    activeProject: { id?: number | null } | null;
    activeIssuerId: number | null;
    projects: { id: number; nombre: string; type?: string | null }[];
    switchProject: (id: number) => void;
  };

  const proyectoArriba = activeProject?.id ?? null;
  const [mes, setMes] = useState(mesActual());
  const [campus, setCampus] = useState('');
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enlazando, setEnlazando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [todas, setTodas] = useState(false);

  // El campus de aquí manda sobre el de arriba; sin él, el de arriba (un campus,
  // una empresa o todos los suyos).
  const misCampus = useMemo(
    () => (projects || []).filter((p) => p.id && p.id !== TODOS_LOS_PROYECTOS).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    [projects]);

  const consulta = useCallback(() => {
    const qs = new URLSearchParams();
    if (mes) qs.set('mes', mes);
    if (campus) qs.set('projectId', campus);
    // Por el id, no por el objeto: un objeto nuevo en cada pintada recargaría sin parar.
    else ponerAmbito(qs, { activeIssuerId, activeProject: { id: proyectoArriba } });
    return qs.toString();
  }, [mes, campus, activeIssuerId, proyectoArriba]);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const r = await client.get<Respuesta>(`/conciliacion/facturas-cobros?${consulta()}`);
      if (r.success) setDatos(r.data as Respuesta);
      else setError((r as { error?: string }).error || 'No se pudo cargar la conciliación');
    } catch (e) {
      setError(mensajeDe(e));
    } finally { setCargando(false); }
  }, [consulta]);

  useEffect(() => { cargar(); }, [cargar]);

  async function enlazar(invoiceId: number, paymentId: number, codigo: string) {
    setEnlazando(`${invoiceId}-${paymentId}`);
    try {
      const r = await client.post('/conciliacion/facturas-cobros/enlazar', { invoiceId, paymentId });
      if (r.success) {
        toast({ title: 'Enlazada', description: `La factura ${codigo} ya tiene su cobro y su venta.` });
        await cargar();
      }
    } catch (e) {
      toast({ title: 'No se pudo enlazar', description: mensajeDe(e), variant: 'destructive' });
      await cargar();
    } finally { setEnlazando(null); }
  }

  async function enlazarTodas() {
    if (!datos) return;
    setTodas(true);
    try {
      const r = await client.post<{ enlazadas: number; importe: number; fallidas: unknown[] }>(
        `/conciliacion/facturas-cobros/enlazar-seguras?${consulta()}`,
        { mes: mes || undefined, cuantas: datos.resumen.seguras, importe: datos.resumen.importe_seguras });
      if (r.success && r.data) {
        const f = r.data.fallidas?.length || 0;
        toast({
          title: `${r.data.enlazadas} enlazada${r.data.enlazadas === 1 ? '' : 's'}`,
          description: `${euros(r.data.importe)}${f ? ` · ${f} no se pudo enlazar` : ''}`,
          variant: f ? 'destructive' : undefined,
        });
      }
    } catch (e) {
      toast({ title: 'No se enlazaron', description: mensajeDe(e), variant: 'destructive' });
    } finally {
      setTodas(false); setConfirmar(false);
      await cargar();
    }
  }

  /** «Emitir factura»: a la cola de facturación de su campus. */
  function irALaCola(projectId: number) {
    switchProject(projectId);
    navigate('/accounting/facturas');
  }

  const r = datos?.resumen;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Facturas y cobros"
        subtitle="Facturas emitidas sin su cobro y cobros sin factura, por campus y por mes. «Enlazar» no cambia el número, el importe ni los datos del cliente."
        actions={r && r.seguras > 0 ? (
          <button type="button" onClick={() => setConfirmar(true)} disabled={cargando || todas} data-recorrido="conciliacion-todas"
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
            <LinkSimple size={14} weight="bold" /> Enlazar todas las seguras ({r.seguras})
          </button>
        ) : null}
      />

      <div className="flex flex-wrap items-end gap-3" data-recorrido="conciliacion-filtros">
        <label className="text-sm flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Campus</span>
          <select value={campus} onChange={(e) => setCampus(e.target.value)} aria-label="Campus"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm max-w-full">
            <option value="">Los de arriba</option>
            {misCampus.map((p) => <option key={p.id} value={String(p.id)}>{p.nombre}</option>)}
          </select>
        </label>
        <label className="text-sm flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted-foreground">Mes</span>
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm" />
        </label>
        {mes && (
          <button type="button" onClick={() => setMes('')}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40">
            Todos los meses
          </button>
        )}
      </div>

      {r && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard icon={Receipt} iconBg="bg-warning-soft text-warning-soft-foreground"
            label="Facturas emitidas sin cobro" numericValue={r.facturas_sin_cobro}
            badge={euros(r.importe_facturas)} badgeColor="bg-warning-soft text-warning-soft-foreground" />
          <KpiCard icon={CurrencyEur} iconBg="bg-info-soft text-info-soft-foreground"
            label="Cobros sin factura" numericValue={r.cobros_sin_factura}
            badge={euros(r.importe_cobros)} badgeColor="bg-info-soft text-info-soft-foreground" />
          <KpiCard icon={CheckCircle} iconBg="bg-success-soft text-success-soft-foreground"
            label="Parejas seguras" numericValue={r.seguras}
            badge={euros(r.importe_seguras)} />
        </div>
      )}

      {cargando && <div className="h-40 rounded-md bg-muted/40 animate-pulse" aria-busy="true" aria-label="Cargando la conciliación" />}

      {!cargando && error && (
        <div role="alert" className="border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground rounded-md p-3 text-sm flex flex-wrap items-center gap-2">
          <span>{error}</span>
          <button type="button" onClick={cargar} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {!cargando && !error && datos && (
        <>
          <section aria-labelledby="facturas-sin-cobro" className="bg-card border border-border rounded-md" data-recorrido="conciliacion-sin-cobro">
            <h2 id="facturas-sin-cobro" className="px-3 py-2 border-b border-border text-sm font-semibold">
              Facturas emitidas sin cobro <span className="text-muted-foreground font-normal">· {datos.facturas.length}</span>
            </h2>
            {datos.facturas.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Todas las facturas emitidas de este mes tienen su cobro.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm block sm:table">
                  <thead className="hidden sm:table-header-group text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Factura</th>
                      <th className="px-3 py-2 font-medium">Cliente</th>
                      <th className="px-3 py-2 font-medium text-right">Importe</th>
                      <th className="px-3 py-2 font-medium">Cobro candidato</th>
                    </tr>
                  </thead>
                  <tbody className="block sm:table-row-group">
                    {datos.facturas.map((f) => (
                      <tr key={f.id} className="block sm:table-row border-t border-border align-top py-2 sm:py-0">
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 whitespace-nowrap">
                          <span className="font-semibold">{f.codigo}</span>
                          <span className="block text-[11px] text-muted-foreground">{fecha(f.fecha)} · {f.campus}</span>
                        </td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:min-w-[10rem]">
                          <span className="font-medium">{f.cliente_nombre}</span>
                          {f.cliente_email && <span className="block text-[11px] text-muted-foreground break-all">{f.cliente_email}</span>}
                        </td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:text-right tabular-nums whitespace-nowrap font-semibold sm:font-normal">{euros(f.total)}</td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:min-w-[16rem]">
                          {f.candidatos.length === 0 ? (
                            <span className="text-[11px] text-muted-foreground">Sin cobro que case (mismo importe, cliente y fecha a {datos.dias} días)</span>
                          ) : (
                            <ul className="space-y-2">
                              {f.candidatos.map((c) => (
                                <li key={c.payment_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="whitespace-nowrap">{fecha(c.fecha)}</span>
                                  <span className="font-medium">{c.cliente || 'Sin nombre'}</span>
                                  <Link to={`/ventas/${c.conversion_id}`} className="text-[11px] text-primary hover:underline">Venta {c.conversion_id}</Link>
                                  <span className="text-[11px] text-muted-foreground">{POR[c.por]} · {c.dias} día{c.dias === 1 ? '' : 's'}</span>
                                  {c.segura && <Seguro />}
                                  <button type="button" onClick={() => enlazar(f.id, c.payment_id, f.codigo)}
                                    disabled={enlazando !== null}
                                    aria-label={`Enlazar la factura ${f.codigo} con el cobro del ${fecha(c.fecha)}`}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
                                    <LinkSimple size={12} weight="bold" />
                                    {enlazando === `${f.id}-${c.payment_id}` ? 'Enlazando…' : 'Enlazar'}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="cobros-sin-factura" className="bg-card border border-border rounded-md" data-recorrido="conciliacion-sin-factura">
            <h2 id="cobros-sin-factura" className="px-3 py-2 border-b border-border text-sm font-semibold">
              Cobros sin factura <span className="text-muted-foreground font-normal">· {datos.cobros.length}</span>
            </h2>
            {datos.cobros.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Todos los cobros de este mes tienen su factura.</p>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full text-sm block sm:table">
                  <thead className="hidden sm:table-header-group text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Cobro</th>
                      <th className="px-3 py-2 font-medium">Cliente</th>
                      <th className="px-3 py-2 font-medium text-right">Importe</th>
                      <th className="px-3 py-2 font-medium">Factura candidata</th>
                    </tr>
                  </thead>
                  <tbody className="block sm:table-row-group">
                    {datos.cobros.map((c) => (
                      <tr key={c.id} className="block sm:table-row border-t border-border align-top py-2 sm:py-0">
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 whitespace-nowrap">
                          <span className="font-semibold">{fecha(c.fecha)}</span>
                          <span className="block text-[11px] text-muted-foreground">{c.campus}{c.de_stripe ? ' · Stripe' : c.metodo ? ` · ${c.metodo}` : ''}</span>
                        </td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:min-w-[10rem]">
                          <span className="font-medium">{c.cliente || 'Sin nombre'}</span>
                          <Link to={`/ventas/${c.conversion_id}`} className="block text-[11px] text-primary hover:underline">
                            Venta {c.conversion_id}{c.producto ? ` · ${c.producto}` : ''}
                          </Link>
                        </td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:text-right tabular-nums whitespace-nowrap font-semibold sm:font-normal">{euros(c.importe)}</td>
                        <td className="block sm:table-cell px-3 py-1 sm:py-2 sm:min-w-[16rem]">
                          {c.candidatas.length > 0 ? (
                            <ul className="space-y-2">
                              {c.candidatas.map((f) => (
                                <li key={f.invoice_id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                  <span className="font-semibold">{f.codigo}</span>
                                  <span className="whitespace-nowrap">{fecha(f.fecha)}</span>
                                  <span className="text-[11px] text-muted-foreground">{POR[f.por]} · {f.dias} día{f.dias === 1 ? '' : 's'}</span>
                                  {f.segura && <Seguro />}
                                  <button type="button" onClick={() => enlazar(f.invoice_id, c.id, f.codigo)}
                                    disabled={enlazando !== null}
                                    aria-label={`Enlazar la factura ${f.codigo} con el cobro del ${fecha(c.fecha)}`}
                                    className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
                                    <LinkSimple size={12} weight="bold" />
                                    {enlazando === `${f.invoice_id}-${c.id}` ? 'Enlazando…' : 'Enlazar'}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : c.en_cola ? (
                            <button type="button" onClick={() => irALaCola(c.project_id)}
                              className="inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40">
                              Emitir factura <ArrowRight size={12} weight="bold" />
                            </button>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{FUERA[c.fuera_de_cola || ''] || 'Fuera de la cola'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="text-[11px] text-muted-foreground">
            Casan si son del mismo campus, por el mismo importe, a {datos.dias} días o menos y del mismo cliente (la venta, el correo, el nombre o el NIF).
            «Seguro»: la factura solo casa con ese cobro y el cobro solo con esa factura. «Emitir factura» lleva a la cola de facturación de su campus.
          </p>
        </>
      )}

      {confirmar && r && (
        <Suspense fallback={null}>
          <ConfirmDialog
            open
            title="Enlazar todas las seguras"
            message={`Se van a enlazar ${r.seguras} factura${r.seguras === 1 ? '' : 's'} con su cobro, por ${euros(r.importe_seguras)}. No cambia el número, el importe, la emisora ni los datos del cliente de ninguna.`}
            confirmLabel={`Enlazar ${r.seguras}`}
            onConfirm={enlazarTodas}
            onCancel={() => setConfirmar(false)}
            loading={todas}
          />
        </Suspense>
      )}
    </div>
  );
}
