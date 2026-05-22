import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getSectionForPath, visibleTabsForRole } from '@/shared/lib/sections';
import { cn } from '@/shared/lib/utils';

/**
 * Barra de tabs horizontal que aparece automáticamente cuando la ruta actual
 * pertenece a una sección definida en `shared/lib/sections.js`. Reemplaza al
 * antiguo despliegue dentro del sidebar.
 *
 * Se monta una sola vez en AppLayout, antes del <Outlet />. Si la ruta no
 * tiene sección asociada, no renderiza nada.
 */
export default function SectionTabs() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const role = user?.role || 'gestor';

  const section = getSectionForPath(pathname);
  if (!section) return null;
  if (section.roles && !section.roles.includes(role) && role !== 'superadmin' && role !== 'soporte') return null;

  const tabs = visibleTabsForRole(section.tabs, role);
  if (tabs.length <= 1) return null; // Sin hermanos visibles no merece la barra.

  const SectionIcon = section.icon;

  return (
    <nav
      aria-label={section.label}
      className="mb-5 flex items-center gap-1 overflow-x-auto -mx-1 px-1 pb-1 border-b border-border"
    >
      {SectionIcon && (
        <div className="flex items-center gap-2 pr-3 mr-1 border-r border-border flex-shrink-0">
          <SectionIcon size={15} weight="duotone" className="text-primary" />
          <span className="text-[12px] font-semibold text-foreground uppercase tracking-wider hidden sm:inline">{section.label}</span>
        </div>
      )}
      {tabs.map((t) => {
        const Icon = t.icon;
        return (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                'inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] font-medium transition-colors whitespace-nowrap',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
              )
            }
          >
            {Icon && <Icon size={13} weight={t.end ? 'duotone' : 'regular'} />}
            {t.label}
          </NavLink>
        );
      })}
    </nav>
  );
}
