Lo que necesita ISEIE para que sus gestoras creen links de pago: una clave de escritura de Stripe, las reglas del campus y el webhook de la cuenta. Todo se configura desde la web del CRM. La guía para las gestoras es [Links de pago: crear uno y enviarlo](tutorial:links-de-pago).

> [!ok] **Cómo está hoy (18/11/2026).** Los links de pago están **encendidos** en ISEIE, con la clave de escritura puesta y probada. El webhook de la cuenta tiene añadidos los eventos de los links. Esta guía sirve para revisarlo, cambiar las reglas o cambiar la clave.

## 1. En Stripe: la clave restringida de escritura

Es una clave **aparte** de la de solo lectura que usa el CRM para traer los cobros. Esa no se toca.

1. Entra en el panel de Stripe de la cuenta de ISEIE.
2. Ve a **Desarrolladores › Claves de API**.
3. Pulsa **«Crear clave restringida»**. Si pregunta para qué es, elige darle tú los permisos.
4. Nombre: por ejemplo **«CRM – links de pago»**.
5. Marca **exactamente** estos permisos y deja todo lo demás en «Ninguno»:

| Recurso en Stripe | Permiso | Para qué lo usa el CRM |
|---|---|---|
| Payment Links | **Escritura** | Crear el link y desactivarlo al anularlo o cuando caduca. |
| Products | **Escritura** | Cada link crea su producto con el nombre del curso. |
| Prices | **Escritura** | Cada link crea su precio con el importe que pone la gestora. |
| Checkout Sessions | Lectura | Ver los pagos hechos con los links. |
| Webhook Endpoints | **Escritura** | Ver el webhook de la cuenta, añadirle eventos y activarlo o desactivarlo desde el CRM. |

En el panel en español, «Escritura» puede salir como «Escribir» y «Lectura» como «Leer».

6. Pulsa **«Crear clave»**. Stripe la enseña **una sola vez**: cópiala y pégala en el CRM en el paso 2.

> [!mal] **No uses la clave secreta de la cuenta** (`sk_…`): puede hacer de todo, también devolver dinero. Tampoco la publicable (`pk_…`): no sirve y el CRM la rechaza. Las claves no se mandan por WhatsApp ni por correo.

## 2. Pegar la clave en el CRM y «Probar conexión»

1. Ve a **Configuración › Integraciones**.
2. ISEIE es un solo campus: ya está elegido.
3. Baja hasta la tarjeta **«Links de pago»**, debajo de la de Stripe.
4. Pega la clave en **«Clave restringida de escritura»** y pulsa **«Guardar»**.
5. Pulsa **«Probar conexión»**. El CRM pregunta a Stripe por cada permiso (solo lee, no crea nada) y te dice cuál responde.

![Tarjeta Links de pago en Integraciones, con los permisos que necesita la clave y las reglas del campus](a1-tarjeta-links.webp "La tarjeta «Links de pago» en el CRM gemelo de pruebas; en ISEIE es la misma.")

> «Probar conexión» comprueba que la clave **lee** cada cosa. Que también pueda **escribir** solo se sabe creando un link (paso 5).

![Aviso al guardar algo que no es una clave de Stripe](a4-clave-mala.webp "Si pegas algo que no es una clave secreta o restringida de Stripe, el CRM no la guarda y te lo dice.")

## 3. Las reglas del campus

Debajo de la clave está el bloque **«Reglas de los links en este campus»**: lo que puede elegir la gestora al crear un link. Ella no configura nada de Stripe.

| Regla | Al empezar | Qué hace |
|---|---|---|
| Descuento máximo | 0 % | Cuánto puede rebajar la gestora. Desde el prospecto se mide sobre el precio del catálogo; desde una venta, sobre lo que queda por pagar. Con 0, solo el admin hace descuentos. |
| Caduca a los (días) | 7 | Los días que dura un link si la gestora no pone otra cosa. |
| Máximo (días) | 30 | Lo más que la gestora puede poner. |
| Admite cuotas mensuales / Como mucho | Sí / 12 | La regla queda puesta, pero **los links en cuotas todavía no se pueden crear**: de momento, cada link es de un solo pago. |
| Monedas admitidas | EUR (y las que el campus ya cobra) | Las monedas que puede elegir la gestora, separadas por comas: `EUR, USD`. |
| Por defecto | EUR | La que sale elegida. Tiene que estar entre las admitidas. |

1. Cambia lo que necesites.
2. Pulsa **«Guardar reglas»**. Verás «Reglas de los links guardadas». Valen para los links que se creen desde ese momento.

![Aviso: la caducidad por defecto no puede pasar de la máxima](a3-regla-mala.webp "Si algo no cuadra, por ejemplo una caducidad por defecto mayor que la máxima, no se guarda y te dice por qué.")

> Un link en una moneda distinta a la del precio del curso, de un curso sin precio o de una venta sin nada pendiente solo lo puede crear un admin. Cada cambio de reglas queda apuntado con quién lo hizo.

### Cobrar una cuota con un link

Como cada link es de un solo pago, una cuota se cobra con un link por su importe. Al ser menos de lo pendiente, cuenta como descuento: con el 0 %, ese link lo crea el admin. Si se quiere que las gestoras lo hagan, hay que subir el descuento máximo del campus, sabiendo que también les deja rebajar el precio.

## 4. El webhook de la cuenta

El webhook es el aviso que Stripe manda al CRM en cuanto hay un cobro. Sin él los cobros entran igual, porque el CRM revisa Stripe cada pocos minutos, pero con él el link pasa a «Pagado» antes.

El bloque **«Webhook de la cuenta de Stripe»** sale debajo de las reglas cuando la clave ya está guardada. El CRM **no crea** un webhook nuevo: usa el que ya tiene la cuenta hacia el CRM, cuyo dato está guardado en la tarjeta «Stripe» del campus.

1. **Ver:** el bloque dice si está *Activo* o *Desactivado* y cuántos eventos escucha.
2. **Añadir eventos:** si dice «Le faltan los de los links…», pulsa **«Añadir los eventos de los links»**. Se añaden los que faltan y se quedan los que ya tenía.
3. **Activar o desactivar:** con el botón **«Activar»** o **«Desactivar»**. Antes de cambiar nada te pide confirmación.

> [!aviso] Si el bloque dice «Este campus no tiene ningún webhook de Stripe guardado», avisa al responsable técnico: desde aquí no se crea uno.

### Cuentas de Stripe compartidas

No aplica en ISEIE: tiene un solo campus y una sola cuenta de Stripe.

## 5. Comprobar que funciona

### Primero en pruebas

En el CRM de pruebas, con una clave de **modo prueba** (`rk_test_…`) en el campus:

1. Abre un **prospecto de prueba** y pulsa **«Crear link de pago»**.
2. Copia el link y ábrelo en otra pestaña.
3. Paga con la tarjeta de prueba de Stripe: `4242 4242 4242 4242`, cualquier fecha futura y cualquier código de 3 cifras.
4. En unos minutos, el cobro tiene que salir en **Finanzas › Pagos Stripe**.
5. En la ficha del prospecto, el link tiene que pasar a **«Pagado»** y tiene que haberse creado **la venta** del curso a nombre de quien creó el link, con ese cobro dentro.
6. Prueba también **«Anular»** en otro link: al abrirlo, Stripe tiene que decir que ya no está disponible.

> [!aviso] El CRM de pruebas no acepta claves reales. Para que el cobro de prueba llegue, la clave de **lectura** del campus (tarjeta «Stripe») también tiene que ser de modo prueba y de la misma cuenta.

### En el CRM de verdad, con 1 €

1. Con la clave real puesta, crea como admin un link de **1 €** para un prospecto de prueba (el admin puede poner cualquier importe).
2. Págalo con una tarjeta tuya.
3. Comprueba que el cobro sale en **Finanzas › Pagos Stripe**, que el link pasa a «Pagado» y que se creó la venta de 1 €.
4. Devuelve ese euro en Stripe (Pagos › el cobro › Reembolsar) y avisa al responsable técnico para quitar la venta de prueba y su cobro, para que no cuenten en Ventas ni en Facturación.

## 6. Para el responsable técnico

Los links se encienden para todo el CRM con el interruptor `LINKS_PAGO_EN_PRODUCCION` del servidor. **Hoy está encendido.** Apagado, no salen ni esta tarjeta ni la de las fichas. Un campus sin su clave de escritura no puede crear links aunque esté encendido: las gestoras ven un aviso que dice que falta la clave.

## 7. Errores típicos

| Lo que ves | Qué pasa | Qué hacer |
|---|---|---|
| No sale la tarjeta «Links de pago» en Integraciones | Tu usuario no puede configurar integraciones ni links. | Pide el permiso «Configurar los links de pago». |
| «Eso no es una clave secreta (sk_…) ni restringida (rk_…) de Stripe…» | Pegaste otra cosa (por ejemplo la publicable, `pk_…`). | Copia la clave restringida del paso 1. |
| «Probar conexión» dice que falta algún permiso | A la clave le falta ese permiso. | En Stripe, edita la clave y dale el permiso de la tabla del paso 1. Vuelve a probar. |
| «Stripe no deja crear el link con la clave de este campus (403)…» | La clave lee pero no puede escribir en Payment Links, Products o Prices. | Revisa que esos tres estén en «Escritura». |
| «En pruebas solo se crean links con una clave de test…» | Pusiste una clave real en el CRM de pruebas. | Usa la de modo prueba (`rk_test_…`). |
| En el bloque del webhook, un error de permisos | A la clave le falta «Webhook Endpoints» con escritura. | Añádeselo en Stripe. |
| El link se pagó y el cobro no aparece | El CRM revisa cada pocos minutos; o la clave de lectura es de otro modo o de otra cuenta. | Espera 10 minutos. Si sigue igual, avisa al responsable técnico con la hora del pago. |
