---
name: Backlog F4 Jira 2026-04-24
description: Mapa de los ~25 epics/stories nuevos abiertos en Jira durante la sesion 2026-04-24, con decisiones tecnicas clave
type: project
originSessionId: 02c2801c-3375-4d51-9636-d374bd8ec8c9
---
Sesion 2026-04-24: sprint intensivo de requerimientos + registro en Jira. Los epics F4 representan la fase post-MVP: refinamientos operativos y features grandes.

## Estado completado en codigo (deployed)

- **CRM-129** Panel de comisiones base (reglas + commissions generadas auto + panel /commissions)
- **CRM-154** Boton gear junto al selector de proyecto abre ProjectSettingsDialog
- **CRM-156** Validacion importe conversion > 0
- **CRM-158** Fecha editable en interacciones (datetime-local + ISO al backend)
- **CRM-159** Dedupe lead por doble submit (ventana 10s si email+nombre match)
- **CRM-170** Comisiones bajo grupo Contabilidad en sidebar
- **CRM-181** Reportes reales conectados a /api/reports/overview (antes era mock)
- **CRM-182** Logo proyectos via disco local `/var/crm-uploads/` (R2 no configurado)
- **CRM-187** Reset DB BETA (solo Psiko + Psicologo IA)

## Epics grandes pendientes

- **CRM-171** Nominas (fijo + horas + comisiones, combos permitidos; fijo+horas es el menos comun pero valido)
- **CRM-173** Ajustes puntuales en nominas (bono, anticipo, descuento, extra)
- **CRM-174** Comprobantes PDF/PNG adjuntos en nominas (polimorfico: commission/adjustment/period)
- **CRM-175** Editor forms de contacto por proyecto (plantillas + embed script/iframe + JSON schema + Shadow DOM para aislar CSS)
- **CRM-176** Matriculas post-conversion (DNI + titulo + firma canvas → PNG → R2, estados pendiente/validada/rechazada)
- **CRM-177** WooCommerce importador con UI de mapeo (ver abajo detalle)
- **CRM-178** Modulos configurables por proyecto (JSONB toggles, reemplaza CRM-172 modo IA binario)
- **CRM-179** Metricas demograficas (pais, genero, fecha_nacimiento, choropleth map)
- **CRM-180** Rediseño comisiones: genericas por gestor (no por producto) + base_calc cobrado/vendido + condiciones JSONB + aisladas por proyecto
- **CRM-183** Cuentas por cobrar con cuotas + fechas + pagos adelantados + Brevo recordatorios
- **CRM-185** Seguimiento email secuencias (Brevo templates + step scheduler + triggers)
- **CRM-186** Avatar usuario (users.avatar_url/key, POST /api/users/:id/avatar)
- **CRM-191** Branding personalizable por proyecto (colores, favicon, tema por proyecto)
- **CRM-194** Exposicion directa de campos custom + forms + webhook en Leads (no enterrado en settings)
- **CRM-195** Categorias hasta 5 niveles anidados (facultad → subcat → tipo). Eliminar `products.subcategoria_id`, usar solo `categoria_id` apuntando al nodo hoja; breadcrumb via parent_id recursivo
- **CRM-196** Export Excel universal con mapeo masivo de columnas (bulk select, reorder, renombrar headers, plantillas guardadas, XLSX/CSV/JSON)

## Bugs pendientes

- **CRM-184** Enforcement fechas obligatorias en todos los pagos (conversion_payments, accounts_payable_payments, commissions.fecha_pago, expenses.fecha)
- **CRM-188** Pagina recarga entera en algunos clicks (no SPA). Investigar location.reload() en WebhookTab al regenerar key, y links href
- **CRM-189** Filtro de usuarios por proyecto (toggle: activo / todos)
- **CRM-190** Mover Configuracion al footer del sidebar (nivel del toggle modo oscuro)
- **CRM-192** Logos no se ven en project cards (ya fix en codigo, pendiente deploy)
- **CRM-193** Seed demo completo Psiko + Psicologo IA (productos, leads, conversions, egresos, comisiones)

## Decisiones clave tomadas en sesion

**Comisiones (CRM-180):** rediseño a modelo generico — una regla por (project_id, user_id, pct) con producto_id opcional como override. base_calc: sobre cobrado o vendido. condicion JSONB con operadores simples sin SQL. Aisladas estrictas por proyecto (si estoy en ISEIH NO debo ver comisiones de Psiko).

**Webhooks vs UTM (clarificacion):** NO son alternativas. Webhook es el transporte (POST con api_key), UTMs son datos que viajan dentro del body. Siempre usar los dos juntos. UTMs se capturan del URL del landing con 3 lineas de JS.

**Forms (CRM-175):** NO hacer builder drag-drop. Solo plantillas pre-hechas (Contacto basico, Lead con producto) con toggles opcionales. Shadow DOM para aislar CSS. Hereda logo/producto_label/productos/color del proyecto activo.

**Modulos por proyecto (CRM-178):** cada proyecto activa/desactiva modulos individualmente (leads, pipeline, clients, conversions, commissions, matriculas, forms, woocommerce, platform_users, accounting_*, payroll, reports). Middleware server-side rechaza endpoints de modulos deshabilitados. Sidebar se regenera. Ejemplo: Tarot IA solo platform_users + accounting_income.

**WooCommerce (CRM-177):** importador con UI de mapeo flexible. Cada tienda WC puede tener meta_data con nombres custom (ej descripcion en una tienda se llama `estudiar`). Admin mapea visualmente: campo WC → campo CRM. Mapeo masivo: auto-detectar por nombre similar, copiar a todos, copiar desde otro proyecto como plantilla. Update (no duplicar) via wc_product_id. Variaciones WC → JSONB products.variations. Categorias nuevas se crean automaticamente respetando limite 5 niveles (CRM-195).

**Pagos con fecha (CRM-184):** enforcement: TODO pago (conversion, accounts_payable, commission, expense) lleva fecha NOT NULL. Frontend siempre muestra campo fecha editable, default hoy. Permite backdate. Excepcion: cuotas previstas tienen fecha_vencimiento (futura) vs fecha_cobro (al pagar, no futura).

**Avatar (CRM-186):** todos los roles pueden subir foto (no solo admin). Usa localStorage.service (disco local, R2 queda para futuro). Usuario modifica solo su propia foto salvo superadmin.

**Nominas (CRM-171):** todas las combinaciones permitidas pero fijo+horas es el menos comun (mostrar warning UI). Tablas: payroll_plans, work_hours, payroll_periods. Reusa commissions existente. Admin cierra mes y genera payroll_period.

## Why
Evolucion de BETA con feedback operativo real del equipo Psiko Aprende + ISEIH. Todo anotado en Jira para que sobreviva a resets de contexto. Usuario quiere poder duplicar el setup en otros servers conservando este backlog.

## How to apply
Cuando el usuario diga "sigamos" o "arranca con X", consultar Jira por el CRM-N exacto. Priorizar bugs primero (CRM-184, 188, 189, 190, 192, 193) luego epics grandes segun impacto. Los cambios grandes (CRM-177, 178, 195) requieren migration + refactor profundo, agendar bloques de trabajo. No implementar sin confirmar alcance antes (el usuario suele ampliar o simplificar el scope).
