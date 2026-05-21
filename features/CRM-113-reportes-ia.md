# CRM-113 · Frontend visualizador reportes IA markdown + historial

## Estado

- **Frontend:** completado (Angel) — modulo `frontend/src/modules/reports-ia/`
- **Backend:** pendiente (Diego) — modulo `reports-ia` por crear (integracion con Claude AI)

USE_MOCKS=true en [`reports-ia.api.js`](../../frontend/src/modules/reports-ia/api/reports-ia.api.js).

## Lo que entrega el frontend

- **Nueva ruta:** `/crm/reports-ia` — sidebar "Reportes IA" (icono Sparkle, roles SA/A)
- **Layout 2 columnas** en desktop, stack en mobile:
  - Izquierda (260px): historial de reportes con scroll
  - Derecha: visor markdown del reporte seleccionado
- **Markdown rendering** con `react-markdown` + `remark-gfm` para tablas
- **Estilos markdown personalizados** en `index.css` (.markdown-body): h1-h4, listas, tablas zebra, blockquote con borde lateral, code blocks, links primary
- **Boton "Generar ahora"** (solo SA/A) en PageHeader actions
- **Loading state animado** con spinner + texto "Claude AI esta analizando los datos" durante generacion
- **Boton "Exportar PDF"** (CRM-121) integrado en el header del visor — descarga blob via endpoint
- **Auto-seleccion** del reporte mas reciente al cambiar de proyecto
- **Metadata visible**: leads analizados, conversiones, fuentes de datos

## Contrato de los endpoints

### `GET /api/reports/:projectId?periodo=YYYY-MM`

Lista reportes (sin content). Roles: SA, A, G.

### `GET /api/reports/detail/:id`

Detalle completo con `content` markdown.

### `POST /api/reports/:projectId/generate`

Body: `{ periodo?: 'YYYY-MM' }` (default mes anterior). Roles: SA, A.

Genera reporte via Claude AI:
- Tarda 10-30 seg (frontend muestra loading state)
- Contenido en markdown
- Fuentes de datos: CRM, Meta Ads, Google Ads, GSC

### `POST /api/reports/:id/export-pdf` (CRM-121)

Devuelve PDF blob. El frontend lo descarga directamente.

## Como activar cuando Diego termine

```diff
// frontend/src/modules/reports-ia/api/reports-ia.api.js
- const USE_MOCKS = true;
+ const USE_MOCKS = false;
```

## Notas backend

- El endpoint de generacion debe orquestar: pull de datos del CRM + Meta + Google + GSC del periodo, prompt template con esos datos, llamada a Claude API, persistir el markdown.
- Cachear: una vez generado un reporte de un periodo, no regenerar a menos que se fuerce.
- PDF: backend usa Puppeteer/wkhtmltopdf para convertir el markdown→HTML→PDF. Almacenar en R2 con `pdf_url`.
- Limit rate generacion: max 1 reporte / proyecto / dia para no quemar Claude API.
