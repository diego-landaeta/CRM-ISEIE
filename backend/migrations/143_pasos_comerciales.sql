-- #87 · Los cinco pasos del proceso comercial, en la base y editables.
--
-- Hoy el prospecto tiene 6 estados que son un ENUM de Postgres mas 32 ficheros
-- donde estan escritos a mano, y ninguno dice en cual de los cinco momentos del
-- proceso comercial va la persona: `contactado` y `en_seguimiento` valen igual
-- para el dia 1 que para el dia 4.
--
-- ESTA TABLA NO TOCA ESOS ESTADOS. Es una capa nueva encima. Romper el ENUM
-- rompe las conversiones, y no hace ninguna falta para esto.
--
-- Por que en la base y no en el codigo: porque el documento comercial cambia
-- —ya ha cambiado— y cada cambio no puede ser un despliegue. Y porque cada
-- proyecto puede llevar su propio proceso.
--
-- LOS DIAS SON DIAS DESDE QUE ENTRA EL LEAD, no dias de la semana. El documento
-- los enseña como «lunes o martes», «miercoles o jueves», «viernes», pero eso es
-- el caso de un lead que entra un lunes; lo que de verdad ordena el proceso es
-- cuanto lleva la persona esperando. `cuando` guarda la etiqueta del documento
-- para que en pantalla se lea igual que en el papel.

CREATE TABLE IF NOT EXISTS commercial_steps (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- `clave` es el nombre estable con el que el codigo se refiere al paso. El
  -- `nombre` se puede cambiar desde la pantalla y no debe romper nada.
  clave             TEXT NOT NULL,
  nombre            TEXT NOT NULL,
  orden             INTEGER NOT NULL,

  -- La etiqueta del documento, tal cual: «Lunes o martes».
  cuando            TEXT,

  -- Ventana en dias desde que entro el lead. NULL en el seguimiento mensual,
  -- que no va por dias sino por fin de mes.
  dia_desde         INTEGER,
  dia_hasta         INTEGER,

  -- En el orden del documento. El primero es con el que se arranca.
  canales           TEXT[] NOT NULL DEFAULT '{}',

  -- El seguimiento de fin de mes es toda la base, no la cola del dia. Se marca
  -- para poder dejarlo fuera de «que toca hoy» sin tener que reconocerlo por el
  -- nombre, que es editable.
  es_seguimiento    BOOLEAN NOT NULL DEFAULT false,

  -- Los avisos en recuadro del documento («NO INCLUIR TODAVIA», «LIMITE»...).
  nota              TEXT,

  activo            BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- La clave es unica dentro del proyecto: es por donde entra el codigo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_commercial_steps_proyecto_clave
  ON commercial_steps (project_id, clave);

-- El orden NO lleva unico a proposito: reordenar con un unico simple obliga a
-- pasar por valores temporales o a diferirlo, y no gana nada. Un empate en el
-- orden se resuelve por id, que no cambia.
CREATE INDEX IF NOT EXISTS idx_commercial_steps_proyecto_orden
  ON commercial_steps (project_id, orden);

-- El #71, en directo y por una vez a tiempo.
--
-- En produccion esta migracion la tiene que correr `postgres`, porque las tablas
-- viejas son suyas y el usuario del CRM no puede alterarlas. El efecto de lado
-- es que TODO lo que se cree por el camino nace siendo de postgres, y entonces
-- el usuario del CRM no puede ni leer su propia tabla nueva. Asi es como se
-- llego a la situacion del #71: nadie lo dijo en su momento.
--
-- Se le da acceso explicitamente al usuario que exista en esta instalacion
-- —`crm_user` en MultiCRM, `crm_iseie_user` en ISEIE— y la migracion sigue
-- valiendo igual en los dos sin tener dos versiones.
DO $$
DECLARE rol TEXT;
BEGIN
  FOREACH rol IN ARRAY ARRAY['crm_user', 'crm_iseie_user'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rol) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON commercial_steps TO %I', rol);
      EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE commercial_steps_id_seq TO %I', rol);
    END IF;
  END LOOP;
END $$;

-- Los cinco del documento, para cada proyecto que aun no los tenga. Se cargan
-- como DATOS: a partir de aqui se editan desde la pantalla, no desde aqui.
-- `cuando` va a NULL en los que tienen ventana de dias: la frase —«a los
-- 2 o 3 dias»— se DICE a partir de `dia_desde`/`dia_hasta`, no se escribe
-- aparte. Antes se sembraba «Lunes o martes» copiado del documento, y la
-- pantalla acababa avisando de que no son dias de la semana con un dia de
-- la semana escrito justo debajo. Un texto que repite lo que dice otro
-- campo siempre termina contradiciendolo.
--
-- Se queda para lo que NO tiene ventana, como «Final de mes».
INSERT INTO commercial_steps
  (project_id, clave, nombre, orden, cuando, dia_desde, dia_hasta, canales, es_seguimiento, nota)
SELECT p.id, d.clave, d.nombre, d.orden, d.cuando, d.dia_desde, d.dia_hasta,
       d.canales, d.es_seguimiento, d.nota
  FROM projects p
 CROSS JOIN (VALUES
   ('paso_1', 'Primer contacto e información', 1, NULL,
    0, 1, ARRAY['whatsapp','email'], false,
    'Los pasos de admisión y el trámite: solo cuando confirme interés.'),

   ('paso_2', 'Prueba social · Opiniones', 2, NULL,
    2, 3, ARRAY['llamada','whatsapp'], false,
    'Si no tiene opiniones: enviar captura de la vista general de Opynio y pedir internamente que se cree la opinión de ese curso.'),

   ('paso_3', 'Última plaza y facilidades de pago', 3, NULL,
    4, 4, ARRAY['llamada','whatsapp','email'], false,
    'El 5 % solo aplica en máster y diplomado, y se ofrece aquí, no antes.'),

   ('paso_4', 'Convocatoria de becas CETLAT', 4, NULL,
    7, 8, ARRAY['llamada','whatsapp','email'], false,
    'Interno, no se comparte: formación nueva máx. 40 %; formación ya habilitada hasta 70 %, reservado para quien casi no ha respondido.'),

   ('seguimiento_mensual', 'Seguimiento de toda la base', 5, 'Final de mes',
    NULL, NULL, ARRAY['wasapi'], true,
    'Mantener el contacto vivo hasta la siguiente convocatoria. Sin presión de venta.')
 ) AS d(clave, nombre, orden, cuando, dia_desde, dia_hasta, canales, es_seguimiento, nota)
 WHERE NOT EXISTS (
   SELECT 1 FROM commercial_steps s WHERE s.project_id = p.id AND s.clave = d.clave
 );
