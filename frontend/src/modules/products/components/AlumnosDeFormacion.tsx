import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowSquareOut, Student } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { cn } from '@/shared/lib/utils';
import { alumnosApi, type AlumnosDeFormacion as Datos } from '../api/alumnos.api';
import {
  fechaCorta, filtrarAlumnos, rutaDeVenta, textoEstado, TEXTO_PAGO, TONO_PAGO, type FiltroAlumnos,
} from '../lib/alumnosFormacion';

/**
 * La sección «Alumnos» de la ficha de una formación (CRM#1113): cuántos tiene
 * activos, terminados y en total; de los activos, cómo van de pagos; y la lista
 * con su gestora, la venta, hasta cuándo tiene acceso y su estado de pago, que
 * lleva a la venta.
 *
 * Activo = venta no anulada ni devuelta cuyo acceso sigue vigente. El fin del
 * acceso lo calcula el servidor: fin de la formación, su duración publicada, o la
 * regla del campus por tipo (se cambia en la lista de Formaciones).
 *
 * Con el permiso `products.alumnos` y el alcance de Ventas: la gestora, los suyos.
 */

const FILTROS: Array<{ id: FiltroAlumnos; texto: string }> = [
  { id: 'activos', texto: 'Activos' },
  { id: 'impago', texto: 'Con impago' },
  { id: 'pendiente', texto: 'Cuotas pendientes' },
  { id: 'terminados', texto: 'Terminados' },
  { id: 'todos', texto: 'Todos' },
];

export default function AlumnosDeFormacion({ productId, campusId }: { productId: number; campusId: number }) {
  const { can } = usePermission();
  const puede = can('products.alumnos');
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [filtro, setFiltro] = useState<FiltroAlumnos>('activos');

  useEffect(() => {
    if (!puede) return undefined;
    let vivo = true;
    setCargando(true);
    setError(null);
    alumnosApi.deFormacion(productId, campusId)
      .then((r) => { if (vivo) setDatos(r.data ?? null); })
      .catch((e) => { if (vivo) setError((e as Error).message); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [puede, productId, campusId]);

  const lista = useMemo(() => filtrarAlumnos(datos?.alumnos ?? [], filtro), [datos, filtro]);

  if (!puede) return null;
  const r = datos?.resumen;

  return (
    <section className="space-y-3 rounded-lg border border-border bg-card p-4" aria-labelledby="alumnos-formacion">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="alumnos-formacion" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Student size={16} aria-hidden="true" /> Alumnos
        </h2>
        {datos?.solo_lo_suyo && <span className="text-xs text-muted-foreground">(solo los de tus ventas)</span>}
      </div>

      {error && <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground" role="alert">{error}</p>}
      {cargando && !datos && <p className="text-sm text-muted-foreground">Cargando…</p>}

      {r && (
        <>
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Dato etiqueta="Activos" valor={r.activos} fuerte />
            <Dato etiqueta="Terminados" valor={r.terminados} />
            <Dato etiqueta="Total" valor={r.total} />
            <Dato etiqueta="Al día" valor={r.al_dia} tono={TONO_PAGO.al_dia} />
            <Dato etiqueta="Cuotas pendientes" valor={r.pendiente} tono={TONO_PAGO.pendiente} />
            <Dato etiqueta="Impago" valor={r.impago} tono={TONO_PAGO.impago} />
          </dl>
          <p className="text-xs text-muted-foreground">
            Activo: venta sin anular ni devolver y con el acceso vigente. El acceso acaba con la fecha de fin de la formación, su
            duración publicada o, sin ellas, la regla del campus (curso {datos.regla.curso}, diplomado {datos.regla.diplomado},
            máster {datos.regla.master} meses{datos.regla.configurada ? '' : ', la de serie'}). El estado de pago es de los activos:
            impago = una cuota vencida sin cobrar.
            {r.fuera > 0 && ` No cuentan ${r.fuera} con la venta anulada o devuelta.`}
          </p>

          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Qué alumnos ver">
            {FILTROS.map((f) => (
              <button
                key={f.id} type="button" onClick={() => setFiltro(f.id)} aria-pressed={filtro === f.id}
                className={cn('h-7 rounded-full border px-2.5 text-xs font-medium',
                  filtro === f.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted')}
              >
                {f.texto}
              </button>
            ))}
          </div>

          {lista.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
              {datos.alumnos.length ? 'Ningún alumno con este filtro.' : 'Esta formación aún no tiene ventas.'}
            </p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border" aria-label="Alumnos de la formación">
              {lista.map((a) => (
                <li key={`${a.lead_id ?? 'v'}-${a.venta_id}`}>
                  <Link to={rutaDeVenta(a.venta_id)} className="flex flex-col gap-1 px-3 py-2 text-sm hover:bg-muted sm:flex-row sm:items-center sm:gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-foreground">{a.nombre || a.email || `Venta ${a.venta_id}`}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[a.gestora || 'Sin gestora', a.fecha_venta ? `venta ${fechaCorta(a.fecha_venta)}` : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 sm:shrink-0">
                      <span className="text-xs text-muted-foreground" title={a.detalle_fin}>
                        {a.fin_acceso ? `${a.estado === 'terminado' ? 'Acabó' : 'Hasta'} ${fechaCorta(a.fin_acceso)}` : 'Sin fecha'}
                      </span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        a.estado === 'activo' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                        {textoEstado(a)}
                      </span>
                      {a.pago && a.estado === 'activo' && (
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', TONO_PAGO[a.pago])}>{TEXTO_PAGO[a.pago]}</span>
                      )}
                      <ArrowSquareOut size={13} aria-label="Abrir la venta" className="text-muted-foreground" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Dato({ etiqueta, valor, tono, fuerte }: { etiqueta: string; valor: number; tono?: string; fuerte?: boolean }) {
  return (
    <div className={cn('rounded-md px-2 py-1.5', tono || 'bg-muted')}>
      <dt className="truncate text-[11px] font-medium opacity-80">{etiqueta}</dt>
      <dd className={cn('tabular-nums', fuerte ? 'text-lg font-bold' : 'text-base font-semibold')}>{valor}</dd>
    </div>
  );
}
