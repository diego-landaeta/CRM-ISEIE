# Prompt de inicio — CRM-ISEIE

> Pega el bloque de abajo en una nueva sesión de Claude Code al abrir este proyecto, o úsalo como guion mental si vienes a continuar.

---

## Para Claude (lectura obligatoria, en este orden)

Estás trabajando en **CRM-ISEIE**, un CRM nuevo para ISEIH/ISEIE que se construye desde cero. **No empieces a escribir código todavía.** Primero lee, en este orden:

1. [`CLAUDE.md`](CLAUDE.md) — guía de desarrollo, stack, despliegue, reglas firmes.
2. [`documentacion/00-baseline-desde-crm.md`](documentacion/00-baseline-desde-crm.md) — catálogo canónico de los 32 módulos backend + 34 frontend del CRM hermano. **Todo lo que crees aquí deriva de allí.**
3. [`vps-72.60.90.135-handoff.md`](vps-72.60.90.135-handoff.md) — VPS compartido con otras apps en producción. Hay cosas que NO se pueden tocar.
4. [`documentacion/README.md`](documentacion/README.md) — índice del resto de la planificación heredada (referencia, no roadmap actual).

Después de leer, **NO** propongas implementación todavía. Confirma conmigo:

- Stack final (default: mismo que el CRM hermano — React 18 + Vite + Tailwind + shadcn + Node + Express + PG).
- Dominio / subdominio definitivo (todavía sin decidir).
- Qué módulos del baseline son obligatorios para la v1.
- Si el roadmap heredado (`PLAN-TRABAJO.md`, `BACKEND-PENDIENTE.md`, `fase-1..3/`) se sigue o se reescribe.

## Reglas firmes para esta sesión

- **Idioma:** conversación y commits en español, código y nombres en inglés.
- **Comunicación:** directa, sin adornos, sin emojis en código/commits.
- **OPSEC:** nunca pidas credenciales por chat. El password de `root` del VPS y todas las API keys viven en `fase-1/CREDENCIALES-PRIVADO.md` (gitignored) — yo lo relleno localmente, tú lo lees desde allí cuando lo necesites.
- **CRM hermano = fuente de verdad.** No inventes módulos: cópialos desde `c:\Users\nange\Documents\Proyectos T\CRM\` (repo `esos2dev-oss/CRM`). Si vas a divergir de un patrón, justifícalo antes.
- **Git:** push directo a `main` permitido (es mi flujo habitual). Para cambios riesgosos pasar por `staging` primero.
- **Migraciones:** secuenciales `NNN_descripcion.sql`, idempotentes cuando se pueda, `BEGIN/COMMIT`. Empezar con `001_initial_schema.sql` consolidado (estudiando la del CRM hermano + las migraciones críticas posteriores — round-robin, refresh tokens, soft-delete, etc.).
- **No commits sin pedirlo.** No `git push --force`. No `rm -rf` ni `git reset --hard` sin plan.

## Estado actual del repo

- Repo en GitHub: `esos2dev-oss/CRM-ISEIE` (privado)
- Solo documentación, **sin código**. Bootstrap hecho en el commit inicial `f2f4807` + baseline `b1b66fa`.
- Sin migraciones, sin backend, sin frontend.
- VPS `72.60.90.135` accesible como `root` (credencial en archivo privado local).
- PostgreSQL **no está instalado** todavía en el VPS — primer paso de infra real.

## Próximo paso (cuando yo te dé luz verde)

1. Crear estructura `docs/`, `backend/`, `frontend/` espejo del CRM hermano.
2. Escribir `docs/01-esquema-base-datos.md` consolidando lo aprendido del CRM hermano.
3. Crear `backend/migrations/001_initial_schema.sql` consolidado.
4. Instalar PostgreSQL en el VPS y ejecutar la migración.
5. Backend mínimo: `auth` + `users` + `projects` + login funcional.
6. Frontend mínimo: login + dashboard vacío.

**No empieces el paso 1 sin que te lo confirme explícitamente.**

---

¿Listo? Confírmame que leíste los 4 documentos de arriba y dime qué entendiste como punto de partida.
