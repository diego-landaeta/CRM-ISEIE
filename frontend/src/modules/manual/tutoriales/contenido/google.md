Hoy **no se puede conectar Google desde el CRM**: las tareas de Google Ads, Analytics y Search Console están abiertas y sin programar. Lo que sí se puede hacer ya es **preparar las credenciales**, para que estén listas cuando llegue la pantalla. Las crea quien vaya a usarlas, con la cuenta de Google de la empresa.

> [!aviso] En «Configurar esta marca › APIs» hay dos tarjetas, «Google Ads» y «Google Search Console», para pegar claves a mano. **Nada las usa todavía para traer datos.**

## 1. Un proyecto de Google Cloud

1. En la consola de Google Cloud, crea un proyecto, por ejemplo «CRM».
2. En **APIs y servicios › Biblioteca**, habilita: Google Ads API, Google Analytics Data API y Google Search Console API.

## 2. Google Ads: OAuth y token de desarrollador

1. **Token de desarrollador:** en la cuenta de administrador (MCC) de Google Ads, ve a **Herramientas › Centro de API**, rellena el formulario y pide el acceso **Básico**. Con el de prueba solo se ven cuentas de prueba. Google tarda unos días en aprobarlo.
2. **Cliente OAuth:** en el proyecto de Cloud, configura la **Pantalla de consentimiento** y luego **Credenciales › Crear credenciales › ID de cliente de OAuth › Aplicación web**. La dirección de retorno la dará el CRM cuando exista la pantalla.
3. Apunta también el **ID de cliente** de cada cuenta de Google Ads (`123-456-7890`) y el de la MCC.

Google Ads no admite cuentas de servicio (salvo con delegación de dominio en Workspace): se conecta con OAuth, con un usuario que vea las cuentas.

## 3. Analytics (GA4) y Search Console: una cuenta de servicio

1. En el proyecto de Cloud, ve a **IAM y administración › Cuentas de servicio › Crear** (por ejemplo «crm-lectura») y crea una clave JSON. **Ese fichero es un secreto**: va al servidor, nunca a un chat.
2. **GA4:** en Analytics, **Administrar › Gestión del acceso a la propiedad › Añadir usuarios**, con el correo de la cuenta de servicio y el rol **Lector**. En cada propiedad, y apunta su **ID de propiedad**.
3. **Search Console:** **Configuración › Usuarios y permisos › Añadir usuario**, con el mismo correo y permiso **Restringido**. En cada propiedad, y apunta su dirección.

## 4. Para el responsable técnico

`GOOGLE_OAUTH_CLIENT_ID` y `GOOGLE_OAUTH_CLIENT_SECRET` son las variables del servidor para el cliente OAuth. Hasta que se programe la pantalla, no hay nada más que encender.
