import { useState, useEffect, Suspense, lazy } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Toaster from './Toaster';
import { List, X } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import CommandPalette from '@/shared/components/ui/CommandPalette';
import OfflineBanner from '@/shared/components/ui/OfflineBanner';
import PwaInstallPrompt from '@/shared/components/ui/PwaInstallPrompt';
import ShortcutsFAB from '@/shared/components/ui/ShortcutsFAB';
import SectionTabs from './SectionTabs';
import BetaDisclaimer from '@/shared/components/ui/BetaDisclaimer';
import { useAuth } from '@/contexts/AuthContext';
import { tieneWhatsapp } from '@/shared/lib/roles';
import EmptyState from '@/shared/components/ui/EmptyState';
import { LockKey } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { rutaPermitida } from './Sidebar';

/**
 * Una pantalla que el menú no le enseña —le falta su permiso— tampoco se abre
 * escribiendo la dirección (#631, gemela de CRM#643): dice «No tienes acceso» en
 * vez de abrirse a medias y llenarse de 403.
 */
function PantallaConPermiso({ pathname, children }) {
  const { can } = usePermission();
  const { permissions } = useAuth();
  // Sin el mapa de permisos todavía (al entrar), `can` dice que no a todo: no se
  // decide nada hasta que llegue, o saldría un «No tienes acceso» falso.
  if (!permissions || rutaPermitida(pathname, can)) return children;
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <EmptyState
        icon={LockKey}
        title="No tienes acceso a esta pantalla"
        description="Si crees que deberías verla, pídeselo a un administrador."
      />
    </div>
  );
}
// Avisa de un mensaje entrante desde cualquier pantalla. Antes de esto el CRM
// no avisaba de nada cuando entraba un WhatsApp.
const AvisoDeMensaje = lazy(() => import('./AvisoDeMensaje'));
// Los tickets de soporte (#38): en Soporte y en el Manual, como el icono del 360 (#611).
const TicketsLauncher = lazy(() => import('@/modules/soporte/components/TicketsLauncher'));

const COLLAPSED_KEY = 'crm.sidebar.collapsed';

export default function AppLayout() {
  const { permissions } = useAuth();
  // Quien no tiene WhatsApp —el colaborador (#210, QA del 07/10), el tutor (QA
  // del 22/10)…— recibe un 403 del servidor, y el aviso de mensajes preguntaba
  // cada pocos segundos. Se decide con el mismo criterio que el servidor: su
  // permiso (#423), como en MultiCRM.
  const sinWhatsapp = !tieneWhatsapp(permissions);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  const { pathname } = useLocation();

  function toggleCollapsed() {
    setCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0'); } catch { /* */ }
      return next;
    });
  }

  // Cerrar drawer mobile al cambiar de ruta + al pulsar Escape.
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMobileOpen(false); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-background">
      <OfflineBanner />
      <CommandPalette />
      <PwaInstallPrompt />
      <ShortcutsFAB />
      {/* Topbar mobile */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-card border-b border-border flex items-center px-4 z-30">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Abrir menú"
          className="p-2 rounded-md hover:bg-muted transition-colors"
        >
          <List size={22} weight="bold" />
        </button>
        <div className="ml-3 flex items-center">
          <img src="/iseie-logo-color.png" alt="ISEIE" className="h-6 w-auto object-contain dark:hidden" />
          <img src="/iseie-logo.png"       alt="ISEIE" className="h-6 w-auto object-contain hidden dark:block" />
        </div>
      </div>

      {/* Drawer mobile */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-50 transition-opacity duration-200',
          mobileOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-60 transition-transform duration-200',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <Sidebar onNavigate={() => setMobileOpen(false)} />
        </div>
        {/* Botón cerrar — fuera del sidebar, sobre el backdrop */}
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          aria-label="Cerrar menú"
          className={cn(
            'absolute top-3 left-[16rem] p-2 rounded-full bg-card border border-border text-foreground shadow-lg hover:bg-muted transition-all',
            mobileOpen ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
          )}
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      {/* Sidebar desktop */}
      <div className="hidden lg:block">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      {/* Main */}
      <main
        id="main-content"
        className={cn(
          'p-3 pt-[68px] sm:p-4 sm:pt-[72px] lg:p-6 lg:pt-6 xl:p-8 transition-[margin] duration-200',
          collapsed ? 'lg:ml-16' : 'lg:ml-60 xl:ml-64'
        )}
      >
        <SectionTabs />
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        }>
          <div key={pathname} className="animate-in fade-in duration-200">
            <PantallaConPermiso pathname={pathname}>
              <Outlet />
            </PantallaConPermiso>
          </div>
        </Suspense>
      </main>

      {/* Los avisos del CRM. Sin esto, `toast(...)` no pinta nada: el aviso se
          manda y no lo ve nadie. Estuvo asi hasta el 19/08 y por eso «guardar
          un prospecto no hacia nada» — el servidor devolvia el motivo del
          rechazo y la pantalla se lo callaba. */}
      {!sinWhatsapp && (
        <Suspense fallback={null}>
          <AvisoDeMensaje />
        </Suspense>
      )}
      {(pathname.startsWith('/manual') || pathname === '/soporte') && !mobileOpen && (
        <Suspense fallback={null}>
          <TicketsLauncher />
        </Suspense>
      )}
      <Toaster />
    </div>
  );
}
