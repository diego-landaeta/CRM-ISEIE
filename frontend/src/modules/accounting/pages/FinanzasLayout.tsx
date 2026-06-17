import { Outlet } from 'react-router-dom';
import {
  Calculator, ChartBar, TrendUp, Receipt, TrendDown,
  Wallet, HandCoins, CurrencyEur, PlugsConnected, WarningCircle, CreditCard,
} from '@phosphor-icons/react';
import SubNav from '@/shared/components/ui/SubNav';

const TABS = [
  { label: 'Dashboard', to: '/finanzas', icon: ChartBar },
  { label: 'Ventas', to: '/finanzas/ventas', icon: Receipt },
  { label: 'Ingresos', to: '/finanzas/ingresos', icon: TrendUp },
  { label: 'Conversiones', to: '/finanzas/conversiones', icon: CurrencyEur },
  { label: 'Egresos', to: '/finanzas/egresos', icon: TrendDown },
  { label: 'Por cobrar', to: '/finanzas/por-cobrar', icon: Wallet },
  { label: 'Por pagar', to: '/finanzas/por-pagar', icon: Receipt },
  { label: 'Comisiones', to: '/finanzas/comisiones', icon: HandCoins },
  { label: 'Nóminas', to: '/finanzas/nominas', icon: Calculator },
  { label: 'Pendientes facturar', to: '/finanzas/pendiente-facturar', icon: WarningCircle },
  { label: 'Pagos Stripe', to: '/finanzas/pagos-stripe', icon: CreditCard },
  { label: 'Integraciones', to: '/finanzas/integraciones', icon: PlugsConnected },
];

export default function FinanzasLayout() {
  return (
    <div className="flex flex-col h-full">
      <SubNav tabs={TABS} sectionLabel="Finanzas" sectionIcon={Calculator} />
      {/* Banner global de la sección — todo Finanzas está en pruebas */}
      <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-200 dark:border-amber-900 px-4 py-2 flex items-center gap-2 text-xs">
        <WarningCircle size={14} weight="fill" className="text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span className="font-semibold text-amber-900 dark:text-amber-300">EN PRUEBAS</span>
        <span className="text-amber-800 dark:text-amber-400">
          · Esta sección está en periodo de pruebas. Los datos son reales pero algunos automatismos están en validación.
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
