-- LA ADMINISTRADORA QUE DA CLASE YA PUEDE RESPONDER Y CORREGIR DESDE EL CRM (25/11/2026, CRM-ISEIE#773, gemela de CRM#1118).
--
-- Con la 339, una tutora que en un campus solo tiene la cuenta de administración del
-- sitio se enlaza como excepción confirmada, pero «Mi campus» le decía «responde y
-- corrige desde Moodle»: el plugin del CRM no enviaba ni calificaba como una
-- administradora del sitio.
--
-- El plugin 1.11.7 (Campus-Moodle#21) tiene una lista blanca en sus ajustes
-- («Administradoras que dan clase»): con su id, envía y califica como ella, solo en los
-- cursos donde es tutora. `local_crm_cuenta` lo dice con `permitida`.
--
-- Aquí se guarda lo que dijo el campus la última vez que se miró: al enlazarla y en
-- cada comprobación (la de cada hora y la de abrir su ficha). Con la excepción y
-- `admin_sitio_permitida`, responde y corrige desde el CRM como cualquier tutora; sin
-- ella, como hasta ahora, desde Moodle. Si el campus no contesta, se queda como estaba.

ALTER TABLE tutor_campus
  ADD COLUMN IF NOT EXISTS admin_sitio_permitida BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tutor_campus.admin_sitio_permitida IS
  'Con la excepción de la cuenta de administración del sitio: si el plugin del campus (1.11.7, «Administradoras que dan clase») deja al CRM enviar y calificar como ella. Lo que dijo local_crm_cuenta en la última comprobación.';
