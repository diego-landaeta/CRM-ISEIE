# Pendiente backend — checklist consolidado para Diego

> Lista cerrada y trazable de todo lo que el backend necesita implementar/extender
> para que las features frontend ya entregadas funcionen contra datos reales.
> Cada item incluye: que hace, ruta, contrato, donde mirar el frontend.

---

## 0. Como se activa cada modulo

Todos los modulos frontend entregados tienen un flag `USE_MOCKS` por modulo:

```js
// frontend/src/modules/<modulo>/api/<modulo>.api.js
const USE_MOCKS = true; // <-- cambiar a false cuando el endpoint este vivo
```

Lista de archivos (7 flags):
- `frontend/src/modules/campaigns/api/meta.api.js`
- `frontend/src/modules/campaigns/api/google.api.js`
- `frontend/src/modules/seo/api/gsc.api.js`
- `frontend/src/modules/ia-dashboard/api/stripe.api.js`
- `frontend/src/modules/leads/api/audiences.api.js`
- `frontend/src/modules/reports-ia/api/reports-ia.api.js`
- `frontend/src/modules/ai-chat/api/claude-chat.api.js`

---

## 1. Modulos backend nuevos (crear)

### 1.1 `meta-ads` — CRM-101

| Endpoint | Metodo | Roles |
|----------|--------|-------|
| `/api/meta/campaigns/:projectId` | GET | SA, A |

**Query params:** `fechaDesde`, `fechaHasta`, `level` (campaign/adset/ad).

**Response:** array con `campaignId, campaignName, status (ACTIVE/PAUSED/COMPLETED), objective, metrics{impressions,clicks,spend,ctr,cpc,cpm}, crmLeadCount, crmConversionCount, costPerCrmLead, costPerCrmConversion`.

**Detalles tecnicos:**
- Convertir `spend` a EUR (Meta devuelve en moneda de cuenta).
- `crmLeadCount` y `crmConversionCount` se calculan cruzando leads CRM por UTM source/campaign con `campaignId`/`campaignName`.
- Cachear respuesta Meta API ~15 min.
- Credenciales en tabla `api_credentials` (existente, AES-256-GCM): `access_token` + `account_id` (encriptado).

**Doc detallada:** [`Claude/features/CRM-101-campanas-meta.md`](features/CRM-101-campanas-meta.md)

---

### 1.2 `google-ads` — CRM-104

| Endpoint | Metodo | Roles |
|----------|--------|-------|
| `/api/google/campaigns/:projectId` | GET | SA, A |

**Query params:** `fechaDesde`, `fechaHasta`.

**Response:**
```jsonc
{
  "campaigns": [{
    "campaignId", "campaignName",
    "status": "ENABLED|PAUSED|REMOVED",
    "type": "SEARCH|DISPLAY|VIDEO|SHOPPING|PERFORMANCE_MAX",
    "metrics": { "impressions","clicks","spend","ctr","cpc","conversions","conversionRate" },
    "crmLeadCount", "crmConversionCount",
    "costPerCrmLead", "costPerCrmConversion"
  }],
  "keywords": [{ "keyword","matchType","impressions","clicks","spend","ctr","cpc","qualityScore" }]
}
```

**Detalles:**
- Google API devuelve `spend` en micros — convertir a EUR.
- `qualityScore` de 1-10 viene directo de Google Ads API.
- Cachear ~15 min.
- Credenciales: developer token + OAuth refresh token + customer_id (todos encriptados).

**Doc:** [`CRM-104-google-ads-consolidado.md`](features/CRM-104-google-ads-consolidado.md)

---

### 1.3 `gsc` — CRM-106 (Google Search Console)

| Endpoint | Metodo | Roles |
|----------|--------|-------|
| `/api/gsc/metrics/:projectId` | GET | SA, A |
| `/api/gsc/consolidated/:projectId` | GET | SA, A |

**`/metrics` query:** `fechaDesde`, `fechaHasta`, `dimension` (query/page/device).

**`/metrics` response:**
```jsonc
{
  "totals": { "clicks", "impressions", "ctr", "position" },
  "rows": [{ "key", "clicks", "impressions", "ctr", "position" }],
  "lastUpdate": "2026-04-22"  // ISO date — ultimo dia con datos GSC (campo NUEVO en spec)
}
```

**`/consolidated` response:**
```jsonc
{
  "months": [
    { "mes": "2026-01", "organicTraffic", "paidTraffic", "totalLeads" }
  ]
}
```

**Detalles:**
- GSC tiene retraso de 2-3 dias. Devolver `lastUpdate` con el ultimo dia disponible.
- `paidTraffic` = clicks Meta + Google del mes (suma de `meta-ads` + `google-ads`).
- `totalLeads` = COUNT leads del proyecto agrupado por mes.
- Cachear respuesta GSC ~6h.
- Credenciales: OAuth refresh_token + `property_url` (sc-domain:ejemplo.com).

**Doc:** [`CRM-106-trafico-organico.md`](features/CRM-106-trafico-organico.md)

---

### 1.4 `ia-monitor` — CRM-108 (Stripe Monitor)

| Endpoint | Metodo | Roles |
|----------|--------|-------|
| `/api/ia/metrics/:projectId` | GET | SA, A |

**Response:**
```jsonc
{
  "mrr": 15400.00,
  "activeSubs": 128,
  "newSubs": 12,
  "cancelledSubs": 3,
  "failedPayments": 5,
  "churnRate": 2.34,
  "evolution12Months": [
    { "mes", "mrr", "activeSubs", "newSubs", "cancelledSubs", "churnRate" }
  ]
}
```

**Detalles:**
- `mrr` = sum(`subscription.items.price.unit_amount` * quantity) de subs activas, normalizado a mensual.
- `churnRate` = `cancelledSubs / activeSubs(mes anterior) * 100`.
- Snapshots mensuales en tabla local `ia_metrics_snapshots` para no llamar Stripe en cada request.
- Cachear ~30 min.
- Credenciales Stripe: `stripe_secret_key` (restricted, solo lectura).

**Doc:** [`CRM-108-dashboard-ia-mrr.md`](features/CRM-108-dashboard-ia-mrr.md)

---

### 1.5 `audiences` — CRM-110 + CRM-115

3 endpoints en este modulo:

#### `POST /api/audiences/preview` (CRM-110, NUEVO)

**Body:** `{ projectId, filters: { statuses[], canales[], fechaDesde, fechaHasta, productoId, importeMinimo } }`

**Response:**
```jsonc
{
  "totalCount": 87,
  "breakdown": {
    "status": { "convertido": 17, ... },
    "canal":  { "meta_ads": 28, ... }
  },
  "sample": [{ "id", "nombre", "email", "telefono", "estado", "canal", "fecha_solicitud" }]  // primeros 10 SIN hashear
}
```

#### `POST /api/audiences/export` (existente — verificar)

Devuelve `text/csv` con email_hash, phone_hash, first_name, last_name (SHA-256 lowercase, requirement Meta).

#### `POST /api/audiences/upload-meta` + `/status/:uploadId` + `/history` (CRM-115, NUEVOS)

Endpoint `/upload-meta` ya documentado. Anadir:
- `GET /api/audiences/upload-meta/:uploadId/status` — polling del estado.
- `GET /api/audiences/upload-meta/history?projectId=X` — historial (max 20).

**Tabla nueva `meta_uploads`:**
```sql
id, project_id, audience_id, audience_name, records_uploaded,
match_rate (NULL inicialmente, se actualiza async),
status (preparing|uploading|processing|completed|error),
started_at, completed_at, created_by
```

**Detalles:**
- Cliente envia POST → backend hashea → llama Meta Marketing API.
- Polling cliente cada 5s (mock acelerado a 1.5s para demo).
- Match rate se actualiza ~5-15 min despues por Meta — backend lo lee con cron.

**Docs:** [`CRM-110-wizard-audiencia.md`](features/CRM-110-wizard-audiencia.md), [`CRM-115-subir-meta.md`](features/CRM-115-subir-meta.md)

⚠️ **CRM-110 wizard pendiente de rediseno UX** (ver `Claude/REVISAR.md`). El backend igual sigue valido.

---

### 1.6 `reports-ia` — CRM-113 + CRM-121

| Endpoint | Metodo | Roles |
|----------|--------|-------|
| `/api/reports/:projectId` | GET | SA, A, G |
| `/api/reports/detail/:id` | GET | SA, A, G |
| `/api/reports/:projectId/generate` | POST | SA, A |
| `/api/reports/:id/export-pdf` | POST | SA, A |

**Generate body:** `{ periodo?: "YYYY-MM" }` (default mes anterior).

**Response generate:**
```jsonc
{
  "id", "projectId", "periodo",
  "content": "# Reporte Mensual...\n\n## Resumen Ejecutivo\n\n...",  // markdown
  "metadata": { "leadsAnalizados", "conversionesAnalizadas", "facturacionTotal", "fuentesDatos": [...] },
  "generadoPor": { "id", "nombre" },
  "createdAt"
}
```

**Detalles:**
- Backend orquesta: pull datos del CRM + Meta + Google + GSC del periodo → prompt a Claude API → persistir markdown.
- Cachear: una vez generado un reporte de un periodo, no regenerar a menos que se fuerce.
- Rate limit: max 1 reporte / proyecto / dia.

**PDF (CRM-121):**
- Frontend ya genera PDF real client-side via jsPDF cuando USE_MOCKS=true (incluye headers, tablas, paginacion).
- Cuando backend este listo, el endpoint `POST /reports/:id/export-pdf` debe usar **Puppeteer headless** o **wkhtmltopdf** para generar PDF con branding del proyecto (logo + colores).
- Almacenar en R2: `pdf_url` + `pdf_generated_at` en tabla `reports`. Si ya existe, devolver el cached.

**Docs:** [`CRM-113-reportes-ia.md`](features/CRM-113-reportes-ia.md), [`CRM-121-exportar-pdf.md`](features/CRM-121-exportar-pdf.md)

---

### 1.7 `claude-chat` — CRM-119

| Endpoint | Metodo | Roles | Rate limit |
|----------|--------|-------|------------|
| `/api/claude/chat` | POST | SA, A, G | 20 msg/h/usuario |

**Body:** `{ message: string, projectId: number }`

**Response:** `text/event-stream` con eventos SSE:
```
data: {"type":"start","messageId":"uuid"}
data: {"type":"delta","content":"En marzo "}
data: {"type":"delta","content":"2026..."}
data: {"type":"done","messageId":"uuid","usage":{"promptTokens","completionTokens"}}
```

**Detalles:**
- Pre-cargar contexto del proyecto en el system prompt: leads recientes, conversiones, KPIs Meta+Google, GSC.
- Cachear contexto por 5 min (mismo proyecto + usuario).
- Tabla `ai_conversations` + `ai_messages` para auditoria.
- Headers SSE: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no` (Nginx).
- Implementar **abort:** si el cliente cierra la conexion, parar la llamada a Claude API.

**Doc:** [`CRM-119-chat-ia.md`](features/CRM-119-chat-ia.md)

---

## 2. Modificaciones a endpoints existentes

### 2.1 `POST /api/leads/bulk` — NUEVO (opcional, optimizacion)

Frontend hace import CSV via loops POST `/api/leads` (1 request por fila). Funciona pero es lento para 200 filas.

**Optimizacion futura:** anadir `POST /api/leads/bulk` que acepte array de hasta 200 leads y los inserte en una transaccion.

**Body:**
```jsonc
{
  "projectId": 1,
  "leads": [
    { "nombre", "email", "telefono", "canal", "producto_interes", "notas" }
  ]
}
```

**Response:**
```jsonc
{
  "ok": 95,
  "fail": 5,
  "errors": [{ "line": 7, "error": "Email duplicado" }]
}
```

⚠️ **No bloqueante** — el flujo actual funciona via loops. Este endpoint es solo para mejor performance.

### 2.2 `GET /api/leads` — campo `next_reminder_at` ✅ YA HECHO

Backend ya devuelve `next_reminder_at` (subquery min `lead_reminders` donde `completado=false`). Verificar que esta en la respuesta.

### 2.3 `POST /api/leads/:id/interactions` — auto-log

Frontend ahora registra interacciones automaticamente cuando el usuario clica WhatsApp/Email en la tabla.

Verificar que el endpoint acepta:
```jsonc
{
  "tipo": "whatsapp" | "email" | "llamada" | "nota",
  "nota": "string opcional",
  "fecha": "ISO date opcional"
}
```

Si no acepta `fecha`, anadirlo (cliente envia `new Date().toISOString()`).

### 2.4 `POST /api/leads/:id/reminders` — verificar

Frontend envia:
```jsonc
{ "fecha": "ISO date", "nota": "string" }
```

Verificar que coincide con el modelo backend (`fecha_recordatorio` puede ser el campo real, ajustar si necesario).

### 2.5 `PATCH /api/leads/:id/status` — usado desde

- Pipeline drag&drop.
- Tabla "Marcar contactado".
- Conversion (auto-pasa a `convertido` despues de crear conversion).

Body actual: `{ status, motivo }`. Verificar que sigue funcionando.

---

## 3. Migraciones SQL pendientes

### 3.1 Tabla `meta_uploads` (CRM-115)
```sql
CREATE TABLE meta_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   INTEGER NOT NULL REFERENCES projects(id),
  audience_id   VARCHAR(100) NOT NULL,
  audience_name VARCHAR(255) NOT NULL,
  records_uploaded INTEGER NOT NULL DEFAULT 0,
  match_rate    DECIMAL(5,2),  -- NULL hasta que Meta lo calcule
  status        VARCHAR(20) NOT NULL DEFAULT 'preparing',  -- preparing|uploading|processing|completed|error
  error_message TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  created_by    INTEGER REFERENCES users(id)
);
CREATE INDEX idx_meta_uploads_project ON meta_uploads(project_id, started_at DESC);
```

### 3.2 Tabla `ia_metrics_snapshots` (CRM-108)
```sql
CREATE TABLE ia_metrics_snapshots (
  id              SERIAL PRIMARY KEY,
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  mes             VARCHAR(7) NOT NULL,  -- "2026-04"
  mrr             DECIMAL(12,2) NOT NULL,
  active_subs     INTEGER NOT NULL,
  new_subs        INTEGER NOT NULL,
  cancelled_subs  INTEGER NOT NULL,
  churn_rate      DECIMAL(5,2) NOT NULL,
  failed_payments INTEGER NOT NULL DEFAULT 0,
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, mes)
);
```

### 3.3 Tablas `ai_conversations` + `ai_messages` (CRM-119)
```sql
CREATE TABLE ai_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  INTEGER NOT NULL REFERENCES projects(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE ai_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            VARCHAR(20) NOT NULL,  -- user | assistant
  content         TEXT NOT NULL,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ai_messages_conv ON ai_messages(conversation_id, created_at);
```

### 3.4 Tabla `reports` (CRM-113) — verificar si existe
Si no existe:
```sql
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      INTEGER NOT NULL REFERENCES projects(id),
  periodo         VARCHAR(7) NOT NULL,  -- "2026-04"
  content         TEXT NOT NULL,         -- markdown
  metadata        JSONB,
  pdf_url         TEXT,
  pdf_generated_at TIMESTAMPTZ,
  generated_by    INTEGER NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (project_id, periodo)
);
CREATE INDEX idx_reports_project_periodo ON reports(project_id, periodo DESC);
```

---

## 4. Variables de entorno nuevas

Anadir a `.env.example`:

```bash
# Anthropic (CRM-119 chat IA + CRM-113 reportes)
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-opus-4-7

# Stripe (CRM-108)
STRIPE_SECRET_KEY=sk_live_... # restricted read-only key

# Cuotas / rate limits
CHAT_MAX_MESSAGES_PER_HOUR=20
REPORTS_MAX_PER_DAY=1
```

Las credenciales por proyecto (Meta, Google, GSC, Brevo, Stripe) van encriptadas en `api_credentials`.

---

## 5. Cron jobs nuevos

### 5.1 Snapshot mensual de IA metrics (CRM-108)
Cron `0 1 1 * *` (dia 1 de cada mes a las 01:00) → consulta Stripe, calcula `mrr/churn/etc` del mes anterior, inserta en `ia_metrics_snapshots`.

### 5.2 Sync match_rate de Meta uploads (CRM-115)
Cron `*/15 * * * *` (cada 15 min) → consulta Meta API por uploads en estado `processing`, actualiza `match_rate` y pasa a `completed`.

### 5.3 Auto-generacion de reportes mensuales (CRM-113)
Cron `0 8 1 * *` (dia 1 de cada mes a las 08:00) → genera reporte automatico del mes anterior para cada proyecto activo. Configurable per-proyecto via `auto_reports_enabled`.

---

## 6. Resumen rapido — lista de TODOs

- [ ] Crear modulo `meta-ads` (1 endpoint)
- [ ] Crear modulo `google-ads` (1 endpoint)
- [ ] Crear modulo `gsc` (2 endpoints)
- [ ] Crear modulo `ia-monitor` (1 endpoint) + tabla `ia_metrics_snapshots` + cron mensual
- [ ] Anadir `/preview` a modulo `audiences` + endpoints upload-meta + tabla `meta_uploads` + cron sync match_rate
- [ ] Crear modulo `reports-ia` (4 endpoints) + tabla `reports` + integracion Claude AI + Puppeteer/wkhtmltopdf
- [ ] Crear modulo `claude-chat` (1 endpoint SSE) + tablas `ai_conversations` + `ai_messages`
- [ ] Verificar `POST /leads/:id/interactions` acepta `fecha`
- [ ] Verificar `POST /leads/:id/reminders` acepta `{ fecha, nota }`
- [ ] (opcional) Anadir `POST /leads/bulk` para importacion CSV mas rapida
- [ ] Anadir env vars `ANTHROPIC_API_KEY`, `STRIPE_SECRET_KEY`, rate limits

---

## 7. Como activar despues de implementar

Por cada modulo terminado:

```diff
// frontend/src/modules/<modulo>/api/<modulo>.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

No hacen falta cambios adicionales — todos los shapes de respuesta ya estan acordados.

---

## 8. Notificaciones push (frontend listo, falta backend)

**Estado frontend:** UI completa en `/notificaciones` con permisos del navegador,
preferencias por tipo de evento y canal (in-app / push / email), modo "no molestar"
y horas silencio. Hoy las preferencias se guardan en `localStorage` y las
notificaciones de prueba funcionan localmente vía `Notification` API + Service Worker.

**Falta backend** para enviar push reales desde el servidor:

| Endpoint | Metodo | Roles | Que hace |
|----------|--------|-------|----------|
| `/api/push-subscriptions` | POST | autenticado | Guarda subscription del navegador (endpoint, p256dh, auth) por user_id |
| `/api/push-subscriptions/:id` | DELETE | propio user | Borra suscripcion al desactivar |
| `/api/notification-preferences` | GET | autenticado | Devuelve preferencias del user |
| `/api/notification-preferences` | PUT | autenticado | Actualiza preferencias (mismo shape que `frontend/src/modules/notificaciones/lib/preferences.ts`) |

**Stack recomendado:**

- Generar VAPID keys con `web-push generate-vapid-keys` y exponer la public key como env (`VITE_VAPID_PUBLIC_KEY`).
- Backend usa `web-push` npm para enviar.
- Tabla `push_subscriptions(id, user_id, endpoint UNIQUE, keys jsonb, user_agent, created_at)`.
- Tabla `notification_preferences(user_id PK, preferences jsonb)` con shape de `NotificationPreferences`.

**Disparadores (eventos que generan notificación):**

- `lead.assigned` → al gestor asignado por round-robin
- `reminder.due_soon` (cron 5 min) → owner si quedan <60 min
- `reminder.overdue` (cron 5 min) → owner cuando ya pasó
- `conversion.created` → admin/superadmin del proyecto
- `payment.received` → admin/superadmin
- `matricula.pending` → roles con permiso `matriculas.read`
- `system.alert` → broadcast a admin/superadmin (siempre se entrega, ignora DnD)

**Frontend ya envía** la subscription al endpoint cuando exista — ver
`frontend/src/modules/notificaciones/hooks/useNotifications.ts:72`. Los toasts
in-app de la campana del header siguen funcionando sin push.
