import { ArrowLeft, ArrowRight, X, Plus } from '@phosphor-icons/react';
import { CANALES, iconoDeCanal, nombreDeCanal, type Canal } from '../lib/canales';
import { cn } from '@/shared/lib/utils';

/**
 * Los canales de un paso, en orden.
 *
 * El orden significa algo: el primero es con el que se arranca —«se arranca
 * con llamada por centralita virtual; si falla, WhatsApp»—. Por eso no es un
 * grupo de casillas, que no tiene orden, sino una fila que se puede mover.
 *
 * Se mueven con dos botones y no arrastrando: son dos, tres o cuatro fichas
 * pequeñas, y arrastrar algo de ese tamaño con el ratón —o con el dedo— falla
 * más de lo que acierta. Con botones también funciona con el teclado.
 */

export default function EditorDeCanales({
  canales,
  onChange,
  disabled,
}: {
  canales: Canal[];
  onChange: (canales: Canal[]) => void;
  disabled?: boolean;
}) {
  const sinPoner = CANALES.filter((c) => !canales.includes(c.clave));

  function mover(desde: number, hasta: number) {
    if (hasta < 0 || hasta >= canales.length) return;
    const copia = [...canales];
    const [sacado] = copia.splice(desde, 1);
    copia.splice(hasta, 0, sacado);
    onChange(copia);
  }

  return (
    <div className="space-y-2">
      {canales.length === 0 ? (
        <p className="text-secundario text-muted-foreground px-1">
          Sin canales todavía.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {canales.map((clave, i) => {
            const Icono = iconoDeCanal(clave);
            return (
              <li
                key={clave}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card py-1 pl-2 pr-1"
              >
                {/* El número dice el turno. Sin él, «primero» es una convención
                    que hay que saberse de memoria. */}
                <span className="text-secundario tabular-nums text-muted-foreground">{i + 1}</span>
                {Icono && <Icono size={14} weight="regular" className="text-muted-foreground" />}
                <span className="text-normal">{nombreDeCanal(clave)}</span>
                {!disabled && (
                  <span className="ml-0.5 flex items-center">
                    <button
                      type="button"
                      onClick={() => mover(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Adelantar ${nombreDeCanal(clave)}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <ArrowLeft size={12} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, i + 1)}
                      disabled={i === canales.length - 1}
                      aria-label={`Atrasar ${nombreDeCanal(clave)}`}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <ArrowRight size={12} weight="bold" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(canales.filter((c) => c !== clave))}
                      aria-label={`Quitar ${nombreDeCanal(clave)}`}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive-soft hover:text-destructive-soft-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!disabled && sinPoner.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sinPoner.map(({ clave, nombre, icon: Icono }) => (
            <button
              key={clave}
              type="button"
              onClick={() => onChange([...canales, clave])}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border border-dashed border-border',
                'px-2 py-1 text-normal text-muted-foreground',
                'hover:border-muted-foreground/40 hover:text-foreground',
                'focus:outline-none focus:ring-2 focus:ring-ring/40',
              )}
            >
              <Plus size={11} weight="bold" />
              <Icono size={14} weight="regular" />
              {nombre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
