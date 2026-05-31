# Claude — Carpeta de handoff CRM-ISEIE

Todo el contexto que necesita una IA o dev nuevo para operar en este repo.

## 📖 Leé en este orden

1. **[HANDOFF.md](./HANDOFF.md)** — stack, infra, credenciales placeholder, deploy, pitfalls
2. **[MODULES.md](./MODULES.md)** — tabla de módulos backend + frontend con files y endpoints
3. **[CURRENT-STATE.md](./CURRENT-STATE.md)** — snapshot operativo (módulos activos, integraciones, pendientes)
4. **[CHANGELOG.md](./CHANGELOG.md)** — log cronológico de commits importantes
5. **[MEMORY.md](./MEMORY.md)** — índice de memoria persistente

## 📁 Archivos de memoria persistente

| Tipo | Qué |
|---|---|
| `user_*.md` | Perfil Diego, preferencias colaboración |
| `feedback_*.md` | Decisiones del owner que no repetir |
| `project_*.md` | Sesiones, backlog, pendientes |
| `reference_*.md` | Paths, URLs, credenciales placeholder |

## 🤖 Para otra IA que entra a este proyecto

Decile literalmente:
> "Leé `Claude/HANDOFF.md` y `Claude/MODULES.md` antes de tocar nada. Si vas a deployar, mirá la sección 8 de HANDOFF. Si vas a importar datos, mirá `backend/scripts/` y la sección 6. Si te trabás, corré `qa_iseie.mjs` y mandame el resultado."

## ⚠️ Reglas

1. Después de un trabajo: actualizá `CHANGELOG.md` y `CURRENT-STATE.md`
2. Nuevo pitfall: agregalo a `HANDOFF.md` sección 9
3. Credenciales en placeholder `<<NOMBRE_KEY>>` SIEMPRE
4. Tests: `qa_iseie.mjs` debe seguir verde antes de deployar
