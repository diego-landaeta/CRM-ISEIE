# WhatsApp en el CRM

Guía para quien enlaza un número y para quien toca el código.

Todo lo que hay aquí sale de romperlo en pruebas: cada regla tiene detrás un
fallo concreto que ya pasó.

---

## Lo primero: qué es esto

Cada usuario del CRM enlaza **su propio número** y ve **solo sus
conversaciones**. No hay un WhatsApp común del CRM.

La sesión de cada persona se llama `crm-u<id>` — por ejemplo `crm-u7` para el
usuario 7. Ese nombre **sale del token de sesión**, nunca de nada que mande el
navegador, así que nadie puede pedir la sesión de otro.

Quién puede ver la sesión de quién:

| | |
|---|---|
| **Superadmin** | Cualquiera |
| **Admin** | Solo quien comparta proyecto con él. Un administrador de una marca no tiene por qué leer los mensajes de la gestora de otra |
| **El resto** | La suya y punto. Si piden otra, se rechaza con 403 — no se ignora en silencio |

Cuando se está viendo la sesión de otra persona, **la pantalla lo dice siempre**,
aunque sea la propia. Leer los mensajes de alguien sin que se note es justo lo
que no puede pasar.

Un administrador también puede **enlazar** el número de una gestora — tenerla al
lado con el móvil es más rápido que explicárselo por teléfono. En ese caso queda
escrito que pulsó él, no ella: ver «El aviso» más abajo.

No usamos la API oficial de WhatsApp Business: hablamos el mismo protocolo que
**WhatsApp Web**, con [Baileys](https://github.com/WhiskeySockets/Baileys). Eso
tiene consecuencias, y de ahí sale casi todo lo que viene abajo.

---

## Para quien enlaza un número

### Qué hacer

- **Usa un número de trabajo.** Al enlazar se descarga a la base del CRM lo que
  ese móvil tenga guardado. Solo lo ves tú, pero queda en el servidor de la
  empresa.
- **Deja el móvil con batería y con datos.** No hace falta que esté al lado del
  ordenador, pero si el teléfono se queda sin conexión mucho rato, WhatsApp
  cierra la sesión.
- **Elige «Lo reciente»** salvo que de verdad necesites conversaciones viejas.
  Es la opción por defecto y deja la pantalla usable en segundos.
- **Si alguien pide que no le escribas, márcalo en el chat.** Es la regla que
  más protege el número: lo que hace que WhatsApp suspenda una línea no es tanto
  detectar el cliente como que la gente la bloquee y la reporte.
- **Para desvincular, usa el botón del CRM.** Deja la sesión cerrada del lado de
  WhatsApp y prepara un código nuevo. Quitarlo solo desde el móvil deja al CRM
  reintentando contra una sesión muerta.

### Qué NO hacer

- **No enlaces el mismo número desde dos sitios a la vez.** Dos sesiones con las
  mismas credenciales se pelean, se cierran la una a la otra y el número acaba
  desconectado sin motivo aparente.
- **No pulses «Enlazar» diez veces si tarda.** Cada pulsación puede abrir una
  conexión nueva. El botón ya reintenta solo tres veces y el código se renueva
  cada 18 segundos: espera.
- **No escanees un código de hace rato.** WhatsApp los caduca a los ~20 segundos.
  El CRM da uno nuevo automáticamente; si escaneas uno viejo, el móvil dice «no
  se pudo vincular» sin explicar por qué.
- **No mandes mensajes en ráfaga a gente que no te ha escrito.** Es la forma más
  rápida de que suspendan la línea. El CRM ya se niega a hacerlo, pero no le
  busques la vuelta.
- **No uses el número personal de nadie sin decírselo.** Sus conversaciones
  privadas acaban en la base del CRM.

### Cuánto historial traer

Al enlazar se elige, y **no se puede cambiar sin volver a enlazar** (WhatsApp lo
decide al abrir la sesión, no después):

| Opción | Qué trae | Cuándo usarla |
|---|---|---|
| **Empezar de cero** *(por defecto)* | Nada del pasado, solo lo que llegue a partir de ahora | **Casi siempre.** Es lo que hace falta para trabajar, y lo único que no mete conversaciones antiguas en el servidor de la empresa |
| **El último mes** | Los últimos 30 días | Si vienes atendiendo a gente por ese número y no quieres perder el hilo |
| **Todo el historial** | Todo lo que tenga el móvil, incluido lo personal y los grupos | Piénsatelo. Decenas de miles de mensajes y un buen rato de espera |

El recorte del mes se hace **en el puente, no en el CRM**: lo viejo no llega a
salir del móvil ni a viajar por la red. Antes quedaba en manos de WhatsApp —«lo
reciente» era lo que a él le pareciera— y en un móvil con años de uso llegaban
decenas de miles de mensajes igualmente.

Con «Todo el historial» en un número con años de uso llegan **decenas de miles**
de mensajes por tandas, durante bastante rato. Medido: 76.580 mensajes y 17.894
adjuntos.

### Los archivos viejos

De las conversaciones antiguas **no se descargan todos los archivos**. Con
17.894 adjuntos, bajarlos uno a uno pasaba de la hora — y lo que enviabas en ese
momento se ponía a la cola detrás de todos ellos.

Se bajan siempre:

- Todo lo que llega **ahora**, con prioridad sobre la cola
- Del historial, lo de los **últimos 30 días** (`WA_MEDIA_DIAS`)

Lo demás sale en el chat como **«⬇ Descargar»** y se pide con un clic.

Ojo: **puede que ya no exista**. WhatsApp guarda los ficheros un tiempo limitado
y de las conversaciones viejas suelen haber caducado. En ese caso el CRM lo dice
tal cual en vez de dejar el botón girando.

Los **stickers del historial no se descargan** nunca: eran 12.487 de los 17.894
—el 70% de la cola— para pintar monigotes de hace años.

---

## El aviso antes de enlazar

Antes de que aparezca el código hay que **leer y marcar una casilla**. No es
burocracia: enlazar por esta vía no es la forma oficial de WhatsApp, el número
puede acabar bloqueado, y quien lo pone es una persona con su teléfono.

El aviso dice, con todas las letras, que el número puede acabar bloqueado, que
mejor uno de empresa, que las conversaciones se guardan en el servidor de la
empresa y que la administración puede verlas, y que se puede desvincular cuando
se quiera.

**La casilla no basta por sí sola.** El servidor exige `enterado: true` y
responde 400 sin él, porque una casilla en la pantalla se esquiva llamando al
endpoint a mano.

Cada aceptación deja una línea en `wa_consentimientos` (migración 129) con:

- **De quién es** la línea y **quién pulsó**. Casi siempre el mismo, pero si un
  administrador enlaza el número de una gestora, ella **no leyó el aviso** — y
  esa diferencia es justo lo que hay que poder ver después.
- La **versión del aviso**. Al cambiar el texto se sube `VERSION_AVISO`: hay que
  poder saber qué leyó cada persona, no solo que aceptó algo alguna vez.
- Desde dónde: IP y navegador.

No hay índice único por usuario a propósito. Desvincular y volver a enlazar seis
meses después son dos decisiones distintas y las dos quedan escritas.

## El secreto del webhook

Es **obligatorio en producción**. Sin él se responde 503 y no se procesa nada.

Antes era «si está puesto», y eso dejaba la puerta abierta: esa ruta va antes del
`verifyToken` —la llama el contenedor, no un navegador—, así que olvidarse de la
variable permitía a cualquiera que supiera la dirección meter mensajes inventados
en la conversación de una gestora. Es el mismo agujero que ya hubo con Stripe.

Puede llegar de dos formas y **hacen falta las dos**: en la cabecera
`x-webhook-secret`, que es lo natural, o dentro de la propia dirección. Lo
segundo no es un capricho — el webhook **global** de Evolution, que es como está
montado, solo deja configurar una dirección y no permite mandar cabeceras
propias. Con el secreto obligatorio y solo por cabecera, Evolution habría llamado
sin ella y el CRM habría rechazado **todos** los mensajes entrantes.

No es peor: esa llamada va del contenedor al CRM por la red interna de la
máquina, no sale a internet.

## Los frenos (y por qué no se tocan)

El CRM se niega a enviar en tres casos. No son burocracia: son lo que evita que
suspendan la línea.

1. **A quien pidió que no le escribieran.** Ni con plantilla, ni «solo una última
   vez».
2. **A quien no es prospecto y nunca ha escrito.** Si ese número no salió de un
   formulario nuestro, escribirle es escribir en frío.
3. **Cuando se va demasiado rápido.** 6 por minuto, 60 por hora, 300 al día
   (`WA_TOPE_MINUTO`, `WA_TOPE_HORA`, `WA_TOPE_DIA`), más una pausa de 1,5
   segundos entre mensajes seguidos.

Los topes son **por número**: lo que mande un compañero no te frena a ti.

Y cuentan **solo lo que envía el CRM**. Esto costó un fallo: al enlazar, todo lo
que esa persona había escrito desde su móvil entra como saliente, y el freno lo
contaba como si lo hubiera disparado el CRM. Con 341 mensajes del propio
historial ya saltaba «llevas 341 hoy, se retoma mañana» sin haber enviado ni uno
desde el CRM. Ahora solo cuenta lo que lleva firma de usuario (`enviado_por`).

---

## Para quien toca el código

### La forma

```
Navegador ──▶ CRM (Express) ──▶ puente/Evolution ──▶ WhatsApp
                  ▲                    │
                  └──── webhook ───────┘
```

El CRM habla con un servicio que expone los endpoints de **Evolution API**. En
el VPS es Evolution en Docker; en local es un puente con Baileys que imita esos
mismos endpoints, porque Docker no arranca en todas las máquinas.

El CRM no distingue cuál de los dos hay detrás.

### Reglas al tocar esto

- **La instancia sale del token, nunca del cuerpo de la petición.** Si algún día
  se acepta un `instancia` que manda el cliente, se acabó el aislamiento entre
  usuarios.
- **Toda ruta con `:id` de conversación pasa por `miConversacion(req, id)`.**
  Comprueba que es de quien la pide y contesta **404, no 403** — un 403
  confirmaría que ese chat existe.
- **El webhook exige `instance`.** Sin ella no se sabe de quién es el mensaje: se
  descarta con un aviso en vez de guardarlo en una sesión de nadie.
- **Nada de descargar adjuntos dentro del webhook.** Se hizo y fue el fallo más
  caro: al emparejar llegan miles de mensajes, y por cada uno el CRM le pedía el
  fichero de vuelta al mismo servicio que se los estaba mandando. Se saturó la
  cola de conexiones y **se perdieron 2.463 mensajes**. Va en una cola aparte, de
  uno en uno, con pausa.
- **Cuidado con los sockets viejos.** Cerrar el WebSocket no basta: hay que
  quitarle los manejadores antes. Si no, su evento `close` llega después, marca
  la sesión como caída y programa una reconexión que mata al socket bueno —
  bucle infinito de conectar/desconectar cada 3 segundos con el error 428.
- **El `<img>` no manda cabeceras.** Los adjuntos van por URL firmada (HMAC con
  `JWT_SECRET`), no por token. Y la firma se redondea a tramos de cuarto de hora:
  si cambia en cada refresco, el navegador se rebaja todas las fotos del chat
  cada cinco segundos.
- **El servidor firma el permiso; el frontend arma la dirección.** El CRM cuelga
  de `/crm/` o de `/testeo/`, y una ruta absoluta puesta por el servidor no
  existe para el navegador.

### Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `EVOLUTION_URL` | — | Dónde escucha Evolution o el puente |
| `EVOLUTION_API_KEY` | — | Su clave |
| `EVOLUTION_INSTANCIA` | `crm` | **Prefijo** de las instancias, no el nombre |
| `EVOLUTION_WEBHOOK_SECRET` | — | Secreto del webhook. **Obligatorio en producción** |
| `WA_TOPE_MINUTO` / `_HORA` / `_DIA` | 6 / 60 / 300 | Topes de ritmo |
| `WA_PAUSA_MS` | 1500 | Espera entre mensajes seguidos |
| `WA_MEDIA_DIAS` | 30 | Cuánto historial de adjuntos se baja solo |
| `UPLOADS_DIR` | `/var/crm-uploads` | Dónde se guardan los archivos |

### Base de datos

`wa_conversaciones` y `wa_mensajes` (migración 128). La columna `instancia` es la
que separa a unos usuarios de otros, con `UNIQUE (instancia, jid)`.

**No hizo falta migración para el multiusuario**: el id del usuario va dentro del
nombre de la instancia, así que la columna que ya existía sirvió tal cual.

Los mensajes se deduplican por `wa_id` (índice único parcial), así que volver a
enlazar **no duplica** nada: las conversaciones se reutilizan por `jid` y los
mensajes ya guardados se ignoran.

### Límites conocidos

- **El historial solo llega al emparejar.** Al reconectar, WhatsApp no lo
  reenvía. Si se pierde la sincronización a medias, hay que desvincular y volver
  a enlazar.
- **Para descifrar un adjunto hace falta el mensaje original**, y el puente lo
  guarda en memoria con un tope de 20.000. Con «Todo el historial» en un número
  grande, los adjuntos más viejos dejan de poder recuperarse.
- **Nota de voz desde el navegador**: se graba en `audio/ogg;codecs=opus` cuando
  el navegador puede, y si no en webm/opus. Sin verificar contra WhatsApp real.
