import { NavLink } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';

interface Tab {
  label: string;
  to: string;
  icon?: any;
  /** false: sigue marcada en sus subrutas (Matrículas → Certificaciones). */
  end?: boolean;
}

interface Props {
  tabs: Tab[];
  sectionLabel?: string;
  sectionIcon?: any;
}

export default function SubNav({ tabs, sectionLabel, sectionIcon: Icon }: Props) {
  return (
    <nav
      className={cn(
        // Los margenes negativos deshacen el relleno del contenido (AppLayout:
        // p-4 lg:p-6 xl:p-8). Sin esto la barra sale metida hacia dentro y su
        // borde inferior corta por la mitad de la pantalla.
        '-mx-4 -mt-4 mb-4 lg:-mx-6 lg:-mt-6 lg:mb-6 xl:-mx-8 xl:-mt-8',
        'flex items-center gap-1 overflow-x-auto border-b border-border',
        'bg-background px-4 py-2 lg:px-6 xl:px-8',
      )}
    >
      {sectionLabel && (
        <span className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground uppercase tracking-wide mr-3 flex-shrink-0">
          {Icon && <Icon size={14} weight="bold" />}
          {sectionLabel}
        </span>
      )}
      {tabs.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end !== false}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )
          }
        >
          {tab.icon && <tab.icon size={13} weight="bold" />}
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
