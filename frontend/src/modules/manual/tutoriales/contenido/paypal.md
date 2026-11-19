Es una **conexión por API**: no hay que subir ningún fichero. El CRM solo lee de PayPal: no cobra, no devuelve y no mueve dinero. Cada 30 minutos trae las transacciones de la cuenta y casa cada cobro con su venta, por la referencia (`venta-N` o `crm-N`) o por el correo del cliente.

> [!aviso] **Hoy (18/11/2026) está apagado.** Si ISEIE cobra por PayPal, hace falta una aplicación REST en su cuenta **Business** de PayPal y que el responsable técnico encienda la función. Mientras esté apagada, la entrada «PayPal y banco» no sale en el menú.

## 1. En PayPal: crear la aplicación

1. Entra en **developer.paypal.com** con la cuenta **Business** de ISEIE. Una cuenta personal no sirve.
2. Ve a **Apps & Credentials** y pon arriba el modo **Live**. Para probar antes, usa **Sandbox**.
3. Pulsa **«Create App»**, ponle de nombre «CRM» y elige el tipo Merchant.
4. Copia el **Client ID** y el **Secret**.
5. En las opciones de la app, activa **Transaction search**. **Sin eso, el CRM no ve ningún cobro.**

Opcional, para que los cobros entren al momento:

1. En la misma app, pulsa **«Add webhook»**.
2. Dirección: la que enseña la tarjeta «PayPal» del CRM, ya completa.
3. Eventos: `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.PENDING`, `PAYMENT.CAPTURE.DENIED`, `PAYMENT.CAPTURE.REVERSED`, `PAYMENT.CAPTURE.REFUNDED` y `PAYMENT.SALE.COMPLETED`.
4. Copia el **Webhook ID**.

## 2. En el CRM

1. Ve a **Configuración › Integraciones › tarjeta «PayPal»**.
2. Rellena: «Client ID», «Modo» («Live» o «Sandbox»), «Secret» (se guarda cifrado) y, si lo creaste, «Webhook ID (opcional)». Sin webhook, solo funciona la revisión cada 30 minutos.
3. Pulsa «Guardar» y luego «Probar conexión». La prueba solo pide un permiso a PayPal; no mira cobros.
4. Los cobros salen en **«PayPal y banco» › pestaña «PayPal»**, con el botón «Sincronizar».

> PayPal no usa un «secreto de webhook» como Stripe: verifica cada aviso con el Webhook ID. Si el webhook no tiene ID, el CRM contesta que no está configurado.

## 3. Quién puede

- «Configurar integraciones»: la tarjeta.
- «Ver cobros de PayPal y del banco»: la lista.
- «Registrar cobros de PayPal y del banco»: sincronizar y decidir a qué venta va un cobro dudoso.

## 4. Para el responsable técnico

El interruptor es `PAYPAL_COBROS_ACTIVO`. **Hoy está apagado.** Además, la entrada del menú «PayPal y banco» se decide al compilar el frontal: hay que sacarla al menú de producción cuando se encienda.
