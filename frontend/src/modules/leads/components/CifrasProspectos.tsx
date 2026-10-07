import { UsersThree, UserMinus, Clock, CheckCircle } from '@phosphor-icons/react';
import { Cifra, FilaDeCifras } from '@/shared/components/ui/Cifra';

/**
 * Las cuatro cifras de la pantalla de prospectos.
 *
 * La tarjeta y la fila viven en `shared/components/ui/Cifra`: Clientes lleva
 * su propia fila de cuatro y tiene que ser la misma pieza. Aquí queda lo que
 * es de prospectos — cuáles son las cuatro y de dónde salen.
 */

interface Stats {
  total?: number;
  convertido?: number;
  sin_asignar?: number;
}

interface Urgencias {
  overdue: number;
  today: number;
  urgent: number;
}

export default function CifrasProspectos({
  stats, urgencias, filtroRapido, onFiltroRapido,
}: {
  stats: Stats;
  urgencias: Urgencias;
  filtroRapido?: string | null;
  onFiltroRapido?: (clave: string | null) => void;
}) {
  const total = stats.total ?? 0;
  if (total === 0) return null;

  const sinAsignar = stats.sin_asignar ?? 0;
  const convertidos = stats.convertido ?? 0;
  const alternar = (clave: string) => onFiltroRapido?.(filtroRapido === clave ? null : clave);

  return (
    <FilaDeCifras>
      <Cifra
        icon={UsersThree}
        etiqueta="Prospectos"
        valor={total}
        detalle="con los filtros puestos"
      />
      <Cifra
        icon={UserMinus}
        etiqueta="Sin asignar"
        valor={sinAsignar}
        detalle={sinAsignar > 0 ? 'no los trabaja nadie' : 'todos tienen gestora'}
        tono={sinAsignar > 0 ? 'aviso' : 'bien'}
      />
      <Cifra
        icon={Clock}
        etiqueta="Piden atención"
        valor={urgencias.urgent}
        detalle={`${urgencias.overdue} vencidos · ${urgencias.today} para hoy`}
        tono={urgencias.urgent > 0 ? 'peligro' : 'bien'}
        activo={filtroRapido === 'urgent'}
        onClick={onFiltroRapido ? () => alternar('urgent') : undefined}
      />
      <Cifra
        icon={CheckCircle}
        etiqueta="Convertidos"
        valor={convertidos}
        detalle={`${Math.round((convertidos / total) * 100)}% de los visibles`}
        tono="bien"
      />
    </FilaDeCifras>
  );
}
