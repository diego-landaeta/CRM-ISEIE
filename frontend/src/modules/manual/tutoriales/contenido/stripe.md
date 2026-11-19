ISEIE tiene su cuenta de Stripe y el CRM la consulta con una clave. Hay hasta tres piezas: la **clave de lectura** (imprescindible), el **webhook** (para que los cobros entren al momento) y la **clave de escritura de los links de pago**, que tiene [su propio tutorial](tutorial:links-de-pago-instalacion).

> [!mal] **Nunca la clave secreta (`sk_live_…`).** Puede cobrar, devolver y transferir dinero, y el CRM solo necesita leer. Las claves no se mandan ni por chat ni por correo.

## 1. La clave de lectura

Con esta clave, el CRM pregunta a Stripe cada cinco minutos por los cobros nuevos y los deja en **Finanzas › Pagos Stripe**, donde cada uno se asocia a su venta.

1. En el panel de Stripe de ISEIE, ve a **Desarrolladores › Claves de API › «Crear clave restringida»**.
2. Ponle un nombre, por ejemplo «CRM – lectura».
3. Marca **Lectura** en Charges, Balance y Disputes, y deja todo lo demás en «Ninguno». Disputes hace falta para la pantalla de disputas.
4. Copia la clave (`rk_live_…`). Stripe la enseña una sola vez.
5. En el CRM, ve a **Configuración › Integraciones**.
6. En la tarjeta **«Stripe»**, pega la clave en «Access token» y pulsa **«Guardar»**. Después, **«Probar conexión»**.

Si la clave es restringida y no lee el saldo, la prueba dice «clave restringida: lee los cobros, pero no el saldo». Así está bien.

## 2. El webhook y su secreto

El webhook hace que Stripe avise al CRM en el momento en que entra un cobro, sin esperar a los cinco minutos. Sin él los cobros siguen entrando.

> [!ok] **Hoy (18/11/2026):** el webhook de la cuenta de ISEIE está creado, con su secreto guardado y con los eventos de los links de pago añadidos. Si está activo lo dice el bloque del webhook en la tarjeta «Links de pago».

Para crear uno:

1. En la tarjeta «Stripe», abre el plegable **«Webhook — opcional»**. Ahí sale la «Dirección que hay que pegar en Stripe», ya completa: pulsa **«Copiar»**.
2. En Stripe: **Desarrolladores › Webhooks › «Añadir endpoint»** y pega la dirección tal cual.
3. Marca estos eventos: `charge.succeeded`, `charge.updated`, `charge.refunded`, `charge.failed`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `payment_intent.succeeded` y `payment_intent.payment_failed`. Los de los links de pago los añade el propio CRM desde la tarjeta de los links.
4. Copia el **secreto de firma** (`whsec_…`) y pégalo en el CRM, en «Secreto de firma del webhook». Pulsa «Guardar».

Sin el secreto, el CRM rechaza todos los avisos a propósito.

## 3. Disputas (contracargos)

La pantalla **Finanzas › «Disputas de Stripe»** enseña las disputas abiertas de la cuenta. Se responden en Stripe. Pide el permiso «Asociar pagos de Stripe».

> [!aviso] En ISEIE esta pantalla está **en pruebas**: todavía no está en producción.

- Usa la misma clave de lectura, así que esa clave tiene que poder leer Disputes.
- El botón para traerlas funciona siempre.
- El repaso automático cada 30 minutos y el aviso en la campana (cuando quedan pocos días para responder) van con un interruptor del servidor. **Hoy están apagados.**

## 4. Los pagos de Stripe en el CRM

- **Finanzas › Pagos Stripe**: todos los cobros que han entrado, con los que aún no tienen venta. Un cobro sin alumno se asocia a su venta con «Asociar».
- En la ficha de cada venta, la tarjeta **«Cargos de Stripe sin enlazar»** une un pago de Stripe con un cobro que ya estaba apuntado a mano, sin duplicarlo (ver [Ventas, cuotas y cargos de Stripe](tutorial:ventas-y-cuotas)).

## 5. Para el responsable técnico

Interruptores del servidor relacionados con Stripe. Ninguno tiene pantalla.

| Interruptor | Qué hace | Hoy |
|---|---|---|
| `STRIPE_DISPUTAS_ACTIVO` | El repaso automático de disputas y su aviso en la campana. | Apagado. |
| `DISPUTAS_CORREO_ACTIVO` | El correo del aviso de disputas. | Apagado. |
| `STRIPE_ASOCIACION_V2_ACTIVA` | Las reglas nuevas para decidir a qué venta va cada cobro. Afecta a todos los campus. | Apagado. |
| `COMPRA_DIRECTA_ACTIVA` | Un cobro de un pedido de la tienda que siga sin venta al día siguiente crea su propia venta, sin gestora. Necesita el anterior. | Apagado. |
| `SUSCRIPCION_CIERRE_ACTIVO` | Cancela la suscripción en Stripe cuando la venta está pagada entera. Necesita una clave que pueda escribir. | Apagado. |
| `STRIPE_SYNC_DISABLED` | Apaga la revisión de Stripe cada cinco minutos y, con ella, la factura automática y otros trabajos. Hay que tenerlo en cuenta antes de usarlo. | Sin poner. |
