-- Contraseñas conocidas para los usuarios de ejemplo.
--
-- Los tests entran con estas credenciales; sin esta semilla el login falla y
-- 7 ficheros se caen con «Cannot read properties of undefined (accessToken)»,
-- que no dice en absoluto lo que pasa.
--
-- Solo aplica a los correos de ejemplo (@empresa.com). Es imposible que toque
-- una cuenta real, y aun asi la base local es desechable.
UPDATE users SET password_hash = '$2b$12$Fg9HN14SGWmDAvzLnG.8QeF8KSyqWmd3oRjEoBYmrsVRClhgcZJDi'
 WHERE email LIKE '%@empresa.com';
