# Estado y pendientes

Al 12 de agosto de 2026. Los diagramas se dibujan solos en GitHub.

Dos CRMs con **paridad absoluta**: lo que se hace en uno se hace en el otro,
salvo la marca y las rutas.

| | MultiCRM | ISEIE |
|---|---|---|
| Producción | `360crm.tech/crm/` | `crm.iseie.com` |
| Pruebas | `360crm.tech/testeo/` | `crm.iseie.com/staging/` |
| Proyectos | 9 | 1 |

---

## Dónde está cada cosa

```mermaid
flowchart LR
  subgraph PROD["🟢 En producción · los dos CRMs"]
    direction TB
    P1["Tutores<br/>alta · cursos · simulación"]
    P2["Facturación<br/>series · proformas · cuotas"]
    P3["Prospectos · Ventas<br/>Clientes · Matrículas"]
    P4["Stripe<br/>cobros y asociación"]
    P5["Meta Ads<br/>sincronización cada 3 h"]
  end

  subgraph STAG["🟡 Solo en pruebas"]
    direction TB
    S1["WhatsApp<br/>salas · plantillas · equipo"]
    S2["Tasa de cierre<br/>una sola definición"]
    S3["Stripe: factura desde<br/>el alta del proyecto"]
  end

  subgraph FALTA["🔴 Sin construir"]
    direction TB
    F1["Cálculo real<br/>de comisiones"]
    F2["Liquidar<br/>marcar como pagadas"]
    F3["Reembolsos<br/>revertir comisión"]
    F4["Proceso comercial<br/>qué toca hoy"]
  end

  STAG -->|"validar y subir"| PROD
  FALTA -->|"construir"| STAG

  classDef verde fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef ambar fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef rojo fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class P1,P2,P3,P4,P5 verde
  class S1,S2,S3 ambar
  class F1,F2,F3,F4 rojo
```

WhatsApp viaja en el mismo build que todo lo demás, pero **no se enseña en
producción**: `VITE_MODULOS_APAGADOS=whatsapp`. Se enciende quitando esa línea
y recompilando.

---

## Tutores · por qué todavía no paga

Está en producción y funciona, pero **es una simulación**. El dinero no existe
hasta que se cierre el camino entero:

```mermaid
flowchart TD
  A["Cobro de un alumno<br/>conversion_payments"] --> B{"¿La venta dice<br/>qué formación es?"}
  B -->|"no · 7 ventas con cobros de agosto"| X["No genera comisión<br/>y nadie se entera"]
  B -->|"sí"| C{"¿Hay un tutor<br/>en esa formación?"}
  C -->|"no"| X
  C -->|"sí"| D["Comisión = % × lo cobrado<br/>desde SU fecha de inicio"]
  D --> E["tutor_commissions"]
  E --> F["Liquidar: marcar pagada"]
  G["Reembolso en Stripe"] --> H["Revertir la comisión"]

  classDef hecho fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef falta fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef aviso fill:#fef3c7,stroke:#d97706,color:#78350f
  class A,B,C,D hecho
  class E,F,G,H falta
  class X aviso
```

**Verde** existe y está probado. **Rojo** no está escrito: `tutor_commissions`
es una tabla vacía en la que nadie escribe nunca, no hay forma de marcar una
comisión como pagada, y revertir por reembolso es imposible hoy porque
`conversion_refunds` no guarda a qué pago corresponde.

### Lo que hay que atar a mano

Como los tutores empiezan en agosto, **el histórico da igual**. Solo importan
las ventas que reciben cobros desde el 1 de agosto:

| | Ventas a atar | Dinero | De ellas, con nombre que casa con el catálogo |
|---|---|---|---|
| ISEIE | 6 | 1.347,34 € | 3 |
| MultiCRM | 1 | 133,33 € | 0 |

Las otras cuatro nombran cursos que **no existen en el catálogo**: «Apostilla de
la HAYA» (×2), «Máster trasplante capilar» y «Diplomado en Neurociencia
Aplicada». O se crean o se quedan fuera.

---

## Quién hace qué

```mermaid
flowchart TB
  subgraph D["Diego · decidir y probar"]
    D1["Probar tutores en producción"]
    D2["¿Daniela entra en el reparto<br/>de leads de Make?"]
    D3["Los 4 cursos que faltan<br/>en el catálogo"]
    D4["Rotar la contraseña de root<br/>estuvo en el historial de git"]
  end

  subgraph A["Ángel · rama feat/stripe-ia"]
    A1["Crear los proyectos IA"]
    A2["Su clave de Stripe,<br/>una por proyecto"]
    A3["El secreto del webhook<br/>hoy NINGUNO lo tiene"]
    A4["Comprobar que no entra<br/>nada anterior al alta"]
  end

  subgraph C["Claude · construir"]
    C1["Tasa de cierre en pantalla<br/>y su baremo"]
    C2["Cálculo real de comisiones"]
    C3["Liquidar y revertir"]
    C4["Proceso comercial de Carlos"]
  end

  A1 --> A2 --> A3 --> A4
  C1 --> C4
  D1 --> C2
  D3 --> C2
  C2 --> C3

  classDef diego fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  classDef angel fill:#fce7f3,stroke:#db2777,color:#831843
  classDef claude fill:#ccfbf1,stroke:#0d9488,color:#134e4a
  class D1,D2,D3,D4 diego
  class A1,A2,A3,A4 angel
  class C1,C2,C3,C4 claude
```

---

## En qué orden, y qué depende de qué

```mermaid
flowchart LR
  T1["Probar tutores<br/>en producción"] --> T2["Atar las 7 ventas"]
  T2 --> T3["Encender el cálculo<br/>job de reconciliación"]
  T3 --> T4["Liquidar<br/>marcar pagadas"]
  T4 --> T5["Reembolsos"]

  B1["Tasa de cierre<br/>ya calculada"] --> B2["Ponerla en el panel<br/>y quitar la vieja"]
  B2 --> B3["¿De dónde sale?<br/>los sumandos pulsables"]
  B3 --> B4["Baremo<br/>sin puntuar el mes abierto"]
  B4 --> B5["Proceso comercial"]

  W1["Probar la sala<br/>30 mensajes · adjuntar"] --> W2{"¿La latencia<br/>es aceptable?"}
  W2 -->|"sí"| W3["Servidor propio<br/>y una sala por gestora"]
  W2 -->|"no"| W4["Se abandona<br/>y se vuelve a la ventana al lado"]

  classDef listo fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef curso fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef nuevo fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  class B1 listo
  class T1,W1 curso
  class T2,T3,T4,T5,B2,B3,B4,B5,W3,W4 nuevo
```

---

## Lo que muerde si no se mira

```mermaid
flowchart TD
  R1["El webhook de Stripe acepta<br/>eventos SIN comprobar la firma"] --> R1b["Ninguno de los 6 proyectos<br/>tiene webhook_secret.<br/>Quien sepa la URL puede<br/>inventarse un cobro"]
  R2["importe_pagado no cuadra<br/>con los cobros reales"] --> R2b["ISEIE declara 209.930 € de MÁS<br/>MultiCRM, 52.700 € de MENOS.<br/>Las comisiones de las gestoras<br/>salen de ese campo"]
  R3["Un tutor con sesión abierta<br/>puede pedir datos a la API"] --> R3b["El recorte es de pantalla.<br/>Las rutas de la API<br/>todavía no le niegan"]
  R4["Se puede asignar a un tutor<br/>un curso de OTRO proyecto"] --> R4b["No se valida.<br/>Salió al sembrar datos de prueba"]

  classDef riesgo fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef detalle fill:#fef2f2,stroke:#fca5a5,color:#7f1d1d
  class R1,R2,R3,R4 riesgo
  class R1b,R2b,R3b,R4b detalle
```

---

## Media pantalla: lo que se ve pero no funciona

Son las peores, porque **nadie las reporta como error**: se usan, parece que van,
y no hacen nada. Todas comparten la misma causa — el frontal guarda en el
navegador de cada persona porque el backend no existe.

```mermaid
flowchart LR
  subgraph S["Soporte"]
    S1["La gestora abre un ticket"] --> S2["Se guarda en SU navegador"]
    S2 --> S3["No le llega a nadie<br/>ni sale un correo"]
  end
  subgraph W["Plantillas de WhatsApp"]
    W1["Escribe una plantilla"] --> W2["Solo la ve ella"]
    W2 --> W3["Nadie puede revisarlas<br/>ni compartirlas"]
  end

  classDef ve fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef roto fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  class S1,S2,W1,W2 ve
  class S3,W3 roto
```

**Soporte** tiene 836 líneas de pantalla —formulario, lanzador, listado— y
**ningún módulo en el backend**. Su propio código lo dice: «cuando exista
`/api/tickets`…». Falta: tabla, endpoints, envío por Brevo al correo de destino,
adjuntos, y las métricas de cuánto se tarda en responder y en cerrar.

Las **plantillas de WhatsApp** ya están resueltas en la migración 122, pero esa
migración **no se ha aplicado en producción** porque WhatsApp está en espera.

---

## Automatismos de correo · nada de esto existe

Hay siete tareas programadas —Meta, Stripe, WooCommerce, secuencias,
recordatorios…— pero **ninguna de aviso interno**:

| Qué | A quién | Cuándo |
|---|---|---|
| Resumen del día | Gestora y administración | Al cerrar el día |
| Resumen semanal | Dirección | Lunes |
| Aviso de lead sin contactar | Gestora | A los 30 minutos |
| Plan de mañana | Gestora | Por la noche |

Se apoyan en Brevo, que ya está montado en los dos CRMs.

---

## Lo que quedó a medias

| Qué | Estado real |
|---|---|
| **Filtros en Clientes y Matrículas** | Prospectos guarda sus filtros en la URL; Clientes y Matrículas **no tienen ninguno**. Hay que replicar el juego entero |
| **Proformas: asociar a una venta ya creada** | Se puede elegir al emitir; falta el botón para las que ya existen |
| **Menú de Finanzas** | Plan aprobado y sin ejecutar: fusionar Ventas e Ingresos, y Conversiones como pestaña de Análisis |
| **Documento al convertir** | En pruebas de ISEIE; falta validarlo y subirlo a producción en los dos |
| **Modo BETA de ISEIE** | Aplicar el mismo corte al menú cuando se conecte WordPress |
| **Certificados de matrícula** | Usar los textos importados de los productos (módulos, profesores, horas) para el PDF |

---

## La cola larga

Medido, anotado y sin urgencia:

| Qué | Cuánto |
|---|---|
| Cargos de Stripe de 2026 sin enlazar | 501 · 152.098 € |
| Más cargos enlazables por importe y fecha | 241 |
| Teléfonos que `normalizePhone` estropea | 188 |
| Leads de CETLAT con su programa sin cruzar | 382 |
| Segundas cuotas registradas como venta nueva | por barrer |
| Proformas de ICTESS que consumen número de serie | por revisar |
| Tests que fallan por datos de ejemplo | 10 de 180 |
| Carlos no entra desde su WiFi fija | probar por IP directa |

---

## Por dónde seguir

Ordenado por lo que más duele, no por lo que más cuesta:

```mermaid
flowchart TB
  A["1 · Repositorios en privado<br/>y rotar las claves"] --> B["2 · Soporte de verdad<br/>hoy los tickets no le llegan a nadie"]
  B --> C["3 · Tutores: encender el cálculo<br/>y poder liquidar"]
  C --> D["4 · Tasa de cierre en pantalla<br/>y el baremo de Carlos"]
  D --> E["5 · Avisos por correo<br/>resumen del día y SLA"]
  E --> F["6 · Filtros en Clientes<br/>y lo que quedó a medias"]

  classDef urge fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
  classDef pronto fill:#fef3c7,stroke:#d97706,color:#78350f
  classDef luego fill:#e0e7ff,stroke:#4f46e5,color:#312e81
  class A,B urge
  class C,D pronto
  class E,F luego
```

**Por qué en ese orden.** Lo primero no es negociable y no es código. Lo segundo
es lo único que hoy **engaña a quien lo usa**: una gestora escribe un ticket,
ve que se guarda, y no llega a ningún sitio. Lo tercero mueve dinero. Lo demás
mejora, pero nada de lo que hay hoy miente.

---

## Documentos relacionados

- [`tutores-pendiente.md`](tutores-pendiente.md) — el detalle del módulo
- [`tarea-stripe-proyectos-ia.md`](tarea-stripe-proyectos-ia.md) — la tarea de Ángel
- [`PARIDAD-ENTRE-CRMS.md`](PARIDAD-ENTRE-CRMS.md) — qué se copia y qué no

---

## Dónde nos quedamos · 21 de agosto, noche

**En producción, funcionando:** WhatsApp unificado con el panel del admin,
historial de ventas del tutor, rutas en español con redirección, el menú nuevo,
los profesores de Psiko dados de alta con sus comisiones de agosto, y tres
ventas duplicadas de ISEIE cuadradas.

**En pruebas, esperando visto bueno:** el trabajo de Fabián (#31) y el de Ángel
(#45), fusionados sin conflictos. `/testeo` tiene además su propio WhatsApp, con
sesiones `testeo-uN` que no pueden tocar las de producción.

**Esperando a Diego:**
- Las migraciones **129 y 130** en producción. Aplicadas solo en pruebas.
- Las peticiones de cambios **#51** (Ángel) y **#52** (nuestra) contra `main`.
- Qué se hace con `main`, que en MultiCRM quedó adelantada y en ISEIE no.

**Corrige Ángel, no nosotros** — todo anotado en la #45: el aviso que nombra
variables de entorno, el recorrido que llega tarde y no salta pasos, la imagen
que se manda sin vista previa, la nota de voz sin aviso de envío y con la
duración equivocada.

**Lo nuestro, por orden:** recuperar contraseña (#37), Soporte de verdad (#38),
tasa de cierre de Carlos (#39), filtros en Clientes (#40) y la limpieza de datos
(#41, #42).

---

---

## WhatsApp en produccion — 21/08/2026

Lo que se probaba en pruebas ya corre en **los dos CRMs en produccion**: el chat
con las conversaciones dentro del CRM, una sesion por gestora, el admin viendo y
enlazando la de cada una, plantillas compartidas, notas de voz, responder a un
mensaje concreto, el recorrido guiado y la pagina de ayuda.

**El freno de escribir a desconocidos viene apagado.** Decision de Diego. Queda
apuntado en el registro quien escribe a un numero que no es prospecto, pero no se
impide: cuando el CRM se negaba, la gestora escribia desde su movil igual — sin
registro, sin plantilla y sin los topes de ritmo.

### Lo que hubo que arreglar para poder subirlo

Lo que corria en pruebas **no estaba en ninguna rama entera**: era el trabajo de
Angel con tres cambios nuestros copiados a mano encima. Al juntarlo salieron dos
cosas:

- **El freno tenia dos nombres con significados opuestos** —el suyo encendia, el
  nuestro apagaba—. Queda uno solo, `WA_BLOQUEO_DESCONOCIDOS`, apagado. Si algun
  `.env` conserva el viejo `WA_EXIGIR_CONSENTIMIENTO`, el servidor lo ignora y lo
  avisa al arrancar en vez de obedecerlo en silencio.
- **Una funcion rota en los dos entornos de pruebas.** `chat.controller.js`
  llamaba a `ultimoLatido`, que `chat.service.js` ya no exportaba: lo pise al
  copiar ese fichero suelto. `/api/whatsapp/sincronizacion` —lo que pregunta si
  sigue entrando historial— reventaba. Arreglado en los cuatro entornos.

Esa es la moraleja: **copiar ficheros sueltos a un servidor rompe cosas en
silencio**. Lo que se sube, se sube desde una rama.

### Como quedo cada sitio

| | Migraciones 129 y 130 | Modulo | Frontal |
|---|---|---|---|
| MultiCRM produccion | aplicadas | 11 ficheros | publicado, ayuda incluida |
| ISEIE produccion | aplicadas | 11 ficheros | publicado, ayuda incluida |
| MultiCRM pruebas | ya estaban | al dia | sin tocar |
| ISEIE pruebas | pendiente | al dia | sin tocar |

Copias de seguridad antes de tocar: `crm_prod_db` 9,6 MB y `crm_iseie` 7,7 MB en
`/var/backups/crm/`. Las conversaciones que ya habia siguen ahi, y la sesion
conectada de ISEIE (`crm-u16`) aguanto el reinicio.

### El atasco de Evolution en ISEIE — 21/08/2026

Sintoma: se enlazo el numero de una gestora, se veia «conectado», y no salia ni
entraba nada. El CRM decia «enviado» y el mensaje no llegaba a ningun sitio.

**Evolution llevaba parado desde las 09:06 de esa manana.** Su propia base no
guardo ni un mensaje en todo el dia. La traza:

    await _o.emit -> retryWebhookRequest -> AxiosError: timeout of 60000ms
    url: http://172.17.0.1:3005/api/whatsapp/webhook

Evolution **espera** a que su aviso llegue antes de seguir con el evento. Como el
aviso no llegaba, cada uno se comia 60 segundos y luego reintentaba: 109 en 12
minutos. La cola entera parada. Por eso no salian los mensajes ni entraban los
que escribian.

**La causa: ufw esta activo en esta maquina** —en la de MultiCRM no— y cortaba
lo que venia del contenedor. Y el detalle que costo encontrar: **el contenedor no
esta en `docker0` (172.17.0.1) sino en su propia red de compose,
`whatsapp_default` (172.18.0.0/16, puente `br-7ff3422bc513`)**. La primera regla
se puso sobre docker0 y no sirvio de nada.

La regla buena, por subred y no por nombre de puente —si se recrea la red, el
puente cambia de nombre y la regla dejaria de valer sin que nadie se entere—:

    ufw allow from 172.16.0.0/12 to any port 3005 proto tcp

Solo abre el puerto del CRM a la red privada de docker. No expone nada a
internet, no toca los 8 sitios de terceros de la maquina y se deshace con
`ufw delete`. No hizo falta reiniciar el contenedor ni volver a enlazar ningun
numero.

En cuanto entro, la cola se vacio sola: Evolution paso de las 09:06 a la hora
real y el CRM de 4 mensajes a 35.

**Como reconocerlo la proxima vez:** si el numero sale «conectado» pero no se
mueve nada, mirar `docker logs crm-whatsapp | grep 'timeout of 60000ms'`. Si hay
tiempos agotados, el problema no es WhatsApp ni el CRM: es que Evolution no
alcanza al CRM.

### Evolution tiene que guardar los mensajes — 24/08/2026

Los dos contenedores venian con `DATABASE_SAVE_DATA_NEW_MESSAGE: "false"` y
`DATABASE_SAVE_MESSAGE_UPDATE: "false"`. Suena razonable —el CRM ya guarda su
copia, para que duplicar— hasta que alguien pulsa **«Descargar audio»**: el CRM le
pide el fichero a Evolution por el identificador del mensaje y Evolution contesta
`Message not found`, porque nunca lo guardo. De ahi el «este archivo ya no se
puede recuperar».

Y lo segundo, menos visible: sin `SAVE_MESSAGE_UPDATE` **los tics no avanzan
nunca**. Los acuses de WhatsApp llegan, pero Evolution no puede emparejarlos con
un mensaje que no tiene, asi que todo se queda en un tic aunque este entregado.

Las dos encendidas en los dos servidores. Recrear el contenedor **no desenlaza
nada**: la sesion vive en su base de datos y vuelve sola en unos segundos —
comprobado dos veces, con una gestora trabajando.

### Los sintomas que confunden

Merece la pena tenerlos juntos, porque los tres se parecen y son cosas distintas:

| Lo que se ve | Que es |
|---|---|
| «Conectado» pero no se mueve nada | Evolution no alcanza al CRM. Mirar los tiempos agotados |
| Un tic que nunca avanza | Evolution no guarda las actualizaciones |
| «El archivo ya no se puede recuperar» | Evolution no guarda los mensajes |
| El chat con el nombre de la gestora | `pushName` guardado en un mensaje que sale |

Ninguno es que WhatsApp haya tumbado el numero, que es lo primero que uno teme.

### Las rutas del frontal contra las del servidor — 24/08/2026

Tres veces el mismo fallo en un dia: al pasar las rutas a español se renombraron
las llamadas del frontal y **no** los prefijos del servidor. Pantallas enteras
pidiendo a una direccion que no contestaba, sin que nadie lo notara hasta que
alguien abria esa pantalla.

| Modulo | El frontal pide | El servidor servia |
|---|---|---|
| Informes | `/api/informes` | `/api/reports` |
| Ventas | `/api/ventas` | `/api/sales` |
| Secuencias de email | `/api/secuencias-email` | `/api/email-sequences` |
| Mensajes (MultiCRM) | `/api/mensajes` | `/api/messages` |

Los cuatro pasan a su nombre en español y **conservan el viejo con `alias`**, que
no cuesta nada y evita romper integraciones o pestañas abiertas.

**Para que no haya una quinta vez:** `scripts/auditoria_rutas.py`. Saca los
prefijos y rutas de cada modulo del servidor, las llamadas del frontal con su
fichero y su linea, y las cruza. Se corre sin tocar ningun servidor:

    python scripts/auditoria_rutas.py

Antes de esto: **21 llamadas huerfanas en MultiCRM y 14 en ISEIE**. Despues:
ninguna en los dos. Conviene pasarlo antes de cada despliegue grande, y
obligatoriamente despues de renombrar cualquier ruta.

Ojo con leerlo mal: se compara **por prefijo**, no por camino exacto. Una llamada
como `/leads/${id}` llega al analisis como `/api/leads`, asi que lo que se
detecta es que el servidor no tenga NADA colgando de ahi — que es justo el fallo
del renombrado.

### Lo que falta

- **ISEIE pruebas no tiene Evolution configurado** en su `.env`, asi que alli el
  WhatsApp no se puede probar. Si se quiere, hay que darle su propio prefijo de
  sesion y su webhook, como se hizo con MultiCRM pruebas.
- **Lo de Angel de la tarea #45** sigue como estaba: el aviso de configuracion
  que se le ensena a la gestora, la vista previa de la imagen antes de mandarla,
  el estado de «enviando» del audio y su duracion.
- **Paridad de rutas**: en ISEIE `/leads` y `/clients` siguen en ingles; en
  MultiCRM ya son `/prospectos` y `/clientes`. El resto de rutas si coinciden.

---

<!-- INDICE-TAREAS -->

## Todas las tareas abiertas

Sacado de GitHub, no escrito a mano: **44 abiertas**. Para volver a
generarlo, `scratchpad/indice_tareas.py`.

### Fase 1 · Desbloquear · 7

| | Qué | Quién | |
|---|---|---|---|
| [#20](https://github.com/diego-landaeta/CRM/issues/20) | Mandar el origen del lead desde Make | Diego | **bloquea a otros** |
| [#21](https://github.com/diego-landaeta/CRM/issues/21) | Aplicar la migración 122 (plantillas de WhatsApp) | Diego | **bloquea a otros** · lleva SQL |
| [#22](https://github.com/diego-landaeta/CRM/issues/22) | Clave de IA y tope de gasto | Diego | **bloquea a otros** |
| [#23](https://github.com/diego-landaeta/CRM/issues/23) | Usuario del CRM de pruebas para Fabián | Diego | **bloquea a otros** |
| [#24](https://github.com/diego-landaeta/CRM/issues/24) | Decidir qué pasa con main | Diego |  |
| [#62](https://github.com/diego-landaeta/CRM/issues/62) | WhatsApp: responder a un mensaje falla — la cita va como texto y Evolution espera un objeto | Ángel |  |
| [#63](https://github.com/diego-landaeta/CRM/issues/63) | WhatsApp: dos endpoints que solo existen en el puente de Baileys, no en Evolution | Ángel |  |

### Fase 2 · Construir · 18

| | Qué | Quién | |
|---|---|---|---|
| [#26](https://github.com/diego-landaeta/CRM/issues/26) | Página de estado del sistema | Ángel |  |
| [#27](https://github.com/diego-landaeta/CRM/issues/27) | El envío de correo del CRM · la tubería | Ángel |  |
| [#28](https://github.com/diego-landaeta/CRM/issues/28) | Recordatorios por correo | Ángel |  |
| [#29](https://github.com/diego-landaeta/CRM/issues/29) | Reporte semanal por correo | Ángel |  |
| [#30](https://github.com/diego-landaeta/CRM/issues/30) | Análisis de datos con IA | Ángel |  |
| [#31](https://github.com/diego-landaeta/CRM/issues/31) | Terminar la administración de usuarios | Fabián |  |
| [#32](https://github.com/diego-landaeta/CRM/issues/32) | Rediseño · tokens y primitivas | Fabián |  |
| [#33](https://github.com/diego-landaeta/CRM/issues/33) | Rediseño · el marco: menú, cabecera y estructura | Fabián |  |
| [#34](https://github.com/diego-landaeta/CRM/issues/34) | Rediseño · las 82 pantallas, por bloques | Fabián |  |
| [#35](https://github.com/diego-landaeta/CRM/issues/35) | Proceso de ventas editable | Diego | lleva SQL |
| [#36](https://github.com/diego-landaeta/CRM/issues/36) | Search Console | Diego |  |
| [#37](https://github.com/diego-landaeta/CRM/issues/37) | Recuperar la contraseña por correo | Yo |  |
| [#38](https://github.com/diego-landaeta/CRM/issues/38) | Soporte de verdad | Yo | lleva SQL |
| [#39](https://github.com/diego-landaeta/CRM/issues/39) | Tasa de cierre y baremo · lo de Carlos | Yo |  |
| [#44](https://github.com/diego-landaeta/CRM/issues/44) | Sincronizar los proyectos de IA con el CRM · Ángel y Fabián | Ángel | compartida |
| [#48](https://github.com/diego-landaeta/CRM/issues/48) | Recibir el origen de los leads (ChatGPT incluido) y categorizarlo | Diego |  |
| [#50](https://github.com/diego-landaeta/CRM/issues/50) | Tipografía e iconos del apartado de administración (estilo formal) | Fabián |  |
| [#64](https://github.com/diego-landaeta/CRM/issues/64) | WhatsApp: la ficha del prospecto en un popup, y que expandir no recargue el chat | Ángel |  |

### Fase 3 · Cerrar · 11

| | Qué | Quién | |
|---|---|---|---|
| [#2](https://github.com/diego-landaeta/CRM/issues/2) | Frontend: Dropdown categorías searchable + niveles separados cascade | Ángel |  |
| [#6](https://github.com/diego-landaeta/CRM/issues/6) | Frontend: Panel UI de conectores con preview + mapping visual | Fabián |  |
| [#11](https://github.com/diego-landaeta/CRM/issues/11) | Frontend: Panel 'próximo gestor' en /leads — visualizar round-robin | Fabián |  |
| [#13](https://github.com/diego-landaeta/CRM/issues/13) | Backend: Activity feed (tabla + endpoint para 'qué pasó hoy') | Diego |  |
| [#14](https://github.com/diego-landaeta/CRM/issues/14) | Backend: WooCommerce orders sync + cron flexible (manual/diario/semanal) | Diego |  |
| [#15](https://github.com/diego-landaeta/CRM/issues/15) | Backend: Project types extension (educacion/ecommerce/servicios/inmobiliaria) | Ángel |  |
| [#40](https://github.com/diego-landaeta/CRM/issues/40) | Filtros en Clientes y Matrículas | Yo |  |
| [#41](https://github.com/diego-landaeta/CRM/issues/41) | Ventas sin formación identificada · 321 | Yo |  |
| [#42](https://github.com/diego-landaeta/CRM/issues/42) | Los otros datos que no cuadran | Yo |  |
| [#43](https://github.com/diego-landaeta/CRM/issues/43) | Lo que quedó a medias | Yo |  |
| [#49](https://github.com/diego-landaeta/CRM/issues/49) | Rutas en español, con redirección desde las viejas | Yo |  |

### Fase 4 · Medir · 5

| | Qué | Quién | |
|---|---|---|---|
| [#53](https://github.com/diego-landaeta/CRM/issues/53) | Meta Ads: del gasto a la venta, no al lead | Diego |  |
| [#54](https://github.com/diego-landaeta/CRM/issues/54) | Google Ads: traer campañas y gasto al CRM | Diego |  |
| [#55](https://github.com/diego-landaeta/CRM/issues/55) | Google Analytics: lo que pasa antes del lead | Diego |  |
| [#56](https://github.com/diego-landaeta/CRM/issues/56) | Panel de canales: dónde poner el dinero | Yo |  |
| [#57](https://github.com/diego-landaeta/CRM/issues/57) | Pedirle a Daniela sus reportes de publicidad y ventas | Diego |  |

### sin fase · 3

| | Qué | Quién | |
|---|---|---|---|
| [#4](https://github.com/diego-landaeta/CRM/issues/4) | Frontend: Documentos/Certificados — selectores de programa, alumno y módulos auto | molinangel |  |
| [#7](https://github.com/diego-landaeta/CRM/issues/7) | Frontend: Sistema completo de vistas por rol (sidebar dinámico + landing por rol) | molinangel |  |
| [#8](https://github.com/diego-landaeta/CRM/issues/8) | Frontend: Settings — separar Categorías/Campos/Columnas por entidad (Leads/Clientes/Productos) | molinangel |  |

> Las mismas tareas existen en el repositorio de ISEIE, bloqueadas con la
> etiqueta `espera-multicrm`: se hacen aquí primero y se replican cuando Diego
> las aprueba.

<!-- FIN-INDICE-TAREAS -->

---

## El proceso comercial, por empresa y no solo por proyecto

Anotado el **14/09/2026**. Diego, con CEDIA elegida en producción:

> «Estos procesos en empresas deben ser por empresa, no por proyecto, que tengan
> filtros. Si tengo que seleccionar un proyecto, tiene que ser por proyecto y por
> empresa; que al indicar eso, sea "selecciona una empresa".»

### Qué pasa hoy

Con **CEDIA (7 campus)** puesta en el selector, `/prospectos/proceso` no enseña
nada: sale el muro de *«Selecciona un proyecto — tienes activa la vista Todos
los proyectos»*. Con un proyecto suelto (ISEIH) la cola funciona: 22 atrasados,
1 para hoy, 3 para mañana, 27 esta semana.

Comprobado en el código, no supuesto:

| | |
|---|---|
| `CON_SOCIEDAD_OK` (AppLayout) | **no** incluye `/prospectos/proceso` ni `/prospectos/cola` |
| Módulo `proceso` (backend) | **cero** menciones a `issuer` o `sociedad`: solo entiende de `projectIds` |

Y el aviso además **miente**: dice «tienes activa la vista Todos los proyectos»
cuando lo que hay activo es una empresa. No es lo mismo, y por eso el texto no
ayuda a salir del problema.

### Qué habría que hacer

1. **Las dos pantallas aceptan empresa.** Añadir `/prospectos/proceso` y
   `/prospectos/cola` a `CON_SOCIEDAD_OK`. El backend ya recibe `projectIds`, así
   que el ámbito se le pasa como la lista de campus — igual que hace Prospectos
   desde el #103. No hace falta inventar un parámetro nuevo.
2. **Filtro de proyecto dentro de la empresa.** Con CEDIA puesta, poder acotar a
   uno de sus 7 campus sin cambiar el selector de arriba. Los dos ejes a la vez:
   empresa y proyecto.
3. **Que cada fila diga de qué proyecto es.** Con varios campus mezclados, una
   cola sin esa columna no se puede repartir. Esto ya lo había pedido Carlos el
   11/09 y sigue sin hacerse.
4. **Arreglar el texto del muro.** Si hay una empresa elegida, el aviso tiene que
   hablar de la empresa, no de «todos los proyectos».

### Ojo con dónde está cada cosa

Diego lo vio en **producción** (`/crm/`), y ahí no está ni siquiera el ámbito por
empresa de Prospectos y Clientes: eso entró en `staging` el 11/09 y producción
sigue sin recibirlo. Así que en producción el problema es más ancho de lo que se
ve en esa pantalla.

*Sin asignar. Toca frontend (AppLayout y las dos pantallas) y backend
(`proceso.model.js`), y encaja con lo de Fabián en el #103.*

---

## Facturación: el buscador y los atajos de fecha, donde se usan

Anotado el **14/09/2026**. Diego: «en facturación se necesita buscador de
facturas por lupa, número, filtros rápidos como hoy, ayer y eso».

**El buscador YA existe** — `InvoicesPage.tsx:309`, con lupa y «Buscar por nº de
factura, cliente o NIF». No hay que construirlo. El problema es **dónde está**:

1. las cuatro tarjetas de cifras
2. el buscador y los filtros
3. la tabla de ventas sin factura
4. **la lista de facturas** ← donde se trabaja

Para cuando bajas a la lista, el buscador lleva tres bloques fuera de pantalla.
Un buscador que hay que ir a buscar no se usa: por eso se pide uno que no está,
estando.

**Los atajos de fecha sí faltan.** Solo hay dos casillas (`filters.from` /
`filters.to`, líneas 349 y 352). No hay hoy, ayer, esta semana, este mes ni mes
pasado.

Qué hacer: que la barra se quede pegada al bajar o se repita junto a la cabecera
de la tabla —donde Diego dibujó el recuadro—; los cinco atajos rellenando
`from`/`to`, que el backend ya filtra por ese rango; y que buscar `110`
encuentre la `2026/0110` sin teclear el año.

Es la misma petición que Carlos hizo el 11/09 para las dos colas. Si se hacen
los atajos, **un solo componente** para las tres pantallas.

*Sin asignar. Solo frontend.*

---

## Tutores: los estados de la comisión

Anotado el **14/09/2026**. Diego, señalando la columna ESTADO de
`/tutores/comisiones`:

> «Ahí que pone pendiente deben aparecer los siguientes estados: Pendiente,
> Notificada, Falta Factura. Si este estado se pone en septiembre, se mantiene
> SOLO en ese mes, hasta que se modifique.»

### Lo comprobado

Las comisiones de tutores **no** viven en la tabla `commissions` (esa es la del
equipo comercial), sino en `tutor_comisiones`, y esa tabla **ya tiene `periodo`**
— `tutor.model.js:386`. Cada fila es de un mes concreto, así que lo de «se
mantiene solo en ese mes» **ya está resuelto por estructura**: no hay que
inventar nada, poner un estado en septiembre no puede tocar agosto.

Los estados de hoy son tres: `pendiente`, `pagada`, `revertida`
(`tutor.controller.js:282`).

### Qué falta

Añadir **`notificada`** y **`falta_factura`**, y que la columna deje elegirlos.
Al tocar la restricción, mirar **si es un CHECK o un ENUM de Postgres**: si es
ENUM hay que ampliarlo, y buscar solo el CHECK ya rompió las conversiones en los
dos CRM una vez.

Encaja con lo de Carlos de «avisar al tutor»: *notificada* es justo el estado en
que queda una comisión después de mandarle el correo, y *falta factura* el que
explica por qué no se le paga todavía.

*Sin asignar. Migración + backend + la columna en la pantalla.*

---

## La lupa en Tutores y en Clientes

Anotado el **14/09/2026**. Diego: «necesito una lupa en tutores y en clientes
(filtros)».

Comprobado: las dos pantallas **sí tienen campo de búsqueda** —`TutoresPage.tsx`
y `ClientsPage.tsx` tienen su `placeholder` de buscar— pero **ninguna de las dos
pinta el icono de lupa**: cero `MagnifyingGlass` en ambos ficheros.

O sea que el campo está y no se lee como buscador. Es el mismo caso que
Facturación pero al revés: allí la lupa está y el buscador queda lejos; aquí el
buscador está y no parece uno.

Qué hacer: poner la lupa dentro del campo, como en Facturación y en Prospectos,
para que las cuatro pantallas se parezcan. Y revisar de paso que el campo esté
donde se mira, no encima del todo.

*Sin asignar. Solo frontend, y es pequeño.*

---

## BUG · La lupa general no encuentra a ningún cliente

Anotado el **14/09/2026**. Diego: «algo pasa con la lupa general, he buscado
este cliente y no aparece... ni nombre ni correo».

### Reproducido y con causa

Buscando `garbitsu@gmail.com` en Psiko Aprende, la paleta dice «No hay
resultados». Pero en la base **sí está**, dos veces:

| lead | nombre | proyecto | estado |
|---|---|---|---|
| #855 | Garbiñe Pastor | 2 · Psiko Aprende | convertido, con factura |
| #1868 | Garbiñe Pastor Narbaiza | 2 · Psiko Aprende | convertido, con factura |

Proyecto correcto, correo correcto. **La causa es una palabra que falta**:

```
CommandPalette.jsx:176
client.get(`/leads?projectId=${activeProject.id}&search=${q}&limit=5`)
```

Sin `includeConverted=1`. Y `lead.model.js` excluye a los convertidos cuando no
se lo pides:

```js
} else if (!includeConverted && !conConversion) {
  conditions.push(`l.status <> 'convertido'`);
}
```

### Por qué importa más de lo que parece

No falla la búsqueda por texto: **falla para todo el que ya compró**. O sea que
la lupa general encuentra a quien todavía no es cliente y esconde justo a los
que más se buscan — para cobrar, para facturar, para atender.

### El arreglo

Añadir `&includeConverted=1` a esa llamada. Es **una línea**. Conviene además
que el resultado diga si esa persona ya es cliente, para no confundirla con un
prospecto vivo.

*Sin asignar, pero es de un minuto.*

---

## Tutores: que se puedan editar, y que se vea

Anotado el **14/09/2026**. Diego: «necesitamos algo visible para poder editar
tutores».

En `/tutores`, al elegir uno salen cuatro botones —Datos de pago, Cambiar
contraseña, Retirar, Añadir formación— y **ninguno edita al tutor**: ni el
nombre, ni el correo, ni el porcentaje, ni las fechas de una formación ya
puesta. Para cambiar un 10 % hay que quitar la formación y volver a añadirla.

Qué hace falta:

- **Editar la ficha**: nombre y correo.
- **Editar una formación ya asignada**: el porcentaje y el «desde/hasta», sin
  quitarla y rehacerla — quitarla borra el histórico de por qué se le pagó lo
  que se le pagó.
- Que el botón **se vea**, junto a los otros cuatro, no escondido.

Ojo con el IBAN: la lista repite «sin IBAN · no se le puede pagar» en casi
todos. Eso sí se edita, en «Datos de pago», pero desde la lista no hay forma de
llegar; el aviso dice el problema y no lleva a la solución.

*Sin asignar. Frontend, y backend si no existe el endpoint de editar.*

---

## BUG · No deja asignar una formación al tutor

Anotado el **14/09/2026**. Diego: «no me deja asignar esta formación».

**Sin investigar todavía** — Diego: «primero anota y luego nos ponemos a revisar
todo». Queda descrito tal cual se ve, para mirarlo después.

En `/tutores`, con Tatiana elegida, botón **Añadir formación**. Se escribe
«Máster en Terapia de Pareja y Vínculos Afectivos» y el diálogo responde:

> *Ningún curso con «Máster en Terapia de Pareja y Vínculos Afectivos». Prueba
> con una palabra suelta.*

Lo llamativo: **esa formación ya está en su tabla**, dos filas más arriba, con
un 10 % desde el 2026-08-01 y el estado **desactivada**. O sea que el buscador
del diálogo no encuentra algo que la propia pantalla está enseñando.

Por dónde empezar cuando toque (a comprobar, no confirmado):

- si el buscador del diálogo **descarta los productos inactivos** — encaja con
  que la fila diga «desactivada»
- si excluye los que **ya tiene asignados**, y entonces el mensaje es el
  equivocado: no es «ninguno», es «ya lo tiene»
- si busca por cadena entera en vez de por palabras, que es lo que sugiere su
  propio consejo de «prueba con una palabra suelta»

Sea cual sea, **el mensaje miente** y manda al usuario a probar cosas en vez de
decirle qué pasa.

*Sin asignar. Pendiente de revisar.*

---

## BUG · Una formación desactivada por error no se puede recuperar

Anotado el **14/09/2026**. Diego: «no deja editar: está aquí y ha sido
desactivada por error». Sin investigar, como los dos de arriba.

La fila de Tatiana:

> Máster en Terapia de Pareja y Vínculos Afectivos · Psiko Aprende · 10 % ·
> 2026-08-01 · en adelante · **desactivada** · 🗑 **Quitar**

La única acción es **Quitar**. No hay «reactivar» ni «editar»: una formación
desactivada por error se queda desactivada, y lo único que se ofrece es borrarla
—que es lo contrario de lo que hace falta, porque **se lleva por delante el
histórico de por qué se le pagó lo que se le pagó**.

### Los tres bugs de tutores son el mismo nudo

1. Se desactiva una formación sin querer.
2. No se puede reactivar ni editar: solo quitar *(este)*.
3. Se intenta volver a añadirla y el diálogo dice que **no existe ningún curso
   con ese nombre**, mientras la tabla lo está enseñando *(el anterior)*.

Sin salida: ni se arregla, ni se rehace. Hay que resolverlos juntos, y lo
primero que hay que entender es **qué significa «desactivada»** en esa fila —si
es la asignación tutor–formación o el producto del catálogo— porque de eso
depende cuál de los tres es la causa y cuáles son consecuencia.

*Sin asignar. Pendiente de revisar, junto con los otros dos de tutores.*

---

## Los 133,33 € sin formación: Diego ya sabe cuál es

Anotado el **14/09/2026**. No es un fallo del CRM: es **el dato que faltaba**, y
Diego lo ha dado.

El aviso de `/tutores/comisiones` (septiembre 2026, Psiko Aprende) dice:

> ⚠ **133,33 € cobrados sin saber de qué formación son.** 1 cobro de ventas que
> no están atadas al catálogo. Nadie cobra comisión por ellos. Se arregla
> eligiendo la formación en cada venta: **#177 Edwin Noguera**.

Diego:

> «Este pago es de la formación: **Diplomado en neurociencia aplicada al trauma y
> plasticidad cerebral**. La tutora es **Alba Burundarena**.»

### Qué hay que hacer

1. En la venta **#177 (Edwin Noguera)**, elegir como formación el *Diplomado en
   neurociencia aplicada al trauma y plasticidad cerebral*.
2. Comprobar que **Alba Burundarena** consta como tutora de esa formación, con su
   porcentaje y su fecha de inicio. En la lista de tutores aparece una **Alba**
   (`alba@psikoaprende.com`) con 2 cursos — hay que confirmar que es la misma
   persona antes de tocar nada.
3. Volver a **Calcular** las comisiones de septiembre. Los 133,33 € deberían
   dejar el aviso y pasar a la comisión de Alba.

Ojo con el aviso de la propia pantalla: *«no se genera nada anterior al
2026-08-01, ni anterior a la fecha de inicio de cada tutor»*. Si a Alba se le
pone una fecha de inicio posterior al cobro, la comisión seguirá sin salir y
parecerá que el arreglo no funcionó.

*Sin asignar. Es dato, no código — pero conviene hacerlo con la pantalla
delante para ver si el aviso desaparece.*

---

## Tutores: una columna para saber qué ha entregado cada uno

Anotado el **14/09/2026**. Diego, señalando el hueco entre ESTADO y Quitar en la
tabla de formaciones del tutor:

> «Aquí en los tutores necesito una columna que sea: Foto corporativa, Vídeo,
> Foto y Vídeo, 25 % módulos, 50 % módulos, 100 % completo. **Esto que sea como
> un checkbox para no consumir espacio en subir archivos.**»

### Lo importante: no se suben archivos

El CRM **no guarda** la foto ni el vídeo ni los módulos: solo **marca** si están
entregados. Los archivos viven donde ya vivan —Drive, la plataforma, donde
sea— y aquí se apunta el estado. Eso es lo que evita el almacenamiento, y es la
condición que puso Diego.

Va **por formación**, no por tutor: el recuadro está dentro de la tabla de
formaciones, y la misma persona puede tener el Curso de ludopatía entregado y el
Diplomado a medias.

### Una pregunta antes de construirlo

Los seis no parecen del mismo tipo:

| | |
|---|---|
| Foto corporativa · Vídeo | dos marcas sueltas, se tienen o no |
| **Foto y Vídeo** | si las dos de arriba son casillas, esta **sobra**: es las dos marcadas |
| 25 % · 50 % · 100 % módulos | esto es **una escala**, no tres casillas: nadie está al 25 % y al 100 % a la vez |

Lo más probable es que sean **dos casillas + un selector de avance**, y que «Foto
y Vídeo» sea la forma de decirlo en corto. Pero eso hay que preguntárselo a
Diego antes de hacerlo, porque cambia la columna entera y cambia cómo se filtra
después.

### Para qué sirve de verdad

Con esto se puede contestar «¿qué tutores están a medias?» sin ir uno por uno, y
enlaza con lo de **Sin tutor** y con avisar al tutor: un 100 % completo es lo que
permite cerrar una formación, y un 25 % en septiembre explica por qué algo no
está publicado.

*Sin asignar. Migración (columnas en la asignación tutor–formación) + la columna
en la pantalla.*

---

## Comisiones: «Estado de la colaboración» en la fila del cobro

Anotado el **14/09/2026**. Diego, señalando el hueco entre FORMACIÓN y BASE, al
desplegar un tutor en `/tutores/comisiones`:

> «En comisiones aparece un mensaje que es "Estado de la colaboración", y
> aparece la información marcada antes.»

Es **el mismo dato de la nota anterior** —foto corporativa, vídeo, 25/50/100 %
de módulos— enseñado aquí. No es otra cosa que rellenar: se marca una vez en la
ficha del tutor y se **lee** en las dos pantallas.

### Por qué tiene sentido ponerlo justo ahí

Esta es la pantalla donde se pulsa **Marcar pagado**. Ver en la misma fila que
esa persona va al 25 % de los módulos es lo que evita pagar una colaboración
que todavía no está entregada — y hoy, para saberlo, hay que salirse a
`/tutores`, buscar a la persona y mirar su formación.

Cabe en una columna estrecha si se pinta con iconos o siglas (📷 🎥 · 25 %) y el
detalle al pasar por encima. En la fila del cobro hay sitio: el hueco que marcó
Diego está vacío.

### Lo que hay que decidir con la otra nota

Las dos son la misma función vista en dos sitios, así que **se hacen juntas** y
con la misma forma. La pregunta pendiente sigue siendo si son dos casillas más
un selector de avance o seis marcas sueltas — ver la nota *«Tutores: una columna
para saber qué ha entregado cada uno»*.

*Sin asignar. Va con la anterior, no por separado.*

---

## BUG · Meta Ads: ni conjuntos, ni leads, ni productos

Anotado el **14/09/2026**. Diego, sobre `/meta-ads` en ISAEG: «esta parte no
anda bien». Sin investigar, como los demás de hoy.

Lo que se ve en pantalla, y son tres cosas distintas aunque parezcan una:

1. **Sin conjuntos.** Al desplegar la campaña *Ventas* (OUTCOME_SALES, 209 €,
   34.570 impresiones, 642 clics) dice:
   *«Sin conjuntos en este rango (o backfill aún no incluye adsets).»*
   El propio mensaje admite que no sabe si no hay datos o si la sincronización no
   los ha traído — y esa duda es el problema: no se puede distinguir «Meta no
   tiene nada» de «nosotros no lo hemos bajado».

2. **Cero leads con 642 clics.** Las cuatro campañas marcan `Leads 0` y el CPL
   sale en blanco. Con 246 € gastados y casi 100.000 impresiones, o no llega ni
   un lead —posible, pero hay que verlo— o **no se está atando el lead a la
   campaña**, que es lo que hace que la pantalla no sirva para nada.

3. **«Por producto (0)».** Cero. Ya está comprobado de antes: las tablas que
   cruzan anuncio con producto **llevan vacías desde siempre**, así que nada que
   mezcle publicidad y catálogo puede calcularse solo. El botón *Asociar* de cada
   fila es justo lo que no se ha usado nunca.

### Al revisarlo, en este orden

Primero **si el backfill trae adsets** (1), porque si no baja los conjuntos el
resto no puede cuadrar. Luego **por dónde se pierde el lead** (2): si el webhook
guarda el identificador de campaña o si se queda por el camino. Y lo de los
productos (3) no es un fallo del código sino trabajo que nadie ha hecho, así que
va aparte y probablemente es de negocio.

Contexto que ya teníamos: el módulo se desplegó en etapas 1 y 2 y **nunca se
validó con datos reales**. Esto es esa validación, llegando tarde.

*Sin asignar. Pendiente de revisar.*

---

## Los atajos de fecha: pedidos tres veces, hacerlos UNA

Anotado el **14/09/2026**. Diego, otra vez: «aquí necesito opciones rápidas de
hoy, ayer, esta semana, este mes, mes pasado».

**Es la tercera vez que se pide la misma cosa:**

| Cuándo | Dónde |
|---|---|
| 11/09 | la cola de facturación (lo pidió Carlos) |
| 14/09 | Facturación |
| 14/09 | otra vez, sin decir la pantalla |

Que se repita tres veces en cuatro días no significa que haya tres tareas:
significa que **falta en todas partes**. Hoy cada pantalla con rango de fechas
tiene dos casillas `desde`/`hasta` y nada más — teclear dos fechas para ver «lo
de ayer» es justo lo que nadie hace.

### Qué hacer

**Un solo componente**, y se coloca en todas las pantallas que ya tienen
`desde`/`hasta`:

- Hoy · Ayer · Esta semana · Este mes · Mes pasado
- Rellena los dos campos que ya existen: **no hace falta tocar backend**, todos
  esos listados ya filtran por rango.
- Y que se vea cuál está puesto, para poder quitarlo.

Dónde va, como mínimo: Facturación, la cola de facturación, Ventas, Ingresos,
Comisiones y Reportes. Si se hace uno por pantalla acabarán siendo cinco atajos
distintos con cinco comportamientos.

*Sin asignar. Solo frontend. Es de las que más se nota por lo poco que cuesta.*

---

## Orden de Diego al equipo: nada nuevo hasta cerrar lo enviado

Anotado el **14/09/2026**. En el grupo *Programación Proyectos Carlos* (Ángel,
Carlos, Fabián):

> «Máxima prioridad a todo esto que he enviado desde la semana pasada. **Hasta
> que no se complete eso no avancéis con nada más.**»

Se apunta aquí porque cambia qué es prioritario para los tres, y porque dentro
de un mes nadie se acordará de por qué se pararon las demás ramas.

«Todo esto» es lo que hay anotado en este documento con fecha **11 y 14 de
septiembre**: los bugs de tutores, las dos lupas, los atajos de fecha, el
proceso por empresa, Meta Ads y lo de facturación. Y para Ángel, además, sus
seis de WhatsApp con Zadarma a la cabeza.

**Nada de ramas nuevas ni de trabajo por fuera hasta cerrar esa lista.**
