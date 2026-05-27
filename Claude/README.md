# Claude — Conocimiento del CRM-ISEIE

Esta carpeta concentra TODO el contexto que Claude (asistente IA) ha acumulado trabajando en este proyecto. Pensada para que cualquier dev nuevo se ponga al dia rapido.

## Por donde empezar

1. **[CURRENT-STATE.md](./CURRENT-STATE.md)** — snapshot del estado actual + trabajo reciente + como deployar. **Leer primero.**
2. **[MEMORY.md](./MEMORY.md)** — indice de toda la memoria persistente de Claude (links a archivos individuales).
3. **[../docs/](../docs/)** — documentacion tecnica formal del codigo (schema DB, endpoints, arquitectura).
4. **[../CLAUDE.md](../CLAUDE.md)** — convenciones del proyecto que Claude debe seguir.

## Tipos de archivos en esta carpeta

| Prefijo | Que contiene |
|---|---|
| `user_*.md` | Perfil del usuario (Diego), preferencias de colaboracion |
| `feedback_*.md` | Correcciones/decisiones que Claude debe recordar (no repetir errores) |
| `project_*.md` | Estado del proyecto, sesiones de trabajo, backlog, pendientes |
| `reference_*.md` | Credenciales, paths, URLs de servidores externos |
| `CURRENT-STATE.md` | Snapshot resumido del estado del CRM (este readme) |
| `MEMORY.md` | Indice central — siempre actualizado |

## Memoria especifica de ISEIE

- [reference_vps_iseie.md](./reference_vps_iseie.md) — Credenciales VPS ISEIE
- [reference_vps_72_60_90_135.md](./reference_vps_72_60_90_135.md) — Detalles del VPS
- [project_pending_iseie_beta_gate.md](./project_pending_iseie_beta_gate.md) — beta gate del sidebar (YA HECHO 2026-05-27)
- [project_pending_diplomados_recibos.md](./project_pending_diplomados_recibos.md) — certificados con campos `_texto`

## Memoria compartida con CRM hermano (ISEIH)

Hay archivos que son compartidos porque Diego trabaja en ambos CRMs. Las decisiones de stack/arquitectura aplican a ambos. Memoria comun:

- [user_diego.md](./user_diego.md) — perfil dev
- [feedback_test_first.md](./feedback_test_first.md) — siempre tests con codigo
- [feedback_db_tracking.md](./feedback_db_tracking.md) — guardar SQL completo
- [feedback_deploy_pm2.md](./feedback_deploy_pm2.md) — deploy via PM2 (no nohup)
- [feedback_features_docs.md](./feedback_features_docs.md) — docs por feature
- [feedback_repo_structure.md](./feedback_repo_structure.md) — repos privados
- [feedback_storage_r2_fallback.md](./feedback_storage_r2_fallback.md) — R2 fallback a localStorage
- [project_crm_overview.md](./project_crm_overview.md) — overview general
- [project_team_assignments.md](./project_team_assignments.md) — Diego=backend, Angel=frontend
- [project_server_setup.md](./project_server_setup.md) — stack server
- [reference_deploy_paths.md](./reference_deploy_paths.md) — rutas de deploy
- [reference_vps.md](./reference_vps.md) — VPS ISEIH

## Sesiones de trabajo registradas

- [project_session_20260406.md](./project_session_20260406.md) — infra + DB + auth
- [project_session_20260407.md](./project_session_20260407.md) — leads backend+frontend
- [project_session_20260414.md](./project_session_20260414.md) — 18 features + QA
- [project_session_20260414_part2.md](./project_session_20260414_part2.md) — continuacion
- [project_session_20260425.md](./project_session_20260425.md) — matriculas/forms/email-seq/payroll/wc

## Backlog y estado beta

- [project_backlog_f4_20260424.md](./project_backlog_f4_20260424.md) — backlog Jira F4
- [project_beta_state_20260424.md](./project_beta_state_20260424.md) — estado DB staging
- [project_pendientes_post_beta.md](./project_pendientes_post_beta.md) — gaps post-BETA

## Migraciones SQL

Todas en [`../backend/migrations/`](../backend/migrations/). Ordenadas por numero secuencial. Algunas importantes recientes:

- `064_wp_pages_strategy.sql` — habilita import de paginas WP (sin WC) para ISEIE
- `065_products_brochure_url.sql` — columna brochure_url para PDFs extraidos

## Convenciones del proyecto

Ver [`../CLAUDE.md`](../CLAUDE.md) en la raiz del repo. Resumen:

- Backend: Node.js ES modules + Express + PostgreSQL puro (sin ORM) + Zod
- Frontend: React 18 + Vite + Tailwind + shadcn/ui
- Idioma codigo: ingles, comentarios espanol
- Commits en espanol: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Branches: `main`=prod
- Tests con Vitest
