import { Buildings } from '@phosphor-icons/react';
import Select from '@/shared/components/ui/Select';

/**
 * El desplegable de campus de una pantalla que es de UN campus (#218, tanda 3),
 * con una empresa o «Todos los proyectos» en la cabecera. Va con
 * `useCampusDeLaPantalla`. Con un campus en la cabecera no se pinta.
 */
export default function ElegirCampus({ campus, que = 'esta pantalla' }: {
  campus: {
    id: number | null;
    fijo: boolean;
    opciones: Array<{ id: number; nombre: string }>;
    elegir: (id: number | null) => void;
  };
  /** De qué es lo que se elige, para el texto: «sus duplicados», «sus anuncios»… */
  que?: string;
}) {
  if (campus.fijo || campus.opciones.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <Buildings size={16} className="text-muted-foreground" aria-hidden="true" />
      <span className="text-sm text-muted-foreground">Campus de {que}:</span>
      <Select<number | null>
        value={campus.id}
        onChange={(v) => campus.elegir(v)}
        options={campus.opciones.map((c) => ({ value: c.id, label: c.nombre }))}
        placeholder="Elige un campus…"
        ariaLabel={`Campus de ${que}`}
        size="sm"
        className="min-w-[200px]"
      />
    </div>
  );
}
