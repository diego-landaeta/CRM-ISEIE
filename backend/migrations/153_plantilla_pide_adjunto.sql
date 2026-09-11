-- Plantillas que llevan una imagen detrás.
--
-- Diego: «la de Opynio es como el mensaje de "mira esta reseña" y pones ahí para
-- insertar imagen».
--
-- El documento lo dice en el día 2: el primer mensaje anuncia la opinión y
-- «(enviar la captura justo después)». La captura sale de la página de Opynio
-- —el CRM no conoce la reseña— pero sí puede hacer que no se olvide: hoy eliges
-- la plantilla, se te pone el texto en el cuadro, y nada te recuerda el clip.
--
-- DOS CAMPOS Y NO UNO:
--
--   · `pide_adjunto` es para la MAQUINA: al elegir esa plantilla, el chat abre
--     el selector de archivos.
--   · `pista` es para la PERSONA, y NO se envía. Es lo que el documento pone en
--     letra pequeña debajo de cada plantilla («va separado: es el que abre
--     conversación», «funciona mejor en nota de voz»). Hasta ahora eso solo
--     estaba en el PDF, y el PDF no lo tiene nadie abierto mientras escribe.
--
-- La pista NO puede ir dentro del cuerpo: lo que está en el cuerpo se manda, y
-- un «[adjunta la captura]» acabaría en el móvil de un cliente.

ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS pide_adjunto BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE whatsapp_templates
  ADD COLUMN IF NOT EXISTS pista TEXT;

COMMENT ON COLUMN whatsapp_templates.pide_adjunto IS
  'Al elegirla, el chat abre el selector de archivos: esta plantilla va con una imagen detras.';
COMMENT ON COLUMN whatsapp_templates.pista IS
  'Aviso para la gestora, NO se envia. Es la letra pequena del documento comercial.';

-- El día 2, primer mensaje: anuncia la opinión y detrás va la captura.
UPDATE whatsapp_templates
   SET pide_adjunto = TRUE,
       pista = 'Adjunta la captura de una opinión de esta formación justo después. Sale de la página de Opynio, el CRM no la tiene.',
       updated_at = NOW()
 WHERE label = 'Día 2 · Opiniones · 1 de 3';

-- Y de paso, la letra pequeña del resto de plantillas del proceso, que hasta
-- ahora solo vivia en el PDF.
UPDATE whatsapp_templates SET pista = v.pista, updated_at = NOW()
  FROM (VALUES
    ('Día 1 · Saludo',
     'Mejor en nota de voz: sube mucho la tasa de respuesta. Si elige un medio, se sigue por ese medio; solo se llama si pide llamada.'),
    ('Día 1 · Ficha de la formación',
     'Comprueba las plazas ANTES de enviar: nunca se arrastra el dato del mensaje anterior. Después, el dossier.'),
    ('Día 2 · Opiniones · 3 de 3',
     'Va en un mensaje aparte a propósito: es el que abre conversación.'),
    ('Día 3 · Última plaza · 2 de 2',
     'El 5 % de contado solo aplica en máster y diplomado, y se ofrece aquí, no antes.'),
    ('Día 4 · Becas CETLAT',
     'Recuérdale que rellene TODOS los campos: una solicitud incompleta no entra a evaluación.'),
    ('Día 4 · Descuento de última oportunidad',
     'Interno, no se comparte: formación nueva máx. 40 %; formación ya habilitada hasta 70 %, reservado para quien casi no ha respondido.'),
    ('Día X · Seguimiento de fin de mes',
     'El mensaje más corto de la secuencia. Si se alarga, vuelve a parecer una venta.')
  ) AS v(label, pista)
 WHERE whatsapp_templates.label = v.label
   AND whatsapp_templates.pista IS DISTINCT FROM v.pista;

DO $$
DECLARE
  u TEXT;
BEGIN
  FOREACH u IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = u) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_templates TO %I', u);
    END IF;
  END LOOP;
END $$;
