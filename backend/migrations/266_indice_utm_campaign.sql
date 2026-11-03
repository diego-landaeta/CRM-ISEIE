-- CRM-ISEIE 266 = MultiCRM 224 (paridad 2.6.0, 03/11/2026). Mismo SQL;
-- solo cambia el número, al primer hueco libre de ISEIE.
--
-- 224 · Índice para el cruce de la publicidad por campaña (QA de Diego, 22/10,
-- punto 10).
--
-- «El cruce por `utm_campaign` no tiene índice ni tope de tiempo.» Las
-- herramientas de Claude `resumen_publicidad` y `campanas_publicitarias` unen
-- las campañas de Meta con los prospectos por `lead_utms.utm_campaign`, y la
-- tabla solo tenía índice por `lead_id`: sin fechas, se recorría entera. El
-- tope de tiempo va en el código (el mismo que los informes del MCP).
--
-- 224: Diego pidió «a partir de la 214»; las PR abiertas usan de la 214 a la
-- 223. Se puede pasar dos veces.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_lead_utms_utm_campaign ON lead_utms (utm_campaign);

COMMIT;
