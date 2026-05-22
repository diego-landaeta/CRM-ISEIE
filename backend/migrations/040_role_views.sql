-- Migración 040 (role_views): vista por defecto de roles custom

ALTER TABLE custom_roles
  ADD COLUMN IF NOT EXISTS default_view JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN custom_roles.default_view IS
  'Configuración de vista del rol: { default_route, hidden_sidebar_items[], dashboard_widgets[], compact_sidebar }';
