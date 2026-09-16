-- Portada desde MultiCRM el 16/09/2026. Alli es la 167; aqui la serie va
-- por otro numero. Diego: «en ISEIE nadie esta usando el whatsapp,
-- tampoco en 360 porque estamos haciendo pruebas ahi, asi que adelante,
-- dejalo a la par».

-- Quien usa el WhatsApp del CRM, y quien no (#128, punto 1).
--
-- Diego, 07/09, mirando /testeo: «Ni Vanesa, ni Adriana, sus WhatsApp
-- apareceran ahi. Debe ser una opcion para activar o no, pero por ahora es solo
-- gestoras y Daniela, que tambien tiene su WhatsApp».
--
-- Hasta hoy la puerta era el ROL, en `roles.js`: superadmin, admin, gestor y
-- soporte. Eso deja fuera a los tutores —que era el caso de agosto, la #68— pero
-- NO distingue entre dos personas del mismo rol, que es justo lo que hace falta
-- ahora. Y no puede depender de un despliegue: manana entra alguien y tiene que
-- poder encenderse desde la ficha.
--
-- POR DEFECTO APAGADO, como pide el ticket: es mas facil encender a quien falta
-- que descubrir que se esta viendo el WhatsApp de quien no debia.
--
-- MENOS PARA QUIEN YA ESTA TRABAJANDO CON EL. Si alguien tiene conversaciones en
-- el CRM es que su numero esta enlazado y lo usa a diario. Nacer apagado le
-- dejaria la pantalla vacia manana por la manana sin que nadie haya decidido
-- nada, y eso se reporta como averia, no como ajuste. Se encienden esos y se
-- deja apagado el resto.
--
-- APAGAR NO DESVINCULA, y esta es la parte delicada. Esto es reparto, no baja:
-- se deja de salir en el panel y de poder entrar, pero el numero sigue enlazado
-- del lado de WhatsApp. Desvincular solo pasa cuando alguien deja de PODER tener
-- WhatsApp —cambio de rol o baja—, que es `alPerderAcceso()` en `roles.js` y no
-- se toca aqui. Si esto colgara de ahi, una casilla mal pulsada soltaria la
-- sesion de una gestora y habria que volver a enlazar el movil con ella delante.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS usa_whatsapp BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN users.usa_whatsapp IS 'Si esta persona usa el WhatsApp del CRM: sale en el panel de sesiones y puede enlazar su numero. No decide si PUEDE tenerlo (eso es el rol, en roles.js), solo si lo usa. Apagarlo no desvincula el numero.';

-- El encendido inicial, solo la primera vez.
--
-- La condicion `NOT EXISTS (... WHERE usa_whatsapp)` es lo que la hace
-- idempotente de verdad: en cuanto haya UNA persona encendida, esta migracion no
-- vuelve a tocar nada. Sin eso, volver a pasarla reencenderia a quien Diego
-- hubiera apagado a mano, que es peor que no ser idempotente: parece que
-- funciono y deshace una decision.
--
-- Postgres evalua la subconsulta contra la foto del principio de la sentencia,
-- asi que enciende a todos los que cumplan o a ninguno; no se enciende el
-- primero y se corta a si mismo.
--
-- La instancia se llama `<prefijo>-u<id>` y el prefijo cambia entre produccion y
-- pruebas, asi que el id se saca del final y no se compara la cadena entera.
UPDATE users u
   SET usa_whatsapp = TRUE
 WHERE NOT u.usa_whatsapp
   AND NOT EXISTS (SELECT 1 FROM users WHERE usa_whatsapp)
   AND EXISTS (
         SELECT 1
           FROM wa_conversaciones c
          WHERE (regexp_match(c.instancia, '-u([0-9]+)$'))[1]::int = u.id
       );

COMMIT;
