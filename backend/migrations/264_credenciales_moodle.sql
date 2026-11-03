-- CRM-ISEIE 264 = MultiCRM 220 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 220 · El servicio «moodle» en las credenciales (#335)
--
-- El MCP de Claude consulta el Moodle de cada campus (cursos, alumnos, recursos
-- externos). La URL y el token de cada Moodle son SECRETOS: se guardan en
-- `api_credentials`, cifrados como el resto, un registro por campus, con el
-- servicio `moodle` y un JSON de valor: {"url":"https://…","token":"…"}.
--
-- `api_credentials.service` es el enum `api_service`, y le falta ese valor.
-- Es lo unico que hace esta migracion. No toca datos.
--
-- ALTER TYPE ... ADD VALUE no puede ir dentro de una transaccion en versiones
-- antiguas de PostgreSQL, asi que va suelto, sin BEGIN/COMMIT. Es idempotente.
--
-- Mientras no este aplicada, el MCP contesta «sin Moodle configurado» en cada
-- campus (no hay nada guardado) y el panel de claves rechaza el servicio.

ALTER TYPE api_service ADD VALUE IF NOT EXISTS 'moodle';
