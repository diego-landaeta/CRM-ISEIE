-- 248 · Extensión unaccent para el buscador (gemela de CRM#591 · ISEIE #335)
--
-- Diego, 02/11: «gonzalez» no encontraba a «González». En ISEIE la extensión ya
-- estaba instalada; esta migración solo lo deja escrito, como en MultiCRM (235).
-- Se puede pasar dos veces.

CREATE EXTENSION IF NOT EXISTS unaccent;
