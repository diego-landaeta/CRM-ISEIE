# CRM-ISEIE — Estado actual (snapshot 2026-05-27)

Documentacion completa del estado del CRM-ISEIE, repo `esos2dev-oss/CRM-ISEIE`, deployado en `https://crm.iseie.com`. Pensado para que Angel/Manuel se pongan al dia rapido.

## Infraestructura

| Componente | Ubicacion |
|---|---|
| **VPS** | `72.60.90.135` (Hostinger KVM) — root pass `<<VPS_ROOT_PASS — ver credenciales fuera de repo>>` |
| **Backend** | `/opt/crm-iseie/` — PM2 `crm-iseie-api` puerto `3005` |
| **Frontend** | `/var/www/crm-iseie/` (sirve Nginx) |
| **DB** | PostgreSQL local — `crm_iseie` · owner `crm_iseie_user` (~23 MB) · sin acceso externo |
| **Dominio** | `https://crm.iseie.com` con HTTPS Let's Encrypt |
| **GitHub** | `https://github.com/esos2dev-oss/CRM-ISEIE` (privado) |
| **Rama produccion** | `main` (push directo permitido) |

**Pgadmin/DBeaver desde local**: abrir SSH tunnel
```bash
ssh -L 5433:localhost:5432 root@72.60.90.135
# Luego conectar a localhost:5433 con crm_iseie_user
# Password en /opt/crm-iseie/.env
```

## Modulos operativos (BETA 1.0.0)

Marcados como activos en [`frontend/src/shared/config/betaConfig.ts`](../frontend/src/shared/config/betaConfig.ts):

- **Principal**: Dashboard, Prospectos, Clientes, Matriculas
- **Captacion**: Email, Formularios, Make webhooks, Webhooks entrantes
- **Catalogo**: Productos, WooCommerce (importer WP-pages), Documentos PDF
- **Analisis**: Reportes (admin) / Actividad (gestor)
- **Sistema**: Notificaciones, Mis preferencias, Status

## Modulos pendientes (mostrados como "Proximamente")

- Audiencias Meta, Campañas (Meta/Google Ads), SEO
- Cursos pendientes, Arbol de categorias
- Contabilidad split (Ingresos/Egresos/Conversiones/CxC/CxP/Comisiones/Nominas/Stripe)
- Analisis IA, Chat IA, Soporte, Manual del CRM

Para activarlos: agregar su `/ruta` al array `BETA_ROUTES` en `betaConfig.ts`.

## Integraciones armadas

### 1. WordPress importer (sin WooCommerce)

ISEIE **no usa WooCommerce** — cada "producto" es una pagina WP bajo parent IDs especificos. Solucionado con:

- `source_strategy = 'wp_pages'` (migration 064)
- `cpt_endpoints` se reusa para guardar los parent IDs (array JSONB)
- Modulo `backend/src/modules/woocommerce/wp-rest.js` → `fetchWpPagesByParents()`
- Scraper HTML extrae secciones (Plan de Estudios, Objetivos, Beneficios, etc.), `meta_box` (Precio, Horas, Duracion, Modalidad, Fecha inicio), `stripe_link`, `brochure_url`, OG image

**Credenciales actuales en produccion (panel WooCommerce):**
- URL: `https://iseie.com/`
- Strategy: `wp_pages`
- Parent IDs: `3248, 3327, 4651, 5762, 6812, 26212` (Cursos / Diplomados / Masters / etc.)
- Scraper: enabled
- Sync interval: 3600 min (1 vez al dia aprox)

### 2. Make webhook entrante

Para recibir leads desde Make.com. Modulo `backend/src/modules/make/`. Soporta:
- Body JSON con field_mapping configurable
- Headers de override: `X-Asesora-Email`, `X-Asesora-Nombre`, `X-Canal`, `X-Make-Secret`
- Modo TEST (solo guarda payload) vs ACTIVE (crea lead real)
- En el panel se ven los headers recibidos via `_received_overrides`

**Para Make**: usar header `X-Asesora-Email: fabiola@iseie.com` en lugar de meter `responsable_email` en el JSON.

### 3. WC import con progreso en vivo

`updateRunProgress()` flushea contadores cada 2s. Frontend hace polling de `/api/woocommerce/runs/current` cada 2s mientras hay un run activo. Banner azul muestra Traidos/Creados/Actualizados/Saltados en tiempo real.

## Diferencias con CRM hermano (ISEIH)

| Feature | ISEIH | ISEIE |
|---|---|---|
| `lead.model.mergeLeads` | implementado | STUB |
| `lead.model.findProjectUserByName` | implementado | STUB |
| `lead.model.getPaymentOwnership` | implementado | STUB |
| Modulos campaigns/ai-chat/reports-ia/audiences | si | no (futuro) |
| Settings tabs (10) ProjectSettingsDialog | si | no |
| Accounting separado en sub-paginas | si | un solo `/sales` |
| Modulo `payroll` | si | no |
| Modulo `commissions` (CRUD completo) | si | no |
| Sidebar override labels via DB | si | no |
| PWA + Service Worker | si | no (selfDestroying en ISEIH) |

## Migraciones recientes

| # | Descripcion |
|---|---|
| 058 | leads soft delete |
| 059 | leads propuesto state |
| 061 | lead spam reports |
| 063 | make_webhooks + make_webhook_deliveries |
| 064 | source_strategy=wp_pages |
| 065 | products.brochure_url |

## Bugs/decisiones recientes (mayo 2026)

1. **Precio no se extraia del scraper**: regex lazy de Pattern 1 (Elementor icon-box) se cortaba en `</div>` interno cuando el title era `<div>` en vez de `<h4>`. Arreglado en `html-scraper.js:extractMetaBox` usando indexacion separada de titles y descriptions.

2. **previewWc 502 Bad Gateway**: el endpoint hardcodeaba `/wp-json/wc/v3/products` que no existe en ISEIE. Agregada rama `if (source_strategy === 'wp_pages')` que fetchea de `/wp-json/wp/v2/pages?parent=...`.

3. **stripe_link y brochure_url**: extraidos del HTML por scraper. Stripe matchea `https://buy.stripe.com/...` y `checkout.stripe.com/...`. Brochure matchea `<a href="*.pdf">` con keyword brochure/folleto/dossier/temario o por extension.

4. **findProductByName**: era ILIKE puro (no tolera acentos). Ahora prueba 3 estrategias: ILIKE exacto, `unaccent()` ambos lados, ILIKE substring sin prefijo curso/master/diplomado. Requiere extension `unaccent` (creada en `crm_iseie`).

5. **Beta gate sidebar**: aplicado segun memoria del usuario. `VITE_BETA_MODE=true` en `.env.production`. Items sin backend aparecen como "Proximamente".

6. **Date timezone bug** (heredado de ISEIH): pg `setTypeParser(1082)` en `backend/src/shared/config/db.js` devuelve DATE como string YYYY-MM-DD; frontend `toLocalDate()` los parsea como local (no UTC).

## Como deployar cambios

```bash
# Local
cd "C:/Users/Diego/Desktop/Proyectos-Carlos/CRM ISEIE"
git add -A && git commit -m "..." && git push origin main

# Backend al server
python -c "
import sys; sys.path.insert(0,'c:/tmp')
from iseie_ssh import put, run
put(['backend/src/modules/<modulo>/<archivo>.js'], '/opt/crm-iseie/src/modules/<modulo>')
run('pm2 reload crm-iseie-api')
"

# Frontend
cd frontend && npm run build
tar -czf /tmp/iseie_dist.tgz -C dist .
cp /tmp/iseie_dist.tgz c:/tmp/iseie_dist.tgz
# Atomic swap
python c:/tmp/iseie_ssh.py run "mkdir -p /var/www/crm-iseie.new && rm -rf /var/www/crm-iseie.new/* && tar -xzf /tmp/iseie_dist.tgz -C /var/www/crm-iseie.new && rm -rf /var/www/crm-iseie.old && mv /var/www/crm-iseie /var/www/crm-iseie.old && mv /var/www/crm-iseie.new /var/www/crm-iseie"

# Migraciones
python c:/tmp/iseie_ssh.py run "sudo -u postgres psql -d crm_iseie -f /opt/crm-iseie/migrations/NNN_xxx.sql"
```

Helper SSH paramiko: `c:/tmp/iseie_ssh.py` (no sshpass en Windows).

## Pendientes conocidos

- Portar `commissions` y `payroll` modulos completos (backend + frontend)
- Portar `accounting` split en sub-paginas (Ingresos/CxC/CxP)
- Decidir si vale la pena portar `campaigns` (necesita OAuth Meta/Google)
- `ai-chat` y `reports-ia` requieren Anthropic API key
- Audiencias Meta requiere endpoint custom + upload CSV/Meta API

Ver tambien:
- [project_pending_iseie_beta_gate.md](./project_pending_iseie_beta_gate.md) — beta gate (HECHO)
- [project_pending_diplomados_recibos.md](./project_pending_diplomados_recibos.md) — certificados PDF con `_texto` fields
- [MEMORY.md](./MEMORY.md) — indice de toda la memoria
