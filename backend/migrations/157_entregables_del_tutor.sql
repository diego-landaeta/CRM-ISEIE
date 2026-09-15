-- Que ha entregado cada tutor de cada formacion.
--
-- Diego, 14/09/2026: «aquí en los tutores necesito una columna que sea: Foto
-- corporativa, Vídeo, Foto y Vídeo, 25% módulos, 50% módulos, 100% completo ·
-- ESTO QUE SEA COMO UN CHECKBOX PARA NO CONSUMIR ESPACIO EN SUBIR ARCHIVOS».
--
-- No se sube nada: son MARCAS. El archivo vive donde viva --Drive, el campus--
-- y aqui solo se apunta si llego, que es lo que hace falta para saber si se le
-- puede pagar.
--
-- Van en la colaboracion y no en el tutor porque los modulos son DE UNA
-- FORMACION: alguien puede tener un curso grabado entero y otro a medias. La
-- foto y el video se repiten por formacion, y es el precio de poder decir «de
-- este curso falta el video» sin inventar otra tabla.
--
-- `modulos_pct` es 0, 25, 50 o 100 y no un booleano por tramo: los tramos son
-- excluyentes --nadie esta al 25 y al 50 a la vez-- y con tres casillas
-- sueltas acabarian marcadas dos.

ALTER TABLE tutor_collaborations
  ADD COLUMN IF NOT EXISTS entrego_foto  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS entrego_video BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS modulos_pct   SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE tutor_collaborations DROP CONSTRAINT IF EXISTS tutor_collaborations_modulos_pct_check;
ALTER TABLE tutor_collaborations
  ADD CONSTRAINT tutor_collaborations_modulos_pct_check
  CHECK (modulos_pct IN (0, 25, 50, 100));

COMMENT ON COLUMN tutor_collaborations.entrego_foto  IS 'Foto corporativa entregada. Marca, no archivo.';
COMMENT ON COLUMN tutor_collaborations.entrego_video IS 'Video entregado. Marca, no archivo.';
COMMENT ON COLUMN tutor_collaborations.modulos_pct   IS 'Avance de los modulos: 0, 25, 50 o 100.';
