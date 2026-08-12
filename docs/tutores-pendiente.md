# Tutores · lo que queda

Estado a 12 de agosto de 2026. El módulo está **en revisión en los dos staging**:
se dan de alta tutores, se les asignan cursos con su porcentaje y su fecha, y se
ve lo que les tocaría. **Todavía no genera dinero: todo es simulación.**

## Lo que ya funciona

- Alta de tutor con contraseña en el momento (sin depender de Brevo) y sus
  cursos asignados en el mismo formulario, cada uno con su fecha de inicio.
- Colaboraciones: crear, editar el porcentaje, poner fecha de fin, quitar. Si
  una colaboración ya generó comisiones no se borra, se desactiva.
- Simulación de lo que se pagaría en un periodo, por tutor y por curso.
- Pantalla del tutor: solo sus cursos y lo suyo. En el menú no ve nada más, y si
  teclea otra dirección va a parar a sus cursos.
- Arranque del módulo movible (`tutor_settings.aplica_desde`), hoy 01/08/2026.
- La base sale de los cobros reales (`conversion_payments`), nunca del campo
  `importe_pagado`.

## Falta construir

### 1 · El cálculo de verdad — sin esto no hay comisiones

`tutor_commissions` existe como tabla y **nadie escribe en ella**. No hay ningún
job en `backend/src/jobs/`. Hace falta un `tutorCommissionsScheduler` que
recorra los cobros sin comisión y las cree; el índice único `(payment_id,
tutor_id)` ya está puesto, así que pasar dos veces no duplica dinero.

Se hace reconciliando y no al vuelo a propósito: el disparo directo se pierde
los cobros de Stripe, los de cuotas y los borrados, y cuando falla lo hace en
silencio.

### 2 · Liquidar

No hay forma de marcar una comisión como pagada. Falta el estado
(`pendiente | pagada | revertida`), marcar en lote, y que quede quién liquidó y
cuándo. Es la pantalla que pedía el documento.

### 3 · Reembolsos

«Si se reembolsa, la comisión se revierte» **es imposible hoy**:
`conversion_refunds` no tiene `payment_id` y `charge.refunded` de Stripe
actualiza `stripe_payments` y ahí muere. Hay que construir el camino entero.

### 4 · Los pagos que no se pueden atribuir

Un panel donde se vean los cobros sin formación identificada, con su importe.
Si desaparecen, un agujero parece un cuadre.

### 5 · Cosas menores pero reales

- **Se puede asignar a un tutor un curso de otro proyecto.** No se valida.
  Salió al sembrar datos de prueba: un tutor dado de alta solo en ISEIH aceptó
  cursos de ICTESS sin rechistar.
- **La casilla `gestor_colaboraciones` no existe.** El controlador la comprueba
  (`tutor.controller.js:19`) pero no está en ninguna migración ni viaja en la
  sesión: hoy solo un admin gestiona tutores. O se crea o se quita del código.
- **El recorte del tutor es de pantalla, no de API.** Un tutor con sesión que
  pida `/api/sales/desglose` a mano todavía recibe datos. Es la fase 1 del plan.
- Exportar el panel de comisiones a Excel.
- Tests del módulo.

## Datos · esto sí bloquea el dinero

**Ventas sin atar al catálogo.** Si una venta no dice qué formación es, no se
sabe de quién es la comisión y el tutor no cobra por ella.

| | Ventas | Sin catálogo | Cobrado en agosto de esas ventas | Comisión que se pierde al 10 % |
|---|---|---|---|---|
| ISEIE | 507 | **272 (54 %)** | 1.347,34 € | **134,73 € al mes** |
| MultiCRM | 441 | 85 (19 %) | 133,33 € | 13,33 € al mes |

En ISEIE es más de la mitad del histórico. Mientras no se aten, el módulo nace
diciendo cifras cortas y nadie sabe cuánto falta.

**El campo `importe_pagado` no cuadra con los cobros**, y en sentidos opuestos:

| | Declara | Cobrado real | Diferencia |
|---|---|---|---|
| ISEIE | 468.274,46 € | 258.344,47 € | **+209.929,99 €** de más |
| MultiCRM | 116.864,12 € | 169.564,85 € | **−52.700,73 €** de menos |

Al módulo de tutores no le afecta —calcula desde los cobros—, pero **las
comisiones de las gestoras sí salen de ese campo** (`commission.model.js:186`).
En ISEIE eso son unos 21.000 € de comisiones sobre dinero que no entró; en
MultiCRM, al revés, se están quedando cortas.

## Decisiones que no son técnicas

- **Arranque en 01/08/2026** en los dos. Movible desde la pantalla.
- **10 % por defecto**, editable por curso.
- Quién puede liquidar: hoy, solo administradores.
- Qué se hace con las ventas sin catálogo del histórico: atarlas una a una,
  atar solo las de este año, o dejarlas fuera y decirlo.
