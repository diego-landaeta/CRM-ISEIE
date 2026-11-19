Tres cosas que cambiaron en noviembre y que evitan las ventas y los cobros apuntados dos veces: el aviso de venta repetida, cómo se saldan las cuotas y cómo se enlaza un cargo de Stripe con su cobro.

## 1. El aviso de venta repetida

Al registrar una venta (en Ventas, «Registrar venta», o en la ficha del prospecto, «Registrar conversión»), el CRM mira si ese alumno ya tiene una venta **del mismo programa en el mismo campus**. Cuenta como el mismo alumno el mismo prospecto, el mismo correo o el mismo nombre (sin mirar tildes ni mayúsculas). Si la encuentra, no crea nada y te enseña:

- **«Este alumno ya tiene una venta de este programa»**, con su total, lo cobrado y lo pendiente.
- Un enlace **«Ver esa venta»**.

Y te deja elegir:

1. **«Apuntar el cobro en esa venta»**: lo normal. Si lo que ibas a apuntar es una cuota o un pago más de la misma compra, va en la venta que ya existe. Se abre su cobro.
2. **«Crear otra venta igualmente»**: solo si el alumno ha comprado el programa **otra vez**. Queda apuntado quién lo decidió.

> [!aviso] La segunda cuota de un alumno **no es una venta nueva**. Si la apuntas como venta, el alumno sale con dos compras y la gestora con dos ventas.

En Ventas, la tarjeta **«Posibles repetidas»** (cerrada al entrar) junta las ventas que parecen la misma compra, con un enlace a cada una, para revisarlas. Las que se crearon con «Crear otra venta igualmente» no salen ahí.

## 2. Las cuotas se saldan en orden

Cada cobro de una venta salda **la siguiente cuota pendiente**, por número, con la fecha, el importe y el método del cobro. Da igual cómo entre el cobro: a mano, por Stripe, por un link de pago, por PayPal o por el extracto del banco.

- Un cobro con céntimos de diferencia (redondeo, cambio de moneda) salda la cuota con lo que entró.
- Un cobro que paga dos cuotas salda las dos.
- Un cobro que no llega salda la cuota **en parte**: la cuota se parte en lo cobrado y en el resto, que sigue pendiente con una nota.
- La matrícula o el pago inicial se saldan con los primeros cobros que caben enteros.

### Al pulsar «Registrar pago» en una cuota

- Si los cobros que ya tiene la venta pagan esa cuota, el CRM la marca pagada y te dice con qué cobro: **«Esta cuota ya está pagada»**. No apunta nada más.
- Si hay un **cargo de Stripe sin enlazar** de ese alumno por ese importe, o si la venta se cobraría de más, te pregunta antes: **«¿Apuntarlo igualmente?»**. Casi siempre la respuesta es **no**: el pago ya entró por Stripe y lo que hay que hacer es enlazarlo (punto 3).

## 3. Cargos de Stripe sin enlazar

A veces un cobro se apuntó a mano (con otro importe o con otra fecha) y luego entra el mismo pago por Stripe. Si se asociara tal cual, el alumno saldría pagando dos veces y se le haría otra factura.

En la ficha de la venta, la tarjeta **«Cargos de Stripe sin enlazar»** enseña los pagos de Stripe de ese alumno que todavía no están unidos a ningún cobro. Solo sale si hay alguno, y la usa quien tiene el permiso «Asociar pagos de Stripe».

1. En cada cargo, elige **el cobro al que corresponde** («Elige el cobro de este pago…»). Sale marcado el más parecido: mismo importe y fecha más cercana. Si el cobro tiene factura, se ve al lado.
2. Pulsa **«Enlazar»**.

El cargo queda unido a ese cobro y a su factura. **No se crea otro cobro ni otra factura**, y el importe del cobro no cambia.

> [!aviso] Si la ficha dice que los pagos **suman más que la venta**, revísalo antes de enlazar nada: suele ser un cobro apuntado dos veces o un importe mal puesto.

## 4. Si algo no cuadra

- Una venta repetida que ya existe: no la borres tú. Avisa a tu admin con las dos ventas; él decide cuál se queda y mueve los cobros.
- Un cobro apuntado dos veces con factura: la factura emitida no se borra (ver [Facturas emitidas: se anulan, no se borran](tutorial:anular-factura)).
