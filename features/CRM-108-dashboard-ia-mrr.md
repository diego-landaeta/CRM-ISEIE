# CRM-108 · Frontend Dashboard IA (MRR, subs, churn)

## Estado

- **Frontend:** completado (Angel) — modulo `frontend/src/modules/ia-dashboard/`
- **Backend:** pendiente (Diego) — modulo `ia-monitor` por crear (lectura de Stripe API)

El frontend trabaja con **mocks toggleables**. Cuando el backend este listo, basta con
cambiar `USE_MOCKS = false` en [`frontend/src/modules/ia-dashboard/api/stripe.api.js`](../../frontend/src/modules/ia-dashboard/api/stripe.api.js).

## Lo que entrega el frontend

- **Nueva ruta:** `/crm/ia-dashboard` — sidebar "Dashboard IA" (icono Robot, **solo roles SA/A**, gestor no lo ve)
- **Guard cliente:** redirige a `/` si rol es gestor (defensa en profundidad — el sidebar tampoco lo expone)
- **4 KPIs Hero principales** con variacion mensual (verde si crece / rojo si decrece):
  - MRR actual + delta % vs mes anterior
  - Suscripciones activas + delta % vs mes anterior
  - Churn rate mensual + delta puntos porcentuales
  - Cobros fallidos (warning si >0)
- **2 cards secundarias:** Nuevas subs (verde, +N) y Cancelaciones (rojo, -N) del mes
- **3 charts:**
  - LineChart MRR 12 meses
  - BarChart Churn rate 12 meses con linea de referencia "Alerta 5%" en rojo
  - LineChart Subs activas 12 meses
- **Empty states:** Si proyecto no es tipo `ia` (ej. CRM), muestra mensaje guiando a elegir Psicologo/Nutricionista/Tarot IA

## Contrato del endpoint

### `GET /api/ia/metrics/:projectId`

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin |

**Path params:** `projectId` (required)

**Response 200:**

```jsonc
{
  "success": true,
  "data": {
    "mrr": 15400.00,                    // EUR, ingresos recurrentes mensuales
    "activeSubs": 128,
    "newSubs": 12,                      // del mes actual
    "cancelledSubs": 3,                 // del mes actual
    "failedPayments": 5,                // del mes actual
    "churnRate": 2.34,                  // % del mes actual
    "evolution12Months": [
      {
        "mes": "2025-05",                // YYYY-MM
        "mrr": 8200.00,
        "activeSubs": 72,
        "newSubs": 8,
        "cancelledSubs": 2,
        "churnRate": 2.78
      }
      // ... 12 meses ordenados ASC, ultimo = mes actual
    ]
  }
}
```

**Notas backend:**
- `mrr`: suma de `subscription.items.price.unit_amount` * `quantity` para todas las subs activas, normalizado a mensual.
- `churnRate`: `cancelledSubs / (activeSubs del mes anterior) * 100`.
- `evolution12Months`: agregar mes a mes desde Stripe. Ideal almacenar snapshots mensuales en tabla local para no llamar a Stripe en cada request.
- Cachear respuesta ~30 min (Stripe rate limits + datos cambian poco intra-dia).
- Almacenar credenciales Stripe en `api_credentials` (existente, AES-256-GCM): `stripe_secret_key` (restricted, solo lectura).

## Como activar el modulo en frontend cuando backend este listo

```diff
// frontend/src/modules/ia-dashboard/api/stripe.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

## Que proyectos tienen este dashboard

Solo los proyectos con `type = 'ia'`:
- Psicologo IA (id 4)
- Nutricionista IA (id 5)
- Tarot IA (id 6)

Si seleccionas un proyecto CRM (Psiko Aprende, ISEIH, Fono Aprende), la pagina muestra empty state explicando que el modulo solo aplica a proyectos IA.

## Pendientes que dependen de este modulo

- **CRM-113** Reportes IA markdown — incluye seccion "Negocio IA" con MRR/churn en el reporte mensual.
