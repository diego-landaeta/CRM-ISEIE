-- Las plazas NO las lleva el CRM: solo avisa de que hay que mirarlas.
--
-- Diego, 11/09/2026: «eso lo hacen ellas desde otro sistema, no en el CRM, pero
-- si es un paso a poner» y «que el CRM no lo recuerde, solamente sea que toca
-- mandar ese mensaje de seguimiento y como un disclaimer de verificar cuantas
-- plazas quedan».
--
-- QUE CAMBIA. La cola del dia calculaba las plazas libres
-- (plazas_totales - ocupadas) y las pintaba con su semaforo. Eso era construir
-- una segunda contabilidad de las plazas dentro del CRM, y de las dos solo una
-- puede tener razon: la de admisiones. Un numero nuestro que no cuadre con el
-- suyo es peor que no dar numero, porque ese numero se manda a un cliente.
--
-- Asi que el CRM deja de contar y pasa a recordar. El aviso ambar de «sin
-- plazas configuradas» desaparece: no faltaba un dato, es que ese dato no vive
-- aqui.
--
-- LAS COLUMNAS DE `products` NO SE TOCAN. plazas_totales,
-- plazas_ocupadas_previas y fecha_cierre_convocatoria se quedan donde estan,
-- editables en la ficha del producto para quien las quiera usar. Lo que se
-- quita es que el PROCESO dependa de ellas.
--
-- Los pasos que lo piden son el 1, el 3, el 4 y el mensual; el 2 no, que ese va
-- de opiniones. Sale del propio documento: son las plantillas donde aparece
-- «[nº] plazas».

ALTER TABLE commercial_steps
  ADD COLUMN IF NOT EXISTS avisa_plazas BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN commercial_steps.avisa_plazas IS
  'Este paso manda un mensaje que dice cuantas plazas quedan: el CRM recuerda comprobarlo fuera, no lo calcula.';

-- NO se marca por la clave del paso, sino por lo que dice SU mensaje en ESE
-- proyecto. La diferencia no es teorica: el dia 4 de MultiCRM es el descuento
-- de ultima oportunidad y habla de plazas, pero el dia 4 de ISEIE es la beca
-- CETLAT y no las menciona. Marcar los dos por igual habria puesto un
-- «comprueba las plazas» encima de un mensaje que no lleva ninguna.
UPDATE commercial_steps s
   SET avisa_plazas = EXISTS (
         SELECT 1 FROM whatsapp_templates t
          WHERE t.project_id = s.project_id
            AND t.label LIKE m.prefijo
            AND t.body ILIKE '%plaza%'
       )
  FROM (VALUES
    ('paso_1',              'Día 1 ·%'),
    ('paso_2',              'Día 2 ·%'),
    ('paso_3',              'Día 3 ·%'),
    ('paso_4',              'Día 4 ·%'),
    ('seguimiento_mensual', 'Día X ·%')
  ) AS m(clave, prefijo)
 WHERE s.clave = m.clave;

-- Y la misma advertencia donde de verdad hace falta: delante de la gestora en
-- el momento de enviar. Se ANADE a la pista que ya tenga --la del dia 4 lleva
-- lo de los porcentajes, la del mensual lo de no alargarse-- en vez de
-- pisarla, y solo si no lo dice ya.
UPDATE whatsapp_templates
   SET pista = CASE
         WHEN pista IS NULL OR btrim(pista) = ''
           THEN 'Comprueba cuántas plazas quedan antes de enviar: el CRM no las lleva y nunca se arrastra el número del mensaje anterior.'
           ELSE pista || ' · Comprueba cuántas plazas quedan antes de enviar: el CRM no las lleva.'
       END,
       updated_at = NOW()
 WHERE body ILIKE '%plaza%'
   AND COALESCE(pista, '') NOT ILIKE '%cuántas plazas quedan%';

DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_steps TO %I', u);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO %I', u);
    END IF;
  END LOOP;
END $$;
