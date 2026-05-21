# Categorias de productos hasta 5 niveles

**Jira:** CRM-195
**Estado:** 📝 Backlog
**Tipo:** Refactor + feature

## Contexto

Hoy `products` tiene 2 columnas fijas (`categoria_id` + `subcategoria_id`) que limitan a 2 niveles. El usuario necesita mas profundidad. Caso real:

```
Facultad (1)
 └── Educacion (2)
      └── Formacion Profesional (3)
           └── Curso / Diplomado / Master (4)
                └── Modalidad (5)
```

Hasta 5 niveles para cubrir casos complejos futuros sin renovar el schema mas adelante.

## Aproximacion

La tabla `product_categories` **ya es recursiva** via `parent_id` (self-referential). Soporta N niveles a nivel DB. El problema es que `products` tiene 2 FKs fijas. Cambio:

- Eliminar `products.subcategoria_id`
- Usar solo `products.categoria_id` apuntando al **nodo hoja** (el nivel mas profundo)
- El breadcrumb completo (Facultad → Educacion → FP → Master → Modalidad) se deriva traversando `parent_id` hasta encontrar el nodo raiz

## Modelo

```sql
-- Migracion 015_categories_5_levels.sql
BEGIN;

-- Data migration: si producto tiene subcategoria_id, mover ese id a categoria_id (porque subcat es mas profunda)
UPDATE products SET categoria_id = subcategoria_id WHERE subcategoria_id IS NOT NULL;

-- Drop columna subcategoria_id
ALTER TABLE products DROP CONSTRAINT fk_products_subcategoria;
ALTER TABLE products DROP COLUMN subcategoria_id;

-- Vista helper con breadcrumb
CREATE OR REPLACE VIEW products_with_category_path AS
WITH RECURSIVE cat_tree AS (
  SELECT id, nombre, parent_id, 1 as depth, nombre as path
  FROM product_categories WHERE parent_id IS NULL
  UNION ALL
  SELECT c.id, c.nombre, c.parent_id, ct.depth + 1, ct.path || ' > ' || c.nombre
  FROM product_categories c
  JOIN cat_tree ct ON c.parent_id = ct.id
)
SELECT p.*, ct.path as categoria_path, ct.depth as categoria_depth
FROM products p LEFT JOIN cat_tree ct ON ct.id = p.categoria_id;

-- Constraint: max 5 niveles (check a nivel aplicacion, no en DB)
-- En el backend, al crear/mover categoria validar depth(parent)+1 <= 5

COMMIT;
```

## Validacion en backend

```js
// category.service.js
async function validateDepth(parentId) {
  if (!parentId) return 1;
  let depth = 1;
  let current = await categoryModel.findById(parentId);
  while (current?.parent_id) {
    depth++;
    if (depth >= 5) throw new AppError('Maximo 5 niveles de anidacion', 400, 'MAX_DEPTH');
    current = await categoryModel.findById(current.parent_id);
  }
  return depth + 1;
}
```

## UI

**Editor de categorias (CategoriesTab en ProjectSettingsDialog):**
- Renderizar arbol colapsable con indentacion por nivel
- Boton "+ subcategoria" en cada nodo (si depth < 5)
- Drag & drop para mover (validando no exceder 5)
- Color/icono opcional por categoria

**Selector en ProductFormDialog:**
- Cascade dropdowns (nivel 1 → nivel 2 → nivel 3...)
- O picker estilo arbol expandible
- Solo se puede seleccionar **nodos hoja** para asignar al producto
- Breadcrumb visible: "Educacion > FP > Master > Presencial"

**En ProductCard:**
- Mostrar breadcrumb en lugar de 2 badges separados

## Integracion con CRM-177 (WooCommerce)

- Al importar, si WC tiene categoria anidada: crear la cadena completa en CRM respetando limite de 5
- Si WC tiene mas de 5 niveles: truncar los mas profundos y log warning

## Dependencias

- Cambia el schema de `products` → afecta todo lo que lea/escriba categorias (ProductFormDialog, ProductsPage, ProductCombobox, commission_rules si se filtra por producto)
- Mantener compatibilidad con la UI actual durante la transicion

## AC

- [ ] Superadmin crea arbol de 5 niveles y asigna producto al nodo hoja
- [ ] Producto muestra breadcrumb completo
- [ ] Intentar nivel 6 da error claro
- [ ] Import WC crea cadenas completas respetando limite
- [ ] ProductCombobox muestra breadcrumb al lado del nombre
