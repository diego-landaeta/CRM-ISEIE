-- 183 · Marcar un paso a mano (la 175 de MultiCRM, traída el 09/10/2026)
--
-- Hasta ahora un paso se cerraba de UNA sola forma: contando los contactos
-- apuntados. El contacto n.º N cierra el paso n.º N. Es una regla honrada
-- --no hay que mantenerla, luego no miente-- pero deja fuera lo que pasa todos
-- los dias: la gestora habla con la persona y no lo apunta, o el paso se cumple
-- sin escribir (contesto la madre, ya tenia la informacion, se vieron en una
-- feria).
--
-- El resultado se ve en la cola: hay prospectos marcados «Contactado» con cero
-- contactos hechos, porque alguien movio la etiqueta a mano y la agenda nunca
-- se entero. Dos libros de contabilidad, y el de la etiqueta se lleva peor.
--
-- Con esto el paso se puede marcar, y se guarda QUIEN lo marco y CUANDO. La
-- deduccion NO se retira: un paso sigue saliendo hecho si hay contactos de
-- sobra, aunque nadie lo toque. Las dos vias suman, y por eso se guarda quien
-- lo marco: distingue un proceso trabajado de uno tachado para quitarselo de
-- encima.

ALTER TABLE lead_steps DROP CONSTRAINT IF EXISTS lead_steps_estado_valido;
ALTER TABLE lead_steps ADD CONSTRAINT lead_steps_estado_valido
  CHECK (estado IN ('pendiente', 'saltado', 'hecho'));

ALTER TABLE lead_steps ADD COLUMN IF NOT EXISTS hecho_at  TIMESTAMPTZ;
ALTER TABLE lead_steps ADD COLUMN IF NOT EXISTS hecho_por INTEGER
  REFERENCES users(id) ON DELETE SET NULL;

-- Los pasos vencidos se buscan cada noche para devolver a su gente a «por
-- contactar»: la fecha y el estado ya estaban indexados juntos, y este indice
-- es el mismo de antes. Se deja escrito para que se vea que la consulta nueva
-- no anda sin indice.
CREATE INDEX IF NOT EXISTS idx_lead_steps_vencidos
  ON lead_steps (fecha_prevista, estado);

-- El historial de estados exigia un usuario. Ahora hay cambios que no los hace
-- nadie --el paso que vence de madrugada y devuelve a su gente a «por
-- contactar»--, y la alternativa a permitir el hueco era inventarse un usuario
-- «sistema» o no apuntar el cambio. Lo primero ensucia la lista de gente; lo
-- segundo deja un estado que cambia solo y sin rastro, que es justo lo que hay
-- que evitar. La ficha ya lee este campo con LEFT JOIN, asi que el hueco se
-- pinta sin tocar nada.
ALTER TABLE lead_status_history ALTER COLUMN changed_by DROP NOT NULL;
