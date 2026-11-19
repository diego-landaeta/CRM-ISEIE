El CRM pide los diplomas a Certifex, que los emite. Certifex avisa de vuelta al CRM de las consultas, las solicitudes y los diplomas completados. **En la web no hay nada que configurar por campus**: los centros vienen de Certifex.

> [!aviso] La firma del alumno **no** va impresa en el diploma. El diploma lleva solo el hueco para firmarlo a mano una vez impreso.

## 1. Pantallas

- **Académico › «Diplomas»** y la pestaña de **Certificaciones** de «Solicitud de admisión».
- Permisos: los de «Diplomas (Certifex)» (ver, emitir, aprobar, editar, avisar, revocar e imprenta) y los de las consultas de Certifex.

Si la pantalla dice **«Certifex no está conectado»**, falta la conexión del servidor (abajo). En ISEIE, la conexión con Certifex en producción está **sin comprobar**.

## 2. Confirmación de datos del diploma

Antes de emitir, el CRM puede mandar al alumno un enlace para que confirme cómo sale su nombre. No tiene pantalla. **Hoy (18/11/2026) no está en producción en ISEIE.**

## 3. Para el responsable técnico

| Variable | Qué es |
|---|---|
| `CERTIFEX_API_URL` y `CERTIFEX_CRM_CLAVE` | Dónde está Certifex y la clave que genera Certifex para el CRM. Sin las dos, la pantalla dice «Certifex no está conectado». |
| `CERTIFEX_WEBHOOK_SECRETO` | El mismo valor que el secreto de consultas de Certifex. Sin él, los avisos de vuelta no entran. |
| `DIPLOMA_CONFIRMACION_ACTIVA` | Enciende la confirmación de datos del diploma. **Hoy, aún no en producción en ISEIE.** |
| `DIPLOMA_CONFIRMACION_CENTROS` | En qué centros. Vacío: todos. |
| `DIPLOMA_CONFIRMACION_ENVIAR_CORREO` | Si el correo sale de verdad. |

En Certifex hay que poner las tres direcciones de vuelta del CRM (consultas, solicitudes y completados). La guía completa está en la documentación del repositorio, sección «Certifex: enlace en producción».

> [!aviso] El «candado» de Certifex hace que los centros que lo tengan no emitan nada sin el visto bueno del CRM. Hay que tenerlo en cuenta antes de ponerlo.
