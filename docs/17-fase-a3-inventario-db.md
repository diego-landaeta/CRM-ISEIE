# Fase A.3 — Inventario de datos en DB (Finanzas)

**Fecha**: 2026-06-12
**Modo**: read-only sobre producción ambos CRMs.
**Objetivo**: saber qué hay en cada tabla financiera antes de tocar nada — conteos, rangos, consistencia, huérfanos.

---

## 1. Conteos por tabla

| Tabla | ISEIE | ISEIH | Notas |
|---|---|---|---|
| conversions | **13** | **282** | Único módulo en uso real |
| conversion_payments | **13** | **129** | 1:1 en ISEIE, menos en ISEIH (algunas conv sin cobrar todavía) |
| conversion_installments | 0 | **109** | Solo ISEIH usa pagos a cuotas |
| conversion_refunds | 0 | 0 | Nunca se ha procesado un refund |
| expenses | 0 | 0 | Sin uso |
| accounts_payable | 0 | 0 | Sin uso |
| accounts_payable_payments | 0 | 0 | Sin uso |
| commissions | 0 | 0 | Sin uso (regla nunca disparó) |
| commission_rules | 0 | 0 | Sin reglas configuradas |
| payroll_periods | 0 | 0 | Sin uso |
| payroll_plans | 0 | 0 | Sin contratos cargados |
| payroll_adjustments | 0 | 0 | Sin uso |

**Conclusión 1**: 9 de 12 tablas están vacías en ambos CRMs. La construcción de EPIC B en adelante arranca desde cero — no hay que migrar nada.

---

## 2. Conversions — el único módulo con datos reales

### ISEIE (proyecto único)

| Métrica | Valor |
|---|---|
| Total conversions | 13 |
| Rango fechas | 2026-05-27 → 2026-06-09 (14 días) |
| Total facturado | 13.776,35 € |
| Total cobrado | 8.704,35 € |
| **% cobrado** | **63 %** |
| Conv con deuda activa | 5 / 13 |
| Deuda pendiente | 5.072,00 € |
| Conv con `importe_total = 0` | 0 ✅ |
| Conv con `lead_id` huérfano | 0 ✅ |
| Conv con `producto_contratado_id = NULL` | **13 / 13** ❌ |

### ISEIH (multi-proyecto)

| Métrica | Valor |
|---|---|
| Total conversions | 282 |
| Rango fechas | 2025-07-30 → 2026-06-11 (10+ meses de operación real) |
| Total facturado | 91.351,96 € |
| Total cobrado | 40.250,55 € |
| **% cobrado** | **44 %** |
| Conv con deuda activa | **198 / 282** |
| **Deuda pendiente total** | **51.101,41 €** |
| Conv con `importe_total = 0` | 0 ✅ |
| Conv con `lead_id` huérfano | 0 ✅ |
| Conv con `producto_contratado_id = NULL` | **281 / 282** ❌ |

#### Por proyecto (ISEIH)

| Proyecto | Conversiones | Facturado € | Cobrado € | % cobrado |
|---|---|---|---|---|
| Psiko Aprende | 237 | 67.750,14 | 25.275,36 | 37 % |
| ICTESS | 21 | 8.075,15 | 7.801,95 | 97 % |
| ISEIH | 19 | 11.714,17 | 4.480,74 | 38 % |
| Fono Aprende | 5 | 3.812,50 | 2.692,50 | 71 % |
| AcademiaIA | 0 | 0 | 0 | — |

---

## 3. Conversion_payments

| Métrica | ISEIE | ISEIH |
|---|---|---|
| Total pagos | 13 | 129 |
| Pagos con importe 0/NULL | 0 ✅ | 0 ✅ |
| Pagos huérfanos (sin conversion) | 0 ✅ | 0 ✅ |
| Rango | 2026-05-27 → 2026-06-09 | 2025-11-21 → 2026-06-11 |
| Total cobrado | 8.704,35 € | 34.570,40 € |

⚠ **Discrepancia detectada en ISEIH**: el dashboard de conversions dice `SUM(importe_pagado) = 40.250,55 €` pero los pagos sumados dan `34.570,40 €`. Diferencia = **5.680,15 €** sin documento de pago asociado. Posibles causas:
- Conversiones inicializadas con `importe_pagado` > 0 sin crear `conversion_payment` (datos legacy o seed inicial).
- Bug histórico en la lógica de pagos.

**Acción para EPIC D**: investigar las conversiones donde `importe_pagado > 0` pero no hay registros en `conversion_payments`.

---

## 4. Conversion_installments (solo ISEIH)

| Métrica | Valor |
|---|---|
| Total cuotas | 109 |
| Cuotas con importe 0/NULL | 0 ✅ |
| Cuotas huérfanas (sin conversion) | 0 ✅ |
| Cuotas cobradas (`fecha_cobro IS NOT NULL`) | 6 |
| **Cuotas vencidas sin cobrar** | **26** ⚠ |
| Cuotas por vencer | 77 |

**Lectura**: 26 cuotas vencidas en producción sin cobrar = clientes en mora detectados. EPIC D (Cuentas por cobrar) tiene que sacarlas a flote en una vista de "Vencidos" prioritaria.

---

## 5. Hallazgo crítico — `producto_contratado_id` casi siempre NULL

| | ISEIE | ISEIH |
|---|---|---|
| Conv con producto_contratado_id | 0 / 13 | 1 / 282 |
| % con FK válido | 0 % | 0,35 % |

**Lo que sí está poblado**: la columna `producto_contratado VARCHAR(255)` (texto libre) con el nombre del programa.

**Implicaciones**:
- ❌ El dashboard P&L (EPIC G) no podrá hacer JOIN con `products` para sacar top-sellers reales.
- ❌ Si renombras un producto en `products`, las conversiones viejas no se actualizan.
- ❌ Reporte de comisiones por producto (EPIC E) tendría que usar texto que puede tener typos / variantes.
- ⚠ Hay 282 conversiones con el dato perdido. Reconstruir el FK exige un job que matchee `producto_contratado` (texto) con `products.nombre` y rellene `producto_contratado_id`.

**Acción para EPIC D**: job de **backfill** de `producto_contratado_id` por matching de nombre (con normalización de acentos/mayúsculas). Lo dejo planificado y lo ejecutamos en cuanto arranquemos D.

---

## 6. Conversiones con FK válido a `leads`

| | ISEIE | ISEIH |
|---|---|---|
| Conv con `lead_id` huérfano | 0 | 0 |

**Resultado**: 100% de las conversiones tienen lead vivo en la DB. ✅ No hay limpieza de FK pendiente por ese lado.

---

## 7. Resumen ejecutivo

| Riesgo | Severidad | Cobre en |
|---|---|---|
| `producto_contratado_id` casi siempre NULL | 🔴 Alto | EPIC D — backfill antes del dashboard |
| 5.680 € en ISEIH cobrados sin `conversion_payment` registrado | 🟠 Medio | EPIC D — auditar y normalizar |
| 26 cuotas vencidas sin cobrar en ISEIH | 🟠 Medio | EPIC D — vista "Vencidos" prioritaria |
| Tablas Egresos/Comisiones/Nóminas todas vacías | 🟢 Bajo | EPIC B/E/F arrancan desde cero, sin migración |
| Conv con importe 0 o sin lead | 🟢 Ninguno | 0 casos detectados |

---

## 8. Siguiente paso

**Fase A.4 — Mapa de dependencias entre módulos**: documentar qué triggers existen (y cuáles faltan) entre conversion_payment → commission, payable → expense, etc. Esto cierra la auditoría y deja el camino marcado para EPIC B/C/D/E/F sin sorpresas.

---

## Cambios en este documento

- 2026-06-12 — Documento creado. Fase A.3 cerrada.
