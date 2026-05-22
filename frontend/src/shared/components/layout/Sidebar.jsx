import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import {
  SquaresFour, Users, UserCheck, Package, ChartLineUp, Gear, SignOut,
  Moon, Sun, CaretLeft, CaretRight, UserCircle, CurrencyEur, Receipt,
  CaretUp, CaretDown, Bell, Pulse, Calculator, Envelope, Globe,
  FilePdf, ShieldCheck, MagnifyingGlass, Headset, BookOpen, Sliders,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/shared/lib/utils';
import ProjectAvatar from '@/shared/components/ui/ProjectAvatar';
import client from '@/shared/api/client';
import { lazy, Suspense } from 'react';

const ProjectSettingsDialog = lazy(() => import('@/modules/settings/components/ProjectSettingsDialog'));

const ROLE_LABELS = { superadmin: 'Superadmin', admin: 'Admin', gestor: 'Gestor', soporte: 'Soporte' };

// Quita el prefijo "ISEIE " del nombre del proyecto en la UI del switcher.
// El logo ya identifica la marca; mostrar "ISEIE España" + logo ISEIE es redundante.
function shortProjectName(nombre) {
  if (!nombre) return '';
  return nombre.replace(/^ISEIE\s+/i, '').trim() || nombre;
}

// NAV_SECTIONS: agrupaciones del sidebar. Las "secciones" (Prospectos,
// Captación, Productos, Contabilidad) son ahora una sola entrada en el
// sidebar que navega al primer hijo; los hijos viven como tabs horizontales
// dentro de la página (ver shared/lib/sections.js + SectionTabs.jsx).
const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard',  label: 'Dashboard',  icon: SquaresFour, end: true },
      { to: '/leads',      label: 'Prospectos', icon: Users,       sectionPrefixes: ['/leads'] },
      { to: '/clients',    label: 'Clientes',   icon: UserCheck,   sectionPrefixes: ['/clients'] },
      { to: '/matriculas', label: 'Matrículas', icon: UserCheck },
    ],
  },
  {
    label: 'Captación',
    items: [
      { to: '/email-sequences', label: 'Email',     icon: Envelope, roles: ['admin', 'superadmin'], sectionPrefixes: ['/email-sequences', '/email-templates'] },
      { to: '/forms',           label: 'Captación', icon: Globe,    roles: ['admin', 'superadmin'], sectionPrefixes: ['/forms', '/make-webhooks'] },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { to: '/products',   label: 'Productos',  icon: Package, sectionPrefixes: ['/products', '/configuracion/categorias-arbol', '/woocommerce'] },
      { to: '/documentos', label: 'Documentos', icon: FilePdf, roles: ['admin', 'superadmin'], sectionPrefixes: ['/documentos'] },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/sales', label: 'Contabilidad', icon: Calculator, sectionPrefixes: ['/sales', '/expenses', '/accounting', '/commissions', '/payroll'] },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/reports', label: 'Análisis', icon: ChartLineUp, sectionPrefixes: ['/reports', '/activity'] },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/notifications', label: 'Notificaciones',   icon: Bell },
      { to: '/preferences',   label: 'Mis preferencias', icon: Sliders },
      { to: '/soporte',       label: 'Soporte',          icon: Headset },
      { to: '/status',        label: 'Status',           icon: Pulse },
      { to: '/manual',        label: 'Manual',           icon: BookOpen },
      { to: '/profile',       label: 'Mi cuenta',        icon: UserCircle },
      { to: '/settings',      label: 'Configuración',    icon: Gear },
    ],
  },
];

function canSeeItem(item, role) {
  if (!item.roles) return true;
  if (role === 'superadmin' || role === 'soporte') return true;
  return item.roles.includes(role);
}

function NavItem({ to, label, icon: Icon, end, comingSoon, collapsed, onClick, sectionPrefixes }) {
  const location = useLocation();
  if (comingSoon) {
    return (
      <div
        title={`${label} — Próximamente`}
        className={cn(
          'relative flex items-center rounded-md text-[13px] text-muted-foreground/45 cursor-not-allowed select-none',
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-2'
        )}
      >
        <Icon size={18} weight="regular" />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && <span className="ml-auto text-[9px] uppercase tracking-wider bg-muted/60 text-muted-foreground/70 px-1.5 py-0.5 rounded">Próx.</span>}
      </div>
    );
  }

  // Para items con `sectionPrefixes`, NavLink no detecta como activo cuando
  // el usuario está en una ruta hermana (ej. /leads/pipeline cuando to=/leads).
  // Calculamos manualmente con prefix match.
  const isPrefixActive = sectionPrefixes
    ? sectionPrefixes.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'))
    : false;

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) => {
        const active = isActive || isPrefixActive;
        return cn(
          'relative flex items-center rounded-md text-[13px] transition-colors',
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-2',
          active
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        );
      }}
    >
      {({ isActive }) => {
        const active = isActive || isPrefixActive;
        return (
          <>
            {active && !collapsed && (
              <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
            )}
            <Icon size={18} weight={active ? 'duotone' : 'regular'} />
            {!collapsed && <span className="truncate">{label}</span>}
          </>
        );
      }}
    </NavLink>
  );
}


export default function Sidebar({ collapsed = false, onToggleCollapsed, onNavigate }) {
  const { user, logout } = useAuth();
  const { activeProject, projects, switchProject } = useProjectContext();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const userMenuRef = useRef(null);
  const projectMenuRef = useRef(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    function onDocClick(e) {
      if (!projectMenuRef.current?.contains(e.target)) setProjectMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [projectMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDoc = (e) => { if (!userMenuRef.current?.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [userMenuOpen]);

  async function handleLogout() {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  }

  const role = user?.role || 'gestor';
  const initials = user?.nombre?.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  const rolLabel = ROLE_LABELS[role] || '';
  const [unreadCount, setUnreadCount] = useState(0);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);

  // Refresca el badge de notificaciones cada 60s consumiendo /leads/today.
  // Cuenta: recordatorios pendientes + cobros vencidos + leads inactivos.
  useEffect(() => {
    if (!user || !activeProject?.id) { setUnreadCount(0); return; }
    let cancelled = false;
    async function load() {
      try {
        const res = await client.get('/leads/today', { params: { projectId: activeProject.id } });
        const s = res?.data || res || {};
        const n =
          (s.reminders_pendientes?.length || 0) +
          (s.cobros_vencidos || 0) +
          (s.inactivos || 0);
        if (!cancelled) setUnreadCount(Math.min(99, n));
      } catch {
        if (!cancelled) setUnreadCount(0);
      }
    }
    load();
    const id = setInterval(load, 60000);
    return () => { cancelled = true; clearInterval(id); };
  }, [user?.id, activeProject?.id]);

  return (
    <aside
      role="navigation"
      aria-label="Menu principal"
      className={cn(
        'border-r bg-card h-screen flex flex-col z-40 transition-[width] duration-200',
        'lg:fixed lg:left-0 lg:top-0',
        collapsed ? 'w-16 p-2' : 'w-60 lg:w-64 p-4'
      )}
    >
      {/* Logo + badge BETA + toggle */}
      <div className={cn('flex items-center mb-4', collapsed ? 'flex-col gap-2' : 'gap-2 px-2')}>
        {collapsed ? (
          <img src="/iseie-icon-192.png" alt="ISEIE" className="w-8 h-8 object-contain flex-shrink-0" />
        ) : (
          <>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <img src="/iseie-logo-color.png" alt="ISEIE" className="h-7 w-auto object-contain object-left dark:hidden" />
              <img src="/iseie-logo.png"       alt="ISEIE" className="h-7 w-auto object-contain object-left hidden dark:block" />
              <span
                title="Versión 1.0.1 — beta"
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[9px] font-bold uppercase tracking-wider self-start"
              >
                Beta
              </span>
            </div>
          </>
        )}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expandir' : 'Colapsar'}
            aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            className="hidden lg:flex p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
          >
            {collapsed ? <CaretRight size={14} weight="bold" /> : <CaretLeft size={14} weight="bold" />}
          </button>
        )}
      </div>

      {/* Project picker + gear */}
      {!collapsed && activeProject && (
        <div ref={projectMenuRef} className="relative mb-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-1 px-1">
            Proyecto
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setProjectMenuOpen((v) => !v)}
              disabled={projects.length <= 1}
              className="flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 rounded-md bg-secondary/40 border border-border hover:bg-secondary/70 disabled:cursor-default transition-colors text-left"
            >
              <ProjectAvatar project={activeProject} size="xs" />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="text-[12px] font-semibold truncate text-foreground">{shortProjectName(activeProject.nombre)}</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">{activeProject.slug}</div>
              </div>
              {projects.length > 1 && (
                <CaretDown size={11} weight="bold" className={cn('text-muted-foreground transition-transform', projectMenuOpen && 'rotate-180')} />
              )}
            </button>
            <button
              type="button"
              onClick={() => setProjectSettingsOpen(true)}
              title="Ajustes del proyecto"
              aria-label="Ajustes del proyecto"
              className="flex-shrink-0 p-1.5 rounded-md border border-border bg-secondary/40 hover:bg-secondary/70 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Gear size={13} weight="bold" />
            </button>
          </div>
          {projectMenuOpen && projects.length > 1 && (
            <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-80 overflow-y-auto rounded-lg border border-border bg-card shadow-lg p-1">
              {projects.map((p) => {
                const isActive = p.id === activeProject.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => { switchProject(p.id); setProjectMenuOpen(false); }}
                    className={cn(
                      'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-left text-[13px] transition-colors',
                      isActive ? 'bg-primary/10 text-primary font-semibold' : 'hover:bg-secondary text-foreground'
                    )}
                  >
                    <ProjectAvatar project={p} size="sm" />
                    <span className="flex-1 truncate">{shortProjectName(p.nombre)}</span>
                    {isActive && <span className="text-[10px] text-primary">●</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
      {collapsed && activeProject && (
        <button
          type="button"
          onClick={() => setProjectMenuOpen((v) => !v)}
          title={activeProject.nombre}
          className="mb-4 flex justify-center w-full"
        >
          <ProjectAvatar project={activeProject} size="sm" />
        </button>
      )}

      {/* Trigger del CommandPalette (atajo Ctrl/Cmd + K). El render del modal
          vive en AppLayout; aquí solo disparamos el evento keydown sintético. */}
      {!collapsed && (
        <button
          type="button"
          onClick={() => {
            const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
            window.dispatchEvent(ev);
          }}
          className="mb-3 relative w-full h-8 pl-8 pr-12 rounded-md bg-secondary/40 border border-border text-[12px] text-left text-muted-foreground/80 hover:bg-secondary/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors"
          aria-label="Abrir búsqueda global"
        >
          <MagnifyingGlass size={13} weight="bold" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
          Buscar…
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-card text-muted-foreground">
            Ctrl K
          </kbd>
        </button>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto -mx-2 px-2 space-y-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items
            .map((it) => {
              // Resuelve `to` por rol cuando hace falta — caso "Análisis":
              // admin va a /reports, gestor va a /activity (no tiene reports).
              if (it.sectionPrefixes?.includes('/reports') && it.sectionPrefixes?.includes('/activity')) {
                const isAdmin = role === 'admin' || role === 'superadmin' || role === 'soporte';
                return { ...it, to: isAdmin ? '/reports' : '/activity' };
              }
              return it;
            })
            .filter((it) => canSeeItem(it, role));
          if (!items.length) return null;
          return (
            <div key={section.label}>
              {!collapsed && (
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 px-3 mb-1.5">
                  {section.label}
                </div>
              )}
              <div className="space-y-0.5">
                {items.map((item) => (
                  <NavItem
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    end={item.end}
                    comingSoon={item.comingSoon}
                    collapsed={collapsed}
                    onClick={onNavigate}
                    sectionPrefixes={item.sectionPrefixes}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* User menu + notification bell */}
      <div className="mt-4 pt-4 border-t border-border relative" ref={userMenuRef}>
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'gap-1')}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className={cn(
              'flex items-center rounded-md transition-colors hover:bg-secondary/60 flex-1 min-w-0',
              collapsed ? 'justify-center p-1.5 w-full' : 'gap-2.5 p-2'
            )}
          >
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-semibold truncate">{user?.nombre || 'Sin sesión'}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{rolLabel}</div>
                </div>
                {userMenuOpen ? <CaretDown size={12} weight="bold" className="text-muted-foreground flex-shrink-0" /> : <CaretUp size={12} weight="bold" className="text-muted-foreground flex-shrink-0" />}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => navigate('/notifications')}
            title="Notificaciones"
            aria-label="Notificaciones"
            className={cn(
              'relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0',
              collapsed && 'w-full flex justify-center'
            )}
          >
            <Bell size={16} weight={unreadCount > 0 ? 'fill' : 'regular'} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center ring-2 ring-card">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>

        {userMenuOpen && (
          <div className={cn(
            'absolute bottom-full mb-2 bg-card border border-border rounded-lg shadow-xl py-1 z-50',
            collapsed ? 'left-full ml-2 w-48' : 'left-0 right-0'
          )}>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <UserCircle size={15} />
              Mi cuenta
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/settings'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <Gear size={15} />
              Configuración
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); toggleTheme(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <SignOut size={15} />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
      <Suspense fallback={null}>
        <ProjectSettingsDialog
          open={projectSettingsOpen}
          onClose={() => setProjectSettingsOpen(false)}
          projectId={activeProject?.id || null}
        />
      </Suspense>
    </aside>
  );
}
