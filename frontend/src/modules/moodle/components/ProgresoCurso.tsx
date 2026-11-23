import { cn } from '@/shared/lib/utils';

/**
 * El % del curso hecho por un alumno (el avance de Moodle, #532), con su barra; «—» si no
 * hay dato, con el motivo para el lector de pantalla y al pasar el ratón. Lo usan «Mi
 * campus» de la tutora (#681) y la ficha del cliente (#532).
 */
export default function ProgresoCurso({ valor, motivo }: { valor: number | null | undefined; motivo: string }) {
  if (valor === null || valor === undefined) {
    return <span className="text-muted-foreground" title={motivo}>—<span className="sr-only">: {motivo}</span></span>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-muted sm:block">
        <span className={cn('block h-full rounded-full', valor >= 100 ? 'bg-success' : 'bg-primary')} style={{ width: `${valor}%` }} />
      </span>
      <span className="tabular-nums text-foreground">{valor}%</span>
    </span>
  );
}
