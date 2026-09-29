-- Un usuario puede tener MAS DE UN ROL.
--
-- Diego, 22/09: «necesitamos que se pueda colocar mas de un rol a un usuario».
-- El caso real es alguien que lleva prospectos Y ademas da clase: hoy hay que
-- elegir --o gestora o tutora-- y lo que no se elija se pierde.
--
-- NO SE CAMBIA `users.role`. Sigue siendo el rol PRINCIPAL y sigue mandando en
-- los 149 sitios del CRM que lo miran: cambiarle el significado seria mover los
-- permisos de todo a ciegas. Lo que se añade es una lista de roles de MAS, que
-- solo SUMA permisos: quien es gestora y ademas tutora puede lo de las dos.
--
-- Va en una columna y no en una tabla aparte a proposito: se lee y se escribe
-- con la misma fila del usuario, asi que no hay forma de que el rol y sus
-- añadidos queden descuadrados a mitad de un guardado.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS roles_extra user_role[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN users.roles_extra IS
  'Roles ADICIONALES al principal (users.role). Solo suman permisos. Nunca contienen el principal ni superadmin.';

-- Por si alguna fila viene con el rol principal repetido dentro.
UPDATE users SET roles_extra = ARRAY(
    SELECT DISTINCT r FROM unnest(roles_extra) AS r WHERE r <> role AND r <> 'superadmin')
 WHERE roles_extra <> '{}';
