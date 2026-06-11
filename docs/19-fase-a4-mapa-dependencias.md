# Fase A.4 — Mapa de dependencias entre módulos de Finanzas

**Fecha**: 2026-06-12
**Aplica a**: CRM ISEIE y CRM ISEIH (estructura idéntica salvo `expenses/` divergente)
**Objetivo**: documentar los hooks cross-module que **existen hoy** y los que **faltan** para cerrar el flujo financiero del Sprint 1.

---

## 1. Resumen ejecutivo

| Módulo | Hooks salientes (dispara otros) | Hooks entrantes (otros lo disparan) |
|---|---|---|
| **conversions** | 2 hooks → commissions + 1 → email-sequences | — |
| **commissions** | 0 (solo se le llama) | conversions (2 hooks) |
| **expenses** | 0 | 0 |
| **accounts-payable** | 0 | 0 |
| **payroll** | 0 | 0 |
| **sales** | 0 (consume read-only) | — |
| **accounting** | 0 | 0 |

**Conclusión cruda**: el ÚNICO módulo con hooks reales hoy es `conversions`. Todos los demás son **CRUDs aislados** que no se hablan entre sí. Esto es exactamente lo que toca conectar en EPIC B → F.

---

## 2. Hooks que SÍ existen hoy

### 2.1. `conversion.service.js → create()` (línea 59)

```js
const conv = await conversionModel.create({ ...data, changed_by: userId });

// Hook: crear comision automaticamente si hay regla
commissionModel.createCommissionForConversion(conv.id).catch(err =>
  logger.warn({ err: err.message, conversionId: conv.id }, 'createCommission failed (non-blocking)')
);

// Hook: disparar email sequences con trigger conversion_created
triggerSequences('conversion_created', data.lead_id, data.project_id);
```

**Funciona porque** `commissions/commission.model.js:141` exporta `createCommissionForConversion(conversionId)` que:
1. Busca la conversion + sus datos (lead, producto, importe)
2. Busca regla aplicable en `commission_rules` (por user_id, project_id, producto)
3. Si encuentra regla → INSERT en `commissions`
4. Si no encuentra regla → no hace nada (silencioso)

**Estado**: la cadena está cableada pero **no genera nada** porque `commission_rules` está vacío en ambos CRMs (0 reglas configuradas).

### 2.2. `conversion.service.js → addPayment()` (línea 102)

```js
const result = await conversionModel.addPayment(conversionId, data);
// Recalcular comision en cada pago (importe_base = importe_pagado actualizado)
commissionModel.recalculateCommission(conversionId).catch(err =>
  logger.warn({ err: err.message, conversionId }, 'recalculateCommission failed (non-blocking)')
);
```

Cuando llega un pago, recalcula la comisión existente con el nuevo `importe_pagado`. Útil para reglas tipo "comisión = 10% del cobrado" (no del facturado).

**Estado**: cableado, sin uso real (no hay reglas).

### 2.3. `conversion.service.js → triggerSequences()` (línea 8)

```js
async function triggerSequences(triggerEvent, leadId, projectId) {
  const { rows: seqs } = await query(
    `SELECT id FROM email_sequences WHERE project_id = $1 AND trigger_event = $2 AND active = true`,
    [projectId, triggerEvent]
  );
  for (const seq of seqs) await seqModel.startRun(seq.id, leadId);
}
```

Conecta `conversions` con el módulo **email-sequences** (no es finanzas estrictamente, pero relevante: al cerrar una venta puede arrancar la secuencia de bienvenida, post-venta, etc.).

**Estado**: funciona si hay secuencias activas con `trigger_event='conversion_created'`.

---

## 3. Hooks que FALTAN (gaps detectados)

Estos son los puentes que hay que cablear para que el CRM financiero funcione como un sistema, no como 6 CRUDs sueltos:

### 3.1. `conversion_payment INSERT → conversion.importe_pagado UPDATE`

**Hoy**: existe `conversionModel.addPayment(conversionId, data)` (línea 98) — usa una transacción, inserta en `conversion_payments` Y actualiza `conversions.importe_pagado` en el mismo BEGIN/COMMIT.

✅ **Ya funciona**, mantener intacto.

### 3.2. `conversion_payment INSERT → expense INSERT auto (fee Stripe)`

**Hoy**: NO existe. Cuando llegue Stripe (EPIC B0) cada cobro real generará un fee del 1.4% + 0.25€ que debe ser un `expense` con categoría `comision_pasarela_pago`.

**Acción**: añadir hook en `conversion.service.js → addPayment()` cuando `data.metodo_pago === 'stripe'`:
```js
if (data.metodo_pago === 'stripe' && data.stripe_fee_amount) {
  expenseService.create({
    project_id: conv.project_id,
    categoria: 'comision_pasarela_pago',
    importe: data.stripe_fee_amount,
    descripcion: `Fee Stripe pago #${result.payment_id}`,
    source_payment_id: result.payment_id,
  });
}
```

### 3.3. `accounts_payable_payment INSERT → expense INSERT cuando se completa`

**Hoy**: NO existe. Cuando se registra un pago contra una factura por pagar y el monto cubierto llega al 100%, debería generarse un `expense` con la categoría correspondiente (alquiler, sueldos, software…).

**Acción**: nuevo `payable.service.js` (hoy ni siquiera existe) con:
```js
export async function addPayment(payableId, data) {
  const result = await payableModel.addPayment(payableId, data);
  if (result.estado === 'pagado') {
    expenseService.create({
      project_id: result.project_id,
      categoria: result.categoria,
      importe: result.monto_total,
      descripcion: `Pago factura "${result.concepto}" (cuenta por pagar #${payableId})`,
      source_payable_id: payableId,
    });
  }
  return result;
}
```

### 3.4. `payroll_period CLOSE → accounts_payable INSERT por gestor`

**Hoy**: NO existe. Al cerrar un período de nómina (POST `/payroll/periods/:id/close`) debería generarse una `account_payable` por cada gestor con su salario + comisiones + ajustes del período.

**Acción**: nuevo `payroll.service.js` (hoy ni siquiera existe) con:
```js
export async function closePeriod(periodId, userId) {
  const period = await payrollModel.closePeriod(periodId, userId);
  for (const userPay of period.users) {
    const total = userPay.salario_base + userPay.comisiones - userPay.adjustes_negativos + userPay.ajustes_positivos;
    await payableService.create({
      project_id: null,  // nómina es global
      proveedor: userPay.nombre,
      concepto: `Nómina ${period.yyyymm} para ${userPay.nombre}`,
      monto: total,
      fecha_vence: period.fecha_pago,
      source_payroll_period_id: periodId,
      source_user_id: userPay.user_id,
    });
  }
}
```

### 3.5. `payroll_period CLOSE → commission UPDATE marcar pagada`

**Hoy**: NO existe. Al pagar la nómina del mes, las comisiones que se incluyeron en ese cálculo deben quedar marcadas como `pagada` en `commissions.estado` para no contarse 2 veces el mes siguiente.

**Acción**: dentro del mismo `closePeriod`:
```js
await commissionModel.markAsPaid({
  user_ids: userIds,
  periodo_yyyymm: period.yyyymm,
  payroll_period_id: periodId,
});
```

### 3.6. `conversion_refund INSERT → commission UPDATE descontar`

**Hoy**: NO existe. Cuando se procesa un refund (parcial o total) la comisión ya generada debería ajustarse o cancelarse según la regla.

**Acción**: hook en `refunds.controller.js → create()`:
```js
commissionModel.recalculateCommission(conversionId);  // recalcula con el nuevo importe_pagado neto
```

### 3.7. `expense INSERT → notif al superadmin si > umbral`

**Hoy**: NO existe. Para gastos grandes (>500€ p.ej.) sería útil avisar al CEO.

**Acción** (opcional, no crítico): hook en `expense.service.js → create()`:
```js
if (importe > UMBRAL_NOTIF) {
  notifyAdmins({
    type: 'expense_high',
    title: `Gasto alto registrado: ${importe}€`,
    message: descripcion,
    link_path: `/expenses/${exp.id}`,
  });
}
```

### 3.8. `dashboard accounting → cache si lento`

**Hoy**: cada GET `/api/accounting/dashboard` agrega tablas vivas. Con 282 conv en ISEIH ya tarda un poco. Cuando llegue a 1000+ con joins de expenses, payable, commissions → será lento.

**Acción**: materialized view o cache 5 min en Redis. **No urgente** — solo si la métrica de latencia lo justifica al final del Sprint.

---

## 4. Diagrama del flujo objetivo (post-Sprint 1)

```mermaid
graph TB
    subgraph CRM
        L[lead]
    end

    subgraph Ingresos
        C[conversion]
        CP[conversion_payment]
        CI[conversion_installment]
        CR[conversion_refund]
    end

    subgraph Comisiones
        CRL[commission_rules]
        CM[commission]
    end

    subgraph Egresos
        E[expense]
        EC[expense_categories]
    end

    subgraph Cuentas
        AP[accounts_payable]
        APP[accounts_payable_payment]
    end

    subgraph Nómina
        PP[payroll_plan]
        PE[payroll_period]
        PA[payroll_adjustment]
    end

    subgraph Dashboard
        D[/accounting/dashboard]
    end

    L -->|convierte| C
    C -->|trigger 2.1| CRL
    CRL -->|trigger 2.1| CM
    C --> CP
    C --> CI
    C --> CR
    CR -->|trigger 3.6| CM
    CP -->|trigger 3.2 si Stripe| E
    APP -->|trigger 3.3 cuando pagado| E
    PE -->|trigger 3.4 al cerrar| AP
    PE -->|trigger 3.5 al cerrar| CM
    AP --> APP
    PP --> PE
    PA --> PE
    EC --> E

    CP --> D
    E --> D
    CM --> D
    AP --> D
```

**Leyenda**:
- Flechas con "trigger N.N" → hooks documentados arriba (verde = existe, faltantes = a construir)
- Tablas en cajas = grupos del esquema DB

---

## 5. Mapeo épicas → hooks que cubren

| Hook | Sprint | Épica que lo construye | Riesgo |
|---|---|---|---|
| 2.1 conversion→commission auto | Existe | ✅ ya cableado | — |
| 2.2 payment→commission recalc | Existe | ✅ ya cableado | — |
| 2.3 conversion→email sequence | Existe | ✅ ya cableado | — |
| 3.1 payment→importe_pagado UPDATE | Existe | ✅ ya cableado | — |
| 3.2 stripe payment→expense fee | Sprint 1 | **EPIC B0** (Stripe) | Bajo (cableado simple) |
| 3.3 payable payment→expense | Sprint 1 | **EPIC C** (Cuentas por pagar) | Bajo |
| 3.4 payroll close→payable por gestor | Sprint 1 | **EPIC F** (Nóminas) | Medio (genera filas masivas) |
| 3.5 payroll close→commission paid | Sprint 1 | **EPIC F** (Nóminas) | Medio (afecta cálculo del mes siguiente) |
| 3.6 refund→commission ajustar | Sprint 1 | **EPIC D** (Ingresos/Cobrar) | Bajo |
| 3.7 expense alto→notif superadmin | Opcional | **EPIC B** o saltable | Ninguno |
| 3.8 cache dashboard | Opcional | **EPIC G** o Sprint 2 | Ninguno hasta que duela |

**Total hooks faltantes**: **6** (3 ya existen).

---

## 6. Servicios que faltan crear

| Archivo | Existe hoy | Necesario en | Razón |
|---|---|---|---|
| `expenses/expense.service.js` | ❌ | EPIC B | Hoy todo está en controller — sin lugar para hooks |
| `accounts-payable/payable.service.js` | ❌ | EPIC C | Idem |
| `payroll/payroll.service.js` | ❌ | EPIC F | Idem |
| `commissions/commission.service.js` | parcial (en model) | EPIC E | Mover lógica fuera del model |

Patrón a seguir: **controller solo HTTP, service la lógica de negocio + hooks, model solo queries**. Es el patrón que ya usan `conversions/` y `leads/`. Aplicarlo al resto.

---

## 7. Riesgos a controlar al implementar hooks

| Riesgo | Mitigación |
|---|---|
| Un hook falla → bloquea la acción principal (ej. crear conversion falla por error en commissions) | `.catch(err => log.warn)` — pattern ya usado en conversion.service. Hook async, fire-and-forget. |
| Doble ejecución (ej. cerrar período de nómina 2 veces) | Idempotencia: `INSERT ... ON CONFLICT DO NOTHING` o flag `closed_at IS NOT NULL` |
| Trigger circular (commission → recalc → commission) | Hooks unidireccionales, sin recursión. Documentar el grafo. |
| Pago contra cuenta por pagar genera expense duplicado | Columna `source_*_id` en expenses con UNIQUE constraint |
| Refund recalcula comisión ya pagada en nómina | Si commission está `pagada` → no recalcular, registrar ajuste manual al mes siguiente |

---

## 8. Cambios en este documento

- 2026-06-12 — Documento creado. Fase A.4 cerrada con 3 hooks existentes + 6 faltantes mapeados.
