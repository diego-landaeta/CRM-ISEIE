# local_crm · el plugin del CRM para Moodle (#679)

Une la mensajería de cada campus con el CRM:

- **Del campus al CRM, al momento.** Cada mensaje privado que se envía en el campus
  llega al CRM, firmado con la clave de ese campus.
  - Si es de un alumno a una tutora o a cualquier persona del campus, entra en
    **Consultas**.
  - Si lo escribe una tutora del CRM, cuenta como su respuesta.
  - Los mensajes privados entre alumnos no salen del campus: el plugin solo avisa de
    un privado si quien escribe o quien lo recibe es personal del campus.
- **Y los de grupo (1.9.0).** El chat de grupo de cada alumno con las tutoras de su curso
  («Entrar al chat») y cualquier conversación de grupo de un curso en la que esté una
  tutora de ese curso (la de un grupo del curso, por ejemplo).
- **Del CRM al campus, como la tutora.** La respuesta escrita en el CRM sale en la
  conversación del alumno (o en su chat de grupo) con el nombre de la tutora. No hace
  falta el token personal de cada tutora.
- **«Mi campus» de la tutora.** El servicio del plugin incluye las funciones con las
  que el CRM lee cursos, alumnos y entregas sin corregir. Desde la 1.10.8 (#769), también
  la lista de cursos del campus (`core_course_get_courses_by_field`), para avisar a
  administración de las entregas de los cursos sin tutora en el CRM.

La lectura cada 5 minutos del CRM sigue funcionando como respaldo. Si un aviso se
pierde, se recoge en la siguiente vuelta.

**Lo que cambia lo que ve el alumno viene apagado de serie (1.10.0, revisión de la #689).**
- En el **CRM**, lo del plugin es solo de pruebas (/testeo y local) hasta que se apruebe con
  `PLUGIN_MOODLE_EN_PRODUCCION=1`: sin eso, en producción no se dan códigos, no se aceptan
  avisos (`/api/moodle-avisos` no existe), no se repasa ningún campus y la respuesta de la
  tutora sale con su token, como antes.
- En el **campus**, el chat de grupo viene apagado; se enciende a mano en los ajustes del
  plugin. La actualización automática, en cambio, viene **encendida** desde la 1.10.6 (de la
  1.10.0 a la 1.10.5 venía apagada): ver «Actualización automática».

| | |
|---|---|
| Componente | `local_crm` (carpeta `local/crm`) |
| Moodle | 4.4 a 5.2 (ISEIE 4.4 · Psiko, Fono e ISAEG 4.5 · ISEIH e ICTESS 5.0 · ISECD, ISSLOGG e ISEF 5.2) |
| Probado | Moodle 4.5.4 en local, instalado desde el panel y conectado con un código, de punta a punta con el CRM (05/11/2026). Chat de grupo (1.9.0): Moodle 4.5.4 (actualizando desde la 1.8.0) y 5.2.4, de punta a punta con dos tutoras y el CRM (09/11/2026) |

## Conectar un campus: dos pasos

Como `local_certifex`: **instalar el plugin y pegar un código**. No hay que crear
servicios ni tokens, ni copiar claves. El plugin lo hace solo.

### 1. Instalar el plugin desde el panel

1. Genera el ZIP: `sh tools/moodle-local-crm/empaquetar.sh` (sale `local_crm-<versión>.zip`).
2. En el campus, entra como administrador y ve a `Administración del sitio › Extensiones ›
   Instalar complementos` (`/admin/tool/installaddon/index.php`).
3. Sube el ZIP y pulsa **«Instalar complemento desde archivo ZIP»**. Cuidado: el otro
   botón se parece y saca de la página.
4. En «Plugins que requieren su atención» **solo** tiene que salir `local_crm`. Si sale
   algo más, para: se arrastraría una actualización que nadie ha pedido.
5. Pulsa «Actualizar base de datos Moodle ahora». Al terminar, Moodle avisa: **«Este
   campus todavía no está conectado con el CRM»**, con el botón **Conectar con el CRM**.

### 2. Pegar el código

1. En el CRM, en `Finanzas › Integraciones`, elige el proyecto. En la ficha
   **Campus (Moodle)**, bloque **Plugin del CRM**, pulsa **Conectar campus**. Sale un
   código: sirve una vez y caduca en 24 horas.
2. En el campus, pulsa **Conectar con el CRM** (o ve a `Extensiones › Extensiones
   locales › Conectar con el CRM`), pega el código y pulsa **Conectar**.

Al pulsar Conectar, el plugin:
- enciende los servicios web y REST;
- crea (la primera vez) el usuario **crm_servicio** con el rol **CRM (servicio)**, que solo
  tiene lo que el CRM usa: leer cursos, matrículas, mensajes y entregas, abrir los
  archivos entregados, y escribir y calificar en nombre de una tutora;
- crea el token de ese usuario (no del administrador que conecta) y revoca los que el
  plugin hubiera dado antes;
- comprueba que el código apunta a un CRM de la lista **CRM permitidos** (de serie,
  `360crm.tech` y `crm.iseie.com`; se cambia en los ajustes del plugin);
- se presenta al CRM.

**Cambiar de CRM pide confirmación (1.10.4).** El plugin habla con UN solo CRM: guarda una
dirección y una clave. Si el campus ya está conectado y el código pegado es de otro CRM
(otra dirección de la API: por ejemplo, producción `360crm.tech/crm` y pruebas
`360crm.tech/testeo`, que comparten dominio y por eso la lista de CRM permitidos no las
separa), «Conectar» no cambia nada: enseña a qué CRM está conectado ahora, de cuál es el
código, y que el de ahora dejará de recibir los mensajes. Solo cambia marcando «Entiendo
que…» y pulsando «Cambiar a…». Con un código del mismo CRM, reconecta sin preguntar, como
siempre. La ficha «Conexión con el CRM» enseña el CRM con su ruta (`360crm.tech/crm
(producción)`), no solo el dominio.

El CRM, por su parte:
- comprueba que es un Moodle de verdad con el plugin;
- guarda la dirección y el token del campus;
- enciende «Leer las consultas»;
- le devuelve su clave.

La pantalla del CRM pasa sola a **«Conectado»**. Nadie ve ni teclea el token ni la clave.

**El cron del campus tiene que ejecutarse cada minuto.** Los avisos salen en una tarea
en segundo plano de Moodle, y sin cron no salen. En Hostinger: cron de hPanel de tipo
«Personalizado», con la ruta completa del PHP
(`/usr/bin/php /home/<usuario>/public_html/campus/admin/cli/cron.php`).

**ISEIH:** el CDN de Hostinger bloquea algunos envíos del panel. Si el instalador o
«Conectar» dan 403, desactiva el CDN en hPanel (`Sitios web › iseih.com › Rendimiento ›
CDN`), hazlo y vuelve a activarlo, igual que con «HTML adicional».

## El chat de grupo con las tutoras del curso (1.9.0)

Lo eligió Carlos (opción B de la #285, 06/11/2026). «Entrar al chat» de la actividad Chat
de cada curso ya no abre la sala: abre **una conversación de grupo por alumno y curso**,
con el alumno y las tutoras de ese curso. Todas ven lo mismo y cualquiera responde, desde
Moodle o desde el CRM.

- **Qué es en Moodle:** una conversación de grupo de la mensajería (componente `local_crm`,
  tipo `consulta`, en el contexto del curso), llamada «Consultas · <curso> · <alumno>». Sale
  en el panel de mensajes, en «Grupo», a todos sus miembros. **No es un grupo del curso**:
  no toca los grupos separados ni la calificación. El plugin apunta cuál es cada una en
  `local_crm_conversaciones`.
- **Quién está dentro:** el alumno (siempre) y las tutoras del curso: rol de profesor (con o
  sin edición) **en ese curso**, con la matrícula activa, sin las cuentas cuyo nombre
  empieza por «Inspector» (se cambia en los ajustes) y sin las que el CRM tiene **«No
  disponible»**. Se repasa al abrir el chat y cada vez que el CRM manda la disponibilidad
  (al cambiar y en el repaso de cada 15 minutos): la «No disponible» sale y, al volver,
  entra otra vez y ve todo el historial.
- **En el CRM** es una consulta: la abre el primer mensaje del alumno; un mensaje de
  **cualquier** tutora de dentro cuenta como respuesta (también de alguien sin ficha en el
  CRM: sale con su nombre del campus); la respuesta desde el CRM aparece en ese chat a
  nombre de la tutora que la escribe (si no estaba dentro y es profesora del curso, entra).
  La consulta sigue teniendo su tutora y su curso para las métricas y «Mi campus»; el
  relevo cambia la tutora de la consulta, ya no la conversación.
- **Si no hay ninguna tutora disponible**, el alumno lo ve dicho; lo que escribe llega igual
  al CRM.
- **Viene apagado** (desde la 1.10.0): se enciende en los ajustes del plugin («Chat de grupo
  con las tutoras del curso»). Apagado, «Entrar al chat» abre la sala de siempre y el plugin
  no toca ninguna conversación de grupo.
- **Lo de antes sigue:** las conversaciones privadas del chat directo (1.6.0 a 1.8.0) siguen
  llegando al CRM. Si el alumno tenía una consulta abierta de ese curso, sigue en su chat de
  grupo y la respuesta va al grupo.

**También las demás conversaciones de grupo de la tutora** (#285, Diego): cualquier
conversación de grupo de un curso en la que esté una tutora de ese curso (la de un grupo del
curso con la mensajería de grupo encendida, por ejemplo) llega al CRM, con estas reglas:

- Solo responde una **profesora de ese curso**; ser personal del campus no basta. Quien no lo
  es, escribe como alumno.
- Lo que escribe un alumno abre **su propia consulta** («Grupo del curso» en el CRM), que no se
  mezcla con su chat con las tutoras ni al revés. No manda correo a la tutora, y se asigna
  solo a una tutora que esté dentro de esa conversación.
- Una consulta **cerrada no se reabre** con lo que escribe el alumno en el grupo (ahí los
  alumnos también hablan entre ellos): el mensaje queda dentro como contexto. Para una duda
  nueva tiene su chat con las tutoras, que sí reabre.
- Lo que escribe una tutora es la respuesta a la consulta de esa conversación que espera, si
  solo hay una. Con varias esperando, queda como contexto en la que más lleva esperando, sin
  darla por respondida.
- La respuesta desde el CRM sale en esa conversación, que **leen todos sus alumnos**: el CRM
  lo avisa encima de la caja de respuesta. Ahí el plugin no añade ni quita a nadie.

**La sala del Chat (`mod_chat`) no entra en el CRM.** Con el chat de grupo, «Entrar al chat»
ya no lleva a la sala; lo que se escribiera en ella (entrando por la dirección a mano) no llega.

**Antes de instalarlo en un campus que ya tenía el bloque de chat en el pie**
(`additionalhtmlfooter`, bloque `<!-- ===== CHAT: consulta por mensajeria…`, hoy en Psiko,
ISEIH, ISAEG e ISEIE): **quitar ese bloque**. Los dos cambian el mismo botón y chocan.
El plugin hace lo mismo sin el mapa a mano y vale también para los cursos con varias tutoras.

## Se actualiza solo (1.7.0)

Cada noche (entre las 3 y las 5) el plugin pregunta al CRM si hay versión nueva. Si la
hay y **está firmada por el CRM**, guarda una copia de la instalada, pone la nueva y la
actualiza; si algo falla, vuelve a la copia. En «Conectar con el CRM» se ve la versión, lo
último que pasó y el botón «Buscar actualización ahora». **Viene encendido** (1.10.6) y se
apaga en los ajustes («Actualizar el plugin solo»), campus a campus. Apagado, solo avisa de
que hay versión nueva.

De la 1.10.0 a la 1.10.5 venía apagado (revisión de la #689) y la 1.10.0 lo apagó también
en los campus que ya tenían el plugin. Al actualizar a la 1.10.6 se **enciende** en todos,
salvo donde alguien lo apagó a mano: si el último cambio del ajuste guardado en la página de
ajustes (registro de cambios de configuración de Moodle, `config_log`) fue de encendido a
apagado, se queda apagado. Lo que apagó la propia 1.10.0 no cuenta como «a mano». Si un
campus no lo quiere, se apaga después de actualizar y ya no se vuelve a encender solo.

Es seguro dejarlo encendido sin que nadie lo mire porque:
- solo instala lo que trae la **firma del CRM** (RSA sobre componente, versión y huella del
  ZIP) que reconoce la clave pública de `crm/classes/claves.php`; una versión sin firma o con
  el manifiesto alterado no se instala («no trae una firma válida»);
- solo habla con el CRM al que está conectado el campus;
- guarda copia de la versión instalada y vuelve a ella si la actualización falla.

No instala nada si la firma no cuadra, si el sitio tiene `$CFG->disableupdateautodeploy`
o si Moodle no puede escribir en `local/crm`: en esos casos avisa de que hay versión nueva
para instalar a mano.

**Publicar una versión** (en el servidor del CRM):

1. Subir `version` y `release` en `crm/version.php`.
2. `cd backend && npm run plugin:publicar` → deja el ZIP firmado y `manifiesto.json` en
   `backend/plugin-moodle/` (o `PLUGIN_MOODLE_DIR`), que es lo que sirve
   `/api/moodle-avisos/plugin/ultima`.

**La clave de firma (una vez, antes de producción):**

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out plugin-moodle-privada.pem
openssl pkey -in plugin-moodle-privada.pem -pubout -out plugin-moodle-publica.pem
```

- La **privada**, solo en el servidor del CRM: `PLUGIN_FIRMA_CLAVE_ARCHIVO=/ruta/plugin-moodle-privada.pem`.
  Nunca en el repo.
- La **pública**, dentro del plugin: `crm/classes/claves.php`. Hoy lleva una clave de
  **pruebas locales**: hay que cambiarla por la de producción antes de instalarlo en los
  campus (si no, ninguna versión firmada en producción se instalará sola). Mientras siga la
  de pruebas, `empaquetar.sh` **se niega** a hacer el ZIP; para un ZIP de pruebas a
  sabiendas: `PERMITIR_CLAVE_PRUEBAS=1 sh tools/moodle-local-crm/empaquetar.sh`.

## Siempre al día con el campus (1.8.0)

Cada mensaje llega al CRM al momento (el aviso). Además, **cada 15 minutos** el CRM repasa
cada campus: le pide al plugin los mensajes privados y de grupo desde el último que vio y mete lo que
falte (lo repetido se descarta solo). Así, aunque se pierda un aviso (el CRM caído más de lo
que Moodle reintenta, el campus desconectado un rato), en 15 minutos como mucho está al día.
En el mismo repaso le vuelve a mandar la lista de tutoras «No disponible».

En el CRM, en Integraciones, el bloque del plugin dice «Al día · repasado a las … · plugin 1.8.0»,
o el error y cuándo fue el último repaso bueno.

Con el plugin al día, la **lectura de cada 5 minutos** del CRM (la de antes del plugin, con
los tokens) **se salta ese campus** (#689): ya entra por el aviso y por el repaso, y leerlo
además era leerlo tres veces. «Al día» es plugin activo, sin error en el repaso y con un
repaso bueno en los últimos 35 minutos (dos repasos y cinco de margen). Si deja de estarlo
(plugin desconectado, token revocado, Moodle caído), la lectura de 5 minutos vuelve a
leerlo sola. Con el plugin apagado en el CRM (`PLUGIN_MOODLE_EN_PRODUCCION`) o el repaso
apagado (`MOODLE_SINCRONIZACION_DISABLED=1`) se leen todos, como antes. «Leer ahora», en
Consultas, lee siempre.

## Probar en local con Docker

Hay un Moodle 4.5 de pruebas con datos inventados y la lista de lo que hay que probar en
[`pruebas/README.md`](pruebas/README.md).

## Comprobar que funciona

- **Del alumno al CRM:** el alumno entra por «Entrar al chat», escribe en su chat de grupo y,
  en menos de un minuto, la consulta aparece en el CRM («Chat de grupo», con quién está dentro).
- **Dos tutoras:** las dos ven el chat en su panel de mensajes (en «Grupo») y responden; en el
  CRM salen las dos respuestas, cada una con su nombre, y la consulta pasa a «Respondida».
- **Del CRM al alumno:** la tutora contesta desde el CRM («Le llega al alumno en el
  campus») y el alumno lo ve en el campus como mensaje de ella.
- **De Moodle al CRM:** la tutora contesta desde el campus y la respuesta aparece en el
  CRM.

## Si algo no va

| Síntoma | Causa y arreglo |
|---|---|
| «Ese código ya se ha usado» o «ha caducado» | Genera otro en el CRM: es de un solo uso y dura 24 horas. |
| «El CRM no ha podido entrar en el campus» | El CRM no llega al Moodle con la dirección que este dice tener (`wwwroot`), o un cortafuegos o CDN lo bloquea. |
| El CRM sigue en «sin mensajes todavía» | El cron no se ejecuta cada minuto. En `Administración › Servidor › Tareas › Tareas ad hoc` se ven las pendientes de `local_crm` con su error. |
| La respuesta no llega: «La tutora no tiene su usuario del campus» | En el CRM, abre `Tutores`, la tutora, `Campus` y pulsa `Comprobar`: así se guarda su usuario de Moodle. |
| La respuesta no llega: «Solo se puede enviar como personal del campus» | Esa persona no tiene rol de profesor ni de gestor en el campus. |
| «Invalid permissions detected when trying to create a directory» | Alguien ejecutó un comando de Moodle (`admin/cli/…`) como root y dejó carpetas de `moodledata` que el servidor web no puede escribir. Devuélvelas al usuario del servidor web (`chown -R`) y ejecuta los comandos siempre como ese usuario. |
| El CRM ve a menos alumnos de los que hay | Curso con grupos separados: una profesora sin permiso de edición solo ve, y solo califica, a los alumnos de sus grupos (como en Moodle). |

## Seguridad

- **Avisos firmados.** Cada aviso lleva la cabecera
  `X-Crm-Firma: t=<unix>,v1=HMAC-SHA256(clave, "<t>.<cuerpo>")`. El CRM rechaza los que
  no cuadran o tienen más de 5 minutos. La clave es propia de cada campus.
- **Código de conexión.** Es de un solo uso y caduca en 24 horas. El CRM solo guarda su
  huella (sha256). El token del campus no se manda nunca por http: el plugin lo exige
  https, salvo un CRM de pruebas en la misma máquina.
- **El token no es de un administrador.** Es del usuario `crm_servicio`, que no puede
  administrar el sitio. Si se filtra, sirve para leer lo que lee el CRM, no para cambiar
  Moodle. Desconectar lo revoca.
- **Solo CRM de confianza.** Un código lo puede fabricar cualquiera: el plugin solo se
  conecta a los CRM de su lista, así que un código falso no se lleva el token.
- **Cambiar de CRM, solo confirmado** (1.10.4). Un código de otro CRM no desconecta el
  campus del de ahora sin una confirmación expresa en la página del plugin.
- **Enviar y calificar en nombre de la tutora.** `local_crm_enviar_mensaje` y
  `local_crm_calificar` exigen `local/crm:enviarcomo`, que solo tiene el rol del servicio.
  Al calificar se comprueba que la tutora puede calificar esa tarea y, con grupos
  separados, que el alumno es de su grupo. Solo envía **como personal del campus** (tutor, profesor o
  gestor), nunca como un alumno. **Nunca como el administrador del sitio** (1.10.1): ni envía ni
  califica como él aunque tenga rol de profesor, y sus mensajes no cuentan como «personal».
  Desde la 1.10.2 el CRM tampoco lo vincula a una tutora: pregunta con `local_crm_cuenta`
  (solo lectura: si la cuenta existe y si es administradora del sitio). Los rechazos llevan
  el motivo en el mensaje del error, que llega al CRM con la depuración apagada.
- **Si el CRM está caído.** Cada aviso es una tarea de Moodle: si el CRM no contesta o
  falla, se reintenta sola. Si el CRM lo rechaza (campus desconectado, clave cambiada),
  no se reintenta. Lo que se escribe a una tutora mientras el campus está desconectado
  lo recoge la lectura del CRM al volver a conectar.
- **Datos personales.** El plugin guarda en Moodle de qué curso es cada conversación del
  chat directo (`local_crm_chat`) y cuál es el chat de grupo de cada alumno y curso
  (`local_crm_conversaciones`); los mensajes son de la mensajería de Moodle. Lo declara, lo
  exporta y lo borra con la API de privacidad (los chats de grupo, en el contexto del curso,
  con la de la mensajería). Los mensajes los manda al CRM, y también lo declara.

## Desconectar o desinstalar

- **Desconectar:** en el CRM, **Desconectar** en el bloque del plugin; en el Moodle,
  «Desconectar este campus del CRM».
- **Desinstalar:** `Extensiones › Vista general de extensiones › CRM › Desinstalar`.

Después, las respuestas desde el CRM vuelven a salir con el token de cada tutora, si
lo tienen.
