-- 119 · La factura necesita saber si el cliente es empresa o persona
--
-- El rotulo que va delante del nombre en el PDF cambia:
--   empresa  -> "RAZÓN SOCIAL: Comercial Farmacéutica Leisa."
--   persona  -> "NOMBRE Y APELLIDO: Ana Gabriela Picado Cartin"
--
-- El dato vive en leads.cliente_tipo, pero la factura no puede depender del lead:
-- guarda una copia de todos los datos del cliente en el momento de emitirse, para
-- que una edicion posterior de la ficha no cambie una factura ya emitida. Y hay
-- facturas sueltas, sin lead ninguno.
--
-- Se rellena lo que ya existe a partir del lead de cada una. Las que no tengan
-- lead, o cuyo lead no lo tenga puesto, quedan a NULL y se rotulan como persona,
-- que es el caso normal.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cliente_tipo VARCHAR(20);

UPDATE invoices f
   SET cliente_tipo = l.cliente_tipo
  FROM leads l
 WHERE l.id = f.lead_id
   AND f.cliente_tipo IS NULL
   AND l.cliente_tipo IS NOT NULL;
