import type { ReactNode } from 'react';
import { MagnifyingGlass, Broom, ArrowClockwise } from '@phosphor-icons/react';
import Card from './Card';
import { cn } from '@/shared/lib/utils';

/**
 * La barra de filtros de una pantalla: una fila, a la vista.
 *
 * Antes cada pantalla resolvía esto a su manera, y la de Prospectos lo metía
 * todo dentro de un desplegable «Filtros»: para saber si había algo filtrado
 * había que abrirlo. Un filtro escondido es un filtro que se olvida puesto, y
 * entonces la pantalla miente sin avisar.
 *
 * Sigue la maqueta: buscador ancho, los desplegables que más se usan, y a la
 * derecha limpiar y actualizar. Lo que no cabe va detrás de `extra` — pero lo
 * que cabe, se ve.
 */

export interface OpcionFiltro {
  value: string;
  label: string;
}

export interface Desplegable {
  /** Para el `aria-label`: el desplegable no lleva etiqueta visible. */
  nombre: string;
  valor: string;
  onChange: (v: string) => void;
  opciones: OpcionFiltro[];
}

interface Props {
  busqueda: string;
  onBusqueda: (v: string) => void;
  placeholder?: string;
  /** Hasta tres: más no caben en una fila sin que se aprieten. */
  desplegables?: Desplegable[];
  /** Se pinta antes de los botones: filtros que no son un desplegable. */
  extra?: ReactNode;
  /** Solo aparece si hay algo que limpiar. */
  onLimpiar?: () => void;
  hayFiltros?: boolean;
  onActualizar?: () => void;
  actualizando?: boolean;
  /**
   * Cuantos han entrado desde la ultima vez, si la pantalla lo sabe.
   *
   * Antes esto vivia en un boton «Refrescar» aparte, arriba: dos botones de
   * recargar en la misma pantalla, que es lo que Diego marco (#125). El aviso
   * no se pierde —es lo unico que aquel hacia de mas—, se muda aqui.
   */
  nuevos?: number;
  /** Píldoras de lo que está filtrado ahora mismo, debajo de la fila. */
  activos?: ReactNode;
  className?: string;
}

const CAMPO = 'h-10 rounded-md border border-border bg-card px-3 text-normal font-medium text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20';

export default function BarraFiltros({
  busqueda,
  onBusqueda,
  placeholder = 'Buscar…',
  desplegables = [],
  extra = null,
  onLimpiar,
  hayFiltros = false,
  onActualizar,
  actualizando = false,
  nuevos = 0,
  activos = null,
  className,
}: Props) {
  // Las rejillas van ESCRITAS, no construidas: Tailwind lee el código fuente
  // tal cual, así que una clase montada con una plantilla —
  // `xl:grid-cols-[${x}]`— no llega nunca a compilarse y la fila sale a partes
  // iguales. Ya me pasó una vez y no se ve hasta que lo miras en pantalla.
  const REJILLA = [
    'xl:grid-cols-[minmax(200px,1fr)_auto]',
    'xl:grid-cols-[minmax(200px,1fr)_170px_auto]',
    'xl:grid-cols-[minmax(200px,1fr)_170px_170px_auto]',
    'xl:grid-cols-[minmax(200px,1fr)_170px_170px_170px_auto]',
  ][Math.min(desplegables.length, 3)];

  return (
    <Card padding="sm" className={cn('space-y-3', className)}>
      <div>
        <div className={cn('grid gap-3', REJILLA)}>
          <label className="relative min-w-0">
            <span className="sr-only">{placeholder}</span>
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            {/* Sin el autocompletado del navegador: Edge ofrecía aquí el correo guardado
                de quien está usando el CRM, porque el texto dice «email». */}
            <input
              autoComplete="off"
              value={busqueda}
              onChange={(e) => onBusqueda(e.target.value)}
              placeholder={placeholder}
              className={cn(CAMPO, 'w-full bg-muted/50 pl-9 pr-3')}
            />
          </label>

          {desplegables.map((d) => (
            <select
              key={d.nombre}
              aria-label={d.nombre}
              value={d.valor}
              onChange={(e) => d.onChange(e.target.value)}
              className={CAMPO}
            >
              {d.opciones.map((o) => (
                <option key={o.value || o.label} value={o.value}>{o.label}</option>
              ))}
            </select>
          ))}

          <div className="flex items-center justify-end gap-2">
            {extra}
            {onLimpiar && hayFiltros && (
              <button
                type="button"
                onClick={onLimpiar}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-normal font-semibold hover:bg-muted"
              >
                <Broom size={15} weight="bold" />
                Limpiar
              </button>
            )}
            {onActualizar && (
              <button
                type="button"
                onClick={onActualizar}
                aria-label={nuevos > 0 ? `Actualizar. Han entrado ${nuevos}` : 'Actualizar'}
                className="relative inline-flex h-10 items-center gap-2 rounded-md bg-primary px-3 text-normal font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <ArrowClockwise size={15} weight="bold" className={actualizando ? 'animate-spin' : undefined} />
                Actualizar
                {nuevos > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-success px-1 text-[10px] font-bold text-success-foreground">
                    {nuevos > 9 ? '9+' : nuevos}
                  </span>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {activos && <div className="flex flex-wrap items-center gap-1.5">{activos}</div>}
    </Card>
  );
}
