// Vistas por defecto de los 4 roles fijos del sistema.
// Los roles custom guardan su `default_view` JSONB en la tabla custom_roles.
// El frontend recibe el view_config resuelto vía /auth/me.

export const SYSTEM_ROLE_VIEWS = {
  superadmin: {
    default_route: '/dashboard',
    hidden_sidebar_items: [],
    dashboard_widgets: ['stats_global', 'leads_today', 'conversions_recent', 'pipeline_summary', 'income_month'],
    compact_sidebar: false,
  },
  admin: {
    default_route: '/dashboard',
    hidden_sidebar_items: [],
    dashboard_widgets: ['leads_today', 'conversions_recent', 'pipeline_summary', 'income_month', 'reminders_pending'],
    compact_sidebar: false,
  },
  gestor: {
    default_route: '/leads',
    hidden_sidebar_items: ['accounting', 'payroll', 'reports', 'settings_advanced', 'webhooks', 'campaigns', 'users'],
    dashboard_widgets: ['my_leads_today', 'my_reminders', 'my_conversions_month'],
    compact_sidebar: false,
  },
  soporte: {
    default_route: '/status/soporte',
    hidden_sidebar_items: ['accounting', 'payroll', 'campaigns'],
    dashboard_widgets: ['system_status', 'errors_recent', 'incidents_active'],
    compact_sidebar: true,
  },
};

// Catálogo de widgets disponibles (para que admin pueda activar/desactivar en custom roles)
export const DASHBOARD_WIDGETS_CATALOG = [
  { id: 'stats_global',         label: 'Estadísticas globales',  scope: 'admin' },
  { id: 'leads_today',          label: 'Prospectos de hoy',       scope: 'admin' },
  { id: 'my_leads_today',       label: 'Mis prospectos de hoy',   scope: 'gestor' },
  { id: 'pipeline_summary',     label: 'Resumen del pipeline',    scope: 'all' },
  { id: 'conversions_recent',   label: 'Conversiones recientes',  scope: 'admin' },
  { id: 'my_conversions_month', label: 'Mis conversiones del mes', scope: 'gestor' },
  { id: 'income_month',         label: 'Ingresos del mes',        scope: 'admin' },
  { id: 'reminders_pending',    label: 'Recordatorios pendientes', scope: 'all' },
  { id: 'my_reminders',         label: 'Mis recordatorios',       scope: 'all' },
  { id: 'system_status',        label: 'Estado del sistema',      scope: 'soporte' },
  { id: 'errors_recent',        label: 'Errores recientes',       scope: 'soporte' },
  { id: 'incidents_active',     label: 'Incidentes activos',      scope: 'soporte' },
  { id: 'campaigns_performance', label: 'Performance campañas',   scope: 'admin' },
];

// Catálogo de items del sidebar que se pueden ocultar (los IDs deben coincidir con `id` en Sidebar.jsx)
export const SIDEBAR_ITEMS_CATALOG = [
  { id: 'dashboard',           label: 'Dashboard' },
  { id: 'leads',               label: 'Prospectos' },
  { id: 'clients',             label: 'Clientes' },
  { id: 'matriculas',          label: 'Matrículas' },
  { id: 'email_sequences',     label: 'Email seguimiento' },
  { id: 'campaigns',           label: 'Campañas (Meta/Google/SEO)' },
  { id: 'forms',               label: 'Formularios' },
  { id: 'webhooks',            label: 'Webhooks' },
  { id: 'products',            label: 'Productos' },
  { id: 'documents',           label: 'Documentos' },
  { id: 'accounting',          label: 'Contabilidad' },
  { id: 'payroll',             label: 'Nóminas' },
  { id: 'commissions',         label: 'Comisiones' },
  { id: 'reports',             label: 'Reportes' },
  { id: 'ia',                  label: 'IA / Insights' },
  { id: 'users',               label: 'Usuarios' },
  { id: 'settings_advanced',   label: 'Configuración avanzada' },
];
