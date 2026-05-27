---
name: Pendientes post-BETA 2026-04-25
description: Items conocidos no bloqueantes despues de subir 5 features grandes + webhooks Make-style. No urgente, retomar en proxima sesion
type: project
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
Estado al cierre de sesion 2026-04-25 (commit 2e936e7). Las 5 features grandes (matriculas, email-sequences, forms, payroll, woocommerce) estan en BETA staging. Lo de abajo NO bloquea uso real, son refinamientos pendientes.

## Pendientes funcionales

### Forms (CRM-175)
- **Iframe page**: la ruta `/embed/form/:embedId` no existe, los iframes que se generan no cargan. El endpoint API publico SI funciona, los users pueden integrar con JS propio.
- **Embed.js con Shadow DOM**: el script `<script src=".../embed/form.js">` que se ofrece en el dialog tampoco existe. Decision pendiente: hacerlo o quitar la opcion del dialog.

### Email seguimiento (CRM-185)
- **UI para template_id de Brevo**: el step actualmente acepta solo `subject` + `body` HTML inline. Falta selector que liste templates de Brevo y use `templateId` en lugar de raw HTML.
- **Triggers automaticos**: ahora solo el trigger `manual` funciona end-to-end. Los triggers `lead_created`, `status_changed`, `conversion_created` necesitan que se llame `model.startRun(seqId, leadId)` desde los services correspondientes (lead.service createLeadWithRoundRobin, etc).

### Payroll (CRM-171/173/174)
- **Upload de comprobantes para adjustments** (CRM-174): la columna `doc_url/doc_key` esta en payroll_adjustments pero falta endpoint POST y UI de upload.
- **Comprobantes polimorficos**: comprobante adjunto a commission, period o adjustment (ahora solo adjustment).

### Matriculas (CRM-176)
- **Firma canvas**: ahora la firma se sube como imagen normal. Falta canvas HTML5 para que el solicitante firme en el navegador y se convierta a PNG en el frontend antes de enviar.

### WooCommerce (CRM-177)
- **UI visual de mapeo**: tabla `wc_field_mappings` y endpoints CRUD ya existen. Falta UI tipo Make para mapear `meta_data` keys de WC -> campos CRM (similar a la del listen-mode de webhooks).
- **Categorias**: WC trae `categories[].name`, ahora solo se guarda en `wc_meta`. Falta crear/asociar a `product_categories` respetando los 5 niveles de CRM-195.
- **Variaciones**: WC tiene `variations`, ahora solo se guarda el array de IDs en meta. Falta resolver y guardar como JSONB `products.variations`.

## Pendientes infra/UX

### HTTPS en staging
URL actual `http://187.124.128.126/testeo_crm/` o por dominio `crm-test.iseie.com` sin SSL. Esto rompe `navigator.clipboard.writeText()` (botones Copy fallan en silencio). Workaround: `document.execCommand('copy')` fallback. Mejor: configurar Let's Encrypt en el dominio.

### Deploy automation
Cada deploy es manual (vite build + scp + ssh + tar -xzf). Considerar:
- Script `scripts/deploy-staging.sh` que haga todo
- O github actions cuando el repo pase a publico
- Recordatorio: build SIEMPRE con `MSYS_NO_PATHCONV=1` desde Git Bash en Windows; frontend va a `/var/www/crm/staging/frontend/`

## Why
Cierre de sesion 2026-04-25 con 5 features grandes desplegadas. Estos items se identificaron como gaps conocidos pero NO bloquean uso real del CRM por el equipo de Psiko/ISEIH. Se anotan para no perderlos en el reset de contexto.

## How to apply
Cuando el usuario diga "sigamos con X" o "que falta", consultar este doc primero. Priorizar segun lo que pida (probablemente forms iframe, triggers automaticos de email, o UI mapeo WC).
