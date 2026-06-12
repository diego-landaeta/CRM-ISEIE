# Fix — `conversions.producto_contratado_id` NULL (backfill + auto-lookup)

**Fecha**: 2026-06-12
**Aplica a**: CRM ISEIE y CRM ISEIH
**Detectado en**: Fase A.3 (`docs/17-fase-a3-inventario-db.md`)

---

## Síntoma

| | ISEIE | ISEIH |
|---|---|---|
| Conversions totales | 13 | 282 |
| Con `producto_contratado_id` (FK al catálogo) | **0** | **1** |
| Con `producto_contratado` (texto libre) | 13 | 281 |

Las conversiones venían guardando solo el TEXTO del producto y dejando el FK en `NULL`. Esto rompía cualquier JOIN entre `conversions` y `products` (dashboards, top sellers, reportes por categoría, etc.).

---

## Causa

El flujo de creación de conversiones (`conversion.service.js`) no resolvía el `producto_contratado_id` cuando el frontend mandaba solo el texto (caso típico en el "Nueva venta" rápido donde el gestor escribe el nombre del producto).

---

## Fix aplicado (2 partes)

### Parte 1 — Backfill de datos históricos

**Migración** `080_backfill_conversion_producto_id.sql` (ISEIE) / `081_backfill_conversion_producto_id.sql` (ISEIH):

- Para cada `conversion` con `producto_contratado_id IS NULL` y `producto_contratado IS NOT NULL`:
- Normaliza el texto (lowercase + sin acentos)
- Busca match exacto en `products` del mismo `project_id`
- Si el match es ÚNICO → rellena el FK
- Si hay 0 o varios matches → deja NULL (no adivinar)

**Garantías**:
- ✅ NO toca la tabla `products` (el WC sync sigue intacto)
- ✅ Idempotente (ejecutar 2 veces da el mismo resultado)
- ✅ Solo afecta filas con FK NULL (las ya rellenadas no se tocan)

**Resultado en producción**:

| CRM | Conv. totales | Con FK antes | Con FK ahora | Sin match |
|---|---|---|---|---|
| ISEIE | 13 | 0 | **13** ✅ | 0 |
| ISEIH | 282 | 1 | **255** ✅ | 27 |

Los 27 de ISEIH sin match son productos que se renombraron / borraron del catálogo WP — el texto en la conversión sigue siendo informativo pero sin FK. Decisión: **dejar NULL** para no hacer match equivocado.

### Parte 2 — Auto-lookup en creación de conversiones nuevas

**Modificado** `conversion.service.js → create()`:

Si llega `producto_contratado` (texto) sin `producto_contratado_id`, ejecuta el mismo lookup normalizado en `products` del proyecto. Si encuentra match único, rellena el FK antes de insertar.

```js
if (!data.producto_contratado_id && data.producto_contratado) {
  // Normalized match contra products del proyecto
  if (match.rows.length === 1) data.producto_contratado_id = match.rows[0].id;
  // Si ambiguo o 0 matches → deja NULL + log warning
}
```

**Garantías**:
- ✅ Si Brevo / WC sync / cualquier otro flujo está corriendo en paralelo: cero interferencia (solo lee `products`, no escribe).
- ✅ Si el lookup falla (DB error transitorio) → no bloquea la creación de la conversión, solo loggea warning.
- ✅ Si hay productos con el mismo nombre normalizado en el proyecto → deja NULL (mejor que adivinar mal).

---

## Verificación de no-regresión

- WC sync (cron 30min): sigue importando productos sin tocar `conversions` ni el backfill. ✅
- Endpoint `POST /api/conversions`: ahora siempre intenta resolver el FK. Si falla, comportamiento idéntico al anterior (queda NULL como antes). ✅
- Endpoint `GET /api/conversions`: idéntico. Los JOINs que ya estaban en el modelo ahora devuelven datos cuando antes daban NULL. ✅
- Dashboards: los `LEFT JOIN products` empiezan a devolver datos válidos. Lo veremos al construir EPIC G. ✅

---

## Próxima limpieza pendiente (no urgente)

Los 27 ISEIH sin match son texto libre que no coincide con ningún producto del catálogo actual:

```sql
-- Verlos:
SELECT id, project_id, producto_contratado FROM conversions
WHERE producto_contratado_id IS NULL AND producto_contratado IS NOT NULL;
```

Posibilidades:
- Producto renombrado en WP → el catálogo lo tiene con otro nombre. **Acción manual**: identificarlos y mapear uno a uno.
- Producto borrado del catálogo. **Acción**: dejar NULL (la conversión histórica se mantiene como dato muerto inalterable, lo correcto).

No es bloqueante para el Sprint 1. Se puede dejar para EPIC D (Ingresos / Cobrar) cuando trabajemos el listado completo de conversions.

---

## Cambios en este documento

- 2026-06-12 — Documento creado. Backfill ejecutado en producción ambos CRMs. Auto-lookup deployado.
