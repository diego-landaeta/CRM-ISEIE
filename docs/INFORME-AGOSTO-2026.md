# Informe de desarrollo · Agosto de 2026

**MultiCRM 360 · CRM ISEIE** — periodo 01/08/2026 a 31/08/2026.

El mes en que las gestoras dejaron de salir del CRM para hablar con la gente, y
en que el profesorado empezó a poder cobrar. Dos módulos nuevos y grandes, un
rediseño en marcha y 333 commits repartidos entre los dos sistemas.

> Todas las cifras son recuentos directos del historial de los dos
> repositorios, no estimaciones.

---

## 1 · El mes en cifras

| | |
|---|---|
| **333** commits | 218 MultiCRM · 115 ISEIE |
| **35** migraciones | de la 120 a la 135 |
| **3** módulos nuevos | WhatsApp, tutores, estado |
| **716** ficheros tocados | 492 y 224 |
| **23** tareas cerradas | citadas por su número en el commit |

**98.067 líneas nuevas** y 18.972 retiradas entre los dos repositorios. Agosto
empata con julio como el mes más denso del año, pero con una diferencia: julio
fue un módulo, y agosto fueron dos módulos y un rediseño a la vez.

### Dónde fue el trabajo

| área | commits |
|---|---|
| WhatsApp | **96** (71 + 25) |
| Tutores y comisiones | 38 (19 + 19) |
| Ventas | 22 (11 + 11) |
| Rediseño e interfaz | 21 |
| Facturación | 17 |
| Prospectos y leads | 14 |
| Documentación y método | 26 |
| Correo, estado y avisos | 12 |

### El ritmo

Los picos: el **20** (35 commits) es el día que WhatsApp entró en producción;
el **24** (29) es el de las correcciones que salieron de usarlo con un número
real.

---

## 2 · WhatsApp dentro del CRM

96 commits, 6 migraciones, y **tres arquitecturas antes de dar con la buena**.
Es, con diferencia, lo más grande del mes.

### Lo que se pedía, y por qué no era fácil

Cada gestora con **su propio número**, que **sigue en su móvil**. Y el
administrador pudiendo leer, saber si contactó y contestar por ella. Todo
dentro del CRM.

Esos tres requisitos a la vez eliminan las salidas cómodas:

- **Empotrar WhatsApp Web en un iframe no se puede.** El propio sitio lo
  prohíbe con su cabecera `frame-ancestors`. En el repositorio quedaba ya un
  intento anterior abandonado por lo mismo.
- **La API oficial de WhatsApp Business tampoco vale.** Hace exactamente esto y
  sin riesgo, pero un número registrado en la API *deja de funcionar con la app
  normal del móvil*. Y las gestoras trabajan desde el móvil.

Se llegó a montar y probar una tercera vía —un **navegador remoto** con la
pantalla transmitida al CRM— y se retiró: pedía una máquina aparte para cada
dos gestoras. Ese trabajo está deliberadamente borrado del código, pero se
llevó parte del mes.

### Lo que quedó

**Una sesión de WhatsApp por usuario**, gobernada desde el CRM. Cada gestora
enlaza su número una vez —por QR o por un código de ocho caracteres que se le
puede dictar por teléfono— y a partir de ahí no sale del CRM.

| qué | detalle |
|---|---|
| **El chat completo** | Enviar y recibir; fotos, audios y notas de voz; adjuntos; citar; reenviar; buscar sobre todas las conversaciones y no solo las cargadas |
| **La ficha al lado** | El prospecto en un popup sin salir del chat, y las plantillas ya rellenadas |
| **Grupos** | Con etiqueta propia, filtro por etiquetas y el nombre de quién escribió cada mensaje |
| **Supervisión** | El administrador entra en la sesión de cualquier gestora y contesta por ella. Queda escrito quién entró a mirar la sesión de quién |
| **Llamadas** *(a medias)* | El aviso entrante salta desde cualquier pantalla y se puede rechazar con un texto. **Hablar desde el CRM no se puede**: por esta vía WhatsApp no da canal de audio. El botón abre la llamada en el móvil y el CRM apunta el intento |
| **Consentimiento** | Aviso antes de enlazar, y registro de quién lo aceptó |
| **Plantillas** | En base de datos y compartidas. Antes vivían en el navegador de cada una |
| **Aislamiento** | Cada entorno con su WhatsApp, para que pruebas y producción no se pisen |

### Lo que costó de verdad

De los 96 commits, **más de la mitad son correcciones**, y casi todas salieron
de usarlo con un número real, no de programarlo. Mensajes que se perdían por el
camino. Notas de voz que llegaban mudas al móvil. El chat del bot en blanco.
Dos sesiones que se cruzaban. El administrador abriendo su propio chat en vez
del de la gestora. Un parpadeo de Postgres que tumbaba el CRM completo.

**Un módulo de mensajería no está terminado cuando funciona en la máquina de
desarrollo.**

---

## 3 · Tutores y comisiones

38 commits, 5 migraciones. El módulo que permite pagar al profesorado —
literalmente.

Un rol nuevo, **tutor**, con portal propio *fuera* del CRM: un profesor entra y
ve solo sus formaciones, sus ventas y lo que se le debe. No puede alcanzar el
resto del sistema, y eso hubo que construirlo aparte porque hasta entonces
cualquier sesión válida veía el CRM entero.

Las **colaboraciones** atan un tutor a una formación con su porcentaje y sus
fechas de vigencia. El mismo profesor puede estar a un porcentaje en un curso y
a otro en otro, y dar clase **en varias marcas**.

- **La comisión se calcula sobre el dinero efectivamente cobrado**, pago a
  pago, no sobre el importe declarado de la venta — ese campo declara de más.
- **Un reembolso deshace la comisión.** Fue lo último en cerrarse.
- **Corte por fecha**: cada tutor arranca desde la suya.
- **Datos bancarios** del profesor, que era exactamente lo que impedía pagarle.
- Quien gestiona colaboraciones **deja de entrar en el reparto de prospectos**.

---

## 4 · Ventas, rehecho

22 commits. Tres pantallas convertidas en una, con **un único filtro de
periodo** mandando sobre todo lo que hay debajo. «De qué se compone» el dinero,
evolución contra el periodo anterior, países, recorte por gestora, y quién
compra y quién debe.

Se corrigió que las cifras contaran distinto que las tartas y la gráfica.

---

## 5 · El rediseño

21 commits en cinco tareas. Agosto es el mes en que deja de ser una maqueta y
empieza a entrar en el CRM, por bloques y sobre `/testeo`:

- **#32** · las primitivas a tokens, con muestrario y un repaso que impide
  volver a escribir colores a mano.
- **#33** · el marco: cabecera fija, apartados y menú denso.
- **#34** · Prospectos entero, seis pantallas.
- **#78** · la paleta y el menú de la maqueta SuiteDash.
- **#79** · la integración. Al cerrar agosto quedaba solo su punto 3, Ventas.

---

## 6 · Lo que se arregló por debajo

Sin pantalla que enseñar, pero es lo que evita los sustos.

**Seguridad** — el webhook de Stripe aceptaba eventos **sin firmar**; nóminas y
matrículas tenían rutas de lectura sin guarda; y hubo que construir el recorte
por rol para que un tutor no viera el CRM.

**Datos** — `conversion_payments.metodo` existía en producción **pero no en el
repositorio**: quien reconstruyera la base desde cero se encontraba medio CRM
roto. Y dos sociedades que comparten serie se pisaban el correlativo.

**Correo** — el CRM mandaba **la lista de etiquetas vacía y Brevo rechazaba
todos los envíos**. Un fallo que dejaba el correo mudo entero.

**Rutas** — las direcciones pasan al español, y **cuatro módulos se servían en
direcciones que la pantalla ya no pedía**. Se añadió un guion que impide que
vuelva a pasar.

**Estado (#26)** — cada pieza dice **cuándo funcionó por última vez**, no si
tiene una credencial configurada, que es lo que decía antes y no significaba
nada.

---

## 7 · Cómo se trabajó

Agosto es también el mes en que el proyecto pasó de una persona a un equipo.

- **Una rama por persona**, con su nombre, y `main` como lo aprobado.
- **23 tareas cerradas citando su número** en el commit, para que el historial
  y GitHub cuenten lo mismo.
- **Despliegue desde GitHub** para los días en que el SSH no sale desde casa. Y
  la rama de rediseño no puede tocar el servidor.
- **26 commits de documentación**: el proceso comercial —que no estaba escrito
  en ninguna parte—, la referencia de diseño y el manual de usuario.

### La regla que sostiene los dos CRMs

Todo lo de agosto está en los dos sistemas, con las **mismas 16 migraciones**
—de la 120 a la 135— aplicadas en ambos. ISEIE lleva menos commits no porque se
haga menos, sino porque recibe el trabajo ya resuelto: se prueba en uno y se
lleva al otro. Lo único que se permite distinto es la marca.

---

## 8 · Cómo se cerró el mes

A 31 de agosto WhatsApp y tutores estaban en producción en los dos CRMs, Ventas
unificado, y el rediseño integrado hasta el punto 5 del #79. Lo que se llevó a
septiembre:

- **Abonos** — la rectificativa no guardaba, estrenaba serie, perdía la moneda
  y dejaba la línea a cero. Cerrado el 31 y rematado el 1 de septiembre.
- **Interfaz de WhatsApp** — ocho puntos devueltos a Ángel más el banco de
  mensajes.
- **El rediseño**, pendiente de terminar todas las ventanas.
- **Permisos de facturación** y el bug de «Ambos» en Nuevo Prospecto.
- **Duplicados** por teléfono y usuario de WhatsApp.

---

## Una lectura del mes

Los dos módulos grandes de agosto tienen la misma forma: **la primera mitad es
construirlos y la segunda es descubrir, al usarlos de verdad, todo lo que no se
ve desde la máquina de desarrollo.** En WhatsApp fueron los audios, las
carreras entre mensajes y las sesiones cruzadas; en tutores, que el importe
pagado que llevábamos meses usando declaraba de más.

Ese segundo tramo no aparece en ninguna lista de funcionalidades, y es donde se
fue la mitad del mes.
