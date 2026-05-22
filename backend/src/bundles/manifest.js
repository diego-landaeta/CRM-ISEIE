// ============================================================
// Bundles manifest - define que modulos backend pertenecen a cada bundle.
// El loader de app.js consulta installation_bundles.active_bundles
// y solo registra modulos cuyos bundles esten activos.
//
// NOTA CRM-ISEIE: en v1 montamos modulos directamente desde app.js sin
// gating por bundles. Este manifest queda disponible para cuando se active
// la logica de bundles (controlador /api/installation lo consume para
// devolver `availableBundles` y `activeModules`).
// ============================================================

export const BUNDLES = {
  core: {
    label: 'Core (obligatorio)',
    description: 'Auth, users, projects. Siempre activo.',
    modules: ['auth', 'users', 'projects', 'credentials', 'field-definitions', 'project-channels', 'permissions', 'connectors'],
    requires: [],
  },
  leads: {
    label: 'Leads / Captacion',
    description: 'Pipeline + audiencias + forms + webhooks',
    modules: ['leads', 'forms', 'webhook-tokens', 'audiences', 'make'],
    requires: ['core'],
  },
  comercial: {
    label: 'Comercial / Ventas',
    description: 'Productos + conversiones + comisiones + matriculas + dossiers',
    modules: ['products', 'product-categories', 'conversions', 'commissions', 'matriculas', 'dossiers', 'documents'],
    requires: ['core'],
  },
  accounting: {
    label: 'Contabilidad',
    description: 'Ingresos + egresos + cuentas por cobrar/pagar',
    modules: ['accounting', 'accounts-payable'],
    requires: ['core'],
  },
  payroll: {
    label: 'Nominas',
    description: 'Planes, horas, periodos, ajustes',
    modules: ['payroll'],
    requires: ['core'],
  },
  ia: {
    label: 'IA & Insights',
    description: 'Stripe IA dashboard + Reportes IA + Chat IA',
    modules: ['ia-monitor', 'reports-ia', 'claude-chat'],
    requires: ['core'],
  },
  marketing: {
    label: 'Marketing avanzado',
    description: 'Meta Ads, Google Ads, GSC organico, email seguimiento',
    modules: ['email-sequences', 'email-templates'],
    requires: ['core', 'leads'],
  },
  ecommerce: {
    label: 'E-commerce',
    description: 'WooCommerce sync',
    modules: ['woocommerce'],
    requires: ['core', 'comercial'],
  },
  reports: {
    label: 'Reportes basicos',
    description: 'Dashboards y reportes consolidados',
    modules: ['reports'],
    requires: ['core'],
  },
};

export function resolveActiveModules(activeBundles = []) {
  const set = new Set();
  for (const b of activeBundles) {
    const bundle = BUNDLES[b];
    if (!bundle) continue;
    for (const m of bundle.modules) set.add(m);
  }
  return set;
}

export function listAllBundles() {
  return Object.entries(BUNDLES).map(([key, v]) => ({ key, ...v }));
}
