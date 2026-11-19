El CRM manda sus correos (avisos, bienvenidas, recordatorios, facturas) por Brevo. Una clave de Brevo se puede poner en tres sitios, y cada uno sirve para una cosa.

> [!ok] **Hoy (18/11/2026):** el correo funciona. El aviso de correos bloqueados está apagado.

## 1. Las tres claves

| Dónde | Para qué | Qué pide |
|---|---|---|
| **Configuración del CRM** (menú de usuario) › pestaña **«APIs globales»** › «Brevo (Email transaccional)» | La cuenta del CRM: todos los correos que no son de una marca. Sin clave aquí, se usa la del servidor. | La clave de API (`xkeysib-…`). |
| **«Configurar esta marca»** › pestaña «APIs» › «Brevo (Email)», junto con el remitente «no contestar» de la pestaña «General» | Que los correos de una marca salgan desde su dominio. Con las dos cosas puestas sale por su cuenta; si falta alguna, por la del CRM. | La clave y el remitente. |
| Configuración › Integraciones › tarjeta **«Brevo (Sendinblue)»**, campus a campus | **Solo el envío de facturas por correo.** Sin ella, ese envío da «Brevo no configurado para este proyecto». | «API Key», «From email» y «From name». |

## 2. Sacar la clave en Brevo

1. Entra en Brevo con la cuenta que toque y ve a **Ajustes › SMTP y API › Claves API**.
2. Pulsa «Generar una nueva clave API», ponle de nombre «CRM» y copia la clave.
3. El remitente («From email») tiene que estar **verificado** en Brevo, en Remitentes y dominios. Si no lo está, Brevo no manda nada.
4. En el CRM, pega la clave donde corresponda. Pulsa «Guardar» y luego «Probar conexión».

## 3. Correos bloqueados

Brevo bloquea las direcciones que rebotan o que marcan un correo como spam. Con el aviso encendido, el CRM revisa cada 6 horas las listas de bloqueados de la cuenta del CRM y de cada marca, y las cruza con los usuarios activos. Si encuentra a alguien, avisa a los superadmin y a los admin de sus campus, una vez por bloqueo.

Para desbloquear a alguien: en **Configuración › Usuarios**, botón **«Desbloquear en Brevo»** (permiso «Desbloquear correos en Brevo»).

> Brevo no avisa al CRM por su cuenta: los bloqueos se consultan cada 6 horas.

## 4. Para el responsable técnico

| Variable | Qué es |
|---|---|
| `BREVO_API_KEY` | La clave de respaldo del servidor, si no hay una en «APIs globales». |
| `BREVO_BLOQUEADOS_ACTIVO` | Enciende el aviso de correos bloqueados. **Hoy, apagado.** |
