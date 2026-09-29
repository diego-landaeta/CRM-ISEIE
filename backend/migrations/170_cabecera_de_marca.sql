-- 170 · El fondo de la cabecera de cada marca, en correos y formularios
--
-- Paridad con MultiCRM (180), Diego 28/09: «que cada formulario tenga el
-- branding de cada marca y su logo, y en el correo también». Los logos vienen
-- en dos versiones —para fondo claro y la blanca, para fondo oscuro—, así que
-- sobre qué color va el logo es un dato de la marca: vacío = blanco.
--
-- Se configura en «Configuración → Marca», con el logo, el color de marca y el
-- remitente «no contestar».

ALTER TABLE projects ADD COLUMN IF NOT EXISTS color_cabecera VARCHAR(7);
