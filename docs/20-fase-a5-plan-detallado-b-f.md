# Fase A.5 — Plan detallado EPIC B–F + matriz de no-regresión

**Fecha**: 2026-06-12
**Cierra**: EPIC A — Auditoría
**Entrega**: hoja de ruta concreta para empezar a construir el lunes con archivos, líneas, migraciones numeradas y panel-por-panel qué NO tocar.

---

## 0. Estado consolidado tras Fases A.1 → A.4

| Fase | Hallazgo |
|---|---|
| A.1 | 0 hallazgos críticos. Solo divergencia: ISEIH usa `accounting/` para expenses, ISEIE módulo aparte |
| A.2 | 33/34 endpoints OK. Solo 404 esperado en ISEIH `/api/expenses` |
| A.3 | 295 conv reales (282 ISEIH + 13 ISEIE). 51K€ deuda activa ISEIH. 26 cuotas vencidas. `producto_contratado_id` → arreglado (fase intermedia) |
| A.4 | 3 hooks existentes (conversion→commission, conversion→email). 6 hooks faltantes mapeados |

**Listo para construir**. Empezamos con EPIC B.

---

## 1. EPIC B — Egresos / Gastos (3 días)

### Objetivo
Que Manuel pueda registrar gastos por proyecto con categoría + comprobante PDF/imagen + verlos en una tabla filtrable + exportarlos a CSV.

### Archivos a tocar

#### Backend (ambos CRMs)

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/migrations/082_expense_categories.sql` (ISEIE) / `082` (ISEIH) | **nuevo** | Tabla catálogo categorías. Seed: alquiler, sueldos, marketing, software, impuestos, **comision_pasarela_pago**, otros |
| `backend/migrations/083_expense_columns.sql` | **nuevo** | ALTER expenses ADD comprobante_url, comprobante_key, source_payable_id (UNIQUE), source_stripe_payout_id |
| `backend/src/modules/expenses/expense.service.js` (ISEIE) | **nuevo** | Mover lógica de controller a service. Hooks futuros (B0 fee Stripe, C payable→expense) |
| `backend/src/modules/expenses/expense.controller.js` | mod | Llamar a service, upload comprobante, manejar multer |
| `backend/src/modules/expenses/expense.model.js` | mod | Validar categoría contra tabla nueva. Añadir queries por categoría, por proyecto, por rango fecha |
| `backend/src/modules/expenses/expense.validation.js` | mod | Zod schema con categoría enum dinámico (cargado de DB) |
| `backend/src/modules/expenses/expense.routes.js` | mod | POST `/upload-comprobante` con multer + descarga `/comprobante/:id` |

#### Frontend (ambos CRMs)

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `frontend/src/modules/expenses/pages/ExpensesPage.tsx` | **nuevo** o refactor | Tabla con filtros mes/categoría/proyecto/responsable + botón "+ Nuevo egreso" + export CSV |
| `frontend/src/modules/expenses/components/ExpenseFormDialog.tsx` | **nuevo** | Form alta con dropzone comprobante + select categoría desde catálogo |
| `frontend/src/modules/expenses/components/ExpenseRowActions.tsx` | **nuevo** | Editar inline / eliminar (con confirm) |
| `frontend/src/modules/expenses/api/expenses.api.ts` | **nuevo** | Cliente axios con interceptor BASE_URL ya configurado |
| `frontend/src/shared/config/betaConfig.ts` | mod | Añadir `/expenses` a BETA_ROUTES (quitar el "PRÓX." del sidebar) |

#### ISEIH-only

Como ISEIH tiene expenses dentro de `accounting/`, hay 2 opciones:
1. **Migrar** ISEIH a módulo separado (riesgo: rompe frontend que llama `/api/accounting/expenses`)
2. **Respetar divergencia**: mantener ISEIH bajo `accounting/`, hacer los cambios ahí + tener el frontend usar `/api/accounting/expenses`

**Decisión**: opción 2 (respetar divergencia). Menor riesgo, mismo resultado de UX. El abstraction layer del frontend (`expenses.api.ts`) detecta el CRM y apunta al endpoint correcto:

```ts
const EXPENSES_ENDPOINT = import.meta.env.VITE_CRM_KIND === 'iseih'
  ? '/accounting/expenses'
  : '/expenses';
```

### Tareas (orden recomendado)

```
B.1  Migrations 082 + 083 (ambos CRMs) — verificar con dump pre-aplicación
B.2  Backend: refactor expense.service.js + endpoint POST/PATCH/DELETE/upload
B.3  Backend: tests vitest del service (insert con/sin comprobante, filtros)
B.4  Backend: deploy + smoke con curl
B.5  Frontend: api client + ExpensesPage + dialog
B.6  Frontend: build + deploy ambos CRMs
B.7  Activar en BETA_ROUTES (quitar "PRÓX." del sidebar)
B.8  Test manual end-to-end con superadmin
B.9  Merge a main + tag v-finanzas-epic-b
```

### Matriz de no-regresión EPIC B

| Panel | Cómo verifico que NO rompí | Si rompe → rollback |
|---|---|---|
| `/conversions` listado | smoke GET responde 200 con datos | revert commit del service |
| `/sales` dashboard | `top-products` sigue respondiendo | idem |
| `/accounting/dashboard` ISEIH | el card de "egresos del mes" debe sumar las nuevas filas | revisar query del dashboard |
| WC sync (cron 30 min) | logs PM2 sin errores nuevos en ese intervalo | sin riesgo (expenses no toca products) |
| Reminder scheduler | sin errores nuevos | sin riesgo |
| Email sequences | siguen disparando para `conversion_created` | sin riesgo |
| Listado de leads | sigue cargando sin cambios | sin riesgo |

---

## 2. EPIC C — Cuentas por pagar (3 días)

### Objetivo
Manuel pinta sus facturas pendientes, registra pagos parciales contra ellas, ve alertas de vencimiento, y cuando la factura queda al 100% pagada se crea un `expense` automáticamente.

### Archivos a tocar

#### Backend

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/migrations/084_payable_columns.sql` | **nuevo** | ALTER accounts_payable ADD source_payroll_period_id, source_user_id, categoria, alerta_dias_antes |
| `backend/src/modules/accounts-payable/payable.service.js` | **nuevo** | Hooks 3.3 (payable_payment 100% → expense) |
| `backend/src/modules/accounts-payable/payable.model.js` | mod | Query stats: total_pendiente, total_vencido, próximos a vencer |

#### Frontend

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `frontend/src/modules/accounts-payable/pages/AccountsPayablePage.tsx` | mod | Ya existe esqueleto. Pintar: tabla Pendientes vs Pagadas + chip vencido en rojo + botón pago |
| `frontend/src/modules/accounts-payable/components/PaymentDialog.tsx` | mod | Ya existe. Verificar formato 2 decimales + validación importe ≤ pendiente |
| `frontend/src/modules/accounts-payable/components/NuevaCuentaDialog.tsx` | **nuevo** | Alta de cuenta por pagar (proveedor, concepto, monto, vence, proyecto) |

#### Job nuevo

`backend/src/jobs/payableAlertScheduler.js` — corre diario a las 9:00 Madrid. Para cada cuenta sin pagar con `fecha_vence <= NOW() + INTERVAL '7 days'`:
- Crear notif in-app a admins (`notifyAdmins` ya existe)
- Email best-effort si Brevo configurado

### Tareas

```
C.1  Migration 084
C.2  payable.service.js con hook expense
C.3  payableAlertScheduler.js (nuevo job)
C.4  Frontend: NuevaCuentaDialog + tabla mejorada
C.5  Deploy backend + frontend ambos
C.6  Activar en BETA
C.7  Smoke + merge
```

### Matriz de no-regresión EPIC C

| Panel | Cómo verifico |
|---|---|
| Egresos (EPIC B) | nuevas filas auto desde payable cuando se completa pago — vista de egresos las muestra con tag "Auto" |
| Dashboard accounting | "cuentas por pagar pendientes" suma correcta |
| Scheduler de reminders | no se mezcla con payableAlert (timers distintos) |

---

## 3. EPIC D — Ingresos / Cuentas por cobrar (2 días)

### Objetivo
- Sacar a flote los **51K€ de deuda activa** en ISEIH con vista priorizada por vencimiento.
- Reconciliar los **5.680€ huérfanos** (cobrados sin `conversion_payment`).
- Identificar manualmente los **27 productos huérfanos** del backfill A.3.

### Archivos a tocar

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/src/modules/accounting/accounting.controller.js` | mod | Endpoint `GET /accounting/income` (ya usa conversions) — añadir filtros canal, gestor, rango |
| `backend/src/modules/accounting/accounting.controller.js` | mod | Endpoint `GET /accounting/receivable` — conv con deuda + cuotas vencidas |
| `backend/src/modules/conversions/refunds.controller.js` | mod | Hook 3.6: al crear refund llamar `commissionModel.recalculateCommission` |
| `backend/migrations/085_audit_conversions.sql` | **nuevo** | Job idempotente que detecta y loggea `conversions` donde `importe_pagado > SUM(conversion_payments.importe)`. NO modifica datos. |

### Frontend

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `frontend/src/modules/accounting/pages/IncomePage.tsx` | mod | Sigue usando `/conversions` pero añade filtros + breakdown por canal |
| `frontend/src/modules/accounting/pages/ReceivablePage.tsx` | mod | Resaltar vencidas + botón "Marcar cobrado" inline |
| `frontend/src/modules/accounting/components/ReconciliationDialog.tsx` | **nuevo** | Lista las conversiones con diferencia importe_pagado vs payments para arreglarlas a mano |

### Tareas

```
D.1  Migration 085 (audit query)
D.2  Endpoints income / receivable
D.3  Hook refund→commission
D.4  Frontend IncomePage + ReceivablePage
D.5  ReconciliationDialog para superadmin
D.6  Deploy
D.7  Manuel revisa las 27 huérfanas + arregla manualmente
D.8  Merge
```

### Matriz de no-regresión EPIC D

| Panel | Cómo verifico |
|---|---|
| Conversions list/create/edit | sin cambios — solo se añaden endpoints nuevos |
| Comisiones (EPIC E aún no construida) | hook refund→commission silencioso si no hay reglas |
| Dashboard sales | KPIs no cambian — solo dashboard accounting muestra los breakdowns nuevos |

---

## 4. EPIC E — Comisiones (3 días)

### Objetivo
Manuel define reglas por gestor (% del cobrado / % del facturado / fijo por venta). Cuando entra un pago, la comisión se calcula sola. Lista de comisiones pendientes vs pagadas por gestor y período.

### Archivos a tocar

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/migrations/086_commission_extensions.sql` | **nuevo** | ALTER commissions ADD pagada_at, payroll_period_id (UNIQUE para evitar doble cobro) |
| `backend/src/modules/commissions/commission.service.js` | **nuevo** | Mover hooks de model a service. Función `markAsPaid(userIds, periodo)` para EPIC F |
| `backend/src/modules/commissions/commission.model.js` | mod | Query nueva: `listForUserInPeriod(userId, yyyymm)` |

### Frontend

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `frontend/src/modules/commissions/pages/CommissionsPage.tsx` | mod | Ya existe. Pintar reglas + tabla de comisiones + filtros mes |
| `frontend/src/modules/commissions/components/RuleDialog.tsx` | **nuevo** | Crear/editar regla: gestor, proyecto, tipo (% facturado / % cobrado / fijo), valor, vigente desde |
| `frontend/src/modules/commissions/components/CommissionsGestor.tsx` | **nuevo** | Vista gestor: sus comisiones del mes (calculadas, pagadas, pendientes) |

### Tareas

```
E.1  Migration 086
E.2  commission.service.js + recalcular + markAsPaid
E.3  RuleDialog en frontend (CRUD reglas)
E.4  Lista de comisiones por gestor + admin
E.5  Backfill: para las 295 conversions ya cobradas, ¿queremos generar comisiones retroactivas?  → **decisión del usuario**: NO por defecto, solo a partir del momento de definir regla.
E.6  Deploy + smoke
E.7  Merge
```

### Matriz de no-regresión EPIC E

| Panel | Cómo verifico |
|---|---|
| Conversions (EPIC D ya OK) | sin cambios |
| Add payment (existing) | la llamada async a `createCommissionForConversion` no bloquea |
| Refund (hook 3.6 EPIC D) | recalculate funciona aunque la regla cambie |

---

## 5. EPIC F — Nóminas (4 días)

### Objetivo
- Definir plan de salario por gestor (`payroll_plans`)
- Al cerrar el mes (Manuel pulsa "Generar período"): para cada gestor calcular salario + comisiones + ajustes
- Generar `accounts_payable` por gestor (hook 3.4)
- Marcar las comisiones del mes como pagadas (hook 3.5)
- Recibo PDF descargable por gestor + export Excel para banco

### Archivos a tocar

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/migrations/087_payroll_extensions.sql` | **nuevo** | ALTER payroll_periods ADD generated_payable_ids INTEGER[], closed_at, paid_at |
| `backend/src/modules/payroll/payroll.service.js` | **nuevo** | Hooks 3.4 y 3.5. `closePeriod()` con todas las inserciones en transacción |
| `backend/src/modules/payroll/payroll-pdf.js` | **nuevo** | Generador del recibo individual (similar al RFC printTemplate) |
| `backend/src/modules/payroll/payroll-excel.js` | **nuevo** | Export del mes con columnas para banco (IBAN, importe, concepto) |

### Frontend

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `frontend/src/modules/payroll/pages/PayrollPage.tsx` | mod | Lista planes + período activo + botón "Generar mes" |
| `frontend/src/modules/payroll/components/PayrollPlanDialog.tsx` | **nuevo** | CRUD plan: user, salario_base, periodicidad, divisa |
| `frontend/src/modules/payroll/components/PeriodReviewDialog.tsx` | **nuevo** | Tabla previa al cierre: para cada gestor mostrar `base + comisiones + ajustes = total`, confirmación |
| `frontend/src/modules/payroll/components/RecibosList.tsx` | **nuevo** | Listado del período + descargar PDF + export Excel |

### Tareas

```
F.1  Migration 087
F.2  payroll.service.js con closePeriod transaccional
F.3  PDF + Excel generators
F.4  PayrollPlanDialog (1 día)
F.5  PeriodReviewDialog + close flow (1 día)
F.6  Test con datos seed
F.7  Deploy
F.8  Merge
```

### Matriz de no-regresión EPIC F

| Panel | Cómo verifico |
|---|---|
| Commissions (EPIC E) | comisiones del período se marcan como `pagada` y desaparecen de "pendientes" |
| Accounts Payable (EPIC C) | aparecen N filas nuevas (1 por gestor) con `source_payroll_period_id` |
| Egresos | NO debería crear expense automático aún — solo cuando se pague la `accounts_payable` (hook 3.3 EPIC C ya cubre) |
| Reminder scheduler | sin cambios |

---

## 6. EPIC G — Dashboard P&L (2 días)

### Objetivo
Vista consolidada para Manuel: ingresos − egresos + KPIs + histórico mensual.

### Archivos a tocar

| Archivo | Tipo | Qué hacer |
|---|---|---|
| `backend/src/modules/accounting/accounting.model.js` | mod | Función `getDashboardKPIs(projectId, from, to)` con CTE optimizadas |
| `backend/src/modules/accounting/accounting.controller.js` | mod | Endpoint `GET /accounting/dashboard?from=&to=` mejorado |
| `frontend/src/modules/accounting/pages/AccountingDashboardPage.tsx` | mod | Cards KPI + gráfico Recharts barras 12 meses + drilldown |

### Tareas

```
G.1  Backend: optimizar query (CTE con índices ya existentes)
G.2  Frontend: 6 cards + 1 gráfico
G.3  Export PDF del dashboard (reutilizar lógica RFC print)
G.4  Deploy
G.5  Merge → cierra Sprint 1 core
```

### Matriz de no-regresión EPIC G

| Panel | Cómo verifico |
|---|---|
| Sales dashboard | sin cambios — solo accounting dashboard se renueva |
| Performance | benchmark del endpoint: < 500 ms para 12 meses de datos. Si tarda más → cache 5 min |

---

## 7. Convenciones para todos los EPICs

### Commits
- Prefijo: `feat(epic-b/c/d/e/f/g):` o `fix(...)` o `docs(...)`
- Mensaje en español
- Co-author Claude
- **1 commit = 1 unidad lógica** (no mezclar migration + backend + frontend en uno)

### Migraciones
Cada migración nueva debe tener al pie:
```sql
-- ROLLBACK:
--   ALTER TABLE X DROP COLUMN Y;
--   -- O si es CREATE TABLE: DROP TABLE Z;
```

### Tests
Si el módulo tiene `tests/`, escribir al menos un test del service por cada hook nuevo.

### Deploy
- Backend: scp + pm2 restart (script que ya usamos)
- Frontend: vite build + tar + scp + unpack
- Verificación: HTTP 200 en /api/health + smoke del endpoint principal

### No tocar (en ninguna épica)

| Sistema | Razón |
|---|---|
| `leads/` y `clients/` | Crítico para captación, riesgo alto |
| `webhooks/`, `forms/`, `make/` | Pipeline de entrada de leads. Ya tuvimos bugs hoy. |
| `meta-ads/`, `google-ads/` | Integraciones externas con cuentas pagantes |
| `documents/` (excepto EPIC H futuro) | Se toca solo al final con Email policy |
| `auth/`, `users/`, `permissions/` | Cambios aquí afectan TODO |
| `wooCommerceSyncScheduler.js` | Importa productos cada 30 min. No tocar bajo ningún concepto. |

---

## 8. Cronograma con dependencias

```
Día 1-2:  EPIC B (Egresos)
Día 3-5:  EPIC C (Cuentas por pagar)  [usa hook con B]
Día 6-7:  EPIC D (Ingresos/Cobrar)
Día 8-10: EPIC E (Comisiones)  [refund hook con D]
Día 11-14: EPIC F (Nóminas)  [usa hooks con C, E]
Día 15-16: EPIC G (Dashboard)  [agrega todo lo anterior]
Día 17:   QA end-to-end + merge a main
Día 18-19: EPIC H (Email policy) opcional
Día 20-23: EPIC B0 (Stripe) opcional
```

Total: **17 días núcleo + 6 días extras** = 23 días-persona ≈ 5 semanas.

---

## 9. Criterio de "EPIC A cerrada"

✅ A.1 cross-check
✅ A.2 smoke API
✅ A.3 inventario DB
✅ A.4 mapa dependencias
✅ A.5 plan detallado (este doc)
✅ Hotfix `producto_contratado_id` aplicado en producción
✅ 27 leads Ana → Dayana reasignados (no era de EPIC A pero forma parte del cierre del día)

**EPIC A queda cerrada al mergear todos los `docs/15-20` a main. Esto ocurre antes de empezar EPIC B.**

---

## 10. Cambios en este documento

- 2026-06-12 — Documento creado. Plan detallado de EPIC B–F + matriz de no-regresión por épica. Cierra EPIC A.
