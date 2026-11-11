-- Tutor redactor · el rol nuevo (CRM-ISEIE#420, gemela de CRM#708)
--
-- Quienes hacen los cursos (temario y guion, y salen en los videos) y responden
-- las preguntas de Moodle. Tienen su tablero de tareas y su factura del mes,
-- como un colaborador, y sus consultas de alumnos y sus cursos, como un tutor.
-- No ven prospectos, ventas ni finanzas: lo corta el servidor en `verifyToken`
-- (RUTAS_DEL_TUTOR_REDACTOR, shared/utils/roles.js), no solo el menu.
--
-- En su propio fichero, como las del tutor y del colaborador:
-- «ALTER TYPE ... ADD VALUE» no se puede usar en la misma transaccion en la que
-- se usa el valor nuevo.
--
-- users.role es un ENUM (user_role), no texto con CHECK: sin este valor, un
-- INSERT o un `u.role IN (..., 'tutor_redactor')` falla con «invalid input
-- value for enum». IF NOT EXISTS hace que se pueda pasar dos veces.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'tutor_redactor';
