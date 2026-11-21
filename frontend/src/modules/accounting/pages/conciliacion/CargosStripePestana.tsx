import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CreditCard, CheckCircle, LinkSimple, ShoppingCart, Receipt, ArrowsClockwise, Sparkle } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import KpiCard from '@/shared/components/ui/KpiCard';
import PageHeader from '@/shared/components/ui/PageHeader';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import { toast } from '@/shared/hooks/useToast';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';
import { formatCurrency, formatDate } from '@/shared/lib/format';
import CrearVentaDialog from './CrearVentaDialog';
import type { CargoSinEnlazar, CobroCandidato, Conciliacion, Por, VentaDelAlumno } from './tipos';

/*
  CONCILIACIÓN › CARGOS DE STRIPE (CRM#906).

  Diego, 18/11: en el 360 quedaban unos 246 cargos de Stripe cobrados (unos
  62.000 €) que no estaban en ningún cobro del CRM, algunos de alumnos sin
  venta. Cada cargo sale con lo que toca hacer:

    · su COBRO candidato (mismo campus, importe, tres días y el mismo correo o
      nombre): «Enlazar», la ruta de #892, sin crear nada;
    · si no hay cobro pero el alumno tiene venta: «Apuntar el cobro en esa
      venta», que salda su cuota y lo deja en la cola de facturación;
    · si no hay venta: «Crear la venta», con el alumno y el importe puestos.

  «Seguro» = un solo cobro candidato y que ese cobro no lo pida otro cargo. Los
  seguros se pueden enlazar todos a la vez, con confirmación, en un campus.
  El servidor recorta a los campus de quien mira.
*/

type Filtro = 'todos' | 'seguros' | 'enlazar' | 'apuntar' | 'crear';

const POR: Record<Por, string> = { venta: 'su venta', correo: 'el correo', nombre: 'el nombre' };
const nombreMes = (m: string) => {
  const [a, n] = m.split('-').map(Number);
  const t = new Date(a, n - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const errorDe = (e: unknown, por: string) => {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || por;
};

export default function CargosStripePestana() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string } | null;
    activeIssuerId: number | null;
  };
  const pid = activeProject?.id;
  const unCampus = Boolean(pid && pid > 0);

  const [mes, setMes] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [datos, setDatos] = useState<Conciliacion | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [apuntar, setApuntar] = useState<{ cargo: CargoSinEnlazar; venta: VentaDelAlumno } | null>(null);
  const [crear, setCrear] = useState<CargoSinEnlazar | null>(null);
  const [preguntarSeguros, setPreguntarSeguros] = useState(false);
  const [enlazandoSeguros, setEnlazandoSeguros] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true); setError(null);
    try {
      const qs = ponerAmbito(new URLSearchParams(mes ? { mes } : {}), { activeIssuerId, activeProject: { id: pid } });
      const r = await client.get<Conciliacion>(`/stripe-payments/conciliacion?${qs}`);
      setDatos(r.data as Conciliacion);
    } catch (e) {
      setError(errorDe(e, 'No se pudieron cargar los cargos'));
    } finally { setCargando(false); }
  }, [mes, activeIssuerId, pid]);

  useEffect(() => { cargar(); }, [cargar]);

  const filas = useMemo(() => (datos?.cargos || []).filter((c) => (
    filtro === 'todos' ? true : filtro === 'seguros' ? c.seguro : c.sugerencia === filtro
  )), [datos, filtro]);

  async function enlazar(cargo: CargoSinEnlazar, cobro: CobroCandidato) {
    setOcupado(cargo.id);
    try {
      await client.post(`/stripe-payments/${cargo.id}/link`, { conversionPaymentId: cobro.id });
      toast({ title: 'Cargo enlazado', description: `${formatCurrency(cargo.importe)} con el cobro de ${cobro.alumno || 'la venta'} ${cobro.factura_codigo ? `(factura ${cobro.factura_codigo})` : ''}`.trim() });
      await cargar();
    } catch (e) {
      toast({ title: 'No se pudo enlazar', description: errorDe(e, 'Error de red'), variant: 'destructive' });
    } finally { setOcupado(null); }
  }

  async function apuntarEnVenta() {
    if (!apuntar) return;
    const { cargo, venta } = apuntar;
    setOcupado(cargo.id);
    try {
      await client.post(`/stripe-payments/${cargo.id}/link`, { conversionId: venta.id, leadId: venta.lead_id });
      toast({ title: 'Cobro apuntado', description: `${formatCurrency(cargo.importe)} en la venta ${venta.id}${venta.alumno ? ` de ${venta.alumno}` : ''}. Queda en la cola de facturación.` });
      setApuntar(null);
      await cargar();
    } catch (e) {
      toast({ title: 'No se pudo apuntar el cobro', description: errorDe(e, 'Error de red'), variant: 'destructive' });
    } finally { setOcupado(null); }
  }

  async function enlazarSeguros() {
    setEnlazandoSeguros(true);
    try {
      const r = await client.post<{ seguros: number; enlazados: number; importe: number; fallos: { stripe_id: string; error: string }[] }>(
        '/stripe-payments/conciliacion/enlazar-seguros', { projectId: pid, mes: mes || null });
      const d = r.data!;
      toast({
        title: `${d.enlazados} cargo${d.enlazados === 1 ? '' : 's'} enlazado${d.enlazados === 1 ? '' : 's'}`,
        description: `Por ${formatCurrency(d.importe)}.${d.fallos.length ? ` ${d.fallos.length} no se pudo: ${d.fallos.map((f) => f.error).join(' · ')}` : ''}`,
        variant: d.fallos.length ? 'destructive' : undefined,
      });
      setPreguntarSeguros(false);
      await cargar();
    } catch (e) {
      toast({ title: 'No se pudieron enlazar', description: errorDe(e, 'Error de red'), variant: 'destructive' });
    } finally { setEnlazandoSeguros(false); }
  }

  const r = datos?.resumen;
  const chips: [Filtro, string, number | undefined][] = [
    ['todos', 'Todos', r?.cargos],
    ['seguros', 'Seguros', r?.seguros],
    ['enlazar', 'Con cobro', r?.conCobro],
    ['apuntar', 'Con venta, sin cobro', r?.conVenta],
    ['crear', 'Sin venta', r?.sinVenta],
  ];

  return (
    <div className="space-y-4 pb-8">
      <PageHeader
        title="Cargos de Stripe"
        subtitle="Lo cobrado en Stripe que no está en ningún cobro del CRM, por campus y por mes: enlázalo con su cobro, apúntalo en la venta del alumno o crea la venta."
      />
      {r && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard icon={CreditCard} iconBg="bg-warning-soft text-warning-soft-foreground"
            label={`Cargos sin enlazar · ${formatCurrency(r.importe)}`} numericValue={r.cargos} />
          <KpiCard icon={CheckCircle} iconBg="bg-success-soft text-success-soft-foreground"
            label={`Seguros, un solo cobro · ${formatCurrency(r.importeSeguros)}`} numericValue={r.seguros} />
          <KpiCard icon={Receipt} iconBg="bg-info-soft text-info-soft-foreground"
            label="Con venta, sin cobro" numericValue={r.conVenta} />
          <KpiCard icon={ShoppingCart} iconBg="bg-muted text-muted-foreground"
            label="Sin venta en el CRM" numericValue={r.sinVenta} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Mes</span>
          <select value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes"
            className="h-9 rounded-md border border-border bg-card px-2 text-sm max-w-[16rem]">
            <option value="">Todos los meses</option>
            {(datos?.meses || []).map((m) => (
              <option key={m.mes} value={m.mes}>{nombreMes(m.mes)} · {m.cargos}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={cargar} disabled={cargando}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
          <ArrowsClockwise size={14} weight="bold" className={cargando ? 'animate-spin' : ''} /> Recargar
        </button>
        <div className="flex-1" />
        {r && r.seguros > 0 && (
          unCampus ? (
            <button type="button" onClick={() => setPreguntarSeguros(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary/40">
              <Sparkle size={14} weight="bold" /> Enlazar todos los seguros ({r.seguros})
            </button>
          ) : (
            <span className="text-xs text-muted-foreground">Elige un campus para enlazar todos los seguros a la vez.</span>
          )
        )}
      </div>

      <div role="group" aria-label="Qué cargos ver" className="flex flex-wrap gap-1.5">
        {chips.map(([f, t, n]) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} aria-pressed={filtro === f}
            className={`h-8 px-3 rounded-full text-xs font-medium border focus:outline-none focus:ring-2 focus:ring-primary/40 ${filtro === f ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}>
            {t}{n != null ? ` · ${n}` : ''}
          </button>
        ))}
      </div>

      {cargando && !datos && <div className="h-40 rounded-md bg-muted/40 animate-pulse" aria-busy="true" aria-label="Cargando cargos" />}

      {!cargando && error && (
        <div role="alert" className="border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground rounded-md p-3 text-sm flex flex-wrap items-center gap-2">
          <span>{error}</span>
          <button type="button" onClick={cargar} className="underline font-semibold">Reintentar</button>
        </div>
      )}

      {!error && datos && filas.length === 0 && (
        <div className="border border-dashed border-border rounded-md p-8 text-center text-sm text-muted-foreground">
          {datos.cargos.length === 0
            ? 'No hay cargos de Stripe sin enlazar aquí. Todo lo cobrado está en su cobro.'
            : 'Ningún cargo con este filtro.'}
        </div>
      )}

      <ul className="space-y-3">
        {filas.map((c) => (
          <li key={c.id} className="bg-card border border-border rounded-md">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-3 py-2.5 border-b border-border">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm break-words">{c.customer_name || c.customer_email || 'Cliente sin nombre'}</p>
                <p className="text-xs text-muted-foreground break-all">
                  {c.customer_name && c.customer_email ? `${c.customer_email} · ` : ''}{formatDate(c.fecha)} · {c.proyecto}
                </p>
                <p className="text-[11px] text-muted-foreground break-all">{c.stripe_id}{c.description ? ` · ${c.description}` : ''}</p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{formatCurrency(c.importe)}</p>
                {c.seguro && <span className="inline-block mt-0.5 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-success-soft text-success-soft-foreground">Seguro</span>}
              </div>
            </div>

            <div className="px-3 py-2.5 space-y-2 text-sm">
              {c.cobros.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground">{c.cobros.length === 1 ? 'Su cobro en el CRM' : `${c.cobros.length} cobros posibles: elige el suyo`}</p>
                  {c.cobros.map((cp) => (
                    <div key={cp.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/40 p-2">
                      <div className="min-w-0 flex-1">
                        <span className="tabular-nums font-medium">{formatCurrency(cp.importe)}</span> del {formatDate(cp.fecha)}
                        {' · '}<Link to={`/ventas/${cp.conversion_id}`} className="text-primary hover:underline">{cp.alumno || `Venta ${cp.conversion_id}`}</Link>
                        {cp.programa && <span className="text-muted-foreground"> · {cp.programa}</span>}
                        <span className="block text-[11px] text-muted-foreground">
                          Casa por {POR[cp.por]}{cp.factura_codigo ? ` · factura ${cp.factura_codigo}` : ' · sin factura'}
                          {cp.otrosCargos === 1 ? ' · otro cargo también casa con él' : cp.otrosCargos > 1 ? ` · otros ${cp.otrosCargos} cargos también casan con él` : ''}
                        </span>
                      </div>
                      <button type="button" onClick={() => enlazar(c, cp)} disabled={ocupado === c.id}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
                        <LinkSimple size={13} weight="bold" /> Enlazar
                      </button>
                    </div>
                  ))}
                </>
              )}

              {c.cobros.length === 0 && c.ventas.length > 0 && (
                <>
                  <p className="text-xs font-medium text-muted-foreground">Sin cobro que case. {c.ventas.length === 1 ? 'Venta del alumno:' : 'Ventas del alumno:'}</p>
                  {c.ventas.map((v) => (
                    <div key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md bg-muted/40 p-2">
                      <div className="min-w-0 flex-1">
                        <Link to={`/ventas/${v.id}`} className="text-primary hover:underline">{v.alumno || `Venta ${v.id}`}</Link>
                        {v.programa && <span className="text-muted-foreground"> · {v.programa}</span>}
                        <span className="block text-[11px] text-muted-foreground tabular-nums">
                          Total {formatCurrency(v.total)} · pendiente {formatCurrency(v.pendiente)} · casa por {POR[v.por]}
                        </span>
                      </div>
                      <button type="button" onClick={() => setApuntar({ cargo: c, venta: v })} disabled={ocupado === c.id}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-primary text-primary text-xs font-semibold hover:bg-primary/10 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
                        <Receipt size={13} weight="bold" /> Apuntar el cobro en esa venta
                      </button>
                    </div>
                  ))}
                </>
              )}

              {c.cobros.length === 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {c.ventas.length === 0 && (
                    <p className="text-xs text-muted-foreground flex-1 min-w-[12rem]">
                      {c.ficha ? `${c.ficha.nombre} tiene ficha, pero ninguna venta.` : 'Este alumno no tiene ficha ni venta en el CRM.'}
                    </p>
                  )}
                  <button type="button" onClick={() => setCrear(c)} disabled={ocupado === c.id}
                    className={c.ventas.length === 0
                      ? 'inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40'
                      : 'inline-flex items-center gap-1.5 h-8 px-2 rounded-md text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40'}>
                    <ShoppingCart size={13} weight="bold" /> {c.ventas.length === 0 ? 'Crear la venta' : 'Es otra compra: crear la venta'}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={!!apuntar}
        title="Apuntar el cobro en esa venta"
        message={apuntar && (
          <>
            Se apunta un cobro de <strong>{formatCurrency(apuntar.cargo.importe)}</strong> del {formatDate(apuntar.cargo.fecha)} en la venta {apuntar.venta.id}
            {apuntar.venta.alumno ? ` de ${apuntar.venta.alumno}` : ''}, con el cargo de Stripe enlazado. Salda su cuota pendiente y queda en la cola de facturación.
          </>
        )}
        confirmLabel="Apuntar el cobro"
        onConfirm={apuntarEnVenta}
        onCancel={() => setApuntar(null)}
        loading={ocupado != null && ocupado === apuntar?.cargo.id}
      />

      <ConfirmDialog
        open={preguntarSeguros}
        title="Enlazar todos los seguros"
        message={r && (
          <>
            Se enlazan <strong>{r.seguros}</strong> cargo{r.seguros === 1 ? '' : 's'} por <strong>{formatCurrency(r.importeSeguros)}</strong>
            {mes ? ` de ${nombreMes(mes).toLowerCase()}` : ''} en {activeProject?.nombre || 'este campus'}, cada uno con su único cobro.
            No se crea ningún cobro ni ninguna factura.
          </>
        )}
        confirmLabel="Enlazarlos"
        tone="success"
        onConfirm={enlazarSeguros}
        onCancel={() => setPreguntarSeguros(false)}
        loading={enlazandoSeguros}
      />

      {crear && (
        <CrearVentaDialog cargo={crear} onClose={() => setCrear(null)} onHecho={() => { setCrear(null); cargar(); }} />
      )}
    </div>
  );
}
