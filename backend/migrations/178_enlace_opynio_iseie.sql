-- 178 · El enlace de Opynio de ISEIE (#209 de MultiCRM)
--
-- La plantilla «Día 2 · Opiniones · 2 de 3» llevaba
-- https://web.opynio.com/es/empresa/iseie, que da 404: la buena es
-- …/empresa/iseie_innovation_school. Carlos la corrigió a mano en producción el
-- 02/10, pero ISEIE staging la tenía todavía mal. Esta la corrige en cualquier
-- base donde quede. Es la misma que la 188 de MultiCRM.
--
-- Idempotente: solo cambia lo que todavía lleva el enlace malo. El (?![_a-z])
-- es para no tocar el bueno, que empieza igual.
UPDATE whatsapp_templates
   SET body = regexp_replace(body, 'opynio\.com/es/empresa/iseie(?![_a-z])',
                             'opynio.com/es/empresa/iseie_innovation_school', 'g'),
       updated_at = NOW()
 WHERE body ~ 'opynio\.com/es/empresa/iseie(?![_a-z])';
