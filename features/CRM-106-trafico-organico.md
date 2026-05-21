# CRM-106 · Frontend trafico organico (Google Search Console) + consolidada + keywords

## Estado

- **Frontend:** completado (Angel) — modulo nuevo `frontend/src/modules/seo/`
- **Backend:** pendiente (Diego) — modulo `gsc` por crear

El frontend trabaja con **mocks toggleables**. Cuando el backend este listo, basta con
cambiar `USE_MOCKS = false` en [`frontend/src/modules/seo/api/gsc.api.js`](../../frontend/src/modules/seo/api/gsc.api.js).

## Lo que entrega el frontend

- **Nueva ruta:** `/crm/seo` — entrada sidebar "Trafico organico" (icono lupa, roles SA/A)
- **Banner permanente:** "Datos con retraso de 2-3 días" + fecha de ultima actualizacion (calculada al render).
- **Period selector:** presets 7/14/28/90 dias + custom range (hasta = hoy - 3 dias por delay GSC).
- **4 KPIs:** Clicks, Impresiones, CTR medio, Posicion media.
- **Grafica consolidada:** LineChart 12 meses con 3 series:
  - Trafico organico (verde, eje izquierdo)
  - Trafico pagado Meta+Google (azul, eje izquierdo)
  - Leads CRM (violeta, eje derecho, dashed)
- **Tabla top 20 keywords** con clicks, impresiones, CTR, **posicion coloreada por rango** (1-3 verde, 4-10 azul, 11-20 ambar, 20+ rojo).
- **Mobile:** todo apilado, tabla → cards, charts mantienen aspect ratio.

## Contrato de los endpoints que Diego debe implementar

### `GET /api/gsc/metrics/:projectId`

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin |

**Path params:** `projectId` (required)

**Query params:**
- `fechaDesde` (ISO 8601, default: 28 dias atras)
- `fechaHasta` (ISO 8601, default: hoy - 3 dias)
- `dimension` (string, optional: `query` | `page` | `device`, default: `query`)

**Response 200:**

```jsonc
{
  "success": true,
  "data": {
    "totals": {
      "clicks": 12480,
      "impressions": 358400,
      "ctr": 3.48,                  // %
      "position": 12.4              // posicion media SERP
    },
    "rows": [
      {
        "key": "master psicologia forense",
        "clicks": 1240,
        "impressions": 18400,
        "ctr": 6.74,
        "position": 4.2
      }
      // ... resto ordenadas por clicks desc
    ],
    // === EXTENSION CRM-106 (anadir al spec base) ===
    "lastUpdate": "2026-04-22"      // ISO 8601, fecha del ultimo dia con datos GSC
  }
}
```

### `GET /api/gsc/consolidated/:projectId`

Datos mensuales 12 meses para grafica organic + paid + leads.

**Response 200:**

```jsonc
{
  "success": true,
  "data": {
    "months": [
      {
        "mes": "2026-01",                  // YYYY-MM
        "organicTraffic": 8500,            // clicks GSC del mes
        "paidTraffic": 4200,               // clicks Meta + Google del mes
        "totalLeads": 45                   // leads CRM creados ese mes
      }
      // ... 12 meses ordenados ASC
    ]
  }
}
```

**Notas backend:**
- GSC tiene retraso de ~2-3 dias en datos. Devolver `lastUpdate` con el ultimo dia disponible.
- `totalLeads` se calcula en backend con un GROUP BY mes sobre la tabla `leads` filtrada por `project_id`.
- `paidTraffic` suma `clicks` de Meta + Google. Si no hay credenciales configuradas para alguno, devolver 0 para ese campo.
- Cachear respuesta GSC ~6h (rate limits + delay natural de los datos).
- Almacenar credenciales OAuth en `api_credentials` (existente, AES-256-GCM): refresh_token + property_url (sc-domain:ejemplo.com).

## Como activar el modulo en frontend cuando backend este listo

```diff
// frontend/src/modules/seo/api/gsc.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

## Pendientes que dependen de este endpoint

- **CRM-110** Wizard creacion audiencia — usa GSC para filtrado por intent organico.
- **CRM-113** Reportes IA markdown — incluye seccion "Trafico organico" en el reporte mensual.
