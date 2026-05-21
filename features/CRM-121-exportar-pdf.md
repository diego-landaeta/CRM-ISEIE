# CRM-121 · Frontend boton Exportar PDF

## Estado

- **Frontend:** completado (Angel) — integrado en `ReportsIAPage`
- **Backend:** pendiente (Diego) — endpoint `POST /api/reports/:id/export-pdf`

USE_MOCKS=true en [`reports-ia.api.js`](../../frontend/src/modules/reports-ia/api/reports-ia.api.js).

## Lo que entrega el frontend

- Boton "Exportar PDF" (icono `FilePdf`) en el header del visor de reporte
- **Loading state** durante generacion (spinner + texto "Generando…")
- Descarga automatica al completar
- Filename: `reporte_<projectslug>_<YYYY-MM>.pdf`
- Toast de exito con periodo del reporte

## Contrato del endpoint

### `POST /api/reports/:id/export-pdf`

Roles: SA, A. Devuelve `application/pdf` blob.

**Notas backend:**
- Convertir el markdown del reporte a PDF (Puppeteer headless o wkhtmltopdf).
- Aplicar branding del proyecto (logo + colores) al PDF.
- Cachear el PDF en Cloudflare R2 una vez generado: `pdf_url` + `pdf_generated_at` en la tabla `reports`. Si ya existe, devolver el cached.
- Si el reporte se regenera, invalidar el PDF cacheado.

## Como activar cuando Diego termine

```diff
// frontend/src/modules/reports-ia/api/reports-ia.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

(Mismo flag que CRM-113 — comparten api file).
