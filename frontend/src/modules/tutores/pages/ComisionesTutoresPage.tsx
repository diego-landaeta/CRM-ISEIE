import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, ArrowsClockwise, Warning, Info } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import { tutoresApi, type LineaSimulacion, type AjustesTutores } from '../api/tutores.api';

// Lo que se le pagaria a cada tutor en un mes.
//
// Es una SIMULACION, y esta escrito en la pantalla a proposito: no crea nada,
// no reserva nada y no compromete ningun pago. Sirve para revisar las
// colaboraciones antes de encender el calculo de verdad, que es cuando el
// dinero empieza a existir.
//
// La base sale de los cobros reales (conversion_payments), nunca del campo
// importe_pagado de la venta: ese declara mas de 200.000 EUR de mas y al 10%
// serian unos 21.000 EUR de comisiones que nadie ha ganado.

const euros = (n: number | string) =>
  Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function mesActual() {
  const h = new Date();
  const primero = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-01`;
  const ultimo = new Date(h.getFullYear(), h.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { desde: primero, hasta: ultimo };
}

export default function ComisionesTutoresPage() {
  const { user } = useAuth() as { user: { role?: string; gestor_colaboraciones?: boolean } | null };
  // Un profesor puede dar clase en varias marcas. Con una elegida arriba se ve
  // solo lo suyo de esa marca; en «todos los proyectos», todo junto y con la
  // marca al lado de cada curso.
  const { activeProject } = useProjectContext() as { activeProject: { id: number; nombre?: string } | null };
  const projectId = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;
  const esAdmin = ['admin', 'superadmin'].includes(user?.role || '');
  const puede = esAdmin || user?.gestor_colaboraciones === true;

  const inicial = mesActual();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [lineas, setLineas] = useState<LineaSimulacion[]>([]);
  const [ajustes, setAjustes] = useState<AjustesTutores | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [s, a] = await Promise.all([tutoresApi.simulacion(desde, hasta, null, projectId), tutoresApi.ajustes()]);
      setLineas(s.success ? (s.data || []) : []);
      setAjustes(a.success ? a.data : null);
    } finally { setCargando(false); }
  }, [desde, hasta, projectId]);

  useEffect(() => { if (puede) cargar(); }, [cargar, puede]);

  // Una fila por tutor, sumando sus formaciones. Es como se paga: una
  // transferencia por persona, no una por curso.
  const porTutor = useMemo(() => {
    const m = new Map<number, { nombre: string; pagos: number; base: number; comision: number; lineas: LineaSimulacion[] }>();
    for (const l of lineas) {
      const a = m.get(l.tutor_id) || { nombre: l.tutor, pagos: 0, base: 0, comision: 0, lineas: [] };
      a.pagos += l.pagos;
      a.base += Number(l.base);
      a.comision += Number(l.comision);
      a.lineas.push(l);
      m.set(l.tutor_id, a);
    }
    return [...m.entries()].map(([id, v]) => ({ id, ...v })).sort((x, y) => y.comision - x.comision);
  }, [lineas]);

  const total = porTutor.reduce((s, t) => s + t.comision, 0);

  async function moverArranque(nueva: string) {
    setGuardando(true);
    try {
      const r = await tutoresApi.guardarAjustes({ aplicaDesde: nueva });
      if (!r.success) throw new Error(r.error || 'no se pudo');
      toast({
        title: 'Arranque cambiado',
        description: `Desde ahora no se paga comisión por cobros anteriores al ${nueva}.`,
      });
      cargar();
    } catch (e) {
      toast({ title: 'No se ha podido cambiar', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally { setGuardando(false); }
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
          ? `Lo que se pagaría en ${activeProject?.nombre || 'este proyecto'}, con las colaboraciones de hoy`
          : 'Lo que se pagaría en el periodo elegido — todos los proyectos'}
        actions={(
          <>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            <Button variant="outline" size="sm" onClick={cargar}>
              <ArrowsClockwise size={14} weight="bold" className="mr-1.5" /> Actualizar
            </Button>
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Coins} iconBg="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          label="A pagar en el periodo" value={euros(total)} />
        <KpiCard icon={Coins} iconBg="bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          label="Tutores con comisión" value={String(porTutor.length)} />
        <KpiCard icon={Coins} iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          label="Base sobre la que se calcula" value={euros(porTutor.reduce((s, t) => s + t.base, 0))} />
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 rounded-lg p-3 text-sm">
        <p className="font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
          <Warning size={16} weight="fill" /> Esto es una simulación
        </p>
        <p className="text-xs text-amber-800 dark:text-amber-300 mt-1 leading-relaxed">
          Enseña lo que se pagaría con las colaboraciones de hoy, pero <strong>no crea ninguna comisión
          ni compromete ningún pago</strong>. Sirve para revisar antes de encender el cálculo de verdad.
        </p>
      </div>

      {ajustes && (
        <div className="bg-card border border-border rounded-lg p-3 flex flex-wrap items-center gap-3 text-sm">
          <Info size={16} weight="fill" className="text-muted-foreground shrink-0" />
          <span>
            No se paga comisión por cobros anteriores al{' '}
            <strong className="tabular-nums">{String(ajustes.aplica_desde).slice(0, 10)}</strong>,
            y cada tutor cobra además solo desde su propia fecha de inicio.
          </span>
          {esAdmin && (
            <label className="ml-auto text-xs text-muted-foreground flex items-center gap-2">
              Mover arranque
              <input type="date" defaultValue={String(ajustes.aplica_desde).slice(0, 10)} disabled={guardando}
                onChange={(e) => e.target.value && moverArranque(e.target.value)}
                className="h-8 px-2 rounded-md border border-border bg-background text-sm" />
            </label>
          )}
        </div>
      )}

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">
            {cargando ? 'calculando…' : `${porTutor.length} ${porTutor.length === 1 ? 'tutor' : 'tutores'} con comisión`}
          </span>
          <span className="text-lg font-bold tabular-nums">{euros(total)}</span>
        </div>

        {!cargando && porTutor.length === 0 ? (
          <EmptyState icon={Coins} title="Ninguna comisión en estas fechas"
            description="Puede ser que no haya tutores con formaciones asignadas, que sus fechas de inicio sean posteriores, o que los cobros de esas formaciones no estén atados al catálogo — sin esa atadura no se sabe de qué formación es un pago, y no genera comisión." />
        ) : (
          <div className="divide-y divide-border">
            {porTutor.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{t.nombre}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t.pagos} {t.pagos === 1 ? 'cobro' : 'cobros'} · base {euros(t.base)}
                    </p>
                  </div>
                  <span className="text-base font-bold tabular-nums shrink-0">{euros(t.comision)}</span>
                </div>
                <div className="mt-2 space-y-1">
                  {t.lineas.map((l) => (
                    <div key={`${l.tutor_id}-${l.product_id}`} className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="truncate">
                        {l.formacion}
                        {!projectId && l.proyecto && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide bg-muted px-1.5 py-0.5 rounded">
                            {l.proyecto}
                          </span>
                        )}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {l.pagos} × · {euros(l.base)} · {Number(l.pct)} % = <strong className="text-foreground">{euros(l.comision)}</strong>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
