# Panel de comisiones (v1)

**Jira:** CRM-129 + CRM-135..138
**Estado:** ✅ Implementado (v1, sera rediseñado por CRM-180)
**Tipo:** Feature

## Contexto

Psiko Aprende llevaba las comisiones de sus gestoras en un HTML estatico que se actualizaba manualmente. Cada venta cerrada generaba un calculo a mano de la comision a pagar. Esta v1 automatiza el flujo: regla por gestor+producto, y al crear una conversion se genera automaticamente la comision.

**Rediseño pendiente en CRM-180** (ver `20-rediseno-comisiones.md`) para hacerlas genericas por gestor, con condiciones configurables y aisladas estrictas por proyecto.

## Alcance v1

- [x] Reglas `commission_rules` con UNIQUE (user_id, product_id)
- [x] Hook en conversion.create → genera commission si hay regla
- [x] Hook en addPayment → recalcula proporcional al cobrado
- [x] Panel `/commissions` con 3 vistas segun rol:
  - Superadmin: todo + boton "Reglas" para CRUD
  - Admin: todo + boton "Pagar"
  - Gestor: solo las suyas
- [x] Filtros: estado (pendiente/pagado), gestor (solo admin)
- [x] KPIs: total generado, pagado, pendiente, cantidad

**No incluye (viene en CRM-180):**
- Regla generica por gestor (sin producto)
- base_calc configurable (cobrado vs vendido)
- Condiciones JSONB
- Aislamiento estricto por proyecto en la UI

## Modelo de datos

```sql
-- Migracion 011
CREATE TABLE commission_rules (
  id SERIAL PRIMARY KEY,
  project_id INT NOT NULL REFERENCES projects(id),
  user_id INT NOT NULL REFERENCES users(id),
  product_id INT NOT NULL REFERENCES products(id),
  pct DECIMAL(5,2) NOT NULL CHECK (pct >= 0 AND pct <= 100),
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (user_id, product_id)
);

CREATE TABLE commissions (
  id SERIAL PRIMARY KEY,
  conversion_id INT UNIQUE NOT NULL REFERENCES conversions(id),
  rule_id INT REFERENCES commission_rules(id),
  user_id INT NOT NULL REFERENCES users(id),
  product_id INT REFERENCES products(id),
  importe_base DECIMAL(12,2) NOT NULL,
  pct DECIMAL(5,2) NOT NULL,
  importe_comision DECIMAL(12,2) NOT NULL,
  estado VARCHAR(20) CHECK (estado IN ('pendiente','pagado','cancelado')),
  fecha_pago DATE,
  notas TEXT
);

-- Migracion 012
ALTER TABLE conversions ADD COLUMN producto_contratado_id INT REFERENCES products(id);
```

## Endpoints backend

| Metodo | Path | Auth | Descripcion |
|---|---|---|---|
| GET | `/api/commissions/rules` | admin | Lista reglas |
| POST | `/api/commissions/rules` | superadmin | Crea regla (ON CONFLICT actualiza pct) |
| PATCH | `/api/commissions/rules/:id` | superadmin | Edita pct o active |
| DELETE | `/api/commissions/rules/:id` | superadmin | Elimina regla |
| GET | `/api/commissions/me` | any | Mis comisiones |
| GET | `/api/commissions/me/stats` | any | KPIs propios |
| GET | `/api/commissions` | admin | Todas |
| GET | `/api/commissions/stats` | admin | KPIs globales |
| PATCH | `/api/commissions/:id/pay` | admin | Marca pagada |
| POST | `/api/commissions/recalculate/:conversionId` | admin | Fuerza recalculo |

## UI frontend

- Pagina `/commissions` — `frontend/src/modules/commissions/pages/CommissionsPage.jsx`
- Dialog de reglas embebido (solo superadmin)
- Bajo grupo "Contabilidad" en sidebar (CRM-170)

## Hooks automaticos

En `backend/src/modules/conversions/conversion.service.js`:
- Al `create`: busca regla `user_id = responsable` AND `product_id = producto_contratado_id`, si existe crea commission
- Al `addPayment`: llama `recalculateCommission(conversionId)` que actualiza `importe_base = importe_pagado` e `importe_comision = base × pct / 100`

## Tests

- Manual QA: crear regla, crear conversion → aparece commission con base=0 (no pagado), añadir payment → commission recalcula

## Lecciones aprendidas

- La columna `producto_contratado_id` no existia inicialmente en conversions (solo `producto_contratado` string). Requirio migracion 012.
- Hook `recalculateCommission` es idempotente gracias al UNIQUE en `commissions.conversion_id` + ON CONFLICT UPDATE.
