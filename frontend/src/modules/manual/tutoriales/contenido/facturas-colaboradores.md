Cada colaborador sube su factura del mes desde «Mi factura». La empresa que le paga recibe un aviso, la revisa, la valida y la marca pagada con su justificante.

> [!aviso] **Hoy (18/11/2026):** la pantalla está en producción. Si los correos salen de verdad en ISEIE no se ha comprobado: lo dicen los dos interruptores de abajo.

## 1. Dar de alta a un colaborador

1. Ve a **Finanzas › «Facturas de colaboradores»**. Pide el permiso «Ver las facturas»; dar de alta, «Gestionar colaboradores».
2. En la pestaña **«Colaboradores»**, da el alta. Pon una fila por cada empresa que le paga, con su forma de cobro.
3. Desde ahí también se edita, se da de baja y se le reenvía el enlace.

Las pestañas de la pantalla son «Del mes», «Por validar», «Enviadas», «Por pagar», «Pagadas», «Historial» y «Colaboradores».

### Vendedoras

Una gestora o comercial también puede facturar su mes: se da de alta como colaboradora de tipo **vendedora**, con «Cómo cobra» en «Variable (lo que diga su factura)». Al guardarla, recibe el permiso de subir su factura.

## 2. Validar y pagar

1. Las facturas que llegan pasan por la pestaña **«Por validar»**. Quien tiene el permiso «Validar facturas de colaboradores» la revisa y pulsa **«Validar»**.
2. «Por pagar» enseña solo las validadas. Al pagar, se marca pagada con su justificante.
3. Si una factura está mal, **«Devolver»** la anula con su motivo y el colaborador sube otra.

## 3. Qué correos salen y a quién

| Cuándo | A quién | Qué |
|---|---|---|
| Último día del mes, por la mañana (hora de Madrid) | Colaborador | El enlace para subir la factura del mes. |
| Día 5 | Colaborador que no la subió | Un recordatorio. |
| Al subirla | Colaborador | El acuse de recibo. |
| Al llegar facturas (las que llegan casi a la vez van juntas) | Correo de facturación de la empresa | «Han llegado N facturas». |
| Cada día, por la mañana | Correo de facturación de la empresa | «Faltan N facturas por pagar». |

> [!aviso] Los avisos a la empresa van al **«Email» de la empresa emisora** (Finanzas › Facturación › Configuración › Empresas emisoras). Si no lo tiene, no se envían y queda apuntado «La empresa no tiene correo de facturación».

## 4. Para el responsable técnico

| Interruptor | Qué hace | Hoy |
|---|---|---|
| `FACTURAS_COLABORADOR_EN_PRODUCCION` | Monta la función en producción. Sin él, la entrada del menú sale pero la pantalla da error. | Sin comprobar. |
| `FACTURAS_COLABORADOR_CORREOS_ACTIVOS` | Los correos salen de verdad. Apagado, solo se anotan en el registro. | Sin comprobar. |
| `FACTURAS_COLABORADOR_LLEGADAS_DISABLED` y `FACTURAS_COLABORADOR_POR_PAGAR_DISABLED` | Apagan cada uno su aviso a la empresa. | Sin comprobar. |
