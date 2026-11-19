import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowClockwise, CheckCircle, Warning } from '@phosphor-icons/react';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { cursosApi, type ControlSubidas, type FilaControl } from '../api/cursosPendientes.api';

/**
 * El control de subidas de todos los cursos (#771): qué falta subir de cada
 * curso y desde cuándo. Administración abre con «Solo atrasadas» (lo que pide
 * la issue); quien lleva las subidas lo quita para ver todo lo que le queda.
 * Los campus son los de quien mira: lo recorta el servidor.
 */

const fecha = (iso: string | null) => (iso
  ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

export default function ControlDeSubidas({ projectId, issuerId, onAbrirCurso }: {
  projectId: number | null; issuerId: number | null; onAbrirCurso: (id: number) => void;
}) {
  const [datos, setDatos] = useState<ControlSubidas | null>(null);
  const [soloAtrasadas, setSoloAtrasadas] = useState(true);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params: Record<string, string | number | boolean> = {};
      if (projectId) params.projectId = projectId;
      else if (issuerId) params.issuerId = issuerId;
      if (soloAtrasadas) params.soloAtrasadas = true;
      setDatos(await cursosApi.controlSubidas(params));
    } catch (e) {
      toast({ title: 'No se pudo cargar el control de subidas', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [projectId, issuerId, soloAtrasadas]);

  useEffect(() => { cargar(); }, [cargar]);

  // Por curso: una fila por curso con sus puntos pendientes.
  const cursos = useMemo(() => {
    const m = new Map<number, { curso: string; campus: string; filas: FilaControl[] }>();
    for (const f of datos?.filas || []) {
      if (!m.has(f.curso_id)) m.set(f.curso_id, { curso: f.curso, campus: f.campus, filas: [] });
      m.get(f.curso_id)!.filas.push(f);
    }
    return [...m.entries()];
  }, [datos]);

  const atrasados = (datos?.filas || []).filter((f) => f.atrasado).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          <strong className="tabular-nums">{datos?.filas.length ?? 0}</strong> {soloAtrasadas ? 'subidas atrasadas' : 'subidas pendientes'}
          {!soloAtrasadas && atrasados > 0 && <span className="ml-2 font-semibold text-destructive">{atrasados} atrasadas</span>}
        </p>
        {datos && (
          <p className="text-xs text-muted-foreground">
            Plazo: {datos.plazo_dias} días desde que se abre la lista · avisos en la campana {datos.avisos_activos ? 'encendidos' : 'apagados'}
          </p>
        )}
        <span className="flex-1" />
        <label className="inline-flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={soloAtrasadas} onChange={(e) => setSoloAtrasadas(e.target.checked)} /> Solo atrasadas
        </label>
        <button type="button" onClick={cargar} aria-label="Actualizar" disabled={cargando}
          className="inline-flex h-8 items-center rounded-md border border-border bg-card px-2.5 hover:bg-muted disabled:opacity-50">
          <ArrowClockwise size={14} className={cargando ? 'animate-spin' : ''} />
        </button>
      </div>

      {cargando && !datos ? (
        <p className="p-6 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : !cursos.length ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={CheckCircle}
            title={soloAtrasadas ? 'No hay subidas atrasadas' : 'No falta nada por subir'}
            description="Cada curso entregado tiene su lista: vídeos de los directores en YouTube, módulos en Moodle y datos de los directores para la web."
          />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 text-left font-bold">Curso</th>
                <th className="px-3 py-2.5 text-left font-bold">Falta</th>
                <th className="px-3 py-2.5 text-left font-bold">Desde</th>
                <th className="px-3 py-2.5 text-left font-bold">Fecha límite</th>
                <th className="px-3 py-2.5 text-right font-bold" title="Días desde la fecha límite">Retraso</th>
              </tr>
            </thead>
            <tbody>
              {cursos.map(([id, g]) => (
                <Fragment key={id}>
                  {g.filas.map((f, i) => (
                    <tr key={f.id} onClick={() => onAbrirCurso(id)}
                      className={`cursor-pointer hover:bg-muted/40 ${i === 0 ? 'border-t border-border' : ''} ${f.atrasado ? 'bg-destructive/5' : ''}`}>
                      <td className="px-4 py-2 align-top">
                        {i === 0 && (<><p className="font-semibold">{g.curso}</p><p className="text-[11px] text-muted-foreground">{g.campus}</p></>)}
                      </td>
                      <td className="px-3 py-2">{f.nombre}</td>
                      <td className="px-3 py-2 text-xs">{fecha(f.desde)} <span className="text-muted-foreground">({f.dias_esperando} d)</span></td>
                      <td className={`px-3 py-2 text-xs ${f.atrasado ? 'font-semibold text-destructive' : ''}`}>{fecha(f.fecha_limite)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${f.atrasado ? 'font-bold text-destructive' : 'text-muted-foreground'}`}>
                        {f.atrasado ? <><Warning size={12} weight="fill" className="mr-1 inline" />{f.dias_de_retraso} d</> : '—'}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
