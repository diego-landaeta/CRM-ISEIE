import {
  Circle,
  Clock,
  Phone,
  ChartLineUp,
  CheckCircle,
  XCircle,
} from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

// Mapeo canonico de colores (debe coincidir con DashboardPage.jsx lineas 20-25)
export const STATUS_STYLES = {
  nuevo: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',
  por_contactar: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400',
  contactado: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
  en_seguimiento: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',
  convertido: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400',
  no_interesado: 'bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400',
};

export const STATUS_LABELS = {
  nuevo: 'Nuevo',
  por_contactar: 'Por contactar',
  contactado: 'Contactado',
  en_seguimiento: 'En seguimiento',
  convertido: 'Convertido',
  no_interesado: 'No interesado',
};

const STATUS_ICONS = {
  nuevo: Circle,
  por_contactar: Clock,
  contactado: Phone,
  en_seguimiento: ChartLineUp,
  convertido: CheckCircle,
  no_interesado: XCircle,
};

export const STATUS_KEYS = [
  'nuevo',
  'por_contactar',
  'contactado',
  'en_seguimiento',
  'convertido',
  'no_interesado',
];

/**
 * @param {{ status: string; showIcon?: boolean; className?: string }} props
 */
export default function StatusBadge({ status, showIcon = false, className = '' }) {
  const style = STATUS_STYLES[status] || 'bg-muted text-muted-foreground';
  const label = STATUS_LABELS[status] || status;
  const Icon = STATUS_ICONS[status];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium',
        style,
        className,
      )}
    >
      {showIcon && Icon && <Icon size={11} weight="bold" />}
      {label}
    </span>
  );
}
