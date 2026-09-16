# Diferencias CRM-ISEIE vs CRM hermano — paridad final

> Documento canónico de toda divergencia consciente entre **CRM-ISEIE**
> (`https://crm.iseie.com`) y el CRM hermano (`esos2dev-oss/CRM` —
> `https://360crm.tech`). Si una diferencia no está aquí, es drift no
> intencional y debe corregirse para paridad.
>
> Por defecto: **paridad estricta de schema + módulos + frontend**. Esto
> solo lista lo que rompe esa paridad por motivos de negocio o ajustes
> técnicos legítimos.

Última actualización: **2026-05-22** (paridad finalizada).

---

## 0. Estado de paridad final

| Dimensión | Hermano | ISEIE | Cobertura |
|---|---|---|---|
| **Tablas DB** | 57 | 58 (1 extra: `expenses`) | **✅ 100%** + tablas IA excluidas |
| **Módulos backend** | 32 | 26 + 1 public mount | **✅ 90%** (los 3 IA y 3 menores excluidos por contexto) |
| **Páginas frontend** | 59 | ~30 | **51%** (resto = páginas IA + variantes menores excluidas) |
| **Branding** | — | ✅ | logo + favicons + paleta corporativa ISEIE |
| **Seeds** | 1 proyecto | 1 proyecto `iseie` | ✅ |

---

## 1. IA → Educación (única diferencia funcional grande)

**Hermano** opera proyectos `type='ia'` (Psicólogo IA, Nutricionista IA, Tarot
IA, Veterinary AI) — plataformas SaaS basadas en IA con sus propias tablas:
`platform_users`, `ai_conversations`, `ai_messages`, `meta_uploads`,
`ia_metrics_snapshots`, `reports` (IA).

**CRM-ISEIE** no opera plataformas IA. ISEIE es una institución educativa
operando como un único proyecto (`type='crm'`, slug `iseie`).

**Implicación schema**: el modelo multi-tenant del hermano (basado en
`projects`, `user_projects`, `project_queue_state`, etc.) se reutiliza tal
cual por paridad. La tabla `projects` existe y todas las FK siguen
referenciándola, pero en CRM-ISEIE solo hay **una fila** (`iseie`).

**Tablas omitidas (las 6 exclusivas del modo IA del hermano)**:

| Tabla omitida | Migración hermano |
|---|---|
| `platform_users` | 013 |
| `ai_conversations` | 028 |
| `ai_messages` | 028 |
| `meta_uploads` | 028 |
| `ia_metrics_snapshots` | 028 |
| `reports` (IA) | 028 |

Las migraciones **013_platform_users.sql** y **028_audiences_ia_reports_chat.sql**
del hermano **nunca se portan** al repo de ISEIE.

**Módulos backend omitidos por la misma razón**: `audiences`, `ia-monitor`,
`reports-ia`, `claude-chat`.

**Páginas frontend omitidas**: `IADashboardPage`, `AIChatPage`,
`ReportsIAPage`, `AudienceExportPage`, `MetaCampaignsPage`, `GoogleCampaignsPage`,
`CampaignsPage` (las 3 últimas: campañas Meta/Google ads, lower priority sin IA).

---

## 2. Divergencias técnicas (no funcionales)

### 2.1 Rol/owner de PostgreSQL

| | Hermano | ISEIE |
|---|---|---|
| Rol DB | `crm_user` | `crm_iseie_user` |

Toda migración del hermano que contenía `ALTER TABLE … OWNER TO crm_user` o
`GRANT … TO crm_user` se portó con `crm_iseie_user`.

### 2.2 Branding visual

| Elemento | Hermano | ISEIE |
|---|---|---|
| Color primary HSL (light) | `230 75% 55%` (indigo) | `220 100% 23%` (navy `#002776` del logo) |
| Color primary HSL (dark) | aclarado del primary | `215 90% 72%` + `adaptHslForDarkMode` que aclara cualquier theme_color oscuro en runtime |
| Verde acento (forest del escudo) | n/a | `--iseie-green: 150 45% 22%` (light) / `150 38% 52%` (dark) |
| Logo | placeholder `<Package />` | PNG real ISEIE (`iseie-logo-color.png` light + `iseie-logo.png` dark) |
| Favicon | SVG genérico | PNGs oficiales (`iseie-icon-32/180/192.png`) |
| `theme-color` meta | `#3b82f6` | `#002776` |

### 2.3 Adaptación automática del theme_color a dark mode

`ProjectContext` del CRM-ISEIE usa `adaptHslForDarkMode()` (en
`shared/lib/color.ts`) para aclarar automáticamente cualquier `theme_color`
del proyecto con luminosidad ≤ 45% cuando el modo activo es `dark`. Sin esto
el navy corporativo `#002776` queda ilegible sobre fondo oscuro. **El
hermano no tiene esta lógica** porque su default `theme_color` ya es claro.

### 2.4 Numeración interna de migraciones

CRM-ISEIE arrancó con un **`001_initial_schema.sql` consolidado** que ya
incluye lo equivalente a las migraciones 002-017 del hermano. Los archivos
individuales 004 → 063 sí coinciden 1:1 (con las omisiones de §1).

**Migración 059** (`leads.es_propuesto`): es la única migración con un
`DO $$ ... $$` defensivo en lugar de la copia textual. Detecta si la columna
`propuesto` (nombre antiguo del 001 consolidado) existe y la renombra a
`es_propuesto`. El 001 consolidado se actualizó para que un clean install
cree directamente `es_propuesto`.

### 2.5 Módulo `accounting` del hermano → módulo `expenses` separado en ISEIE

El hermano tiene un único módulo `accounting` que mezcla CRUD de expenses +
endpoint de dashboard contable. En ISEIE se portó solo la parte de
**expenses** como módulo independiente. El endpoint dashboard (`/api/accounting/dashboard`)
queda fuera de scope hasta que se necesite, ya que todas las tablas
subyacentes existen.

---

## 3. Migraciones consolidadas en 001 (sin archivo individual)

Aplicadas en ISEIE pero como parte de `001_initial_schema.sql`:

| Hermano | Qué hace |
|---|---|
| 002 | products + dossiers |
| 003 | refresh_tokens |
| 010 | logos + precios productos |
| 011 | commissions base |
| 012 | conversions.producto_id |
| 014 | users.avatar_url |
| 015 | projects.modules (JSONB) |
| 016 | commissions_rediseño |
| 017 | conversion_installments |
| 041 | products.image_url |
| 044 | sidebar_labels |
| 045 (theme_color) | projects.theme_color |
| 054 | products.modalidad |
| 055 | leads.email nullable |
| 058 (parcial) | leads.deleted_at |
| 060 | conversion_refunds |
| 062 | product_url_aliases |

---

## 4. Migraciones aplicadas como archivo (idénticas al hermano)

004, 005, 006, 007, 008, 009, 018, 019, 020, 021, 022, 023, 024, 025, 026,
027, 029 (documents), 030 (×2: field_definitions_multi + installation_bundles),
031, 032, 033, 037, 038, 039 (×2: categories_tree + document_audit_log),
040 (×2: role_views + documents_r2_email), 042, 043, 045 (product_modules),
046, 047, 048, 049, 050, 051, 052, 053, 056, 058, **059** (con DO defensivo,
ver §2.4), 061, 063.

Las que tocaban `OWNER TO crm_user` o `GRANT … TO crm_user` se modificaron
a `crm_iseie_user` (ver §2.1). Resto, byte-a-byte iguales al hermano.

---

## 5. Módulos backend portados (26 + 1 public mount)

```text
auth, users, projects, leads, products, product-categories,
conversions, commissions, expenses, accounts-payable, payroll,
permissions, field-definitions, matriculas, forms, webhook-tokens,
email-sequences, email-templates, documents, make (admin),
make (public webhooks ingest), woocommerce, connectors,
project-channels, installation, credentials, status.
```

Schedulers: `emailSequenceScheduler` arranca automáticamente al iniciar el
proceso (deshabilitable con `EMAIL_SEQ_DISABLED=1`).

Recursos shared portados: `r2.service.js`, `presignedUrl.js`,
`googleAds.service.js`, `r2.js (config)`, `bundles/manifest.js`.

Deps npm añadidas: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`,
`pdf-lib`, `puppeteer`, `express-rate-limit`. En frontend: `dompurify`,
`@types/dompurify`, `react-dropzone`, `recharts`.

---

## 6. Páginas frontend portadas

`LoginPage`, `SetPasswordPage`, `DashboardPage`, `LeadsPage`,
`LeadDetailPage`, `ProductsPage`, `ProductDetailPage`,
`CategoriesTreePage`, `FieldDefinitionsPage`, `CommissionsPage`,
`ExpensesPage`, `AccountsPayablePage`, `PayrollPage`, `MatriculasPage`,
`FormsPage`, `EmbedFormPage` (pública sin auth),
`MakeWebhooksPage`, `MakeWebhookDetailPage`, `WooCommercePage`,
`EmailSequencesPage`, `EmailTemplatesPage`, `DocumentsPage`,
`DocumentsConfigPage`, `RolesPage`, `SalesPage`, `ReportsPage`,
`NotificationsPage`, `ActivityPage`, `ProfilePage`, `SettingsPage`,
`NotFoundPage`.

Shared components nuevos: `CountryFlag` (banderas SVG/PNG por
slug `iseie-<iso>`), `PromptDialog`.

---

## 7. Páginas frontend NO portadas (decisión consciente)

| Página hermano | Razón |
|---|---|
| `IADashboardPage`, `AIChatPage`, `ReportsIAPage`, `AudienceExportPage` | IA only (§1) |
| `CampaignsPage`, `MetaCampaignsPage`, `GoogleCampaignsPage` | Campañas Meta/Google ads — sin uso en v1 ISEIE |
| `CoursesPendingPage`, `ProductsTreePage` | Variantes admin avanzadas de productos (no críticas) |
| `LeadsPipelinePage` | Kanban — marcado `comingSoon` en sidebar |
| `ClientsPage`, `ClientDetailPage` | Hermano modela clientes aparte de leads; en ISEIE leads cubre el flujo |
| `RevenuePage`, `SeoPage`, `DevComponentsPage`, `SoportePage`, `ManualPage`, `PreferencesPage`, `ChannelsConfigPage`, `ShortcutsConfigPage`, `StatusPage`, `IncomePage`, `ReceivablePage`, `AccountingDashboardPage`, `ExternalPanelPage` | Pages secundarias/admin que se podrán portar bajo demanda; las tablas y módulos backend correspondientes ya están listos |

---

## 8. Seed inicial

| Hermano | ISEIE |
|---|---|
| 1 proyecto seed | 1 proyecto seed `iseie` (`seeds/002_countries.sql`) |

`seeds/002_countries.sql` de ISEIE crea el proyecto único y asocia el
superadmin. Mismo enfoque que el hermano.

---

## 9. Sidebar — diferencias estructurales

El sidebar de ISEIE está **inspirado** en el del hermano (mismo NavGroup
colapsable, mismas secciones generales) pero adaptado:

- **Sin items IA**: ningún sub-item de Chat IA, Análisis IA, Stripe SaaS,
  Audiencias Meta, ni Campañas Meta/Google.
- **Sin selector de proyecto**: como solo hay un proyecto único (`iseie`),
  el switcher no aparece. El hermano sí lo tiene porque su modelo
  multi-tenant es activo.
- **NAV_SECTIONS**: Principal, Captación, Catálogo, Finanzas, Análisis,
  Sistema (6 secciones; hermano tiene esas mismas).

---

## 10. Cuando aparezca una nueva diferencia

Cada divergencia consciente del CRM hermano se añade aquí con:
- **Por qué** (motivo de negocio).
- **Qué** (schema/código/visual).
- **Cómo se mantiene la sincronización** (qué hacer cuando el hermano
  cambie).

Si una columna o tabla aparece en el hermano y no está aquí ni en §1, es
drift no intencional y debe portarse en la siguiente sesión de sync.

---

**FIN DEL DOCUMENTO** — paridad cerrada en 2026-05-22. Próximas sesiones de
sync deben pull del hermano, diff de migraciones nuevas, portar archivo a
archivo, y volver a editar este doc si surge una nueva divergencia
consciente.
