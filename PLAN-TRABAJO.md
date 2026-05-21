# Plan de trabajo CRM — Estado 2026-04-27

> Documento vivo. Actualizar al completar cada item.
> Diego = backend/infra · Angel = frontend

---

## SPRINT 1 — Esta semana (27 Apr – 3 May)

### Diego

| # | Jira | Tarea | Est. | Estado |
|---|------|-------|------|--------|
| 1 | — | **Merge** `feat/sesion-completa` → `feat/user-views-modular` y push | 15 min | ⬜ |
| 2 | CRM-215 | **Rate limiting** `POST /api/auth/login`: 10 intentos / 15 min, skip en éxito | 30 min | ⬜ |
| 3 | CRM-215 | **Migración 031**: `idx_conversions_lead_id` + `idx_lead_reminders_lead_id` | 10 min | ⬜ |
| 4 | CRM-211 | **Módulo `project-channels`**: tabla + CRUD + registro en app.js | 2-3h | ⬜ |
| 5 | CRM-213 | **Nginx VPS**: headers `sw.js` (no-cache) + `manifest.webmanifest` (Content-Type) | 15 min | ⬜ |
| 6 | — | **Cron `reminderScheduler`**: email Brevo al responsable cuando `fecha_recordatorio <= NOW()` | 1-2h | ⬜ |
| 7 | CRM-185 | **Email sequence triggers**: disparar desde `lead.service` (lead_created) y `conversion.service` (conversion_created) | 2h | ⬜ |

### Angel

| # | Jira | Tarea | Estado |
|---|------|-------|--------|
| 1 | CRM-192 | Fix logos en cards de proyecto en Settings | ⬜ |
| 2 | CRM-201 | Refactor `LeadDetailPage` (>500 líneas) en sub-componentes | ⬜ |
| 3 | CRM-218 | Campos base configurables en ProjectSettingsDialog separados de campos custom | ⬜ |

---

## SPRINT 2 — Semana del 4-10 May

### Diego

| # | Jira | Tarea | Est. | Estado |
|---|------|-------|------|--------|
| 8 | — | **QA staging**: verificar end-to-end Avatar, WooCommerce, Matrículas, Nóminas, Email Sequences, Forms, IA | 3-4h | ⬜ |
| 9 | — | **Cron leads inactivos**: email diario al gestor con sus leads que superan umbral sin actividad | 1h | ⬜ |
| 10 | CRM-216 | **Audiences**: implementar lógica real `uploadMeta` → Meta Marketing API (actualmente stub) | 3h | ⬜ |
| 11 | CRM-219 | **Migraciones a producción**: aplicar migraciones 014–030 en DB producción coordinando con cliente | 1h | ⬜ |
| 12 | CRM-215 | **Rate limiting global**: endpoints webhook públicos (`/api/forms/public/`, `/api/webhook-tokens/`) | 1h | ⬜ |

### Angel

| # | Jira | Tarea | Estado |
|---|------|-------|--------|
| 4 | CRM-202 | Refactor `SettingsPage` (>1700 líneas) en archivos por tab | ⬜ |
| 5 | CRM-203 | Refactor `ProjectSettingsDialog` (>900 líneas) — extraer tabs | ⬜ |
| 6 | CRM-153 | Popup rápido del prospecto (preview sin entrar al detalle) | ⬜ |
| 7 | CRM-212 | Ajuste iconos PWA maskable en `manifest.webmanifest` | ⬜ |

---

## SPRINT 3 — Semana del 11-17 May (APIs externas)

### Diego

| # | Jira | Tarea | Est. | Estado |
|---|------|-------|------|--------|
| 13 | CRM-214 | **Módulo `meta-ads`**: `GET /api/meta/campaigns/:projectId` — Meta Marketing API v19 | 4-6h | ⬜ |
| 14 | CRM-214 | **Módulo `google-ads`**: `GET /api/google/campaigns/:projectId` + keywords | 4-6h | ⬜ |
| 15 | CRM-214 | **Módulo `gsc`**: `/metrics/:projectId` + `/consolidated/:projectId` — cron diario | 4-6h | ⬜ |
| 16 | — | **Cron IA snapshots**: snapshot mensual Stripe → `ia_metrics_snapshots` (día 1 de cada mes) | 1h | ⬜ |
| 17 | — | **Cron reportes IA**: auto-generación reporte mensual por proyecto (día 1 de cada mes) | 1h | ⬜ |
| 18 | — | **Nginx CSP**: `frame-src` para ChannelPanel (WhatsApp Web, Hostinger) | 15 min | ⬜ |
| 19 | — | **Webhook Meta Lead Ads**: `POST /api/webhooks/meta-leads/:projectId` con HMAC | 2h | ⬜ |

### Angel

| # | Jira | Tarea | Estado |
|---|------|-------|--------|
| 8 | CRM-214 | Desactivar `USE_MOCKS=true` en `meta.api.js`, `google.api.js`, `gsc.api.js` cuando Diego termine | ⬜ |
| 9 | CRM-196 | Export Excel universal — UI con mapeo de columnas (XLSX) | ⬜ |
| 10 | CRM-199 | Comisiones: vista por meses con histórico + export | ⬜ |

---

## SPRINT 4 — Mayo/Junio (Features F5)

### Diego + Angel (coordinado)

| # | Jira | Tarea | Owner | Estado |
|---|------|-------|-------|--------|
| 20 | CRM-151/167/168 | **Canales dinámicos**: reemplazar enum `canal` por CRUD `project_sources` | Diego back + Angel front | ⬜ |
| 21 | CRM-191 | **Branding por proyecto**: color primario, favicon, tema claro/oscuro | Diego back + Angel front | ⬜ |
| 22 | CRM-198 | **Roles granulares**: permisos por módulo, tabla `role_permissions` | Diego back + Angel front | ⬜ |
| 23 | CRM-179 | **Métricas demográficas**: país, género, edad en leads + choropleth map | Diego back + Angel front | ⬜ |
| 24 | CRM-174 | **Nóminas comprobantes**: upload PDF/imagen por ajuste (localStorage.service) | Diego back + Angel front | ⬜ |
| 25 | CRM-161 | **Imagen de producto**: upload + preview en ProductsPage | Diego back + Angel front | ⬜ |
| 26 | CRM-195 | **Categorías 5 niveles**: eliminar `subcategoria_id`, usar closure table | Diego back + Angel front | ⬜ |
| 27 | CRM-150/163-166 | **Egresos avanzados**: categorías dinámicas, comprobantes, iconos | Diego back + Angel front | ⬜ |
| 28 | CRM-157 | **Pagos por cuotas**: fechas auto + email Brevo por cuota | Diego back + Angel front | ⬜ |
| 29 | CRM-197 | **Multi-instancia**: `ENABLED_MODULES` en .env + bundles por instalación | Diego | ⬜ |
| 30 | CRM-196 | **Export Excel backend**: XLSX generado en servidor con mapeo de columnas | Diego | ⬜ |

### Solo Angel

| # | Jira | Tarea | Estado |
|---|------|-------|--------|
| 31 | CRM-155 | Paneles externos en sidebar (Stripe iframe, etc.) | ⬜ |
| 32 | CRM-204 | Documentar design tokens en `frontend/DESIGN_SYSTEM.md` | ⬜ |
| 33 | CRM-205 | Página interna `/dev/components` — preview de UI primitivos | ⬜ |
| 34 | CRM-206 | Vitest + React Testing Library — 3 tests críticos | ⬜ |
| 35 | CRM-207 | Migración gradual a TypeScript — config + 1 módulo piloto | ⬜ |
| 36 | CRM-217 | Superadmin puede renombrar items del sidebar por proyecto | ⬜ |

---

## Backlog sin fecha (decidir cuando)

| # | Jira | Tarea | Notas |
|---|------|-------|-------|
| — | CRM-208 | WhatsApp Web embed mejorado | ChannelPanel ya funciona; decidir si escalar a whatsapp-web.js |
| — | CRM-172 | Modo IA sin pipeline de seguimiento | Reemplazado por módulos configurables JSONB |
| — | CRM-110 | Wizard audiencias — rediseño UX | Marcado "no convenció" en REVISAR.md |
| — | — | R2 Cloudflare para uploads | Cuando lleguen credenciales; interfaz lista en localStorage.service |
| — | — | Producción HTTPS | Necesario para clipboard API y PWA completa |
| — | CRM-193 | Seed demo completo Psiko + Psicologo IA con datos realistas | Para demos comerciales |

---

## Estado de módulos USE_MOCKS

| Módulo | Flag | Estado |
|--------|------|--------|
| `audiences.api.js` | `false` | ✅ Conectado |
| `stripe.api.js` (ia-dashboard) | `false` | ✅ Conectado |
| `reports-ia.api.js` | `false` | ✅ Conectado |
| `claude-chat.api.js` | `false` | ✅ Conectado |
| `meta.api.js` | `true` | ⏳ Sprint 3 |
| `google.api.js` | `true` | ⏳ Sprint 3 |
| `gsc.api.js` | `true` | ⏳ Sprint 3 |

---

## Ramas activas

| Rama | Quién | Qué tiene | Acción |
|------|-------|-----------|--------|
| `feat/sesion-completa` | Angel | Todo frontend hasta hoy (PWA, ChannelPanel, ClientDetail, etc.) | Merge a `feat/user-views-modular` |
| `feat/user-views-modular` | Diego | CRM-300 (vistas usuario + bundles) | Base de trabajo actual |
| `main` | — | Desactualizado (antes de F4) | Merge final cuando estabilicemos |

---

## Notas técnicas críticas

- **Deploy backend**: `pm2 restart crm-api-staging` — nunca `nohup`
- **Deploy frontend**: `MSYS_NO_PATHCONV=1 npx vite build --base=/testeo_crm/` → copiar a `/var/www/crm/staging/frontend/`
- **Nuevas tablas**: siempre `ALTER TABLE x OWNER TO crm_user; ALTER SEQUENCE x_id_seq OWNER TO crm_user;`
- **Storage**: usar `localStorage.service.js` (dir `/var/crm-uploads/`). R2 cuando lleguen credenciales.
- **APIs externas sin credenciales**: devolver `{ success: false, error: '...', code: 'NO_CREDENTIALS' }` con 422, nunca romper
- **SSE (claude-chat)**: header `X-Accel-Buffering: no` obligatorio para Nginx

---

*Última actualización: 2026-04-27*
