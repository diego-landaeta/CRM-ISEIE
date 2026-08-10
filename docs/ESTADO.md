# Estado del proyecto CRM-ISEIE

> **Documento único de estado** del proyecto. Para detalle de endpoints ver
> `docs/03-api-endpoints.md` (auto-generado). Para manual de usuario ver
> `docs/MANUAL-USUARIO.md`.

Última actualización: **2026-05-25** (post-consolidación a proyecto único).

---

## 1. Estado actual

**Fase 6 — Productivo en `https://crm.iseie.com`** con SSL Let's Encrypt y
deploy atómico via `scripts/deploy-frontend.sh`.

| Métrica | Valor |
|---|---|
| Proyectos en DB | **1** (`iseie`, id=10) — consolidado desde 11 países |
| Paridad real vs CRM hermano (excluyendo módulos IA no aplicables) | **~96%** |
| Módulos backend operativos | 29 / 29 + 5 cron jobs |
| Endpoints API | 249 documentados en `docs/03-api-endpoints.md` |
| Páginas frontend | 40+ rutas activas |
| Tablas DB | 58 (schema intacto, paridad con hermano) |
| Tests integración (CRUD + RBAC) | **77 / 77 OK** (~32 segundos, validado post-consolidación) |
| Apps PM2 ajenas en VPS | 3 (intactas, 11 días uptime) |
| Bundle frontend | 2.3 MB sin sourcemaps (–100 KB tras purga multi-país) |

---

## 2. Arquitectura

| Capa | Tecnología | Estado |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript + Tailwind + shadcn/ui | Producción |
| Backend | Node 20 + Express + ES modules + pg + Zod + bcrypt + JWT + pino | Producción |
| DB | PostgreSQL 14 (en VPS) | `crm_iseie` |
| Process manager | PM2 fork mode, puerto 3005 | `crm-iseie-api` |
| Reverse proxy | nginx con HTTP/2 + SSL + cache 1 año immutable para /assets | Configurado |
| Storage | Cloudflare R2 (compatible S3) | Backend listo, credenciales pendientes |
| Email | Brevo | Backend listo, API key pendiente |
| PDFs | Puppeteer (Chrome headless bundled) + fuentes OFL embebidas | Operativo |
| Tests | vitest (frontend smoke) + suite custom Node (integración) | 77 OK |

---

## 3. Comandos rápidos

### Arrancar local

```powershell
# Túnel SSH a la DB del VPS (necesario para arrancar el backend local)
ssh -N -L 5432:127.0.0.1:5432 root@72.60.90.135

# Backend (puerto 3005, ENV apuntando al túnel)
cd backend; npm run dev

# Frontend (puerto 5173, proxy /api → :3005)
cd frontend; npm run dev
```

### Deploy

```powershell
# Frontend (intercambio atómico, regenera bundles)
bash scripts/deploy-frontend.sh

# Backend (scp + pm2 restart)
scp backend/src/<file.js> root@72.60.90.135:/opt/crm-iseie/src/<path>
ssh root@72.60.90.135 "pm2 restart crm-iseie-api --update-env"
```

### Tests

```powershell
# Suite integración completa (CRUD + RBAC), auto-crea/elimina usuarios temp
cd backend; npm run test:integration

# O por separado:
node scripts/test-crud.mjs       # 57 tests CRUD (necesita CRM_EMAIL/PASSWORD)
node scripts/test-rbac.mjs       # 20 tests RBAC (necesita GESTOR_EMAIL/PASSWORD)
```

### Backups

```bash
# Manual
bash scripts/backup-db.sh

# Programado (en VPS, cron diario 03:00)
0 3 * * * /opt/crm-iseie/scripts/backup-db.sh >> /var/log/crm-iseie-backup.log 2>&1
```

### Observabilidad

```bash
curl https://crm.iseie.com/api/health             # ping ligero
curl https://crm.iseie.com/api/health/detailed    # DB + integraciones + schedulers
```

---

## 4. Documentos vivos

| Archivo | Contenido |
|---|---|
| `README.md` | Overview público corto |
| `CLAUDE.md` | Instrucciones para Claude Code en futuras sesiones |
| `ESTADO.md` (este) | Estado actual del proyecto |
| `DIFERENCIAS-CRM-HERMANO.md` | Divergencias conscientes vs el CRM hermano |
| `docs/01-esquema-base-datos.md` | Schema SQL detallado |
| `docs/02-setup-local.md` | Setup local + seed de test |
| `docs/03-api-endpoints.md` | 249 endpoints auto-generado |
| `docs/MANUAL-USUARIO.md` | Manual end-user (29 secciones, ~750 líneas) |
| `vps-72.60.90.135-handoff.md` | Layout VPS, PIDs ajenos, reglas mantenimiento |

---

## 5. Pendientes ordenados por impacto

### 🟡 Bloqueado por configuración externa (tu lado)

| # | Item | Qué necesito |
|---|---|---|
| 1 | Email transaccional (welcome, recordatorios, dossier) | API key Brevo en `/settings → APIs globales` |
| 2 | Almacenamiento real de documentos + avatares | R2 credentials (access key + secret + bucket) |
| 3 | Pagos (si aplica) | Stripe secret key |
| 4 | Campañas (no portado, IA-only en hermano) | OAuth Meta Ads, Google Ads — solo si quieres añadirlas |
| 5 | Reportes con IA | Claude API key (Anthropic) |
| 6 | Verificación E2E manual de cada flujo | Tu testing manual |

### 🟢 Tareas que puedo seguir haciendo

- **Template de certificado ISEIE** — diseño recibido (PDF Iris Alvarez Curso de Ventas). En curso.
- Optimización bundle: lazy-load recharts solo en /reports + /dashboard (~100 KB ahorro)
- Tests adicionales (edge cases de validación, idempotency, etc.)
- Limpiar dead code `lead.model.js findAll` branch `projectIds: array`
- Migración del módulo `audiences` si decides añadir IA

---

## 5.bis Hito de hoy — 2026-05-25

**Consolidación a proyecto único + hardening + UX**:

- DB: 11 proyectos país → 1 proyecto `ISEIE` (datos preservados en id=10)
- Frontend: ProjectSwitcher + ALL_PROJECTS_ID + banderas eliminados (4 huérfanos borrados)
- Seguridad: sourcemap OFF, ErrorBoundary fix Vite, AuthContext memoizado, rate-limit en endpoints sensibles
- UX: ConfirmDialog global (14 confirm + 4 alert migrados), `useLeads.ts` tipado (-18 any)
- Notificaciones: portado módulo del hermano (centro de preferencias + dropdown popover)
- Reportes: gráficos recharts profesionales (LineChart con eje XY, tooltip custom, toggle series)
- Tests integración: 77/77 OK tras consolidación (scripts ajustados a slug='iseie')

---

## 6. Reglas firmes (no negociables)

- **Schema con paridad estricta** al CRM hermano excepto los puntos
  documentados en `DIFERENCIAS-CRM-HERMANO.md` (proyecto único + no-IA).
- **NUNCA `pm2 restart all`** ni `pm2 delete all` — mataría las 3 apps
  ajenas del VPS (`prerender-opynio` PID 974, `psicologo-ia-pro` PID 981,
  `veterinary-ai` PID 975).
- **NUNCA modificar configs nginx ajenas** — sólo
  `/etc/nginx/sites-available/crm.iseie.com`.
- **OPSEC**: secretos (DB pass, JWT, API keys) viven sólo en `.env`, en
  `docs/_private/` (gitignored) o en env vars del VPS. Nunca en chat,
  commits ni logs.
- **Commits sólo cuando el usuario lo pida.** Flujo directo a `main`.
- **`scripts/deploy-frontend.sh`** hace intercambio atómico (live↔backup);
  evita el problema de bundles obsoletos acumulados.

---

## 7. Memoria persistente (Claude Code)

En `~/.claude/projects/c--Users-nange-Documents-Proyectos-T-CRM-ISEIE/memory/`:

- `MEMORY.md` — índice
- `project_vps_postgres_coexistence.md` — historia DB rename
- `project_vps_deployment.md` — layout productivo + reglas mantenimiento
- `feedback_schema_parity.md` — regla de paridad estricta
- `project_single_project_consolidation.md` — consolidación a proyecto único 2026-05-25

---

**Cualquier futura sesión Claude Code debe leer este archivo primero**,
luego `CLAUDE.md`, luego `DIFERENCIAS-CRM-HERMANO.md`. El resto es
referencia técnica detallada.
