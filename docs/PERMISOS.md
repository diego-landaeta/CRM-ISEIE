# Permisos del CRM

> **Generado** con `npm run permisos:inventario` (backend). No se edita a mano:
> sale de recorrer los routers de cada módulo (`modules/permissions/inventario/rutas.js`)
> y de las comprobaciones a mano apuntadas en `inventario/manuales.js`. Una prueba
> falla si el código cambia y esto no.

688 rutas en 52 módulos, y 25 acciones con condición dentro de una ruta.
Ningún guardia sin clasificar.

**Cómo leerlo.** «Qué la protegía» es lo que había en el código antes de #423 (congelado en `inventario/antes-423.json`): `roleGuard` dejaba pasar
además a superadmin y a soporte; `soloRoles` no. «Quién podía» lo calcula
la copia congelada de esas reglas (`inventario/legado.js`) para cada rol, sin casillas
ni excepciones, y dice qué casilla abre la puerta a quien no entra por su rol. El
alcance —qué campus, qué prospectos— no cambia quién entra y va al final.
«Permiso» es la clave del catálogo que pide la ruta (el catálogo entero, más abajo).

# Inventario: cada ruta y cada acción

## accounting

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| dashboard | `GET /api/accounting/dashboard` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounting.view` |
| receivable | `GET /api/accounting/receivable` | sesión · roleGuard(admin, superadmin, soporte, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `accounting.por_cobrar` |

## accounts-payable

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/accounts-payable/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.view` |
| stats | `GET /api/accounts-payable/stats` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.view` |
| getOne | `GET /api/accounts-payable/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.view` |
| create | `POST /api/accounts-payable/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.create` |
| update | `PATCH /api/accounts-payable/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.edit` |
| remove | `DELETE /api/accounts-payable/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.delete` |
| addPayment | `POST /api/accounts-payable/:id/payments` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `accounts_payable.edit` |

## asignacion

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| entrada | `POST /api/asignacion/entrada` | (no existía) | (ruta nueva) | — |
| listar | `GET /api/asignacion/` | (no existía) | (ruta nueva) | `webhooks_salientes.view` |
| decisiones | `GET /api/asignacion/decisiones` | (no existía) | (ruta nueva) | `webhooks_salientes.view` |
| reenviar | `POST /api/asignacion/decisiones/:id/reenviar` | (no existía) | (ruta nueva) | `webhooks_salientes.edit` |
| crear | `POST /api/asignacion/` | (no existía) | (ruta nueva) | `webhooks_salientes.create` |
| cambiar | `PATCH /api/asignacion/:id` | (no existía) | (ruta nueva) | `webhooks_salientes.edit` |
| nuevaClave | `POST /api/asignacion/:id/clave` | (no existía) | (ruta nueva) | `webhooks_salientes.edit` |
| prueba | `POST /api/asignacion/:id/prueba` | (no existía) | (ruta nueva) | `webhooks_salientes.edit` |
| borrar | `DELETE /api/asignacion/:id` | (no existía) | (ruta nueva) | `webhooks_salientes.delete` |

## auth

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| login | `POST /api/auth/login` | nada (pública) | cualquiera, sin sesión | — |
| refresh | `POST /api/auth/refresh` | nada (pública) | cualquiera, sin sesión | — |
| logout | `POST /api/auth/logout` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| setPassword | `POST /api/auth/set-password` | nada (pública) | cualquiera, sin sesión | — |
| me | `GET /api/auth/me` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| changePassword | `POST /api/auth/change-password` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| updateMyProfile | `PATCH /api/auth/me` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| updateMyEmail | `PATCH /api/auth/me/email` | sesión · a mano: auth.controller.js · updateMyEmail | tutor | `cuenta.cambiar_correo` |

## certifex

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| recibir | `POST /api/certifex/consultas` | nada (pública) | cualquiera, sin sesión | — |
| recibirSolicitud | `POST /api/certifex/solicitudes` | nada (pública) | cualquiera, sin sesión | — |
| recibirCompletado | `POST /api/certifex/completados` | nada (pública) | cualquiera, sin sesión | — |
| estado | `GET /api/certifex/emisiones/estado` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| centros | `GET /api/certifex/emisiones/centros` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| cursos | `GET /api/certifex/emisiones/cursos` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| logo | `GET /api/certifex/emisiones/logo` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| diploma | `GET /api/certifex/emisiones/diploma/:nexp` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| resumen | `GET /api/certifex/diplomas/resumen` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| solicitudes | `GET /api/certifex/diplomas/solicitudes` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| porAvisar | `GET /api/certifex/diplomas/por-avisar` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| terminados | `GET /api/certifex/diplomas/terminados` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| diplomas | `GET /api/certifex/diplomas` | sesión · rol (admin, superadmin) o permiso diplomas.view | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.view` o `diplomas.emit` |
| editar | `POST /api/certifex/diplomas/editar` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| pedir | `POST /api/certifex/diplomas/pedir` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| aprobarEmitir | `POST /api/certifex/diplomas/aprobar-emitir` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| emitir | `POST /api/certifex/diplomas/emitir` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| avisos | `POST /api/certifex/diplomas/avisos` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| nuevo | `POST /api/certifex/diplomas/nuevo` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| formaciones | `GET /api/certifex/diplomas/formaciones` | sesión · rol (admin, superadmin) o permiso diplomas.emit | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `diplomas.emit` |
| listar | `GET /api/certifex/consultas` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `certifex_consultas.view` |
| actualizar | `PATCH /api/certifex/consultas/:id` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `certifex_consultas.edit` |
| listar | `GET /api/certifex/emisiones` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.view_emisiones` |
| decidir | `POST /api/certifex/emisiones/decisiones` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.aprobar` |
| emitir | `POST /api/certifex/emisiones/emitir` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.aprobar` |
| rechazar | `POST /api/certifex/diplomas/rechazar` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.aprobar` |
| avisosRechazo | `POST /api/certifex/diplomas/avisos-rechazo` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.avisar` |
| revocar | `POST /api/certifex/diplomas/revocar` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.revocar` |
| corregir | `POST /api/certifex/diplomas/corregir` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.edit` |
| subirFirma | `POST /api/certifex/diplomas/firma` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.edit` |
| verFirma | `GET /api/certifex/diplomas/firma/:matriculaId` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.view_emisiones` |
| sincronizarFormacion | `POST /api/certifex/diplomas/formaciones/sincronizar` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo · soloRoles(admin, superadmin) | superadmin, admin | `diplomas.edit` |
| diploma · el diploma en formato de imprenta | `GET /api/certifex/emisiones/diploma/:nexp` | cuando el diploma en formato de imprenta: a mano, certifex.emisiones.js · diploma | superadmin, admin | `diplomas.imprenta` |

## change-requests

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/change-requests/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.view` |
| create | `POST /api/change-requests/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.create` |
| getById | `GET /api/change-requests/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.view` |
| update | `PATCH /api/change-requests/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.edit` |
| remove | `DELETE /api/change-requests/:id` | sesión · roleGuard(admin, superadmin, project_manager) +superadmin +soporte por el atajo | superadmin, admin, soporte, project_manager | `change_requests.delete` |
| reopen | `POST /api/change-requests/:id/reopen` | sesión · roleGuard(admin, superadmin, project_manager) +superadmin +soporte por el atajo | superadmin, admin, soporte, project_manager | `change_requests.reopen` |
| approve | `POST /api/change-requests/:id/approve` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.approve` |
| getApprovalSignature | `GET /api/change-requests/approvals/:approvalId/signature` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.view` |
| uploadAttachment | `POST /api/change-requests/:id/attachments` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.edit` |
| downloadAttachment | `GET /api/change-requests/attachments/:attachmentId/download` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.view` |
| deleteAttachment | `DELETE /api/change-requests/attachments/:attachmentId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `change_requests.edit` |

## client-errors

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| (anónima) | `POST /api/client-errors/` | nada (pública) | cualquiera, sin sesión | — |

## commissions

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listRules | `GET /api/commissions/rules` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `commissions.view` |
| createRule | `POST /api/commissions/rules` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `commissions.reglas` |
| updateRule | `PATCH /api/commissions/rules/:id` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `commissions.reglas` |
| deleteRule | `DELETE /api/commissions/rules/:id` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `commissions.reglas` |
| listMine | `GET /api/commissions/me` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| statsMine | `GET /api/commissions/me/stats` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| listAll | `GET /api/commissions/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `commissions.view` |
| statsAll | `GET /api/commissions/stats` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `commissions.view` |
| pay | `PATCH /api/commissions/:id/pay` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `commissions.pagar` |
| recalculate | `POST /api/commissions/recalculate/:conversionId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `commissions.edit` |

## connectors

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/connectors/` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.view` |
| mcpUrl | `POST /api/connectors/:id/mcp-url` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.edit` |
| getById | `GET /api/connectors/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.view` |
| create | `POST /api/connectors/` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.create` |
| update | `PATCH /api/connectors/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.edit` |
| remove | `DELETE /api/connectors/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.delete` |
| preview | `POST /api/connectors/:id/preview` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.edit` |
| runImport | `POST /api/connectors/:id/import` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `connectors.edit` |
| create · conectores de todo el sistema (alcance «sistema») | `POST /api/connectors/` | cuando conectores de todo el sistema (alcance «sistema»): a mano, connectors.controller.js · esSuperadmin | superadmin | `connectors.sistema` |
| update · conectores de todo el sistema (alcance «sistema») | `PATCH /api/connectors/:id` | cuando conectores de todo el sistema (alcance «sistema»): a mano, connectors.controller.js · esSuperadmin | superadmin | `connectors.sistema` |
| remove · conectores de todo el sistema (alcance «sistema») | `DELETE /api/connectors/:id` | cuando conectores de todo el sistema (alcance «sistema»): a mano, connectors.controller.js · esSuperadmin | superadmin | `connectors.sistema` |

## conversions

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/conversions/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| listProductos | `GET /api/conversions/productos` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| cuotas | `GET /api/conversions/cuotas` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| filas | `GET /api/conversions/filas` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| listByLead | `GET /api/conversions/by-lead/:leadId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| getById | `GET /api/conversions/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| create | `POST /api/conversions/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.create` |
| update | `PATCH /api/conversions/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.edit` |
| addPayment | `POST /api/conversions/:id/payments` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| removePayment | `DELETE /api/conversions/payments/:paymentId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| listInstallments | `GET /api/conversions/:id/installments` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| generateInstallments | `POST /api/conversions/:id/installments/generate` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| updateInstallment | `PATCH /api/conversions/installments/:instId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| payInstallment | `POST /api/conversions/installments/:instId/pay` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| editPaidInstallment | `PATCH /api/conversions/installments/:instId/paid` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| unpayInstallment | `POST /api/conversions/installments/:instId/unpay` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| deleteInstallment | `DELETE /api/conversions/installments/:instId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.cobros` |
| get | `GET /api/conversions/:id/reparto` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| set | `PUT /api/conversions/:id/reparto` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `conversions.reparto` |
| remove | `DELETE /api/conversions/:id/reparto` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `conversions.reparto` |
| list | `GET /api/conversions/:id/refunds` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.view` |
| create | `POST /api/conversions/:id/refunds` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `conversions.devoluciones` |
| remove | `DELETE /api/conversions/refunds/:refundId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `conversions.devoluciones` |
| remove | `DELETE /api/conversions/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `conversions.delete` |
| addPayment · que el cobro salga ya facturado (si no, queda en la cola; no da 403) | `POST /api/conversions/:id/payments` | cuando que el cobro salga ya facturado (si no, queda en la cola; no da 403): a mano, conversion.service.js · autoInvoice (puedeEmitirFactura) | superadmin, admin y gestor/soporte/project_manager/tutor con «factura_manager» | `facturas.emitir` |

## convocatorias

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| embudo | `GET /api/convocatorias/embudo` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.view` |
| pendientes | `GET /api/convocatorias/pendientes` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.view` |
| deLead | `GET /api/convocatorias/lead/:leadId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.view` |
| ofrecer | `POST /api/convocatorias/:id/ofrecer` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.ofrecer` |
| actualizarOfrecimiento | `PATCH /api/convocatorias/ofrecimientos/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.ofrecer` |
| listar | `GET /api/convocatorias/` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `convocatorias.view` |
| crear | `POST /api/convocatorias/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `convocatorias.create` |
| editar | `PATCH /api/convocatorias/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `convocatorias.edit` |

## credentials

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/credentials/` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `credentials.view` |
| upsert | `POST /api/credentials/` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `credentials.edit` |
| test | `POST /api/credentials/:id/test` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `credentials.edit` |
| remove | `DELETE /api/credentials/:id` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `credentials.edit` |

## documents

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/documents/` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `documents.view` |
| download | `GET /api/documents/:id/download` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `documents.view` |
| audit | `GET /api/documents/:id/audit` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, soporte | `documents.auditar` |
| peekNumber | `GET /api/documents/next-number` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.numeracion` |
| setNumber | `POST /api/documents/set-number` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.numeracion` |
| preview | `POST /api/documents/preview` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `documents.create` |
| generate | `POST /api/documents/generate` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.create` |
| regenerate | `POST /api/documents/:id/regenerate` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.create` |
| resendEmail | `POST /api/documents/:id/resend-email` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.create` |
| remove | `DELETE /api/documents/:id` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `documents.delete` |

## dossiers

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| upload | `POST /api/dossiers/upload` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `dossiers.upload` |
| getPresignedUrl | `GET /api/dossiers/:id/url` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `dossiers.view` |
| getHistory | `GET /api/dossiers/product/:productId/history` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `dossiers.view` |

## email-sequences

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/secuencias-email/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `email_sequences.view` |
| listRuns | `GET /api/secuencias-email/runs` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `email_sequences.view` |
| getById | `GET /api/secuencias-email/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `email_sequences.view` |
| create | `POST /api/secuencias-email/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `email_sequences.create` |
| update | `PATCH /api/secuencias-email/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `email_sequences.edit` |
| remove | `DELETE /api/secuencias-email/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `email_sequences.delete` |
| startManual | `POST /api/secuencias-email/runs/start` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `email_sequences.lanzar` |
| stopRun | `POST /api/secuencias-email/runs/:runId/stop` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `email_sequences.lanzar` |

## email-templates

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getVariables | `GET /api/email-templates/variables` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `email_templates.view` |
| list | `GET /api/email-templates/` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `email_templates.view` |
| getById | `GET /api/email-templates/:id` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `email_templates.view` |
| preview | `POST /api/email-templates/:id/render` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `email_templates.view` |
| create | `POST /api/email-templates/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `email_templates.create` |
| update | `PATCH /api/email-templates/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `email_templates.edit` |
| remove | `DELETE /api/email-templates/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `email_templates.delete` |

## expenses

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listExpenses | `GET /api/expenses/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.view` |
| resumen | `GET /api/expenses/resumen` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.view` |
| uploadComprobante | `POST /api/expenses/upload-comprobante` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.create` |
| downloadComprobante | `GET /api/expenses/comprobante/:key` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.view` |
| getExpense | `GET /api/expenses/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.view` |
| createExpense | `POST /api/expenses/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.create` |
| updateExpense | `PATCH /api/expenses/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.edit` |
| deleteExpense | `DELETE /api/expenses/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `expenses.delete` |

## facturas-colaborador

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| (anónima) | `GET /api/facturas-colaborador/enlace/:token` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `POST /api/facturas-colaborador/enlace/:token` | nada (pública) | cualquiera, sin sesión | — |
| archivoLocal | `GET /api/facturas-colaborador/archivo-local/:id` | nada (pública) | cualquiera, sin sesión | — |
| justificanteLocal | `GET /api/facturas-colaborador/justificante-local/:id` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `GET /api/facturas-colaborador/mias` | sesión · checkPermission(facturas_colaborador.subir) sin roles de más | superadmin, colaborador y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.subir` |
| (anónima) | `POST /api/facturas-colaborador/mias/:id` | sesión · checkPermission(facturas_colaborador.subir) sin roles de más | superadmin, colaborador y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.subir` |
| (anónima) | `GET /api/facturas-colaborador/mias/:id/archivo` | sesión · checkPermission(facturas_colaborador.subir) sin roles de más | superadmin, colaborador y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.subir` |
| (anónima) | `GET /api/facturas-colaborador/empresas` | sesión · permiso facturas_colaborador.ver_todas o facturas_colaborador.gestionar | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` o `facturas_colaborador.gestionar` |
| (anónima) | `GET /api/facturas-colaborador/colaboradores` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `POST /api/facturas-colaborador/colaboradores` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `GET /api/facturas-colaborador/colaboradores/:id` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `PATCH /api/facturas-colaborador/colaboradores/:id` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `POST /api/facturas-colaborador/colaboradores/:id/baja` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `POST /api/facturas-colaborador/colaboradores/:id/alta` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `GET /api/facturas-colaborador/colaboradores/:id/registro` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `GET /api/facturas-colaborador/mes` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/facturas` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/coste-por-campus` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/zip` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/facturas/:id/archivo` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/facturas/:id/registro` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `GET /api/facturas-colaborador/facturas/:id/desglose` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |
| (anónima) | `POST /api/facturas-colaborador/facturas/:id/anular` | sesión · checkPermission(facturas_colaborador.anular) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.anular` |
| (anónima) | `POST /api/facturas-colaborador/facturas/:id/reenviar` | sesión · checkPermission(facturas_colaborador.gestionar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.gestionar` |
| (anónima) | `POST /api/facturas-colaborador/facturas/pagar` | sesión · checkPermission(facturas_colaborador.pagar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.pagar` |
| (anónima) | `POST /api/facturas-colaborador/facturas/:id/deshacer-pago` | sesión · checkPermission(facturas_colaborador.pagar) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.pagar` |
| (anónima) | `GET /api/facturas-colaborador/facturas/:id/justificante` | sesión · checkPermission(facturas_colaborador.ver_todas) sin roles de más | superadmin, admin y quien tenga el permiso por rol a medida o excepción | `facturas_colaborador.ver_todas` |

## feedback

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| panel | `GET /api/feedback/panel` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `feedback.view` |
| lista | `GET /api/feedback/lista` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `feedback.view` |
| deUnLead | `GET /api/feedback/lead/:leadId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `feedback.view` |
| enviarLoRevisado | `POST /api/feedback/lead/:leadId/enviar` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `feedback.enviar` |
| noEnviar | `POST /api/feedback/lead/:leadId/no-enviar` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `feedback.enviar` |
| servir | `GET /api/f/cabecera/:projectId` | nada (pública) | cualquiera, sin sesión | — |
| servir | `GET /api/f/cabecera/:projectId.png` | nada (pública) | cualquiera, sin sesión | — |
| servirInsignia | `GET /api/f/insignia/:projectId` | nada (pública) | cualquiera, sin sesión | — |
| encuesta | `GET /api/f/:token` | nada (pública) | cualquiera, sin sesión | — |
| responder | `POST /api/f/:token` | nada (pública) | cualquiera, sin sesión | — |

## field-definitions

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listByProject | `GET /api/field-definitions/project/:projectId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `field_defs.view` |
| create | `POST /api/field-definitions/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `field_defs.edit` |
| update | `PATCH /api/field-definitions/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `field_defs.edit` |
| remove | `DELETE /api/field-definitions/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `field_defs.edit` |
| reorder | `POST /api/field-definitions/reorder` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `field_defs.edit` |

## forms

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| publicMeta | `GET /api/forms/public/:embedId` | nada (pública) | cualquiera, sin sesión | — |
| publicSubmit | `POST /api/forms/public/:embedId/submit` | nada (pública) | cualquiera, sin sesión | — |
| publicWebhook | `POST /api/forms/webhook/:embedId` | nada (pública) | cualquiera, sin sesión | — |
| publicMailhook | `POST /api/forms/mailhook/:embedId` | nada (pública) | cualquiera, sin sesión | — |
| list | `GET /api/forms/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `forms.view` |
| getById | `GET /api/forms/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `forms.view` |
| getStatus | `GET /api/forms/:id/status` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `forms.view` |
| listEvents | `GET /api/forms/:id/events` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `forms.view` |
| create | `POST /api/forms/` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `forms.create` |
| update | `PATCH /api/forms/:id` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `forms.edit` |
| remove | `DELETE /api/forms/:id` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `forms.delete` |
| startListening | `POST /api/forms/:id/listen` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `forms.edit` |
| stopListening | `POST /api/forms/:id/listen/stop` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `forms.edit` |

## installation

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getInstallation | `GET /api/installation/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `installation.view` |
| updateInstallation | `PATCH /api/installation/` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `installation.edit` |

## integrations

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/integrations/` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `integrations.view` |
| getOne | `GET /api/integrations/:provider` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `integrations.view` |
| upsert | `PUT /api/integrations/` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `integrations.edit` |
| test | `POST /api/integrations/:provider/test` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `integrations.edit` |
| remove | `DELETE /api/integrations/:provider` | sesión · roleGuard(superadmin, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `integrations.edit` |

## invoices

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getIssuerLogo | `GET /api/invoices/issuers/:id/logo` | nada (pública) | cualquiera, sin sesión | — |
| facturacionAlDia | `GET /api/invoices/facturacion-al-dia` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| setFacturacionAlDia | `PUT /api/invoices/facturacion-al-dia` | sesión · a mano: invoices.controller.js · esFacturaManager | superadmin y admin/gestor/soporte/project_manager/tutor con «factura_manager» | `facturas.cola` |
| generarDeCola | `POST /api/invoices/cola/generar` | sesión · a mano: invoices.controller.js · esFacturaManager | superadmin y admin/gestor/soporte/project_manager/tutor con «factura_manager» | `facturas.cola` |
| emitirColaHasta | `POST /api/invoices/cola/emitir-hasta` | sesión · a mano: invoices.controller.js · esFacturaManager | superadmin y admin/gestor/soporte/project_manager/tutor con «factura_manager» | `facturas.cola` |
| list | `GET /api/invoices/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| stats | `GET /api/invoices/stats` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| siguienteNumero | `GET /api/invoices/siguiente-numero` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| ventasSinFactura | `GET /api/invoices/ventas-sin-factura` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| listRegimenes | `GET /api/invoices/regimenes` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| resolveRegimen | `GET /api/invoices/resolve-regimen` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| createRegimen | `POST /api/invoices/regimenes` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| updateRegimen | `PATCH /api/invoices/regimenes/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| deleteRegimen | `DELETE /api/invoices/regimenes/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| listTemplates | `GET /api/invoices/templates` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| createTemplate | `POST /api/invoices/templates` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| getTemplate | `GET /api/invoices/templates/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| updateTemplate | `PATCH /api/invoices/templates/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| deleteTemplate | `DELETE /api/invoices/templates/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| listIssuers | `GET /api/invoices/issuers` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| createIssuer | `POST /api/invoices/issuers` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| updateIssuer | `PATCH /api/invoices/issuers/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| deleteIssuer | `DELETE /api/invoices/issuers/:id` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| uploadIssuerLogo | `POST /api/invoices/issuers/:id/logo` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| deleteIssuerLogo | `DELETE /api/invoices/issuers/:id/logo` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| getConfig | `GET /api/invoices/config` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| updateConfig | `PATCH /api/invoices/config` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| listSequences | `GET /api/invoices/sequences` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| setSequence | `POST /api/invoices/sequences` | sesión · a mano: invoices.controller.js · isAdmin(req) | superadmin, admin, soporte | `facturas.configurar` |
| leadFiscalData | `GET /api/invoices/lead-fiscal/:leadId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| byConversion | `GET /api/invoices/by-conversion/:conversionId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| getOne | `GET /api/invoices/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| create | `POST /api/invoices/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.create` |
| update | `PATCH /api/invoices/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `facturas.edit` |
| corregir | `PATCH /api/invoices/:id/corregir` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo · a mano: invoices.model.js · puedeGestionarFactura | superadmin, admin y gestor con «factura_manager» | `facturas.gestionar` |
| updateFechas | `PATCH /api/invoices/:id/fechas` | sesión · a mano: invoices.model.js · puedeEditarFechas | superadmin, admin y gestor/soporte/project_manager/tutor con «editar_fechas_factura» | `facturas.editar_fechas` |
| marcarEntregada | `PATCH /api/invoices/:id/entregada` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.completar` |
| asociarVenta | `PATCH /api/invoices/:id/asociar` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo · a mano: invoices.model.js · puedeGestionarFactura | superadmin, admin y gestor con «factura_manager» | `facturas.gestionar` |
| pdf | `GET /api/invoices/:id/pdf` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.view` |
| send | `POST /api/invoices/:id/send` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.enviar` |
| markPaid | `POST /api/invoices/:id/mark-paid` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.cobrar` |
| cobrarProforma | `POST /api/invoices/:id/cobrar-proforma` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo · a mano: invoices.controller.js · esFacturaManager | superadmin y admin/gestor/soporte con «factura_manager» | `facturas.cola` |
| cancel | `POST /api/invoices/:id/cancel` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.anular` |
| destroy | `DELETE /api/invoices/:id` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo · a mano: invoices.model.js · puedeGestionarFactura | superadmin, admin y gestor con «factura_manager» | `facturas.gestionar` |
| rectificar | `POST /api/invoices/:id/rectificar` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo · a mano: invoices.model.js · puedeGestionarFactura | superadmin, admin y gestor con «factura_manager» | `facturas.gestionar` |
| emitir | `POST /api/invoices/:id/emitir` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.emitir_borrador` |
| completarDatos | `POST /api/invoices/:id/completar-datos` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `facturas.completar` |
| create · la factura es rectificativa (de abono) | `POST /api/invoices/` | cuando la factura es rectificativa (de abono): a mano, invoices.controller.js · create | superadmin, admin y gestor con «factura_manager» | `facturas.gestionar` |
| create · una proforma sin esperar visto bueno (si no, queda pendiente de aprobar; no da 403) | `POST /api/invoices/` | cuando una proforma sin esperar visto bueno (si no, queda pendiente de aprobar; no da 403): a mano, invoices.controller.js · create | superadmin, admin y gestor/soporte/project_manager/tutor con «factura_manager» | `facturas.emitir` |

## leads

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| webhook | `POST /api/leads/webhooks/:slug` | nada (pública) | cualquiera, sin sesión | — |
| list | `GET /api/leads/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| exportWasapi | `GET /api/leads/export/wasapi` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.exportar_wasapi` |
| stats | `GET /api/leads/stats` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| today | `GET /api/leads/today` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| dashboardSummary | `GET /api/leads/dashboard-summary` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| lookupByEmail | `GET /api/leads/lookup-by-email` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| checkDuplicate | `POST /api/leads/check-duplicate` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| listPending | `GET /api/leads/spam-reports` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.spam` |
| countPending | `GET /api/leads/spam-reports/count` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.spam` |
| resolveReport | `PATCH /api/leads/spam-reports/:reportId` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `leads.spam_resolver` |
| listReviewQueue | `GET /api/leads/review-queue` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.duplicados` |
| listDuplicateGroups | `GET /api/leads/duplicados` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.duplicados` |
| decideReviewQueue | `POST /api/leads/review-queue/:id/decide` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.duplicados` |
| listLeadProducts | `GET /api/leads/:id/products` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| addLeadProduct | `POST /api/leads/:id/products` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| updateLeadProduct | `PATCH /api/leads/:id/products/:lpId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| removeLeadProduct | `DELETE /api/leads/:id/products/:lpId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| getById | `GET /api/leads/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| mergeLeads | `POST /api/leads/:id/merge` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| createManual | `POST /api/leads/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.create` |
| bulkCreate | `POST /api/leads/bulk` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.create` |
| update | `PATCH /api/leads/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| changeStatus | `PATCH /api/leads/:id/status` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| addInteraction | `POST /api/leads/:id/interactions` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| updateInteraction | `PATCH /api/leads/:id/interactions/:interactionId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| deleteInteraction | `DELETE /api/leads/:id/interactions/:interactionId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| addReminder | `POST /api/leads/:id/reminders` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| completeReminder | `PATCH /api/leads/reminders/:reminderId/complete` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.edit` |
| getLeadSequences | `GET /api/leads/:id/sequences` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| getPurchaseHistory | `GET /api/leads/:id/purchase-history` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| sendLeadEmail | `POST /api/leads/:id/send-email` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.enviar_correo` |
| listLeadEmails | `GET /api/leads/:id/emails` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `leads.view` |
| reportSpam | `POST /api/leads/:id/report-spam` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.reportar_spam` |
| reassign | `PATCH /api/leads/:id/reassign` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.assign` |
| softDelete | `DELETE /api/leads/:id` | sesión · rol (admin, superadmin) +soporte o permiso leads.delete | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `leads.delete` |
| restore | `PATCH /api/leads/:id/restore` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `leads.restaurar` |
| reassignPending | `POST /api/leads/reassign-pending` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `leads.assign` |
| softDelete · borrar por cualquier motivo, aunque no sea suyo o tenga ventas | `DELETE /api/leads/:id` | cuando borrar por cualquier motivo, aunque no sea suyo o tenga ventas: a mano, lead.controller.js · softDelete | superadmin, admin, soporte | `leads.delete_cualquiera` |

## make

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/make-webhooks/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.view` |
| getById | `GET /api/make-webhooks/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.view` |
| create | `POST /api/make-webhooks/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.create` |
| update | `PATCH /api/make-webhooks/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.edit` |
| remove | `DELETE /api/make-webhooks/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.delete` |
| rotateSecret | `POST /api/make-webhooks/:id/rotate-secret` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.edit` |
| deliveries | `GET /api/make-webhooks/:id/deliveries` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `make.view` |
| receive | `POST /api/webhooks/make/:slug` | nada (pública) | cualquiera, sin sesión | — |

## matriculas

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getDoc | `GET /api/matriculas/:id/doc/:tipo` | nada (pública) | cualquiera, sin sesión | — |
| list | `GET /api/matriculas/` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `matriculas.view` |
| getById | `GET /api/matriculas/:id` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `matriculas.view` |
| create | `POST /api/matriculas/` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `matriculas.create` |
| update | `PATCH /api/matriculas/:id` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `matriculas.edit` |
| remove | `DELETE /api/matriculas/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `matriculas.delete` |
| setEstado | `POST /api/matriculas/:id/estado` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `matriculas.cambiar_estado` |
| uploadDoc | `POST /api/matriculas/:id/doc/:tipo` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `matriculas.edit` |

## mcp

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| estado | `GET /api/mcp/panel/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| crearToken | `POST /api/mcp/panel/tokens` | sesión · a mano: mcp.acceso.js · puedeUsarMcp | superadmin, admin y gestor/soporte/project_manager con «usa_mcp» | `mcp.usar` |
| revocarToken | `DELETE /api/mcp/panel/tokens/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| crearCodigo | `POST /api/mcp/panel/codigo` | sesión · a mano: mcp.acceso.js · puedeUsarMcp | superadmin, admin y gestor/soporte/project_manager con «usa_mcp» | `mcp.usar` |
| desbloquearUrl | `POST /api/mcp/panel/tokens/:id/desbloquear` | sesión · a mano: mcp.acceso.js · puedeUsarMcp | superadmin, admin y gestor/soporte/project_manager con «usa_mcp» | `mcp.usar` |
| decidirConexion | `PATCH /api/mcp/panel/conexiones/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| personas | `GET /api/mcp/panel/personas` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `mcp.administrar` |
| cambiarAcceso | `PATCH /api/mcp/panel/personas/:id` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `mcp.administrar` |
| actividad | `GET /api/mcp/panel/actividad` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `mcp.administrar` |
| interruptor | `POST /api/mcp/panel/interruptor` | sesión · soloRoles(superadmin) | superadmin | `mcp.supervisar` |
| (anónima) | `GET /api/mcp/oauth/recurso/mcp/u/:secreto` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `GET /api/mcp/oauth/metadatos` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `GET /api/mcp/oauth/.well-known/oauth-authorization-server` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `GET /api/mcp/oauth/.well-known/openid-configuration` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `POST /api/mcp/oauth/register` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `GET /api/mcp/oauth/authorize` | nada (pública) | cualquiera, sin sesión | — |
| (anónima) | `POST /api/mcp/oauth/token` | nada (pública) | cualquiera, sin sesión | — |
| atenderPeticion | `POST /api/mcp/` | a mano: mcp.acceso.js · puedeUsarMcp | cualquiera, sin sesión | `mcp.usar` |
| metodoNoPermitido | `GET /api/mcp/` | nada (pública) | cualquiera, sin sesión | — |
| metodoNoPermitido | `DELETE /api/mcp/` | nada (pública) | cualquiera, sin sesión | — |
| atenderPeticion | `POST /api/mcp/u/:secreto` | a mano: mcp.acceso.js · puedeUsarMcp | cualquiera, sin sesión | `mcp.usar` |
| metodoNoPermitido | `GET /api/mcp/u/:secreto` | nada (pública) | cualquiera, sin sesión | — |
| metodoNoPermitido | `DELETE /api/mcp/u/:secreto` | nada (pública) | cualquiera, sin sesión | — |
| decidirConexion · rechazar un Claude conectado a la URL de otra persona | `PATCH /api/mcp/panel/conexiones/:id` | cuando rechazar un Claude conectado a la URL de otra persona: a mano, mcp.conexiones.js · decidir | superadmin | `mcp.supervisar` |

## messages

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listConversations | `GET /api/mensajes/conversations` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| unreadCount | `GET /api/mensajes/conversations/unread-count` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| createConversation | `POST /api/mensajes/conversations` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| listMessages | `GET /api/mensajes/conversations/:id/messages` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| sendMessage | `POST /api/mensajes/conversations/:id/messages` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| markRead | `PATCH /api/mensajes/conversations/:id/read` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| typing | `POST /api/mensajes/conversations/:id/typing` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| getTyping | `GET /api/mensajes/conversations/:id/typing` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| deleteMessage | `DELETE /api/mensajes/messages/:msgId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| availableUsers | `GET /api/mensajes/users/available` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |
| onlineUsers | `GET /api/mensajes/users/online` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `mensajes.usar` |

## meta-ads

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listAccounts | `GET /api/meta-ads/accounts` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| getAccount | `GET /api/meta-ads/account` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| connect | `POST /api/meta-ads/connect` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · deSusCampus (campus) | superadmin, admin, soporte | `meta_ads.edit` |
| updateToken | `PATCH /api/meta-ads/accounts/:accountId/token` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `meta_ads.edit` |
| disconnect | `DELETE /api/meta-ads/accounts/:accountId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `meta_ads.edit` |
| syncNow | `POST /api/meta-ads/accounts/:accountId/sync` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `meta_ads.edit` |
| backfill | `POST /api/meta-ads/accounts/:accountId/backfill` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `meta_ads.edit` |
| listCampaigns | `GET /api/meta-ads/campaigns` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| campaignDetail | `GET /api/meta-ads/campaigns/:campaignId` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| listAdSets | `GET /api/meta-ads/campaigns/:campaignId/adsets` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| listAds | `GET /api/meta-ads/adsets/:adsetId/ads` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| dashboard | `GET /api/meta-ads/dashboard` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| listAssociations | `GET /api/meta-ads/associations` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| setAssociations | `POST /api/meta-ads/associations` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · deSusCampus (campus) | superadmin, admin, soporte | `meta_ads.edit` |
| listAdSetAssociations | `GET /api/meta-ads/adset-associations` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| setAdSetAssociations | `POST /api/meta-ads/adset-associations` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · deSusCampus (campus) | superadmin, admin, soporte | `meta_ads.edit` |
| getRoi | `GET /api/meta-ads/roi` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |
| getProductsView | `GET /api/meta-ads/products-view` | sesión · rol (admin, superadmin, soporte) o permiso meta_ads.view · deSusCampus (campus) | superadmin, admin, soporte y quien tenga el permiso por rol a medida o excepción | `meta_ads.view` |

## notifications

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/notifications/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| unreadCount | `GET /api/notifications/unread-count` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| markRead | `PATCH /api/notifications/:id/read` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| markAllRead | `PATCH /api/notifications/mark-all-read` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |

## novedades

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listar | `GET /api/novedades/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `novedades.view` |
| pdf | `GET /api/novedades/:version/pdf` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `novedades.view` |
| envios | `GET /api/novedades/:version/envios` | sesión · roleGuard(superadmin, soporte, admin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `novedades.envios` |
| enviar | `POST /api/novedades/:version/enviar` | sesión · roleGuard(superadmin, soporte) +superadmin +soporte por el atajo | superadmin, soporte | `novedades.enviar` |

## payroll

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listPlans | `GET /api/payroll/plans` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.view` |
| upsertPlan | `PUT /api/payroll/plans` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.edit` |
| deletePlan | `DELETE /api/payroll/plans/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.delete` |
| listHours | `GET /api/payroll/hours` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.view` |
| createHours | `POST /api/payroll/hours` | sesión · roleGuard(admin, superadmin, gestor) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `payroll.create` |
| deleteHours | `DELETE /api/payroll/hours/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.delete` |
| listPeriods | `GET /api/payroll/periods` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.view` |
| getPeriod | `GET /api/payroll/periods/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.view` |
| generatePeriod | `POST /api/payroll/periods/generate` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.edit` |
| closePeriod | `POST /api/payroll/periods/:id/close` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.edit` |
| payPeriod | `POST /api/payroll/periods/:id/pay` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.edit` |
| addAdjustment | `POST /api/payroll/adjustments` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.edit` |
| deleteAdjustment | `DELETE /api/payroll/adjustments/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `payroll.delete` |

## permissions

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getCatalogo | `GET /api/permissions/catalogo` | (no existía) | (ruta nueva) | lo de cada uno |
| getSystemDefaults | `GET /api/permissions/system-defaults` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| roles | `GET /api/permissions/roles` | (no existía) | (ruta nueva) | `roles.view` |
| guardarRolFijo | `PUT /api/permissions/roles/fijos/:rol` | (no existía) | (ruta nueva) | `roles.edit` |
| crearRolAMedida | `POST /api/permissions/roles/a-medida` | (no existía) | (ruta nueva) | `roles.edit` |
| guardarRolAMedida | `PATCH /api/permissions/roles/a-medida/:id` | (no existía) | (ruta nueva) | `roles.edit` |
| registro | `GET /api/permissions/registro` | (no existía) | (ruta nueva) | `roles.edit` |
| ficha | `GET /api/permissions/personas/:id` | (no existía) | (ruta nueva) | lo de cada uno |
| guardarExcepciones | `PUT /api/permissions/personas/:id/excepciones` | (no existía) | (ruta nueva) | `users.excepciones` |
| cambiarRolAMedida | `PUT /api/permissions/personas/:id/rol-a-medida` | (no existía) | (ruta nueva) | `users.excepciones` |
| listCustomRoles | `GET /api/permissions/custom-roles` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `roles.view` |
| getCustomRole | `GET /api/permissions/custom-roles/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `roles.view` |
| createCustomRole | `POST /api/permissions/custom-roles` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `roles.edit` |
| updateCustomRole | `PUT /api/permissions/custom-roles/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `roles.edit` |
| deleteCustomRole | `DELETE /api/permissions/custom-roles/:id` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `roles.edit` |
| getUserPermissions | `GET /api/permissions/users/:userId/permissions` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.excepciones` |
| saveUserPermissions | `PUT /api/permissions/users/:userId/permissions` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.excepciones` |
| getRolePermissions | `GET /api/permissions/role-permissions/:roleKey` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `roles.view` |
| saveRolePermissions | `PUT /api/permissions/role-permissions/:roleKey` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `roles.edit` |
| getClaveDeRol | `GET /api/permissions/claves/:clave/rol/:roleKey` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `roles.view` |
| setClaveDeRol | `PUT /api/permissions/claves/:clave/rol/:roleKey` | sesión · soloRoles(superadmin) | superadmin | `roles.edit` |
| personasDeLaClave | `GET /api/permissions/claves/:clave/personas` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `users.excepciones` |
| setClaveDePersona | `PUT /api/permissions/claves/:clave/personas/:userId` | sesión · soloRoles(superadmin, admin) | superadmin, admin | `users.excepciones` |
| getRoleView | `GET /api/permissions/role-views/:roleKey` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| setRoleView | `PUT /api/permissions/role-views/:roleKey` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `roles.edit` |

## proceso

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listarPasos | `GET /api/proceso/pasos` | sesión · ambitoDelProceso (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| crearPaso | `POST /api/proceso/pasos` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · ambitoDelProceso (campus) | superadmin, admin, soporte | `proceso.configurar_pasos` |
| reordenarPasos | `PATCH /api/proceso/pasos/orden` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · ambitoDelProceso (campus) | superadmin, admin, soporte | `proceso.configurar_pasos` |
| editarPaso | `PATCH /api/proceso/pasos/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · ambitoDelProceso (campus) | superadmin, admin, soporte | `proceso.configurar_pasos` |
| desactivarPaso | `DELETE /api/proceso/pasos/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · ambitoDelProceso (campus) | superadmin, admin, soporte | `proceso.configurar_pasos` |
| cola | `GET /api/proceso/cola` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| resumenCola | `GET /api/proceso/cola/resumen` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| seguimiento | `GET /api/proceso/seguimiento` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| resumenSeguimiento | `GET /api/proceso/seguimiento/resumen` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| wasapiSeguimiento | `GET /api/proceso/seguimiento/wasapi` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| pasosDeUnLead | `GET /api/proceso/lead/:leadId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.view` |
| replanificar | `POST /api/proceso/lead/:leadId/replanificar` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `proceso.replanificar` |
| ajustarPasoDeLead | `PATCH /api/proceso/paso-lead/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.trabajar` |
| anadirSeguimientoDeLead | `POST /api/proceso/lead/:leadId/seguimiento` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `proceso.trabajar` |

## product-categories

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getTree | `GET /api/product-categories/tree` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| listByProject | `GET /api/product-categories/project/:projectId` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| getAncestors | `GET /api/product-categories/:id/ancestors` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| create | `POST /api/product-categories/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `products.categorias` |
| update | `PATCH /api/product-categories/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `products.categorias` |
| remove | `DELETE /api/product-categories/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `products.categorias` |

## products

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/products/` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| exportAll | `GET /api/products/export` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.export` |
| leadsStats | `GET /api/products/leads-stats` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| getById | `GET /api/products/:id` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| getImageUrl | `GET /api/products/:id/image-url` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| create | `POST /api/products/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.create` |
| update | `PATCH /api/products/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| deactivate | `DELETE /api/products/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.delete` |
| uploadImage | `POST /api/products/:id/image` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| removeImage | `DELETE /api/products/:id/image` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| listModules | `GET /api/products/:id/modules` | sesión · projectAccess (campus) | superadmin, admin, gestor, soporte, project_manager, tutor | `products.view` |
| createModule | `POST /api/products/:id/modules` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| updateModule | `PATCH /api/products/:id/modules/:moduleId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| deleteModule | `DELETE /api/products/:id/modules/:moduleId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |
| reorderModules | `POST /api/products/:id/modules/reorder` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · projectAccess (campus) | superadmin, admin, soporte | `products.edit` |

## project-channels

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/project-channels/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `channels.view` |
| create | `POST /api/project-channels/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `channels.edit` |
| update | `PATCH /api/project-channels/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `channels.edit` |
| remove | `DELETE /api/project-channels/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `channels.edit` |

## projects

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getCatalog | `GET /api/projects/shortcuts/catalog` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `projects.view` |
| listSociedades | `GET /api/projects/sociedades` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `projects.view` |
| createSociedad | `POST /api/projects/sociedades` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `projects.create` |
| list | `GET /api/projects/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `projects.view` |
| getById | `GET /api/projects/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `projects.view` |
| create | `POST /api/projects/` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `projects.create` |
| update | `PATCH /api/projects/:id` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `projects.edit` |
| regenerateKey | `POST /api/projects/:id/regenerate-webhook-key` | sesión · roleGuard(superadmin) +superadmin +soporte por el atajo | superadmin, soporte | `projects.edit` |
| getQueueState | `GET /api/projects/:id/queue-state` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `projects.view` |

## registro

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listar | `GET /api/registro/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `registro.view` |
| fuentes | `GET /api/registro/fuentes` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `registro.view` |
| csv | `GET /api/registro/csv` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `registro.view` |

## reports

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| overview | `GET /api/informes/overview` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `reports.view` |
| (anónima) | `GET /api/informes/resumen-mensual` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/prospectos` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/ventas` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/general` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/general-facturacion` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/cobros-mensuales` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| (anónima) | `GET /api/informes/ventas-vendedora` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| ventasAsesora | `GET /api/informes/ventas-asesora` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| asesorasMes | `GET /api/informes/asesoras-mes` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| miPuesto | `GET /api/informes/mi-puesto` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| panel | `GET /api/informes/panel` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| seguimiento | `GET /api/informes/seguimiento` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| paises | `GET /api/informes/paises` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| formaciones | `GET /api/informes/formaciones` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| detalle | `GET /api/informes/detalle` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| avisoSinFactura | `GET /api/informes/aviso-sin-factura` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| tasaCierre | `GET /api/informes/tasa-cierre` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| tasaCierreDetalle | `GET /api/informes/tasa-cierre/detalle` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `reports.mis_informes` |
| miPuesto · ver el puesto de otra gestora (gestoraId) | `GET /api/informes/mi-puesto` | cuando ver el puesto de otra gestora (gestoraId): a mano, report.controller.js · miPuesto | superadmin, admin, soporte | `reports.puesto_ajeno` |

## sales

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| create | `POST /api/ventas/` | sesión · roleGuard(gestor, admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, gestor, soporte | `ventas.registrar` |
| resumenVentas | `GET /api/ventas/resumen` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `ventas.view_equipo` |
| ventasPorAsesora | `GET /api/ventas/por-asesora` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `ventas.view_equipo` |
| ventasPorCliente | `GET /api/ventas/por-cliente` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| topProducts | `GET /api/ventas/top-products` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| facturado | `GET /api/ventas/facturado` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| gestoresStats | `GET /api/ventas/gestores-stats` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `ventas.view_equipo` |
| desglose | `GET /api/ventas/desglose` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| paises | `GET /api/ventas/paises` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| serieVentas | `GET /api/ventas/serie` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| myStats | `GET /api/ventas/my-stats` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.view` |
| setGoal | `POST /api/ventas/goals` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.metas` |
| deleteGoal | `DELETE /api/ventas/goals/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `ventas.metas` |
| create · registrar una venta que no es de nadie («sin gestora») | `POST /api/ventas/` | cuando registrar una venta que no es de nadie («sin gestora»): a mano, sales.controller.js · resolvePermission(conversions.sin_gestora) | superadmin, admin | `conversions.sin_gestora` |

## status

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getStatus | `GET /api/status/` | nada (pública) | cualquiera, sin sesión | — |
| getIncidents | `GET /api/status/incidents` | nada (pública) | cualquiera, sin sesión | — |
| createIncident | `POST /api/status/incidents` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.edit` |
| updateIncident | `PUT /api/status/incidents/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.edit` |
| updateComponent | `PUT /api/status/components/:slug` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.edit` |
| getErrors | `GET /api/status/errors` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.view` |
| getPiezas | `GET /api/status/piezas` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.view` |
| getCorreos | `GET /api/status/correos` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `status.view` |

## stripe-payments

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| list | `GET /api/stripe-payments/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `stripe.view` |
| stats | `GET /api/stripe-payments/stats` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `stripe.view` |
| sync | `POST /api/stripe-payments/sync` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `stripe.view` |
| getOne | `GET /api/stripe-payments/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `stripe.view` |
| link | `POST /api/stripe-payments/:id/link` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `stripe.edit` |
| unlink | `DELETE /api/stripe-payments/:id/link` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `stripe.edit` |
| updateDispute | `PATCH /api/stripe-payments/:id/dispute` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `stripe.edit` |
| webhook | `POST /api/stripe-webhook/:projectId` | nada (pública) | cualquiera, sin sesión | — |

## tasks

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| (anónima) | `GET /api/tasks/metrics` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/metrics/areas` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/assignees` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/tags` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/review` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/review/count` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/teams` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/teams/mine` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/teams/empresas` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/teams` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/teams/:teamId` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/teams/:teamId` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/teams/:teamId/roles` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/teams/:teamId/roles/:roleId` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/teams/:teamId/candidates` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PUT /api/tasks/teams/:teamId/members/:userId` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/teams/:teamId/members/:userId` | (no existía) | (ruta nueva) | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/columns` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/columns` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/columns/reorder` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/columns/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/columns/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/areas` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/areas` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/areas/assignments` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/areas/user/:userId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PUT /api/tasks/areas/user/:userId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/areas/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PUT /api/tasks/areas/:id/members` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/external-projects` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/external-projects` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/external-projects/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `GET /api/tasks/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/:id/move` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/:id/return` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/:id/approve` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/:id` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/:id/checklist` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `PATCH /api/tasks/:id/checklist/:itemId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/:id/checklist/:itemId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/:id/comments` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/:id/comments/:commentId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/:id/tags` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/:id/tags/:tagId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `POST /api/tasks/:id/links` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |
| (anónima) | `DELETE /api/tasks/:id/links/:linkId` | sesión · soloRoles(superadmin, admin, colaborador) | superadmin, admin, colaborador | `tasks.view_own` o `tasks.view_all` |

## tutores

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| colaboraciones | `GET /api/tutores/colaboraciones` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| crearColaboracion | `POST /api/tutores/colaboraciones` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| editarColaboracion | `PATCH /api/tutores/colaboraciones/:id` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| borrarColaboracion | `DELETE /api/tutores/colaboraciones/:id` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| ajustes | `GET /api/tutores/ajustes` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| guardarAjustes | `PATCH /api/tutores/ajustes` | sesión · a mano: tutor.controller.js | superadmin, admin | `tutores.ajustes` |
| simulacion | `GET /api/tutores/simulacion` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| calcular | `POST /api/tutores/comisiones/calcular` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| resumenComisiones | `GET /api/tutores/comisiones/resumen` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| listarComisiones | `GET /api/tutores/comisiones` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| liquidar | `POST /api/tutores/comisiones/liquidar` | sesión · a mano: tutor.controller.js | superadmin, admin | `tutores.liquidar` |
| cambiarEstadoComision | `PATCH /api/tutores/comisiones/:id/estado` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| revertirComision | `POST /api/tutores/comisiones/:id/revertir` | sesión · a mano: tutor.controller.js | superadmin, admin | `tutores.liquidar` |
| formacionesSinTutor | `GET /api/tutores/formaciones-sin-tutor` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| pagosSinFormacion | `GET /api/tutores/pagos-sin-formacion` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| marcarBusqueda | `PUT /api/tutores/formaciones/:productId/busqueda` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| anunciosDeTutores | `GET /api/tutores/anuncios` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| cursoDetalle | `GET /api/tutores/curso/:productId` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| brochureDelCurso | `GET /api/tutores/curso/:productId/brochure` | sesión · a mano: tutor.controller.js · esTutor \|\| exigirGestion | superadmin, admin, tutor y gestor/soporte/project_manager con «gestor_colaboraciones» | `tutores.mis_cursos` o `tutores.gestionar` |
| listar | `GET /api/tutores/` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| alta | `POST /api/tutores/` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| ficha | `GET /api/tutores/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| guardarPerfil | `PATCH /api/tutores/:id/perfil` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| cambiarCobraDesde | `PATCH /api/tutores/:id/cobra-desde` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| cambiarContrasena | `POST /api/tutores/:id/contrasena` | sesión · a mano: tutor.controller.js | superadmin, admin | `tutores.contrasena` |
| reactivarTutor | `POST /api/tutores/:id/reactivar` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| retirarTutor | `DELETE /api/tutores/:id` | sesión · a mano: tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| ficha · la ficha de otro tutor (la suya, el tutor siempre) | `GET /api/tutores/:id` | cuando la ficha de otro tutor (la suya, el tutor siempre): a mano, tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| guardarPerfil · la ficha de otro tutor (la suya, el tutor siempre) | `PATCH /api/tutores/:id/perfil` | cuando la ficha de otro tutor (la suya, el tutor siempre): a mano, tutor.controller.js · exigirGestion | superadmin, admin y gestor/soporte/project_manager/tutor con «gestor_colaboraciones» | `tutores.gestionar` |
| guardarPerfil · cambiar el correo del tutor | `PATCH /api/tutores/:id/perfil` | cuando cambiar el correo del tutor: a mano, tutor.controller.js · guardarPerfil | superadmin | `tutores.cambiar_correo` |

## users

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getAvatar | `GET /api/users/:id/avatar` | nada (pública) | cualquiera, sin sesión | — |
| uploadAvatar | `POST /api/users/:id/avatar` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| deleteAvatar | `DELETE /api/users/:id/avatar` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| getViews | `GET /api/users/:id/views` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| setViews | `PATCH /api/users/:id/views` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| misAvisos | `GET /api/users/mis-avisos` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| cambiarMiAviso | `PATCH /api/users/mis-avisos` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor, colaborador | lo de cada uno |
| list | `GET /api/users/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.view` |
| activityLog | `GET /api/users/activity-log` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.view` |
| listAvailability | `GET /api/users/availability` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.view` |
| deleteBlock | `DELETE /api/users/availability-blocks/:blockId` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.edit` |
| getById | `GET /api/users/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.view` |
| create | `POST /api/users/` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.create` |
| update | `PATCH /api/users/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.edit` |
| deactivate | `DELETE /api/users/:id` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.delete` |
| reactivate | `PATCH /api/users/:id/reactivate` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.edit` |
| setPassword | `PATCH /api/users/:id/password` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · a mano: user.controller.js · setPassword | superadmin, admin | `users.contrasena` |
| avisoCorreo | `GET /api/users/:id/aviso-correo` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo · soloRoles(superadmin) | superadmin | `users.aviso_correo` |
| setAvailability | `PATCH /api/users/:id/availability` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.edit` |
| listBlocks | `GET /api/users/:id/availability-blocks` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.view` |
| createBlock | `POST /api/users/:id/availability-blocks` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `users.edit` |
| create · dar empresas enteras a un admin, o cambiar el correo de alguien | `POST /api/users/` | cuando dar empresas enteras a un admin, o cambiar el correo de alguien: a mano, user.controller.js · create/update | superadmin | `users.empresas` |
| update · dar empresas enteras a un admin, o cambiar el correo de alguien | `PATCH /api/users/:id` | cuando dar empresas enteras a un admin, o cambiar el correo de alguien: a mano, user.controller.js · create/update | superadmin | `users.empresas` |
| update · cambiar el rol, los roles de más o «se dedica a colaboraciones» de alguien | `PATCH /api/users/:id` | (no existía) | (ruta nueva) | `users.excepciones` |

## webhook-tokens

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| publicReceive | `POST /api/webhook-tokens/receive/:token` | nada (pública) | cualquiera, sin sesión | — |
| list | `GET /api/webhook-tokens/` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `webhooks.view` |
| getStatus | `GET /api/webhook-tokens/:id/status` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `webhooks.view` |
| create | `POST /api/webhook-tokens/` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `webhooks.create` |
| update | `PATCH /api/webhook-tokens/:id` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `webhooks.edit` |
| remove | `DELETE /api/webhook-tokens/:id` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `webhooks.delete` |
| startListening | `POST /api/webhook-tokens/:id/listen` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `webhooks.edit` |
| stopListening | `POST /api/webhook-tokens/:id/listen/stop` | sesión · roleGuard(admin, superadmin, soporte) +superadmin +soporte por el atajo | superadmin, admin, soporte | `webhooks.edit` |

## webhooks-salientes

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| listar | `GET /api/webhooks-salientes/` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.view` |
| ejemplo | `GET /api/webhooks-salientes/ejemplo` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.view` |
| envios | `GET /api/webhooks-salientes/envios` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.view` |
| reenviar | `POST /api/webhooks-salientes/envios/:envioId/reenviar` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.edit` |
| uno | `GET /api/webhooks-salientes/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.view` |
| crear | `POST /api/webhooks-salientes/` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.create` |
| cambiar | `PATCH /api/webhooks-salientes/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.edit` |
| borrar | `DELETE /api/webhooks-salientes/:id` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.delete` |
| prueba | `POST /api/webhooks-salientes/:id/prueba` | sesión · soloRoles(admin, superadmin) | superadmin, admin | `webhooks_salientes.edit` |
| crear · webhooks para todas las empresas | `POST /api/webhooks-salientes/` | cuando webhooks para todas las empresas: a mano, webhooks-salientes.controller.js · esSuperadmin | superadmin | `webhooks_salientes.todas` |
| cambiar · webhooks para todas las empresas | `PATCH /api/webhooks-salientes/:id` | cuando webhooks para todas las empresas: a mano, webhooks-salientes.controller.js · esSuperadmin | superadmin | `webhooks_salientes.todas` |

## whatsapp

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| webhook | `POST /api/whatsapp/webhook` | nada (pública) | cualquiera, sin sesión | — |
| verMedia | `GET /api/whatsapp/media/:mensajeId` | nada (pública) | cualquiera, sin sesión | — |
| listTemplates | `GET /api/whatsapp/templates` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `whatsapp.plantillas` |
| createTemplate | `POST /api/whatsapp/templates` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `whatsapp.plantillas` |
| updateTemplate | `PATCH /api/whatsapp/templates/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `whatsapp.plantillas` |
| deleteTemplate | `DELETE /api/whatsapp/templates/:id` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `whatsapp.plantillas` |
| cola | `GET /api/whatsapp/cola` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `whatsapp.cola` |
| usuarios | `GET /api/whatsapp/usuarios` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| formaDeAvisos | `GET /api/whatsapp/forma-avisos` | sesión · soloRoles(soporte, superadmin) | superadmin, soporte | `whatsapp.forma_avisos` |
| olvidarFormaDeAvisos | `DELETE /api/whatsapp/forma-avisos` | sesión · soloRoles(soporte, superadmin) | superadmin, soporte | `whatsapp.forma_avisos` |
| banco | `GET /api/whatsapp/banco` | sesión · a mano: chat.controller.js · sesionesQuePuedeMirar | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` o `whatsapp.supervisar` |
| bancoNumeros | `GET /api/whatsapp/banco/numeros` | sesión · a mano: chat.controller.js · sesionesQuePuedeMirar | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` o `whatsapp.supervisar` |
| etiquetasDeWhatsapp | `GET /api/whatsapp/etiquetas` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| chats | `GET /api/whatsapp/chats` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| abrirChat | `POST /api/whatsapp/chats` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| chat | `GET /api/whatsapp/chats/:id` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| ficha | `GET /api/whatsapp/chats/:id/ficha` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| enviar | `POST /api/whatsapp/chats/:id/enviar` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| adjunto | `POST /api/whatsapp/chats/:id/adjunto` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| traerHistorial | `POST /api/whatsapp/chats/:id/historial` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| reenviar | `POST /api/whatsapp/chats/:id/reenviar` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| noEscribir | `POST /api/whatsapp/chats/:id/no-escribir` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| etiquetarChat | `POST /api/whatsapp/chats/:id/etiqueta` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| registrarLlamada | `POST /api/whatsapp/chats/:id/llamada` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| descargarAdjunto | `POST /api/whatsapp/mensajes/:id/descargar` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| editarMensaje | `PATCH /api/whatsapp/mensajes/:id` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| conexion | `GET /api/whatsapp/conexion` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| sincronizacion | `GET /api/whatsapp/sincronizacion` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| reintentarArchivos | `POST /api/whatsapp/reintentar-archivos` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| emparejar | `POST /api/whatsapp/emparejar` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| desconectar | `POST /api/whatsapp/desconectar` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| sonando | `GET /api/whatsapp/sonando` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | lo de cada uno |
| sinLeer | `GET /api/whatsapp/sin-leer` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| respuestaLlamada | `GET /api/whatsapp/respuesta-llamada` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| guardarRespuestaLlamada | `POST /api/whatsapp/respuesta-llamada` | sesión · a mano: chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp) | superadmin, admin, gestor, soporte (salvo con «usa_whatsapp» apagado) | `whatsapp.usar` |
| chats · trabajar sobre la sesión de otra persona | `GET /api/whatsapp/chats` | cuando trabajar sobre la sesión de otra persona: a mano, chat.controller.js · usuarioObjetivo (usuarioId ajeno) | superadmin, admin | `whatsapp.supervisar` |
| chat · trabajar sobre la sesión de otra persona | `GET /api/whatsapp/chats/:id` | cuando trabajar sobre la sesión de otra persona: a mano, chat.controller.js · usuarioObjetivo (usuarioId ajeno) | superadmin, admin | `whatsapp.supervisar` |
| enviar · trabajar sobre la sesión de otra persona | `POST /api/whatsapp/chats/:id/enviar` | cuando trabajar sobre la sesión de otra persona: a mano, chat.controller.js · usuarioObjetivo (usuarioId ajeno) | superadmin, admin | `whatsapp.supervisar` |
| createTemplate · plantillas compartidas o de otra persona | `POST /api/whatsapp/templates` | cuando plantillas compartidas o de otra persona: a mano, whatsapp.controller.js · createTemplate/permitida | superadmin, admin, soporte | `whatsapp.plantillas_compartidas` |
| updateTemplate · plantillas compartidas o de otra persona | `PATCH /api/whatsapp/templates/:id` | cuando plantillas compartidas o de otra persona: a mano, whatsapp.controller.js · createTemplate/permitida | superadmin, admin, soporte | `whatsapp.plantillas_compartidas` |
| deleteTemplate · plantillas compartidas o de otra persona | `DELETE /api/whatsapp/templates/:id` | cuando plantillas compartidas o de otra persona: a mano, whatsapp.controller.js · createTemplate/permitida | superadmin, admin, soporte | `whatsapp.plantillas_compartidas` |

## widget

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getConfig | `GET /api/widget/config` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `widget.view` |
| pulsaciones | `GET /api/widget/pulsaciones` | (no existía) | (ruta nueva) | `widget.view` |
| updateConfig | `PATCH /api/widget/config` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `widget.edit` |
| updateUserPhone | `PATCH /api/widget/users/:userId/phone` | sesión | superadmin, admin, gestor, soporte, project_manager, tutor | `widget.edit` |
| widgetScript | `GET /api/w/whatsapp/:projectIdJs` | nada (pública) | cualquiera, sin sesión | — |
| widgetData | `GET /api/w/data/:projectIdJson` | nada (pública) | cualquiera, sin sesión | — |
| widgetClic | `POST /api/w/clic/:projectId` | (no existía) | (ruta nueva) | — |

## woocommerce

| Acción | Método y ruta | Qué la protegía | Quién podía | Permiso |
|---|---|---|---|---|
| getCreds | `GET /api/woocommerce/credentials` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.view` |
| upsertCreds | `PUT /api/woocommerce/credentials` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.edit` |
| deleteCreds | `DELETE /api/woocommerce/credentials` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.edit` |
| listMappings | `GET /api/woocommerce/mappings` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.view` |
| setMappings | `PUT /api/woocommerce/mappings` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.edit` |
| listRuns | `GET /api/woocommerce/runs` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.view` |
| getCurrentRun | `GET /api/woocommerce/runs/current` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.view` |
| importNow | `POST /api/woocommerce/runs/start` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.sync` |
| autoDiscoverCpts | `POST /api/woocommerce/auto-discover-cpts` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.sync` |
| previewWc | `GET /api/woocommerce/preview` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.view` |
| saveMapping | `PUT /api/woocommerce/mapping` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.edit` |
| scrapePreview | `POST /api/woocommerce/scrape-preview` | sesión · roleGuard(admin, superadmin) +superadmin +soporte por el atajo | superadmin, admin, soporte | `woocommerce.sync` |

# Catálogo de permisos

Cada permiso del CRM, agrupado como el menú (`backend/src/modules/permissions/catalogo.js`).
«De serie» son los roles fijos que lo traen; el superadmin los tiene todos. «Necesita» es
lo que pide para tener sentido (editar pide ver).

## Principal

### Prospectos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver prospectos | `leads.view` | Abrir la lista y la ficha de los prospectos (una gestora, solo los suyos). | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear prospectos | `leads.create` | Dar de alta prospectos, uno a uno o en bloque. | Admin, Gestora, Soporte, Project manager, Tutor | `leads.view` |
| Editar prospectos | `leads.edit` | Cambiar datos y estado, apuntar llamadas y recordatorios, fusionar fichas. | Admin, Gestora, Soporte, Project manager, Tutor | `leads.view` |
| Borrar prospectos | `leads.delete` | Borrar un prospecto suyo por prueba, spam o duplicado. | Admin, Soporte | `leads.view` |
| Borrar cualquier prospecto | `leads.delete_cualquiera` | Borrar por cualquier motivo, aunque no sea suyo o tenga ventas. | Admin, Soporte | `leads.delete`, `leads.view` |
| Recuperar prospectos borrados | `leads.restaurar` | Devolver a la lista un prospecto borrado. | Soporte | `leads.view` |
| Asignar prospectos | `leads.assign` | Cambiar la gestora de un prospecto y repartir los que no tienen. | Admin, Soporte | `leads.view` |
| Revisar duplicados | `leads.duplicados` | Ver la cola de posibles duplicados y decidir qué se hace con cada uno. | Admin, Soporte | `leads.view` |
| Marcar como spam | `leads.reportar_spam` | Avisar de que un prospecto es spam. | Admin, Soporte | `leads.view` |
| Ver avisos de spam | `leads.spam` | La lista de avisos de spam y cuántos hay. | Admin, Soporte | `leads.view` |
| Resolver avisos de spam | `leads.spam_resolver` | Dar por bueno o descartar un aviso de spam. | Soporte | `leads.spam`, `leads.view` |
| Escribir a un prospecto | `leads.enviar_correo` | Mandar un correo desde la ficha. | Admin, Gestora, Soporte, Project manager, Tutor | `leads.view` |
| Exportar para Wasapi | `leads.exportar_wasapi` | Descargar la lista de prospectos con el formato de Wasapi. | Admin, Gestora, Soporte, Project manager, Tutor | `leads.view` |
| Exportar la lista | `leads.export` | Descargar en CSV los prospectos que se ven en pantalla. (solo pantalla) | Admin | `leads.view` |

### Proceso comercial

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver la cola y el seguimiento | `proceso.view` | La cola del día, el seguimiento de fin de mes y los pasos de cada prospecto. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Trabajar la cola | `proceso.trabajar` | Marcar pasos hechos y añadir seguimientos a un prospecto. | Admin, Gestora, Soporte, Project manager, Tutor | `proceso.view` |
| Configurar los pasos | `proceso.configurar_pasos` | Crear, ordenar, editar y quitar los pasos del proceso. | Admin, Soporte | `proceso.view` |
| Replanificar un prospecto | `proceso.replanificar` | Volver a calcular los pasos de un prospecto desde hoy. | Admin, Soporte | `proceso.view` |

### Convocatorias

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver convocatorias | `convocatorias.view` | Las convocatorias, su embudo y a quién se le han ofrecido. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Ofrecer plaza | `convocatorias.ofrecer` | Ofrecer una convocatoria a un prospecto y apuntar su respuesta. | Admin, Gestora, Soporte, Project manager, Tutor | `convocatorias.view` |
| Crear convocatorias | `convocatorias.create` | Abrir una convocatoria nueva. | Admin, Soporte | `convocatorias.view` |
| Editar convocatorias | `convocatorias.edit` | Cambiar fechas, plazas y datos de una convocatoria. | Admin, Soporte | `convocatorias.view` |

### WhatsApp

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Usar su WhatsApp | `whatsapp.usar` | Enlazar su número y atender sus chats desde el CRM. · nunca: Tutor, Colaborador · nunca si su rol principal es: Tutor, Colaborador, Project manager | Admin, Gestora, Soporte |  |
| Supervisar el WhatsApp de otros | `whatsapp.supervisar` | Abrir la sesión de otra persona de sus campus y el banco de mensajes de todas. · nunca: Tutor, Colaborador | Admin |  |
| Ver la cola de WhatsApp | `whatsapp.cola` | Los prospectos que esperan respuesta por WhatsApp. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Sus plantillas | `whatsapp.plantillas` | Crear y usar sus propias plantillas de mensaje. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Plantillas compartidas | `whatsapp.plantillas_compartidas` | Crear y cambiar las plantillas de todo el equipo, y las de otras personas. | Admin, Soporte | `whatsapp.plantillas` |
| Forma de los avisos | `whatsapp.forma_avisos` | Ver y reiniciar cómo llegan los avisos de WhatsApp (diagnóstico). | Soporte |  |

### Ventas

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver sus ventas | `ventas.view` | Sus cifras: por cliente, por producto, facturado y su evolución. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Registrar una venta | `ventas.registrar` | Apuntar una venta nueva desde Ventas. | Admin, Gestora, Soporte | `ventas.view` |
| Ver las ventas del equipo | `ventas.view_equipo` | El resumen y las ventas por asesora de todo el equipo. | Admin, Soporte | `ventas.view` |
| Metas de venta | `ventas.metas` | Poner y quitar metas (una gestora, solo la suya). | Admin, Gestora, Soporte, Project manager, Tutor | `ventas.view` |

## Tareas

### Tablero de tareas

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver su tablero | `tasks.view_own` | Entrar al tablero y ver las tareas que tiene asignadas. | Admin, Colaborador |  |
| Ver todo el equipo | `tasks.view_all` | El tablero de cualquiera, «Todo el equipo» y las métricas. | Admin |  |
| Crear tareas | `tasks.create` | Crearse tareas. | Admin, Colaborador | `tasks.view_own` |
| Asignar tareas | `tasks.assign` | Asignar o reasignar tareas a otras personas. | Admin | `tasks.view_own` |
| Editar tareas | `tasks.edit` | Cambiar, mover y completar las tareas que puede ver. | Admin, Colaborador | `tasks.view_own` |
| Archivar tareas | `tasks.delete` | Archivar cualquier tarea y borrar comentarios ajenos. | Admin | `tasks.view_own` |
| Aprobar y cerrar | `tasks.close` | Aprobar, devolver, cerrar y reabrir tareas en «Por revisar». | Admin | `tasks.view_own` |
| Configurar el tablero | `tasks.manage` | Columnas, áreas y proyectos del tablero. | Admin | `tasks.view_own` |
| Gestionar equipos | `tasks.manage_teams` | Crear, renombrar y archivar equipos del tablero, sus cargos y quién está en cada uno. | Admin | `tasks.view_own` |

## Captación

### Email de seguimiento

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver secuencias | `email_sequences.view` | Las secuencias de correo y sus envíos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear secuencias | `email_sequences.create` | Montar una secuencia nueva. | Admin, Soporte | `email_sequences.view` |
| Editar secuencias | `email_sequences.edit` | Cambiar los correos y los tiempos de una secuencia. | Admin, Soporte | `email_sequences.view` |
| Borrar secuencias | `email_sequences.delete` | Quitar una secuencia. | Admin, Soporte | `email_sequences.view` |
| Lanzar y parar secuencias | `email_sequences.lanzar` | Poner a un prospecto en una secuencia o sacarlo. | Admin, Gestora, Soporte | `email_sequences.view` |

### Plantillas de correo

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver plantillas | `email_templates.view` | Las plantillas de correo y su vista previa. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear plantillas | `email_templates.create` | Una plantilla nueva. | Admin, Soporte | `email_templates.view` |
| Editar plantillas | `email_templates.edit` | Cambiar el texto de una plantilla. | Admin, Soporte | `email_templates.view` |
| Borrar plantillas | `email_templates.delete` | Quitar una plantilla. | Admin, Soporte | `email_templates.view` |

### Formularios

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver formularios | `forms.view` | Los formularios de la web y lo que han recibido. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear formularios | `forms.create` | Conectar un formulario nuevo. | Admin, Soporte | `forms.view` |
| Editar formularios | `forms.edit` | Cambiar un formulario y ponerlo a escuchar. | Admin, Soporte | `forms.view` |
| Borrar formularios | `forms.delete` | Quitar un formulario. | Admin, Soporte | `forms.view` |

### Make

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver escenarios de Make | `make.view` | Las entradas de Make y lo que han entregado. | Admin, Soporte |  |
| Crear entradas de Make | `make.create` | Una entrada nueva. | Admin, Soporte | `make.view` |
| Editar entradas de Make | `make.edit` | Cambiarla o renovar su secreto. | Admin, Soporte | `make.view` |
| Borrar entradas de Make | `make.delete` | Quitar una entrada. | Admin, Soporte | `make.view` |

### Webhooks de entrada

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver webhooks | `webhooks.view` | Los webhooks que reciben prospectos y su estado (de sus campus). | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear webhooks | `webhooks.create` | Un webhook nuevo. | Admin, Soporte | `webhooks.view` |
| Editar webhooks | `webhooks.edit` | Cambiarlo o ponerlo a escuchar. | Admin, Soporte | `webhooks.view` |
| Borrar webhooks | `webhooks.delete` | Quitar un webhook. | Admin, Soporte | `webhooks.view` |

### Widget web

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver el widget | `widget.view` | La configuración del botón de WhatsApp de la web. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Configurar el widget | `widget.edit` | Cambiar el botón y los teléfonos que salen en él. | Admin, Gestora, Soporte, Project manager, Tutor | `widget.view` |

## Publicidad

### Meta Ads

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver Meta Ads | `meta_ads.view` | Cuentas, campañas, anuncios y su rendimiento. | Admin, Soporte |  |
| Conectar y sincronizar Meta Ads | `meta_ads.edit` | Conectar cuentas, sincronizarlas y asociar campañas a productos. | Admin, Soporte | `meta_ads.view` |

## Catálogo

### Productos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver productos | `products.view` | El catálogo, sus categorías y sus módulos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear productos | `products.create` | Un producto nuevo. | Admin, Soporte | `products.view` |
| Editar productos | `products.edit` | Datos, imagen y módulos de un producto. | Admin, Soporte | `products.view` |
| Borrar productos | `products.delete` | Quitar un producto. | Admin, Soporte | `products.view` |
| Árbol de categorías | `products.categorias` | Crear, mover y quitar categorías. | Admin, Soporte | `products.view` |
| Exportar el catálogo | `products.export` | Descargar el catálogo. | Admin, Gestora, Soporte, Project manager, Tutor | `products.view` |

### Dossieres

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver dossieres | `dossiers.view` | Abrir el dossier de un producto y su historial. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Subir dossieres | `dossiers.upload` | Subir una versión nueva del dossier. | Admin, Soporte | `dossiers.view` |

### WooCommerce

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver WooCommerce | `woocommerce.view` | La conexión, el mapeo y las importaciones. | Admin, Soporte |  |
| Configurar WooCommerce | `woocommerce.edit` | Credenciales y mapeo de campos. | Admin, Soporte | `woocommerce.view` |
| Importar de WooCommerce | `woocommerce.sync` | Lanzar una importación de productos. | Admin, Soporte | `woocommerce.view` |

## Tutores

### Tutores

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Sus cursos y comisiones | `tutores.mis_cursos` | El tutor ve sus colaboraciones, sus cursos y sus comisiones. | Tutor |  |
| Gestionar colaboraciones | `tutores.gestionar` | Dar de alta tutores, asignarles cursos, calcular sus comisiones y ver las fichas de los de sus campus. | Admin |  |
| Liquidar comisiones | `tutores.liquidar` | Pagar o revertir las comisiones de un tutor (mueve dinero). | Admin | `tutores.gestionar` |
| Ajustes de comisiones | `tutores.ajustes` | Cambiar los porcentajes y reglas de las comisiones. | Admin | `tutores.gestionar` |
| Contraseña de un tutor | `tutores.contrasena` | Ponerle contraseña nueva a un tutor de sus campus. | Admin | `tutores.gestionar` |
| Correo de un tutor | `tutores.cambiar_correo` | Cambiar el correo de un tutor (es el de su factura). | solo superadmin | `tutores.gestionar` |

## Finanzas

### Caja

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver el dashboard de finanzas | `accounting.view` | La caja del mes. | Admin, Soporte |  |
| Cuentas por cobrar | `accounting.por_cobrar` | Lo pendiente de cobro (una gestora, lo suyo). | Admin, Gestora, Soporte |  |

### Conversiones

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver conversiones | `conversions.view` | Los que compraron, sus cobros y sus cuotas. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear conversiones | `conversions.create` | Registrar una conversión. | Admin, Gestora, Soporte, Project manager, Tutor | `conversions.view` |
| Editar conversiones | `conversions.edit` | Cambiar los datos de una conversión. | Admin, Gestora, Soporte, Project manager, Tutor | `conversions.view` |
| Borrar conversiones | `conversions.delete` | Quitar una conversión (una gestora, solo las suyas). | Admin, Gestora, Soporte, Project manager, Tutor | `conversions.view` |
| Cobros y cuotas | `conversions.cobros` | Apuntar cobros, generar y pagar cuotas. | Admin, Gestora, Soporte, Project manager, Tutor | `conversions.view` |
| Repartir una venta | `conversions.reparto` | Repartir una venta entre varias gestoras. | Admin | `conversions.view` |
| Devoluciones | `conversions.devoluciones` | Apuntar y quitar devoluciones. | Admin, Soporte | `conversions.view` |
| Venta sin gestora | `conversions.sin_gestora` | Registrar una venta que no es de nadie: no cuenta en el informe de ninguna gestora. | Admin | `conversions.view` |

### Facturación

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver facturas | `facturas.view` | Facturas, series, emisores y su PDF (una gestora, las suyas). | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear facturas | `facturas.create` | Hacer una factura o una proforma. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Completar datos y marcar entregada | `facturas.completar` | Rellenar los datos fiscales del cliente y marcarla entregada. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Enviar facturas | `facturas.enviar` | Mandar la factura al cliente. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Marcar cobrada | `facturas.cobrar` | Marcar una factura como cobrada. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Anular facturas | `facturas.anular` | Anular una factura sin emitir. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Emitir un borrador | `facturas.emitir_borrador` | Darle número a un borrador. | Admin, Gestora, Soporte, Project manager, Tutor | `facturas.view` |
| Poner número al cobrar | `facturas.emitir` | Que el cobro salga facturado y la proforma sin esperar visto bueno. | Admin | `facturas.view` |
| Corregir y abonar | `facturas.gestionar` | Corregir, abonar (rectificativa), asociar a una venta y borrar facturas (una gestora, las suyas). | Admin | `facturas.view` |
| Emitir desde la cola | `facturas.cola` | Emitir los cobros de la cola, cobrar proformas y mover la fecha «al día». | solo superadmin | `facturas.view` |
| Cambiar fechas | `facturas.editar_fechas` | Cambiar la fecha de emisión y de pago, sin tocar importes. | Admin | `facturas.view` |
| Editar facturas | `facturas.edit` | Cambiar cualquier dato de una factura. | Admin, Soporte | `facturas.view` |
| Configurar la facturación | `facturas.configurar` | Empresas emisoras, regímenes, plantillas, series y ajustes. | Admin, Soporte | `facturas.view` |

### Egresos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver egresos | `expenses.view` | Los gastos y sus comprobantes. | Admin, Soporte |  |
| Apuntar egresos | `expenses.create` | Un gasto nuevo con su comprobante. | Admin, Soporte | `expenses.view` |
| Editar egresos | `expenses.edit` | Cambiar un gasto. | Admin, Soporte | `expenses.view` |
| Borrar egresos | `expenses.delete` | Quitar un gasto. | Admin, Soporte | `expenses.view` |

### Cuentas por pagar

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver cuentas por pagar | `accounts_payable.view` | Lo pendiente de pago. | Admin, Soporte |  |
| Apuntar cuentas por pagar | `accounts_payable.create` | Una deuda nueva. | Admin, Soporte | `accounts_payable.view` |
| Editar y pagar | `accounts_payable.edit` | Cambiarla y apuntar pagos. | Admin, Soporte | `accounts_payable.view` |
| Borrar cuentas por pagar | `accounts_payable.delete` | Quitarla. | Admin, Soporte | `accounts_payable.view` |

### Comisiones del equipo

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver comisiones | `commissions.view` | Las comisiones del equipo comercial y sus reglas. | Admin, Soporte |  |
| Recalcular comisiones | `commissions.edit` | Volver a calcular la comisión de una venta. | Admin, Soporte | `commissions.view` |
| Pagar comisiones | `commissions.pagar` | Marcar una comisión como pagada. | Admin, Soporte | `commissions.view` |
| Reglas de comisión | `commissions.reglas` | Crear, cambiar y quitar las reglas. | Soporte | `commissions.view` |

### Nóminas

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver nóminas | `payroll.view` | Planes, horas y periodos. | Admin, Soporte |  |
| Apuntar horas | `payroll.create` | Registrar horas trabajadas. | Admin, Gestora, Soporte |  |
| Gestionar nóminas | `payroll.edit` | Planes, generar, cerrar y pagar periodos, ajustes. | Admin, Soporte | `payroll.view` |
| Borrar en nóminas | `payroll.delete` | Quitar planes, horas y ajustes. | Admin, Soporte | `payroll.view` |

### Pagos de Stripe

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver pagos de Stripe | `stripe.view` | Los cobros por Stripe, y traer los nuevos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Asociar pagos de Stripe | `stripe.edit` | Enlazar un pago con su venta y llevar las disputas. | Admin, Soporte | `stripe.view` |

### Facturas de colaboradores

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Subir su factura | `facturas_colaborador.subir` | «Mi factura»: el colaborador sube la suya del mes. | Colaborador |  |
| Ver las facturas | `facturas_colaborador.ver_todas` | Las facturas de los colaboradores de sus empresas. | Admin |  |
| Gestionar colaboradores | `facturas_colaborador.gestionar` | Dar de alta colaboradores y reenviarles el enlace. | Admin |  |
| Anular facturas de colaboradores | `facturas_colaborador.anular` | Anular una factura recibida. | Admin | `facturas_colaborador.ver_todas` |
| Pagar facturas de colaboradores | `facturas_colaborador.pagar` | Marcarlas pagadas con su justificante. | Admin | `facturas_colaborador.ver_todas` |

### Integraciones

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver integraciones | `integrations.view` | Los servicios conectados (Stripe, Brevo…). | Admin, Soporte |  |
| Configurar integraciones | `integrations.edit` | Conectarlos, probarlos y desconectarlos. | Admin, Soporte | `integrations.view` |

## Análisis

### Reportes

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver informes | `reports.mis_informes` | Los informes de ventas, prospectos y seguimiento (una gestora, los suyos). | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Ver el resumen general | `reports.view` | El resumen de todo el equipo. | Admin, Soporte |  |
| El puesto de otra gestora | `reports.puesto_ajeno` | Ver en qué puesto va otra gestora del ranking. | Admin, Soporte | `reports.mis_informes` |

### Feedback

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver feedback | `feedback.view` | El panel y las respuestas de los clientes. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Enviar la encuesta | `feedback.enviar` | Mandar, o no, la encuesta revisada a un cliente. | Admin, Gestora, Soporte, Project manager, Tutor | `feedback.view` |

## Clientes

### Clientes

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver clientes | `clients.view` | La lista de clientes. (solo pantalla) | Admin, Gestora, Soporte, Project manager |  |
| Vender a un cliente | `clients.create` | Registrar otra compra de un cliente. (solo pantalla) | Admin, Gestora, Project manager | `clients.view` |
| Editar clientes | `clients.edit` | Cambiar los datos de un cliente. (solo pantalla) | Admin, Gestora, Project manager | `clients.view` |
| Borrar clientes | `clients.delete` | Quitar un cliente. (solo pantalla) | Admin | `clients.view` |
| Exportar clientes | `clients.export` | Descargar en CSV los clientes que se ven. (solo pantalla) | Admin | `clients.view` |

### Matrículas

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver matrículas | `matriculas.view` | Las matrículas y sus documentos. | Admin, Gestora, Soporte |  |
| Crear matrículas | `matriculas.create` | Una matrícula nueva. | Admin, Gestora, Soporte | `matriculas.view` |
| Editar matrículas | `matriculas.edit` | Cambiar datos y subir documentos. | Admin, Gestora, Soporte | `matriculas.view` |
| Cambiar el estado | `matriculas.cambiar_estado` | Validar, rechazar o cerrar una matrícula. | Admin, Soporte | `matriculas.view` |
| Borrar matrículas | `matriculas.delete` | Quitar una matrícula. | Admin, Soporte | `matriculas.view` |

### Diplomas (Certifex)

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver diplomas | `diplomas.view` | La pantalla Diplomas en solo lectura (de sus campus). | Admin |  |
| Emitir diplomas | `diplomas.emit` | Revisar los datos (nombre, DNI, correo, formación), pasar a pendientes, aprobar y emitir, enviar el diploma al alumno y crear uno nuevo, en sus campus. Rechazar, corregir y revocar, no. | Admin |  |
| Ver emisiones y firmas | `diplomas.view_emisiones` | El historial de emisiones, las formaciones y las firmas. | Admin | `diplomas.view` |
| Aprobar y emitir | `diplomas.aprobar` | Aprobar, rechazar y emitir diplomas, y crear uno nuevo. | Admin | `diplomas.view` |
| Corregir diplomas | `diplomas.edit` | Corregir datos, subir la firma y sincronizar formaciones. | Admin | `diplomas.view` |
| Avisar al alumno | `diplomas.avisar` | Mandar el aviso de diploma emitido o rechazado. | Admin | `diplomas.view` |
| Revocar diplomas | `diplomas.revocar` | Anular un diploma ya emitido. | Admin | `diplomas.view` |
| Diploma para imprenta | `diplomas.imprenta` | Descargar el diploma en formato de imprenta. | Admin | `diplomas.view` |

### Consultas de Certifex

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver consultas | `certifex_consultas.view` | Lo que escriben los centros desde la web de Certifex. | Admin, Soporte |  |
| Responder consultas | `certifex_consultas.edit` | Marcar una consulta como atendida. | Admin, Soporte | `certifex_consultas.view` |

## Conexión

### MCP (Claude)

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Usar el MCP | `mcp.usar` | Conectar su Claude al CRM con su URL personal. · nunca: Tutor · nunca si su rol principal es: Tutor | Admin |  |
| Administrar el MCP | `mcp.administrar` | Dar o quitar el MCP a personas de sus campus y ver qué se ha consultado. | Admin |  |
| Apagar el MCP | `mcp.supervisar` | El interruptor de emergencia y rechazar conexiones ajenas. | solo superadmin |  |

### Conectores

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver conectores | `connectors.view` | Los conectores de sus campus. | Admin |  |
| Crear conectores | `connectors.create` | Un conector nuevo. | Admin | `connectors.view` |
| Editar conectores | `connectors.edit` | Cambiarlo, probarlo e importar. | Admin | `connectors.view` |
| Borrar conectores | `connectors.delete` | Quitar un conector. | Admin | `connectors.view` |
| Conectores de todo el sistema | `connectors.sistema` | Conectores que valen para todas las empresas. | solo superadmin | `connectors.view` |

### Webhooks de salida

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver webhooks de salida | `webhooks_salientes.view` | Los avisos que el CRM manda a otros sistemas y sus envíos. | Admin |  |
| Crear webhooks de salida | `webhooks_salientes.create` | Uno nuevo. | Admin | `webhooks_salientes.view` |
| Editar webhooks de salida | `webhooks_salientes.edit` | Cambiarlo, probarlo y reenviar. | Admin | `webhooks_salientes.view` |
| Borrar webhooks de salida | `webhooks_salientes.delete` | Quitarlo. | Admin | `webhooks_salientes.view` |
| Para todas las empresas | `webhooks_salientes.todas` | Webhooks que valen para todas las empresas. | solo superadmin | `webhooks_salientes.view` |

## Sistema

### Novedades

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver novedades | `novedades.view` | Lo que trae cada versión del CRM. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Ver a quién llegó | `novedades.envios` | A quién se ha mandado cada versión. | Admin, Soporte | `novedades.view` |
| Mandar novedades | `novedades.enviar` | Mandar el correo de una versión. | Soporte | `novedades.view` |

### Mensajes internos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Usar los mensajes | `mensajes.usar` | Escribirse con el resto del equipo. | Admin, Gestora, Soporte, Project manager, Tutor |  |

### Solicitudes de cambio

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver solicitudes | `change_requests.view` | Las solicitudes de cambio y sus adjuntos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Pedir un cambio | `change_requests.create` | Abrir una solicitud. | Admin, Gestora, Soporte, Project manager, Tutor | `change_requests.view` |
| Editar solicitudes | `change_requests.edit` | Cambiarla y adjuntar. | Admin, Gestora, Soporte, Project manager, Tutor | `change_requests.view` |
| Aprobar solicitudes | `change_requests.approve` | Firmar la aprobación. | Admin, Gestora, Soporte, Project manager, Tutor | `change_requests.view` |
| Borrar solicitudes | `change_requests.delete` | Quitar una solicitud. | Admin, Soporte, Project manager | `change_requests.view` |
| Reabrir solicitudes | `change_requests.reopen` | Volver a abrir una cerrada. | Admin, Soporte, Project manager | `change_requests.view` |

### Registro

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver el registro | `registro.view` | Quién cambió qué y cuándo. | Admin, Soporte |  |

### Estado del sistema

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver el estado | `status.view` | Errores, piezas y correos del sistema. | Admin, Soporte |  |
| Apuntar incidencias | `status.edit` | Abrir y cerrar incidencias y cambiar el estado de cada pieza. | Admin, Soporte | `status.view` |

### Claves y variables

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver claves | `credentials.view` | Qué claves hay, sin verlas, y su registro. | Soporte |  |
| Guardar claves | `credentials.edit` | Guardar, probar y quitar claves de servicios. | Soporte | `credentials.view` |

### Documentos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver documentos | `documents.view` | Los documentos generados y descargarlos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Generar documentos | `documents.create` | Generar, regenerar y reenviar documentos. | Admin, Soporte | `documents.view` |
| Numeración | `documents.numeracion` | Ver y cambiar el siguiente número. | Admin, Soporte | `documents.view` |
| Borrar documentos | `documents.delete` | Quitar un documento. | Admin, Soporte | `documents.view` |
| Auditoría de documentos | `documents.auditar` | Quién generó y descargó cada documento. | Soporte | `documents.view` |

## Configuración

### Usuarios

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver usuarios | `users.view` | La lista del equipo y su disponibilidad. | Admin, Soporte |  |
| Crear usuarios | `users.create` | Dar de alta a alguien (con su bienvenida por correo). | Admin, Soporte | `users.view` |
| Editar usuarios | `users.edit` | Datos, campus, disponibilidad y reactivar. | Admin, Soporte | `users.view` |
| Desactivar usuarios | `users.delete` | Dar de baja a alguien. | Admin, Soporte | `users.view` |
| Permisos de cada persona | `users.excepciones` | Dar o quitar permisos sueltos a personas de sus campus, y su rol a medida. | Admin | `users.view` |
| Contraseña de otros | `users.contrasena` | Ponerle contraseña a otra persona (un admin, a tutores de sus campus). | Admin | `users.view` |
| Empresas enteras y correos | `users.empresas` | Dar empresas enteras a un admin y cambiar el correo de alguien. | solo superadmin | `users.view` |
| Aviso de cambio de correo | `users.aviso_correo` | Ver el aviso que recibe quien cambia de correo. | solo superadmin | `users.view` |

### Roles y permisos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver roles | `roles.view` | Qué trae cada rol y los roles a medida. | Admin |  |
| Cambiar roles | `roles.edit` | Cambiar lo que trae un rol fijo y crear o cambiar roles a medida (para todas las empresas), sin darles lo que uno no tiene. | Admin | `roles.view` |

### Proyectos

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver proyectos | `projects.view` | Los campus, sus empresas y sus atajos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Crear proyectos | `projects.create` | Un campus o una empresa nueva. | Soporte | `projects.view` |
| Configurar proyectos | `projects.edit` | Datos de un campus y su clave de webhook. | Soporte | `projects.view` |

### Canales

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver canales | `channels.view` | Los canales de entrada de cada campus. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Configurar canales | `channels.edit` | Crear, cambiar y quitar canales. | Admin, Soporte | `channels.view` |

### Campos personalizados

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver campos | `field_defs.view` | Los campos de más de cada campus. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Configurar campos | `field_defs.edit` | Crear, ordenar y quitar campos. | Admin, Soporte | `field_defs.view` |

### Instalación

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Ver la instalación | `installation.view` | Qué módulos del CRM están encendidos. | Admin, Gestora, Soporte, Project manager, Tutor |  |
| Encender módulos | `installation.edit` | Encender y apagar módulos del CRM. | Soporte | `installation.view` |

### Su cuenta

| Permiso | Clave | Qué deja hacer | De serie | Necesita |
|---|---|---|---|---|
| Cambiar su correo | `cuenta.cambiar_correo` | Cambiar el correo con el que entra (el de su factura). | Tutor |  |

## Dentro del código, que ya preguntan a un permiso

| Módulo | Dónde | Qué decide |
|---|---|---|
| tasks | tasks.service.js · permisosDe (buildPermissionsMap) | cada acción del tablero mira su clave tasks.* (ver todo, ver lo suyo, crear, asignar, editar, borrar, aprobar, configurar) |

## Alcance: sobre qué datos (no son permisos)

| Módulo | Dónde | Qué decide |
|---|---|---|
| leads | lead.controller.js · list, quickCounts, revisar, stats, exportWasapi, exigirQueSeaSuyo | la gestora solo ve y toca sus prospectos (responsable) |
| leads | lead.service.js · updateInteraction/deleteInteraction | la gestora solo edita sus propias interacciones |
| conversions | conversion.controller.js · list, cuotas, filas, removePayment, remove, listProductos | la gestora solo ve y toca sus ventas |
| sales | sales.controller.js · topProducts, facturado, desglose | la gestora solo cuenta sus ventas |
| sales | sales.goals.js · setGoal/deleteGoal | la gestora solo pone y borra su propia meta |
| accounting | accounting.controller.js · receivable | la gestora solo ve lo suyo |
| invoices | invoices.controller.js · list | la gestora solo ve sus facturas; filtrar por empresa, solo admin |
| feedback | feedback.controller.js · exigirQueSeaSuyo | la gestora solo toca el correo de sus prospectos |
| whatsapp | whatsapp.controller.js · cola; chat.controller.js · usuarios | la gestora, su cola y su sesión |
| proceso | proceso.controller.js · deQuienEsLaCola; proceso.ambito.js | de quién es la cola y qué campus entran |
| notifications | notifications.service.js · visibilityClause | qué avisos ve cada uno |
| (todo el CRM) | shared/utils/ambito.js · veTodoElCrm, proyectosDelAmbito; projectAccess | superadmin y soporte ven todos los campus; el resto, los suyos |
| users | user.controller.js · uploadAvatar/deleteAvatar; user.views.controller.js · canEdit | cada uno su foto y su vista; el superadmin, la de cualquiera |
| mcp | mcp.controller.js · cambiarAcceso; mcp.model.js · listarPersonas | el admin, solo personas de sus campus |
| expenses | expense.service.js | gastos de los campus de cada uno |
| certifex | certifex.alcance.js | diplomas de los campus de cada uno |
| tutores | tutor.controller.js · exigirTutorDeMisCampus | fichas de tutores de sus campus |
| facturas-colaborador | facturas-colaborador.service.js · ambitoDe | facturas de las empresas de sus campus |
| webhook-tokens | token.controller.js · comprobarCampus | cada admin, los webhooks de sus campus; el superadmin, todos |
