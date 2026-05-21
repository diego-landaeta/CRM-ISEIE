# CRM-104 · Frontend Google Ads + Dashboard consolidado Meta+Google

## Estado

- **Frontend:** completado (Angel) — extiende `frontend/src/modules/campaigns/`
- **Backend:** pendiente (Diego) — modulo `google-ads` por crear

El frontend trabaja con **mocks toggleables**. Cuando el backend este listo, basta con
cambiar `USE_MOCKS = false` en [`frontend/src/modules/campaigns/api/google.api.js`](../../frontend/src/modules/campaigns/api/google.api.js).

## Lo que entrega el frontend

- **3 tabs**: Consolidado / Meta Ads / Google Ads (activo por defecto: Consolidado)
- **Tab Consolidado**:
  - 4 KPIs sumando ambas plataformas (Inversion total, Clicks, Leads CRM, CPA real)
  - 2 charts comparativos: Inversion por plataforma + Leads CRM por plataforma
  - Tabla resumen breakdown Meta vs Google
- **Tab Google Ads**:
  - 4 KPIs (Inversion, Clicks, Leads CRM, CPA real)
  - Tabla campanas (desktop) + cards mobile con: nombre, tipo (SEARCH/PMAX/DISPLAY), estado, gasto, clicks, CPC, leads CRM, conv. CPA real
  - Top keywords (max 20) con quality score coloreado (verde >=8, ambar >=5, rojo <5)
- **Period selector compartido**: filtros de fecha aplican a ambas plataformas en simultaneo
- **Alertas CPA**: igual que Meta (filas rojas si CPA > 100€)

## Contrato del endpoint que Diego debe implementar

### `GET /api/google/campaigns/:projectId`

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin |

**Path params:**
- `projectId` (number, required)

**Query params:**
- `fechaDesde` (ISO 8601, default: 30 dias atras)
- `fechaHasta` (ISO 8601, default: hoy)

**Response 200:**

```jsonc
{
  "success": true,
  "data": {
    "campaigns": [
      {
        "campaignId": "20012345678",
        "campaignName": "Search - Consultoria",
        "status": "ENABLED",                  // ENABLED | PAUSED | REMOVED
        "type": "SEARCH",                     // SEARCH | DISPLAY | VIDEO | SHOPPING | PERFORMANCE_MAX
        "metrics": {
          "impressions": 80000,
          "clicks": 3200,
          "spend": 950.00,                    // EUR (Google API devuelve micros, convertir a EUR)
          "ctr": 4.0,                         // %
          "cpc": 0.30,                        // EUR
          "conversions": 45,                  // conversiones reportadas por Google
          "conversionRate": 1.41              // %
        },
        // === EXTENSION CRM-104 (anadir al spec base) ===
        "crmLeadCount": 71,                   // leads CRM cruzados por UTM matching
        "crmConversionCount": 11,             // conversiones CRM
        "costPerCrmLead": 13.38,              // spend / crmLeadCount
        "costPerCrmConversion": 86.36         // spend / crmConversionCount
      }
    ],
    "keywords": [
      {
        "keyword": "consultoria marketing digital",
        "matchType": "PHRASE",                // EXACT | PHRASE | BROAD
        "impressions": 5000,
        "clicks": 200,
        "spend": 80.00,
        "ctr": 4.0,
        "cpc": 0.40,
        "qualityScore": 8                     // 1-10, devuelto por Google Ads API
      }
    ]
  }
}
```

**Notas backend:**
- Convertir `spend` a EUR (Google devuelve en micros + moneda cuenta).
- Para `crmLeadCount`/`crmConversionCount` cruzar leads CRM por UTM source/campaign con `campaignId` o `campaignName`. Mismo patron que Meta (CRM-101).
- `qualityScore` viene de la Google Ads API.
- Cachear respuestas Google Ads ~15 min (rate limits).
- Almacenar credenciales en `api_credentials` (existente, AES-256-GCM): developer token + OAuth refresh token + customer_id.

## Vista consolidada — sin endpoint adicional

El frontend hace **fetch en paralelo** de `/api/meta/campaigns/:projectId` + `/api/google/campaigns/:projectId` y suma los totales en cliente. **NO se requiere un endpoint consolidado nuevo** — los charts y KPIs cruzados se calculan en el hook `useCampaigns`.

Si en el futuro se quiere granularidad mensual (Jira CRM-104 menciona "barras apiladas Meta vs Google por periodo"), se podria anadir:

```
GET /api/campaigns/consolidated/:projectId?desde=&hasta=&granularity=monthly
```

Pero por ahora la vista consolidada actual cumple los criterios de aceptacion.

## Como activar el modulo en frontend cuando backend este listo

```diff
// frontend/src/modules/campaigns/api/google.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

(Y lo mismo en `meta.api.js` cuando ese tambien este listo).

## Pendientes que dependen de este endpoint

- **CRM-115** Boton "Subir a Meta" en wizard de audiencias (Fase 3) — usa Meta, no Google.
- **CRM-106** Trafico organico GSC — comparte la layout pero datos distintos.
