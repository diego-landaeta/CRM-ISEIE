import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { WarningCircle, Clock, ArrowSquareOut, ArrowsClockwise, Buildings, GraduationCap } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { toast } from '@/shared/hooks/useToast';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';

/*
  DISPUTAS DE STRIPE (#396).

  Las disputas abiertas de todas las cuentas de Stripe de los campus de quien
  mira, por EMPRESA o por CAMPUS, con lo que vence pronto arriba. Solo lectura:
  la respuesta se da en Stripe, por eso cada fila lleva su enlace.

  El servidor recorta: un admin ve solo sus campus; super admin, todos. La
  pantalla no decide nada de eso.
*/

interface Disputa {
  id: number;
  dispute_id: string;
  project_id: number;
  proyecto: string;
  empresa_id: number | null;
  empresa: string | null;
  amount: number | string;
  currency: string;
  reason: string | null;
  status: string;
  evidence_due_by: string | null;
  stripe_created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  stripe_payment_id: number | null;
  pago_importe: number | string | null;
  conversion_id: number | null;
  lead_id: number | null;
  formacion: string | null;
  stripe_url: string;
}
interface Grupo {
  abiertas: number;
  vencenPronto: number;
  importes: Record<string, number>;
  empresa_id?: number | null;
  empresa?: string;
  project_id?: number;
  proyecto?: string;
}
interface Respuesta {
  disputas: Disputa[];
  resumen: { dias: number; total: Grupo; porEmpresa: Grupo[]; porProyecto: Grupo[]; vencenPronto: Disputa[] };
  sondeo: { project_id: number; proyecto: string; disputes_synced_at: string | null; disputes_last_error: string | null; tiene_webhook: boolean }[];
}

const MOTIVOS: Record<string, string> = {
  fraudulent: 'Fraude (no reconoce haberlo autorizado)',
  duplicate: 'Cargo duplicado',
  product_not_received: 'Producto no recibido',
  product_unacceptable: 'Producto no aceptable',
  subscription_canceled: 'Suscripción cancelada',
  unrecognized: 'No reconoce el cargo',
  credit_not_processed: 'Reembolso no procesado',
  general: 'General',
  incorrect_account_details: 'Datos de cuenta incorrectos',
  insufficient_funds: 'Fondos insuficientes',
  bank_cannot_process: 'El banco no puede procesarlo',
  debit_not_authorized: 'Débito no autorizado',
  customer_initiated: 'Iniciada por el cliente',
};
const ESTADOS: Record<string, { texto: string; tono: string }> = {
  needs_response: { texto: 'Necesita respuesta', tono: 'bg-destructive-soft text-destructive-soft-foreground' },
  warning_needs_response: { texto: 'Consulta: necesita respuesta', tono: 'bg-destructive-soft text-destructive-soft-foreground' },
  under_review: { texto: 'En revisión', tono: 'bg-info-soft text-info-soft-foreground' },
  warning_under_review: { texto: 'Consulta en revisión', tono: 'bg-info-soft text-info-soft-foreground' },
  warning_closed: { texto: 'Consulta cerrada', tono: 'bg-muted text-muted-foreground' },
  won: { texto: 'Ganada', tono: 'bg-success-soft text-success-soft-foreground' },
  lost: { texto: 'Perdida', tono: 'bg-muted text-muted-foreground' },
  prevented: { texto: 'Evitada', tono: 'bg-muted text-muted-foreground' },
  charge_refunded: { texto: 'Reembolsada', tono: 'bg-muted text-muted-foreground' },
};

const dinero = (n: number | string, moneda: string) => {
  try { return Number(n).toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR' }); } catch { return `${n} ${moneda}`; }
};
const importes = (m: Record<string, number>) => Object.entries(m).map(([c, v]) => dinero(v, c)).join(' · ') || '—';
const fecha = (f: string | null) => (f ? new Date(f).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const diasHasta = (f: string | null) => (f ? Math.ceil((new Date(f).getTime() - Date.now()) / 86400000) : null);

function Plazo({ f }: { f: string | null }) {
  const d = diasHasta(f);
  if (d == null) return <span className="text-muted-foreground">—</span>;
  const urgente = d <= 3;
  return (
    <span className={urgente ? 'font-semibold text-destructive' : ''}>
      {fecha(f)}
      <span className="block text-[11px] text-muted-foreground font-normal">
        {d < 0 ? 'vencida' : d === 0 ? 'vence hoy' : `quedan ${d} día${d === 1 ? '' : 's'}`}
      </span>
    </span>
  );
}

export default function DisputasStripePage() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string } | null;
    activeIssuerId: number | null;
  };
  const pid = activeProject?.id;
  const unCampus = Boolean(pid && pid > 0);

  const [vista, setVista] = useState<'empresa' | 'proyecto'>('empresa');
  const [estado, setEstado] = useState<'abiertas' | 'cerradas' | 'todas'>('abiertas');
  const [dias, setDias] = useState(7);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trayendo, setTrayendo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const qs = ponerAmbito(new URLSearchParams({ estado, dias: String(dias) }), { activeIssuerId, activeProject });
      const r = await client.get<Respuesta>(`/stripe-payments/disputas?${qs}`);
      if (r.success) setDatos(r.data as Respuesta);
      else setError((r as { error?: string }).error || 'No se pudieron cargar las disputas');
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      setError(err?.data?.error || err?.message || 'Error de red');
    } finally { setCargando(false); }
  }, [estado, dias, activeIssuerId, activeProject]);

  useEffect(() => { cargar(); }, [cargar]);

  async function traerAhora() {
    if (!unCampus) return;
    setTrayendo(true);
    try {
      const r = await client.post<{ vistas: number; nuevas: number }>('/stripe-payments/disputas/sincronizar', { projectId: pid });
      if (r.success) {
        toast({ title: 'Disputas al día', description: `${r.data?.vistas ?? 0} vistas en Stripe, ${r.data?.nuevas ?? 0} nuevas` });
        await cargar();
      } else {
        toast({ title: 'No se pudieron traer', description: (r as { error?: string }).error || '', variant: 'destructive' });
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudieron traer', description: err?.data?.error || err?.message || 'Error de red', variant: 'destructive' });
    } finally { setTrayendo(false); }
  }

  // Las filas, agrupadas por lo que se haya elegido.
  const grupos = useMemo(() => {
    const m = new Map<string, { clave: string; nombre: string; filas: Disputa[] }>();
    for (const d of datos?.disputas || []) {
      const clave = vista === 'empresa' ? String(d.empresa_id ?? 'sin') : String(d.project_id);
      const nombre = vista === 'empresa' ? (d.empresa || 'Sin empresa') : d.proyecto;
      if (!m.has(clave)) m.set(clave, { clave, nombre, filas: [] });
      m.get(clave)!.filas.push(d);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }, [datos, vista]);

  const resumen = datos?.resumen;
  const resumenGrupos = (vista === 'empresa' ? resumen?.porEmpresa : resumen?.porProyecto) || [];
  const sinSondeo = (datos?.sondeo || []).filter((s) => s.disputes_last_error || !s.disputes_synced_at);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Disputas de Stripe"
        subtitle="Las abiertas de cada cuenta de Stripe, por empresa y por campus. Se responden en Stripe."
        actions={unCampus ? (
          <button type="button" onClick={traerAhora} disabled={trayendo}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
            <ArrowsClockwise size={14} weight="bold" className={trayendo ? 'animate-spin' : ''} />
            {trayendo ? 'Trayendo…' : 'Traer ahora'}
          </button>
        ) : null}
      />

      {/* Arriba, lo que hay que mirar: cuántas, cuánto y cuáles vencen. */}
      {resumen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <KpiCard icon={WarningCircle} iconBg="bg-warning-soft text-warning-soft-foreground"
            label="Disputas abiertas" numericValue={resumen.total.abiertas}
            badge={resumen.total.abiertas ? importes(resumen.total.importes) : null}
            badgeColor="bg-warning-soft text-warning-soft-foreground" />
          <KpiCard icon={Clock} iconBg="bg-destructive-soft text-destructive-soft-foreground"
            label={`Vencen en ${resumen.dias} días o menos`} numericValue={resumen.vencenPronto.length}
            badge={resumen.vencenPronto.length ? 'Responder en Stripe' : 'Nada urgente'}
            badgeColor={resumen.vencenPronto.length ? 'bg-destructive-soft text-destructive-soft-foreground' : 'bg-success-soft text-success-soft-foreground'} />
        </div>
      )}

      {resumen && resumen.vencenPronto.length > 0 && (
        <section aria-labelledby="vencen" className="bg-destructive-soft/40 border border-destructive/30 rounded-md p-3">
          <h2 id="vencen" className="text-sm font-semibold mb-2">Vencen pronto</h2>
          <ul className="space-y-1.5 text-sm">
            {resumen.vencenPronto.map((d) => (
              <li key={`${d.project_id}-${d.dispute_id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-semibold">{fecha(d.evidence_due_by)}</span>
                <span>{d.customer_name || d.customer_email || 'Cliente sin nombre'}</span>
                <span className="tabular-nums">{dinero(d.amount, d.currency)}</span>
                <span className="text-muted-foreground">{d.proyecto}{d.empresa ? ` · ${d.empresa}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Controles: la vista (empresa / campus), el estado y el plazo. */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Agrupar por" className="inline-flex rounded-md border border-border overflow-hidden">
          {([['empresa', 'Por empresa', Buildings], ['proyecto', 'Por campus', GraduationCap]] as const).map(([v, t, I]) => (
            <button key={v} type="button" onClick={() => setVista(v)} aria-pressed={vista === v}
              className={`inline-flex items-center gap-1.5 h-9 px-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/40 ${vista === v ? 'bg-primary text-primary-foreground' : 'bg-card hover:bg-muted'}`}>
              <I size={14} weight="bold" /> {t}
            </button>
          ))}
        </div>
        <label className="text-sm inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Ver</span>
          <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm">
            <option value="abiertas">Abiertas</option>
            <option value="cerradas">Cerradas</option>
            <option value="todas">Todas</option>
          </select>
        </label>
        <label className="text-sm inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Vencen en</span>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm">
            {[3, 7, 14, 30].map((n) => <option key={n} value={n}>{n} días</option>)}
          </select>
        </label>
      </div>

      {/* El resumen del grupo elegido: abiertas e importe de cada empresa o campus. */}
      {resumenGrupos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {resumenGrupos.map((g) => (
            <div key={vista === 'empresa' ? String(g.empresa_id ?? 'sin') : String(g.project_id)}
              className="bg-card border border-border rounded-md p-3">
              <p className="text-sm font-semibold">{vista === 'empresa' ? g.empresa : g.proyecto}</p>
              {vista === 'proyecto' && <p className="text-[11px] text-muted-foreground">{g.empresa}</p>}
              <p className="text-sm mt-1">
                <strong>{g.abiertas}</strong> abierta{g.abiertas === 1 ? '' : 's'} · <span className="tabular-nums">{importes(g.importes)}</span>
              </p>
              {g.vencenPronto > 0 && <p className="text-[11px] font-semibold text-destructive mt-0.5">{g.vencenPronto} vence{g.vencenPronto === 1 ? '' : 'n'} pronto</p>}
            </div>
          ))}
        </div>
      )}

      {sinSondeo.length > 0 && (
        <p className="text-xs text-muted-foreground bg-muted/30 rounded-md p-2">
          Cuentas sin leer todavía o con error al pedir las disputas a Stripe: {sinSondeo.map((s) => `${s.proyecto}${s.disputes_last_error ? ` (${s.disputes_last_error})` : ''}`).join(' · ')}
        </p>
      )}

      {cargando && <div className="h-40 rounded-md bg-muted/40 animate-pulse" aria-busy="true" aria-label="Cargando disputas" />}

      {!cargando && error && (
        <div role="alert" className="border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground rounded-md p-3 text-sm flex flex-wrap items-center gap-2">
          <span>{error}</span>
          <button type="button" onClick={cargar} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {!cargando && !error && grupos.length === 0 && (
        <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
          {estado === 'abiertas'
            ? 'No hay disputas abiertas en tus campus. Las nuevas entran solas cada media hora y te llega un aviso.'
            : 'No hay disputas con este filtro.'}
          {estado !== 'abiertas' && (
            <button type="button" onClick={() => setEstado('abiertas')} className="block mx-auto mt-2 underline font-semibold">Ver las abiertas</button>
          )}
        </div>
      )}

      {!cargando && !error && grupos.map((g) => (
        <section key={g.clave} aria-label={g.nombre} className="bg-card border border-border rounded-md">
          <h2 className="px-3 py-2 border-b border-border text-sm font-semibold">{g.nombre} <span className="text-muted-foreground font-normal">· {g.filas.length}</span></h2>
          {/* `relative`: el `sr-only` de la cabecera es absoluto; sin esto se escapa y en móvil la página se desplaza de lado. */}
          <div className="relative overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium text-right">Importe</th>
                  <th className="px-3 py-2 font-medium">Motivo</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                  <th className="px-3 py-2 font-medium">Responder antes de</th>
                  <th className="px-3 py-2 font-medium">{vista === 'empresa' ? 'Campus · venta' : 'Venta'}</th>
                  <th className="px-3 py-2 font-medium"><span className="sr-only">Stripe</span></th>
                </tr>
              </thead>
              <tbody>
                {g.filas.map((d) => {
                  const e = ESTADOS[d.status] || { texto: d.status, tono: 'bg-muted text-muted-foreground' };
                  return (
                    <tr key={`${d.project_id}-${d.dispute_id}`} className="border-t border-border align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{fecha(d.stripe_created_at)}</td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{d.customer_name || '—'}</span>
                        {d.customer_email && <span className="block text-[11px] text-muted-foreground break-all">{d.customer_email}</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{dinero(d.amount, d.currency)}</td>
                      <td className="px-3 py-2">{MOTIVOS[d.reason || ''] || d.reason || '—'}</td>
                      <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${e.tono}`}>{e.texto}</span></td>
                      <td className="px-3 py-2 whitespace-nowrap"><Plazo f={d.evidence_due_by} /></td>
                      <td className="px-3 py-2">
                        {vista === 'empresa' && <span className="block">{d.proyecto}</span>}
                        {d.conversion_id
                          ? <Link to={`/ventas/${d.conversion_id}`} className="text-primary hover:underline">Venta {d.conversion_id}{d.formacion ? ` · ${d.formacion}` : ''}</Link>
                          : <span className="text-[11px] text-muted-foreground">{d.stripe_payment_id ? 'Pago sin venta asociada' : 'Pago no está en el CRM'}</span>}
                        {d.lead_id && <Link to={`/leads/${d.lead_id}`} className="block text-[11px] text-primary hover:underline">Ficha del cliente</Link>}
                      </td>
                      <td className="px-3 py-2">
                        <a href={d.stripe_url} target="_blank" rel="noopener noreferrer"
                          aria-label={`Abrir la disputa de ${d.customer_name || d.customer_email || 'este cliente'} en Stripe`}
                          className="inline-flex items-center gap-1 text-primary hover:underline whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary/40 rounded">
                          Stripe <ArrowSquareOut size={12} weight="bold" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
