# CRM-ISEIE — Guía de desarrollo

> **Este archivo es lo primero que lee cualquier Claude que abra el repo.**
> Léelo entero antes de tocar código.

---

## Qué es este proyecto

CRM nuevo para **ISEIH/ISEIE** que se construye desde cero. Hereda **patrones, convenciones y arquitectura** del CRM existente (`360crm.tech` — repo `esos2dev-oss/CRM`), pero es un sistema independiente con su propio dominio, VPS, base de datos y ciclo de vida.

**Objetivo:** que este CRM quede **igual de bien o mejor documentado** que el actual. La calidad de los docs es parte del producto, no un extra.

---

## Repositorio de referencia (CRM existente)

El CRM ya en producción es la **fuente de verdad para patrones**:

- **Local:** `c:\Users\nange\Documents\Proyectos T\CRM\`
- **Remoto:** https://github.com/esos2dev-oss/CRM
- **Producción:** https://360crm.tech/crm/

**Regla del proyecto:** todo apartado, módulo o patrón que se cree en CRM-ISEIE **debe derivar del CRM existente**. No se inventa nada que ya esté resuelto allí.

Inventario completo de qué hay disponible para replicar (32 módulos backend + 34 frontend + cron jobs + shared) en:

📋 **[documentacion/00-baseline-desde-crm.md](documentacion/00-baseline-desde-crm.md)** — léelo antes de crear cualquier módulo.

Patrones críticos a copiar literalmente del CRM hermano:

- Arquitectura modular backend (`backend/src/modules/<dominio>/`) — un dir por dominio, archivos `<X>.{routes,controller,service,model,validation}.js` + `index.js` que exporta `{ prefix, router }`
- Arquitectura modular frontend (`frontend/src/modules/<feature>/`) — `api/`, `hooks/`, `components/`, `pages/`
- Auth JWT (access 15 min Bearer + refresh 30d httpOnly) + bcrypt cost 12 + middleware chain `verifyToken → roleGuard → projectAccess`
- Round-robin transaccional para asignación de leads (`BEGIN/COMMIT`)
- Pre-signed URLs R2 (15 min de expiración)
- Encriptación AES-256 de credenciales API en DB (módulo `credentials`)
- Sistema de migraciones SQL secuenciales (`001_initial_schema.sql` → `NNN_*.sql`)
- Validación Zod en cada endpoint
- Errores con `AppError(message, statusCode)`
- Logger `pino`
- Convención commits, ramas, deploy

Su `CLAUDE.md` (en `c:\Users\nange\Documents\Proyectos T\CRM\CLAUDE.md`) describe todo. Léelo antes que el nuestro si dudas de algún patrón.

**Cuándo divergir del CRM existente:** solo si hay una razón concreta documentada en `documentacion/`. Si copias un patrón, copia entero — no mezcles enfoques.

---

## Estado actual

- **Repositorio:** vacío (commit inicial pendiente)
- **Código:** sin escribir
- **Planificación:** completa en `documentacion/`, `fase-1/`, `fase-2/`, `fase-3/`
- **VPS:** preparado (ver [vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md))

**Nota sobre la planificación heredada:** los archivos `PLAN-TRABAJO.md`, `BACKEND-PENDIENTE.md`, `REVISAR.md`, `bugs/`, `features/` y `fase-1/`-`fase-3/` originalmente describen el CRM existente, no éste. Sirven como **catálogo de features y patrones** a replicar/mejorar, **no como roadmap actual**. El roadmap real de CRM-ISEIE se definirá en `documentacion/00-roadmap-iseie.md` (pendiente).

---

## Stack (decisión por defecto, abierta a discusión)

Mismo stack que el CRM existente, salvo que el usuario indique lo contrario:

| Capa | Tecnología |
|------|-----------|
| Frontend | React 18 + Vite + TypeScript + shadcn/ui + Tailwind |
| Backend | Node.js 20+ + Express (API REST) — ES modules, sin TypeScript |
| DB | PostgreSQL 15+ (queries directas con `pg`, sin ORM) |
| Storage | Cloudflare R2 (compatible S3) — pendiente decidir si se reutiliza el bucket del CRM existente o se crea uno propio |
| Email | Brevo |
| Auth | JWT propio (access 15 min Bearer + refresh 30d httpOnly) + bcrypt cost 12 |
| Validación | Zod en cada endpoint |
| Tests | Vitest |

---

## Despliegue — VPS y entornos

**VPS compartido con otras apps** — ver detalle completo en [vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md).

| | |
|---|---|
| IP | `72.60.90.135` |
| Usuario | `root` |
| Credenciales | en local: `fase-1/CREDENCIALES-PRIVADO.md` (no versionado) — el usuario lo rellena |
| Backend (PM2) | puertos `3005` / `3006` / `3007` reservados |
| Backend (FS) | `/opt/crm-iseih/` |
| Frontend (FS) | `/var/www/crm-iseih/` |
| DB | PostgreSQL a instalar — `crm_iseih` / `crm_iseih_user` |
| PM2 | `pm2-root.service` (compartido con otras apps del VPS — cuidado con `pm2 delete`) |
| Nginx | añadir sitio en `/etc/nginx/sites-available/crm-iseih.<dominio>` |
| Dominio | pendiente decidir (recomendado: subdominio propio + SSL Let's Encrypt) |

**⚠️ Reglas no negociables del VPS:**

- NO modificar configs nginx de sitios existentes
- NO tocar apps PM2 de `root` (`prerender-opynio`, `psicologo-ia-pro`, `veterinary-ai`)
- NO usar puertos `3001`-`3004` (ocupados)
- NO abrir puertos extras en UFW
- NO tocar `/var/www/.env`

**Ramas y entornos:** seguir el modelo del CRM existente — `main` = producción, `staging` = QA, `feat/<nombre>` = features.

---

## Convenciones de código

Heredadas del CRM existente — no inventar nada nuevo sin justificación.

### Backend
- ES modules (`import`/`export`), **no** TypeScript en backend
- Archivos en **kebab-case** (`lead.service.js`)
- `async/await`, nunca callbacks
- Queries SQL directas con `pg` pool — **NO ORM**
- Validación con **Zod** en cada endpoint
- Errores con `AppError(message, statusCode)`
- Logger `pino` (info/warn/error)
- Tests con Vitest

### Frontend
- Componentes en **PascalCase**
- **shadcn/ui** para primitivas
- **Tailwind** para estilos — nada de CSS modules ni styled-components
- Estado global con **React Context** (NO Redux)
- Fetching: funciones en `api/` con axios, llamadas desde hooks custom
- React Router v6 con lazy loading por página

### General
- Variables/funciones en **inglés**, comentarios en **español** solo si son necesarios
- **Commits en español** con prefijos: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Variables sensibles en `.env` — **NUNCA** hardcodeadas, **NUNCA** commiteadas
- Variables `VITE_*` se compilan al bundle público: **prohibido** ponerles tokens/secrets (excepto `*_PUBLISHABLE_KEY`)
- No commits sin pedirlo el usuario
- No `git push --force` a `main`/`staging` salvo orden directa

---

## Estructura objetivo del repositorio

Cuando exista código, el repo debe verse así (espejo del CRM existente):

```
CRM-ISEIE/
├── CLAUDE.md                    Este archivo
├── README.md                    Overview público
├── .gitignore
├── docs/                        Documentación técnica versionada
│   ├── 01-esquema-base-datos.md
│   ├── 02-estructura-proyecto.md
│   ├── 03-api-endpoints.md
│   ├── 04-variables-entorno.md
│   ├── 05-arquitectura-frontend.md
│   ├── 06-despliegue-devops.md
│   └── 07-deploy-y-ramas.md
├── backend/
│   ├── src/
│   │   ├── modules/             Un directorio por dominio (auth, leads, products, ...)
│   │   ├── shared/              config, middleware, services, utils
│   │   ├── jobs/                Cron jobs
│   │   └── app.js
│   ├── migrations/              SQL secuencial (001_initial.sql, 002_...)
│   ├── seeds/
│   ├── tests/
│   ├── ecosystem.config.js
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── modules/             Un directorio por feature
│   │   ├── shared/              UI, hooks, api client, lib
│   │   ├── contexts/
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
├── scripts/
│   ├── backup.sh
│   └── deploy.sh
└── nginx/
    └── crm-iseih.conf
```

Y la planificación heredada del Claude anterior (`documentacion/`, `fase-1/`, ...) queda como **catálogo de referencia**, no como código.

---

## Planificación heredada — índice rápido

> Todo el contenido bajo estas carpetas describe **lo que el otro Claude planificó pero no construyó**. Úsalo como inspiración + checklist, no como verdad absoluta.

- [documentacion/](documentacion/) — 24 docs con diagramas Mermaid (flujos, ER, entornos, auth, leads, conversiones, dossiers, integraciones)
- [PLAN-TRABAJO.md](PLAN-TRABAJO.md) — sprints originales (referenciaba el CRM existente)
- [BACKEND-PENDIENTE.md](BACKEND-PENDIENTE.md) — checklist de endpoints/módulos a implementar
- [REVISAR.md](REVISAR.md) — features con feedback pendiente de iteración
- [fase-1/](fase-1/) — análisis CRM viejo, UI/UX guide, setup servidor
- [fase-2/](fase-2/) — integraciones API externas
- [fase-3/](fase-3/) — funcionalidades avanzadas
- [database/](database/) — esquema y scripts SQL
- [bugs/](bugs/), [features/](features/) — historial de incidencias y feature requests
- [MANUAL-USUARIO.md](MANUAL-USUARIO.md) — manual end-user (referencia de scope)
- [vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md) — **obligatorio leer antes de deploy**

---

## Reglas firmes (heredadas del usuario)

- **No commits sin pedirlo** el usuario, aunque el cambio esté listo
- **Sin PRs.** Flujo: trabajar en `feat/X`, mergear a `staging`, validar, mergear a `main`. Para cambios chicos: directo a `main`
- **No `git rm --cached`, `git reset --hard`, `rm -rf`** sin plan + confirmación
- **No instalar paquetes globales** (`npm install -g`) sin pedirlo
- **OPSEC:** ningún secreto en el chat. Si el usuario pega uno, sugerir rotarlo y configurarlo por canal correcto
- **Idioma:** conversación en español. Comentarios en español. Código en inglés. Commits en español.

---

## Primer paso al abrir el repo

1. Leer este archivo entero
2. Leer **[documentacion/00-baseline-desde-crm.md](documentacion/00-baseline-desde-crm.md)** — el catálogo completo de módulos del CRM hermano
3. Leer [vps-72.60.90.135-handoff.md](vps-72.60.90.135-handoff.md) para no romper el servidor compartido
4. Hojear `documentacion/README.md` para ver el resto de la planificación
5. Confirmar con el usuario:
   - Stack final (¿confirmamos el del CRM existente o se cambia algo?)
   - Dominio / subdominio definitivo
   - Qué módulos del baseline son obligatorios para la v1 de CRM-ISEIE
   - Si el roadmap heredado se sigue o se reescribe desde cero
6. Crear `docs/`, `backend/`, `frontend/` con la estructura objetivo (espejo del CRM hermano)
7. Primera migración (`001_initial_schema.sql`) **derivada de la del CRM existente + las que añadieron columnas críticas después** (round-robin, refresh tokens, soft-delete leads…) — ver §8 del baseline
8. Login funcional antes de avanzar a nada más

**No empezar a escribir código de features sin que el usuario confirme stack y scope.**
**No inventar módulos: cópialos desde el CRM hermano.**
