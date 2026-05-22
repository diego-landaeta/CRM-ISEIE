import { Package } from '@phosphor-icons/react';
import CountryFlag, { codeFromSlug } from '@/shared/components/ui/CountryFlag';

const SIZE = {
  xs: { box: 'w-6 h-6',  icon: 12, text: 'text-xs' },
  sm: { box: 'w-7 h-7',  icon: 14, text: 'text-sm' },
  md: { box: 'w-9 h-9',  icon: 16, text: 'text-base' },
  lg: { box: 'w-11 h-11', icon: 18, text: 'text-lg' },
};

// Avatar reutilizable: si el proyecto tiene slug `iseie-xx` muestra la bandera
// país (PNG en /flags/). Si no, fallback a emoji o icono Package neutro.
export default function ProjectAvatar({ project, size = 'md', className = '' }) {
  const s = SIZE[size] || SIZE.md;
  const code = codeFromSlug(project?.slug);

  if (code) {
    return (
      <div className={`${s.box} rounded-md overflow-hidden flex-shrink-0 ring-1 ring-border bg-muted ${className}`}>
        <CountryFlag code={code} className="w-full h-full" />
      </div>
    );
  }

  if (project?.emoji) {
    return (
      <div
        className={`${s.box} rounded-md flex items-center justify-center flex-shrink-0 ${s.text} ${className}`}
        style={{ background: project?.theme_color ? `${project.theme_color}1F` : 'hsl(var(--muted))' }}
      >
        <span aria-hidden="true">{project.emoji}</span>
      </div>
    );
  }

  return (
    <div className={`${s.box} rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 ${className}`}>
      <Package size={s.icon} weight="duotone" />
    </div>
  );
}
