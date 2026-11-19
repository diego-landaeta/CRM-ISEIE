El CRM trae cada 3 horas las campañas y el gasto de las cuentas publicitarias de Meta conectadas. Se pueden conectar varias cuentas.

> [!ok] **Hoy (18/11/2026):** las cuentas conectadas sincronizan. La renovación automática de tokens todavía no está en producción en ISEIE (no hace falta con tokens que no caducan).

## 1. Sacar el token en Meta

1. En **Business Manager › Configuración del negocio › Usuarios › Usuarios del sistema**, crea un usuario del sistema o usa el que haya.
2. Dale acceso a la cuenta publicitaria, en «Asignar activos», con permiso para ver el rendimiento.
3. Pulsa **«Generar token nuevo»** y marca `ads_read`, `read_insights` y `business_management`. En caducidad, elige **«Nunca»**.
4. Copia el token y, del Administrador de anuncios, el ID de la cuenta (empieza por `act_`).

## 2. Conectar en el CRM

1. Ve a **Publicidad › «Meta Ads»** y pulsa **«Conectar Meta Ads»**. Pide el permiso de editar Meta Ads.
2. Rellena «Ad Account ID» y «Access Token (System User, sin caducidad)».
3. Para cambiar el token o la cuenta, o para desconectar: pestaña **«Configuración»** › «Nuevo Access Token».

> La entrada «Meta Marketing» de las APIs de la marca (Configurar esta marca › APIs) no la usa nada: los tokens van en la pantalla Meta Ads.

## 3. Renovación de los tokens

Los tokens de usuario del sistema con caducidad «Nunca» no caducan y no hay que hacer nada. Si alguna cuenta está conectada con un token de usuario normal (caduca a los 60 días), el CRM lo puede renovar solo, avisando una semana antes.

## 4. Instagram

Todavía no hay pantalla para conectar Instagram.

## 5. Para el responsable técnico

| Variable | Qué es |
|---|---|
| `META_TOKENS_RENOVACION_ACTIVA` | Enciende la renovación de tokens. **Hoy, aún no está en producción en ISEIE.** |
| `META_APP_ID` y `META_APP_SECRET` | Los de la app de Meta, que hacen falta para renovar. |
