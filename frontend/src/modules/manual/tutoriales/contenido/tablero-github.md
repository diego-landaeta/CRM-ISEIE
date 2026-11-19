Con esto, cada issue de GitHub tiene su tarjeta en el tablero de tareas del CRM, y sus cambios (comentarios, cierre, PR) llegan solos por un webhook. Lo que no tiene responsable lo lleva el supervisor.

> [!aviso] **Hoy (18/11/2026):** el tablero de tareas está en uso. La conexión con GitHub no se ha comprobado en ISEIE: si la pestaña «GitHub» dice que está apagado en el servidor, lo está.

## 1. Configurar en el CRM

1. Ve a **Equipo de Desarrollo › «Configurar tablero»** › pestaña **«GitHub»**. Pide el permiso «Conectar con GitHub», que de serie solo tiene el superadmin.
2. Rellena:

- «Equipo de las tareas».
- «Supervisa (y lleva lo que no tiene responsable)».
- «Copia privada de la empresa (dueño/repositorio)».
- «Secreto del webhook (el mismo que en GitHub)»: una cadena larga al azar que te inventas.
- «Token de solo lectura (para importar)»: en GitHub, Settings › Developer settings › Fine-grained token, con lectura de Issues y Pull requests del repositorio.

3. Pulsa **«Guardar cifrado»**.
4. En «Quién es quién en GitHub», empareja cada usuario de GitHub con su persona del CRM.

## 2. El webhook en GitHub

1. En el repositorio, ve a **Settings › Webhooks › Add webhook**.
2. En «Payload URL», pon la dirección que enseña la pestaña «GitHub» del CRM.
3. En «Content type», elige `application/json`. En «Secret», el mismo secreto que guardaste en el CRM.
4. Eventos: Issues, Issue comments y Pull requests.

## 3. Para el responsable técnico

- `GITHUB_TABLERO_ACTIVO` enciende la conexión. Sin él, la dirección del webhook no existe y la pestaña dice que está apagado en el servidor. **Hoy, sin comprobar.**
- El tablero también tiene que estar encendido (`TAREAS_EN_PRODUCCION`). **Hoy, encendido.**
- Las issues que ya existen se importan una vez desde el servidor, con el guion de importar del tablero.
