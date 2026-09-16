-- Permiso acotado: usuario que SOLO puede cambiar las fechas (emisión y pago) de
-- las facturas, sin tocar importes ni conceptos. Admin/superadmin no lo necesitan
-- (ya pueden). Pensado para Adriana y para gestoras como Yosbely/Dayana que solo
-- corrigen fechas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS editar_fechas_factura BOOLEAN NOT NULL DEFAULT false;
