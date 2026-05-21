# Filtro de usuarios por proyecto

**Jira:** CRM-189
**Estado:** ✅ Implementado
**Tipo:** Feature

## Contexto

En Configuracion > Usuarios, la tabla mostraba todos los usuarios siempre. Con varios proyectos (cada uno con sus gestores), hace falta filtrar por proyecto activo o elegir otro.

## Implementacion

- Variable state `projectFilter` con 3 modos:
  - `'active'` (default): usuarios del proyecto activo del sidebar
  - `'all'`: todos los usuarios
  - `id numerico`: usuarios de un proyecto especifico seleccionado
- Al montar y al cambiar el filter, re-fetch a `/api/users?projectId=X`
- Backend ya soportaba el filtro via `EXISTS (SELECT 1 FROM user_projects WHERE ...)`

## UI

Barra de filtro sobre la tabla con 3 botones + 1 select:

```
┌─────────────────────────────────────────────────────┐
│ Mostrar: [Psiko Aprende] [Todos los proyectos]      │
│          [Proyecto especifico ▾]   N usuarios       │
└─────────────────────────────────────────────────────┘
```

## AC

- [x] Admin en proyecto Psiko ve solo Laura, Carlos, Manuel, Diego, Angel
- [x] Click en "Todos los proyectos" muestra todos
- [x] Selector de proyecto filtra por ese
- [x] Counter visible con N usuarios del filtro actual

## Commits

- `d0759d5` feat(CRM-189): filtro de usuarios por proyecto
