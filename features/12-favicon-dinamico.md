# Favicon dinamico por proyecto activo

**Jira:** — (añadido en commit 56935d4)
**Estado:** ✅ Implementado
**Tipo:** UX mejora

## Contexto

El CRM tiene un favicon default (gato preliminar). Pero cuando el usuario esta trabajando en un proyecto con logo subido, el favicon del tab deberia ser ese logo para distinguir visualmente entre tabs si abre varios proyectos.

## Implementacion

`ProjectContext.jsx`:
- `useEffect` observa `activeProject.id`, `activeProject.logo_url` y `activeProject.nombre`
- Si hay `logo_url`: setea `<link rel="icon">` al endpoint `/api/projects/:id/logo` (publico, sirve el PNG/JPG del disco)
- Si no: usa default `favicon.jpeg`
- Tambien actualiza `document.title` con el nombre del proyecto

## Comportamiento

| Escenario | Favicon | Title |
|---|---|---|
| Sin proyecto activo | Gato default | "CRM MultiProyecto" |
| Proyecto con logo (Psiko) | Logo Psiko | "Psiko Aprende - CRM" |
| Proyecto sin logo (Psicologo IA, solo emoji) | Gato default | "Psicologo IA - CRM" |

## Notas

- El endpoint `/api/projects/:id/logo` es publico (no requiere auth) porque los browsers no envian tokens al cargar favicons
- Al cambiar de proyecto el favicon y title se actualizan al instante
- Si el usuario borra el logo del proyecto, vuelve al default en el siguiente re-render del ProjectContext

## Commits

- `56935d4` feat: favicon dinamico + SPA reload fix
