# [Nombre de la feature]

**Jira:** CRM-N
**Estado:** 📝 Backlog | 🚧 En progreso | ✅ Implementado
**Tipo:** Feature | Bug | Mejora
**Prioridad:** Alta | Media | Baja

## Contexto

Por que existe esta feature. Caso de uso real. Problema que resuelve.

## Alcance

- [ ] Qué entra (bullets concretos)
- [ ] ...
- [ ] ...

**No incluye** (scope cut):
- Lo que deliberadamente NO es parte de esta feature

## Modelo de datos

**Tablas nuevas:**
```sql
CREATE TABLE ejemplo (...);
```

**Columnas añadidas a tablas existentes:**
- `products.nuevo_campo TYPE` — descripcion

## Endpoints backend

| Metodo | Path | Auth | Descripcion |
|---|---|---|---|
| POST | `/api/...` | admin | ... |
| GET | `/api/...` | any | ... |

## UI frontend

**Pagina nueva:** `/ruta` (si aplica)
**Componentes:** `<NombreDialog>`, `<OtraVista>`
**Navegacion:** donde aparece en el sidebar/menu

## Flujo del usuario

1. Usuario hace X
2. Sistema responde Y
3. ...

## Dependencias

- Depende de: CRM-X, CRM-Y (debe estar antes)
- Bloquea: CRM-Z (esta es prerequisito)

## Consideraciones tecnicas

- Performance
- Seguridad
- Escalabilidad
- Migraciones de datos si aplica

## Tests

- [ ] Unit test X
- [ ] Integration test Y
- [ ] Manual QA Z

## AC (acceptance criteria)

- [ ] Criterio 1
- [ ] Criterio 2

## Notas / Decisiones pendientes

- Cualquier decision que falte por tomar
- Alternativas consideradas
