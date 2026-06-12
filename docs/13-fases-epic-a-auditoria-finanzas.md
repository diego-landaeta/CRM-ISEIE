# EPIC A — Auditoría de módulos de Finanzas (CRM ISEIE)

**Rama**: `feat/finanzas-sprint1`
**Modo**: read-only, sin tocar código de producción.
**Objetivo**: saber qué está vivo y qué no antes de construir encima. Evitar romper paneles que sí funcionan.
**Tiempo estimado**: 2 días.

---

## Principio de no-regresión

> Cada cambio futuro en Finanzas se prueba contra esta auditoría antes de hacer merge. Si un módulo pasaba en la baseline y deja de pasar tras un commit, se bloquea el merge.

---

## Módulos a auditar (7)

Por sidebar y código existente:

| # | Módulo | Ruta sidebar | Carpeta backend | Carpeta frontend |
|---|---|---|---|---|
| 1 | Dashboard Finanzas | `/sales` | `sales/` | `sales/` |
| 2 | Ventas (registro) | `/sales` | `sales/` | `sales/` |
| 3 | Ingresos | `/accounting/income` | `accounting/` | `accounting/` |
| 4 | Conversiones | `/accounting/conversions` | `conversions/` | `conversions/` |
| 5 | Egresos | `/expenses` | `expenses/` | `expenses/` |
| 6 | Cuentas por cobrar | `/accounting/receivable` | `accounting/` | `accounting/` |
| 7 | Cuentas por pagar | `/accounting/payable` | `accounts-payable/` | `accounts-payable/` |
| 8 | Comisiones | `/commissions` | `commissions/` | `commissions/` |
| 9 | Nóminas | `/payroll` | `payroll/` | `payroll/` |

(Stripe `/stripe` queda fuera, va a EPIC B0 al final.)

---

## Fases de la auditoría (5)

### Fase A.1 — Cross-check `service → model` (estático) ⏳

Para cada módulo: extraer todas las llamadas `*Model.X(...)` desde `controller.js` y `service.js`, y compararlas con las funciones exportadas del `model.js`. **Cualquier diff = 500 en producción** (es lo que ya nos pasó hoy con `findByIdLight`).

- [ ] Script de cross-check sobre los 9 módulos
- [ ] Tabla: módulo → calls → exports → faltantes
- [ ] **Entregable**: si hay faltantes, listarlos sin arreglarlos todavía (lo hacemos en cada épica correspondiente)

**Commit**: `docs(epic-a): A.1 cross-check service→model — N hallazgos`

---

### Fase A.2 — Smoke en producción (read-only) ⏳

Recorrer cada ruta con un user superadmin real (Manuel) y registrar:

- [ ] ¿Carga la página sin error?
- [ ] ¿El listado / dashboard carga datos? (count de filas o "sin datos")
- [ ] ¿Los botones principales abren su dialog / página? (no probamos crear/editar todavía — solo navegación)
- [ ] ¿Hay errores en `status_errors` de los últimos 30 días asociados al módulo?
- [ ] Captura del estado de la UI (1 screenshot por módulo)

**Entregable**: tabla módulo × {carga, datos, navegación, errores recientes}.

**Commit**: `docs(epic-a): A.2 smoke producción 9 módulos`

---

### Fase A.3 — Inventario de datos en DB ⏳

Por módulo, contar filas + verificar consistencia mínima:

```sql
-- ejemplo conversions
SELECT COUNT(*) total,
       COUNT(*) FILTER (WHERE importe_total IS NULL OR importe_total = 0) sin_importe,
       COUNT(*) FILTER (WHERE producto_contratado_id IS NULL) sin_producto,
       COUNT(*) FILTER (WHERE responsable_id IS NULL) sin_responsable,
       MIN(fecha_conversion), MAX(fecha_conversion)
FROM conversions;
```

Aplicar al equivalente en cada tabla.

- [ ] Conteos por módulo
- [ ] Datos huérfanos / inconsistentes detectados

**Commit**: `docs(epic-a): A.3 inventario datos DB`

---

### Fase A.4 — Mapa de dependencias entre módulos ⏳

Dibujar (en Markdown) qué módulo lee/escribe en qué tabla, y qué triggers hay entre ellos:

```
conversion_payment INSERT
  └─→ ¿dispara commission INSERT automático? (E.2 del plan)
  └─→ ¿actualiza accounts_receivable? (D.2)
```

- [ ] Diagrama Mermaid o ASCII de flujos
- [ ] Triggers / hooks existentes documentados
- [ ] Triggers que faltan (gaps a cubrir en B, C, D, E)

**Commit**: `docs(epic-a): A.4 mapa dependencias entre módulos finanzas`

---

### Fase A.5 — Plan detallado de las épicas B–F ⏳

Con los datos de A.1–A.4, refinar el plan de cada épica posterior con archivos:line específicos y migraciones concretas (no genéricas como están en `docs/10-plan-sprint1-finanzas.md`).

- [ ] Editar `docs/10` con detalles concretos por épica
- [ ] Lista de migraciones SQL ordenadas con su número exacto
- [ ] Lista de archivos backend/frontend a tocar por épica
- [ ] Lista de paneles del CRM que NO deben tocarse (para no romper)

**Commit**: `docs(epic-a): A.5 plan detallado épicas B-F + matriz de no-regresión`

---

## Cuándo deployar de esta épica

**Nada de A se deploya** — es 100% documentación. Las épicas siguientes (B en adelante) sí deployan según vayan saliendo.

## Convención de commits de esta épica

- `docs(epic-a): ...` para los 5 entregables
- Co-author: `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`

## Cambios en este documento

- 2026-06-12 — Documento creado en `feat/finanzas-sprint1`.
