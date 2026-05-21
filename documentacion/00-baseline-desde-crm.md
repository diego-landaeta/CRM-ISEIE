# 00. Baseline desde el CRM existente

> **Regla del proyecto:** todo apartado, módulo, patrón o convención que se cree en CRM-ISEIE **debe derivar del CRM existente** (`esos2dev-oss/CRM`, local en `c:\Users\nange\Documents\Proyectos T\CRM`). No se inventa nada que ya esté resuelto allí.

Este documento es el **catálogo canónico** de lo que existe en el CRM hermano. Sirve para:

1. Decidir qué módulos replicar (todos, una parte, o sustitutos).
2. Saber **dónde mirar el código** cuando un patrón se replique.
3. Mantener simetría entre ambos sistemas.

> Snapshot tomado el **2026-05-21** desde commit local `103af10`. Cuando el CRM existente añada módulos nuevos, actualizar esta lista.

---

## 1. Estructura raíz

```
CRM-existente/
├── backend/
│   ├── src/
│   │   ├── modules/          ←  32 módulos (ver §2)
│   │   ├── shared/           ←  config, middleware, services, utils (ver §3)
│   │   ├── jobs/             ←  5 cron schedulers (ver §4)
│   │   ├── bundles/          ←  manifest de módulos
│   │   └── app.js
│   ├── migrations/           ←  65 migraciones secuenciales SQL
│   ├── seeds/
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── modules/          ←  34 módulos (ver §5)
│   │   ├── shared/           ←  api, components, config, hooks, lib, pages, types (ver §6)
│   │   ├── contexts/         ←  AuthContext, ProjectContext, ThemeContext
│   │   ├── App.jsx
│   │   └── main.jsx
├── docs/                     ←  9 docs principales (ver §7)
└── scripts/, nginx/
```

CRM-ISEIE debe nacer con la misma estructura. **No reordenar capas sin justificación.**

---

## 2. Módulos backend (`backend/src/modules/`)

Para cada uno: ruta de referencia en el CRM existente y nota sobre si conviene replicar.

### Core — replicar siempre

| Módulo | Para qué sirve | Referencia |
|---|---|---|
| `auth` | Login, refresh, logout, set-password, JWT + bcrypt + middleware chain | `backend/src/modules/auth/` |
| `users` | CRUD usuarios + bienvenida Brevo | `backend/src/modules/users/` |
| `projects` | CRUD proyectos del CRM (multi-tenant) | `backend/src/modules/projects/` |
| `permissions` | Roles + vistas por usuario + permisos granulares | `backend/src/modules/permissions/` |
| `leads` | Pipeline de leads, webhook, round-robin, soft-delete, propuestos, spam, emails al lead | `backend/src/modules/leads/` |
| `conversions` | Ventas + cuotas + refunds + edición de importe | `backend/src/modules/conversions/` |
| `products` | Catálogo de productos por proyecto | `backend/src/modules/products/` |
| `product-categories` | Árbol de categorías (5 niveles) | `backend/src/modules/product-categories/` |
| `status` | Healthcheck / endpoint de estado | `backend/src/modules/status/` |
| `webhook-tokens` | Tokens públicos de entrada (webhooks externos) | `backend/src/modules/webhook-tokens/` |

### Negocio / contabilidad — replicar si el cliente lo pide

| Módulo | Para qué sirve | Referencia |
|---|---|---|
| `accounting` | Gastos (`expenses`) | `backend/src/modules/accounting/` |
| `accounts-payable` | Cuentas por pagar + pagos | `backend/src/modules/accounts-payable/` |
| `commissions` | Comisiones a gestores (vista por meses, histórico, export) | `backend/src/modules/commissions/` |
| `payroll` | Nóminas | `backend/src/modules/payroll/` |
| `matriculas` | Matrículas (formación / ciclos) | `backend/src/modules/matriculas/` |

### Comunicación / documentos

| Módulo | Para qué sirve | Referencia |
|---|---|---|
| `dossiers` | PDF versionado en R2 + pre-signed URLs (15 min) | `backend/src/modules/dossiers/` |
| `documents` | Gestor de documentos genéricos | `backend/src/modules/documents/` |
| `email-templates` | Plantillas de email reutilizables | `backend/src/modules/email-templates/` |
| `email-sequences` | Secuencias automáticas (triggers desde `lead.service` / `conversion.service`) | `backend/src/modules/email-sequences/` |
| `forms` | Formularios públicos + field-aliases + mail-parser | `backend/src/modules/forms/` |
| `field-definitions` | Campos custom configurables por proyecto | `backend/src/modules/field-definitions/` |

### Integraciones externas — replicar bajo demanda

| Módulo | Para qué sirve | Referencia |
|---|---|---|
| `credentials` | API credentials encriptadas AES-256 en DB (panel admin) | `backend/src/modules/credentials/` |
| `connectors` | Adapters + targets para integraciones outbound | `backend/src/modules/connectors/` |
| `make` | Webhook entrante desde Make.com (mapeo + test + headers `X-Asesora-*`) | `backend/src/modules/make/` |
| `woocommerce` | Importer WC (auto-detect CPTs, scraper, mapping) | `backend/src/modules/woocommerce/` |
| `audiences` | Custom audiences hacia Meta Marketing API | `backend/src/modules/audiences/` |
| `claude-chat` | Chat IA contra Anthropic API | `backend/src/modules/claude-chat/` |
| `ia-monitor` | Monitorización proyectos IA (Stripe MRR / churn) | `backend/src/modules/ia-monitor/` |
| `project-channels` | Canales por proyecto (WhatsApp, Hostinger, etc.) | `backend/src/modules/project-channels/` |

### Reportes

| Módulo | Para qué sirve | Referencia |
|---|---|---|
| `reports` | Dashboard genérico + KPIs | `backend/src/modules/reports/` |
| `reports-ia` | Reportes generados por Claude + export PDF | `backend/src/modules/reports-ia/` |
| `installation` | Endpoint de instalación inicial / self-bootstrap | `backend/src/modules/installation/` |

**Total: 32 módulos backend.** Mínimo viable de CRM-ISEIE = al menos los 10 "core" + los 6 de "comunicación/documentos" que sean relevantes. El resto se prioriza según necesidad.

---

## 3. Shared backend (`backend/src/shared/`)

Todo lo de aquí se replica **íntegro** — son utilidades cross-módulo.

```
shared/
├── config/        db.js (pg pool), r2.js (S3 client), env (vars validadas)
├── middleware/    auth (verifyToken, roleGuard, projectAccess), errorHandler, upload, rateLimit
├── services/      brevo.service.js, googleAds.service.js, localStorage.service.js, r2.service.js
└── utils/         AppError.js, logger.js (pino), presignedUrl.js
```

**Patrones obligados desde el CRM existente:**
- `AppError(message, statusCode)` en todos los errores de negocio
- Logger `pino` con niveles `info / warn / error`
- Validación con **Zod** en cada endpoint (esquema declarado en `<modulo>.validation.js`)
- Queries SQL directas con `pg` pool — **NO ORM**
- Encriptación AES-256 de credenciales en DB (ver `credentials` module)

---

## 4. Cron jobs (`backend/src/jobs/`)

| Job | Frecuencia | Para qué |
|---|---|---|
| `reminderScheduler.js` | cada minuto | Email Brevo al responsable cuando `fecha_recordatorio <= NOW()` |
| `emailSequenceScheduler.js` | cada minuto | Procesa la cola de email sequences disparadas por triggers |
| `googleAdsTokenScheduler.js` | diario | Refresca OAuth de Google Ads antes de que caduque |
| `wooCommerceSyncScheduler.js` | cada N horas | Sync incremental de productos WooCommerce |
| `documentOrphanScheduler.js` | diario | Limpieza de documentos huérfanos en R2 |

Cuando el CRM-ISEIE necesite uno de éstos, copiar archivo + registrar en `app.js`.

---

## 5. Módulos frontend (`frontend/src/modules/`)

Cada módulo backend tiene su contraparte frontend (no siempre con el mismo nombre).

### Mapeo backend → frontend

| Backend | Frontend |
|---|---|
| `auth` | (en `shared/pages/`: LoginPage, SetPasswordPage) |
| `users` | parte de `settings/` |
| `projects` | parte de `settings/` |
| `permissions` | `permissions/` |
| `leads` | `leads/` + `clients/` (clientes = leads convertidos) |
| `conversions` | `conversions/` |
| `products` | `products/` |
| `product-categories` | `product-categories/` |
| `accounting` + `accounts-payable` | `accounting/` |
| `commissions` | `commissions/` |
| `payroll` | `payroll/` |
| `matriculas` | `matriculas/` |
| `dossiers` + `documents` | `documents/` |
| `email-templates` | `email-templates/` |
| `email-sequences` | `email-sequences/` |
| `forms` | `forms/` |
| `field-definitions` | `field-definitions/` |
| `credentials` | parte de `settings/` |
| `connectors` | parte de `external-panels/` |
| `make` | `make-webhooks/` |
| `woocommerce` | `woocommerce/` |
| `audiences` | parte de `leads/` (audience export) |
| `claude-chat` | `ai-chat/` |
| `ia-monitor` | `ia-dashboard/` + `revenue/` |
| `reports` | `reports/` + `seo/` + `campaigns/` |
| `reports-ia` | `reports-ia/` |
| `project-channels` | `project-channels/` + `external-panels/` |

### Módulos frontend sin contraparte 1:1 backend

| Módulo | Para qué |
|---|---|
| `dev` | Página de componentes / playground UI |
| `manual` | Manual de usuario end-user (`MANUAL-USUARIO.md` renderizado) |
| `notificaciones` | Bandeja in-app + preferencias push |
| `preferences` | Preferencias del usuario logueado |
| `settings` | Cog gigante: usuarios, proyectos, campos, categorías, externals |
| `soporte` | Sistema de tickets interno |
| `status` | Página de estado |
| `webhooks` | Vista de webhooks (lectura) |

**Total: 34 módulos frontend.**

---

## 6. Shared frontend (`frontend/src/shared/`)

```
shared/
├── api/            client.ts (axios instance + interceptors + retry 502/503/504)
├── components/
│   ├── ui/         shadcn primitivas (Button, Input, Dialog, Table, Select, ...)
│   ├── layout/     AppLayout, Sidebar, Navbar, ProjectSelector, ErrorBoundary, OfflineBanner, PWAUpdatePrompt, CommandPalette
│   ├── dashboard/  KpiCard, charts wrappers
│   └── export/     PDF / Excel export helpers
├── config/         constants + project-wide flags
├── hooks/          useAuth, useProject, useToast, ...
├── lib/            cn(), color, format, projectLogos, clipboard, export/
├── pages/          LoginPage, DashboardPage, SetPasswordPage, ProfilePage  (compartidas, no por módulo)
└── types/          tipos globales TS (Lead, Conversion, etc.)
```

**Contextos globales** (en `src/contexts/`): `AuthContext`, `ProjectContext`, `ThemeContext`.

Replicar todo en CRM-ISEIE — son la columna vertebral del frontend.

---

## 7. Documentación (`docs/`)

El CRM-ISEIE debe tener **el mismo set de docs**, adaptados a su realidad:

| Doc del CRM existente | Equivalente en CRM-ISEIE |
|---|---|
| `01-esquema-base-datos.md` | `docs/01-esquema-base-datos.md` |
| `02-estructura-proyecto.md` | `docs/02-estructura-proyecto.md` |
| `03-api-endpoints.md` | `docs/03-api-endpoints.md` |
| `04-variables-entorno.md` | `docs/04-variables-entorno.md` |
| `05-arquitectura-frontend.md` | `docs/05-arquitectura-frontend.md` |
| `06-despliegue-devops.md` | `docs/06-despliegue-devops.md` (apuntar al VPS `72.60.90.135`) |
| `07-tareas-jira.md` | (opcional — depende de si se usa Jira para este CRM) |
| `08-tickets-documents-module.md` | (replicar cuando exista el módulo `documents`) |
| `09-deploy-y-ramas.md` | `docs/09-deploy-y-ramas.md` (con `main` = prod, `staging` = QA) |
| `webhook-leads-contract.md` | `docs/webhook-leads-contract.md` |

**Mientras estos docs no existan en CRM-ISEIE, la referencia válida es el del CRM hermano.**

---

## 8. Migraciones — política

El CRM existente lleva **65 migraciones secuenciales**. CRM-ISEIE empieza desde `001_` propio, pero **respetando estos principios**:

- Una migración = una intención clara (no batch de cambios).
- Nombrado: `NNN_descripcion-snake.sql`.
- **Idempotentes cuando sea posible** (`IF NOT EXISTS`, `CREATE OR REPLACE`).
- Cambios destructivos (`DROP`, `ALTER`) van con backup previo documentado.
- `BEGIN; ... COMMIT;` siempre.

La migración `001_initial_schema.sql` del CRM-ISEIE se construye **estudiando la 001 del CRM existente** + las migraciones que añaden columnas críticas más adelante (round-robin, refresh tokens, soft-delete leads, etc.) — para que el esquema inicial ya incluya lo aprendido sin tener que migrar 60 veces.

---

## 9. Reglas de copia

Cuando se replique un módulo del CRM existente:

1. **Copia entera** del directorio `backend/src/modules/<X>/`, no chunks.
2. Adaptar imports si cambia algún path de `shared/`.
3. Si el módulo asume tablas que en CRM-ISEIE aún no existen → crear migración(es) primero.
4. Adaptar validaciones Zod si el contrato del proyecto cambia (ej: campos custom).
5. Tests: replicar también los tests de Vitest si existen.
6. Frontend: copiar la página principal del módulo + sus componentes y hooks. Adaptar el `api/<modulo>.api.js` al endpoint final.

**No hacer "inspiración libre".** Si necesitas el patrón, cópialo. Si lo vas a cambiar, justifica en un docstring en el archivo modificado por qué CRM-ISEIE necesita divergir.

---

## 10. Qué NO copiar (probablemente)

- `bundles/manifest.js` si no se necesita la idea de bundles configurables.
- Módulos hyper-específicos de proyectos del CRM hermano (Psiko Aprende, Fono Aprende, ICTESS) — esos quedan fuera.
- Las migraciones de "fix" intermedias — incluirlas integradas en la migración inicial.
- Features marcadas como "pospuesta" o "no convenció" en [`../REVISAR.md`](../REVISAR.md).

---

## 11. Checklist al añadir un módulo nuevo en CRM-ISEIE

- [ ] ¿Existe equivalente en el CRM hermano? Si sí, **copiar** en vez de inventar.
- [ ] ¿Hay migración(es) necesaria(s)? Crear ANTES del código.
- [ ] ¿El módulo necesita endpoint público (webhook)? Validar con Zod + rate-limit.
- [ ] ¿Requiere credenciales API? Pasar por el módulo `credentials` (encriptación AES-256).
- [ ] ¿Necesita cron? Añadir job en `backend/src/jobs/` + registrar en `app.js`.
- [ ] Frontend: módulo en `frontend/src/modules/<X>/` con `api/`, `hooks/`, `components/`, `pages/`.
- [ ] Página añadida con `lazy()` en `App.jsx`.
- [ ] Tests: al menos un test del happy path + un edge case.
- [ ] Doc en `docs/` o en `documentacion/` si introduce un flujo nuevo.

Si una casilla queda sin marcar, el módulo no está terminado.
