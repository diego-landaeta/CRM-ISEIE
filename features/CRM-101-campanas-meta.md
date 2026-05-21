# CRM-101 · Frontend campanas Meta Ads

## Estado

- **Frontend:** completado (Angel) — `frontend/src/modules/campaigns/`
- **Backend:** pendiente (Diego) — modulo `meta-ads` por crear

El frontend trabaja con **mocks toggleables**. Cuando el backend este listo, basta con
cambiar `USE_MOCKS = false` en [`frontend/src/modules/campaigns/api/meta.api.js`](../../frontend/src/modules/campaigns/api/meta.api.js).

## Lo que entrega el frontend

- **Tabs Meta / Google** (Google placeholder hasta CRM-104).
- **Filtro de periodo:** presets 7/14/30/90 dias + custom range.
- **KPIs:** Inversion total, Clicks, Leads CRM, CPA real (con alerta visual si supera umbral).
- **Tabla campanas** (desktop) + **cards apiladas** (mobile) con: nombre, objective, estado, gasto, clicks, CPL Meta, leads CRM, conversiones CRM, CPA real.
- **Alerta CPA:** filas con `costPerCrmConversion > 100 EUR` se resaltan en rojo + icon warning. Umbral configurable en `CampaignsPage.jsx::CPA_ALERT_THRESHOLD`.
- **Mocks** en [`frontend/src/modules/campaigns/mocks/meta.mock.js`](../../frontend/src/modules/campaigns/mocks/meta.mock.js) con datos por proyecto (Psiko / ISEIH / Fono Aprende).

## Contrato del endpoint que Diego debe implementar

### `GET /api/meta/campaigns/:projectId`

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin |

**Path params:**
- `projectId` (number, required)

**Query params:**
- `fechaDesde` (ISO 8601, default: 30 dias atras)
- `fechaHasta` (ISO 8601, default: hoy)
- `level` (string, optional: `campaign` | `adset` | `ad`, default: `campaign`)

**Response 200:**

```jsonc
{
  "success": true,
  "data": [
    {
      "campaignId": "120201234567890123",
      "campaignName": "Spring Campaign 2026",
      "status": "ACTIVE",                  // ACTIVE | PAUSED | COMPLETED
      "objective": "LEAD_GENERATION",
      "metrics": {
        "impressions": 150000,
        "clicks": 4500,
        "spend": 1200.50,                  // EUR
        "ctr": 3.0,                        // %
        "cpc": 0.27,                       // EUR
        "cpm": 8.00                        // EUR
      },
      "crmLeadCount": 85,                  // conteo leads del CRM (UTM matching)
      "crmConversionCount": 12,            // conversiones CRM
      "costPerCrmLead": 14.12,             // spend / crmLeadCount
      "costPerCrmConversion": 100.04       // spend / crmConversionCount
    }
  ]
}
```

**Notas backend:**
- Convertir `spend` a EUR (Meta devuelve en moneda de la cuenta).
- Para `crmLeadCount`/`crmConversionCount` cruzar leads CRM por UTM source/campaign con `campaignId` o `campaignName`.
- Cachear respuestas Meta API ~15 min (rate limits).
- Almacenar credenciales encriptadas en `api_credentials` (existente, AES-256-GCM).

## Como activar el modulo en frontend cuando backend este listo

```diff
// frontend/src/modules/campaigns/api/meta.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

No se necesita ningun otro cambio: el shape de respuesta ya esta acordado.

## Pendientes que dependen de este endpoint

- **CRM-104** Google Ads (mismo shape adaptado, vista consolidada).
- **CRM-115** Boton "Subir a Meta" en wizard de audiencias (Fase 3).
