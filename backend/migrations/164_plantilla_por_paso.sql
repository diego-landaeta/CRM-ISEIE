-- Cada plantilla, atada a su paso del proceso comercial.
--
-- Las plantillas del documento ya estaban cargadas (#129), pero solo el nombre
-- decia a que paso pertenecen: «Dia 1 · Saludo», «Dia 2 · Opiniones · 1 de 3».
-- Eso sirve para que lo lea una persona, no para que el CRM pueda coger la que
-- toca. Y sin eso, la cola del dia (#90) no puede ofrecer «la plantilla de esta
-- persona»: es lo unico que le falta para cerrarse.
--
-- Se ata por CLAVE del paso y no por id: los pasos son por proyecto —cada uno
-- tiene su fila en commercial_steps— y una plantilla compartida vale para los
-- diez. La clave es la misma en todos.
--
-- Las cuatro sueltas de antes (Saludo inicial, Seguimiento, Oferta, Reactivar)
-- se quedan sin paso a proposito: no son del proceso.

ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS paso_clave VARCHAR(40);

COMMENT ON COLUMN whatsapp_templates.paso_clave IS
  'Paso del proceso comercial al que pertenece (commercial_steps.clave). NULL = plantilla suelta, no del proceso.';

-- El reparto sale del nombre, que es donde vive hoy. Se hace una sola vez: a
-- partir de aqui la columna manda, y quien cree una plantilla nueva elige su
-- paso en la pantalla.
UPDATE whatsapp_templates SET paso_clave = 'paso_1'
 WHERE paso_clave IS NULL AND label ~ '^D[ií]a 1 ';
UPDATE whatsapp_templates SET paso_clave = 'paso_2'
 WHERE paso_clave IS NULL AND label ~ '^D[ií]a 2 ';
UPDATE whatsapp_templates SET paso_clave = 'paso_3'
 WHERE paso_clave IS NULL AND label ~ '^D[ií]a 3 ';
UPDATE whatsapp_templates SET paso_clave = 'paso_4'
 WHERE paso_clave IS NULL AND label ~ '^D[ií]a 4 ';
UPDATE whatsapp_templates SET paso_clave = 'seguimiento_mensual'
 WHERE paso_clave IS NULL AND label ~ '^D[ií]a X ';

-- Para pedir «las del paso 2 de este proyecto» sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_paso
  ON whatsapp_templates (project_id, paso_clave, orden)
  WHERE paso_clave IS NOT NULL;
