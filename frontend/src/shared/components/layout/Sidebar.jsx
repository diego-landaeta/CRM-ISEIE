import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import {
  SquaresFour, Users, UserCheck, Package, ChartLineUp, Gear, SignOut,
  Moon, Sun, CaretLeft, CaretRight, UserCircle,
  CaretUp, CaretDown, Bell, Pulse, Calculator, Envelope, Globe,
  FilePdf, ShieldCheck, MagnifyingGlass, Headset, BookOpen, Sliders,
  Megaphone, Robot, Sparkle, PlugsConnected, CreditCard, WarningCircle, WhatsappLogo,
  ChatText,
  Receipt, Coins, Wrench, ShoppingBag, ChatCircleText, Wallet, Bank, Clock, GitMerge,
  UsersThree,
  GraduationCap,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/shared/lib/utils';
import client from '@/shared/api/client';
import NotificationsBell from './NotificationsBell';
import { isBetaAllowed, BETA_MODE } from '@/shared/config/betaConfig';

const ROLE_LABELS = { superadmin: 'Superadmin', admin: 'Admin', gestor: 'Gestor', soporte: 'Soporte', tutor: 'Tutor' };

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
      // WhatsApp cuelga de su propia entrada, con lo suyo escalonado debajo: son
      // tres pantallas del mismo sitio, no tres apartados sueltos del menu.
      {
        label: 'WhatsApp',
        icon: WhatsappLogo,
        apagable: 'whatsapp',
        children: [
          // Solo administradores POR AHORA. Enlazar un numero por esta via puede
          // acabar con el bloqueado por WhatsApp, y quien lo paga es la gestora con
          // su telefono. Se abre a todo el mundo cuando este el aviso previo (#45).
          { to: '/whatsapp/chat', label: 'Chat', roles: ['superadmin', 'admin'] },
          { to: '/whatsapp', label: 'Mi WhatsApp', end: true, roles: ['superadmin', 'admin'] },
          // Sin recorte por rol: cada gestora enlaza SU numero, y el servidor solo
          // la deja tocar el suyo.
          { to: '/whatsapp/conexion', label: 'Conexión', roles: ['superadmin', 'admin'] },
          { to: '/whatsapp/plantillas', label: 'Plantillas', roles: ['superadmin', 'admin'] },
          // Solo para quien manda: entrar en el WhatsApp de cada gestora.
          // Fuera del menu: usaba el navegador remoto, que se ha retirado.
          // Vuelve cuando se rehaga sobre el chat nuevo.
          // { to: '/whatsapp/equipo', label: 'WhatsApp del equipo', roles: ['superadmin', 'admin'] },
        ],
      },
      // Ventas vive en Principal (flujo diario) y también en Finanzas. Clientes
      // y Revisión duplicados pasan a la sección Clientes al final.
      { to: '/sales',      label: 'Ventas',     icon: Receipt },
    ],
  },
  {
    label: 'Captación',
    items: [
      { to: '/email-sequences', label: 'Email',     icon: Envelope, roles: ['admin', 'superadmin'], sectionPrefixes: ['/email-sequences', '/email-templates'] },
      { to: '/forms',           label: 'Formularios', icon: Globe,  roles: ['admin', 'superadmin'], sectionPrefixes: ['/forms'] },
      { to: '/make-webhooks',   label: 'Make',      icon: PlugsConnected, roles: ['admin', 'superadmin'] },
      { to: '/webhooks',        label: 'Webhooks',  icon: PlugsConnected, roles: ['admin', 'superadmin'] },
      { to: '/captacion/whatsapp', label: 'Widget web', icon: WhatsappLogo, roles: ['admin', 'superadmin', 'soporte'] },
      { to: '/campaigns',       label: 'Campañas',  icon: Megaphone, roles: ['admin', 'superadmin'], sectionPrefixes: ['/campaigns'] },
      { to: '/seo',             label: 'Tráfico orgánico', icon: MagnifyingGlass, roles: ['admin', 'superadmin'] },
    ],
  },
  {
    label: 'Publicidad',
    items: [
      { to: '/meta-ads',   label: 'Meta Ads',   icon: ChartLineUp, roles: ['admin', 'superadmin'] },
      { to: '/google-ads', label: 'Google Ads', icon: ChartLineUp, roles: ['admin', 'superadmin'], comingSoon: true },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { to: '/products',   label: 'Productos',  icon: Package, sectionPrefixes: ['/products'] },
      { to: '/products/pending', label: 'Cursos pendientes', icon: Clock, roles: ['admin', 'superadmin'] },
      { to: '/woocommerce', label: 'WooCommerce', icon: ShoppingBag, roles: ['admin', 'superadmin'] },
      { to: '/configuracion/categorias-arbol', label: 'Árbol de categorías', icon: Sliders, roles: ['admin', 'superadmin'] },
      { to: '/documentos', label: 'Certificados', icon: FilePdf, roles: ['admin', 'superadmin'], sectionPrefixes: ['/documentos'] },
    ],
  },
  {
    label: 'Tutores',
    items: [
      { to: '/tutores', label: 'Tutores', icon: GraduationCap, roles: ['admin', 'superadmin'], sectionPrefixes: ['/tutores'] },
      // Lo unico que ve un tutor: sus cursos y lo que le corresponde.
      { to: '/mis-cursos', label: 'Mis cursos', icon: GraduationCap, roles: ['tutor'] },
      { to: '/tutores/comisiones', label: 'Comisiones', icon: Coins, roles: ['admin', 'superadmin'] },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      { to: '/sales',                label: 'Dashboard',          icon: Calculator, roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/sales',                label: 'Ventas',             icon: Receipt, statusTag: 'Pruebas' },
      { to: '/accounting/income',    label: 'Ingresos',           icon: Coins,      roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/revenue',              label: 'Conversiones',       icon: ChartLineUp, roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/expenses',             label: 'Egresos',            icon: Receipt,    roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/accounting/receivable', label: 'Cuentas por cobrar', icon: Wallet,    roles: ['admin', 'superadmin', 'soporte', 'gestor'] },
      { to: '/accounting/payable',   label: 'Cuentas por pagar',  icon: Wallet,     roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/commissions',          label: 'Comisiones',         icon: Bank,  roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/payroll',              label: 'Nóminas',            icon: Coins,      roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/accounting/pendiente-facturar', label: 'Pendientes de facturar', icon: WarningCircle, roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
      { to: '/accounting/pagos-stripe', label: 'Pagos Stripe',    icon: PlugsConnected, roles: ['admin', 'superadmin'] },
      { to: '/accounting/facturas', label: 'Facturación', icon: FilePdf, roles: ['admin', 'superadmin', 'soporte', 'gestor'], sectionPrefixes: ['/accounting/facturas'] },
      { to: '/accounting/integrations', label: 'Integraciones',   icon: PlugsConnected, roles: ['admin', 'superadmin'], statusTag: 'Pruebas' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/reports',     label: 'Reportes',      icon: ChartLineUp, sectionPrefixes: ['/reports', '/activity'] },
      { to: '/ai-chat',     label: 'Chat IA',       icon: ChatCircleText, roles: ['admin', 'superadmin'] },
    ],
  },
  {
    // Clientes = consulta de datos de clientes (no ventas). Va al final.
    label: 'Clientes',
    items: [
      { to: '/clients',    label: 'Clientes',   icon: UserCheck, sectionPrefixes: ['/clients'] },
      { to: '/leads/revision-duplicados', label: 'Revisión duplicados', icon: GitMerge, roles: ['admin', 'superadmin'] },
      { to: '/matriculas', label: 'Matrículas', icon: UserCheck },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/solicitudes-cambio', label: 'Solicitudes de cambio', icon: GitMerge },
      { to: '/notificaciones', label: 'Notificaciones',   icon: Bell },
      // El tutor entra aqui: es donde cambia su contraseña.
      { to: '/preferences',    label: 'Mis preferencias', icon: Sliders, roles: ['superadmin', 'admin', 'gestor', 'tutor'] },
      { to: '/soporte',        label: 'Soporte',          icon: Headset },
      { to: '/manual',         label: 'Manual del CRM',   icon: BookOpen },
      { to: '/status',         label: 'Status',           icon: Pulse },
    ],
  },
];

// Interruptor de compilacion para dejar una parte fuera de una instalacion sin
// borrar su codigo. Se usa con WhatsApp, que en produccion todavia no se enciende
// —esta en revision— pero viaja en el mismo build que el resto.
const APAGADOS = String(import.meta.env.VITE_MODULOS_APAGADOS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

function canSeeItem(item, role, soloColaboraciones) {
  if (item.apagable && APAGADOS.includes(item.apagable)) return false;
  // Un tutor solo ve lo suyo: lo que no le nombre expresamente queda fuera.
  // Al reves —listar lo prohibido— se olvida siempre algo, y lo que se olvida
  // es un tutor paseandose por Prospectos o por Finanzas.
  if (role === 'tutor') return Array.isArray(item.roles) && item.roles.includes('tutor');
  // Un gestor de colaboraciones se dedica SOLO a los tutores: no lleva
  // prospectos, ni ventas, ni finanzas. Se declara lo que puede ver, igual que
  // con el tutor — enumerar lo prohibido deja fuera siempre la pantalla nueva.
  if (soloColaboraciones) {
    return ['/tutores', '/tutores/comisiones', '/preferences'].includes(item.to);
  }

  if (!item.roles) return true;
  if (role === 'superadmin' || role === 'soporte') return true;
  return item.roles.includes(role);
}

function NavItem({ to, label, icon: Icon, end, comingSoon, statusTag, collapsed, onClick, sectionPrefixes }) {
  const location = useLocation();
  if (comingSoon) {
    const tag = statusTag || 'Próx.';
    const title = statusTag ? `${label} — ${statusTag}` : `${label} — Próximamente`;
    return (
      <div
        title={title}
        className={cn(
          'relative flex items-center rounded-md text-[13px] text-muted-foreground/45 cursor-not-allowed select-none',
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-1.5'
        )}
      >
        <Icon size={18} weight="regular" />
        {!collapsed && <span className="truncate">{label}</span>}
        {!collapsed && <span className="ml-auto text-[9px] uppercase tracking-wider bg-muted/60 text-muted-foreground/70 px-1.5 py-0.5 rounded">{tag}</span>}
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
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-1.5',
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


// Una entrada con lo suyo escalonado debajo. Se abre y se cierra, y lo de
// dentro se sangra con una guia a la izquierda para que se vea de un vistazo
// que pertenece a ella.
function NavGroup({ label, icon: Icon, items, role, soloColab, collapsed, onNavigate, onExpandSidebar }) {
  const location = useLocation();
  const visible = items
    .filter((c) => canSeeItem(c, role, soloColab))
    .map((c) => ({ ...c, comingSoon: c.comingSoon || !isBetaAllowed(c.to) }));
  const hasActiveChild = visible.some(
    (c) => !c.comingSoon && (location.pathname === c.to || location.pathname.startsWith(c.to + '/'))
  );
  const [open, setOpen] = useState(hasActiveChild);
  // Si se llega desde fuera a una pantalla de dentro, el grupo se abre solo:
  // si no, el apartado marcado como activo quedaria escondido.
  useEffect(() => { if (hasActiveChild) setOpen(true); }, [hasActiveChild]);
  if (!visible.length) return null;

  // Colapsado (sidebar mini) solo cabe el icono: al pulsarlo se despliega la
  // barra y se abre el grupo, en vez de dejar al usuario sin salida.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => { onExpandSidebar?.(); setOpen(true); }}
        title={label}
        aria-label={label}
        className={cn(
          'w-full flex items-center justify-center h-10 rounded-md transition-colors',
          hasActiveChild ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        )}
      >
        <Icon size={18} weight={hasActiveChild ? 'duotone' : 'regular'} />
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors',
          hasActiveChild ? 'text-foreground font-semibold' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        )}
      >
        <Icon size={18} weight={hasActiveChild ? 'duotone' : 'regular'} />
        <span className="truncate">{label}</span>
        <CaretRight size={12} weight="bold" className={cn('ml-auto transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 pl-3 border-l border-border/60 space-y-0.5">
          {visible.map((child) => (
            <NavItem
              key={child.to}
              to={child.to}
              label={child.label}
              icon={child.icon || Icon}
              end={child.end}
              comingSoon={child.comingSoon}
              statusTag={child.statusTag}
              onClick={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Decide qué sección debe estar abierta por defecto: Principal (siempre) +
// la que contenga la ruta actual. Devuelve un map { [section.label]: boolean }.
function defaultOpenSections(sections, pathname) {
  const out = {};
  for (const s of sections) {
    const containsActive = s.items.some((it) => {
      // Una entrada con hijos no tiene ruta propia: cuenta lo de dentro.
      if (it.children) {
        return it.children.some((c) => pathname === c.to || (c.to && pathname.startsWith(c.to + '/')));
      }
      if (pathname === it.to) return true;
      if (it.sectionPrefixes?.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
      if (it.to && it.to !== '/' && pathname.startsWith(it.to + '/')) return true;
      return false;
    });
    out[s.label] = s.label === 'Principal' || containsActive;
  }
  return out;
}

function CollapsibleNav({ sections, role, soloColab, collapsed, onNavigate, onExpandSidebar }) {
  const location = useLocation();
  const STORAGE_KEY = 'crm-sidebar-sections-v1';
  const [openMap, setOpenMap] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...defaultOpenSections(sections, location.pathname), ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaultOpenSections(sections, location.pathname);
  });

  // Cuando cambia la ruta, NO sobrescribimos las preferencias del usuario
  // (esto sería molesto). Solo abrimos la sección activa si estaba cerrada.
  useEffect(() => {
    const auto = defaultOpenSections(sections, location.pathname);
    setOpenMap((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(auto)) {
        if (auto[k] && !next[k]) next[k] = true;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function toggle(label) {
    setOpenMap((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <nav className="flex-1 overflow-y-auto -mx-2 px-2 space-y-2">
      {sections.map((section) => {
        const items = section.items
          .map((it) => {
            if (it.sectionPrefixes?.includes('/reports') && it.sectionPrefixes?.includes('/activity')) {
              const isAdmin = role === 'admin' || role === 'superadmin' || role === 'soporte';
              return { ...it, to: isAdmin ? '/reports' : '/activity' };
            }
            return it;
          })
          .filter((it) => canSeeItem(it, role, soloColab))
          // Una entrada con hijos no tiene ruta que mirar: lo de BETA lo decide
          // cada hijo por su cuenta, dentro de NavGroup.
          .map((it) => (it.children ? it : { ...it, comingSoon: it.comingSoon || !isBetaAllowed(it.to) }));
        if (!items.length) return null;

        const pintar = (item) => (item.children ? (
          <NavGroup
            key={'g|' + item.label}
            label={item.label}
            icon={item.icon}
            items={item.children}
            soloColab={soloColab}
            role={role}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onExpandSidebar={onExpandSidebar}
          />
        ) : (
          <NavItem
            key={item.to + '|' + item.label}
            to={item.to}
            label={item.label}
            icon={item.icon}
            end={item.end}
            comingSoon={item.comingSoon}
            statusTag={item.statusTag}
            collapsed={collapsed}
            onClick={onNavigate}
            sectionPrefixes={item.sectionPrefixes}
          />
        ));

        // En modo colapsado (sidebar mini) no mostramos headers ni colapso —
        // todos los items se ven como iconos en línea.
        if (collapsed) {
          return (
            <div key={section.label} className="space-y-0.5">
              {items.map(pintar)}
            </div>
          );
        }

        const open = !!openMap[section.label];
        return (
          <div key={section.label}>
            <button
              type="button"
              onClick={() => toggle(section.label)}
              aria-expanded={open}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 transition-colors select-none"
            >
              <span>{section.label}</span>
              <CaretDown
                size={10}
                weight="bold"
                className={cn('transition-transform duration-150', open ? '' : '-rotate-90')}
              />
            </button>
            {open && (
              <div className="space-y-0.5 mt-0.5 ml-1 pl-2 border-l border-border/50">
                {items.map(pintar)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function Sidebar({ collapsed = false, onToggleCollapsed, onNavigate }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

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
  // Quien lleva las colaboraciones no es una gestora: se la llama por su trabajo,
  // que es dar de alta profesores y ajustarles el porcentaje.
  const rolLabel = user?.gestor_colaboraciones ? 'Colaboraciones' : (ROLE_LABELS[role] || '');

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

      {/* Nav — secciones colapsables. El estado se persiste en localStorage por
          sección. Por defecto se abre la sección que contiene la ruta activa
          (más "Principal" siempre como ancla). El usuario puede plegar/expandir
          libremente con click en el header de sección. */}
      <CollapsibleNav
        sections={NAV_SECTIONS}
        role={role}
        soloColab={user?.gestor_colaboraciones === true
          && !['superadmin', 'admin', 'soporte'].includes(role)}
        collapsed={collapsed}
        onNavigate={onNavigate}
        onExpandSidebar={onToggleCollapsed}
      />

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
          <NotificationsBell collapsed={collapsed} />
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
              onClick={() => { setUserMenuOpen(false); navigate('/manual'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <BookOpen size={15} />
              Manual del CRM
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/soporte'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <Headset size={15} />
              Soporte
            </button>
            <div className="my-1 border-t border-border" />
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
    </aside>
  );
}
