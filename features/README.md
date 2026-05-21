# Features del CRM — Indice

Cada feature vive en un archivo propio. Documento vivo, se actualiza en cada iteracion. Sincronizado con Jira (CRM-N).

## ✅ Implementadas (produccion/staging)

| Archivo | Feature | Jira |
|---|---|---|
| [01-panel-comisiones.md](01-panel-comisiones.md) | Panel de comisiones (v1) | CRM-129 ✅ |
| [02-logo-proyectos.md](02-logo-proyectos.md) | Logo upload por proyecto | CRM-182 ✅ |
| [03-reportes.md](03-reportes.md) | Reportes con datos reales | CRM-181 ✅ |
| [04-productos-pricing.md](04-productos-pricing.md) | Precio + Stripe + SKU en productos | — ✅ |
| [05-categorias-subcategorias.md](05-categorias-subcategorias.md) | Categorias anidadas (2 niveles actual) | — ✅ |
| [06-cuentas-por-pagar.md](06-cuentas-por-pagar.md) | AP con pagos parciales | — ✅ |
| [07-clientes.md](07-clientes.md) | Clientes (leads convertidos) | — ✅ |
| [08-conversiones-pagos.md](08-conversiones-pagos.md) | Conversiones + pagos parciales | — ✅ |
| [09-brevo-por-proyecto.md](09-brevo-por-proyecto.md) | Brevo credenciales por proyecto | — ✅ |
| [10-project-settings-dialog.md](10-project-settings-dialog.md) | Dialog unificado de config proyecto | — ✅ |
| [11-configuracion-footer.md](11-configuracion-footer.md) | Config al footer del sidebar | CRM-190 ✅ |
| [12-favicon-dinamico.md](12-favicon-dinamico.md) | Favicon = logo del proyecto activo | — ✅ |

## 📝 Backlog (pendientes)

### Epics grandes

| Archivo | Feature | Jira |
|---|---|---|
| [20-rediseño-comisiones.md](20-rediseno-comisiones.md) | Comisiones genericas por gestor + condiciones | CRM-180 |
| [21-forms-editor.md](21-forms-editor.md) | Editor formularios de contacto | CRM-175 |
| [22-matriculas.md](22-matriculas.md) | Matriculas post-conversion con DNI + firma | CRM-176 |
| [23-woocommerce.md](23-woocommerce.md) | Importador WooCommerce con mapeo | CRM-177 |
| [24-modulos-configurables.md](24-modulos-configurables.md) | Modulos on/off por proyecto (runtime) | CRM-178 |
| [25-multi-instancia.md](25-multi-instancia.md) | Features a la carta al instalar (build-time) | CRM-197 |
| [26-nominas.md](26-nominas.md) | Nominas fijo+horas+comisiones | CRM-171/173/174 |
| [27-email-seguimiento.md](27-email-seguimiento.md) | Secuencias de email tipo drip | CRM-185 |
| [28-cuotas-cuentas-cobrar.md](28-cuotas-cuentas-cobrar.md) | Cuotas con fechas + recordatorios | CRM-183 |
| [29-branding-proyecto.md](29-branding-proyecto.md) | Colores, tema, favicon por proyecto | CRM-191 |
| [30-categorias-5-niveles.md](30-categorias-5-niveles.md) | Anidacion hasta 5 niveles | CRM-195 |
| [31-export-excel.md](31-export-excel.md) | Export Excel universal + mapeo columnas | CRM-196 |
| [32-metricas-demograficas.md](32-metricas-demograficas.md) | Pais/genero/edad | CRM-179 |
| [33-stripe-links-multiples.md](33-stripe-links-multiples.md) | N payment links por producto | CRM-130 |
| [34-facturas-pdf.md](34-facturas-pdf.md) | Generador factura PDF automatico | CRM-132 |
| [35-cursos-paola.md](35-cursos-paola.md) | Cursos pendientes de creacion | CRM-131 |
| [36-cierre-mensual.md](36-cierre-mensual.md) | Cierre contabilidad mensual | CRM-134 |
| [37-whatsapp-webhook.md](37-whatsapp-webhook.md) | Webhook generico WhatsApp/Make (opcional) | CRM-133 |
| [38-avatar-usuario.md](38-avatar-usuario.md) | Foto de perfil todos los roles | CRM-186 ✅ |
| [39-egresos-avanzados.md](39-egresos-avanzados.md) | Categorias dinamicas + comprobantes + iconos | CRM-150 |
| [40-canales-personalizados.md](40-canales-personalizados.md) | CRUD canales + webhook-canal mapping | CRM-151 |
| [41-ajustes-nomina.md](41-ajustes-nomina.md) | Bonos/anticipos/descuentos en nomina | CRM-173 |
| [42-comprobantes-nomina.md](42-comprobantes-nomina.md) | Adjuntos PDF/PNG en nomina | CRM-174 |
| [43-reportes-por-categoria.md](43-reportes-por-categoria.md) | /reports/leads, /reports/ventas, etc | CRM-152/169 |
| [44-imagen-producto.md](44-imagen-producto.md) | Foto de producto (R2) | CRM-161 |

### Bugs

| Archivo | Bug | Jira |
|---|---|---|
| [90-bug-spa-reload.md](90-bug-spa-reload.md) | Paginas recargan completo en algunos clicks | CRM-188 ✅ |
| [91-bug-pagos-sin-fecha.md](91-bug-pagos-sin-fecha.md) | Enforcement fecha obligatoria | CRM-184 |
| [92-filtro-usuarios-proyecto.md](92-filtro-usuarios-proyecto.md) | Filtro usuarios por proyecto | CRM-189 ✅ |
| [93-seed-demo.md](93-seed-demo.md) | Datos demo en Psiko + Psicologo IA | CRM-193 ✅ |
| [94-campos-custom-visibles.md](94-campos-custom-visibles.md) | Exponer campos custom + forms + webhook desde Leads | CRM-194 |

## Template

Ver [TEMPLATE.md](TEMPLATE.md) para el formato estandar de cada feature.

## Como mantener este indice

1. Al crear una feature nueva en Jira, añadir fila en seccion correspondiente
2. Al implementar una feature, moverla de 📝 Backlog a ✅ Implementadas
3. Cada archivo feature sigue el template: descripcion, modelo datos, endpoints, UI, dependencias, estado
4. Commitear cambios al repo (`github.com/esos2dev-oss/CRM`)
