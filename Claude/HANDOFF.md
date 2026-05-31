# HANDOFF — CRM-ISEIE

> **Para cualquier IA o dev que entra a este repo por primera vez.**
> Leé esto completo antes de tocar nada.

Última actualización: 2026-05-29

---

## 1. Identidad

| | |
|---|---|
| Nombre | CRM-ISEIE (single-project, solo ISEIE) |
| Repo | `esos2dev-oss/CRM-ISEIE` (privado) |
| Stack | Node.js 24 + Express + PostgreSQL 17 + React 18 + Vite + Tailwind |
| Producción | `https://crm.iseie.com` |
| Hermano (más grande, multi-proyecto) | `esos2dev-oss/CRM` en `360crm.tech` |

ISEIE = "Instituto Superior de Estudios e Investigación Empresarial". El CRM es para gestionar leads y matrículas de los cursos/másters/diplomados que ISEIE vende vía `iseie.com` (WordPress).

---

## 2. Infraestructura

| | Valor |
|---|---|
| VPS | `72.60.90.135` (Hostinger KVM) — root pass `<<VPS_ROOT_PASS>>` |
| OS | Ubuntu (en este VPS también viven otros 7 sitios, ej. psicologo-ia, prerender-opynio) |
| Node | en path PM2 `/usr/bin/node` (no es nvm como en el otro VPS) |
| PM2 | `crm-iseie-api` puerto `:3005` |
| Backend | `/opt/crm-iseie/` |
| Frontend | `/var/www/crm-iseie/` (Nginx) |
| DB | `crm_iseie` · owner `crm_iseie_user` |
| Dominio | `https://crm.iseie.com` con HTTPS Let's Encrypt |

### Conexión

```bash
ssh root@72.60.90.135
# Pass: <<VPS_ROOT_PASS>>

# Helper local para automatizar:
python c:/tmp/iseie_ssh.py run "comando"
```

El helper `c:/tmp/iseie_ssh.py` usa paramiko (no sshpass) con keep-alive activo.

### DB tunnel

```bash
ssh -L 5433:localhost:5432 root@72.60.90.135
# pgAdmin → 127.0.0.1:5433 · user crm_iseie_user · pass en /opt/crm-iseie/.env
```

---

## 3. Credenciales

```
═══════════════════════════════════════════════════════════════
CREDENCIALES — Valores reales en 1Password
═══════════════════════════════════════════════════════════════

── VPS 72.60.90.135 ──
root pass:        <<VPS_ROOT_PASS>>

── PostgreSQL ──
DB:               crm_iseie
user:             crm_iseie_user
pass:             ver /opt/crm-iseie/.env (DATABASE_URL)

── GitHub ──
repo:             esos2dev-oss/CRM-ISEIE (privado)
PAT:              <<GITHUB_PAT>> (en 1Password)

── Servicios externos (en /opt/crm-iseie/.env) ──
- DATABASE_URL
- JWT_SECRET, JWT_REFRESH_SECRET, ENCRYPTION_KEY
- ANTHROPIC_API_KEY (no usado activamente)
- BREVO_API_KEY (opcional)
- (Stripe, R2 → no configurados para ISEIE — usa localStorage para uploads)

── ISEIE WordPress (iseie.com) ──
Strategy:         wp_pages (las páginas son los productos)
Parent IDs:       3248, 3327, 4651, 5762, 6812, 26212
                  (Cursos / Diplomados / Másters / etc.)
URL:              https://iseie.com/
WP user/pass:     NO configurados (scraper usa REST público)
═══════════════════════════════════════════════════════════════
```

---

## 4. Diferencias con CRM hermano

ISEIE es la versión SIMPLE del CRM hermano. Lo que NO tiene:

| Feature | Hermano (ISEIH) | ISEIE |
|---|---|---|
| `lead.model.mergeLeads` | ✅ implementado | ⚠️ STUB (no merge complejo) |
| `lead.model.findProjectUserByName` | ✅ | ⚠️ STUB |
| `lead.model.getPaymentOwnership` | ✅ | ⚠️ STUB |
| Módulos `campaigns`, `ai-chat`, `reports-ia`, `audiences`, `commissions`, `payroll` | ✅ | ❌ no portados |
| `ProjectSettingsDialog` (10 tabs) | ✅ | ❌ stub mínimo |
| Accounting split (Ingresos/CxC/CxP) | ✅ | ❌ un solo `/sales` |
| Sidebar override labels via DB | ✅ | ❌ |
| PWA + Service Worker activo | ✅ | ❌ (selfDestroying en ISEIH) |
| Multi-proyecto (project_id por entidad) | ✅ | ⚠️ existe pero solo project_id=10 (ISEIE) |

### Lo que ISEIE tiene y el hermano no (o distinto)

- **Importer `wp_pages`** — las páginas WP son productos (ISEIE no usa WooCommerce)
- **Scraper que extrae** stripe_link, brochure_url, OG image, precio formato europeo
- **Beta gate** sidebar (`betaConfig.ts`) marca items no operativos como "Próximamente"
- **CETLAT custom fields** en `project_field_definitions` para registrar manualmente solicitudes de beca

---

## 5. Estructura repo

```
/
├── backend/
│   ├── src/
│   │   ├── modules/      # auth, leads, products, conversions, woocommerce, make, etc.
│   │   ├── shared/       # config (db.js con setTypeParser), middleware, services, utils
│   │   └── app.js
│   ├── migrations/       # 001 → 065 (última: 065_products_brochure_url.sql)
│   └── scripts/          # ⭐ Scripts ad-hoc (imports, fixes, QA)
│
├── frontend/
│   ├── src/
│   │   ├── modules/      # leads, clients, products, woocommerce, make, forms, etc.
│   │   ├── shared/
│   │   │   └── config/betaConfig.ts  # ⭐ allowlist beta routes
│   │   └── App.jsx
│   ├── .env.production   # VITE_API_URL + VITE_BETA_MODE=true
│   └── .env.production.example
│
└── Claude/               # 👉 ESTA CARPETA — handoff
```

---

## 6. Scripts del repo (en `backend/scripts/`)

| Script | Qué hace | Cuándo usarlo |
|---|---|---|
| `import_cetlat.js` | Importa solicitudes de beca CETLAT desde CSV → leads con custom_fields | Cuando llegue un nuevo CSV CETLAT |
| `import_contactos.js` | Importa Contactos ISEIE 2026 CSV (dedupe email+phone, multi-curso) | Para cargar Excel masivo de contactos |
| `link_products.js` | Re-vincula `producto_interes_id` con matcher fuzzy (unaccent + tokens 70%) | Cuando hay leads sin producto pero con nombre en custom_fields |
| `fill_prices.js` | Re-scrapea solo precios desde URLs de productos | Cuando WP actualiza precios y querés sync rápido |
| `fix_fechas.js` | Re-parsea `fecha_solicitud` con formato DD/MM/AAAA | Si hubo import con fechas mal parseadas (MM/DD bug JS) |
| `populate_history.js` | Crea `lead_interactions` cronológicas por cada fila del CSV original | Para construir timeline de leads importados |
| `fix_telefonos_iseie.py` | Normaliza teléfonos desde xlsx oficial (col B preferida, formato E.164) | Cuando subís actualización del Excel de contactos |
| `qa_iseie.mjs` | Suite E2E de 54 tests (lead CRUD, conversions, filtros, soft-delete, etc.) | Antes de cada deploy / verificar regresiones |

### Cómo correr un script

```bash
# Frontend (Python)
python c:/tmp/iseie_ssh.py run "node /opt/crm-iseie/import_xxx.js /tmp/data.csv --dry-run"

# Directo en server
ssh root@72.60.90.135
cd /opt/crm-iseie && node import_xxx.js
```

---

## 7. Convenciones (mismas que hermano)

- ES modules, async/await, queries pg crudas, Zod validation
- Commits en español: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Branch única `main` (push directo permitido — no hay staging separado)
- Frontend: Tailwind + shadcn/ui + React Context

---

## 8. Deploy a producción

**Backend:**
```bash
python c:/tmp/iseie_ssh.py run "cd /opt/crm-iseie && git pull origin main && pm2 reload crm-iseie-api"
# Si no hay git remoto:
python -c "
import sys; sys.path.insert(0,'c:/tmp')
from iseie_ssh import put, run
put(['backend/src/modules/X/Y.js'], '/opt/crm-iseie/src/modules/X')
run('pm2 reload crm-iseie-api')
"
```

**Frontend:**
```bash
cd frontend && npm run build
tar -czf /tmp/iseie_dist.tgz -C dist .
cp /tmp/iseie_dist.tgz c:/tmp/iseie_dist.tgz
python c:/tmp/iseie_ssh.py run "mkdir -p /var/www/crm-iseie.new && rm -rf /var/www/crm-iseie.new/* && \
  tar -xzf /tmp/iseie_dist.tgz -C /var/www/crm-iseie.new && \
  rm -rf /var/www/crm-iseie.old; mv /var/www/crm-iseie /var/www/crm-iseie.old && \
  mv /var/www/crm-iseie.new /var/www/crm-iseie"
```

**Migration:**
```bash
python c:/tmp/iseie_ssh.py run "sudo -u postgres psql -d crm_iseie -f /opt/crm-iseie/migrations/0NN_xxx.sql"
```

---

## 9. Pitfalls conocidos

1. **`canal_detectado` enum** incluye `whatsapp` solo en ISEIE prod (verificar con `SELECT enum_range(NULL::utm_channel)`)
2. **Excel guarda teléfonos como número** → `.0` decimal. El xlsx normalizado de ISEIE tiene `Teléfono` (col A) y `N° de teléfono` (col B). **Col B = formato E.164 sin 1/9 mobile**.
3. **México** `+521XXXX` (con 1) = WhatsApp mobile, `+52XXXX` (sin 1) = E.164 estándar. Owner pidió guardar SIN el 1 (col B).
4. **Argentina** `+549XXXX` (con 9) = WhatsApp mobile, `+54XXXX` (sin 9) = E.164. Owner pidió sin 9.
5. **`scraper.meta_box.precio`** devuelve objeto `{text, value, unit, type}`. Usar `.value` (number) NO `.text` (string) en el mapping. `sanitizePrecio()` en `wc.model.js` es defensa por si quedó mal.
6. **`parsePriceNumber`** en `html-scraper.js` maneja formato europeo: `1,985 €` = 1985 (coma=miles si 3 dígitos después), `5,50` = 5.5 (coma=decimal si 2 dígitos).
7. **Beta gate**: items en sidebar marcados "Próximamente" están atenuados, no clicables. Activar agregando ruta a `BETA_ROUTES` en `betaConfig.ts`.
8. **Round-robin**: solo asigna a gestor (no admin), mismo fix que hermano.
9. **Fechas formato DD/MM**: NO usar `new Date("13/05/2026")` directo — JS lo parsea como MM/DD (US) y falla. Usar `parseDate()` de los scripts (`fix_fechas.js` tiene la lógica correcta).
10. **fail2ban en VPS** puede banear IP por SSH fallidos repetidos. Si te cierra, esperar ~10min o cambiar de IP (VPN).

---

## 10. Trabajo reciente

Ver:
- [CHANGELOG.md](./CHANGELOG.md) — log cronológico de commits
- [CURRENT-STATE.md](./CURRENT-STATE.md) — snapshot operativo + cifras

---

## 11. Cómo verificar que todo OK

```bash
# Health
curl -sI https://crm.iseie.com/api/health

# Bundle live
curl -s https://crm.iseie.com/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | head -1

# PM2 status
python c:/tmp/iseie_ssh.py run "pm2 list | grep iseie"

# Logs últimos errores
python c:/tmp/iseie_ssh.py run "pm2 logs crm-iseie-api --lines 50 --nostream --raw | grep -iE 'error|fatal|invalid' | tail -10"

# Run QA suite
python c:/tmp/iseie_ssh.py run "cd /opt/crm-iseie && node qa_iseie.mjs"
```

---

## 12. Por dónde seguir

- **[MODULES.md](./MODULES.md)** — tabla de módulos
- **[CURRENT-STATE.md](./CURRENT-STATE.md)** — snapshot operativo
- **[CHANGELOG.md](./CHANGELOG.md)** — log commits
- **[README.md](./README.md)** — índice de archivos
- **[project_pending_iseie_beta_gate.md](./project_pending_iseie_beta_gate.md)** — beta gate (HECHO)
- **[project_pending_diplomados_recibos.md](./project_pending_diplomados_recibos.md)** — certificados PDF pendiente
