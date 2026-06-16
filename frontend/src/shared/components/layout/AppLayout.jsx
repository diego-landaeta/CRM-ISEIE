import { useState, useEffect, Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import { List, X } from '@phosphor-icons/react';
import { cn } from '@/shared/lib/utils';
import CommandPalette from '@/shared/components/ui/CommandPalette';
import OfflineBanner from '@/shared/components/ui/OfflineBanner';
import PwaInstallPrompt from '@/shared/components/ui/PwaInstallPrompt';
import ShortcutsFAB from '@/shared/components/ui/ShortcutsFAB';
import SectionTabs from './SectionTabs';

const COLLAPSED_KEY = 'crm.sidebar.collapsed';

export default function AppLayout() {
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
        {/* Banner global "EN PRUEBAS" para todo el bloque de Finanzas. */}
        {/^\/(sales|expenses|accounting|commissions|payroll)(\/|$)/.test(pathname) && (
          <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2 mb-4 flex items-center gap-2 text-xs">
            <svg className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" fill="currentColor" viewBox="0 0 256 256"><path d="M128 24a104 104 0 1 0 104 104A104.13 104.13 0 0 0 128 24Zm-8 56a8 8 0 0 1 16 0v56a8 8 0 0 1-16 0Zm8 128a12 12 0 1 1 12-12 12 12 0 0 1-12 12Z"/></svg>
            <span className="font-semibold text-amber-900 dark:text-amber-300">EN PRUEBAS</span>
            <span className="text-amber-800 dark:text-amber-400">
              · Esta sección está en periodo de pruebas. Los datos son reales pero algunos automatismos están en validación.
            </span>
          </div>
        )}
        <Suspense fallback={
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        }>
          <div key={pathname} className="animate-in fade-in duration-200">
            <Outlet />
          </div>
        </Suspense>
      </main>
    </div>
  );
}
