-- El BIC/SWIFT de cada sociedad emisora, para las facturas por transferencia.
--
-- Carlos, 30/09/2026: «en las facturas que salgan seleccionando transferencia
-- bancaria, debe de aparecer el IBAN y abajo el código BIC/SWIFT». El IBAN ya
-- vivía en la sociedad (`invoice_issuers.iban`); el BIC no estaba en ningún sitio.
ALTER TABLE invoice_issuers ADD COLUMN IF NOT EXISTS bic VARCHAR(20);
