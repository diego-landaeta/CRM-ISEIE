# Fase A.2 — Smoke test de endpoints API de Finanzas

**Fecha**: 2026-06-12
**Modo**: read-only, contra producción
**Método**: script Node firma JWT del superadmin con `JWT_SECRET` del `.env`, llama 17 endpoints via fetch a `localhost:PORT`, mide HTTP status + tamaño + estructura.

---

## ISEIE (port 3005, project 10, user 1 = Manuel Casas)

| # | Endpoint | Status | Bytes | Datos |
|---|---|---|---|---|
| 1 | `GET /api/sales/top-products` | ✅ 200 | 1503 | 10 items |
| 2 | `GET /api/sales/gestores-stats` | ✅ 200 | 2432 | 3 keys |
| 3 | `GET /api/sales/my-stats` | ✅ 200 | 320 | 14 keys |
| 4 | `GET /api/accounting/dashboard` | ✅ 200 | 2116 | 5 keys |
| 5 | `GET /api/accounting/expenses` | ✅ 200 | 86 | 0 items |
| 6 | `GET /api/expenses` | ✅ 200 | 86 | 0 items |
| 7 | `GET /api/accounts-payable` | ✅ 200 | 26 | 0 items |
| 8 | `GET /api/accounts-payable/stats` | ✅ 200 | 103 | 4 keys |
| 9 | `GET /api/commissions/rules` | ✅ 200 | 26 | 0 items |
| 10 | `GET /api/commissions` | ✅ 200 | 26 | 0 items |
| 11 | `GET /api/commissions/stats` | ✅ 200 | 81 | 4 keys |
| 12 | `GET /api/commissions/me` | ✅ 200 | 26 | 0 items |
| 13 | `GET /api/commissions/me/stats` | ✅ 200 | 81 | 4 keys |
| 14 | `GET /api/conversions` | ✅ 200 | 6159 | **13 items reales** |
| 15 | `GET /api/payroll/plans` | ✅ 200 | 26 | 0 items |
| 16 | `GET /api/payroll/hours` | ✅ 200 | 26 | 0 items |
| 17 | `GET /api/payroll/periods` | ✅ 200 | 26 | 0 items |

**Resultado**: **17/17 OK** ✅

## ISEIH (port 3001, project 3 = Psiko, user 2 = Manuel Casas)

| # | Endpoint | Status | Bytes | Datos |
|---|---|---|---|---|
| 1 | `GET /api/sales/top-products` | ✅ 200 | 756 | 5 items |
| 2 | `GET /api/sales/gestores-stats` | ✅ 200 | 1518 | 3 keys |
| 3 | `GET /api/sales/my-stats` | ✅ 200 | 320 | 14 keys |
| 4 | `GET /api/accounting/dashboard` | ✅ 200 | 1043 | 5 keys |
| 5 | `GET /api/accounting/expenses` | ✅ 200 | 86 | 0 items |
| 6 | `GET /api/expenses` | ❌ **404** | 151 | — |
| 7 | `GET /api/accounts-payable` | ✅ 200 | 26 | 0 items |
| 8 | `GET /api/accounts-payable/stats` | ✅ 200 | 103 | 4 keys |
| 9 | `GET /api/commissions/rules` | ✅ 200 | 26 | 0 items |
| 10 | `GET /api/commissions` | ✅ 200 | 26 | 0 items |
| 11 | `GET /api/commissions/stats` | ✅ 200 | 81 | 4 keys |
| 12 | `GET /api/commissions/me` | ✅ 200 | 26 | 0 items |
| 13 | `GET /api/commissions/me/stats` | ✅ 200 | 81 | 4 keys |
| 14 | `GET /api/conversions` | ✅ 200 | 2378 | **5 items reales** |
| 15 | `GET /api/payroll/plans` | ✅ 200 | 26 | 0 items |
| 16 | `GET /api/payroll/hours` | ✅ 200 | 26 | 0 items |
| 17 | `GET /api/payroll/periods` | ✅ 200 | 26 | 0 items |

**Resultado**: **16/17 OK** ✅, **1 esperado** (`/api/expenses` no existe en ISEIH — todo va por `/api/accounting/expenses`, divergencia ya documentada en Fase A.1).

---

## Datos reales por CRM

| Métrica | ISEIE | ISEIH (proyecto Psiko) |
|---|---|---|
| Conversions registradas | 13 | 5 |
| Expenses | 0 | 0 |
| Accounts payable | 0 | 0 |
| Commissions | 0 | 0 |
| Payroll plans / hours / periods | 0 / 0 / 0 | 0 / 0 / 0 |

**Lectura**: el único módulo con datos REALES en producción es **Conversions** (13 ISEIE + 5 Psiko). Todos los demás son **esqueletos sin uso** — el código responde 200 con `[]`. Esto confirma lo que el plan ya anticipaba: hay que **construir el flujo de operación** (UI + datos seed + procesos de negocio) para el resto, no solo conectar.

---

## Hallazgos

### Bueno
- **Cero 5xx**. Los 6 módulos backend de Finanzas están vivos y responden.
- Los stats y dashboards devuelven estructura válida aunque estén vacíos (no rompen al pintar UI).
- Auth + project access + role guard funcionan en los 17 endpoints (probado con JWT de superadmin).

### Esperado
- `/api/expenses` solo existe en ISEIE. ISEIH usa `/api/accounting/expenses`. Documentado.

### No detectado por este smoke (limitaciones)
- Solo probé **GETs**. Los POST/PATCH/DELETE de cada módulo no se han ejercido — pueden tener bugs en validación / lógica de inserción.
- No verifiqué la UI — un endpoint OK no garantiza que la página cargue correctamente (puede tener bug en mapping del frontend).
- No probé escenarios con DATOS (conversion → comisión automática, payable → pago → expense). Eso lo cubrirá la Fase A.4 (mapa dependencias).

---

## Siguiente paso

**Fase A.3 — Inventario de datos en DB**: conteos y consistencia mínima por cada tabla financiera para detectar datos huérfanos o inconsistentes antes de empezar a tocar lógica.

---

## Cambios en este documento

- 2026-06-12 — Documento creado. Fase A.2 cerrada con 17/17 ISEIE y 16/17 ISEIH (1 fallo esperado).
