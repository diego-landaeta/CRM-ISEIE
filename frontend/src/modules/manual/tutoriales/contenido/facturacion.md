Los datos fiscales de cada empresa, la factura automática con su cola, la auditoría y el informe mensual a la gestoría. Todo esto está en el CRM; la factura automática, la auditoría y el envío del informe van con un interruptor del servidor.

## 1. Datos fiscales de cada empresa

1. Ve a **Finanzas › Facturación › botón «Configuración»**. Pide el permiso «Configurar la facturación».
2. En **«Empresas emisoras»**, abre la empresa o pulsa «+ Añadir empresa» y rellena:

- «Razón social» y «NIF / CIF». **Sin CIF, ninguna factura sale sola.**
- «Dirección», «Ciudad», «Código postal» y «País».
- «Email»: el **correo de facturación** de la empresa. Ahí llegan los avisos de las facturas de colaboradores.
- «Teléfono», «IBAN», «BIC/SWIFT», el logo y el «Pie de página por defecto».

3. Dentro de la empresa, en «Numeración de facturas de esta empresa», pon la «Serie» (hasta 10 caracteres) y el número desde el que arranca (el último emitido). Los abonos usan la serie con una `R` delante.
4. Revisa también «Regímenes fiscales y coletillas» (el % de IVA) y «Defaults por proyecto»: la serie, el método de pago y el pie de pago de cada campus.

> [!aviso] Revisa que **todas** las empresas emisoras tengan CIF, serie, número de arranque y correo de facturación. Sin correo, no les llegan los avisos de las facturas de colaboradores.

## 2. Factura automática y cola de facturación

**Cómo funciona:**

- Con el primer pago de una venta, el CRM manda al alumno un enlace de un solo uso para que ponga sus datos fiscales.
- Cuando responde, la factura sale sola. Las de cada cuota siguiente, también.
- Si a los 7 días no ha respondido, el CRM usa los datos de la ficha, pero solo si están completos y son válidos.
- Si no lo están, el cobro se queda en la cola y se avisa a su gestora.

**Datos fiscales del alumno que se exigen:** particular o empresa; un nombre real (no uno de relleno, y si es particular, de más de una palabra); NIF, NIE o CIF válido si es de España (fuera, de 5 a 20 caracteres con algún número); dirección, ciudad y país; código postal de 5 cifras si es de España; y un correo válido. A mano se completan en el diálogo «Datos fiscales para la factura».

**Dónde se sigue:** en Facturación, la tarjeta **«Cola de facturación»**. Dice por qué un cobro no sale solo:

- «Esperando datos del alumno (hasta el …)».
- «Revisar datos: no sale sola».
- «Datos del alumno: sale sola».
- «…: no sale sola · motivo»: posible duplicada, facturación pausada, hay anteriores sin emitir, emisor sin CIF, antes del arranque, total corto o tiene proforma.

**Quién la gestiona:** emitir desde la cola, cobrar proformas y mover la fecha «al día» es el permiso **«Emitir desde la cola»**. De serie no lo tiene ningún rol: se da persona a persona, en la ficha del usuario (Configuración › Usuarios › la persona › permisos).

> [!ok] Una factura emitida no se borra ni se cambia: se anula con su motivo (ver [Facturas emitidas: se anulan, no se borran](tutorial:anular-factura)).

## 3. Auditoría de facturación

Cada 2 horas revisa, serie por serie: números repetidos, facturas emitidas sin los datos fiscales obligatorios y cobros con más de 9 días sin factura. Si encuentra algo:

- **Pausa toda la emisión, también la manual.**
- Avisa por correo a los superadmin, a los admin y a la lista de correos de administración.
- Deja un aviso fijo en toda la app.
- Se reanuda con **«Marcar como solucionado»** (permiso «Auditoría de facturación»).

## 4. Informe mensual para la gestoría

Cada mes, un correo por empresa con un ZIP: el PDF de cada factura, las rectificativas aparte, el listado y el informe de ventas en Excel. Si el ZIP es muy grande, va un enlace. No incluye las facturas de colaboradores.

- **En la web:** Reportes › tarjeta **«Informe mensual para la gestoría»** (permiso «Informe mensual para la gestoría»). Se ve y se descarga a mano aunque el envío esté apagado.
- **Los destinatarios no se ponen en la web**, sino en el servidor (abajo).

## 5. Para el responsable técnico

Interruptores y ajustes del servidor. **Hoy (18/11/2026) los tres envíos están apagados.**

| Variable | Qué es |
|---|---|
| `FACTURA_AUTOMATICA_ACTIVA` | Enciende la factura automática. |
| `FACTURA_AUTOMATICA_DIAS` | Días que espera la respuesta del alumno (de serie, 7). |
| `FACTURA_AUTOMATICA_ENVIAR_PDF` | Si se manda el PDF al alumno o solo se emite. |
| `FACTURACION_AUDITORIA_ACTIVA` | Enciende la auditoría. |
| `FACTURACION_AUDITORIA_DESDE` | La fecha de arranque. **Ponla**: sin ella revisa todo el historial, y cualquier fallo antiguo pararía la facturación. |
| `FACTURACION_AUDITORIA_DIAS` | Los días que puede estar un cobro sin factura (de serie, 9). |
| `FACTURACION_AUDITORIA_CORREOS` | Los correos de administración que reciben el aviso. |
| `INFORME_MENSUAL_ACTIVO` | Enciende el envío del informe. |
| `INFORME_MENSUAL_PARA` y `INFORME_MENSUAL_PARA_` + serie | La gestoría general y la de cada empresa. |
| `INFORME_MENSUAL_ADMINISTRACION` | Recibe el de todas las empresas. |
| `INFORME_MENSUAL_DIA` y `INFORME_MENSUAL_HORA` | Cuándo sale (de serie, el día 1 a las 9:00, hora de Madrid). |

> [!aviso] En ISEIE, si la revisión de Stripe está apagada (`STRIPE_SYNC_DISABLED`), la factura automática tampoco arranca. Al encenderla, conviene mirar la «Cola de facturación» una semana antes de fiarse.
