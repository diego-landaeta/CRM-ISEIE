import ListaDeVencimientos from '@/shared/components/ui/ListaDeVencimientos';

/**
 * Qué toca hacer ahora con los prospectos, en orden.
 *
 * La lista, las fechas y el orden viven en `ListaDeVencimientos`, porque la
 * pantalla de Clientes hace la misma pregunta con sus cuotas. Aquí solo queda
 * lo que es de prospectos: de qué campo sale la fecha y cómo se llama todo.
 */

interface LeadMin {
  id: number;
  nombre?: string | null;
  next_reminder_at?: string | null;
  last_interaction_at?: string | null;
  estado?: string | null;
  responsable_nombre?: string | null;
}

export default function SiguientesAcciones({
  leads, onAbrir, onVerTodos,
}: {
  leads: LeadMin[];
  onAbrir?: (id: number) => void;
  onVerTodos?: () => void;
}) {
  return (
    <ListaDeVencimientos
      titulo="Siguientes acciones"
      descripcion="Los seguimientos que tocan, del más vencido al que viene."
      items={leads.map((l) => ({
        id: l.id,
        titulo: l.nombre,
        subtitulo: l.responsable_nombre || 'Sin asignar',
        fecha: l.next_reminder_at,
      }))}
      onAbrir={onAbrir}
      onVerTodos={onVerTodos}
      textoVacio="Nada pendiente en los próximos siete días."
    />
  );
}
