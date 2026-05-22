import { useNavigate, Link } from 'react-router-dom';
import { Compass, ArrowLeft, House } from '@phosphor-icons/react';

const QUICK_LINKS = [
  { to: '/dashboard', label: 'Dashboard', icon: House },
];

export default function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 bg-background">
      <div className="max-w-md w-full text-center">
        <div className="relative w-20 h-20 mx-auto mb-6">
          <div className="absolute inset-0 rounded-full bg-primary/15 blur-2xl" />
          <div className="relative w-full h-full rounded-full bg-primary/10 ring-1 ring-primary/30 text-primary flex items-center justify-center">
            <Compass size={32} weight="duotone" />
          </div>
        </div>

        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/80 mb-2">Error 404</p>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Página no encontrada</h1>
        <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
          La ruta que buscas no existe o se ha movido. Puedes volver atrás o ir al dashboard.
        </p>

        <div className="flex items-center justify-center gap-2 mb-8">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted transition-colors"
          >
            <ArrowLeft size={14} weight="bold" /> Volver atrás
          </button>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            <House size={14} weight="bold" /> Ir al dashboard
          </Link>
        </div>

        <div className="border-t border-border pt-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-3">Atajos</p>
          <div className="grid grid-cols-1 gap-2">
            {QUICK_LINKS.map((l) => {
              const Icon = l.icon;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  className="inline-flex items-center gap-2 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted hover:border-primary/30 transition-colors text-foreground"
                >
                  <Icon size={14} weight="duotone" className="text-primary" />
                  {l.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
