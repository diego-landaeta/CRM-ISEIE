import { cn } from '@/shared/lib/utils';

/**
 * PageHeader - Cabecera consistente de pagina.
 *
 * props:
 *  - title: titulo principal
 *  - subtitle: texto secundario
 *  - actions: nodo React con botones a la derecha
 *  - breadcrumbs: nodo opcional arriba del titulo
 */
export default function PageHeader({ title, subtitle = null, actions = null, breadcrumbs = null, className = '' }) {
  return (
    <div className={cn('flex flex-col sm:flex-row sm:items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        {breadcrumbs && <div className="mb-1">{breadcrumbs}</div>}
        <h1 className="text-xl font-semibold truncate">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground text-sm mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
