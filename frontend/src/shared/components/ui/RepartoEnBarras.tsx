import { useMemo } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import Card from '@/shared/components/ui/Card';
import { cn } from '@/shared/lib/utils';
// Traído de MultiCRM. ISEIE no tiene su escala de texto (text-seccion,
// text-secundario): van text-base y text-xs, que son los mismos tamaños.

/**
 * Cómo se reparte un total, en barras.
 *
 * Nació como «Salud comercial» de prospectos —cuántos hay en cada estado— y
 * sirve igual para el dinero de clientes repartido por lo vencido que está.
 * Aquí solo vive la forma: el título, las filas y qué se hace al pulsarlas
 * los pone quien lo use.
 */

export interface FilaReparto {
  /** Lo que se devuelve al pulsar la fila. */
  clave: string;
  etiqueta: string;
  /** El número de esta fila. */
  n: number;
  /** Clase de fondo de la barra. Un token, no un color suelto. */
  barra: string;
  /** Lo que se escribe a la derecha. Por defecto, «n · pct%». */
  texto?: string;
}

export default function RepartoEnBarras({
  titulo,
  descripcion,
  filas,
  total,
  onFila,
  accion,
}: {
  titulo: string;
  descripcion: string;
  filas: FilaReparto[];
  /** El total contra el que se calculan los porcentajes. */
  total: number;
  onFila?: (clave: string) => void;
  accion?: { texto: string; onClick: () => void };
}) {
  const reparto = useMemo(
    () => filas.map((f) => ({ ...f, pct: total > 0 ? Math.round((f.n / total) * 100) : 0 })),
    [filas, total],
  );

  // Sin datos no se pinta un bloque de ceros: ocupa sitio y no dice nada. La
  // tabla de abajo ya avisa de que no hay nada que ver.
  if (total === 0) return null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{descripcion}</p>
        </div>
        {accion && (
          <button
            type="button"
            onClick={accion.onClick}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
          >
            {accion.texto} <ArrowRight size={12} weight="bold" />
          </button>
        )}
      </div>

      <div className="mt-4 space-y-2.5">
        {reparto.map((f) => {
          const Fila = onFila ? 'button' : 'div';
          return (
            <Fila
              key={f.clave}
              {...(onFila ? { type: 'button' as const, onClick: () => onFila(f.clave) } : {})}
              className={cn(
                'block w-full min-w-0 text-left',
                onFila && 'rounded-md focus:outline-none focus:ring-2 focus:ring-ring/40',
              )}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs">{f.etiqueta}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {f.texto ?? `${f.n} · ${f.pct}%`}
                </span>
              </span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                <span className={cn('block h-full rounded-full', f.barra)} style={{ width: `${f.pct}%` }} />
              </span>
            </Fila>
          );
        })}
      </div>
    </Card>
  );
}
