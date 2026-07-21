import { Outlet } from 'react-router-dom';
import {
  Calculator, ChartBar, TrendUp, Receipt, TrendDown,
  Wallet, HandCoins, CurrencyEur, PlugsConnected, WarningCircle, CreditCard,
} from '@phosphor-icons/react';
import SubNav from '@/shared/components/ui/SubNav';
import BetaDisclaimer from '@/shared/components/ui/BetaDisclaimer';

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
  { label: 'Facturas', to: '/finanzas/facturas', icon: Receipt },
  { label: 'Integraciones', to: '/finanzas/integraciones', icon: PlugsConnected },
];

export default function FinanzasLayout() {
  return (
    <div className="flex flex-col h-full">
      <SubNav tabs={TABS} sectionLabel="Finanzas" sectionIcon={Calculator} />
      <div className="flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
