# Índice de migraciones SQL — ISEIE

Fuente de verdad del esquema. Cada archivo en `backend/migrations/` es un SQL ejecutado, en orden.

| # | Archivo | Qué hace |
|---|---|---|
| 001 | 001_initial_schema.sql | Schema inicial consolidado |
| 002 | 002_products_conversions.sql | extras para products + conversions |
| 003 | 003_commissions.sql | Comisiones |
| 004 | 004_reincidente.sql | Campo reincidente en leads |
| 005 | 005_expenses.sql | Tabla expenses (egresos) |
| 006 | 006_custom_fields.sql | Campos custom en leads |
| 007 | 007_api_credentials.sql | Tabla api_credentials |
| 008 | 008_accounts_payable.sql | Tabla accounts_payable (cuentas por pagar) |
| 009 | 009_product_categories.sql | Categorias y subcategorias de productos |
| 018 | 018_lead_form_columns.sql | Configuracion de campos base y columnas del listado de leads |
| 019 | 019_matriculas.sql | Matriculas (post-conversion) |
| 020 | 020_email_sequences.sql | Secuencias de email seguimiento (CRM-185) |
| 021 | 021_forms.sql | Editor de forms (CRM-175) |
| 022 | 022_payroll.sql | Nominas (CRM-171, CRM-173) |
| 023 | 023_woocommerce.sql | WooCommerce import + mapeo (CRM-177) |
| 024 | 024_forms_webhook_matriculas_admision_wc_autosync.sql | 3 mejoras |
| 025 | 025_webhook_listen_mode.sql | Modo escucha tipo Make/Zapier para webhook tokens |
| 026 | 026_role_soporte.sql | Rol "Desarrollador - Soporte" (rol generico que ve todos los proyectos) |
| 027 | 027_form_destination.sql | Webhook destination + listen mode default |
| 029 | 029_documents.sql | Módulo de documentos — facturas y certificados |
| 030 | 030_field_definitions_multi_entity.sql | Campos custom multi-entidad (lead, client, product) |
| 030 | 030_installation_bundles.sql | Bundles de instalacion (CRM-302). Singleton id=1. |
| 031 | 031_performance_indexes.sql | índices FK faltantes + columna notificado_at en lead_reminders |
| 032 | 032_project_channels.sql | canales embebidos por proyecto (CRM-208 / CRM-211) |
| 033 | 033_roles_permissions.sql | Custom roles + overrides de permisos (idempotente). |
| 037 | 037_status.sql | Página de status del sistema. Owner crm_iseie_user. |
| 038 | 038_lead_emails_and_shortcuts.sql | lead_emails (CRM-231) + projects.shortcuts (CRM-235) |
| 039 | 039_categories_tree.sql | (categories): árbol N niveles para product_categories |
| 039 | 039_document_audit_log.sql | 039 (audit): Audit log de documentos (factura/certificado) |
| 040 | 040_documents_r2_and_email.sql | 040 (documents R2 + email): r2_key en documents + auto_email_documents en projects |
| 040 | 040_role_views.sql | (role_views): vista por defecto de roles custom |
| 042 | 042_email_templates.sql | 042_email_templates.sql |
| 043 | 043_external_panels.sql | paneles externos por proyecto (CRM-155) |
| 045 | 045_product_modules.sql | (product_modules): módulos/temario de productos. |
| 046 | 046_project_connectors.sql | Conectores configurables por proyecto. |
| 047 | 047_webhook_subtype.sql | distinguir webhook JSON vs mailhook (email entrante) |
| 048 | 048_wc_field_mapping.sql | mapping configurable para WC import |
| 049 | 049_webhook_default_product.sql | producto por defecto + matching por URL en webhooks |
| 050 | 050_form_template_events.sql | historial de eventos recibidos por webhook/mailhook/form |
| 051 | 051_wc_default_currency.sql | divisa por defecto del WC import |
| 052 | 052_wp_acf_importer.sql | importer multi-fuente WP REST + ACF |
| 053 | 053_unify_sections_as_text.sql | simplificar — secciones como TEXT unificado |
| 056 | 056_add_whatsapp_canal.sql | añadir 'whatsapp' al enum utm_channel |
| 058 | 058_leads_soft_delete.sql | soft delete de leads + auditoría |
| 059 | 059_leads_propuesto.sql | flag "propuesto" (cross-sell) |
| 061 | 061_lead_spam_reports.sql | reportes de spam |
| 063 | 063_make_webhooks.sql | Make.com webhooks por proyecto |
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
| 086 | 086_stripe_payments.sql | stripe_payments |
| 087 | 087_stripe_disputes_extra.sql | Campos extra para gestion de disputas: |
| 088 | 088_invoices.sql | Facturacion (modelo aprobado 2026-06-17) |
| 089 | 089_invoices_extras.sql | metodo_pago, pie_pago, y reset de secuencia por admin |
| 090 | 090_conversion_items_iva.sql | multi-item en conversiones + IVA configurable |
| 091 | 091_whatsapp_widget.sql | Widget WhatsApp rotativo por proyecto |
| 092 | 092_invoices_rectificativa.sql | Facturas rectificativas (de abono) |
| 093 | 093_descuentos.sql | Descuentos por cuadros en conversiones y facturas |
| 094 | 094_invoice_issuers.sql | Multi-emisor de facturas |
| 095 | 095_issuer_logo_key.sql | 095_issuer_logo_key.sql |
| 096 | 096_invoice_templates.sql | Plantillas visuales de factura (editor tipo Canva). Cada plantilla guarda un |
| 097 | 097_issuer_serie.sql | 097_issuer_serie.sql |
| 098 | 098_template_condicion.sql | 098_template_condicion.sql |
| 099 | 099_fiscal_regimenes.sql | Regímenes fiscales + coletillas parametrizadas (editables desde el panel). |
| 100 | 100_sociedades.sql | Sociedades emisoras (agrupación de proyectos) + asignación proyecto→sociedad. |
| 101 | 101_facturacion_cimientos.sql | Cimientos de datos del módulo de facturación (spec v1.0, paso 1). |
| 102 | 102_numeracion_por_sociedad.sql | Numeración por sociedad (spec REQ-NUM-01/02): el contador de facturas es por |
| 103 | 103_proformas.sql | Proformas / presupuestos |
| 104 | 104_invoices_borrador.sql | Facturas en BORRADOR (preliminares) |
| 107 | 107_invoice_per_payment.sql | 107_invoice_per_payment.sql |
| 108 | 108_installment_concepto.sql | Concepto editable por cuota (mensualidades/fraccionados): predefinidos + otros. |
| 109 | 109_factura_manager.sql | Permiso factura_manager: gestora que puede gestionar (editar, corregir, abonar, |
| 110 | 110_editar_fechas_factura.sql | Permiso acotado: usuario que SOLO puede cambiar las fechas (emisión y pago) de |
| 111 | 111_conversion_vendedora.sql | Vendedora POR VENTA. El responsable del lead (leads.responsable_id) es quien |
| 112 | 112_factura_equivalente_eur.sql | Doble moneda MANUAL en facturas y pagos. |
| 113 | 113_stripe_fee_neto.sql | Comisión y neto liquidado por Stripe en cada cobro. |
| 114 | 114_expenses_extensions.sql | Egresos: categorías auto-generadas + comprobante + origen automático. |
| 115 | 115_facturacion_al_dia.sql | Corte de facturacion: hasta que dia esta la facturacion puesta al dia. |
| 116 | 116_stripe_revisado_y_proforma_aprobacion.sql | 1) Hasta que fecha estan ya revisados los cobros de Stripe. |
| 117 | 117_conversion_es_mensualidad.sql | Marcar una venta como "esto en realidad es una mensualidad". |
| 118 | 118_payment_method_valores_que_faltaban.sql | 118 · El enum payment_method se habia quedado corto |
| 119 | 119_invoices_cliente_tipo.sql | 119 · La factura necesita saber si el cliente es empresa o persona |
| 120 | 120_invoice_issuers_alias.sql | Un nombre corto para distinguir emisoras que comparten datos fiscales. |
| 121 | 121_conversion_payments_metodo.sql | conversion_payments.metodo |
| 122 | 122_whatsapp_templates.sql | Hasta ahora vivian en el localStorage del navegador, con dos consecuencias: |
| 123 | 123_tutores_rol.sql | Tutores · el rol nuevo |
| 124 | 124_tutores.sql | Tutores y colaboraciones · las tablas |
| 125 | 125_reembolsos_y_comisiones.sql | Reembolsos: de que pago son, y que pasa con la comision del tutor. |
| 126 | 126_gestor_colaboraciones.sql | Permiso gestor_colaboraciones: quien da de alta tutores y les asigna cursos, |
| 127 | 127_registro_de_correos.sql | Hasta ahora un envio fallido moria en un logger.error() que nadie lee. Los |
| 128 | 128_whatsapp_conversaciones.sql | Hasta ahora WhatsApp vivia FUERA del CRM: un navegador remoto retransmitido |
| 129 | 129_whatsapp_consentimiento.sql | Quien acepto enlazar un numero, y cuando. |
| 130 | 130_whatsapp_responde_a.sql | A que mensaje responde cada mensaje. |
| 131 | 131_lead_whatsapp_usuario.sql | El usuario de WhatsApp de un prospecto, además de su teléfono. |
| 132 | 132_avisos_por_correo.sql | Es la cuarta subfase de la tarea #28. Los tres avisos nuevos —lead sin tocar a |
| 133 | 133_tutor_banco.sql | El IBAN ya lleva dentro el codigo de la entidad (las cuatro cifras despues de |
| 134 | 134_whatsapp_participante.sql | Quien escribio cada mensaje de un grupo. |
| 135 | 135_wa_mensajes_unico_por_conversacion.sql | El identificador de WhatsApp es unico POR CONVERSACION, no en toda la tabla. |
| 136 | 136_numero_de_factura_unico_por_serie.sql | El numero de factura, unico por SERIE y AÑO. No por proyecto. |
| 142 | 142_plazas_y_cierre.sql | #86 · Plazas y cierre de convocatoria en el catalogo. |
| 143 | 143_pasos_comerciales.sql | #87 · Los cinco pasos del proceso comercial, en la base y editables. |
| 146 | 146_agenda_del_lead.sql | La agenda de cada prospecto: qué paso del proceso le toca y qué día. |
| 147 | 147_convocatorias.sql | Las convocatorias, y a quién se le ofrecieron (#86). |
| 148 | 148_proyecto_de_pruebas.sql | Un proyecto marcado como DE PRUEBAS, para trastear en producción sin |
| 149 | 149_busqueda_de_tutor.sql | Si se está buscando tutor para una formación, y con qué anuncio. |
| 150 | 150_ventas_compartidas.sql | Una venta, dos gestoras: repartir el mérito sin descuadrar los totales. |
| 156 | 156_estados_comision_tutor.sql | Los estados de la comision del tutor: dos mas. |
| 157 | 157_entregables_del_tutor.sql | Que ha entregado cada tutor de cada formacion. |
| 159 | 159_usa_whatsapp.sql | Portada desde MultiCRM el 16/09/2026. Alli es la 167; aqui la serie va |
| 160 | 160_etiquetas_de_whatsapp.sql | Portada desde MultiCRM el 16/09/2026. Alli es la 168; aqui la serie va |
| 161 | 161_etiquetas_pendientes.sql | Portada desde MultiCRM el 16/09/2026. Alli es la 169; aqui la serie va |
| 162 | 162_lid_de_la_conversacion.sql | Portada desde MultiCRM el 16/09/2026. Alli es la 170; aqui la serie va |
| 163 | 163_hora_de_sincronizacion.sql | La hora a la que sincroniza cada proyecto su catalogo. |
| 164 | 164_plantilla_por_paso.sql | Cada plantilla, atada a su paso del proceso comercial. |
| 165 | 165_correo_por_paso.sql | El correo de cada paso, atado al paso (la otra mitad del #88). |
| 166 | 166_roles_adicionales.sql | Un usuario puede tener MAS DE UN ROL. |
| 167 | 167_feedback.sql | El correo de «¿por qué has desistido?» y lo que contesta cada uno |
| 168 | 168_remitente_no_contestar.sql | El remitente «no contestar» de cada campus |
| 169 | 169_feedback_respuestas.sql | La encuesta de feedback, con todas sus preguntas |
| 170 | 170_cabecera_de_marca.sql | El fondo de la cabecera de cada marca, en correos y formularios |
| 171 | 171_novedades.sql | Las novedades de cada versión: cuándo y a quién se mandaron |

> **Comprobado el 29/09/2026 contra el catálogo de producción** (no contra la
> salida de ningún comando): aplicadas todas las de esta lista hasta la **171**.
> Las de la 2.0.0 se aplicaron ese día (167–171).

