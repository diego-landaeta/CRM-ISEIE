# CHANGELOG — CRM-ISEIE

Log cronológico de commits importantes. Más reciente arriba.

---

## 2026-05-29 — Normalización teléfonos desde xlsx + QA E2E

- `3d2bb49 feat(qa):` `qa_iseie.mjs` — **suite E2E de 54 tests**. Cubre: lead CRUD, status_history, interactions, reminders, conversions con pagos+cuotas, custom_fields, filtros, soft-delete, products. Cleanup automatico. **54/54 PASS.**
- `b4eb6f6 feat(scripts):` `fix_telefonos_iseie.py` — normaliza teléfonos desde xlsx oficial (hoja `2026`). Col B preferida (E.164 sin 1/9 mobile). **1513 leads actualizados.**

## 2026-05-28 — Historial cronológico + WC sanitize + Fechas + Filtros

- `6b7d036 feat(scripts):` `populate_history.js` — crea `lead_interactions` cronológicas (una por fila CSV) para que la pestaña Historial muestre la trayectoria real del lead duplicado (programa → etapa → asesora → notas → seguimientos). **11,631 interacciones creadas.**
- `653f6db fix(wc-import):` `sanitizePrecio()` en `upsertProductFromWc` — defensa backend para que `'1,950 €'` no rompa el INSERT (numeric column). También se corrigió mapping en DB de `scraper.meta_box.precio.text` → `.value`. **Fix bug WC scheduler que fallaba 600+ veces.**
- `8094b32 fix(import):` re-parsear fechas de Contactos 2026 con formato DD/MM/AAAA correcto. **9971 leads tenían fecha futura (mes-day swap)**.
- `6580af9 fix(filtros + leads):`
  - `DateRangeFilter`: usar fecha LOCAL (no `toISOString`) — bug "Hoy mostraba mañana" en TZ negativas
  - `LeadFormDialog`: checkbox "No tiene nombre" que autorellena `Anónimo (tel XXX)`
  - `lead.schema`: nombre opcional a nivel Zod (validación condicional en submit)
- `4b81812 feat(prospectos+clientes):` añadir columna Teléfono · populate `lead_utms` desde `custom_fields.origen_csv` (11469 filas) · "Título oficial" pasa a `en_seguimiento` · Spam soft-delete con motivo
- `66e6238 data:` agregar `Contactos ISEIE - 2026.csv` (12962 filas) al repo

## 2026-05-27 — Import contactos masivo + CETLAT + LeadsPage portada

- `d93d8d5 feat(scripts):` `import_contactos.js` + `link_products.js` — importa Contactos ISEIE 2026 (11491 personas únicas de 12962 filas, **dedupe por email+telefono**, merge multi-curso, flag `pendiente_reasignar` para Agostina). + matcher fuzzy para re-vincular productos.
- `3959dd6 feat(scripts):` `import_cetlat.js` — importa solicitudes de beca CETLAT desde CSV → leads con metadata en `custom_fields`, idempotency por CETLAT id.
- `7e095ab fix(scripts/fill_prices):` quitar umbrales arbitrarios — re-scrapea TODOS los productos.
- `682d5ba fix(scraper):` `parsePriceNumber` maneja correctamente `'1,985 €'` (coma=miles) vs `'5,50'` (coma=decimal). Formato europeo + US + miles.
- `886ea5e feat(scripts):` `fill_prices.js` para extraer solo precios sin re-importar todo.
- `8883199 fix(products):` `ProductDetailPage` era STUB con datos hardcodeados. Portado de ISEIH con todos los `_texto/scraper fields` + meta pills + secciones expandibles.
- `40e4234 feat(leads):` portar `LeadsPage` completa de ISEIH (filtros avanzados, bulk actions, exports, columnas extra, quick actions). **De 326 → 1101 líneas.**
- `5d6cb83 docs(Claude):` sanitizar credenciales en archivos memoria
- `6a9d568 docs(Claude):` subir todo el conocimiento del CRM (primera carga de carpeta Claude/)

## 2026-05-27 — Sidebar + beta gate

- `913e22a fix(beta-gate):` activar `/webhooks` (operativo, igual que `/make-webhooks`)
- `8e342a5 feat(sidebar):` estructura completa estilo ISEIH con beta gate (`VITE_BETA_MODE=true`). Items sin backend → "Próximamente".
- `e45a83f fix(leads):` `findProductByName` tolera acentos (`unaccent`) + prefijos `curso/master/diplomado`.

## 2026-05-26 — Make + WC scraper precio/stripe/brochure

- `3f12103 feat(make):` incluir `_received_overrides` en el sample para que el panel muestre headers `X-Asesora-*` capturados (debug visible).
- `5fa2be0 feat(wc):` extraer precio (icon-box title `<div>`) + auto-mapear + **progreso en vivo** (polling `/runs/current` cada 2s, `updateRunProgress` mid-loop).
- `944b673 feat(wc-preview UI):` expone `scraper.stripe_link` y `scraper.brochure_url` como opciones en dropdown de fuente.
- `1f03e6b fix(wc-preview):` merge `sugeridos` con `field_mapping` guardado (campos nuevos como stripe_link/brochure_url se autocompletan en UI).
- `c05875b feat(wc-scraper):` extraer stripe_link y brochure_url de la página y mapearlos al producto.

## 2026-05-25 — wp_pages strategy

- `ea60749 fix(wc):` preview soporta `source_strategy=wp_pages` (evita 502 al pulsar Previsualizar/Importar)
- `596fac0 fix(wc-creds):` `consumer_key` opcional (para wp_pages sin auth WC) + sync_interval hasta 1 semana
- `3470035 feat(woocommerce-ui):` opción `wp_pages` en estrategia origen + input parent IDs
- `dce9218 feat(wp-pages):` nueva `source_strategy` para sitios sin WC ni CPTs (caso ISEIE)
- `332f681 sync(crm-hermano):` port fixes recientes desde CRM principal

---

## Migraciones aplicadas

| # | Tema |
|---|---|
| 058 | leads_soft_delete |
| 059 | leads_propuesto |
| 061 | lead_spam_reports |
| 063 | make_webhooks |
| 064 | source_strategy=wp_pages |
| 065 | products.brochure_url |

---

## Cómo registrar tus cambios

Agregar bloque arriba con:
1. Fecha + tema
2. Commit hash + tipo + mensaje + nota funcional
3. Si pidió migration o rompió algo conocido → marcarlo

Excluir commits triviales (docs, chore). Solo lo que la próxima IA necesita para no romper o duplicar trabajo.
