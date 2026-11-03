import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Warning, GraduationCap, Hourglass, Users, ArrowClockwise } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import {
  cursosApi, ESTADOS, TIPOS, type CursoPendiente, type EstadoCurso, type Resumen,
} from '../api/cursosPendientes.api';
import FichaDelPendiente from '../components/FichaDelPendiente';
import NuevoPendiente from '../components/NuevoPendiente';

/**
 * Cursos pendientes, por campus (#336): sustituye al Excel de las tutoras.
 *
 * El campus es lo primero: una pestaña por campus con sus contadores (también
 * los que están a 0, para que se vea que está al día) y «Todos los campus»,
 * agrupado por campus. Dentro, la lista ordenada por fecha comprometida, con los
 * retrasados arriba y en rojo.
 *
 * Una tutora entra y ve primero lo suyo; quien manda, lo de sus campus. Qué ve
 * cada una lo decide el servidor, no esta pantalla.
 */

export const dias = (c: Pick<CursoPendiente, 'dias_para_la_fecha' | 'estado'>): string => {
  const d = c.dias_para_la_fecha;
  if (d == null) return '—';
  if (['publicado', 'cerrado', 'cancelado'].includes(c.estado)) return '—';
  if (d === 0) return 'hoy';
  return d < 0 ? `${d} d` : `+${d} d`;
};

const fecha = (iso: string | null) => (iso
  ? new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

const ESTADO_TONO: Record<EstadoCurso, string> = {
  pendiente_asignar: 'bg-warning-soft text-warning-soft-foreground',
  asignado: 'bg-muted text-foreground',
  en_desarrollo: 'bg-primary/10 text-primary',
  publicado: 'bg-success-soft text-success-soft-foreground',
  cerrado: 'bg-muted text-muted-foreground',
  cancelado: 'bg-muted text-muted-foreground line-through',
};

function Avance({ c }: { c: CursoPendiente }) {
  const piezas = [c.avance_foto ? 'foto' : null, c.avance_video ? 'vídeo' : null, c.avance_modulos ? `${c.avance_modulos} % módulos` : null].filter(Boolean);
  return <span className="text-muted-foreground">{piezas.length ? piezas.join(' · ') : '—'}</span>;
}

export default function CursosPendientesPage() {
  const { user } = useAuth() as { user: { role?: string; userId?: number; id?: number } | null };
  const esTutora = user?.role === 'tutor';
  const supervisa = user?.role === 'admin' || user?.role === 'superadmin';
  const puedeCrear = ['admin', 'superadmin', 'soporte', 'gestor'].includes(user?.role || '');

  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [cursos, setCursos] = useState<CursoPendiente[]>([]);
  const [campus, setCampus] = useState<number | 'todos'>('todos');
  const [verCerrados, setVerCerrados] = useState(false);
  const [soloRetrasados, setSoloRetrasados] = useState(false);
  const [tutoraFiltro, setTutoraFiltro] = useState<number | ''>('');
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [creando, setCreando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params: Record<string, string | number | boolean> = { abiertos: !verCerrados };
      if (campus !== 'todos') params.projectId = campus;
      if (soloRetrasados) params.soloRetrasados = true;
      if (tutoraFiltro) params.tutorId = tutoraFiltro;
      const [r, l] = await Promise.all([cursosApi.resumen(), cursosApi.listar(params)]);
      setResumen(r);
      setCursos(l);
    } catch (e) {
      toast({ title: 'No se pudieron cargar los cursos pendientes', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [campus, verCerrados, soloRetrasados, tutoraFiltro]);

  useEffect(() => { cargar(); }, [cargar]);

  // Si la página abre con ?curso=ID (el enlace de una notificación), abre su ficha.
  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get('curso'));
    if (id) setAbierto(id);
  }, []);

  const contadores = useMemo(() => {
    if (!resumen) return null;
    return campus === 'todos' ? resumen.total : resumen.campus.find((c) => c.project_id === campus) || null;
  }, [resumen, campus]);

  // Lo que vence esta semana (la tutora lo ve arriba, antes que nada).
  const venceEstaSemana = cursos.filter((c) => !c.retrasado && ['asignado', 'en_desarrollo'].includes(c.estado)
    && c.dias_para_la_fecha != null && c.dias_para_la_fecha >= 0 && c.dias_para_la_fecha <= 7).length;

  // «Todos los campus»: agrupado por campus, en el orden de las pestañas.
  const grupos = useMemo(() => {
    const m = new Map<number, { nombre: string; filas: CursoPendiente[] }>();
    for (const c of cursos) {
      if (!m.has(c.project_id)) m.set(c.project_id, { nombre: c.campus, filas: [] });
      m.get(c.project_id)!.filas.push(c);
    }
    return [...m.entries()];
  }, [cursos]);

  const tutoras = resumen?.carga_por_tutora || [];

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Cursos pendientes"
        subtitle="Las formaciones vendidas que todavía no existen en el campus: quién las crea, para cuándo y qué alumnas esperan"
      />

      {venceEstaSemana > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground" role="status">
          <Hourglass size={16} weight="bold" /> Esta semana {venceEstaSemana === 1 ? 'vence 1 curso' : `vencen ${venceEstaSemana} cursos`}.
        </p>
      )}

      {/* El campus es lo primero: una pestaña por campus, con sus contadores, también los que están a 0. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Campus">
        <PestañaCampus
          activa={campus === 'todos'} onClick={() => setCampus('todos')}
          nombre="Todos los campus" abiertos={resumen?.total.abiertos ?? 0} retrasados={resumen?.total.retrasados ?? 0} esperando={resumen?.total.alumnas_esperando ?? 0}
        />
        {resumen?.campus.map((c) => (
          <PestañaCampus
            key={c.project_id} activa={campus === c.project_id} onClick={() => setCampus(c.project_id)}
            nombre={c.campus} abiertos={c.abiertos} retrasados={c.retrasados} esperando={c.alumnas_esperando}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {contadores && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span><strong className="tabular-nums">{contadores.abiertos}</strong> abiertos</span>
            <span className={contadores.retrasados ? 'text-destructive font-semibold' : ''}><strong className="tabular-nums">{contadores.retrasados}</strong> retrasados</span>
            <span><strong className="tabular-nums">{contadores.alumnas_esperando}</strong> alumnas esperando</span>
            {supervisa && <span><strong className="tabular-nums">{contadores.sin_tutora}</strong> sin tutora</span>}
          </div>
        )}
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={soloRetrasados} onChange={(e) => setSoloRetrasados(e.target.checked)} /> Solo retrasados
        </label>
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={verCerrados} onChange={(e) => setVerCerrados(e.target.checked)} /> Ver cerrados y cancelados
        </label>
        {supervisa && tutoras.length > 0 && (
          <select
            value={tutoraFiltro} onChange={(e) => setTutoraFiltro(e.target.value ? Number(e.target.value) : '')}
            aria-label="Filtrar por tutora" className="h-8 rounded-md border border-border bg-card px-2 text-xs"
          >
            <option value="">Todas las tutoras</option>
            {tutoras.map((t) => <option key={t.tutor_id} value={t.tutor_id}>{t.tutora} ({t.abiertos})</option>)}
          </select>
        )}
        <button type="button" onClick={cargar} aria-label="Actualizar" disabled={cargando}
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 hover:bg-muted disabled:opacity-50">
          <ArrowClockwise size={14} className={cargando ? 'animate-spin' : ''} />
        </button>
        {puedeCrear && (
          <button type="button" onClick={() => setCreando(true)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
            <Plus size={14} weight="bold" /> Nuevo pendiente
          </button>
        )}
      </div>

      {cargando && !cursos.length ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : !cursos.length ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={GraduationCap}
            title={campus === 'todos' ? 'No hay cursos pendientes' : 'Este campus está al día'}
            description={esTutora ? 'No tienes ningún curso asignado.' : 'Cuando se venda una formación que todavía no existe, aparecerá aquí.'}
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-bold">Formación</th>
                <th className="px-3 py-2.5 text-right font-bold">Alumnas</th>
                <th className="px-3 py-2.5 text-left font-bold">Fecha comprometida</th>
                <th className="px-3 py-2.5 text-right font-bold" title="Negativo = retrasado">Días</th>
                <th className="px-3 py-2.5 text-left font-bold">Estado</th>
                <th className="px-3 py-2.5 text-left font-bold">Avance</th>
                <th className="px-3 py-2.5 text-left font-bold">Tutora</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map(([id, g]) => (
                <Fragment key={id}>
                  {campus === 'todos' && (
                    <tr className="bg-muted/30"><td colSpan={7} className="px-4 py-1.5 text-xs font-bold">{g.nombre}</td></tr>
                  )}
                  {g.filas.map((c) => (
                    <tr
                      key={c.id} onClick={() => setAbierto(c.id)}
                      className={`cursor-pointer border-t border-border hover:bg-muted/40 ${c.retrasado ? 'bg-destructive/5' : ''}`}
                    >
                      <td className="px-4 py-2.5">
                        <p className="font-semibold">{c.nombre}</p>
                        <p className="text-[11px] text-muted-foreground">{TIPOS[c.tipo]}</p>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{c.alumnas_esperando}{c.alumnas_total !== c.alumnas_esperando ? <span className="text-muted-foreground"> / {c.alumnas_total}</span> : null}</td>
                      <td className={`px-3 py-2.5 ${c.retrasado ? 'font-semibold text-destructive' : ''}`}>{fecha(c.fecha_comprometida)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${c.retrasado ? 'font-bold text-destructive' : ''}`}>
                        {c.retrasado && <Warning size={12} weight="fill" className="mr-1 inline" />}{dias(c)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${ESTADO_TONO[c.estado]}`}>{ESTADOS[c.estado]}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs"><Avance c={c} /></td>
                      <td className="px-3 py-2.5 text-xs">{c.tutora || <span className="text-muted-foreground">Sin asignar</span>}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {supervisa && resumen?.carga_por_tutora && resumen.carga_por_tutora.length > 0 && (
        <SupervisionCarga resumen={resumen} />
      )}

      {abierto != null && (
        <FichaDelPendiente
          id={abierto} esTutora={esTutora} supervisa={supervisa}
          onCerrar={() => setAbierto(null)} onCambio={cargar}
        />
      )}
      {creando && (
        <NuevoPendiente
          campus={resumen?.campus || []}
          campusInicial={campus === 'todos' ? null : campus}
          onCerrar={() => setCreando(false)}
          onCreado={() => { setCreando(false); cargar(); }}
        />
      )}
    </div>
  );
}

function PestañaCampus({ activa, onClick, nombre, abiertos, retrasados, esperando }: {
  activa: boolean; onClick: () => void; nombre: string; abiertos: number; retrasados: number; esperando: number;
}) {
  return (
    <button
      type="button" role="tab" aria-selected={activa} onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${activa ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted/50'}`}
    >
      <p className="text-xs font-bold">{nombre}</p>
      <p className="mt-0.5 flex gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>{abiertos} abiertos</span>
        <span className={retrasados ? 'font-semibold text-destructive' : ''}>{retrasados} retrasados</span>
        <span className="inline-flex items-center gap-0.5"><Users size={10} /> {esperando}</span>
      </p>
    </button>
  );
}

/** La carga de cada tutora y el tiempo medio venta → habilitada, por campus (solo supervisión). */
function SupervisionCarga({ resumen }: { resumen: Resumen }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Carga por tutora</h2>
        <p className="mb-2 text-xs text-muted-foreground">Cursos abiertos; un máster pesa más que un curso.</p>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr>
            <th className="py-1 text-left font-bold">Tutora</th><th className="py-1 text-right font-bold">Cursos</th>
            <th className="py-1 text-right font-bold">Diplomados</th><th className="py-1 text-right font-bold">Másters</th>
            <th className="py-1 text-right font-bold">Retrasados</th>
          </tr></thead>
          <tbody>
            {resumen.carga_por_tutora!.map((t) => (
              <tr key={t.tutor_id} className="border-t border-border">
                <td className="py-1.5 font-semibold">{t.tutora}</td>
                <td className="py-1.5 text-right tabular-nums">{t.cursos}</td>
                <td className="py-1.5 text-right tabular-nums">{t.diplomados}</td>
                <td className="py-1.5 text-right tabular-nums">{t.masters}</td>
                <td className={`py-1.5 text-right tabular-nums ${t.retrasados ? 'font-bold text-destructive' : ''}`}>{t.retrasados}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Tiempos, por campus</h2>
        <p className="mb-2 text-xs text-muted-foreground">Desde la venta hasta que la alumna queda habilitada, y publicados con alguien sin habilitar más de 48 h.</p>
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr>
            <th className="py-1 text-left font-bold">Campus</th><th className="py-1 text-right font-bold">Días medios</th>
            <th className="py-1 text-right font-bold">Sin habilitar +48 h</th>
          </tr></thead>
          <tbody>
            {(resumen.indicadores || []).map((i) => (
              <tr key={i.project_id} className="border-t border-border">
                <td className="py-1.5 font-semibold">{i.campus}</td>
                <td className="py-1.5 text-right tabular-nums">{i.dias_medios_venta_a_habilitada ?? '—'}</td>
                <td className={`py-1.5 text-right tabular-nums ${i.publicados_sin_habilitar ? 'font-bold text-destructive' : ''}`}>{i.publicados_sin_habilitar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
