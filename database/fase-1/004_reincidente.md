# Migracion 004 - Campo reincidente

> **Archivo fuente:** `backend/migrations/004_reincidente.sql`
> **Story:** Sprint 1 Camino B - alinear con PDF spec

## Resumen

Agrega columna `reincidente` a la tabla `leads`. Un lead se marca como reincidente cuando:
- Ya existe otro lead con el mismo email
- En el mismo proyecto
- Con el mismo producto de interes

Esto indica prioridad alta porque el cliente volvio a preguntar por lo mismo (posiblemente cambio de opinion o tiene dudas).

## SQL ejecutado

```sql
BEGIN;

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS reincidente BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_leads_reincidente
  ON leads (project_id, reincidente)
  WHERE reincidente = true;

COMMIT;
```

## Ejecuciones

- **crm_test_db (staging):** 2026-04-21 OK
- **crm_db (produccion):** 2026-04-21 OK

## Logica aplicada en backend

En `lead.service.js` > `processWebhook`:

```js
const duplicate = await leadModel.findDuplicateByEmail(email, projectId);
const duplicadoDe = duplicate ? duplicate.id : null;

const reincidente = !!(
  duplicate &&
  productoInteresId &&
  duplicate.producto_interes_id === productoInteresId
);
```

## Impacto en API response del webhook

Ahora devuelve:
```json
{
  "lead_id": 123,
  "responsable_id": 2,
  "duplicado": true,
  "duplicado_de": 87,
  "reincidente": true,       // NUEVO
  "canal": "meta_ads"
}
```

## Frontend

Badge "Reincidente" rojo en LeadsPage junto al nombre cuando `lead.reincidente === true`.
