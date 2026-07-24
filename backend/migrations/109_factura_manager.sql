-- Permiso factura_manager: gestora que puede gestionar (editar, corregir, abonar,
-- eliminar) SUS PROPIAS facturas como un admin, pero solo las suyas.
ALTER TABLE users ADD COLUMN IF NOT EXISTS factura_manager BOOLEAN NOT NULL DEFAULT false;
