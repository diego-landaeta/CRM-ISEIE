# Estado del proyecto CRM-ISEIE

> **Documento único de estado.** Reemplaza a `BACKEND-PENDIENTE.md`,
> `PLAN-TRABAJO.md`, `REVISAR.md` y similares que ahora viven en
> `_historico/`. Aquí se mantiene la verdad actual del proyecto: fase, qué
> funciona, qué falta, y cómo arrancar.

Última actualización: **2026-05-22**.

---

## 1. Fase actual

**Fase 6 — Productivo en `https://crm.iseie.com`** (deploy desde 2026-05-22).

Las fases heredadas del Claude anterior (`_historico/fase-1/2/3`) eran un
roadmap teórico; la implementación real se hizo en una secuencia distinta:

| Fase real | Estado |
|---|---|
| **Schema DB** (paridad con CRM hermano excepto IA) | ✅ 100% — 58 tablas, 24 migraciones individuales + 17 consolidadas en 001/002/003 |
| **Backend módulos core** (auth, users, projects, leads, products, conversions, commissions, expenses, status) | ✅ 100% |
| **Backend módulos extra** (permissions, forms, webhook-tokens, email-*, matriculas, payroll, accounts-payable, documents, make, woocommerce, connectors, project-channels, installation, credentials, accounting, product-categories, field-definitions) | ✅ 100% — todos registrados |
| **Frontend páginas core** | ✅ 48/50 portadas (96%) |
| **Multi-país** (11 países como `projects`) | ✅ seedeado |
| **Branding ISEIE** (logo, banderas, navy + verde forest) | ✅ |
| **Mobile responsive** (drawer animado, tablas → cards) | ✅ |
| **Páginas cableadas a datos reales** | 🟡 ~40% (Dashboard, Sales, Activity, Notifications, Accounting/* cableadas; resto stub) |
| **Cron jobs operacionales** | 🔴 1/5 (`emailSequenceScheduler` portado; faltan 4) |
| **Módulos backend `dossiers` y `reports`** | 🔴 no portados |
| **Integraciones reales (Brevo, R2, Stripe, Meta Ads, Google APIs)** | 🔴 0% — credenciales sin configurar |
| **Verificación E2E manual** | 🟡 pendiente |

---

## 2. Stack y comandos rápidos

| | |
|---|---|
| Producción | `https://crm.iseie.com` (VPS 72.60.90.135) |
| Backend | Node 20 + Express + pg + Zod + bcrypt + JWT |
| Frontend | React 18 + Vite + Tailwind + shadcn/ui |
| DB | PostgreSQL 14 — `crm_iseie` |
| Process manager | PM2 — `crm-iseie-api` (fork mode, puerto 3005) |
| Reverse proxy | nginx `/etc/nginx/sites-enabled/crm.iseie.com` |
| SSL | Let's Encrypt (renovación auto via `certbot.timer`) |

**Arrancar local** (asume PostgreSQL local o túnel SSH al VPS):

```powershell
cd backend && npm install && npm run dev    # puerto 3005
cd frontend && npm install && npm run dev   # puerto 5173
```

**Redeploy backend a producción**:

```bash
cd backend && tar --exclude='node_modules' --exclude='.env' --exclude='logs' -czf /tmp/be.tar.gz .
scp /tmp/be.tar.gz root@72.60.90.135:/tmp/
ssh root@72.60.90.135 'cd /opt/crm-iseie && tar -xzf /tmp/be.tar.gz && npm install --omit=dev && pm2 restart crm-iseie-api --update-env'
```

**Redeploy frontend**:

```bash
cd frontend && npm run build
tar -czf /tmp/fe.tar.gz -C dist .
scp /tmp/fe.tar.gz root@72.60.90.135:/tmp/
ssh root@72.60.90.135 'rm -rf /var/www/crm-iseie/* && cd /var/www/crm-iseie && tar -xzf /tmp/fe.tar.gz && chown -R www-data:www-data .'
```

---

## 3. Documentos canónicos vivos

| Archivo | Para qué |
|---|---|
| `README.md` | Overview público corto |
| `CLAUDE.md` | Instrucciones para futuras sesiones Claude Code |
| `ESTADO.md` (este) | Estado actual del proyecto |
| `DIFERENCIAS-CRM-HERMANO.md` | Toda divergencia consciente vs CRM hermano (paridad estricta) |
| `vps-72.60.90.135-handoff.md` | Layout VPS, reglas mantenimiento, PIDs ajenos a no tocar |
| `docs/` | Guías técnicas activas (esquema, setup local, API, deploy) |

**Archivado en `_historico/`** (referencia, no es estado actual):

- `_historico/documentacion/` — 29 docs de planificación original (Mermaid, ER, flujos)
- `_historico/fase-1/` — análisis CRM viejo + UI/UX guide + setup servidor
- `_historico/fase-2/` — integraciones API previstas
- `_historico/fase-3/` — funcionalidades avanzadas
- `_historico/database/` — schemas SQL históricos
- `_historico/bugs/`, `_historico/features/` — historial Claude anterior
- `_historico/BACKEND-PENDIENTE.md`, `PLAN-TRABAJO.md`, `REVISAR.md`,
  `MANUAL-USUARIO.md`, `PROMPT-INICIO.md` — docs del CRM hermano que sirvieron
  de referencia pero ya no reflejan el estado real

---

## 4. Pendientes ordenados por impacto

### 🔥 Críticos (sistema produce datos vacíos o falla en producción)

| # | Pendiente | Esfuerzo |
|---|---|---|
| 1 | Portar 4 cron jobs (`documentOrphanScheduler`, `googleAdsTokenScheduler`, `reminderScheduler`, `wooCommerceSyncScheduler`) | 2-3 h |
| 2 | Portar módulo backend `dossiers` (tabla ya existe en 001) | 4-6 h |
| 3 | Portar módulo backend `reports` (analytics/BI standard) | 4-6 h |
| 4 | Cablear páginas placeholder a datos reales: AccountingDashboard, LeadsPage stats, ProductsPage, CommissionsPage | 3-4 h |
| 5 | `.env.example` añadir: `ENCRYPTION_KEY`, `JWT_REFRESH_SECRET`, `GOOGLE_OAUTH_*` | 5 min |

### 🟡 Importantes (degradan UX o bloquean features)

| # | Pendiente | Esfuerzo |
|---|---|---|
| 6 | Cablear Settings → Integraciones a `/api/credentials` (formulario por servicio) | 2 h |
| 7 | Cablear ReportsPage hero al `dashboard-summary` | 30 min |
| 8 | Portar shared UI faltantes: PWA prompts, OfflineBanner, ShortcutsFAB, CommandPalette | 2 h |
| 9 | LeadDrawer.tsx:147 error TS preexistente | 15 min |

### 🟢 Operacional (configuración de tu lado)

| # | Pendiente | Quién |
|---|---|---|
| 10 | Configurar Brevo API key | usuario |
| 11 | Configurar R2 (Cloudflare access_key + secret + bucket) | usuario |
| 12 | Configurar Stripe (suscripciones, webhooks) si aplica | usuario |
| 13 | Configurar Meta Ads + Google Ads (OAuth, tokens) si aplica | usuario |
| 14 | Verificación E2E manual: abrir cada página, hacer CRUD básico, reportar bugs | usuario |

---

## 5. Reglas firmes (no negociables)

- **Schema con paridad estricta al CRM hermano**, excepto los 6 elementos
  documentados en `DIFERENCIAS-CRM-HERMANO.md` (IA + multi-país).
- **NUNCA `pm2 restart all`** ni `pm2 delete all` — mataría las 3 apps ajenas
  del VPS (`prerender-opynio` PID 974, `psicologo-ia-pro` PID 981,
  `veterinary-ai` PID 975).
- **NUNCA modificar configs nginx ajenas** — sólo `/etc/nginx/sites-available/crm.iseie.com`.
- **OPSEC**: secretos (DB pass, JWT, API keys) viven sólo en `.env`, archivos
  `_historico/fase-1/CREDENCIALES-PRIVADO.md` (gitignored) o env vars en VPS.
  Nunca en chat, commits, ni logs.
- **Commits sólo cuando el usuario lo pida.** Sin PRs (flujo directo a `main`).

---

## 6. Memoria persistente

En `~/.claude/projects/c--Users-nange-Documents-Proyectos-T-CRM-ISEIE/memory/`:

- `MEMORY.md` — índice
- `project_vps_postgres_coexistence.md` — historia del rename `crm_iseie` académico → nuestro
- `project_vps_deployment.md` — layout productivo + reglas mantenimiento
- `feedback_schema_parity.md` — regla de paridad estricta

---

**Cualquier futura sesión Claude Code debe leer este archivo primero**, luego
`CLAUDE.md`, luego `DIFERENCIAS-CRM-HERMANO.md`. El resto es histórico.
