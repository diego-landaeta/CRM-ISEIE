import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Coins, Info } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { tutoresApi, type Colaboracion, type LineaSimulacion } from '../api/tutores.api';

// Lo que ve un tutor: SUS cursos y SU dinero. Nada mas.
//
// El recorte no depende de esta pantalla: el servidor le fuerza su propio
// identificador e ignora lo que pida por query, asi que aunque alguien tecleara
// la direccion de otro tutor, seguiria viendo lo suyo. Esto es solo la forma de
// enseñarselo.
//
// Se le habla de «cursos», no de «colaboraciones» ni «formaciones»: es la
// palabra que usa el, y la pantalla es suya.

const euros = (n: number | string) =>
  Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

const soloFecha = (f: string | null) => (f ? String(f).slice(0, 10) : null);

function mesActual() {
  const h = new Date();
  return {
    desde: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-01`,
    hasta: new Date(h.getFullYear(), h.getMonth() + 1, 0).toISOString().slice(0, 10),
  };
}

export default function MisCursosPage() {
  const { user } = useAuth() as { user: { role?: string; nombre?: string } | null };
  const esTutor = user?.role === 'tutor';

  const inicial = mesActual();
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const [cursos, setCursos] = useState<Colaboracion[]>([]);
  const [lineas, setLineas] = useState<LineaSimulacion[]>([]);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [c, s] = await Promise.all([
        tutoresApi.colaboraciones(),          // sin id: el servidor pone el suyo
        tutoresApi.simulacion(desde, hasta),
      ]);
      setCursos(c.success ? (c.data || []) : []);
      setLineas(s.success ? (s.data || []) : []);
    } finally { setCargando(false); }
  }, [desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const total = lineas.reduce((s, l) => s + Number(l.comision), 0);
  const base = lineas.reduce((s, l) => s + Number(l.base), 0);
  const pagos = lineas.reduce((s, l) => s + l.pagos, 0);
  const porCurso = new Map(lineas.map((l) => [l.product_id, l]));

  if (!esTutor) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Esta pantalla es la de los tutores. Para gestionarlos, ve a Tutores.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PageHeader
        title="Mis cursos"
        subtitle={`Lo que te corresponde por lo cobrado entre esas fechas`}
        actions={(
          <>
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
            <span className="text-xs text-muted-foreground">a</span>
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          </>
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Coins} iconBg="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          label="Te corresponde" value={euros(total)} />
        <KpiCard icon={GraduationCap} iconBg="bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          label="Tus cursos" value={String(cursos.filter((c) => c.rige_hoy).length)} />
        <KpiCard icon={Coins} iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          label={`Cobrado de tus cursos (${pagos} ${pagos === 1 ? 'pago' : 'pagos'})`} value={euros(base)} />
      </div>

      <div className="bg-card border border-border rounded-lg p-3 flex gap-2 text-sm">
        <Info size={16} weight="fill" className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          Cobras un porcentaje de lo que <strong>se ha cobrado de verdad</strong> de tus cursos, no de lo
          vendido. Si un alumno paga en tres veces, te corresponde tu parte en cada pago, según se
          cobra — no de golpe al matricularse.
        </p>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-semibold">
            {cargando ? 'cargando…' : `${cursos.length} ${cursos.length === 1 ? 'curso' : 'cursos'}`}
          </span>
        </div>

        {!cargando && cursos.length === 0 ? (
          <EmptyState icon={GraduationCap} title="Todavía no tienes cursos asignados"
            description="Cuando te asignen uno aparecerá aquí, con tu porcentaje y desde qué fecha." />
        ) : (
          <div className="divide-y divide-border">
            {cursos.map((c) => {
              const l = porCurso.get(c.product_id);
              return (
                <div key={c.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{c.formacion}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {Number(c.pct)} % · desde el {soloFecha(c.vigente_desde)}
                      {c.vigente_hasta ? ` hasta el ${soloFecha(c.vigente_hasta)}` : ''}
                      {!c.rige_hoy && ' · no vigente'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {l ? (
                      <>
                        <p className="font-bold tabular-nums">{euros(l.comision)}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {l.pagos} {l.pagos === 1 ? 'pago' : 'pagos'} · {euros(l.base)} cobrados
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">sin cobros en estas fechas</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
