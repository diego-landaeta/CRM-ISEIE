# CRM-115 · Frontend boton "Subir a Meta" + estado tiempo real

## ⚠️ Dependencia

Esta feature vive dentro del wizard de audiencias (CRM-110), que actualmente esta marcado para rediseno (ver `Claude/REVISAR.md`). Si CRM-110 cambia de patron, el "Subir a Meta" se mueve donde corresponda.

## Estado

- **Frontend:** completado (Angel) — anadido a `frontend/src/modules/leads/pages/AudienceExportPage.jsx` step 3
- **Backend:** pendiente (Diego) — Fase 3, `/api/audiences/upload-meta` documentado parcialmente

USE_MOCKS=true en [`audiences.api.js`](../../frontend/src/modules/leads/api/audiences.api.js).

## Lo que entrega el frontend

- **Boton "Subir a Meta"** en step 3 del wizard, junto al CSV download
- **Disabled** mientras hay un upload en curso (estado in-flight) o si la audiencia es <20 leads
- **Timeline de estado en tiempo real** con 4 stages:
  1. Preparando (hasheando emails/telefonos)
  2. Subiendo a Meta (transferencia API)
  3. Procesando en Meta (Meta cruza datos)
  4. Completado
  - Iconos: spinner en stage activo, check en stages completados
  - Match rate visible cuando completa (% de leads que Meta pudo cruzar)
- **Historial de uploads** del proyecto al final de la pagina:
  - Nombre audiencia + ID Meta
  - Fecha
  - Records uploaded
  - Match rate
  - Estado
  - Tabla en desktop, cards en mobile
- **Polling cada 1.5s** (mock acelerado) — el backend real usaria 5s

## Contrato de los endpoints

### `POST /api/audiences/upload-meta` (existente, documentado)

Inicia el upload. Devuelve `uploadId` para polling posterior.

```jsonc
// Request
{
  "projectId": 1,
  "audienceId": "meta-aud-existente",  // opcional, si se omite se crea nueva
  "filters": { /* mismos filtros que /export */ }
}

// Response
{
  "success": true,
  "data": {
    "uploadId": "up_abc123",                    // NUEVO — para polling
    "audienceId": "meta-aud-id",
    "audienceName": "CRM auto - Proyecto - 2026-04-25",
    "recordsUploaded": 280,
    "matchRate": null,
    "status": "preparing"                       // preparing | uploading | processing | completed | error
  }
}
```

### `GET /api/audiences/upload-meta/:uploadId/status` (NUEVO)

Polling del estado del upload.

```jsonc
{
  "success": true,
  "data": {
    "uploadId": "up_abc123",
    "audienceId": "meta-aud-id",
    "audienceName": "...",
    "recordsUploaded": 280,
    "matchRate": 78.4,                          // null hasta que completa
    "status": "completed"
  }
}
```

### `GET /api/audiences/upload-meta/history?projectId=X` (NUEVO)

Historial de uploads del proyecto (max 20).

```jsonc
{
  "success": true,
  "data": [
    {
      "audienceId": "meta-aud-id",
      "audienceName": "CRM auto - X - convertidos",
      "recordsUploaded": 245,
      "matchRate": 78.4,
      "status": "completed",
      "uploadedAt": "2026-04-18T14:30:00Z"
    }
  ]
}
```

**Notas backend:**
- Roles: `superadmin` solo (Meta requires SA — segun spec original).
- Almacenar `meta_uploads` en DB (id, project_id, audience_id, audience_name, records_uploaded, match_rate, status, started_at, completed_at).
- El polling deberia limitarse a 5s con `If-Modified-Since` o ETag para no saturar.
- `matchRate` se actualiza ~5-15 min despues del upload (Meta lo calcula async). El frontend hace polling solo durante el upload activo, despues de "completed" deja de pollear pero el match rate se completa offline en backend.

## Como activar cuando Diego termine

```diff
// frontend/src/modules/leads/api/audiences.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```
