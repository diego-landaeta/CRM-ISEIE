import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarBlank, CaretDown } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { formatFecha } from '@/modules/leads/lib/leadFormat';
import { inputClass } from '@/shared/lib/ui';
import { conversionsApi, type VentaSinFechaInicio } from '../api/conversions.api';

/*
  LAS VENTAS YA HECHAS SIN FECHA DE INICIO (CRM#1036).

  Solo las de productos unidos a un curso de Moodle de su campus: sin fecha no
  se programa la matrícula (va el día anterior), así que el alumno se
  matricularía en cuanto paga. Aquí se completan una a una, sin abrir la venta.

  La ve quien puede editar ventas; una gestora, solo las suyas (lo recorta el
  servidor). Si no hay ninguna, no ocupa sitio.
*/

export default function VentasSinFechaInicio({ projectId }: { projectId: number | null }) {
  const { can } = usePermission();
  const puede = can('conversions.edit');
  const [ventas, setVentas] = useState<VentaSinFechaInicio[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [fechas, setFechas] = useState<Record<number, string>>({});
  const [guardando, setGuardando] = useState<number | null>(null);

  const cargar = useCallback(async (id: number) => {
    try {
      const r = await conversionsApi.sinFechaInicio(id);
      setVentas(r.data ?? []);
    } catch { setVentas([]); }
  }, []);

  useEffect(() => {
    setVentas([]);
    setFechas({});
    if (puede && projectId) cargar(projectId);
  }, [puede, projectId, cargar]);

  async function guardar(v: VentaSinFechaInicio) {
    const fecha = fechas[v.id];
    if (!fecha) return;
    setGuardando(v.id);
    try {
      await conversionsApi.update(v.id, { fecha_inicio: fecha } as never);
      setVentas((l) => l.filter((x) => x.id !== v.id));
      toast({ title: 'Fecha de inicio guardada', description: `${v.alumno}: empieza el ${formatFecha(fecha)}` });
    } catch (e) {
      toast({ title: 'No se pudo guardar la fecha', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(null); }
  }

  if (!puede || !ventas.length) return null;

  return (
    <section className="rounded-md border border-warning/40 bg-warning-soft/40" data-recorrido="cursos-producto-sin-fecha">
      <button type="button" onClick={() => setAbierta((a) => !a)} aria-expanded={abierta}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-warning-soft-foreground">
        <CalendarBlank size={15} weight="bold" aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 flex-1">
          <strong className="font-semibold tabular-nums">{ventas.length}</strong>
          {ventas.length === 1 ? ' venta sin fecha de inicio' : ' ventas sin fecha de inicio'}
          <span className="hidden sm:inline">: sin ella no se programa la matrícula en Moodle</span>
        </span>
        <span className="shrink-0 text-xs font-semibold underline">{abierta ? 'Ocultar' : 'Completar'}</span>
        <CaretDown size={13} aria-hidden="true" className={`shrink-0 transition-transform ${abierta ? 'rotate-180' : ''}`} />
      </button>
      {abierta && (
        <ul className="divide-y divide-border border-t border-border bg-card">
          {ventas.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
              <div className="min-w-0 flex-1 basis-56">
                <Link to={`/leads/${v.lead_id}`} className="font-medium text-foreground hover:underline">{v.alumno}</Link>
                <p className="truncate text-xs text-muted-foreground">
                  {v.programa || 'Sin programa'} · vendida el {formatFecha(v.fecha)}{v.gestora ? ` · ${v.gestora}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input type="date" aria-label={`Fecha de inicio de ${v.alumno}`} value={fechas[v.id] ?? ''}
                  onChange={(e) => setFechas((f) => ({ ...f, [v.id]: e.target.value }))}
                  className={`${inputClass} h-8 w-40`} />
                <button type="button" onClick={() => guardar(v)} disabled={!fechas[v.id] || guardando === v.id}
                  className="h-8 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                  {guardando === v.id ? 'Guardando…' : 'Guardar'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
