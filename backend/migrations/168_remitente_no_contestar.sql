-- 168 · El remitente «no contestar» de cada campus
--
-- Diego, 28/09: el correo de «¿por qué has desistido?» sale por Brevo «desde
-- el correo remitente del campus», como no contestar, y abajo el enlace a la
-- encuesta en la dirección del CRM.
--
-- Brevo solo envía desde dominios que tenga AUTENTICADOS. Hoy son iseie.com,
-- 360crm.tech, certifex.tech y cediaidsl.com: ningún campus de MultiCRM. Por
-- eso esto es una columna y no una regla: se rellena cuando el dominio del
-- campus esté dado de alta en Brevo, y mientras está vacía el correo sale desde
-- el remitente del CRM con el NOMBRE del campus («ISEIH · No contestar»). Y si
-- Brevo rechaza el que haya aquí, se reintenta con el del CRM: ningún correo se
-- queda sin salir por un remitente mal puesto.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS remitente_no_contestar VARCHAR(255);

COMMENT ON COLUMN projects.remitente_no_contestar IS
  'Direccion «no contestar» del campus para los correos automaticos (feedback). Su dominio tiene que estar autenticado en Brevo.';

-- En ISEIE el dominio del campus SI esta autenticado en Brevo: su «no contestar»
-- se puede usar ya. Solo si esta vacio, para no pisar lo que alguien ponga.
UPDATE projects SET remitente_no_contestar = 'noresponder@iseie.com'
 WHERE remitente_no_contestar IS NULL AND nombre ILIKE 'ISEIE%';
