# Rediseño de comisiones — genericas + condiciones + aisladas

**Jira:** CRM-180
**Estado:** 📝 Backlog (alta prioridad)
**Tipo:** Refactor

## Contexto

La v1 de comisiones (CRM-129, ya implementada) requiere que el superadmin defina UNA regla por (gestor, producto). En la practica:
- Muchos gestores cobran el MISMO % independiente del producto
- Condiciones tipo "solo si importe > 500" no se pueden expresar
- Si un gestor trabaja en 2 proyectos, en el panel ve comisiones mezcladas (debe ser aislado)
- El calculo es siempre sobre `importe_pagado` (cobrado) sin opcion de hacerlo sobre `importe_total` (vendido)

## Alcance

- [ ] Regla GENERICA por (project_id, user_id, pct) sin necesidad de producto
- [ ] Regla con producto actua como OVERRIDE de la generica
- [ ] `base_calc` ENUM: `cobrado` o `vendido`
- [ ] `condicion` JSONB con operadores simples (>, <, =, entre, AND, OR)
- [ ] Aislamiento estricto por proyecto: en ISEIH no veo comisiones de Psiko
- [ ] Panel muestra KPIs: ventas brutas, netas, cobradas, por cobrar + comision sobre cada uno
- [ ] UI para armar condiciones sin SQL (operadores visuales)
- [ ] Migracion: reglas existentes mantienen producto_id; UI sugiere "fusionar" si varios tienen misma pct

## Modelo de datos

```sql
-- Migracion nueva (015 o siguiente)
ALTER TABLE commission_rules
  ADD COLUMN base_calc VARCHAR(20) NOT NULL DEFAULT 'cobrado' CHECK (base_calc IN ('cobrado','vendido')),
  ADD COLUMN condicion JSONB;

-- Cambiar product_id a nullable (generica) y ajustar UNIQUE
ALTER TABLE commission_rules ALTER COLUMN product_id DROP NOT NULL;

-- Drop UNIQUE actual (user_id, product_id)
ALTER TABLE commission_rules DROP CONSTRAINT uq_cr_user_product;

-- Nueva UNIQUE que acepta NULL como valor distinto
CREATE UNIQUE INDEX uq_cr_project_user_product
  ON commission_rules (project_id, user_id, COALESCE(product_id, 0));
```

**Prioridad de aplicacion en el hook:**
1. Regla con producto_id = producto_contratado_id → usar esa
2. Si no, regla generica (producto_id NULL) para ese gestor en ese proyecto
3. Si no hay ninguna → sin comision

## Ejemplo de condicion JSONB

```json
{
  "op": "AND",
  "rules": [
    { "field": "importe_total", "op": ">", "value": 500 },
    { "field": "fecha_conversion", "op": "between", "from": "2026-01-01", "to": "2026-06-30" }
  ]
}
```

## Endpoints afectados

- `POST /api/commissions/rules` — añade `base_calc`, `condicion`, `product_id` opcional
- `GET /api/commissions/me` — filtra estricto por project_id del proyecto activo
- `GET /api/commissions/stats` — añade ventas_brutas, ventas_netas, cobrado, por_cobrar
- Hook `createCommissionForConversion`:
  - Usa `base_calc` para decidir sobre que calcular
  - Evalua `condicion` antes de generar

## UI frontend

**Dialog de reglas rediseñado:**
```
┌───────────────────────────────────────────┐
│ Reglas de comision — Psiko Aprende        │
├───────────────────────────────────────────┤
│ NUEVA REGLA                               │
│ Gestor: [Laura Garcia ▾]                  │
│ Aplica a: (•) Todas las ventas            │
│           ( ) Solo producto: [select]     │
│ Calcular sobre: (•) Cobrado  ( ) Vendido  │
│ %: [15]                                    │
│ Condicion: [+] Añadir condicion           │
│   └─ importe_total > 500                  │
│ [Añadir regla]                             │
├───────────────────────────────────────────┤
│ REGLAS ACTIVAS                            │
│ • Laura — Todas — 15% sobre cobrado — >500│
│ • Carlos — Master Neuro — 20% sobre vendid│
└───────────────────────────────────────────┘
```

**Panel `/commissions` ampliado:**
```
┌─ KPIs del proyecto activo ─────────────────┐
│ Ventas brutas: 45,000 €                    │
│ Ventas netas:  42,000 € (3k refundidos)    │
│ Cobrado:       30,000 €                    │
│ Por cobrar:    12,000 €                    │
│                                            │
│ Comision generada: 4,500 €                 │
│   Pagada: 3,200 €                          │
│   Pendiente: 1,300 €                       │
└────────────────────────────────────────────┘
```

## Aislamiento por proyecto

- Hoy `/commissions` lista todas las comisiones del user. Debe filtrar estrictamente por el proyecto activo del sidebar.
- Si gestor cambia de proyecto → cambian sus comisiones visibles
- Superadmin puede ver "todos los proyectos" como opcion explicita

## Dependencias

- Prerequisito: CRM-178 (modulos configurables) ya que comisiones debe ser desactivable por proyecto
- Afecta: migracion de datos de CRM-129 sin perder reglas existentes

## AC

- [ ] Superadmin crea regla generica sin producto
- [ ] Superadmin crea override por producto que sobreescribe la generica
- [ ] Gestor en ISEIH no ve comisiones de Psiko
- [ ] Regla con condicion `> 500` no genera commission para ventas de 400
- [ ] `base_calc=vendido` → commission se calcula sobre importe_total desde el momento de crear conversion (no depende de pagos)

## Notas

- La v1 sigue funcionando mientras el refactor se ejecuta
- Migracion backward-compatible: las reglas con `product_id NOT NULL` siguen siendo validas como override
