# CRM-300 — Vistas por usuario + arquitectura modular para venta por partes

## Objetivo

Dos features complementarias:

1. **Vistas personalizadas por usuario**: cada usuario configura como ve su CRM (modulos visibles, columnas de cada listado, dashboard widgets, KPIs preferidos, filtros guardados).
2. **Modularizacion para venta por partes**: poder vender el CRM en bundles (ej: solo Leads + Pipeline, solo Contabilidad, solo IA) y ensamblar instalaciones unicamente con lo necesario.

## Why

- Cada gestor usa el CRM de manera diferente. Forzar la misma vista a todos genera ruido.
- Comercialmente queremos ofrecer planes (Basic, Pro, IA, Enterprise) con conjuntos distintos de modulos.
- Reducir time-to-deploy de instalaciones nuevas (solo migraciones del bundle activo).

## Scope

### A. Vistas por usuario (CRM-301)

**Datos:**
- `user_views` JSONB en tabla `users` (ya existe `users.preferences` o creamos nueva tabla)
- Por defecto cada usuario hereda la vista del proyecto (`project.default_views`)
- Override en propio perfil

**Configurable per-usuario:**
- Sidebar items ocultados (subset del activo en proyecto)
- Columnas de leads/clientes/conversiones (orden + visibilidad, similar al ColumnsTab del proyecto pero personal)
- Dashboard widgets (KPIs preferidos, graficos visibles)
- Filtros guardados (ej "Mis leads de hoy", "Convertidos del mes")
- Tema preferido (ya existe ThemeContext, pero persistir per-user no por device)
- Densidad de tablas (compacto / comodo)

**API:**
- `GET /api/users/:id/views` → devuelve config personal merged con defaults del proyecto
- `PATCH /api/users/:id/views` → actualiza config personal
- `POST /api/users/:id/views/saved-filters` → guarda filtro
- `DELETE /api/users/:id/views/saved-filters/:filterId`

**UI:**
- Pagina `/preferences` (profile -> tab "Mis vistas")
- Cada listado muestra "guardar filtro actual"
- Sidebar muestra opcion "personalizar vista" (drag&drop ocultar items)

### B. Modularizacion (CRM-302)

**Concepto:** definir packages/bundles que agrupan modulos. Cada instalacion activa N bundles.

**Bundles propuestos:**

| Bundle | Modulos incluidos | Target cliente |
|---|---|---|
| `core` | auth, users, projects | TODOS (obligatorio) |
| `leads` | leads, clients, audiences, forms, webhook-tokens | Captacion |
| `comercial` | products, conversions, commissions, matriculas | Educacion / cursos |
| `accounting` | accounting, accounts-payable | Empresas |
| `payroll` | payroll | Equipos con nominas |
| `ia` | ia-monitor, claude-chat, reports-ia | Plataformas IA |
| `marketing` | meta-ads, google-ads, gsc, email-sequences | Marketing avanzado |
| `ecommerce` | products, woocommerce, conversions | Tiendas WC |

**Datos:**
- Tabla `installation_bundles` (singleton row): `{ active_bundles: string[], license_type, expires_at }`
- Cada modulo backend declara `requires: ['core']` y `provides: 'modulo_name'`
- Migration runner condicional: solo aplica migraciones de bundles activos

**Backend:**
- `src/bundles/manifest.js` con definicion de cada bundle (modulos, migrations)
- `src/index.js` o `app.js`: filtra modulos a registrar segun `installation_bundles.active_bundles`
- Endpoint admin `GET /api/installation/bundles` y `PATCH` para superadmin
- Migrations agrupadas por bundle (carpeta `migrations/<bundle>/`)

**UI:**
- Pagina `/admin/bundles` solo superadmin: muestra bundles disponibles + activos
- Activar bundle nuevo → ejecuta migraciones del bundle, registra rutas
- Desactivar → oculta UI, NO borra datos (puede reactivarse)

**License:**
- Future: integrar con sistema de licencias (key + bundles + expiracion)
- Por ahora: control manual via tabla DB

### C. Combinacion: vistas por usuario respetan bundles activos

Si un bundle esta inactivo (ej `payroll`), el item "Nominas" no aparece NUNCA, ni siquiera para superadmin. La preferencia personal solo opera dentro del subset activo.

## Migracion path

**Fase 1 (esta rama):**
- [x] Design doc (este archivo)
- [ ] Migration `029_user_views.sql`: tabla `user_views`
- [ ] Migration `030_installation_bundles.sql`: tabla `installation_bundles` + seed con todos activos
- [ ] Backend: stub `installation` modulo (read-only por ahora)
- [ ] Backend: refactor `app.js` para leer bundles activos antes de registrar modulos
- [ ] Frontend: `usePreferences` hook + pagina `/preferences` placeholder

**Fase 2 (proxima):**
- Sidebar drag&drop personalizar
- Columnas personales por listado
- Dashboard widgets configurables
- Bundles UI superadmin

**Fase 3:**
- License system real
- Pricing pages
- Onboarding wizard al activar bundles

## Archivos afectados

```
backend/
  migrations/029_user_views.sql       NUEVO
  migrations/030_installation_bundles.sql   NUEVO
  src/bundles/manifest.js             NUEVO
  src/modules/installation/           NUEVO (CRUD bundles)
  src/modules/users/user.controller.js  MODIF (endpoint views)
  src/app.js                          MODIF (filtro modulos por bundle)

frontend/
  src/modules/preferences/            NUEVO
    pages/PreferencesPage.jsx
    hooks/usePreferences.js
  src/modules/admin/                  NUEVO
    pages/BundlesAdminPage.jsx
  src/shared/components/layout/Sidebar.jsx  MODIF (filtra por bundles)
  src/contexts/PreferencesContext.jsx NUEVO
```

## Notas tecnicas

- **No romper compat**: en bundles activos por defecto deben estar todos los actuales. Migracion idempotente.
- **Performance**: cargar bundle config UNA VEZ al boot del API, no en cada request.
- **Seguridad**: solo superadmin puede modificar `installation_bundles`. Usuarios solo ven sus propias `user_views`.
- **Sidebar dinamico**: el filtrado actual por `roles` y `module` se mantiene; se anade un filtro extra por `bundle_active`.

## Estado
- ✅ Design doc creado
- 🚧 Pendiente: implementar migrations + scaffold (esta rama)
- 📅 Pendiente: implementacion completa (Fase 2-3, futuras ramas)
