# Tareas Angel — 2026-05-09 (Jira suspendido)

> ⚠️ Atlassian devolvió `Tenant is restricted: suspended-payment`. Estos tickets no se pudieron crear, los dejo aquí para que se publiquen cuando se reactive.

---

## TASK-A: dropdown categorías searchable + niveles separados (HIGH)

### Problema
El dropdown de categoría en `ProductFormDialog.tsx` muestra paths concatenados:
```
Cursos > Para Profesionales > Adicciones y Conductas Compulsivas
Cursos > Para Profesionales > Alimentación, Imagen Corporal y TCA
... (50+ líneas)
```
No se puede buscar escribiendo, hay que scrollear todo.

### Solución
1. **Selector tipo búsqueda (combobox typeahead)** — escribir "adicc" filtra
2. **Niveles separados en cascade**:
   ```
   Categoría 1: [Cursos ▾]
   Categoría 2: [Para Profesionales ▾]   ← solo aparece tras elegir Cursos
   Categoría 3: [Adicciones... ▾]        ← solo tras elegir Para Profesionales
   ```
3. Si producto ya tiene `categoria_id`, pre-rellenar TODA la cascada subiendo por `parent_id`
   (usar `GET /api/product-categories/:id/ancestors`)

### Backend disponible (sin cambios)
```
GET /api/product-categories/tree?projectId=X
GET /api/product-categories/:id/ancestors
```

### AC
- [ ] N selectores cascade donde N = profundidad del árbol
- [ ] Combobox con búsqueda al escribir
- [ ] Pre-relleno correcto al editar producto existente
- [ ] Reutilizable en filtros del listado, no solo en modal

---

## TASK-B: Sidebar por secciones colapsables con persistencia (HIGH)

### Problema
El sidebar muestra TODAS las secciones (Principal, Captación, Catálogo, Finanzas, Análisis, Sistema) abiertas a la vez. Muy largo y ruidoso.

### Solución
- Cada sección sea **encabezado clickeable** con caret (▶/▼)
- **Persistencia** en `localStorage.sidebar_sections_open`
- **Auto-expandir** la sección que contiene la ruta activa al cargar
- Al navegar a otra sección, se expande automáticamente sin cerrar las que el usuario tenía abiertas

### Archivo
`frontend/src/shared/components/layout/Sidebar.jsx` — `NAV_SECTIONS`

### AC
- [ ] Caret + click expand/collapse con animación
- [ ] Estado persistente en localStorage
- [ ] Sección con ruta activa se auto-abre al cargar
- [ ] Modo collapsed-sidebar (mini) sigue funcionando

---

## TASK-C: Documentos/Certificados — selectores de programa y alumno (HIGH)

### Problema
En `/documentos` → "Nuevo Certificado" todos los campos son texto libre. El usuario tiene que copiar-pegar datos que ya existen en el CRM (leads, productos, módulos).

### Solución

**Selector de alumno** (combobox typeahead)
- Busca en `leads` Y `clients` del proyecto activo
- Pre-rellena: nombre, email, dni (si está en custom_fields)
- Botón "Crear como nuevo" si no encuentra

**Selector de programa**
- Combobox de productos del proyecto: `GET /api/products?projectId=X`
- Pre-rellena: nombre, horas (de `duracion`), precio
- Si tiene `url_info` (link al WC), botón "Ver en web"

**Plan de estudios automático**
- `GET /api/products/:id/modules` (Diego añade en este sprint — ver más abajo)
- Lista módulos editables inline

### Backend Diego en este sprint
- ✅ Migración 045 product_modules
- ✅ Endpoints `/api/products/:id/modules` (CRUD)
- ✅ Importación WC ahora extrae `permalink` → `products.url_info`

### AC
- [ ] Selector alumno funciona y pre-rellena datos
- [ ] Selector programa pre-rellena nombre/horas/precio
- [ ] Módulos cargan automáticamente del producto
- [ ] Botón "Ver en web" si hay url_info
- [ ] Certificado se genera con datos correctos

---

## TASK-D: Dock flotante perdió Chat de Claude (BUG)

### Problema
`frontend/src/shared/components/layout/FloatingDock.jsx` solo muestra `TicketsLauncher`. El JSDoc dice "chat AI + canales" pero no está el chat.

### Solución
- Restaurar botón flotante de Claude Chat (módulo `/ai-chat` ya existe)
- Revisar `git log -p frontend/src/shared/components/layout/FloatingDock.jsx` para ver cuándo se quitó
- Considerar features adicionales de soporte:
  - Ver mis tickets recientes
  - Quick-reply desde el dock
  - Estado del sistema (link `/status`)

### AC
- [ ] Dock muestra: 💬 Chat IA + 🎟️ Tickets soporte
- [ ] Toggle visibilidad respeta `setFloatingDockHidden` existente

---

## BUG arreglado por Diego en este commit

`frontend/src/modules/permissions/api/permissions.api.ts:18`
- `listCustomRoles(projectId)` enviaba `?projectId=X` al backend pero los custom roles son globales. Fix: ya no se envía el query param.
