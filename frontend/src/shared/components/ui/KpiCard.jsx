import { TrendUp, TrendDown } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

/**
 * KpiCard - Tarjeta de KPI reutilizable.
 *
 * props:
 *  - icon: Componente Phosphor
 *  - iconBg: clase Tailwind con bg + text para el cuadrado del icono
 *  - label: etiqueta superior
 *  - value: valor formateado (string) — alternativo a numericValue + format
 *  - numericValue: número crudo (se formatea con `format` si se pasa)
 *  - format: función (n: number) => string para formatear el valor
 *  - badge: texto en badge de tendencia (opcional)
 *  - badgeColor: clases Tailwind para el badge
 *  - trend: 'up' | 'down'
 */
export default function KpiCard({
  icon: Icon,
  iconBg = 'bg-primary/10 text-primary',
  label,
  value = null,
  numericValue = null,
  format = null,
  badge = null,
  badgeColor = 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400',
  trend = 'up',
  className = '',
  tone: _tone = null,
}) {
  const TrendIcon = trend === 'up' ? TrendUp : TrendDown;
  const showBadge = badge && badge !== '--';
  const displayValue = value !== null
    ? value
    : numericValue !== null
      ? (format ? format(numericValue) : String(numericValue))
      : '';
  return (
    <div
      className={cn(
        'bg-card p-5 rounded-lg border border-border transition-colors hover:border-foreground/20',
        className,
      )}
    >
      <div className="flex items-center justify-between mb-3">
        {Icon && (
          <div className={cn('w-9 h-9 rounded-md flex items-center justify-center', iconBg)}>
            <Icon size={18} weight="regular" />
          </div>
        )}
        {showBadge && (
          <span
            className={cn(
              'text-xs font-medium px-2 py-0.5 rounded inline-flex items-center gap-1',
              badgeColor,
            )}
          >
            <TrendIcon size={12} weight="bold" />
            {badge}
          </span>
        )}
      </div>
      <p className="text-muted-foreground text-sm">{label}</p>
      <h3 className="text-xl sm:text-2xl font-semibold mt-1 tabular-nums">{displayValue}</h3>
    </div>
  );
}
