# Sprint 1 — Finanzas (CRM ISEIE)

**Fecha**: 2026-06-11
**Owner**: Diego (full-stack)
**Stakeholder**: Manuel Casas (CEO, superadmin)
**Duración estimada**: 2–3 semanas
**Alcance**: solo CRM-ISEIE (single-project). Una vez validado, se replica a CRM-ISEIH multi-proyecto.

---

## 1. Estado actual (auditoría 2026-06-11)

### Backend — código existente
Ya hay 6 módulos en `backend/src/modules/` con controller, model, routes, validation:

| Módulo | Archivos | Estado |
|---|---|---|
| `conversions/` | controller, service, model, validation, installments, refunds | Maduro — único en uso real |
| `accounting/` | controller, model, routes, expense.validation | Esqueleto (probablemente dashboard agregador) |
| `expenses/` | controller, model, routes, validation | Esqueleto |
| `accounts-payable/` | controller, model, routes, validation | Esqueleto |
| `commissions/` | controller, model, routes, validation | Esqueleto |
| `payroll/` | controller, model, routes | Esqueleto (falta validation) |

### Frontend — código existente
7 módulos en `frontend/src/modules/`:
`accounting`, `accounts-payable`, `commissions`, `conversions`, `expenses`, `payroll`, `revenue`

### Sidebar
Todos los items de Finanzas marcados como **"PRÓX."** (no están en `BETA_ROUTES`):
- Dashboard, Ventas (ya activos)
- Ingresos (`/accounting/income`)
- Conversiones (`/accounting/conversions`)
- Egresos (`/expenses`)
- Cuentas por cobrar (`/accounting/receivable`)
- Cuentas por pagar (`/accounting/payable`)
- Comisiones (`/commissions`)
- Nóminas (`/payroll`)

### Base de datos — 12 tablas
| Tabla | Registros |
|---|---|
| conversions | 13 |
| conversion_payments | 13 |
| conversion_installments | 0 |
| conversion_refunds | 0 |
| expenses | 0 |
| accounts_payable | 0 |
| accounts_payable_payments | 0 |
| commissions | 0 |
| commission_rules | 0 |
| payroll_periods | 0 |
| payroll_plans | 0 |
| payroll_adjustments | 0 |

### Conclusión de la auditoría
- **Conversions** funciona en producción (13 ventas reales registradas)
- **El resto** son esqueletos sin datos — falta validar que el código existente funcione + UI/UX completa + flujos cruzados (ej. conversión → comisión automática)

---

## 2. Objetivos del Sprint 1

1. **Auditar** módulo por módulo: ¿qué pasa cuando un superadmin entra a `/expenses` hoy?
2. **Activar en BETA** los módulos que estén OK (quitar "PRÓX." del sidebar)
3. **Completar** los módulos que están a medias
4. **Conectar** los módulos entre sí: una conversión genera comisión automática; un periodo de nómina suma comisiones + ajustes
5. **Dashboard financiero** (`/accounting`) con KPIs cruzados: ingresos, egresos, cuentas por cobrar, comisiones pendientes, margen, P&L mensual
6. **Documentar** cada flujo para que Manuel pueda operar sin asistencia

---

## 3. Roadmap por épicas

### EPIC A — Auditoría y activación (2 días)
**Objetivo**: saber qué está vivo y qué no antes de tocar código nuevo.

A.1. Recorrer cada ruta del sidebar de Finanzas con superadmin y anotar:
- ¿Carga la página?
- ¿Carga datos? ¿Responde el endpoint?
- ¿Botones de crear/editar/eliminar funcionan?
- ¿Hay errores en consola?

A.2. Cross-check `service → model` en cada módulo (igual que hicimos hoy con leads):
funciones llamadas vs funciones exportadas. **Cualquier `is not a function` = 500 en producción**.

A.3. Quitar "PRÓX." del sidebar para los módulos que pasen A.1+A.2:
- Añadirlos a `BETA_ROUTES` en `betaConfig.ts`.

**Entregable**: tabla con estado por módulo + 1 commit "audit: finance modules — status sweep".

---

### EPIC B — Egresos / Gastos (3 días)
**Objetivo**: registrar gastos por proyecto/categoría con comprobante.

B.1. Verificar schema `expenses`: campos (importe, categoria, descripcion, fecha, proyecto, comprobante_url, creado_por).
B.2. Endpoint CRUD completo (`POST /expenses`, `GET /expenses?from=&to=&category=`, `PATCH`, `DELETE`).
B.3. Upload de comprobante (PDF/JPG/PNG) — usar el patrón de `documents.service.localStorage`.
B.4. Catálogo de **categorías de egreso** configurable (alquiler, sueldos, marketing, software, impuestos, otros).
B.5. UI: tabla con filtros (mes, categoría, proyecto), formulario de alta con drop de comprobante, edición inline del importe.
B.6. Export CSV mensual.

**Migración**: `XXX_expense_categories.sql` si no existe el catálogo.

---

### EPIC C — Cuentas por pagar (3 días)
**Objetivo**: facturas/compromisos pendientes de pagar — distinto a "egreso ya pagado".

C.1. Modelo: `accounts_payable (proveedor, concepto, monto, fecha_vence, estado, proyecto)`, `accounts_payable_payments (importe, fecha, metodo, referencia)`.
C.2. CRUD de la cuenta + registro de pagos parciales (puede ser pagado en cuotas).
C.3. Al registrar un pago: si total cubierto → estado `pagado`, crear `expense` automáticamente.
C.4. UI: tabla "Pendientes vs Pagadas", botón "Registrar pago", indicador de vencidos en rojo.
C.5. Alertas: facturas que vencen en < 7 días (notificación a superadmin).

---

### EPIC D — Conversiones e Ingresos (2 días)
**Objetivo**: completar lo que ya funciona en `conversions` con:

D.1. **Ingresos** (`/accounting/income`): listado de pagos recibidos (suma de `conversion_payments`), con filtro de fechas, método de pago, gestor.
D.2. **Cuentas por cobrar** (`/accounting/receivable`): conversiones con `importe_total > importe_pagado` (deuda activa) + recordatorios.
D.3. **Refunds**: ya existe `refunds.controller.js`. Validar que funcione y registrar como egreso negativo en P&L.
D.4. UI dashboard: ingresos del mes, cobrado vs pendiente, top gestores por facturación.

---

### EPIC E — Comisiones (3 días)
**Objetivo**: cuando un gestor cierra una venta → comisión automática según su regla.

E.1. Modelo `commission_rules`: `user_id, project_id (nullable), tipo (porcentaje|fijo), valor, periodo_yyyymm_desde`.
E.2. Calculadora: trigger al registrar `conversion_payment` → buscar regla aplicable → crear/actualizar `commissions(user_id, periodo_yyyymm, importe_calculado, importe_pagado, estado)`.
E.3. UI:
- Tabla de reglas por gestor (CRUD superadmin).
- Vista del gestor (`/commissions`): sus comisiones del mes (calculadas, pagadas, pendientes).
- Vista admin: por gestor + por proyecto + total a pagar este mes.
E.4. Botón "Marcar como pagado" → crea `expense` con categoría "comision".

---

### EPIC F — Nóminas (4 días)
**Objetivo**: salario base + comisiones + ajustes (bonus, deducciones) = recibo mensual.

F.1. Modelo `payroll_plans`: contrato por user (salario_base, periodicidad, divisa).
F.2. Modelo `payroll_periods` (yyyy-mm) + `payroll_adjustments` por user.
F.3. Generador: al cerrar el periodo → para cada user con plan activo, sumar `salary + commissions_pendientes + adjustments` → crear `accounts_payable` por gestor + `expense` cuando se marca pagado.
F.4. UI: configuración de planes, generación de periodo, vista de recibo individual (PDF).
F.5. Export Excel con todos los recibos del mes para banco.

---

### EPIC G — Dashboard Financiero (2 días)
**Objetivo**: vista consolidada para Manuel: P&L del mes en una pantalla.

G.1. Endpoint `GET /accounting/dashboard?from=&to=` que agrega:
- Ingresos (cobrado real del periodo)
- Egresos (suma `expenses` del periodo + comisiones marcadas pagadas + nóminas pagadas)
- Pendientes de cobrar (`accounts receivable`)
- Pendientes de pagar (`accounts payable`)
- Margen (ingresos − egresos)
- Top 5 categorías de gasto
- Histórico mensual (12 meses): ingresos vs egresos en barras

G.2. UI con Recharts: barras + tarjetas KPI + drilldown.
G.3. Export PDF para reuniones.

---

## 4. Fuera de alcance de Sprint 1

- Conciliación bancaria (importar movimientos de banco)
- Facturación a clientes (generar factura electrónica / Veri*Factu)
- Impuestos (IVA, IRPF) — solo se registran, no se calculan
- Multidivisa avanzada (solo EUR, USD si el plan lo requiere)
- Integración con software contable externo

Estos se valoran para Sprint 2 según prioridad.

---

## 5. Migraciones de DB previstas

Solo si faltan en el schema actual:

```
XXX_finance_expense_categories.sql
XXX_finance_commission_rules_periodo.sql
XXX_finance_dashboard_cache.sql  (opcional, si el dashboard tarda)
```

---

## 6. Convenciones específicas Finanzas

- **Divisa por defecto**: EUR. Las conversiones a otras divisas se guardan con su rate del día.
- **Decimales**: `numeric(12,2)` para importes. Nunca floats.
- **Fechas**: `fecha_*` siempre en `Europe/Madrid` para presentación (mismo principio que aplicamos en leads).
- **Soft-delete**: nunca borrar registros financieros — flag `deleted_at` para auditoría.
- **Inmutabilidad**: una vez registrado un pago, no se edita el importe — se crea un refund o un ajuste.

---

## 7. Cronograma estimado

| Semana | Épicas |
|---|---|
| 1 | A (auditoría) + B (egresos) + C (cuentas por pagar) |
| 2 | D (ingresos) + E (comisiones) |
| 3 | F (nóminas) + G (dashboard) + QA |

**Total estimado**: 19 días-persona ≈ 3 semanas a 1 dev full-time.

---

## 8. Criterio de aceptación general

Sprint 1 se considera cerrado cuando Manuel puede:
1. Registrar un gasto con comprobante desde el panel
2. Ver una cuenta por pagar y marcarla como pagada
3. Ver sus ingresos reales del mes vs comprometidos
4. Ver la comisión que generó cada gestor sin tocar SQL
5. Generar el recibo de nómina de un gestor y descargarlo en PDF
6. Ver el dashboard P&L con ingresos, egresos y margen del mes

---

## 9. Próximo paso

Empezar por **EPIC A — Auditoría** (2 días). Sin tocar código nuevo, solo verificar lo que ya hay. Esto se hará en una rama `feat/finanzas-sprint1` y los descubrimientos se anotarán al final de este documento en la sección **"Auditoría 2026-06-XX"**.

---

## 10. Cambios en este documento

- 2026-06-11 — Documento creado, plan inicial aprobado.
