# MODULES — CRM-ISEIE

Mapa de módulos. Más simple que el hermano: 1 proyecto (ISEIE), menos features.

---

## BACKEND `backend/src/modules/`

| Módulo | Qué hace | Files clave | Endpoints |
|---|---|---|---|
| **auth** | Login/logout/refresh JWT/set-password | auth.controller.js, .service.js | `POST /api/auth/login`, `/logout`, `/refresh`, `/set-password` |
| **leads** | CRUD leads, webhook, round-robin, soft-delete | lead.controller, .service, .model, .validation | `GET /api/leads`, `POST /:id/interactions`, `/reminders`, `/status`, `POST /api/leads/webhooks/:slug` |
| **conversions** | Ventas, pagos, cuotas (installments), refunds | conversion.controller, installments.model | `POST /api/conversions`, `/:id/payments`, `/:id/installments`, `/:id/refund` |
| **products** | Catálogo + scraper-fed `_texto` fields + dossier | product.controller, .model | `GET /api/products`, `POST /:id/image` |
| **product-categories** | Árbol categorías | category.controller | `GET /api/product-categories?tree=true` |
| **dossiers** | PDFs versionados (localStorage, NO R2 en ISEIE) | dossier.controller, .service | `POST /api/products/:id/dossier` |
| **matriculas** | Matrículas vinculadas a conversiones | matricula.controller | `GET /api/matriculas` |
| **forms** | Formularios embebibles | form.controller | `GET /api/forms`, `GET /embed/form/:embedId` (público) |
| **make** | Webhooks Make.com con override headers | make.controller, .service | `POST /api/webhooks/make/:slug` |
| **woocommerce** | Importer WP + scraper HTML | wc.controller, wc.model, wp-rest.js, html-scraper.js | `GET /api/woocommerce/preview`, `POST /runs/start`, `GET /runs/current` |
| **email-sequences + email-templates** | Drip campaigns + templates | sequence.controller, template.controller | `POST /api/email-sequences/:id/enroll` |
| **field-definitions** | Custom fields por proyecto | field-def.controller | `GET /api/field-definitions?projectId=10&entity=lead` |
| **documents** | PDF generator (dossiers + certificados) | document.controller | `GET /api/documents/:id` |
| **accounting** | Dashboard contable | accounting.controller | `GET /api/accounting/dashboard` |
| **accounts-payable** | Cuentas por pagar | payable.controller | `GET /api/accounts-payable` |
| **expenses** | Gastos operativos | expense.controller | `GET /api/expenses` |
| **credentials** | Credenciales encriptadas servicios externos | credentials.controller | `GET /api/credentials/:service` |
| **connectors** | Framework genérico mappings | connectors.targets.js | (interno) |
| **permissions** | Custom roles | permission.controller | `GET /api/permissions` |
| **installation** | Setup wizard | (interno) | `GET /api/installation/status` |

### NO existen en ISEIE (sí en hermano)

- `audiences`, `campaigns`, `ai-chat` (claude-chat), `ia-monitor`, `commissions`, `payroll`, `messages`

---

## FRONTEND `frontend/src/modules/`

### Páginas operativas (beta-gate ✅)

| Módulo | Ruta | Notas |
|---|---|---|
| `leads` | `/leads`, `/leads/pipeline`, `/leads/archived`, `/leads/:id` | LeadsPage portada de ISEIH (1101 líneas) — filtros + bulk + exports |
| `clients` | `/clients`, `/clients/:id` | Vista para status=convertido |
| `matriculas` | `/matriculas` | Lista de matrículas |
| `products` | `/products`, `/products/:id` | ProductDetailPage portada con `_texto` fields + meta pills + secciones |
| `woocommerce` | `/woocommerce` | UI para configurar import + banner de progreso en vivo |
| `documents` | `/documentos` | PDFs |
| `forms` | `/forms` | Formularios embebibles |
| `make-webhooks` | `/make-webhooks` | Configurar webhooks Make + ver payloads |
| `email-sequences` + `email-templates` | `/email-sequences`, `/email-templates` | Templates + drip |
| `conversions` | (componentes dentro de `/clients/:id`) | InstallmentsDialog, EditConversion, RefundDialog |
| `accounting` | `/sales` | Un solo dashboard (no split) |
| `notificaciones`, `preferences`, `status` | `/notificaciones`, `/preferences`, `/status` | Sistema |

### Páginas marcadas "Próximamente" (en beta-gate)

| Item | Ruta planeada | Falta |
|---|---|---|
| Audiencias Meta | `/leads/audiences` | Portar módulo |
| Campañas (Meta/Google) | `/campaigns/*` | Portar módulo + OAuth |
| SEO | `/seo` | Portar módulo |
| Cursos pendientes | `/products/pending` | Backend + UI |
| Árbol de categorías | `/configuracion/categorias-arbol` | Portar UI |
| Contabilidad split (Ingresos/CxC/CxP/Comisiones/Nóminas/Stripe) | `/accounting/*`, `/commissions`, `/payroll`, `/stripe` | Backend + UI |
| Análisis IA | `/reports/ia` | Portar + Anthropic |
| Chat IA | `/ai-chat` | Portar `claude-chat` |
| Soporte | `/soporte` | Página estática |
| Manual del CRM | `/manual` | Página estática |

Para activar un item: editar [`frontend/src/shared/config/betaConfig.ts`](../frontend/src/shared/config/betaConfig.ts), agregar la ruta al array `BETA_ROUTES`, rebuild.

### Componentes shared

`frontend/src/shared/`:

| Path | Qué |
|---|---|
| `api/client.js` | Axios con interceptors |
| `components/layout/{AppLayout,Sidebar,NotificationsBell,ProtectedRoute,Toaster,ErrorBoundary,SectionTabs}` | Layout y navegación |
| `components/ui/` | shadcn-style: Button, Input, Dialog, Table, Select, Badge, ChannelBadge, StatusBadge, EmptyState, SearchableSelect, ProductCombobox, MultiProjectPicker |
| `config/betaConfig.ts` | **Allowlist de rutas beta** (importante) |
| `contexts/{AuthContext,ProjectContext,ThemeContext}` | Estado global |
| `hooks/{useToast,usePermission,useUrlFilters}` | Hooks comunes |
| `lib/format.js` | `formatDateShort`, `toLocalDate` (parsea YYYY-MM-DD como local) |

### Gotchas frontend

- **`LeadsPage`**: ya tiene la versión completa (1101 líneas). Si necesitás cambiar filtros, ahí están.
- **`ProductDetailPage`**: hace fetch real desde `getProduct()` — no es stub.
- **`ProjectSettingsDialog`**: es un **stub mínimo** en ISEIE (placeholder "Próximamente"). Si hace falta funcional, portar de ISEIH (10 tabs).
- **`LeadFormDialog`**: incluye checkbox "No tiene nombre" que autorrellena con `Anónimo (tel XXX)` para evitar choques de duplicados.

---

## Scripts (`backend/scripts/`)

Ver lista detallada en [HANDOFF.md](./HANDOFF.md#6-scripts-del-repo-en-backendscripts).

Resumen:
- `import_cetlat.js` — Beca CETLAT CSV → leads
- `import_contactos.js` — Contactos masivos (dedupe email+phone, multi-curso)
- `link_products.js` — Re-vincular productos fuzzy
- `fill_prices.js` — Re-scrapear solo precios
- `fix_fechas.js` — Re-parsear fechas DD/MM
- `populate_history.js` — Crear timeline cronológica
- `fix_telefonos_iseie.py` — Normalizar tel desde xlsx
- `qa_iseie.mjs` — Suite E2E 54 tests

---

## Cómo agregar módulo nuevo

Mismo patrón que hermano:
1. Backend: `backend/src/modules/<nombre>/` con `index.js` exportando `{ prefix, router }`. Registrar en `app.js`.
2. Frontend: `frontend/src/modules/<nombre>/{api,components,hooks,pages}` + lazy import en `App.jsx` + entry en `Sidebar.jsx`.
3. Si requiere beta-gate: agregar a `BETA_ROUTES` cuando esté funcional.
