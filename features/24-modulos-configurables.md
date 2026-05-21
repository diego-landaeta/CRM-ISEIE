# Modulos configurables por proyecto (runtime)

**Jira:** CRM-178 (supersede CRM-172)
**Estado:** 📝 Backlog (alta prioridad, desbloquea muchos)
**Tipo:** Epic

## Contexto

Cada proyecto tiene necesidades distintas. Ej:
- **Psiko Aprende**: leads + pipeline + clients + products + conversions + commissions + matriculas + contabilidad + forms + woocommerce
- **Tarot IA**: solo platform_users + accounting_income (sin pipeline, sin comisiones, sin matriculas)
- **Fono Aprende**: como Psiko sin comisiones ni nominas
- **ISEIH**: como Psiko con matriculas activas

Hoy todos los proyectos ven todos los modulos en el sidebar, aunque no los usen.

## Modulos propuestos

**Nucleo (siempre activos):**
- `dashboard` (adaptativo)
- `settings`
- `users` (superadmin global)

**Comercial (toggle por proyecto):**
- `leads` — captura + pipeline
- `clients` — convertidos
- `products` — catalogo
- `conversions` — ventas
- `commissions` — reglas + generadas
- `matriculas` — post-conversion
- `forms` — builder
- `woocommerce` — sync
- `platform_users` — modo IA alternativo

**Contabilidad (toggle individual):**
- `accounting_income`
- `accounting_expenses`
- `accounting_receivable`
- `accounting_payable`

**Equipo:**
- `payroll`

**Reportes:**
- `reports`

## Modelo

```sql
-- Migracion nueva
ALTER TABLE projects ADD COLUMN modules JSONB NOT NULL DEFAULT '{}'::jsonb;
```

Ejemplo:
```json
{
  "leads": true,
  "products": true,
  "conversions": true,
  "commissions": true,
  "matriculas": false,
  "forms": true,
  "woocommerce": false,
  "platform_users": false,
  "accounting_income": true,
  "accounting_expenses": true,
  "accounting_receivable": true,
  "accounting_payable": false,
  "payroll": true,
  "reports": true
}
```

## Dependencias entre modulos

No se puede desactivar un modulo si otro activo depende de el:
- `pipeline` depende de `leads`
- `commissions` depende de `products` + `conversions`
- `matriculas` depende de `conversions`
- `accounting_receivable` depende de `conversions`

Backend valida al guardar config + UI muestra en gris con tooltip.

## Backend

**Middleware `moduleGuard`:**
```js
// backend/src/shared/middleware/moduleGuard.js
export function moduleGuard(moduleName) {
  return async (req, res, next) => {
    const projectId = req.query.projectId || req.body.project_id || req.params.projectId;
    if (!projectId) return next(); // global endpoints
    const project = await projectModel.findById(projectId);
    if (!project?.modules?.[moduleName]) {
      return next(new AppError('Modulo no activo en este proyecto', 404, 'MODULE_DISABLED'));
    }
    next();
  };
}
```

Aplicado en cada modulo:
```js
// leads.routes.js
router.use(moduleGuard('leads'));
```

**Endpoint:**
- `GET /api/projects/:id/modules` — retorna la config
- Ya existe `PATCH /api/projects/:id` (modules se envia en el body)

## Frontend

**Nueva tab en ProjectSettingsDialog > "Modulos":**
```
┌─────────────────────────────────────────┐
│ Modulos activos en Psiko Aprende        │
├─────────────────────────────────────────┤
│ [Preset: CRM Formacion] [Preset: IA]    │
├─────────────────────────────────────────┤
│ COMERCIAL                               │
│ ☑ Leads                                 │
│ ☑ Clients                               │
│ ☑ Products                              │
│ ☑ Conversions                           │
│ ☑ Commissions (requiere products+conv)  │
│ ☐ Matriculas                            │
│ ☑ Forms                                 │
│ ☐ WooCommerce                           │
│ ☐ Platform users                        │
│                                         │
│ CONTABILIDAD                            │
│ ☑ Ingresos                              │
│ ☑ Egresos                               │
│ ☑ Cuentas por cobrar                    │
│ ☐ Cuentas por pagar                     │
│                                         │
│ EQUIPO                                  │
│ ☑ Nominas                               │
│                                         │
│ PREVIEW DEL SIDEBAR RESULTANTE →        │
└─────────────────────────────────────────┘
```

**Sidebar adaptativo:**
- Al cambiar de proyecto, Sidebar lee `activeProject.modules` y muestra solo los items con flag true
- `ProtectedRoute` valida que la ruta pertenezca a un modulo activo del proyecto

## Presets iniciales

```js
const PRESETS = {
  'crm_formacion': { leads: true, clients: true, products: true, conversions: true, commissions: true, matriculas: true, forms: true, accounting_income: true, accounting_expenses: true, accounting_receivable: true, accounting_payable: true, payroll: true, reports: true, woocommerce: true, platform_users: false },
  'plataforma_ia': { leads: false, clients: false, products: true, conversions: true, commissions: false, accounting_income: true, platform_users: true, reports: true, /* resto false */ },
  'custom': {} // todo a false, admin activa uno por uno
};
```

## Relacion con multi-instancia (CRM-197)

Este epic es el toggle RUNTIME (por proyecto). CRM-197 añade una capa encima: INSTALL TIME (`.env ENABLED_MODULES`). Un proyecto no puede activar un modulo que el server no tenga en su install list.

## AC

- [ ] Migracion projects.modules JSONB
- [ ] Tab "Modulos" en ProjectSettingsDialog con toggles + validacion de dependencias
- [ ] Middleware backend rechaza peticiones a modulos off
- [ ] Sidebar solo muestra modulos on
- [ ] Cambio de proyecto actualiza sidebar al instante
- [ ] Presets aplican batch de toggles
- [ ] Preview del sidebar resultante en la UI de config
