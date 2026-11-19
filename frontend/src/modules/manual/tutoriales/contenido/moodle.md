El CRM se conecta a Moodle de tres formas, y cada una tiene su sitio:

- [la conexión del campus](#1-conexion-del-campus), para los tutores y las consultas de alumnos;
- [la conexión del panel de cursos](#2-conexion-del-panel-de-cursos-y-del-mcp), para el MCP;
- [el plugin del CRM](#3-plugin-del-crm), que se instala en el Moodle.

## 1. Conexión del campus

**En Moodle**, con un usuario administrador:

1. En **Administración del sitio › Servidor › Servicios web**, habilita los servicios web y el protocolo **REST**.
2. En **Servicios externos › Agregar**, crea un servicio, por ejemplo «CRM», con estas funciones:

- Siempre: `core_webservice_get_site_info` y `core_user_get_users_by_field`.
- Para las consultas de alumnos: `core_message_get_conversations`, `core_message_get_conversation_messages`, `core_enrol_get_users_courses` y `core_enrol_get_enrolled_users`.
- Para las entregas sin corregir: `mod_assign_get_assignments`, `mod_assign_get_submissions`, `mod_assign_get_grades` y `core_course_get_courses_by_field`.

3. En **Gestionar fichas (tokens) › Añadir**, crea un token del servicio para un usuario **administrador**. Tiene que serlo porque el CRM lee los mensajes de todos.

**En el CRM:**

1. Ve a **Configuración › Integraciones › tarjeta «Campus (Moodle)»**.
2. Rellena «Dirección del campus» y «Token del campus».
3. Marca «Leer las consultas de este campus» si se quieren traer las consultas.
4. Pulsa «Guardar» y luego «Probar conexión».

> [!ok] **Para saber si funciona:** en Integraciones, «Salud de las conexiones» › **«Comprobar ahora»**. La tabla dice si el Moodle está conectado, caído o sin configurar.

## 2. Conexión del panel de cursos y del MCP

Es otra conexión, guardada aparte. Solo la puede hacer quien tiene el permiso «Conectar un Moodle» (de serie, el superadmin).

1. Ve a **Configuración › «Moodle»** › «Pendientes de conectar» › «Conectar».
2. En Moodle, crea un servicio con estas funciones: `core_course_get_courses_by_field`, `core_course_get_categories`, `core_enrol_get_enrolled_users`, `core_course_get_contents`, `mod_url_get_urls_by_courses` y, si se quiere, `core_completion_get_course_completion_status`.
3. Habilítalo con «solo usuarios autorizados» y crea un token.
4. En el CRM, rellena «Dirección de su Moodle» y «Token de servicio web» y pulsa **«Probar y conectar»**.

## 3. Plugin del CRM

Con el plugin (`local_crm`), el Moodle avisa al CRM al momento, en lugar de esperar al repaso, y la tutora responde a través del CRM.

> [!aviso] **Hoy (18/11/2026) está apagado.** Cuando se encienda, sale el bloque «Plugin del CRM» en la tarjeta «Campus (Moodle)».

1. En el Moodle de ISEIE, ve a **Administración del sitio › Extensiones › Instalar complementos** y sube el ZIP `local_crm` que publica el responsable técnico.
2. En el CRM, tarjeta «Campus (Moodle)» › bloque «Plugin del CRM», pulsa **«Conectar campus»**. Sale un código de un solo uso, con fecha de caducidad.
3. En Moodle, ve a **Extensiones › Extensiones locales › «Conectar con el CRM»**, pega el código y pulsa «Conectar».

## 4. Para el responsable técnico

- `PLUGIN_MOODLE_EN_PRODUCCION` enciende el plugin. **Hoy, apagado.** Antes hay que publicar el ZIP firmado.
- La conexión del campus y la del panel de cursos no tienen interruptor: se configuran en la web.
