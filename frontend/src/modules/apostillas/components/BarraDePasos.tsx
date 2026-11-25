import { Check, XCircle } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import { PASOS, CANCELADA, numeroDePaso, type EstadoApostilla } from '../lib/apostillas';

/*
  La barra de pasos de una apostilla (Diego, 25/11: «que se vea simple»).

  Seis pasos en orden: los hechos con su marca, el actual resaltado con los días
  que lleva en él, y los que faltan en gris. Cancelada no es un paso: se dice
  encima, en rojo. `compacta` es la versión de una fila de la lista.
*/

interface Props {
  estado: EstadoApostilla;
  diasEnEstado?: number;
  atascada?: boolean;
  compacta?: boolean;
}

export default function BarraDePasos({ estado, diasEnEstado = 0, atascada = false, compacta = false }: Props) {
  const actual = numeroDePaso(estado);
  if (estado === 'cancelada') {
    return (
      <p className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-destructive" role="status">
        <XCircle size={14} weight="bold" /> {CANCELADA.texto}
      </p>
    );
  }
  if (compacta) {
    return (
      <div className="flex items-center gap-1" aria-label={`Paso ${actual} de ${PASOS.length}: ${PASOS[actual - 1]?.texto}`}>
        {PASOS.map((p, i) => (
          <span key={p.clave} title={p.texto}
            className={cn('h-1.5 w-4 rounded-full',
              i + 1 < actual ? 'bg-primary' : i + 1 === actual ? (atascada ? 'bg-warning' : 'bg-primary/60') : 'bg-muted')} />
        ))}
      </div>
    );
  }
  return (
    <ol className="grid grid-cols-3 sm:grid-cols-6 gap-2" aria-label="Pasos de la apostilla">
      {PASOS.map((p, i) => {
        const n = i + 1;
        const hecho = n < actual || (n === actual && estado === 'entregada');
        const esActual = n === actual && estado !== 'entregada';
        return (
          <li key={p.clave} aria-current={esActual ? 'step' : undefined}
            className={cn('rounded-md border px-2 py-1.5 text-[11px] leading-tight',
              hecho && 'border-primary/40 bg-primary/10 text-foreground',
              esActual && (atascada ? 'border-warning bg-warning-soft text-warning-soft-foreground font-semibold'
                : 'border-primary bg-primary text-primary-foreground font-semibold'),
              !hecho && !esActual && 'border-border text-muted-foreground')}>
            <span className="flex items-center gap-1">
              {hecho ? <Check size={11} weight="bold" /> : <span className="tabular-nums">{n}.</span>}
              {p.corto}
            </span>
            {esActual && <span className="block font-normal opacity-90">{diasEnEstado < 1 ? 'desde hoy' : `${diasEnEstado} d`}</span>}
          </li>
        );
      })}
    </ol>
  );
}
