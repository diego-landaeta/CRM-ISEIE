import { useMemo, type ReactNode } from 'react';
import { ArrowRight, CheckCircle } from '@phosphor-icons/react';
import Card from '@/shared/components/ui/Card';
// En ISEIE las iniciales y el color del avatar viven en `leadFormat`, no en
// `shared/lib/ui` como en MultiCRM: se usan las de aquí para que la misma
// persona salga del mismo color en la tabla y en esta lista.
import { getInitials, getAvatarColor as avatarColorFor } from '@/modules/leads/lib/leadFormat';
import { cuandoVence } from '@/shared/lib/fechas';
// Traído de MultiCRM. ISEIE no tiene su escala de texto (text-seccion,
// text-secundario, text-normal): van text-base, text-xs y text-sm, que son
// los mismos tamaños.
import { seleccionar, type Orden } from '@/shared/lib/vencimientos';
import { cn } from '@/shared/lib/utils';

/**
 * Lo que vence pronto, del más atrasado al que viene.
 *
 * Nació como «Siguientes acciones» de prospectos: la tabla va ordenada por
 * fecha, que sirve para buscar a alguien y es lo peor para empezar el día
 * —lo urgente queda repartido por las siete páginas—. Esto saca los primeros
 * por urgencia y ya está: no es otra tabla, es por dónde empezar.
 *
 * Vale igual para las cuotas de un cliente, que es la misma pregunta con otro
 * nombre. Lo único que cambia es qué se le pasa.
 */

export interface Vencimiento {
  id: number;
  /** Lo que se lee en grande. El nombre de quien sea. */
  titulo: string | null | undefined;
  /** La línea de debajo: la gestora, el producto, lo que aclare la fila. */
  subtitulo?: string | null;
  /** Cuándo vence. Sin ella, la fila no entra. */
  fecha?: string | null;
  /**
   * Lo que va debajo de la fecha, a la derecha: el importe de una cuota, por
   * ejemplo. No va en el subtítulo porque ahí se corta —la tarjeta es
   * estrecha— y «cuándo» sin «cuánto» no alcanza para decidir a quién se
   * llama primero.
   */
  detalle?: string | null;
}

export default function ListaDeVencimientos({
  titulo,
  descripcion,
  items,
  onAbrir,
  onVerTodos,
  textoVerTodos = 'Ver todos',
  textoVacio,
  maximo = 5,
  ventanaDias = 7,
  orden = 'urgencia',
  filtros,
  onVerVencidas,
}: {
  titulo: string;
  descripcion: string;
  items: Vencimiento[];
  onAbrir?: (id: number) => void;
  onVerTodos?: () => void;
  textoVerTodos?: string;
  textoVacio: string;
  maximo?: number;
  ventanaDias?: number | null;
  /**
   * «¿Por dónde empiezo?» (urgencia, lo de siempre) o «¿qué viene ahora?»
   * (proximidad). Ordenan al revés, y confundirlas es lo que hacía que
   * «Próximos cobros» enseñara deudas de hace 285 días.
   */
  orden?: Orden;
  /** Los botones de ventana, si la pantalla ofrece elegirla. */
  filtros?: ReactNode;
  /** Para ir a ver lo vencido que se ha quedado fuera de la lista. */
  onVerVencidas?: () => void;
}) {
  const { filas: cola, vencidasFuera } = useMemo(
    () => seleccionar(items, { orden, ventanaDias, maximo }),
    [items, orden, ventanaDias, maximo],
  );

  return (
    // Con nombre: es un bloque con su propia pregunta dentro de una pantalla
    // que tiene varios, y sin nombre un lector de pantalla solo anuncia «grupo».
    <Card role="region" aria-label={titulo} className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{titulo}</h2>
          <p className="text-xs text-muted-foreground">{descripcion}</p>
        </div>
        {onVerTodos && (
          <button
            type="button"
            onClick={onVerTodos}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-semibold hover:bg-muted"
          >
            {textoVerTodos} <ArrowRight size={12} weight="bold" />
          </button>
        )}
      </div>

      {filtros && <div className="mt-3 flex flex-wrap items-center gap-1.5">{filtros}</div>}

      {/* Lo vencido no se esconde, pero deja de comerse la lista de lo que
          viene: se cuenta aquí y se puede ir a verlo. Callárselo convertiría
          una lista honesta en una lista incompleta. */}
      {vencidasFuera > 0 && (
        <p className="mt-3 text-xs">
          <span className="font-semibold text-destructive">
            {vencidasFuera} {vencidasFuera === 1 ? "vencida" : "vencidas"}
          </span>
          <span className="text-muted-foreground">
            {orden === 'vencidas' ? ' sin caber en la lista' : ' de antes'}
          </span>
          {/* Estando ya en las vencidas, «verlas» no llevaría a ninguna parte:
              para el resto está «Ver todos». */}
          {onVerVencidas && orden !== 'vencidas' && (
            <button
              type="button"
              onClick={onVerVencidas}
              className="ml-1.5 font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring/40 rounded"
            >
              verlas
            </button>
          )}
        </p>
      )}

      {cola.length === 0 ? (
        <div className="mt-4 flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <CheckCircle size={28} weight="duotone" className="text-success" />
          <p className="text-xs text-muted-foreground">{textoVacio}</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-1.5">
          {cola.map((it) => {
            const c = cuandoVence(it.fecha);
            // Sin sitio al que ir, la fila no finge que se puede pulsar.
            const Fila = onAbrir ? 'button' : 'div';
            return (
              <li key={it.id}>
                <Fila
                  {...(onAbrir ? { type: 'button' as const, onClick: () => onAbrir(it.id) } : {})}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                    onAbrir && 'hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/40',
                  )}
                >
                  <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold', avatarColorFor(it.id))}>
                    {getInitials(it.titulo)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{it.titulo || 'Sin nombre'}</span>
                    {it.subtitulo && (
                      <span className="block truncate text-xs text-muted-foreground">{it.subtitulo}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn('block text-xs font-semibold', c.urgente ? 'text-destructive' : 'text-muted-foreground')}>
                      {c.texto}
                    </span>
                    {it.detalle && (
                      <span className="block text-xs tabular-nums text-muted-foreground">{it.detalle}</span>
                    )}
                  </span>
                </Fila>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
