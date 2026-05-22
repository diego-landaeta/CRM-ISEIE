import { NavLink } from 'react-router-dom';
import { List, Kanban } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';

export interface LeadsViewToggleProps {
  active?: 'list' | 'kanban';
}

const VIEWS = [
  { id: 'list',   to: '/leads',          label: 'Lista',    icon: List },
  { id: 'kanban', to: '/leads/pipeline', label: 'Pipeline', icon: Kanban },
] as const;

export default function LeadsViewToggle({ active = 'list' }: LeadsViewToggleProps) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md border border-border bg-card">
      {VIEWS.map((v) => {
        const isActive = active === v.id;
        return (
          <NavLink
            key={v.id}
            to={v.to}
            className={cn(
              'inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-xs font-medium transition-colors',
              isActive ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
          >
            <v.icon size={13} weight={isActive ? 'fill' : 'regular'} />
            {v.label}
          </NavLink>
        );
      })}
    </div>
  );
}
