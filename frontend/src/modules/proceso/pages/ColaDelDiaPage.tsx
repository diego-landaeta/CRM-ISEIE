/*
  La cola del día (#90). Lo que una gestora abre por la mañana.

  UNA FILA POR PERSONA, no una por paso. Si alguien lleva tres pasos sin hacer
  sale una vez, con el más urgente: lo que necesita es que la llamen, no salir
  tres veces en la lista.

  Y no hay botón de «hecho». El paso se cierra solo cuando se registra un
  contacto —el contacto n.º N cierra el paso n.º N—, que es la misma regla que
  usa el embudo de Reportes. Un plan que hay que mantener a mano acaba
  mintiendo, y de ahí no se vuelve. Lo que sí se puede a mano es mover la fecha
  o saltarse un paso, y eso se hace desde la ficha de la persona.
*/
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CalendarCheck, Warning, ArrowRight, CaretRight, User, ClockCounterClockwise,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { traerCola, traerResumen, type PasoEnCola, type ResumenCola } from '../api/agenda.api';
import { iconoDeCanal, nombreDeCanal } from '../lib/canales';

/** «hace 3 días», «hoy», «mañana» — no una fecha que hay que restar mentalmente. */
function cuando(fecha: string, retraso: number) {
  if (retraso > 0) return { texto: retraso === 1 ? 'ayer' : `hace ${retraso} días`, urgente: true };
  if (retraso === 0) return { texto: 'hoy', urgente: false };
  if (retraso === -1) return { texto: 'mañana', urgente: false };
  const d = new Date(fecha + 'T00:00:00');
  return {
    texto: d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }),
    urgente: false,
  };
}

function Contador({ icon: Icon, etiqueta, valor, tono, activo, onClick }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={
        'rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 '
        + (activo ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50')
      }
    >
      <div className={'flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide ' + tono}>
        <Icon size={13} /> {etiqueta}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
    </button>
  );
}

export default function ColaDelDiaPage() {
  const { activeProject } = useProjectContext();
  const { user } = useAuth();
  const navegar = useNavigate();
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [cola, setCola] = useState<PasoEnCola[]>([]);
  const [resumen, setResumen] = useState<ResumenCola | null>(null);
  const [cargando, setCargando] = useState(true);
  const [gestoraId, setGestoraId] = useState<number | null>(null);
  const [gestoras, setGestoras] = useState<Array<{ id: number; nombre: string }>>([]);
  // Qué tramo se está mirando. Por defecto todo lo que ya toca —atrasado y hoy—,
  // que es con lo que se abre el día.
  const [tramo, setTramo] = useState<'pendiente' | 'atrasados' | 'hoy' | 'manana' | 'semana'>('pendiente');

  const proyecto = activeProject?.id && activeProject.id !== -1 ? activeProject.id : null;

  // Mañana y la semana piden un `hasta` más largo; lo demás se filtra encima.
  const hasta = useMemo(() => {
    if (tramo !== 'manana' && tramo !== 'semana') return null;
    const d = new Date();
    d.setDate(d.getDate() + (tramo === 'manana' ? 1 : 7));
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${String(d.getDate()).padStart(2, '0')}`;
  }, [tramo]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      traerCola({ projectId: proyecto, gestoraId, hasta, limite: 300 }),
      traerResumen({ projectId: proyecto, gestoraId }),
    ]).then(([c, r]) => {
      if (!vivo) return;
      setCola(c);
      setResumen(r);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [proyecto, gestoraId, hasta]);

  // La lista de gestoras, solo para quien puede filtrar por ellas.
  useEffect(() => {
    if (!esAdmin) return;
    client.get(`/users?limit=100${proyecto ? `&projectId=${proyecto}` : ''}`)
      .then((r: any) => {
        if (!r?.success) return;
        setGestoras((r.data || [])
          .filter((u: any) => u.active !== false)
          .map((u: any) => ({ id: u.id, nombre: u.nombre })));
      })
      .catch(() => { /* si falla, se queda sin filtro y ya */ });
  }, [esAdmin, proyecto]);

  const visibles = useMemo(() => {
    if (tramo === 'atrasados') return cola.filter((x) => x.dias_de_retraso > 0);
    if (tramo === 'hoy') return cola.filter((x) => x.dias_de_retraso === 0);
    if (tramo === 'manana') return cola.filter((x) => x.dias_de_retraso === -1);
    return cola;
  }, [cola, tramo]);

  const titulo = esAdmin && !gestoraId ? 'La cola del equipo' : 'Tu día';

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title={titulo}
        subtitle="A quién le toca hoy, y quién viene arrastrado. Una fila por persona."
        actions={esAdmin && gestoras.length > 0 ? (
          <select
            value={gestoraId ?? ''}
            onChange={(e) => setGestoraId(e.target.value ? Number(e.target.value) : null)}
            className="h-9 px-3 rounded-md border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            aria-label="Filtrar por gestora"
          >
            <option value="">Todo el equipo</option>
            {gestoras.map((g) => <option key={g.id} value={g.id}>{g.nombre}</option>)}
          </select>
        ) : null}
      />

      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Contador icon={Warning} etiqueta="Atrasados" valor={resumen.atrasados}
            tono="text-red-600 dark:text-red-400"
            activo={tramo === 'atrasados'}
            onClick={() => setTramo(tramo === 'atrasados' ? 'pendiente' : 'atrasados')} />
          <Contador icon={CalendarCheck} etiqueta="Para hoy" valor={resumen.hoy}
            tono="text-emerald-600 dark:text-emerald-400"
            activo={tramo === 'hoy'}
            onClick={() => setTramo(tramo === 'hoy' ? 'pendiente' : 'hoy')} />
          <Contador icon={ArrowRight} etiqueta="Para mañana" valor={resumen.manana}
            tono="text-muted-foreground"
            activo={tramo === 'manana'}
            onClick={() => setTramo(tramo === 'manana' ? 'pendiente' : 'manana')} />
          <Contador icon={ClockCounterClockwise} etiqueta="Esta semana" valor={resumen.esta_semana}
            tono="text-muted-foreground"
            activo={tramo === 'semana'}
            onClick={() => setTramo(tramo === 'semana' ? 'pendiente' : 'semana')} />
        </div>
      )}

      {cargando ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : visibles.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={tramo === 'atrasados' ? 'Nada atrasado' : 'Nada pendiente'}
          description={
            resumen && resumen.atrasados + resumen.hoy === 0
              ? 'Todo el proceso al día. Los pasos se cierran solos al registrar un contacto.'
              : 'No hay nada en este tramo. Prueba con otro de los de arriba.'
          }
        />
      ) : (
        <div className="space-y-2">
          {visibles.map((p) => {
            const c = cuando(p.fecha_prevista, p.dias_de_retraso);
            return (
              <button
                key={p.lead_id}
                type="button"
                onClick={() => navegar(`/leads/${p.lead_id}`)}
                className={
                  'w-full text-left rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 '
                  + 'focus:outline-none focus:ring-2 focus:ring-primary/40 '
                  + (c.urgente ? 'border-l-4 border-l-red-500 border-border' : 'border-border')
                }
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-bold tabular-nums text-muted-foreground">
                    {p.orden}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-semibold truncate">{p.lead_nombre || 'Sin nombre'}</span>
                      <span className="text-xs text-muted-foreground">{p.paso_nombre || p.clave}</span>
                      <span className={
                        'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide '
                        + (c.urgente
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          : 'bg-muted text-muted-foreground')
                      }>
                        {c.texto}
                      </span>
                    </div>

                    {/* Los canales, EN ORDEN: la flecha dice por dónde se
                        intenta primero. */}
                    {(p.canales || []).length > 0 && (
                      <ol className="flex flex-wrap items-center gap-1" aria-label="Canales, en orden">
                        {p.canales!.map((canal, i) => {
                          const Icono = iconoDeCanal(canal);
                          return (
                            <li key={canal} className="flex items-center gap-1">
                              {i > 0 && <CaretRight size={9} weight="bold" className="text-muted-foreground/50" />}
                              <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]">
                                {Icono && <Icono size={11} />} {nombreDeCanal(canal)}
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                    )}

                    {/* La chuleta. Va aquí y no escondida detrás de un clic:
                        es lo que hace falta MIENTRAS se escribe el mensaje. */}
                    {p.paso_nota && (
                      <p className="text-[11px] text-muted-foreground">{p.paso_nota}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right text-[11px] text-muted-foreground">
                    {esAdmin && !gestoraId && p.gestora && (
                      <div className="inline-flex items-center gap-1"><User size={11} />{p.gestora}</div>
                    )}
                    <div className="tabular-nums">
                      {p.contactos} {p.contactos === 1 ? 'contacto' : 'contactos'}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        Los pasos <strong className="text-foreground">se cierran solos</strong> al registrar un contacto con la
        persona: no hay que marcarlos. Para mover una fecha o saltarse un paso, entra en su ficha.
      </p>
    </div>
  );
}
