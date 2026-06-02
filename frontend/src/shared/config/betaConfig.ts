// ============================================================
// BETA 1.0.0 — Allowlist de rutas operativas en CRM-ISEIE
// ============================================================
// Las secciones del sidebar que NO estan aqui se renderizan
// como "Proximamente" (atenuadas, no clicables) cuando VITE_BETA_MODE=true.
//
// Para mover un item de "Proximamente" a operativo, agregalo a BETA_ROUTES.
// ============================================================

export const BETA_VERSION = '1.0.0';

export const BETA_MODE: boolean = String(import.meta.env.VITE_BETA_MODE || '').toLowerCase() === 'true';

// Prefijos `to=` activos en la beta de ISEIE.
export const BETA_ROUTES: readonly string[] = [
  '/',                              // Dashboard
  '/dashboard',                     // Dashboard
  '/leads',                         // Prospectos
  '/clients',                       // Clientes
  '/matriculas',                    // Matriculas
  '/sales',                         // Ventas (registro venta historica + listado conversiones)
  '/products',                      // Productos (incluye /products/tree)
  '/woocommerce',                   // Importacion WordPress/WC
  '/configuracion/categorias-arbol',// Categorias
  '/forms',                         // Captacion (forms + make + webhooks)
  '/make-webhooks',                 // Captacion Make
  '/webhooks',                      // Webhooks entrantes
  '/email-sequences',               // Email
  '/email-templates',
  '/documentos',                    // Documentos PDF
  '/notificaciones',
  '/preferences',
  '/profile',
  '/settings',
  '/status',
  '/set-password',
  '/manual',
  '/soporte',
  '/activity',                      // Gestores: actividad
];

export function isBetaAllowed(to?: string): boolean {
  if (!BETA_MODE) return true;
  if (!to) return false;
  if (to === '/') return true;
  return BETA_ROUTES.some((p) => p !== '/' && (to === p || to.startsWith(p + '/')));
}
