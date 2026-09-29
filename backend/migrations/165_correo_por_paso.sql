-- El correo de cada paso, atado al paso (la otra mitad del #88).

-- Las plantillas de WhatsApp ya saben de que paso son (migracion 172). Las de
-- correo no: «Dia 1 · Informacion y dossier» lo dice en el nombre, que sirve
-- para que lo lea una persona y no para que el CRM pueda coger la que toca.
--
-- El proceso no es solo WhatsApp: el dia 1 manda el dossier por correo y los
-- dias 3 y 4 llevan el suyo. Sin esta columna, la ficha puede ofrecer el
-- mensaje del paso pero no su correo, y la gestora tiene que acordarse de cual
-- era entre las tres de la lista.
--
-- Se ata por CLAVE y no por id, igual que las de WhatsApp: los pasos son por
-- proyecto y las claves son las mismas en todos.

ALTER TABLE email_templates
  ADD COLUMN IF NOT EXISTS paso_clave VARCHAR(40);

COMMENT ON COLUMN email_templates.paso_clave IS
  'Paso del proceso comercial al que pertenece (commercial_steps.clave). NULL = correo suelto, no del proceso.';

-- El reparto sale del nombre, que es donde vive hoy, y se hace una sola vez.
UPDATE email_templates SET paso_clave = 'paso_1'
 WHERE paso_clave IS NULL AND name ~ '^D[ií]a 1 ';
UPDATE email_templates SET paso_clave = 'paso_2'
 WHERE paso_clave IS NULL AND name ~ '^D[ií]a 2 ';
UPDATE email_templates SET paso_clave = 'paso_3'
 WHERE paso_clave IS NULL AND name ~ '^D[ií]a 3 ';
UPDATE email_templates SET paso_clave = 'paso_4'
 WHERE paso_clave IS NULL AND name ~ '^D[ií]a 4 ';
UPDATE email_templates SET paso_clave = 'seguimiento_mensual'
 WHERE paso_clave IS NULL AND name ~ '^D[ií]a X ';

-- Para pedir «el correo del paso 3 de este proyecto» sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS idx_email_templates_paso
  ON email_templates (project_id, paso_clave)
  WHERE paso_clave IS NOT NULL;
