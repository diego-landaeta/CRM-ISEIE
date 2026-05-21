# CRM-110 · Frontend Wizard creacion audiencia

## ⚠️ PENDIENTE DE REDISENO (feedback usuario 2026-04-25)

> "El wizard no me convenció" — implementacion actual queda en VEREMOS.

Posibles direcciones a explorar:
- Pantalla unica con filtros izquierda + preview derecha (mas tipo Figma/Mailchimp segments)
- Sin stepper: filtros, preview y descarga en la misma vista, scroll vertical
- Modal en lugar de pagina completa
- Mantener stepper pero rediseno visual menos "asistente Windows"

Decision pospuesta hasta nueva sesion de UX. Por ahora el wizard funciona pero NO es la version final.

---

## Estado

- **Frontend:** ⚠️ implementado pero **no aprobado** (Angel) — `frontend/src/modules/leads/pages/AudienceExportPage.jsx` reescrito como wizard
- **Backend:** parcial (Diego) — `/api/audiences/export` documentado; `/api/audiences/preview` debe anadirse

El frontend trabaja con **mocks toggleables**. Cuando el backend este listo, basta con
cambiar `USE_MOCKS = false` en [`frontend/src/modules/leads/api/audiences.api.js`](../../frontend/src/modules/leads/api/audiences.api.js).

## Lo que entrega el frontend

- **Ruta:** `/crm/leads/audiences` (existente, reescrita)
- **Wizard 3 pasos** con stepper visual (clickable hacia atras, no hacia delante sin completar)
- **Step 1 — Filtros:**
  - Estado del lead (multiselect chips, 6 opciones)
  - Canal de origen (multiselect chips, 6 opciones)
  - Fecha desde / hasta
  - Producto de interes (select)
  - Importe minimo de conversion (input EUR)
  - **Preview en tiempo real:** contador de coincidencias debajo, debounced 250ms, warning visual si <20 leads
  - Boton "Reset" para limpiar filtros
- **Step 2 — Preview:**
  - Headline con tamano de audiencia (tipografia grande)
  - Badge "Audiencia valida para Meta" (verde) o "Minimo 20 leads requerido" (ambar)
  - 2 charts breakdown: por estado y por canal (barras horizontales con %)
  - Tabla muestra de los primeros 10 leads (escritorio + mobile cards)
  - Aclaracion: "El CSV final incluira los X leads completos con email/telefono hasheados SHA256"
- **Step 3 — Descarga:**
  - Resumen visual (icono + tamano + nombre archivo autogenerado)
  - Nombre del CSV: `audiencia_<projectslug>_<YYYY-MM-DD>.csv`
  - Si <20 leads: mensaje de error invitando volver al paso 1
  - Boton "Descargar CSV" deshabilitado si no se cumple el minimo
  - Bloque de privacidad: SHA-256, Meta + Google compatible, GDPR friendly

## Comportamiento

- Cambio de proyecto resetea el wizard.
- Preview se recalcula automaticamente al cambiar cualquier filtro (debounce).
- Stepper permite saltar a pasos anteriores haciendo click.
- Boton final "Descargar CSV" genera blob con `audiences.api.js#exportAudienceCsv` y dispara descarga del navegador.

## Contratos de los endpoints

### `POST /api/audiences/preview` (NUEVO — anadir al spec)

Necesario para que el wizard muestre conteo + breakdown sin descargar el CSV completo.

| Campo | Valor |
|-------|-------|
| Auth | Bearer token |
| Roles | superadmin, admin |

**Request body:**

```jsonc
{
  "projectId": 1,
  "filters": {
    "statuses": ["convertido", "en_seguimiento"],
    "canales": ["meta_ads", "google_ads"],
    "fechaDesde": "2026-01-01",
    "fechaHasta": "2026-04-25",
    "productoId": 12,
    "importeMinimo": 500
  }
}
```

**Response 200:**

```jsonc
{
  "success": true,
  "data": {
    "totalCount": 87,
    "breakdown": {
      "status": { "convertido": 17, "en_seguimiento": 13, ... },
      "canal":  { "meta_ads": 28, "google_ads": 21, ... }
    },
    "sample": [
      { "id": 1, "nombre": "Maria Lopez", "email": "...", "telefono": "...", "estado": "convertido", "canal": "meta_ads", "fecha_solicitud": "..." }
      // primeros 10 leads (NO hasheado, solo para preview)
    ]
  }
}
```

### `POST /api/audiences/export` (existente)

Devuelve un `text/csv` blob con email_hash, phone_hash, first_name, last_name.
- Hashes en SHA-256 lower-case (Meta requirement).
- 1 fila por lead que cumple `filters`.
- Sin paginacion (descarga completa).

## Como activar el modulo en frontend cuando backend este listo

```diff
// frontend/src/modules/leads/api/audiences.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

## Dependencias

- **CRM-115** Boton "Subir a Meta" en wizard → se anadira en step 3 como segundo CTA junto a "Descargar CSV". Requiere backend `/api/audiences/upload-meta` (Fase 3).
- Min audiencia 20 leads = limite duro Meta Custom Audiences. Hardcodeado en `MIN_AUDIENCE_SIZE` del hook.
