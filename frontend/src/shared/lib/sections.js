// Configuración de "secciones": un grupo de rutas hermanas que comparten
// una barra de tabs horizontal dentro del contenido (no se despliegan en
// el sidebar). El sidebar muestra solo el padre, que navega al primer hijo.
//
// Cada `to` debe coincidir EXACTAMENTE con la `path` declarada en App.jsx.
// `roles` opcional: si está, solo los roles listados ven el tab. superadmin/
// soporte ven todo.

import {
  Users, List, Kanban, Globe, FileText, WebhooksLogo, Package, Tree,
  GraduationCap, TreeStructure, ShoppingCart, Calculator, Receipt,
  Wallet, CurrencyEur, ChartLineUp, Envelope, EnvelopeOpen, Pulse,
  FilePdf, ListNumbers,
} from '@phosphor-icons/react';

export const SECTIONS = [
  {
    id: 'leads',
    label: 'Prospectos',
    icon: Users,
    tabs: [
      { to: '/leads',          label: 'Listado',  icon: List,    end: true },
      { to: '/leads/pipeline', label: 'Pipeline', icon: Kanban },
    ],
  },
  {
    id: 'captacion',
    label: 'Captación',
    icon: Globe,
    roles: ['admin', 'superadmin'],
    tabs: [
      { to: '/forms',         label: 'Formularios',     icon: FileText },
      { to: '/make-webhooks', label: 'Make / Webhooks', icon: WebhooksLogo },
    ],
  },
  {
    id: 'productos',
    label: 'Productos',
    icon: Package,
    tabs: [
      { to: '/products',                       label: 'Catálogo',          icon: Package,        end: true },
      { to: '/products/tree',                  label: 'Árbol',             icon: Tree },
      { to: '/products/pending',               label: 'Cursos pendientes', icon: GraduationCap, roles: ['admin', 'superadmin'] },
      { to: '/configuracion/categorias-arbol', label: 'Categorías',        icon: TreeStructure },
      { to: '/woocommerce',                    label: 'WooCommerce',       icon: ShoppingCart,  roles: ['admin', 'superadmin'] },
    ],
  },
  {
    id: 'contabilidad',
    label: 'Finanzas',
    icon: Calculator,
    tabs: [
      { to: '/accounting',                    label: 'Dashboard',         icon: Calculator,  end: true, roles: ['admin', 'superadmin'] },
      { to: '/sales',                         label: 'Ventas',            icon: Receipt },
      { to: '/accounting/income',             label: 'Ingresos',          icon: CurrencyEur, roles: ['admin', 'superadmin'] },
      { to: '/revenue',                       label: 'Conversiones',      icon: ChartLineUp, roles: ['admin', 'superadmin'] },
      { to: '/expenses',                      label: 'Egresos',           icon: Wallet,      roles: ['admin', 'superadmin'] },
      { to: '/accounting/receivable',         label: 'Cuentas por cobrar', icon: Calculator, roles: ['admin', 'superadmin'] },
      { to: '/accounting/payable',            label: 'Cuentas por pagar',  icon: Calculator, roles: ['admin', 'superadmin'] },
      { to: '/commissions',                   label: 'Comisiones',        icon: CurrencyEur },
      { to: '/payroll',                       label: 'Nóminas',           icon: ChartLineUp, roles: ['admin', 'superadmin'] },
      { to: '/accounting/pendiente-facturar', label: 'Pendientes facturar', icon: Calculator, roles: ['admin', 'superadmin'] },
      { to: '/accounting/pagos-stripe',       label: 'Pagos Stripe',      icon: Calculator,  roles: ['admin', 'superadmin'] },
      { to: '/accounting/integrations',       label: 'Integraciones',     icon: Calculator,  roles: ['admin', 'superadmin'] },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    icon: Envelope,
    roles: ['admin', 'superadmin'],
    tabs: [
      { to: '/email-sequences', label: 'Secuencias', icon: Envelope },
      { to: '/email-templates', label: 'Plantillas', icon: EnvelopeOpen },
    ],
  },
  {
    id: 'analisis',
    label: 'Análisis',
    icon: ChartLineUp,
    tabs: [
      { to: '/reports',  label: 'Reportes',  icon: ChartLineUp, roles: ['admin', 'superadmin'] },
      { to: '/activity', label: 'Actividad', icon: Pulse },
    ],
  },
  {
    id: 'documentos',
    label: 'Documentos',
    icon: FilePdf,
    roles: ['admin', 'superadmin'],
    tabs: [
      { to: '/documentos',        label: 'Listado',    icon: FilePdf,      end: true },
      { to: '/documentos/config', label: 'Numeración', icon: ListNumbers },
    ],
  },
];

// Devuelve la sección activa según la ruta actual, o null.
export function getSectionForPath(pathname) {
  for (const s of SECTIONS) {
    for (const t of s.tabs) {
      // Match exacto del primer tab, o prefijo para sub-rutas (/leads/:id).
      if (t.end) {
        if (pathname === t.to) return s;
      } else if (pathname === t.to || pathname.startsWith(t.to + '/')) {
        return s;
      }
    }
    // También: si el pathname empieza por la ruta base del primer tab
    // (ej. /leads/123 → sección leads aunque el id no esté en tabs).
    const first = s.tabs[0];
    if (first && pathname.startsWith(first.to + '/')) return s;
  }
  return null;
}

// Filtra los tabs visibles según el rol.
export function visibleTabsForRole(tabs, role) {
  if (role === 'superadmin' || role === 'soporte') return tabs;
  return tabs.filter((t) => !t.roles || t.roles.includes(role));
}

// Ruta de entrada de una sección (primer tab visible según rol).
export function defaultRouteForSection(section, role) {
  const visible = visibleTabsForRole(section.tabs, role);
  return visible[0]?.to || section.tabs[0]?.to;
}
