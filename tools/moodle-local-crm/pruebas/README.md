# Probar el plugin y el CRM en local, con Docker

Un Moodle 4.5 de pruebas con datos inventados (tutoras, alumnos, un curso con tareas y
entregas) para probar de punta a punta el chat de grupo, «Mi campus», corregir desde el CRM,
el repaso y la actualización automática. **Solo local**: las contraseñas de aquí son de este
Moodle de pruebas y no sirven en ningún otro sitio.

Los campus van en tres versiones, y hay un entorno para cada una:

| Moodle | Campus | Archivo | Dirección |
|---|---|---|---|
| 4.5 | ISAEG, Fono, Psiko | `docker-compose.yml` | http://localhost:8085 |
| 5.0 | ISEIH | `docker-compose.moodle50.yml` | http://localhost:8086 |
| 5.2 | ISECD, ISEF | `docker-compose.moodle52.yml` | http://localhost:8087 |

Probado el 06/11/2026 de punta a punta en los tres: chat directo, relevo, respuesta desde el
CRM, repaso sin duplicados, «Mi campus», corregir y la actualización automática (y que una
firma falsa no se instala). El chat de grupo (1.9.0), el 09/11/2026 en 4.5 (actualizando desde
la 1.8.0) y 5.2: alumno, dos tutoras desde Moodle, respuesta desde el CRM, «No disponible» que
sale y vuelve, y la conversación de un grupo del curso.

## 1. Levantar el Moodle

```bash
docker compose -f tools/moodle-local-crm/pruebas/docker-compose.yml up -d
# o, cada uno con su nombre para que no se pisen:
docker compose -p moodle50 -f tools/moodle-local-crm/pruebas/docker-compose.moodle50.yml up -d
docker compose -p moodle52 -f tools/moodle-local-crm/pruebas/docker-compose.moodle52.yml up -d
```

Tarda unos minutos la primera vez. Usuario `admin`, contraseña `AdminLocal-679!`.

**Moodle 5.x no trae el Chat.** Salió del núcleo en la 5.0 y los campus tienen el adicional
`mod_chat` 5.0.0 (github.com/moodlehq/moodle-mod_chat). Hay que instalarlo en `mod/chat`
(en 5.2, `public/mod/chat`) y después `actividad-chat.php`, que además lo ACTIVA: Moodle lo
instala desactivado y la actividad da «Invalid course module ID».

**Moodle 5.2** (desde la 5.1 el código público va en `public/`) no tiene imagen de Bitnami: se
usa la de Moodle HQ, que no trae el código.

```bash
M=moodle52-moodle-1
docker exec $M sh -c "cd /tmp && curl -sSL -o m.tgz https://download.moodle.org/download.php/direct/stable502/moodle-latest-502.tgz \
  && tar -xzf m.tgz && cp -a moodle/. /var/www/html/ && chown -R www-data:www-data /var/www/html /var/www/moodledata"
docker exec $M su -s /bin/sh www-data -c "php /var/www/html/admin/cli/install.php --non-interactive --agree-license \
  --lang=en --wwwroot=http://localhost:8087 --dataroot=/var/www/moodledata --dbtype=pgsql --dbhost=db --dbname=moodle \
  --dbuser=moodle --dbpass=moodle-local --fullname='Campus local CRM 5.2' --shortname=crm52 --adminuser=admin \
  --adminpass='AdminLocal-679!' --adminemail=admin@example.com"
docker restart $M   # para que la imagen sirva desde public/
```

En ese Moodle: el plugin va en `public/local/crm`, los comandos como `www-data`, los scripts
de datos con `MOODLE_CONFIG=/var/www/html/config.php`, y **no hay cron**: los avisos al CRM
salen al lanzar `php /var/www/html/admin/cli/cron.php --keep-alive=0`.

Con dos Moodle abiertos a la vez en el navegador, los dos están en `localhost` y comparten la
cookie de sesión: entra en cada uno en una ventana privada distinta.

**Los comandos de Moodle, siempre como el usuario del servidor web (`daemon`)**. Si se lanza
alguno como root, Moodle deja carpetas que luego no puede escribir («Invalid permissions
detected when trying to create a directory»); se arregla con
`docker exec <moodle> chown -R daemon:daemon /bitnami/moodledata`.

## 2. Los datos de prueba

```bash
M=$(docker compose -f tools/moodle-local-crm/pruebas/docker-compose.yml ps -q moodle)
docker cp tools/moodle-local-crm/pruebas/. $M:/tmp/pruebas/
for s in preparar alumna2 tareas entrega-archivo; do
  docker exec $M su -s /bin/sh daemon -c "php /tmp/pruebas/$s.php"
done
```

Crea el curso `CRM679` con la tutora **tutora679** (Laura), los alumnos **alumno679**
(Pedro) y **alumna679b** (María), dos tareas y una entrega con PDF. Contraseña de todos:
`Local-679-pass!`. Para más casos:

| Script | Qué añade |
|---|---|
| `casos-limite.php` | Tareas con escala, con flujo de calificación y en grupo; un .html y un .svg en una entrega |
| `segunda-tutora.php` | Carmen (coord679) como segunda profesora del curso y Sofía, tutora de otro curso |
| `actividad-chat.php` | La actividad Chat del curso («Entrar al chat»), y activa el módulo Chat |
| `curso-contenido.php` | Temas y actividades variadas (página, enlace, cuestionario, foro, PDF, tema oculto) |
| `grupos-separados.php poner\|quitar` | Grupos separados con la tutora solo en el Grupo A |
| `mensaje-cli.php <de> <para> "<texto>"` | Un mensaje privado como si se escribiera en el campus (`<de>` y `<para>`: id o nombre de usuario) |
| `grupo-del-curso.php` | El «Grupo A (mensajería)» del curso con la mensajería de grupo encendida: Laura, Pedro y María (su conversación es de `core_group`) |
| `conectar-cli.php <código>` / `desconectar-cli.php` | Conectar o desconectar el campus sin pasar por la página |

## 3. El CRM local apuntando a ese Moodle

En `backend/.env` (además de lo de siempre):

```bash
# La dirección con la que el Moodle del contenedor llega al CRM de tu equipo.
API_PUBLIC_BASE_URL=http://host.docker.internal:3001/api
# Deja conectar un Moodle por http y en la red interna. Solo en local.
MOODLE_PERMITIR_RED_LOCAL=true
# Para probar la actualización automática (clave de PRUEBAS, fuera del repo):
#   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out privada.pem
#   openssl pkey -in privada.pem -pubout -out publica.pem   → pegar en crm/classes/claves.php
PLUGIN_FIRMA_CLAVE_ARCHIVO=/ruta/a/privada.pem
```

En el CRM, crea las tutoras con los mismos correos que en Moodle (`tutora679@example.com`…)
y asígnales el campus en su ficha (Tutores › la tutora › Campus › Comprobar).

## 4. Instalar y conectar el plugin

1. `cd tools/moodle-local-crm && PERMITIR_CLAVE_PRUEBAS=1 bash empaquetar.sh` → `local_crm-<versión>.zip`.
   Desde la 1.10.0, `empaquetar.sh` **se niega** si `crm/classes/claves.php` lleva la clave de
   pruebas; aquí es justo la que queremos, de ahí `PERMITIR_CLAVE_PRUEBAS=1`. Nunca para un campus real.
2. En Moodle: Administración › Extensiones › Instalar complementos › el ZIP.
3. En el CRM: Integraciones › el campus › Campus (Moodle) › **Conectar campus** → copia el código.
   El bloque «Plugin del CRM» sale en local y en /testeo; en producción solo con
   `PLUGIN_MOODLE_EN_PRODUCCION=1`.
4. En Moodle: Extensiones locales › **Conectar con el CRM** → pega el código.
5. En Moodle: Extensiones locales › **CRM**, enciende **«Chat de grupo con las tutoras del curso»**.
   Desde la 1.10.0 viene **apagado de serie**, también al actualizar un campus que lo tenía
   encendido. **«Actualizar el plugin solo»** viene encendido desde la 1.10.6.

## 5. Qué probar

- **Apagado de serie (1.10.0):** recién instalado, sin tocar los ajustes, el alumno no ve «Entrar
  al chat» y la tarea `sincronizar_miembros` no hace nada; al encender «Chat de grupo», sí.
  Actualizando desde la 1.9.0 con los dos ajustes encendidos, después de la actualización
  quedan apagados.
- **Actualización automática encendida de serie (1.10.6):** recién instalada, o actualizando
  desde la 1.10.4 (donde estaba apagada), `php admin/cli/cfg.php --component=local_crm --name=autoactualizar`
  da 1. Si antes se apagó a mano en la página de ajustes (encender, guardar, apagar, guardar),
  se queda en 0.
- **Privados entre alumnos (1.10.0):** `mensaje-cli.php alumno679 alumna679b "hola"` → no llega
  al CRM (ni al momento ni en el repaso). El mismo mensaje a la tutora (`tutora679`), sí.
- **Chat de grupo (1.9.0):** con `segunda-tutora.php` (Laura y Carmen en el curso), como alumno,
  la actividad Chat del curso › «Entrar al chat» → su conversación de grupo «Consultas · <curso> ·
  <alumno>» con las dos (sale en el panel de mensajes, en «Grupo»). Escribe y mira que llega a
  Consultas en el CRM, con la franja «Chat de grupo» y quién está dentro.
- **Dos tutoras:** Laura y Carmen abren su panel de mensajes, ven el chat y responden. En el CRM
  salen las dos respuestas, cada una con su nombre, y la consulta pasa a «Respondida».
- **Responder desde el CRM** y ver que llega al chat de grupo a nombre de la tutora (sin duplicados).
- **No disponible:** marca a Laura «No disponible» en su ficha del CRM → tras la tarea
  `\local_crm\task\sincronizar_miembros` sale del chat; al volver a «Disponible», entra otra vez y
  ve el historial. La consulta cambia de tutora con el siguiente mensaje del alumno (no de chat).
- **Grupo del curso:** `grupo-del-curso.php` y escribe en la conversación del «Grupo A» como
  alumno y como Laura: llega al CRM como una consulta aparte, y lo de Laura cuenta como respuesta.
- En Moodle 5.2 (sin cron) los avisos salen con
  `php admin/cli/adhoc_task.php --execute --classname='\local_crm\task\avisar_crm'` (como `www-data`).
- **Notas internas** y **respuestas guardadas / del campus** (Consultas › Respuestas del campus).
- **Mi campus** de la tutora: por corregir, dudas, alumnos sin entrar, «Ver el curso completo».
- **Corregir desde el CRM:** nota y comentario (aparecen en Moodle a su nombre); las tareas con
  escala o en grupo mandan a Moodle; un .html o .svg entregado se descarga, no se abre.
- **CRM caído:** con el backend parado, un alumno escribe → al arrancar, Moodle reintenta y llega.
- **Aviso perdido y repaso:** borra el aviso pendiente
  (`DELETE FROM mdl_task_adhoc WHERE classname LIKE '%avisar_crm%'`) y espera al repaso de 15
  minutos (o `MOODLE_SINCRONIZACION_TICK_MS` más bajo): el mensaje aparece y no se duplica.
- **Actualización automática:** sube `version`/`release` en `crm/version.php`,
  `cd backend && npm run plugin:publicar`, y en Moodle
  `php admin/cli/scheduled_task.php --execute='\local_crm\task\actualizar_plugin'` (como `daemon`).
  Con el manifiesto alterado a mano, debe decir «no trae una firma válida» y no instalar nada.
