# Fase A.1 — Cross-check service → model en módulos de Finanzas

**Fecha**: 2026-06-12
**Modo**: read-only
**Objetivo**: detectar funciones que el `controller.js` / `service.js` llaman pero el `model.js` no exporta. Cada match así = `is not a function` = 500 en producción (lo que nos pasó hoy con `findByIdLight`).

---

## Resultado

| CRM | Módulo | Calls | Exports | Estado real | Comentario |
|---|---|---|---|---|---|
| ISEIE | accounting | 6 | 6 | ✅ OK | |
| ISEIE | accounts-payable | 8 | 8 | ✅ OK | |
| ISEIE | commissions | 8 | 10 | ✅ OK | 2 exports no usados (dead code, no bloquea) |
| ISEIE | conversions | 11 | 10 | ✅ OK | 2 calls aparentes eran cross-module a `commissionModel` (`createCommissionForConversion`, `recalculateCommission`) — están en `commissions/commission.model.js` líneas 141 y 209 |
| ISEIE | expenses | 5 | 5 | ✅ OK | |
| ISEIE | payroll | 13 | 14 | ✅ OK | 1 export no usado |
| ISEIE | sales | — | — | ✅ OK (otro patrón) | No tiene `model.js`. Lógica en `sales.goals.js` y `sales.service.js` directos. |
| ISEIH | accounting | 6 | 6 | ✅ OK | **Contiene también las rutas de expenses** (ver "Divergencia" abajo) |
| ISEIH | accounts-payable | 8 | 8 | ✅ OK | |
| ISEIH | commissions | 8 | 10 | ✅ OK | |
| ISEIH | conversions | 11 | 10 | ✅ OK | Misma razón que ISEIE |
| ISEIH | expenses | — | — | ⚠ DIVERGENCIA | **No existe** como módulo separado — las rutas viven dentro de `accounting/` |
| ISEIH | payroll | 13 | 14 | ✅ OK | |
| ISEIH | sales | — | — | ✅ OK (otro patrón) | |

**TL;DR**: cero `is not a function` esperando estallar. Cero bloqueos para arrancar épicas posteriores.

---

## Divergencia arquitectónica detectada (apuntar para B/C)

**Egresos / expenses**:

| | ISEIE | ISEIH |
|---|---|---|
| Módulo backend | `modules/expenses/` (controller, model, routes, validation, index) | **No existe.** Rutas dentro de `modules/accounting/accounting.routes.js` |
| Endpoint REST | `POST /api/expenses` | `POST /api/accounting/expenses` |
| Frontend ruta | `/expenses` | `/expenses` (la URL del sidebar es la misma) |
| Endpoint que llama el frontend | `/api/expenses` (probable) | `/api/accounting/expenses` (probable) |

**Implicación para EPIC B (Egresos)**:
- Hay que decidir si **unificamos** los dos patrones (mover todo a `expenses/` módulo aparte en ISEIH, o consolidar todo bajo `accounting/` en ISEIE) o **dejamos divergencia**.
- Recomendación: **dejar la divergencia y abstraer en frontend con un client API que apunte al endpoint correcto por CRM** — la refactorización del backend tomaría tiempo y no aporta valor de negocio.
- Concretar la decisión al arrancar EPIC B.

---

## 2 exports no usados (limpiar opcionalmente, no urgente)

**Por curiosidad**: las funciones del model que no se llaman desde ningún sitio. No son bug — pueden ser:
- Funciones experimentales que no llegaron a UI
- Funciones a usar por el dashboard P&L futuro
- Dead code real

No las quito ahora. Las dejaré en cola para limpieza al final del Sprint cuando ya esté todo conectado.

---

## Conclusión Fase A.1

✅ **Cero hallazgos críticos**. Los módulos backend de Finanzas están internamente consistentes en ambos CRMs.

⚠ **1 divergencia arquitectónica** (expenses) — decisión a tomar al arrancar EPIC B, no bloquea Fase A.

➡ Siguiente: **Fase A.2 — Smoke en producción** (recorrer cada ruta con superadmin real, anotar qué carga / qué falla / qué errores aparecen en `status_errors`).

---

## Cambios en este documento

- 2026-06-12 — Documento creado. Fase A.1 cerrada con 0 hallazgos críticos + 1 divergencia documentada.
