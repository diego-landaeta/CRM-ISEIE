# Índice de migraciones SQL — ISEIE

Fuente de verdad del esquema. Cada archivo en `backend/migrations/` es un SQL ejecutado, en orden.

| # | Archivo | Qué hace |
|---|---|---|
| 001 | 001_initial_schema.sql | CRM-ISEIE — Migración 001: Schema inicial consolidado |
| 002 | 002_products_conversions.sql | CRM-ISEIE — Migración 002: extras para products + conversions |
| 003 | 003_commissions.sql | CRM-ISEIE — Migración 003: Comisiones |
| 004 | 004_reincidente.sql | Migracion 004: Campo reincidente en leads |
| 005 | 005_expenses.sql | Migracion 005: Tabla expenses (egresos) |
| 006 | 006_custom_fields.sql | Migracion 006: Campos custom en leads |
| 007 | 007_api_credentials.sql | Migracion 007: Tabla api_credentials |
| 008 | 008_accounts_payable.sql | Migracion 008: Tabla accounts_payable (cuentas por pagar) |
| 009 | 009_product_categories.sql | Migracion 009: Categorias y subcategorias de productos |
| 018 | 018_lead_form_columns.sql | 018: Configuracion de campos base y columnas del listado de leads |
| 019 | 019_matriculas.sql | 019: Matriculas (post-conversion) |
| 020 | 020_email_sequences.sql | 020: Secuencias de email seguimiento (CRM-185) |
| 021 | 021_forms.sql | 021: Editor de forms (CRM-175) |
| 022 | 022_payroll.sql | 022: Nominas (CRM-171, CRM-173) |
| 023 | 023_woocommerce.sql | 023: WooCommerce import + mapeo (CRM-177) |
| 024 | 024_forms_webhook_matriculas_admision_wc_autosync.sql | 024: 3 mejoras |
| 025 | 025_webhook_listen_mode.sql | 025: Modo escucha tipo Make/Zapier para webhook tokens |
| 026 | 026_role_soporte.sql | 026: Rol "Desarrollador - Soporte" (rol generico que ve todos los proyectos) |
| 027 | 027_form_destination.sql | 027: Webhook destination + listen mode default |
| 029 | 029_documents.sql | 029: Módulo de documentos — facturas y certificados |
| 030 | 030_field_definitions_multi_entity.sql | Migracion 030: Campos custom multi-entidad (lead, client, product) |
| 030 | 030_installation_bundles.sql | 030: Bundles de instalacion (CRM-302). Singleton id=1. |
| 031 | 031_performance_indexes.sql | Migración 031: índices FK faltantes + columna notificado_at en lead_reminders |
| 032 | 032_project_channels.sql | Migración 032: canales embebidos por proyecto (CRM-208 / CRM-211) |
| 033 | 033_roles_permissions.sql | Migración 033: Custom roles + overrides de permisos (idempotente). |
| 037 | 037_status.sql | Migración 037: Página de status del sistema. Owner crm_iseie_user. |
| 038 | 038_lead_emails_and_shortcuts.sql | Migración 038: lead_emails (CRM-231) + projects.shortcuts (CRM-235) |
| 039 | 039_categories_tree.sql | Migración 039 (categories): árbol N niveles para product_categories |
| 039 | 039_document_audit_log.sql | 039 (audit): Audit log de documentos (factura/certificado) |
| 040 | 040_documents_r2_and_email.sql | 040 (documents R2 + email): r2_key en documents + auto_email_documents en projects |
| 040 | 040_role_views.sql | Migración 040 (role_views): vista por defecto de roles custom |
| 042 | 042_email_templates.sql | 042_email_templates.sql |
| 043 | 043_external_panels.sql | Migración 043: paneles externos por proyecto (CRM-155) |
| 045 | 045_product_modules.sql | Migración 045 (product_modules): módulos/temario de productos. |
| 046 | 046_project_connectors.sql | Migración 046: Conectores configurables por proyecto. |
| 047 | 047_webhook_subtype.sql | Migración 047: distinguir webhook JSON vs mailhook (email entrante) |
| 048 | 048_wc_field_mapping.sql | Migración 048: mapping configurable para WC import |
| 049 | 049_webhook_default_product.sql | Migración 049: producto por defecto + matching por URL en webhooks |
| 050 | 050_form_template_events.sql | Migración 050: historial de eventos recibidos por webhook/mailhook/form |
| 051 | 051_wc_default_currency.sql | Migración 051: divisa por defecto del WC import |
| 052 | 052_wp_acf_importer.sql | Migración 052: importer multi-fuente WP REST + ACF |
| 053 | 053_unify_sections_as_text.sql | Migración 053: simplificar — secciones como TEXT unificado |
| 056 | 056_add_whatsapp_canal.sql | Migración 056: añadir 'whatsapp' al enum utm_channel |
| 058 | 058_leads_soft_delete.sql | Migración 058: soft delete de leads + auditoría |
| 059 | 059_leads_propuesto.sql | Migración 059: flag "propuesto" (cross-sell) |
| 061 | 061_lead_spam_reports.sql | Migración 061: reportes de spam |
| 063 | 063_make_webhooks.sql | Migración 063: Make.com webhooks por proyecto |
| 064 | 064_wp_pages_strategy.sql | Permite source_strategy='wp_pages' para sitios sin WC ni CPTs, |
| 065 | 065_products_brochure_url.sql | Añade brochure_url para almacenar PDF/folleto del curso extraído por scraper. |
| 066 | 066_normalize_phones.sql | Normaliza todos los teléfonos al formato E.164 con +. |
| 067 | 067_products_list_index.sql | Índice para acelerar el listado de productos del catálogo. |
| 068 | 068_sales_goals.sql | Metas de venta por gestor + periodo (mensual). |
| 069 | 069_admin_notifications.sql | Notificaciones para admin/superadmin (eventos que necesitan visibilidad operativa). |
| 070 | 070_sales_goal_history.sql | Historial de cambios en metas de venta. Snapshot del estado anterior cada |
| 071 | 071_meta_ads.sql | Integración Meta Marketing API (extracción de métricas, solo lectura). |
| 072 | 072_lead_audit_log.sql | Audit log de cambios en la ficha de un lead. |
| 072 | 072_meta_adsets_ads.sql | Etapa 3: AdSets y Ads. Misma forma que campaigns (snapshot + daily). |
| 073 | 073_dup_review_queue.sql | Cola de revisión de duplicados. |
| 073 | 073_meta_multi_account.sql | Multi-cuenta: un proyecto puede tener N cuentas publicitarias Meta. |
| 074 | 074_lead_products.sql | Multi-cursos por lead (#18). |
| 074 | 074_meta_adset_products.sql | Asociar productos a AdSets (no solo a campañas). Cada adset suele corresponder |
| 075 | 075_default_por_contactar.sql | Default del estado de un lead nuevo cambia de 'nuevo' → 'por_contactar'. |
| 076 | 076_change_requests.sql | Módulo RFC (Request For Change): solicitud de cambio + aprobaciones CCB + adjuntos. |
| 077 | 077_rfc_project_optional.sql | RFC sin proyecto = "General" (cambios cross-proyecto o de plataforma). |
| 078 | 078_user_projects_recibe_leads.sql | Opt-in per-project para que admins reciban leads del round-robin. |
| 079 | 079_admin_notifs_target_users.sql | Notificaciones dirigidas a usuarios concretos (no solo broadcast a admins). |
| 080 | 080_backfill_conversion_producto_id.sql | Backfill: rellenar conversions.producto_contratado_id matching por nombre. |
| 081 | 081_epic_b_expenses_extensions.sql | EPIC B — Egresos / Gastos |
| 082 | 082_leads_identificacion_fiscal.sql | 082 — Campo opcional de identificación fiscal en leads (para facturas). |
| 083 | 083_leads_direccion_fiscal.sql | 083 — Campo opcional de dirección fiscal en leads (para facturas). |
| 084 | 084_project_integrations.sql | 084 — project_integrations: credenciales por proyecto para Stripe / Brevo. |
| 085 | 085_lead_status_proxima_convocatoria.sql | 085 — Añade el valor 'proxima_convocatoria' al enum lead_status. |
| 086 | 086_stripe_payments.sql | Migracion 088: stripe_payments |
| 087 | 087_stripe_disputes_extra.sql | Campos extra para gestion de disputas: |
| 088 | 088_invoices.sql | Migracion 090: Facturacion (modelo aprobado 2026-06-17) |
| 089 | 089_invoices_extras.sql | Migracion 091: metodo_pago, pie_pago, y reset de secuencia por admin |
| 090 | 090_conversion_items_iva.sql | Migracion 092: multi-item en conversiones + IVA configurable |
| 091 | 091_whatsapp_widget.sql | Migracion 093: Widget WhatsApp rotativo por proyecto |
| 092 | 092_invoices_rectificativa.sql | Migracion 094: Facturas rectificativas (de abono) |
| 093 | 093_descuentos.sql | Migracion 095: Descuentos por cuadros en conversiones y facturas |
| 094 | 094_invoice_issuers.sql | Migracion 096: Multi-emisor de facturas |
| 095 | 095_issuer_logo_key.sql | issuer_logo_key |
| 096 | 096_invoice_templates.sql | Plantillas visuales de factura (editor tipo Canva). Cada plantilla guarda un |
| 097 | 097_issuer_serie.sql | issuer_serie |
| 098 | 098_template_condicion.sql | template_condicion |
| 099 | 099_fiscal_regimenes.sql | Migración 101: Regímenes fiscales + coletillas parametrizadas (editables desde el panel). |
| 100 | 100_sociedades.sql | Migración 102: Sociedades emisoras (agrupación de proyectos) + asignación proyecto→sociedad. |
| 101 | 101_facturacion_cimientos.sql | Cimientos de datos del módulo de facturación (spec v1.0, paso 1). |
| 102 | 102_numeracion_por_sociedad.sql | Numeración por sociedad (spec REQ-NUM-01/02): el contador de facturas es por |
| 103 | 103_proformas.sql | Migración 103: Proformas / presupuestos |
| 104 | 104_invoices_borrador.sql | Migracion 104: Facturas en BORRADOR (preliminares) |
| 105 | 105_claves_por_entorno.sql | Claves por entorno y los servicios que faltaban (#80, portado en #113). **Sin aplicar.** Sin ella el panel funciona y guarda produccion; guardar «pruebas» contesta 409 diciendo que falta esta migracion. |

> Las 099-104 llevaban tiempo sin apuntar aqui: se añadieron al portar el panel
> de claves (#113), leyendo el primer comentario de cada fichero, que es de
> donde salen las filas de arriba.
>
> **La 105 no esta aplicada.** Es DDL sobre `api_credentials` y sobre el tipo
> `api_service`, asi que hay que correrla con un rol que sea DUEÑO de los dos.
> No lo puedo comprobar desde aqui: no toco el servidor.
