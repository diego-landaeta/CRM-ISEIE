---
name: Sesion 2026-04-25
description: 5 features grandes desplegadas + bugfixes deploy paths + webhooks tokens + WC auto-sync
type: project
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
## Lo que entró en BETA hoy

**5 features (CRM-176/185/175/171/177) MVP completas y desplegadas:**

- **Matriculas** (`/matriculas`): CRUD + uploads DNI/titulo/firma + estados solicitud_admision/datos_validados/pendiente/validada/rechazada + tab "Webhooks de admision" con tokens para recibir solicitudes desde forms externos. Dedupe automatico por DNI o email.
- **Email seguimiento** (`/email-sequences`): CRUD + scheduler in-process cada 2 min que envia via Brevo. Falta UI para asociar Brevo template_id.
- **Forms** (`/forms`): TAB "Forms" (UI embed) y TAB "Webhooks" (API entrada con field_mapping JSON dot-notation). El webhook crea lead via round-robin. Falta servir embed JS.
- **Nominas** (`/payroll`): Plans (fijo + horas + comisiones), work_hours, periods (calc + cerrar + pagar), adjustments. Falta upload de comprobantes para adjustments (CRM-174).
- **WooCommerce** (`/woocommerce`): config credentials + auto_sync_enabled + sync_interval_minutes + scheduler in-process cada 5 min. Skip optimization si el count de productos en WC no cambia.

## Modulo nuevo: webhook-tokens

Tabla `project_webhook_tokens(project_id, kind, token, field_mapping JSONB, active, uses_count, last_used_at)`. Endpoint publico `POST /api/webhook-tokens/receive/:token` que aplica field_mapping y crea matricula o lead segun `kind`. Tokens administrables desde la UI de matriculas (tab Webhooks de admision).

## Bugs criticos resueltos

- **Pipeline roto**: el cambio anterior `WHERE l.status <> 'convertido'` rompio /leads/pipeline porque pipeline necesita ver TODAS las columnas. Añadido query param `includeConverted=1`. Pipeline lo pasa, listado de Leads sigue excluyendolos por defecto (van a Clientes).
- **Permission denied en 5 tablas nuevas**: las migraciones se aplicaron como user `postgres` y crearon tablas con owner postgres. La API conecta como `crm_user`. Fix: `ALTER TABLE ... OWNER TO crm_user` para todas + sequences.
- **Deploy a directorio fantasma**: durante toda la sesion deployé frontend a `/var/www/testeo_crm/` cuando nginx sirve desde `/var/www/crm/staging/frontend/`. Anotado en `reference_deploy_paths.md`.
- **Vite base path mangled por Git Bash**: `--base=/testeo_crm/` se convertia a `/Program Files/Git/testeo_crm/` por MSYS path conversion. Fix: `MSYS_NO_PATHCONV=1 npx vite build`.

## Decisiones tecnicas

- Webhook tokens vs forms.kind=webhook: AMBOS conviven. Forms tiene su propio webhook (`/api/forms/webhook/:embed_id`) ligado a un form. webhook-tokens es generico para cualquier kind (matriculas, leads). Razones: matriculas no necesita un "form" y los tokens permiten multiples webhooks por proyecto sin crear un form fake.
- Estados matriculas extendidos: `solicitud_admision` (recibida via webhook, falta validacion) -> `datos_validados` (gestor reviso) -> `pendiente` (matricula confirmada esperando docs) -> `validada` o `rechazada`. Esto cubre el caso "casi matriculado" que pidio el usuario.
- WC sync optimizacion: usar `last_wc_count` para skip si el numero de productos no cambia entre ticks. Ahorra recursos cuando la tienda esta estable.

## How to apply

Cuando el usuario diga que algo "no se ve" en staging, verificar:
1. `cat /etc/nginx/sites-enabled/*` para confirmar el alias actual
2. `grep -oE 'index-[^\"]+' /var/www/crm/staging/frontend/index.html` para ver el bundle hash
3. Si el bundle es nuevo y aun no aparece, es cache. Si el path en index.html tiene `/Program Files/`, rebuild con `MSYS_NO_PATHCONV=1`.

Cuando se cree una migracion nueva con tabla, verificar owner: `SELECT tableowner FROM pg_tables WHERE tablename = 'X'`. Si dice `postgres`, ejecutar `ALTER TABLE X OWNER TO crm_user; ALTER SEQUENCE X_id_seq OWNER TO crm_user;`.
