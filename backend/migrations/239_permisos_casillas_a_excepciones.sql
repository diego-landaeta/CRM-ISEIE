-- Lo de cada persona, respetado (#423, fase 5)
--
-- Diego, 21/10: «nadie gana ni pierde acceso». Desde #423 cada ruta pide un
-- permiso del catálogo, y lo que antes daban las cinco casillas de la ficha lo
-- dan ahora excepciones de la persona. Esta migración traduce, POR REGLAS y
-- nunca por ids (vale igual en la base del 360 y en la de ISEIE):
--
--   factura_manager        → facturas.emitir   (no admin ni superadmin)
--                            facturas.cola      (no superadmin: el admin no la tenía)
--                            facturas.gestionar (solo gestoras)
--   editar_fechas_factura  → facturas.editar_fechas (no admin ni superadmin)
--   gestor_colaboraciones  → tutores.gestionar  (no admin ni superadmin)
--   usa_mcp                → mcp.usar          (no admin, superadmin ni tutor)
--   usa_whatsapp = false   → whatsapp.usar NO  (admin, gestora y soporte)
--
-- Es la misma regla que `permissions/casillas.js`; la prueba
-- `casillasMigracion423.test.js` pasa esta migración y exige que salgan las
-- mismas excepciones. Las columnas se quedan: `gestor_colaboraciones` decide
-- además el reparto y las listas, y las otras se pueden leer para comparar.
--
-- LO QUE HOY NO SURTE EFECTO. Antes de #423 las rutas miraban solo estas
-- claves: leads.delete, facturas_colaborador.*, diplomas.view, diplomas.emit
-- (#437/#438, 22/10: las gestoras que emiten diplomas, como Dayana), tasks.* y
-- conversions.sin_gestora. Y la pantalla, con `can()`, estas otras: crear,
-- borrar y exportar clientes, editar ventas, crear, editar, asignar y exportar
-- prospectos, crear, editar y borrar productos y sincronizar WooCommerce (QA
-- de Diego, punto 5: «no se archiva ninguna clave en uso»). Todas se quedan
-- TAL CUAL: la clave se llama igual en el catálogo. La lista es la de
-- `permissions/inventario/en-uso-antes.js` (una prueba exige que coincidan). Lo guardado sobre cualquier otra clave
-- —en excepciones personales y en roles a medida— no hacía nada, y ahora sí lo
-- haría: alguien ganaría acceso sin que nadie lo decidiera. Se copia a
-- `permisos_inertes_archivo` (238) y se quita. Si Diego quiere activarlo, está
-- ahí.
--
-- TAREAS (QA de Diego, punto 6). `tasks.*` se miraba, pero solo detrás de la
-- puerta de las rutas: superadmin, admin y colaborador. A una gestora con
-- «Ver sus tareas» dado, no le abría nada; con el catálogo le abriría el
-- tablero. Esas también van al archivo (las de la ficha nueva, no).
--
-- Todo queda en `permisos_registro` con origen 'migracion_239'. Se puede pasar
-- dos veces: lo que ya está no se repite.

BEGIN;

-- ── 1 · Las casillas, como excepciones ──────────────────────────────────────
CREATE TEMP TABLE _casillas ON COMMIT DROP AS
  SELECT u.id AS user_id, x.resource, x.action, x.allowed
    FROM users u
    CROSS JOIN LATERAL (VALUES
      ('facturas', 'emitir',         true,  COALESCE(u.factura_manager, false) AND u.role::text NOT IN ('admin', 'superadmin')),
      ('facturas', 'cola',           true,  COALESCE(u.factura_manager, false) AND u.role::text <> 'superadmin'),
      ('facturas', 'gestionar',      true,  COALESCE(u.factura_manager, false) AND u.role::text = 'gestor'),
      ('facturas', 'editar_fechas',  true,  COALESCE(u.editar_fechas_factura, false) AND u.role::text NOT IN ('admin', 'superadmin')),
      ('tutores',  'gestionar',      true,  COALESCE(u.gestor_colaboraciones, false) AND u.role::text NOT IN ('admin', 'superadmin')),
      ('mcp',      'usar',           true,  COALESCE((to_jsonb(u) ->> 'usa_mcp')::boolean, false) AND u.role::text NOT IN ('admin', 'superadmin', 'tutor')),
      ('whatsapp', 'usar',           false, (to_jsonb(u) ->> 'usa_whatsapp')::boolean IS FALSE AND u.role::text IN ('admin', 'gestor', 'soporte'))
    ) AS x(resource, action, allowed, aplica)
   WHERE x.aplica;

INSERT INTO permisos_registro (destino_tipo, usuario_id, clave, antes, despues, origen, motivo)
SELECT 'usuario', c.user_id, c.resource || '.' || c.action, 'como su rol',
       CASE WHEN c.allowed THEN 'sí' ELSE 'no' END, 'migracion_239',
       'La casilla de su ficha pasa a ser un permiso suyo (#423)'
  FROM _casillas c
 WHERE NOT EXISTS (SELECT 1 FROM user_permission_overrides o
                    WHERE o.user_id = c.user_id AND o.resource = c.resource AND o.action = c.action);

INSERT INTO user_permission_overrides (user_id, resource, action, allowed)
SELECT user_id, resource, action, allowed FROM _casillas
ON CONFLICT (user_id, resource, action) DO NOTHING;

-- ── 2 · Lo que hoy no surte efecto, al archivo ──────────────────────────────
-- Las claves que SÍ se miraban antes de #423 se quedan donde están.
CREATE TEMP TABLE _aplicadas (patron text) ON COMMIT DROP;
INSERT INTO _aplicadas VALUES
  -- Las miraba una ruta o un servicio.
  ('leads.delete'), ('facturas_colaborador.%'), ('diplomas.view'), ('diplomas.emit'), ('tasks.%'), ('conversions.sin_gestora'),
  -- Meta Ads · Ver (26/10): el equipo de desarrollo la tiene por excepción.
  ('meta_ads.view'),
  -- Las miraba la pantalla.
  ('clients.create'), ('clients.delete'), ('clients.export'), ('conversions.edit'),
  ('leads.assign'), ('leads.create'), ('leads.edit'), ('leads.export'),
  ('products.create'), ('products.delete'), ('products.edit'), ('woocommerce.sync');

-- Excepciones personales sobre claves sin efecto. Las que acaba de poner el
-- punto 1 tampoco se tocan (son claves nuevas, del catálogo).
CREATE TEMP TABLE _inertes ON COMMIT DROP AS
  SELECT o.user_id, o.resource, o.action, o.allowed
    FROM user_permission_overrides o
   WHERE NOT EXISTS (SELECT 1 FROM _aplicadas a WHERE (o.resource || '.' || o.action) LIKE a.patron)
     AND NOT EXISTS (SELECT 1 FROM _casillas c WHERE c.user_id = o.user_id AND c.resource = o.resource AND c.action = o.action)
     -- Lo que ya se dio por la ficha nueva (fase 3) no es de antes: se queda.
     AND NOT EXISTS (SELECT 1 FROM permisos_registro r
                      WHERE r.usuario_id = o.user_id AND r.clave = o.resource || '.' || o.action
                        AND r.origen IN ('ficha_usuario', 'panel_mcp'))
  UNION
  -- Y sobre claves que sí se miraban, el «no» que su rol tapaba: borrar
  -- prospectos y ver Diplomas entraban por el rol ANTES de mirar el permiso
  -- (roleGuard / rolOPermiso, roles de más incluidos), así que a un admin
  -- quitárselos no le quitaba nada. Ahora sí se lo quitaría.
  SELECT o.user_id, o.resource, o.action, o.allowed
    FROM user_permission_overrides o
    JOIN users u ON u.id = o.user_id
   WHERE o.allowed = false
     AND ((o.resource = 'leads' AND o.action = 'delete'
           AND (u.role::text IN ('admin', 'superadmin', 'soporte')
                OR COALESCE(u.roles_extra::text[], '{}') && ARRAY['admin', 'superadmin', 'soporte']))
       OR (o.resource = 'diplomas' AND o.action IN ('view', 'emit')
           AND (u.role::text IN ('admin', 'superadmin')
                OR COALESCE(u.roles_extra::text[], '{}') && ARRAY['admin', 'superadmin'])))
  UNION
  -- Tareas (QA de Diego, punto 6): las rutas solo dejaban pasar a superadmin,
  -- admin y colaborador (roles de más incluidos) y el permiso se miraba DENTRO.
  -- A cualquier otro, lo guardado en `tasks.*` no le hacía nada: con el
  -- catálogo le abriría el tablero. Lo dado ya por la ficha nueva se queda.
  SELECT o.user_id, o.resource, o.action, o.allowed
    FROM user_permission_overrides o
    JOIN users u ON u.id = o.user_id
   WHERE o.resource = 'tasks'
     AND NOT (u.role::text IN ('superadmin', 'admin', 'colaborador')
              OR COALESCE(u.roles_extra::text[], '{}') && ARRAY['superadmin', 'admin', 'colaborador'])
     AND NOT EXISTS (SELECT 1 FROM permisos_registro r
                      WHERE r.usuario_id = o.user_id AND r.clave = o.resource || '.' || o.action
                        AND r.origen IN ('ficha_usuario', 'panel_mcp'));

INSERT INTO permisos_inertes_archivo (de_donde, usuario_id, clave, valor)
SELECT 'excepcion', user_id, resource || '.' || action, allowed FROM _inertes
ON CONFLICT (de_donde, usuario_id, custom_role_id, clave) DO NOTHING;

INSERT INTO permisos_registro (destino_tipo, usuario_id, clave, antes, despues, origen, motivo)
SELECT 'usuario', user_id, resource || '.' || action, CASE WHEN allowed THEN 'sí' ELSE 'no' END,
       'como su rol', 'migracion_239', 'Excepción que antes no surtía efecto: archivada (#423)'
  FROM _inertes;

DELETE FROM user_permission_overrides o
 USING _inertes i
 WHERE o.user_id = i.user_id AND o.resource = i.resource AND o.action = i.action;

-- Roles a medida: lo mismo, dentro de su JSON.
CREATE TEMP TABLE _inertes_rol ON COMMIT DROP AS
  SELECT cr.id AS custom_role_id, kv.key AS clave, (kv.value)::text::boolean AS valor
    FROM custom_roles cr
    CROSS JOIN LATERAL jsonb_each(COALESCE(cr.permissions, '{}'::jsonb)) AS kv
   WHERE jsonb_typeof(kv.value) = 'boolean'
     AND NOT EXISTS (SELECT 1 FROM _aplicadas a WHERE kv.key LIKE a.patron)
     AND NOT EXISTS (SELECT 1 FROM permisos_registro r
                      WHERE r.custom_role_id = cr.id AND r.clave = kv.key AND r.origen = 'pantalla_roles')
  UNION
  -- Tareas, igual que en las excepciones: un rol a medida cuyo rol base no
  -- entraba al tablero, salvo que alguien que lo tenga entre por un rol de más.
  SELECT cr.id, kv.key, (kv.value)::text::boolean
    FROM custom_roles cr
    CROSS JOIN LATERAL jsonb_each(COALESCE(cr.permissions, '{}'::jsonb)) AS kv
   WHERE jsonb_typeof(kv.value) = 'boolean'
     AND kv.key LIKE 'tasks.%'
     AND COALESCE(cr.base_role::text, 'gestor') NOT IN ('superadmin', 'admin', 'colaborador')
     AND NOT EXISTS (SELECT 1 FROM users u
                      WHERE u.custom_role_id = cr.id
                        AND COALESCE(u.roles_extra::text[], '{}') && ARRAY['superadmin', 'admin', 'colaborador'])
     AND NOT EXISTS (SELECT 1 FROM permisos_registro r
                      WHERE r.custom_role_id = cr.id AND r.clave = kv.key AND r.origen = 'pantalla_roles');

INSERT INTO permisos_inertes_archivo (de_donde, custom_role_id, clave, valor)
SELECT 'rol_medida', custom_role_id, clave, valor FROM _inertes_rol
ON CONFLICT (de_donde, usuario_id, custom_role_id, clave) DO NOTHING;

INSERT INTO permisos_registro (destino_tipo, custom_role_id, clave, antes, despues, origen, motivo)
SELECT 'rol_medida', custom_role_id, clave, valor::text, 'como su rol base', 'migracion_239',
       'Valor del rol a medida que antes no surtía efecto: archivado (#423)'
  FROM _inertes_rol;

UPDATE custom_roles cr
   SET permissions = cr.permissions - ARRAY(SELECT i.clave FROM _inertes_rol i WHERE i.custom_role_id = cr.id),
       updated_at = NOW()
 WHERE EXISTS (SELECT 1 FROM _inertes_rol i WHERE i.custom_role_id = cr.id);

COMMIT;
