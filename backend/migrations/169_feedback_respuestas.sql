-- 169 · La encuesta de feedback, con todas sus preguntas
--
-- Diego, 28/09: «más preguntas: cómo le fue con el gestor, qué le pareció el
-- contenido… que pueda escribir, selección múltiple». Las preguntas viven en
-- `modules/feedback/preguntas.js`; aquí se guarda lo contestado, por CLAVE, en
-- un solo campo. Así añadir o quitar una pregunta no pide otra migración.
--
-- `motivo` y `comentario` se quedan como columnas: son las dos que el panel
-- cuenta y ordena, y ya las usaba todo lo anterior.

ALTER TABLE feedback_envios
  ADD COLUMN IF NOT EXISTS respuestas JSONB NOT NULL DEFAULT '{}'::jsonb;
