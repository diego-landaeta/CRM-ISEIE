import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Suspense, lazy, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Layout y guardas
const AppLayout = lazy(() => import('./shared/components/layout/AppLayout'));
const ProtectedRoute = lazy(() => import('./shared/components/layout/ProtectedRoute'));

// Públicas (sin layout, sin protección)
const LoginPage = lazy(() => import('./shared/pages/LoginPage'));
const SetPasswordPage = lazy(() => import('./shared/pages/SetPasswordPage'));

// Privadas
const DashboardPage = lazy(() => import('./shared/pages/DashboardPage'));
const NotFoundPage = lazy(() => import('./shared/pages/NotFoundPage'));
const LeadsPage = lazy(() => import('./modules/leads/pages/LeadsPage'));
const LeadsPipelinePage = lazy(() => import('./modules/leads/pages/LeadsPipelinePage'));
const LeadDetailPage = lazy(() => import('./modules/leads/pages/LeadDetailPage'));
const LeadsArchivedPage = lazy(() => import('./modules/leads/pages/LeadsArchivedPage'));
const ProductsPage = lazy(() => import('./modules/products/pages/ProductsPage'));
const ProductDetailPage = lazy(() => import('./modules/products/pages/ProductDetailPage'));
const CoursesPendingPage = lazy(() => import('./modules/products/pages/CoursesPendingPage'));
const ProductsTreePage = lazy(() => import('./modules/products/pages/ProductsTreePage'));
const ClientsPage = lazy(() => import('./modules/clients/pages/ClientsPage'));
const ClientDetailPage = lazy(() => import('./modules/clients/pages/ClientDetailPage'));
const AccountingDashboardPage = lazy(() => import('./modules/accounting/pages/AccountingDashboardPage'));
const IncomePage = lazy(() => import('./modules/accounting/pages/IncomePage'));
const ReceivablePage = lazy(() => import('./modules/accounting/pages/ReceivablePage'));
const IntegrationsPage = lazy(() => import('./modules/accounting/pages/IntegrationsPage'));
const PendienteFacturarPage = lazy(() => import('./modules/accounting/pages/PendienteFacturarPage'));
const StripePaymentsPage = lazy(() => import('./modules/accounting/pages/StripePaymentsPage'));
const WhatsappWidgetPage = lazy(() => import('./modules/widget/pages/WhatsappWidgetPage'));
const InvoicesPage = lazy(() => import('./modules/invoices/pages/InvoicesPage'));
const InvoicingConfigPage = lazy(() => import('./modules/invoices/pages/InvoicingConfigPage'));
const InvoiceTemplateEditorPage = lazy(() => import('./modules/invoices/pages/InvoiceTemplateEditorPage'));
const InvoiceCreatePage = lazy(() => import('./modules/invoices/pages/InvoiceCreatePage'));
const RevenuePage = lazy(() => import('./modules/revenue/pages/RevenuePage'));
const ChannelsConfigPage = lazy(() => import('./modules/settings/pages/ChannelsConfigPage'));
const ShortcutsConfigPage = lazy(() => import('./modules/settings/pages/ShortcutsConfigPage'));
const ExternalPanelPage = lazy(() => import('./modules/external-panels/pages/ExternalPanelPage'));
const ManualPage = lazy(() => import('./modules/manual/pages/ManualPage'));
const PreferencesPage = lazy(() => import('./modules/preferences/pages/PreferencesPage'));
const SeoPage = lazy(() => import('./modules/seo/pages/SeoPage'));
const SoportePage = lazy(() => import('./modules/soporte/pages/SoportePage'));
const CommissionsPage = lazy(() => import('./modules/commissions/pages/CommissionsPage'));
const ExpensesPage = lazy(() => import('./modules/expenses/pages/ExpensesPage'));
const ProfilePage = lazy(() => import('./shared/pages/ProfilePage'));
const SettingsPage = lazy(() => import('./shared/pages/SettingsPage'));
const SalesPage = lazy(() => import('./modules/sales/pages/SalesPage'));
const MetaAdsPage = lazy(() => import('./modules/meta-ads/pages/MetaAdsPage'));
const ChangeRequestsPage = lazy(() => import('./modules/change-requests/pages/ChangeRequestsPage'));
const ChangeRequestDetailPage = lazy(() => import('./modules/change-requests/pages/ChangeRequestDetailPage'));
const DupReviewQueuePage = lazy(() => import('./modules/leads/pages/DupReviewQueuePage'));
const ReportsPage = lazy(() => import('./shared/pages/ReportsPage'));
const NotificacionesPage = lazy(() => import('./modules/notificaciones/pages/NotificacionesPage'));
const ActivityPage = lazy(() => import('./shared/pages/ActivityPage'));
const StatusPage = lazy(() => import('./shared/pages/StatusPage'));

// Módulos portados desde el hermano (paridad 2026-05-22).
const RolesPage = lazy(() => import('./modules/permissions/pages/RolesPage'));
const FieldDefinitionsPage = lazy(() => import('./modules/field-definitions/pages/FieldDefinitionsPage'));
const CategoriesTreePage = lazy(() => import('./modules/product-categories/pages/CategoriesTreePage'));
const MatriculasPage = lazy(() => import('./modules/matriculas/pages/MatriculasPage'));
const AccountsPayablePage = lazy(() => import('./modules/accounts-payable/pages/AccountsPayablePage'));
const PayrollPage = lazy(() => import('./modules/payroll/pages/PayrollPage'));
const DocumentsPage = lazy(() => import('./modules/documents/pages/DocumentsPage'));
const DocumentsConfigPage = lazy(() => import('./modules/documents/pages/DocumentsConfigPage'));
const FormsPage = lazy(() => import('./modules/forms/pages/FormsPage'));
const EmbedFormPage = lazy(() => import('./modules/forms/pages/EmbedFormPage'));
const EmailSequencesPage = lazy(() => import('./modules/email-sequences/pages/EmailSequencesPage'));
const EmailTemplatesPage = lazy(() => import('./modules/email-templates/pages/EmailTemplatesPage'));
const MakeWebhooksPage = lazy(() => import('./modules/make-webhooks/pages/MakeWebhooksPage'));
const MakeWebhookDetailPage = lazy(() => import('./modules/make-webhooks/pages/MakeWebhookDetailPage'));
const WooCommercePage = lazy(() => import('./modules/woocommerce/pages/WooCommercePage'));

const ROUTE_TITLES = {
  '/dashboard':                       'Dashboard',
  '/leads':                           'Prospectos',
  '/products':                        'Productos',
  '/sales':                           'Ventas',
  '/commissions':                     'Comisiones',
  '/expenses':                        'Egresos',
  '/accounting/payable':              'Cuentas por pagar',
  '/accounting/integrations':         'Integraciones',
  '/accounting/pendiente-facturar':   'Pendientes de facturar',
  '/accounting/pagos-stripe':         'Pagos Stripe',
  '/accounting/facturas':             'Facturas',
  '/accounting/facturas/configuracion':'Configuración de facturación',
  '/payroll':                         'Nóminas',
  '/matriculas':                      'Matrículas',
  '/forms':                           'Formularios',
  '/make-webhooks':                   'Make / Webhooks',
  '/woocommerce':                     'WooCommerce',
  '/email-sequences':                 'Secuencias de email',
  '/email-templates':                 'Plantillas de email',
  '/documentos':                      'Documentos',
  '/configuracion/categorias-arbol':  'Categorías',
  '/configuracion/campos':            'Campos personalizados',
  '/roles':                           'Roles',
  '/status':                          'Status',
  '/reports':                         'Reportes',
  '/notificaciones':                  'Notificaciones',
  '/activity':                        'Actividad',
  '/profile':                         'Mi cuenta',
  '/settings':                        'Configuración',
  '/login':                           'Iniciar sesión',
  '/set-password':                    'Establecer contraseña',
};

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    const base = 'CRM ISEIE';
    const route = ROUTE_TITLES[pathname];
    document.title = route ? `${route} — ${base}` : base;
  }, [pathname]);
  return null;
}

// Redirige a /dashboard si está autenticado, a /login si no.
function RootRedirect() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  return <Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />;
}

const Spinner = () => (
  <div className="flex h-screen items-center justify-center text-muted-foreground">
    Cargando…
  </div>
);

function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <ScrollToTop />
      <DocumentTitle />
      <Routes>
        {/* Públicas */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/embed/form/:embedId" element={<EmbedFormPage />} />

        {/* Privadas (con layout) */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/pipeline" element={<LeadsPipelinePage />} />
          <Route path="/leads/archived" element={<LeadsArchivedPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/products/pending" element={<CoursesPendingPage />} />
          <Route path="/products/tree" element={<ProductsTreePage />} />
          <Route path="/products/:id" element={<ProductDetailPage />} />
          <Route path="/sales" element={<SalesPage />} />
          <Route path="/meta-ads" element={<MetaAdsPage />} />
          <Route path="/leads/revision-duplicados" element={<DupReviewQueuePage />} />
          <Route path="/commissions" element={<CommissionsPage />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/accounting" element={<AccountingDashboardPage />} />
          <Route path="/accounting/income" element={<IncomePage />} />
          <Route path="/accounting/receivable" element={<ReceivablePage />} />
          <Route path="/accounting/payable" element={<AccountsPayablePage />} />
          <Route path="/accounting/integrations" element={<IntegrationsPage />} />
          <Route path="/accounting/pendiente-facturar" element={<PendienteFacturarPage />} />
          <Route path="/accounting/pagos-stripe" element={<StripePaymentsPage />} />
          <Route path="/accounting/facturas" element={<InvoicesPage />} />
          <Route path="/accounting/facturas/nueva" element={<InvoiceCreatePage />} />
          <Route path="/accounting/facturas/configuracion" element={<InvoicingConfigPage />} />
          <Route path="/accounting/facturas/plantillas" element={<InvoiceTemplateEditorPage />} />
          <Route path="/revenue" element={<RevenuePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/configuracion/canales" element={<ChannelsConfigPage />} />
          <Route path="/configuracion/atajos" element={<ShortcutsConfigPage />} />
          <Route path="/external-panels/:id" element={<ExternalPanelPage />} />
          <Route path="/manual" element={<ManualPage />} />
          <Route path="/preferences" element={<PreferencesPage />} />
          <Route path="/seo" element={<SeoPage />} />
          <Route path="/soporte" element={<SoportePage />} />
          <Route path="/payroll" element={<PayrollPage />} />
          <Route path="/matriculas" element={<MatriculasPage />} />
          <Route path="/forms" element={<FormsPage />} />
          <Route path="/captacion/whatsapp" element={<WhatsappWidgetPage />} />
          <Route path="/make-webhooks" element={<MakeWebhooksPage />} />
          <Route path="/make-webhooks/:id" element={<MakeWebhookDetailPage />} />
          {/* Alias: el sidebar y deep-links viejos apuntan a /webhooks pero en
             ISEIE solo existe el módulo de Make-webhooks. Redirigimos para
             evitar 404. */}
          <Route path="/webhooks" element={<Navigate to="/make-webhooks" replace />} />
          <Route path="/webhooks/:id" element={<Navigate to="/make-webhooks" replace />} />
          <Route path="/woocommerce" element={<WooCommercePage />} />
          <Route path="/email-sequences" element={<EmailSequencesPage />} />
          <Route path="/email-templates" element={<EmailTemplatesPage />} />
          <Route path="/documentos" element={<DocumentsPage />} />
          <Route path="/documentos/config" element={<DocumentsConfigPage />} />
          <Route path="/configuracion/categorias-arbol" element={<CategoriesTreePage />} />
          <Route path="/configuracion/campos" element={<FieldDefinitionsPage />} />
          <Route path="/roles" element={<RolesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/notificaciones" element={<NotificacionesPage />} />
          <Route path="/notifications" element={<Navigate to="/notificaciones" replace />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/solicitudes-cambio" element={<ChangeRequestsPage />} />
          <Route path="/solicitudes-cambio/:id" element={<ChangeRequestDetailPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>

        {/* Entrada y catch-all */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default App;
