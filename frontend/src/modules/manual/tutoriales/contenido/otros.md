Lo que se configura o se enciende y no tiene tutorial propio. Para cada uno: dónde está y qué pide.

## Webhooks de admisión

- **Dónde:** Comercial › «Solicitud de admisión» › pestaña «Webhooks» › «Nuevo webhook».
- **Qué pide:** un nombre; el CRM da la dirección a la que mandar la solicitud. «Avisar por correo a» admite hasta 10 correos; el aviso no lleva datos personales.
- La solicitud de admisión **nunca crea un prospecto**: es el respaldo para matricular.
- El correo del aviso va con el interruptor `ADMISION_AVISO_ACTIVO`.

## Webhooks de entrada de prospectos

- **Dónde:** Configuración › «Webhooks», con las pestañas de prospectos, Make y transferencias.
- La clave de cada campus está en Configurar esta marca › pestaña «Webhook».

## Webhook de transferencias (saliente)

- **Dónde:** Configuración › «Webhooks» › pestaña de transferencias.
- **Qué pide:** la dirección de destino y un secreto, que se guarda cifrado.
- `WEBHOOKS_SALIENTES_DISABLED` solo quita los reintentos.

## MCP (Claude conectado al CRM)

- **Dónde:** Configuración › «MCP». Con el permiso «Usar el MCP» se ve la dirección personal y el «Código para Claude».
- Quien lo administra da y quita el acceso; quien lo supervisa tiene el interruptor de emergencia.
- `MCP_DISABLED` lo apaga todo, y el botón de la pantalla no puede volver a encenderlo.

## Conectores

- **Dónde:** Configuración › «Conectores».
- **Tipos:** productos y pedidos de WooCommerce, API de WordPress, ACF, API propia y MCP con su alcance.

## WooCommerce

- **Dónde:** Académico › «WooCommerce».
- `WC_SYNC_DISABLED` apaga la sincronización.

## Correo entrante

No aplica en ISEIE: solo existe en el CRM 360.

## IA (Claude)

- La clave de la IA que vale es la del servidor (`ANTHROPIC_API_KEY`). La tarjeta «Claude AI (Anthropic)» de Configuración › «APIs globales» todavía no la usa.
- `IA_TOPE_MENSUAL_USD` es el tope de gasto al mes.

## Supabase (proyectos IA)

No aplica en ISEIE: es de los proyectos IA del CRM 360.

## Avisos de cursos pendientes

Sin pantalla. Los correos van con `CURSOS_PENDIENTES_CORREOS_ACTIVOS`.

## Claves y variables

No aplica en ISEIE: la pantalla «Claves y variables» solo existe en el CRM 360.
