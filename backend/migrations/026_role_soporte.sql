-- ============================================================
-- 026: Rol "Desarrollador - Soporte" (rol generico que ve todos los proyectos)
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'soporte';
