-- Migracion 133: el banco del tutor
--
-- El IBAN ya lleva dentro el codigo de la entidad (las cuatro cifras despues de
-- «ES» y el digito de control), pero nadie lo lee de memoria. Quien prepara la
-- transferencia necesita ver el nombre del banco al lado.
--
-- Va suelto y no derivado del IBAN a proposito: los tutores estan en varios
-- paises —hay argentinos y mexicanos— y ahi el numero de cuenta no es un IBAN
-- europeo, asi que no habria de donde deducirlo.
--
-- Se salta la 132: esa la tiene Angel en su rama (avisos por correo) y ya choco
-- una vez conmigo. Mejor un hueco que dos migraciones con el mismo numero.

ALTER TABLE tutor_profiles
  ADD COLUMN IF NOT EXISTS banco VARCHAR(120);

COMMENT ON COLUMN tutor_profiles.banco IS
  'Nombre del banco donde se le paga. Suelto y no derivado del IBAN: no todos los tutores tienen cuenta europea.';
