# Plantillas del proceso comercial

Las plantillas de `docs/proceso-comercial.pdf`, adaptadas a las variables del
CRM y listas para cargar. **El PDF es el original y manda**; esto es su versión
operativa.

## Cómo leerlas

- `{nombre}`, `{producto}`, `{proyecto}`, `{email}`, `{telefono}` los rellena el
  CRM solo. Ver `frontend/src/modules/whatsapp/lib/plantilla.ts`.
- `[entre corchetes]` son los huecos que rellena la gestora antes de enviar. Es
  lo que el documento llama «lo marcado en amarillo».
- `{proyecto}` es el nombre de la institución del proyecto. En ISEIE sale «ISEIE
  Innovation School»; en MultiCRM, el campus que toque.

## Reglas que condicionan estas plantillas

Del documento, y no son opcionales:

- **Mensajes cortos.** «Si no cabe en la pantalla del móvil sin desplazarse,
  parte el mensaje». Por eso el día 2 son **tres** mensajes y el día 3 son
  **dos**, no uno largo.
- **Las plazas se comprueban antes de cada envío**, nunca se arrastra el dato
  del mensaje anterior. Van en el día 1, el 3, el 4 y el mensual.
- **Horas lectivas y diploma** siempre que se envía información de la formación.
- **Cada correo se avisa por WhatsApp.** Nunca se da por hecho que lo ha visto.
- **El 5 % de contado es del día 3** y solo en máster y diplomado.
- **Los pasos de admisión no salen** hasta que la persona confirma interés.

---

# WhatsApp

## Día 1 · Saludo

> Mejor en nota de voz: sube mucho la tasa de respuesta.

```
Hola, buenas tardes. Soy [tu nombre], asesora comercial de {proyecto}.

En respuesta a tu solicitud de información sobre {producto}, puedo enviarte los
detalles por correo, agendar una llamada a la hora que prefieras, o seguir por
este medio.

¿Qué opción te resulta más cómoda? 🎓
```

Si elige un medio, se sigue por ese medio. Solo se llama si pide llamada.
Si no contesta en 1–2 h → información por correo y WhatsApp.

## Día 1 · Ficha de la formación

```
{producto} 👨🏻‍🎓

Información general
Inicio: [fecha de inicio]
Duración: [nº meses] · [nº] horas lectivas
Modalidad: Virtual
Titulación: Diploma de [nº] horas

¿Qué incluye? ✨
1. Plataforma educativa: acceso al campus virtual.
2. Experiencia digital: 100 % online.
3. Tutor asignado: acompañamiento en tus dudas.
4. Chat con el tutor y correo electrónico.
5. Ritmo personalizado: avanzas a tu propio ritmo.
6. Diploma de [nº] horas expedido por {proyecto}, institución europea,
   acreditado y apostillado a nivel internacional por La Haya (opcional).

Inversión total: [importe]
Plazas disponibles: [nº]
Cierre de convocatoria: [fecha] o hasta agotar plazas.
```

Después: dossier de la formación y «cualquier duda me escribes».

## Día 1 · Aviso de correo enviado

```
Te acabo de dejar un correo con toda la información y los dossiers 📩

Échale un ojo cuando puedas y revisa también la carpeta de spam por si acaso.
```

## Día 2 · Opiniones · 1 de 3

```
Hola {nombre} 👋

Ayer se me olvidó enviarte una de nuestras últimas opiniones sobre {producto}.
```

Enviar la captura justo después de este mensaje.

## Día 2 · Opiniones · 2 de 3

```
Te dejo por aquí el link para que puedas revisarlas todas:
[enlace de opiniones]
```

En ISEIE el enlace es `https://web.opynio.com/es/empresa/iseie`.

## Día 2 · Opiniones · 3 de 3

```
Por otro lado, ¿pudiste revisar toda la información de la formación?
```

Va separado a propósito: es el que abre conversación.

## Día 3 · Última plaza · 1 de 2

```
Buenos días {nombre} 🙂

Estamos próximos al cierre de convocatoria: quedan [nº] plazas en el grupo de
[mes] y mi superior me ha autorizado a reservarte una de ellas con
financiamiento.
```

## Día 3 · Última plaza · 2 de 2

```
Funcionaría así:

· Reserva de matrícula: [importe]
· [nº] cuotas de [importe], sin intereses
· Primera cuota: [fecha]

También tienes la opción de pago al contado con un 5 % de descuento.
```

El 5 % **solo** en máster y diplomado.

## Día 4 · Becas CETLAT · SOLO ISEIE

```
Buenos días {nombre} 👋

Hemos abierto una convocatoria de becas de hasta el 40 % en tu formación.
Gracias a nuestra alianza con CETLAT (Consejo Educativo Trasatlántico
Latino-Europeo), puedes solicitar una beca en tu matrícula.

🔗 Postula aquí: https://cetlat.org/solicitud-beca/
⏳ El proceso de evaluación tarda entre 48 y 72 horas.
```

Recordarle que debe rellenar **todos** los campos: una solicitud incompleta no
entra a evaluación.

Interno, no se comparte: formación nueva máx. 40 %; formación ya habilitada
hasta 70 %, reservado para quien casi no ha respondido.

## Día 4 · Descuento de última oportunidad · SOLO MULTICRM

> **PENDIENTE DE TEXTO.** CETLAT es una alianza de ISEIE y en MultiCRM el paso 4
> es un descuento, no una beca. El documento no trae plantilla para este caso, y
> **no me invento las condiciones**. Falta que Diego diga el porcentaje, si tiene
> fecha límite y con qué nombre se presenta.

```
Buenos días {nombre} 👋

[pendiente de definir el texto del descuento de última oportunidad]
```

## Día X · Seguimiento de fin de mes

```
Hola {nombre} 😊

Soy [tu nombre], de {proyecto}. Te escribo solo para saber cómo va todo.

Seguimos con matrícula abierta en {producto}, quedan [nº] plazas, y estoy por
aquí por si tienes alguna duda o quieres que te amplíe la información.
```

El mensaje más corto de la secuencia. Si se alarga, vuelve a parecer una venta.

---

# Correo

## Día 1 · Información y dossier

**Asunto:** `Información y dossier · {producto} — {proyecto}`

```
Hola {nombre}:

Soy [tu nombre], asesora comercial de {proyecto}. Te envío la información de
{producto}, tal y como me pediste.

DATOS DE LA FORMACIÓN
· Inicio: [fecha]
· Duración: [nº meses] · [nº] horas lectivas
· Modalidad: 100 % online, con ritmo personalizado
· Inversión total: [importe]
· Plazas disponibles: [nº] de [total]
· Cierre de convocatoria: [fecha] o hasta agotar plazas

QUÉ INCLUYE
· Acceso al campus virtual durante toda la formación
· Tutor asignado, con chat directo y soporte por correo
· Materiales descargables y evaluaciones en línea

TITULACIÓN QUE OBTIENES
· Diploma de {producto}
· Carga lectiva certificada: [nº] horas
· Expedido por {proyecto}, institución europea
· Acreditación y apostilla de La Haya a nivel internacional (opcional)

DOCUMENTOS ADJUNTOS
1. Dossier de la formación — programa, módulos y salidas profesionales
2. Guía del campus virtual (Moodle) — cómo accedes y cómo se estudia
3. Dossier de homologaciones y acreditaciones

Quedo pendiente por si prefieres que agendemos una llamada o resolvemos las
dudas por WhatsApp, lo que te resulte más cómodo.

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}
[teléfono] · [correo]
```

**Los tres adjuntos son obligatorios. Sin los tres, el correo no sale.**

## Día 3 · Última plaza y condiciones de pago

**Asunto:** `Última plaza y condiciones de pago · {producto}`

```
Hola {nombre}:

Te escribo para confirmarte por escrito lo que hablamos por WhatsApp.

Estamos a [nº] días del cierre de convocatoria, quedan [nº] plazas en el grupo
de [mes de inicio] y he podido reservarte una de ellas.

OPCIÓN 1 · PAGO FRACCIONADO
· Reserva de matrícula: [importe]
· [nº] cuotas mensuales de [importe], sin intereses
· Primera cuota: [fecha]
· El acceso al campus se activa con la reserva
· Plazas disponibles a día de hoy: [nº]

OPCIÓN 2 · PAGO AL CONTADO
· Importe con 5 % de descuento: [importe final]
· Ahorro respecto al precio de convocatoria: [importe]
· Aplicable a máster y diplomado

QUÉ NECESITO PARA RESERVAR LA PLAZA
· Confirmación de la opción que prefieres
· Documento de identidad y titulación previa (si aplica)
· [Método de pago disponible en tu país]

DOCUMENTOS ADJUNTOS
1. Condiciones de matrícula y plan de pagos
2. Dossier de la formación

Si me confirmas hoy, te reservo la plaza sin compromiso hasta [fecha].

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}
```

## Día 4 · Convocatoria de becas CETLAT · SOLO ISEIE

**Asunto:** `Convocatoria de becas CETLAT · {producto}`

```
Hola {nombre}:

Te escribo porque se ha abierto una convocatoria de becas que puede aplicarse a
tu formación.

LA BECA
· Entidad: CETLAT, Consejo Educativo Trasatlántico Latino-Europeo, con el que
  {proyecto} mantiene una alianza
· Cobertura: hasta un 40 % del importe de la matrícula
· Formación: {producto} — diploma de [nº] horas, con [nº] plazas disponibles
· Resolución: entre 48 y 72 horas desde el envío de la solicitud

CÓMO SOLICITARLA
1. Entra en https://cetlat.org/solicitud-beca/
2. Rellena el formulario completo: datos personales, formación solicitada y
   motivación
3. Envíalo y espera la resolución por correo

Importante: las solicitudes incompletas no entran a evaluación, así que revisa
que no quede ningún campo vacío.

DOCUMENTOS ADJUNTOS
1. Bases de la convocatoria de becas CETLAT
2. Dossier de la formación

En cuanto tengas la resolución, avísame y cerramos la matrícula con el importe
ya ajustado.

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}
```
