# Prueba importación WooCommerce 2026-05-05

## Bugs reportados por el usuario tras hacer import en producción

### 1. Solo trajo 100 productos
- **Causa:** `wc.controller.js:53-58` hace fetch único con `per_page=100` hardcoded, sin loop de páginas
- **Fix:** loop `while (response.length === 100) { page++; ... }` hasta que la página devuelva menos de 100 items
- **Impacto:** todos los catálogos con +100 productos se cortan

### 2. No leyó Stripe
- **Estado del código:** WC import NO consulta Stripe — solo lee la API de WooCommerce
- **Stripe vive en otro módulo:** `ia-monitor` (`ia.controller.js:6-14`) usa `getDecryptedValue('stripe', projectId)` para métricas IA, no para enriquecer productos
- **Pregunta abierta:** ¿qué espera el usuario aquí?
  - ¿Que cada producto WC traiga su `stripe_price_id` / link de pago?
  - ¿Que aparezca info de suscripciones Stripe en el módulo IA?
  - ¿Que al sincronizar WC, se cree un Stripe Product/Price automáticamente?

### 3. Sin paginación en extracción
- Mismo issue que #1 (sin loop de páginas WC)
- Afecta también si añadimos sync de órdenes (CRM-232)

### 4. Categorías padre/hija no se crean
- **Causa:** `wc.controller.js:74` y `wc.model.js:64-68` solo guardan categorías como nombres en `wc_meta` JSONB
- **No se inserta nada en `product_categories`** (tabla con padre/hijo via `parent_id`)
- **No se llena `products.categoria_id` ni `products.subcategoria_id`**
- **Fix necesario:**
  - Para cada categoría WC → upsert en `product_categories` (slug + nombre + parent_id)
  - El `parent_id` viene de `wp.categories[].parent` (id WC del padre) → mapear a id local
  - Asignar al producto el `categoria_id` (raíz) y `subcategoria_id` (hoja)

### 5. No diferencia curso/master/diplomado
- **Causa raíz:** WooCommerce no tiene tipo "curso/master/diplomado" nativo. WC solo distingue `simple/variable/grouped/external`
- **Pregunta abierta:** ¿cómo distinguen estos 3 tipos en su WC?
  - ¿Por categoría? (ej: categoría "Másteres", "Diplomados", "Cursos")
  - ¿Por atributo personalizado? (ACF, atributo WC)
  - ¿Por etiqueta (tag)?
  - ¿Por slug del producto?
  - ¿Por SKU prefix? (ej: `MAS-001`, `DIP-002`, `CUR-003`)
- **Sin esa info no podemos mapear**

### 6. No trae SKU
- **Estado:** `wp.sku` SÍ se obtiene en el JSON pero solo se guarda en `wc_meta`
- **La columna `products.sku` EXISTE** (migración 010)
- **Fix:** mapearlo en el INSERT (`wc.model.js:64-68`)

### 7. No se ve el round-robin (orden de gestores y siguiente)
- **Estado:** Existe lógica completa en `lead.model.js:31-91` con tabla `project_queue_state` (`last_assigned_index`, `last_assigned_user_id`)
- **Pero NO hay endpoint API que lo exponga** — solo se calcula al recibir lead
- **Fix:** crear `GET /api/projects/:id/queue-state` que devuelva:
  - Lista de gestores activos del proyecto en orden (`orden_cola` de `user_projects`)
  - Quién recibió el último lead
  - Quién es el siguiente
  - + UI en frontend (Settings > Reparto de leads, o panel arriba del listado de prospectos)

---

## Lo que necesito del usuario para arreglar

### CRÍTICO — sin esto no podemos avanzar:
1. **JSON crudo de un producto WC** — pegar la respuesta de:
   ```
   GET https://<su-tienda>/wp-json/wc/v3/products?per_page=1
   ```
   (con consumer_key + consumer_secret). Solo necesitamos UN producto representativo (idealmente un máster con su categoría y SKU).

2. **Cómo distinguen curso/master/diplomado en WC**: ¿por categoría, atributo, tag, SKU prefix? — una captura del admin WC editando un producto sería suficiente.

3. **Aclaración Stripe**: ¿qué dato exacto esperaba ver tras la sincronización?

### Útil pero no bloqueante:
4. URL de la tienda WC (para testear sin compartir credenciales)
5. ¿La cola de round-robin debería verse en `Settings > Reparto` o como panel siempre visible en `/leads`?

---

## Plan de fix una vez con la info

| Bug | Cambio |
|---|---|
| #1, #3 | Loop de páginas en `fetchWcProducts()` con `page` incremental |
| #4 | Helper `upsertCategory()` que crea padre primero, luego hijo, devuelve IDs |
| #5 | Mapeo configurable: `producto_tipo_origen` (categoría/atributo/sku) en `projects` o config WC |
| #6 | Añadir `sku: wp.sku` al INSERT de products |
| #7 | Endpoint nuevo + frontend `QueueStatePanel.jsx` (ticket Angel) |
| #2 | Por definir según respuesta del usuario |
