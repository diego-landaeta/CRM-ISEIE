-- CRM-ISEIE 260 = MultiCRM 216 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- #48 · De dónde venía el prospecto: el `document.referrer`.
--
-- El CRM ya guardaba las UTM y la dirección de la página, pero no de dónde venía
-- la persona al entrar. Y es la pista que hace falta para ChatGPT, que a veces
-- llega sin `utm_source` y solo con referrer (chatgpt.com). Se guarda tal cual lo
-- manda la web, aparte del canal que deduce el CRM (backend/src/modules/leads/canal.js):
-- así, si cambia la regla —por ejemplo, el nombre de las otras IA—, se puede
-- aplicar hacia atrás con `scripts/recalcular-canal.mjs` sin perder el dato.
--
-- Sin riesgo: una columna nueva y nula. Reaplicable. Para deshacerla:
--   ALTER TABLE lead_utms DROP COLUMN referrer;
BEGIN;

ALTER TABLE lead_utms ADD COLUMN IF NOT EXISTS referrer TEXT;
COMMENT ON COLUMN lead_utms.referrer IS 'document.referrer con el que llegó la persona (#48). Tal cual lo manda la web; el canal se deduce aparte.';

COMMIT;
