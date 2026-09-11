-- Las plantillas del proceso comercial, cargadas de verdad.
--
-- Diego: «hagamos nosotros esas tareas». El documento
-- `docs/proceso-comercial.pdf` trae ocho plantillas escritas y aprobadas, y
-- hasta hoy no estaban en el CRM: las 36 filas de `whatsapp_templates` eran
-- relleno generico —«Saludo inicial», «Seguimiento», «Oferta», «Reactivar»,
-- cuatro iguales por proyecto— con textos de ejemplo del tipo «tenemos una
-- oferta especial hasta el viernes». Y `email_templates` estaba a cero.
--
-- POR QUE VAN PARTIDAS. El documento es explicito: «mensajes cortos, si no cabe
-- en la pantalla del movil sin desplazarse, parte el mensaje». Por eso el dia 2
-- son TRES plantillas y el dia 3 son DOS. Juntarlas seria mas comodo de cargar
-- y peor de usar.
--
-- LOS HUECOS SE QUEDAN. `{nombre}`, `{producto}` y `{proyecto}` los rellena el
-- CRM; lo que va [entre corchetes] lo escribe la gestora antes de enviar, que
-- es justo lo que pide el documento («lo marcado en amarillo se sustituye antes
-- de enviar»). Rellenarlos automaticamente con datos que el CRM no tiene
-- —plazas reales, importes del plan de pagos— seria peor que dejarlos: se
-- enviarian cifras inventadas.
--
-- EL DIA 4 NO ES IGUAL EN LOS DOS CRMS y no se decide aqui: se mira lo que ya
-- hay configurado en `commercial_steps`. Donde el paso 4 es la beca CETLAT
-- —ISEIE— se carga su plantilla; donde es un descuento —MultiCRM— NO se carga
-- nada, porque el documento no trae ese texto y no se inventa. Queda pendiente
-- de que Diego lo dicte.

-- Idempotente: se puede volver a pasar sin duplicar nada.

-- ── 1. Las genericas dejan de estorbar ──────────────────────────────────────
-- No se borran: se desactivan. La pantalla filtra por `active`, asi que dejan
-- de aparecer, pero si alguien las echaba de menos siguen ahi.
UPDATE whatsapp_templates
   SET active = false, updated_at = NOW()
 WHERE active
   AND label IN ('Saludo inicial', 'Seguimiento', 'Oferta', 'Reactivar');

-- ── 2. Las de WhatsApp, para todos los proyectos ────────────────────────────
INSERT INTO whatsapp_templates (project_id, label, body, ambito, orden, active)
SELECT p.id, v.label, v.body, 'compartida', v.orden, true
  FROM projects p
 CROSS JOIN (VALUES
  (1, 'Día 1 · Saludo', $tpl$Hola, buenas tardes. Soy [tu nombre], asesora comercial de {proyecto}.

En respuesta a tu solicitud de información sobre {producto}, puedo enviarte los detalles por correo, agendar una llamada a la hora que prefieras, o seguir por este medio.

¿Qué opción te resulta más cómoda? 🎓$tpl$),

  (2, 'Día 1 · Ficha de la formación', $tpl${producto} 👨🏻‍🎓

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
6. Diploma de [nº] horas expedido por {proyecto}, institución europea, acreditado y apostillado a nivel internacional por La Haya (opcional).

Inversión total: [importe]
Plazas disponibles: [nº]
Cierre de convocatoria: [fecha] o hasta agotar plazas.$tpl$),

  (3, 'Día 1 · Aviso de correo enviado', $tpl$Te acabo de dejar un correo con toda la información y los dossiers 📩

Échale un ojo cuando puedas y revisa también la carpeta de spam por si acaso.$tpl$),

  (4, 'Día 2 · Opiniones · 1 de 3', $tpl$Hola {nombre} 👋

Ayer se me olvidó enviarte una de nuestras últimas opiniones sobre {producto}.$tpl$),

  (5, 'Día 2 · Opiniones · 2 de 3', $tpl$Te dejo por aquí el link para que puedas revisarlas todas:
[enlace de opiniones]$tpl$),

  (6, 'Día 2 · Opiniones · 3 de 3', $tpl$Por otro lado, ¿pudiste revisar toda la información de la formación?$tpl$),

  (7, 'Día 3 · Última plaza · 1 de 2', $tpl$Buenos días {nombre} 🙂

Estamos próximos al cierre de convocatoria: quedan [nº] plazas en el grupo de [mes] y mi superior me ha autorizado a reservarte una de ellas con financiamiento.$tpl$),

  (8, 'Día 3 · Última plaza · 2 de 2', $tpl$Funcionaría así:

· Reserva de matrícula: [importe]
· [nº] cuotas de [importe], sin intereses
· Primera cuota: [fecha]

También tienes la opción de pago al contado con un 5 % de descuento.$tpl$),

  (10, 'Día X · Seguimiento de fin de mes', $tpl$Hola {nombre} 😊

Soy [tu nombre], de {proyecto}. Te escribo solo para saber cómo va todo.

Seguimos con matrícula abierta en {producto}, quedan [nº] plazas, y estoy por aquí por si tienes alguna duda o quieres que te amplíe la información.$tpl$)
 ) AS v(orden, label, body)
 WHERE NOT EXISTS (
   SELECT 1 FROM whatsapp_templates t
    WHERE t.project_id = p.id AND t.label = v.label
 );

-- ── 3. El dia 4, solo donde el paso configurado es la beca ──────────────────
-- Se mira `commercial_steps`, que ya distingue los dos CRMs. Asi esta migracion
-- es identica en los dos repos y decide con los datos, no con el fichero.
INSERT INTO whatsapp_templates (project_id, label, body, ambito, orden, active)
SELECT s.project_id, 'Día 4 · Becas CETLAT', $tpl$Buenos días {nombre} 👋

Hemos abierto una convocatoria de becas de hasta el 40 % en tu formación. Gracias a nuestra alianza con CETLAT (Consejo Educativo Trasatlántico Latino-Europeo), puedes solicitar una beca en tu matrícula.

🔗 Postula aquí: https://cetlat.org/solicitud-beca/
⏳ El proceso de evaluación tarda entre 48 y 72 horas.$tpl$, 'compartida', 9, true
  FROM commercial_steps s
 WHERE s.clave = 'paso_4' AND s.nombre ILIKE '%CETLAT%'
   AND NOT EXISTS (
     SELECT 1 FROM whatsapp_templates t
      WHERE t.project_id = s.project_id AND t.label = 'Día 4 · Becas CETLAT'
   );

-- ── 4. Los correos ──────────────────────────────────────────────────────────
-- `email_templates` estaba vacia. Los tres adjuntos del dia 1 van escritos en
-- el cuerpo porque el documento los exige; que el envio los OBLIGUE es otra
-- tarea, no esta.
INSERT INTO email_templates (project_id, name, subject, body_html, description, active)
SELECT p.id, v.name, v.subject, v.body, v.descripcion, true
  FROM projects p
 CROSS JOIN (VALUES
  ('Día 1 · Información y dossier',
   'Información y dossier · {producto} — {proyecto}',
   $tpl$Hola {nombre}:

Soy [tu nombre], asesora comercial de {proyecto}. Te envío la información de {producto}, tal y como me pediste.

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

Quedo pendiente por si prefieres que agendemos una llamada o resolvemos las dudas por WhatsApp, lo que te resulte más cómodo.

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}
[teléfono] · [correo]$tpl$,
   'Los TRES adjuntos son obligatorios: sin los tres, el correo no sale.'),

  ('Día 3 · Última plaza y condiciones de pago',
   'Última plaza y condiciones de pago · {producto}',
   $tpl$Hola {nombre}:

Te escribo para confirmarte por escrito lo que hablamos por WhatsApp.

Estamos a [nº] días del cierre de convocatoria, quedan [nº] plazas en el grupo de [mes de inicio] y he podido reservarte una de ellas.

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
{proyecto}$tpl$,
   'El 5 % de contado solo aplica en máster y diplomado.')
 ) AS v(name, subject, body, descripcion)
 WHERE NOT EXISTS (
   SELECT 1 FROM email_templates t
    WHERE t.project_id = p.id AND t.name = v.name
 );

-- El correo de la beca, otra vez solo donde el paso 4 es CETLAT.
INSERT INTO email_templates (project_id, name, subject, body_html, description, active)
SELECT s.project_id, 'Día 4 · Convocatoria de becas CETLAT',
       'Convocatoria de becas CETLAT · {producto}',
       $tpl$Hola {nombre}:

Te escribo porque se ha abierto una convocatoria de becas que puede aplicarse a tu formación.

LA BECA
· Entidad: CETLAT, Consejo Educativo Trasatlántico Latino-Europeo, con el que {proyecto} mantiene una alianza
· Cobertura: hasta un 40 % del importe de la matrícula
· Formación: {producto} — diploma de [nº] horas, con [nº] plazas disponibles
· Resolución: entre 48 y 72 horas desde el envío de la solicitud

CÓMO SOLICITARLA
1. Entra en https://cetlat.org/solicitud-beca/
2. Rellena el formulario completo: datos personales, formación solicitada y motivación
3. Envíalo y espera la resolución por correo

Importante: las solicitudes incompletas no entran a evaluación, así que revisa que no quede ningún campo vacío.

DOCUMENTOS ADJUNTOS
1. Bases de la convocatoria de becas CETLAT
2. Dossier de la formación

En cuanto tengas la resolución, avísame y cerramos la matrícula con el importe ya ajustado.

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}$tpl$,
       'Solo ISEIE: CETLAT es su alianza. Una solicitud incompleta no entra a evaluación.',
       true
  FROM commercial_steps s
 WHERE s.clave = 'paso_4' AND s.nombre ILIKE '%CETLAT%'
   AND NOT EXISTS (
     SELECT 1 FROM email_templates t
      WHERE t.project_id = s.project_id AND t.name = 'Día 4 · Convocatoria de becas CETLAT'
   );

-- Permisos (#71): las tablas ya existian, pero se repasa por si la migracion
-- corre sobre una base donde se crearon como postgres.
DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO %I', u);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON email_templates TO %I', u);
    END IF;
  END LOOP;
END $$;
