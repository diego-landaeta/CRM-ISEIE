-- El dia 4 donde no hay CETLAT, y el enlace real de opiniones.
--
-- Diego, 2026-09-11: «agarralo del doc».
--
-- EL DIA 4. El documento lo titula «Convocatoria de becas CETLAT», que es una
-- alianza de ISEIE: en MultiCRM ese paso se llama «Descuento de ultima
-- oportunidad» y no hay beca que ofrecer. Pero el CONTENIDO del dia 4 si esta
-- en el documento, y es lo que se usa aqui: un porcentaje sobre el importe de
-- la matricula, ofrecido el lunes o martes de la semana siguiente, como ultimo
-- recurso antes del cierre.
--
-- La regla de cuanto se puede dar es INTERNA y el documento lo marca asi —
-- «INTERNO · NO SE COMPARTE: formacion nueva max. 40 %; formacion ya habilitada
-- hasta 70 %, reservado para quien casi no ha respondido». Por eso el
-- porcentaje va como hueco en la plantilla y el techo queda en la descripcion,
-- que la ve la gestora y no el cliente.
--
-- EL ENLACE DE OPINIONES. Diego: «opynio lo tienen que sacar desde la pagina de
-- opynio de ISEIE, el CRM no te va a dar la resena». Correcto: la resena vive
-- fuera y el CRM no la conoce. Lo unico que puede hacer es no obligar a
-- buscar la direccion cada vez, asi que donde se sabe —ISEIE— se deja escrita.

-- Idempotente.

-- ── 1. El dia 4 donde el paso NO es la beca ─────────────────────────────────
INSERT INTO whatsapp_templates (project_id, label, body, ambito, orden, active)
SELECT s.project_id, 'Día 4 · Descuento de última oportunidad', $tpl$Buenos días {nombre} 👋

Antes de que cierre la convocatoria de {producto} he podido conseguirte un descuento sobre el importe de la matrícula.

En tu caso serían [nº] % menos, y el importe quedaría en [importe final].

¿Te reservo la plaza con esas condiciones?$tpl$, 'compartida', 9, true
  FROM commercial_steps s
 WHERE s.clave = 'paso_4' AND s.nombre NOT ILIKE '%CETLAT%'
   AND NOT EXISTS (
     SELECT 1 FROM whatsapp_templates t
      WHERE t.project_id = s.project_id AND t.label = 'Día 4 · Descuento de última oportunidad'
   );

INSERT INTO email_templates (project_id, name, subject, body_html, description, active)
SELECT s.project_id, 'Día 4 · Descuento de última oportunidad',
       'Descuento de última oportunidad · {producto}',
       $tpl$Hola {nombre}:

Te escribo antes de que cierre la convocatoria de {producto}.

He podido conseguirte un descuento sobre el importe de la matrícula, y te lo confirmo por escrito:

· Importe de convocatoria: [importe]
· Descuento aplicado: [nº] %
· Importe final: [importe final]
· Plazas disponibles a día de hoy: [nº]
· Cierre de convocatoria: [fecha]

QUÉ NECESITO PARA RESERVAR LA PLAZA
· Confirmación de que quieres acogerte al descuento
· Documento de identidad y titulación previa (si aplica)
· [Método de pago disponible en tu país]

Si me confirmas hoy, te reservo la plaza con ese importe hasta [fecha].

Un saludo,
[tu nombre] · Asesora comercial
{proyecto}$tpl$,
       'INTERNO, no se comparte: formación nueva máx. 40 %; formación ya habilitada hasta 70 %, reservado para quien casi no ha respondido.',
       true
  FROM commercial_steps s
 WHERE s.clave = 'paso_4' AND s.nombre NOT ILIKE '%CETLAT%'
   AND NOT EXISTS (
     SELECT 1 FROM email_templates t
      WHERE t.project_id = s.project_id AND t.name = 'Día 4 · Descuento de última oportunidad'
   );

-- El techo del descuento, donde la gestora lo va a leer: en la nota del paso.
UPDATE commercial_steps
   SET nota = COALESCE(NULLIF(TRIM(nota), '') || ' · ', '')
              || 'Interno, no se comparte: formación nueva máx. 40 %; formación ya habilitada hasta 70 %, reservado para quien casi no ha respondido.',
       updated_at = NOW()
 WHERE clave = 'paso_4'
   AND nombre NOT ILIKE '%CETLAT%'
   AND COALESCE(nota, '') NOT ILIKE '%no se comparte%';

-- ── 2. El enlace de opiniones donde se conoce ───────────────────────────────
-- Solo ISEIE: es su pagina de Opynio. En los demas proyectos el hueco se queda,
-- porque poner el enlace de otra institucion seria peor que no poner ninguno.
UPDATE whatsapp_templates
   SET body = REPLACE(body, '[enlace de opiniones]', 'https://web.opynio.com/es/empresa/iseie'),
       updated_at = NOW()
 WHERE label = 'Día 2 · Opiniones · 2 de 3'
   AND body LIKE '%[enlace de opiniones]%'
   AND project_id IN (
     SELECT project_id FROM commercial_steps
      WHERE clave = 'paso_4' AND nombre ILIKE '%CETLAT%'
   );

-- Y el recordatorio del documento que no se puede automatizar: la resena vive
-- en Opynio, no aqui. Que la gestora sepa que si no hay opinion de ese curso
-- hay que pedir que se cree, en vez de saltarse el paso.
UPDATE commercial_steps
   SET nota = COALESCE(NULLIF(TRIM(nota), '') || ' · ', '')
              || 'Si la formación no tiene opiniones publicadas, se envía la captura de la vista general y se pide internamente que se cree la de ese curso.',
       updated_at = NOW()
 WHERE clave = 'paso_2'
   AND COALESCE(nota, '') NOT ILIKE '%opiniones publicadas%';
