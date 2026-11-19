Con un link de pago, el alumno paga con tarjeta desde su móvil o su ordenador, sin que tengas que entrar en Stripe. Los links de pago están encendidos en ISEIE, con su clave de Stripe ya puesta. Las capturas son del entorno de pruebas del CRM gemelo y llevan datos inventados: en ISEIE la tarjeta es la misma.

## 1. Dónde está

La tarjeta **«Links de pago»** está en dos sitios, y funciona igual en los dos:

- En la **ficha del prospecto** (Prospectos › abre el prospecto).
- En la **ficha de la venta** (Ventas › abre la venta).

Solo ves los prospectos y las ventas que son tuyos.

![La tarjeta Links de pago dentro de la ficha de un prospecto de prueba](g1-ficha-prospecto.webp "La ficha de un prospecto de prueba. La tarjeta «Links de pago» enseña los links que se le han mandado.")

> [!aviso] Si no ves la tarjeta, tu usuario no tiene el permiso «Crear links de pago». Pídeselo a tu coordinadora.

## 2. Crear un link

1. En la tarjeta, pulsa **«Crear link de pago»**.
2. **Curso:** elige el curso del catálogo. Sale ya elegido el del prospecto o el de la venta.
3. **Importe:** desde el prospecto se rellena con el precio del catálogo; desde una venta, con **lo que queda por pagar** de esa venta. Puedes cambiarlo, pero solo hasta el descuento máximo de tu campus.
4. **Moneda:** normalmente EUR. Si tu campus admite otras, puedes elegirla aquí.
5. **Caduca a los (días):** cuántos días podrá pagarlo el alumno. Sale 7. Puedes poner menos o más, hasta el máximo que indica.
6. Pulsa **«Crear link»**.

![Ventana Crear link de pago con curso, importe, moneda y caducidad](g3-dialogo-crear.webp "La ventana para crear el link: curso, importe, moneda y caducidad.")

### El descuento

El campus tiene un **descuento máximo**. Desde el prospecto se mide sobre el precio del catálogo; desde una venta, sobre lo que queda por pagar. Al empezar es **0 %**: solo el admin puede hacer descuento. Si bajas el importe más de lo permitido, la ventana te avisa en rojo y el botón «Crear link» no se puede pulsar.

![Aviso de descuento por encima del máximo con el botón Crear link desactivado](g4-dialogo-descuento.webp "Con un importe más bajo de lo permitido, avisa del descuento y no deja crear el link.")

> Si un alumno necesita un precio especial, pídeselo a tu admin: él puede crear el link con el descuento.

### Si el alumno paga a plazos

Cada link es **un solo pago**. Para cobrar una cuota con un link, el link tiene que ser por el importe de esa cuota, que es menos de lo que queda por pagar. Con el descuento en 0 %, ese link lo crea el admin. Cuando el alumno lo paga, el cobro salda **la siguiente cuota pendiente** de la venta (ver [Ventas, cuotas y cargos de Stripe](tutorial:ventas-y-cuotas)).

## 3. Copiarlo y enviarlo

1. Al crearlo, la ventana te enseña el link (empieza por `https://buy.stripe.com/`).
2. Pulsa **«Copiar»**. Verás el aviso «Link copiado».
3. Pégalo en el **WhatsApp** o en el **correo** del alumno (Ctrl + V, o mantener pulsado en el móvil y «Pegar»).
4. Dile cuántos días tiene para pagarlo.

Mientras el link siga pendiente, tienes el botón **«Copiar»** también en la lista de la tarjeta, por si tienes que volver a mandarlo.

> [!ok] **Ejemplo de mensaje:** «Hola, Marta. Te paso el enlace para pagar la matrícula del curso: (pega aquí el link). Puedes pagar con tarjeta hasta el día 25. Cualquier duda, me dices.»

## 4. En qué estado está

En la tarjeta salen todos los links del alumno, del más nuevo al más antiguo. Cada uno dice quién lo creó, cuándo y cuándo caduca.

| Estado | Qué significa | Qué puedes hacer |
|---|---|---|
| **Pendiente** | El link está vivo y el alumno aún no ha pagado. | Copiarlo otra vez o anularlo. |
| **Pagado** | El alumno ya pagó. Sale solo, con la fecha del pago, en cuanto el cobro entra en el CRM. | Nada: el cobro y la venta se apuntan solos (punto 6). |
| **Caducado** | Pasaron los días y no pagó. El link ya no funciona. | Crear uno nuevo si el alumno sigue interesado. |
| **Anulado** | Alguien lo anuló. Se ve quién y por qué. | Crear uno nuevo si hace falta. |

Si el alumno abre un link caducado o anulado, Stripe le dice que ya no está disponible y que pida uno nuevo a quien le atiende.

> [!aviso] El link pasa a «Pagado» **unos minutos después** de que el alumno pague, no en el mismo segundo. Si el alumno te dice que acaba de pagar y aún sale «Pendiente», espera unos minutos y recarga la ficha antes de mandarle otro link.

## 5. Anular un link

Anula un link si te equivocaste de curso o de importe, o si el alumno ya no lo va a pagar.

1. En la tarjeta, en el link pendiente, pulsa **«Anular»**.
2. Escribe el motivo (por ejemplo, «me equivoqué de curso»).
3. Pulsa **«Anular link»**.

![Ventana para anular el link, con el motivo](g6-anular.webp "Al anular se pide el motivo. Queda apuntado quién lo anuló y por qué.")

![El link sale como Anulado con quién lo anuló y el motivo](g7-anulado.webp "El link queda «Anulado» y el alumno ya no puede pagarlo.")

> [!aviso] Un link **pagado** no se puede anular. Si hay que devolver el dinero, avisa a tu admin: la devolución se hace en Stripe.

## 6. Qué pasa cuando el alumno paga

- El alumno paga con tarjeta en la página de Stripe, que le confirma el pago en pantalla. El link no se puede volver a pagar: es de un solo pago.
- El cobro entra en el CRM **en unos minutos** y se ve en Finanzas › Pagos Stripe.
- El cobro va **a la venta del link**. El CRM sabe de qué link es, así que no depende del correo con el que pague el alumno.
- **Si creaste el link desde una venta:** el cobro se suma a esa venta y salda su siguiente cuota pendiente.
- **Si lo creaste desde el prospecto:** si el alumno ya tiene una venta de ese curso, el cobro va a ella. Si no la tiene, el CRM **crea la venta, a tu nombre**, con el curso y el importe del link. El prospecto pasa a «convertido», igual que con «Registrar venta».
- El link pasa a **«Pagado»** con la fecha del pago, y te llega un aviso.

> [!ok] No registres a mano la venta ni el cobro de un link pagado: entran solos, y si los apuntas tú saldrían dos veces.

## 7. Lo que todavía no hace

- **Links en cuotas** que cobren solos cada mes: de momento, cada link es de un solo pago.
- Una pantalla con **todos los links** de todas las fichas: de momento se ven en la ficha de cada alumno.

## 8. Errores típicos y qué hacer

| Lo que ves | Por qué pasa | Qué hacer |
|---|---|---|
| «Este campus no tiene la clave de links de pago…» | El campus no está conectado a Stripe para crear links. | Avisa a tu admin: la clave va en Integraciones › Links de pago. |
| «En este campus solo el admin puede hacer descuento…» o «El descuento máximo en este campus es un…» | Bajaste el importe más de lo permitido. | Pon el importe completo o pide el link a tu admin. |
| «Este curso no tiene precio en el catálogo: el link lo tiene que crear un admin.» | El curso no tiene precio, o está en otra moneda. | Pide el link a tu admin, o que pongan el precio en el catálogo. |
| «Esta venta no tiene nada pendiente de cobro…» | La venta ya está pagada entera. | No hace falta link. Si es un cobro de más, habla con tu admin. |
| «La caducidad no puede pasar de… días» | Pusiste más días de los permitidos. | Pon un número menor. |
| «Stripe no deja crear el link con la clave de este campus…» | A la clave de Stripe del campus le falta algún permiso. | Avisa a tu admin con una captura del mensaje. |
| «Prospecto no encontrado» o «Venta no encontrada» | No es tuyo. | Pide a tu coordinadora que te lo asigne. |
| El alumno dice que el link «ya no está disponible» | Caducó o se anuló. | Crea uno nuevo y mándaselo. |
| Pagó hace rato y el link sigue «Pendiente» | El cobro tarda unos minutos en entrar. | Espera 10 minutos y recarga la ficha. Si sigue igual, avisa a tu admin con el nombre del alumno y la hora del pago. |

![Mensaje de error: el campus no tiene la clave de links de pago](g5-error-sin-clave.webp "Ejemplo: en un campus sin la clave, el CRM dice qué pasa y a quién avisar.")
