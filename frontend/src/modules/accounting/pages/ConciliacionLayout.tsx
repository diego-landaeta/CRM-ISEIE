import { NavLink, Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import usePermission from '@/shared/hooks/usePermission';
import { rutaPermitida } from '@/shared/components/layout/Sidebar';
import { cn } from '@/shared/lib/utils';
import { PESTANAS_CONCILIACION } from '../lib/pestanasConciliacion';

/*
  Finanzas › Conciliación (CRM#905): lo que está cobrado y facturado pero sin
  enlazar. Cada pestaña es una pantalla (Facturas y cobros; los cargos de
  Stripe, CRM#906). Las pestañas van dentro de la pantalla, no en una segunda
  barra: Finanzas ya tiene la suya arriba y dos barras seguidas confunden (#79).
*/

/** Las que puede abrir quien mira. Sin el mapa de permisos aún, todas. */
function usePestanas() {
  const { can } = usePermission();
  const { permissions } = useAuth() as { permissions?: Record<string, boolean> | null };
  return permissions ? PESTANAS_CONCILIACION.filter((p) => rutaPermitida(p.to, can)) : PESTANAS_CONCILIACION;
}

/** `/accounting/conciliacion` a secas: la primera pestaña que puede abrir. */
export function ConciliacionInicio() {
  const pestanas = usePestanas();
  return <Navigate to={(pestanas[0] || PESTANAS_CONCILIACION[0]).to} replace />;
}

export default function ConciliacionLayout() {
  const pestanas = usePestanas();
  return (
    <div className="space-y-4">
      {pestanas.length > 1 && (
        <nav aria-label="Conciliación" className="inline-flex flex-wrap rounded-lg border border-border bg-muted/30 p-1 text-sm font-semibold">
          {pestanas.map((p) => (
            <NavLink key={p.to} to={p.to}
              className={({ isActive }) => cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40',
                isActive ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}>
              <p.icon size={14} weight="bold" /> {p.label}
            </NavLink>
          ))}
        </nav>
      )}
      <Outlet />
    </div>
  );
}
