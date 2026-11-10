/**
 * Lo que cambia A PROPÓSITO respecto a antes de #423, uno a uno.
 *
 * Diego: «nadie gana ni pierde acceso; los cambios intencionados van en una
 * lista aparte para que yo los apruebe uno a uno». Esta es la lista. El script
 * `comparar-permisos.mjs` y las pruebas dejan pasar una diferencia SOLO si está
 * aquí; cualquier otra es un fallo.
 *
 * Cada cambio:
 *   id          corto, para nombrarlo en la #423
 *   que         una frase, para Diego
 *   motivo      por qué
 *   filas       las del inventario a las que afecta (su `id`)
 *   roles       a qué roles les cambia (con sus valores de serie)
 *   sentido     'pierde' o 'gana'
 *   aprobadoPor null hasta que Diego lo apruebe en la issue
 *
 * Hugo (21/10) decidió cerrar los agujeros en esta entrega en vez de copiarlos.
 *
 * Diego (26/10) aprobó la lista con tres decisiones:
 *   1. Su cuenta pasa a superadmin con soporte de rol de más (cambio de DATOS,
 *      en el guion del día de producción; aquí, `soporte-a-superadmin`). A
 *      cualquier otra persona de soporte le vale la lista tal cual.
 *   2. Los admin SIGUEN cambiando lo que trae cada rol y los roles a medida
 *      (`roles.edit` es del admin de serie), sin darles lo que no tienen.
 *   3. Soporte SIGUE dando de alta admins, gestoras y colaboradores.
 */

const DIEGO = 'Diego, 26/10';

export const CAMBIOS = [
  {
    id: 'roles-sin-soporte',
    que: 'Cambiar lo que trae un rol fijo, crear o cambiar roles a medida y la vista de cada rol: el admin y el superadmin, como hasta hoy. Soporte, no.',
    motivo: 'Soporte lo hacía por el atajo de roleGuard, sin que nadie se lo diera. Hugo lo dejaba solo al superadmin; Diego (26/10): «los admin siguen pudiendo», sin poner a un rol lo que ellos no tienen.',
    filas: [
      'POST /api/permissions/custom-roles', 'PUT /api/permissions/custom-roles/:id',
      'DELETE /api/permissions/custom-roles/:id', 'PUT /api/permissions/role-views/:roleKey',
    ],
    roles: ['soporte'],
    sentido: 'pierde',
    aprobadoPor: DIEGO,
  },
  {
    id: 'admin-roles-entero',
    que: 'Con «Cambiar roles» el admin también borra un rol a medida que nadie tiene y cambia una clave suelta de un rol (p. ej. «Diplomas · Ver»), que antes solo hacía el superadmin.',
    motivo: 'Sale de la decisión 2 de Diego (26/10): el admin sigue cambiando lo que trae cada rol y los roles a medida; estas dos rutas son parte de lo mismo y ahora piden la misma clave. Sigue sin poder poner a un rol lo que él no tiene.',
    filas: ['DELETE /api/permissions/custom-roles/:id', 'PUT /api/permissions/claves/:clave/rol/:roleKey'],
    roles: ['admin'],
    sentido: 'gana',
    aprobadoPor: DIEGO,
  },
  {
    id: 'roles-a-medida-sin-soporte',
    que: 'Ver los roles a medida: admin y superadmin. Soporte, no.',
    motivo: 'Soporte los veía por el atajo de roleGuard; no administra permisos.',
    filas: ['GET /api/permissions/custom-roles', 'GET /api/permissions/custom-roles/:id'],
    roles: ['soporte'],
    sentido: 'pierde',
    aprobadoPor: DIEGO,
  },
  {
    id: 'excepciones-sin-soporte',
    que: 'Dar o quitar permisos a una persona: el admin (solo a gente de sus campus) y el superadmin. Soporte, no.',
    motivo: 'Soporte entraba por el atajo de roleGuard a `/users/:id/permissions`, sin límite de campus. Es una puerta para darse a sí mismo o a otros lo que no tienen.',
    filas: ['GET /api/permissions/users/:userId/permissions', 'PUT /api/permissions/users/:userId/permissions'],
    roles: ['soporte'],
    sentido: 'pierde',
    aprobadoPor: DIEGO,
  },
  {
    id: 'rol-de-otros-con-permiso',
    que: 'Cambiar el rol, los roles de más o «se dedica a colaboraciones» de alguien: quien da permisos («Permisos de cada persona»), y el admin solo a gente de sus campus y que no sea admin. Soporte, no.',
    motivo: 'Desde Usuarios, admin y soporte cambiaban el rol de cualquiera, de cualquier empresa: es la manera más corta de darle a alguien todo un rol. Ahora sigue las reglas de la ficha.',
    filas: ['PATCH /api/users/:id · users.cambiar_rol'],
    roles: ['soporte'],
    sentido: 'pierde',
    aprobadoPor: DIEGO,
  },
  {
    id: 'metas-sin-soporte-ni-pm',
    que: 'Poner o borrar una meta de ventas: admin (la de la gente de sus campus), gestora (la suya) y superadmin. Soporte y project manager, no.',
    motivo: 'Las dos rutas de metas no pedían ningún rol: cualquier sesión que llegara, soporte y project manager incluidos, fijaba o borraba la meta de cualquiera (IDOR, PR #434). Lo hacían por un descuido de la ruta, no porque alguien se lo diera.',
    filas: ['POST /api/ventas/goals', 'DELETE /api/ventas/goals/:id'],
    roles: ['soporte', 'project_manager'],
    sentido: 'pierde',
    // Pendiente: hay que aprobarlo en la #423 (lo cierra un agujero, pero cambia el acceso de tres roles).
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'superadmin-su-correo',
    que: 'El superadmin también puede cambiar su propio correo desde «Mi perfil».',
    motivo: 'Hoy esa ruta es solo del tutor. En el catálogo el superadmin lo tiene todo, sin excepciones; el resto de roles sigue igual.',
    filas: ['PATCH /api/auth/me/email'],
    roles: ['superadmin'],
    sentido: 'gana',
    aprobadoPor: DIEGO,
  },
  {
    id: 'webhooks-solo-admin',
    que: 'Los webhooks que reciben prospectos y matrículas (Captación › Webhooks): solo el admin y el superadmin, cada uno los de sus campus. Gestoras y soporte dejan de verlos y de tocarlos. El project manager los sigue viendo (sin el token) desde el 04/11 (`pm-ve-todo`), y tocarlos nunca pudo.',
    motivo: 'Paridad 2.6.0 con MultiCRM (#198, 20/10): el webhook de admisión lleva los documentos del alumno y el token de cada webhook es la llave para meter datos en el CRM. Allí se cerró a admin y superadmin; en ISEIE se trae igual.',
    filas: [
      'GET /api/webhook-tokens/', 'GET /api/webhook-tokens/:id/status', 'POST /api/webhook-tokens/',
      'PATCH /api/webhook-tokens/:id', 'DELETE /api/webhook-tokens/:id',
      'POST /api/webhook-tokens/:id/listen', 'POST /api/webhook-tokens/:id/listen/stop',
    ],
    roles: ['gestor', 'soporte'],
    sentido: 'pierde',
    aprobadoPor: 'Diego, 02/11 (la 2.6.0 de ISEIE, tal cual MultiCRM)',
  },
  {
    id: 'admin-ve-claves',
    que: 'Ver qué claves hay (sin su valor): también el admin, solo las de sus campus y que existen las generales. Guardar, probar y borrar siguen siendo de soporte.',
    motivo: 'CRM#632 / ISEIE#359, auditoría del 03/11: en Informes el admin pedía /credentials (¿está la clave de Claude?) y le daba 403. Diego: «el admin debe ver todo de todo», con los datos de sus campus.',
    filas: ['GET /api/credentials/'],
    roles: ['admin'],
    sentido: 'gana',
    aprobadoPor: 'Diego, 03/11',
  },
  {
    id: 'pm-ve-todo',
    que: 'El project manager ve todas las pantallas, en solo lectura: ventas del equipo, finanzas (caja, por cobrar, egresos, por pagar, comisiones, nóminas, integraciones, facturas de colaboradores), informes, matrículas, diplomas, consultas, avisos de spam, Make, webhooks (vuelve a verlos; tocarlos sigue siendo del admin, `webhooks-solo-admin`), Meta Ads, WooCommerce, conectores, Moodle, webhooks de salida, el banco de WhatsApp, registro, estado, claves (sin su valor), usuarios y roles. Nada de crear, editar, borrar, enviar, revelar ni pagar.',
    motivo: 'Diego (04/11): «el project manager ve todo». Su alcance no cambia: lo de sus campus, y donde una gestora ve solo lo suyo, él también. El banco de WhatsApp, con su propia clave (`whatsapp.banco`): las líneas de la gente de sus campus, sin entrar en la sesión de nadie.',
    filas: [
      'GET /api/accounting/dashboard', 'GET /api/accounting/receivable',
      'GET /api/accounts-payable/', 'GET /api/accounts-payable/stats', 'GET /api/accounts-payable/:id',
      'GET /api/asignacion/', 'GET /api/asignacion/decisiones',
      'GET /api/certifex/emisiones/estado', 'GET /api/certifex/emisiones/centros', 'GET /api/certifex/emisiones/cursos', 'GET /api/certifex/emisiones/logo', 'GET /api/certifex/emisiones/diploma/:nexp', 'GET /api/certifex/diplomas/resumen', 'GET /api/certifex/diplomas/solicitudes', 'GET /api/certifex/diplomas/por-avisar', 'GET /api/certifex/diplomas/terminados', 'GET /api/certifex/diplomas', 'GET /api/certifex/consultas', 'GET /api/certifex/emisiones', 'GET /api/certifex/diplomas/firma/:matriculaId',
      'GET /api/commissions/rules', 'GET /api/commissions/', 'GET /api/commissions/stats',
      'GET /api/connectors/', 'GET /api/connectors/:id',
      'GET /api/consultas/tutores-panel', 'GET /api/consultas/campus-sin-tutor', 'GET /api/consultas/', 'GET /api/consultas/alumnos-sin-mensajes · consultas.las_de_todos', 'GET /api/consultas/metricas · consultas.las_de_todos',
      'GET /api/credentials/',
      'GET /api/documents/:id/audit',
      'GET /api/expenses/', 'GET /api/expenses/resumen', 'GET /api/expenses/comprobante/:key', 'GET /api/expenses/:id',
      'GET /api/facturas-colaborador/empresas', 'GET /api/facturas-colaborador/mes', 'GET /api/facturas-colaborador/facturas', 'GET /api/facturas-colaborador/coste-por-campus', 'GET /api/facturas-colaborador/zip', 'GET /api/facturas-colaborador/facturas/:id/archivo', 'GET /api/facturas-colaborador/facturas/:id/registro', 'GET /api/facturas-colaborador/facturas/:id/desglose', 'GET /api/facturas-colaborador/facturas/:id/justificante',
      'GET /api/integrations/', 'GET /api/integrations/:provider',
      'GET /api/leads/spam-reports', 'GET /api/leads/spam-reports/count',
      'GET /api/make-webhooks/', 'GET /api/make-webhooks/:id', 'GET /api/make-webhooks/:id/deliveries',
      'GET /api/matriculas/', 'GET /api/matriculas/:id',
      'GET /api/meta-ads/accounts', 'GET /api/meta-ads/account', 'GET /api/meta-ads/campaigns', 'GET /api/meta-ads/campaigns/:campaignId', 'GET /api/meta-ads/campaigns/:campaignId/adsets', 'GET /api/meta-ads/adsets/:adsetId/ads', 'GET /api/meta-ads/dashboard', 'GET /api/meta-ads/associations', 'GET /api/meta-ads/adset-associations', 'GET /api/meta-ads/roi', 'GET /api/meta-ads/products-view',
      'GET /api/moodle/campus', 'GET /api/moodle/cursos', 'GET /api/moodle/campus/:id/revision', 'GET /api/moodle/categorias', 'GET /api/moodle/cursos/:id/alumnos', 'GET /api/moodle/cursos/:id/estructura', 'GET /api/moodle/cursos/:id/recursos',
      'GET /api/novedades/:version/envios',
      'GET /api/payroll/plans', 'GET /api/payroll/hours', 'GET /api/payroll/periods', 'GET /api/payroll/periods/:id',
      'GET /api/permissions/roles', 'GET /api/permissions/custom-roles', 'GET /api/permissions/custom-roles/:id', 'GET /api/permissions/role-permissions/:roleKey', 'GET /api/permissions/claves/:clave/rol/:roleKey',
      'GET /api/registro/', 'GET /api/registro/fuentes', 'GET /api/registro/csv',
      'GET /api/informes/overview', 'GET /api/informes/canales/dinero', 'GET /api/informes/mi-puesto · reports.puesto_ajeno',
      'GET /api/ventas/resumen', 'GET /api/ventas/por-asesora', 'GET /api/ventas/sin-formacion', 'GET /api/ventas/gestores-stats',
      'GET /api/status/errors', 'GET /api/status/piezas', 'GET /api/status/correos',
      'GET /api/users/', 'GET /api/users/buscar', 'GET /api/users/activity-log', 'GET /api/users/availability', 'GET /api/users/:id', 'GET /api/users/:id/availability-blocks',
      'GET /api/webhooks-salientes/', 'GET /api/webhooks-salientes/ejemplo', 'GET /api/webhooks-salientes/envios', 'GET /api/webhooks-salientes/:id',
      'GET /api/whatsapp/actividad', 'GET /api/whatsapp/banco', 'GET /api/whatsapp/banco/numeros',
      'GET /api/woocommerce/credentials', 'GET /api/woocommerce/mappings', 'GET /api/woocommerce/runs', 'GET /api/woocommerce/runs/current', 'GET /api/woocommerce/preview',
    ],
    roles: ['project_manager'],
    sentido: 'gana',
    aprobadoPor: 'Diego, 04/11',
  },
];

/** ¿Está aprobado (o pendiente de aprobar en esta lista) que esta fila cambie para este rol? */
export function cambioPrevisto(filaId, rol) {
  return CAMBIOS.find((c) => c.filas.includes(filaId) && c.roles.includes(rol)) || null;
}

/**
 * Los cambios que dependen de los DATOS de una persona, no de su rol: solo los
 * ve el script con la base de verdad (`scripts/comparar-permisos.mjs`). Cada uno
 * dice cuándo explica una diferencia: `explica(contexto)` recibe
 *   { persona, fila, antes, despues, despuesSin }  —`despuesSin(cambio)` vuelve
 * a calcular el «después» deshaciendo esa parte (sin roles de más, con el rol a
 * medida activo…)— y devuelve true si la diferencia sale de ahí.
 */
export const CAMBIOS_POR_DATOS = [
  {
    id: 'roles-de-mas-cuentan',
    que: 'Los roles de más cuentan en todo: también donde antes solo se miraba el rol principal (facturas, tutores, el MCP de quien además es admin, permisos sueltos). WhatsApp no cambia, y un tutor sigue sin MCP aunque tenga otro rol (`nuncaPrincipal`).',
    motivo: 'Antes unas comprobaciones miraban los roles de más y otras no (checkPermission no; el menú solo el principal). Ahora una sola regla: basta con que uno de sus roles lo traiga. Salvo lo que el rol principal vetaba (QA de Diego, punto 6).',
    // WhatsApp, nunca: lo decide el rol principal, como antes. Una diferencia ahí es un fallo.
    explica: ({ persona, fila, antes, despuesSin }) => persona.roles_extra.length > 0 && fila.modulo !== 'whatsapp'
      && despuesSin('sinRolesDeMas') === antes,
    aprobadoPor: DIEGO,
  },
  {
    id: 'rol-a-medida-desactivado',
    que: 'Un rol a medida desactivado deja de aplicarse: la persona tiene lo de su rol.',
    motivo: 'Antes se aplicaba aunque estuviera desactivado (`findCustomRoleById` no miraba `active`).',
    explica: ({ persona, antes, despuesSin }) => persona.custom_role && persona.custom_role.active === false && despuesSin('rolAMedidaActivo') === antes,
    aprobadoPor: DIEGO,
  },
  {
    id: 'rol-a-medida-con-roles-de-mas',
    que: 'Quien tiene rol a medida y además roles de más suma lo de esos roles.',
    motivo: 'Los guardias (resolvePermission) ignoraban sus roles de más; /auth/me los sumaba. Ahora las dos cosas dicen lo mismo.',
    explica: ({ persona, antes, despuesSin }) => Boolean(persona.custom_role) && persona.roles_extra.length > 0 && despuesSin('sinRolesDeMas') === antes,
    aprobadoPor: DIEGO,
  },
  {
    id: 'cola-entera',
    que: 'Quien lleva la cola de facturación (antes, la casilla «factura_manager») también cobra proformas, sea cual sea su rol.',
    motivo: 'Antes la casilla abría tres de las cuatro rutas de la cola a cualquier rol, pero «cobrar proforma» además pedía ser admin o gestora. Ahora las cuatro son «Emitir desde la cola».',
    explica: ({ persona, fila, despues }) => persona.factura_manager && fila.id === 'POST /api/invoices/:id/cobrar-proforma' && despues === true,
    aprobadoPor: DIEGO,
  },
  {
    id: 'pantalla-y-servidor',
    que: 'Lo que se le dio o se le quitó a alguien (excepción o rol a medida) sobre una clave que antes solo miraba la pantalla —asignar, crear o editar prospectos, editar ventas, crear, editar o borrar productos, sincronizar WooCommerce— ahora vale también en el servidor.',
    motivo: 'Antes ese valor solo enseñaba o escondía el botón; la ruta miraba el rol. Diego (QA, punto 5): no se archiva ninguna clave en uso. Se quedan, y desde #423 la ruta y el botón dicen lo mismo.',
    explica: ({ antes, despuesSin }) => despuesSin('sinClavesDePantalla') === antes,
    aprobadoPor: DIEGO,
  },
  {
    id: 'soporte-a-superadmin',
    que: 'Quien era soporte y pasa a superadmin con soporte de rol de más (la cuenta de Diego, decisión del 26/10) lo puede todo, como cualquier superadmin.',
    motivo: 'Diego: «literalmente como superadmin, con soporte». Es un cambio de datos del día de producción; la simulación lo pasa con `--guion`.',
    explica: ({ persona, personaAntes, despues }) => persona.role === 'superadmin' && personaAntes?.role === 'soporte'
      && persona.roles_extra.includes('soporte') && despues === true,
    aprobadoPor: DIEGO,
  },
  {
    id: 'tutores-tablero',
    que: 'El tutor tiene tablero de tareas: «Ver su tablero» y «Editar tareas» de serie. Ve sus tareas y las de su equipo de TUTORES; el de desarrollo, no. Quien es tutor además de otro rol (una gestora que también da clase) también lo gana.',
    motivo: 'Diego (04/11): «un tablero de tutores separado del de colaboradores», para quien lleva las colaboraciones de los profesores y sus tutores. Las tareas que ve las decide el servicio (sus equipos); mover y comentar siguen siendo de quien la lleva o la supervisa.',
    explica: ({ persona, fila, despues }) => despues === true && fila.modulo === 'tasks'
      && [persona.role, ...persona.roles_extra].includes('tutor'),
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'superadmin-todo',
    que: 'El superadmin lo puede todo, también lo que una casilla o una regla suelta le quitaba (su WhatsApp apagado, el correo de «Mi perfil»).',
    motivo: 'En el catálogo el superadmin no tiene excepciones.',
    explica: ({ persona, despues }) => persona.role === 'superadmin' && despues === true,
    aprobadoPor: DIEGO,
  },
];

/**
 * Lo que cambia en el MENÚ, por perfil (QA de Diego, punto 6: «soporte pierde
 * 10 entradas del menú; el admin con factura_manager gana Facturación»). Ningún
 * cambio de acceso: lo que sale llevaba a una página que ya respondía, y lo que
 * se va llevaba a una que daba 403. `rutas` dice, por entrada, la ruta que lo
 * demuestra; `menuSinCambioDeAcceso423.test.js` lo comprueba con las reglas de
 * antes y las de ahora, y la foto del menú (`menuPorPerfil423.test.jsx`) solo
 * deja pasar estas diferencias. `+` aparece, `-` desaparece.
 */
export const CAMBIOS_DE_MENU = [
  {
    id: 'menu-sin-403',
    que: 'El menú deja de enseñar lo que daba 403: 12 entradas a soporte y 3 al project manager.',
    motivo: 'Soporte lo veía todo por un atajo del menú («ve todo»), y el project manager las pantallas de la gestora; al entrar, el servidor les respondía 403. Ninguno pierde nada que pudiera usar.',
    perfiles: {
      soporte: [
        '- Clientes › Diplomas', '- Equipo de Desarrollo › Por revisar', '- Equipo de Desarrollo › Configurar tablero', '- Conexión › Conectores', '- Conexión › Webhook de transferencias',
        '- Equipo de Desarrollo › Mi factura', '- Equipo de Desarrollo › Mi tablero', '- Finanzas › Facturas de colaboradores',
        '- Tutores › Comisiones', '- Tutores › Mis cursos', '- Tutores › Sin tutor', '- Tutores › Tutores',
      ],
      // Matrículas ya no: el project manager ve todo desde el 04/11 (`pm-ve-todo`).
      project_manager: ['- Principal › WhatsApp › Chat', '- Principal › WhatsApp › Conexión'],
    },
    rutas: {
      'Clientes › Diplomas': 'GET /api/certifex/diplomas/solicitudes',
      'Equipo de Desarrollo › Por revisar': 'GET /api/tasks/',
      'Equipo de Desarrollo › Configurar tablero': 'GET /api/tasks/',
      'Conexión › Conectores': 'GET /api/connectors/',
      'Conexión › Webhook de transferencias': 'GET /api/webhooks-salientes/',
      'Equipo de Desarrollo › Mi factura': 'GET /api/facturas-colaborador/mias',
      'Equipo de Desarrollo › Mi tablero': 'GET /api/tasks/',
      'Finanzas › Facturas de colaboradores': 'GET /api/facturas-colaborador/facturas',
      'Tutores › Comisiones': 'GET /api/tutores/comisiones',
      'Tutores › Mis cursos': 'GET /api/tutores/colaboraciones',
      'Tutores › Sin tutor': 'GET /api/tutores/formaciones-sin-tutor',
      'Tutores › Tutores': 'GET /api/tutores/',
      'Principal › WhatsApp › Chat': 'GET /api/whatsapp/chats',
      'Principal › WhatsApp › Conexión': 'GET /api/whatsapp/conexion',
    },
    aprobadoPor: DIEGO,
  },
  {
    id: 'menu-webhooks-solo-admin',
    que: 'Captación › Webhooks sale del menú de soporte: va con el cambio de acceso `webhooks-solo-admin` (paridad 2.6.0 con MultiCRM, #198).',
    motivo: 'Aquí el menú SÍ acompaña a un cambio de acceso: la ruta deja de responder a soporte. Por eso no va en `menu-sin-403`, y la prueba comprueba que el cambio de acceso está aprobado.',
    acompanaA: 'webhooks-solo-admin',
    perfiles: { soporte: ['- Captación › Webhooks'] },
    rutas: { 'Captación › Webhooks': 'GET /api/webhook-tokens/' },
    aprobadoPor: 'Diego, 02/11 (la 2.6.0 de ISEIE, tal cual MultiCRM)',
  },
  {
    // Gemela de CRM#643. En ISEIE solo el Banco: Status tiene aquí una parte
    // pública (componentes e incidencias), así que se queda en el menú y lo que
    // pide `status.view` se esconde dentro de la pantalla.
    id: 'menu-sin-403-631',
    que: 'Nada: el Banco de mensajes lo sigue viendo el project manager. Era «el project manager deja de verlo» (#631, CRM-ISEIE#358), y Diego (04/11) decidió que el project manager ve todo: ahora lo abre de verdad (`whatsapp.banco`, cambio `pm-ve-todo`).',
    motivo: 'Se queda para que conste: la auditoría del 03/11 pedía esconderle el Banco porque el servidor le daba 403. Con `pm-ve-todo` ya no hay 403 que esconder.',
    perfiles: {},
    rutas: {},
    // Diego (04/11), sobre la PR #643: aprobado, salvo el project manager, que ve todo.
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'menu-pm-ve-todo',
    que: 'El project manager ve en el menú cada pantalla que puede ver (Diego, 04/11: «el project manager ve todo»), aunque la entrada se enseñara de serie solo al admin. Lo de dentro, de sus campus.',
    motivo: 'Va con el cambio `pm-ve-todo`: el servidor ya le deja leerlas, y el menú se las enseña. Las que ya podía abrir (Email, Formularios, Conversiones…) se las escondía la lista de `roles` de la entrada.',
    perfiles: {
      project_manager: [
        '+ Captación › Email', '+ Captación › Formularios', '+ Captación › Make', '+ Captación › Webhooks',
        '+ Captación › Widget web', '+ Catálogo › Cursos pendientes', '+ Catálogo › WooCommerce', '+ Clientes › Diplomas',
        '+ Conexión › Asignación de leads', '+ Conexión › Conectores', '+ Conexión › Moodle', '+ Conexión › Webhook de transferencias',
        '+ Finanzas › Comisiones', '+ Finanzas › Conversiones', '+ Finanzas › Cuentas por cobrar', '+ Finanzas › Cuentas por pagar',
        '+ Finanzas › Dashboard', '+ Finanzas › Egresos', '+ Finanzas › Facturas de colaboradores', '+ Finanzas › Ingresos',
        '+ Finanzas › Integraciones', '+ Finanzas › Nóminas', '+ Finanzas › Pagos Stripe', '+ Finanzas › Pendientes de facturar',
        '+ Principal › WhatsApp › Actividad', '+ Publicidad › Meta Ads', '+ Sistema › Registro', '+ Tutores › Consultas',
      ],
    },
    rutas: {
      'Captación › Email': 'GET /api/secuencias-email/',
      'Captación › Formularios': 'GET /api/forms/',
      'Captación › Make': 'GET /api/make-webhooks/',
      'Captación › Webhooks': 'GET /api/webhook-tokens/',
      'Captación › Widget web': 'GET /api/widget/config',
      'Catálogo › Cursos pendientes': 'GET /api/cursos-pendientes/',
      'Catálogo › WooCommerce': 'GET /api/woocommerce/credentials',
      'Clientes › Diplomas': 'GET /api/certifex/diplomas/solicitudes',
      'Conexión › Asignación de leads': 'GET /api/asignacion/',
      'Conexión › Conectores': 'GET /api/connectors/',
      'Conexión › Moodle': 'GET /api/moodle/campus',
      'Conexión › Webhook de transferencias': 'GET /api/webhooks-salientes/',
      'Finanzas › Comisiones': 'GET /api/commissions/',
      'Finanzas › Conversiones': 'GET /api/conversions/',
      'Finanzas › Cuentas por cobrar': 'GET /api/accounting/receivable',
      'Finanzas › Cuentas por pagar': 'GET /api/accounts-payable/',
      'Finanzas › Dashboard': 'GET /api/accounting/dashboard',
      'Finanzas › Egresos': 'GET /api/expenses/',
      'Finanzas › Facturas de colaboradores': 'GET /api/facturas-colaborador/facturas',
      'Finanzas › Ingresos': 'GET /api/conversions/',
      'Finanzas › Integraciones': 'GET /api/integrations/',
      'Finanzas › Nóminas': 'GET /api/payroll/periods',
      'Finanzas › Pagos Stripe': 'GET /api/stripe-payments/',
      'Finanzas › Pendientes de facturar': 'GET /api/invoices/',
      'Principal › WhatsApp › Actividad': 'GET /api/whatsapp/actividad',
      'Publicidad › Meta Ads': 'GET /api/meta-ads/dashboard',
      'Sistema › Registro': 'GET /api/registro/',
      'Tutores › Consultas': 'GET /api/consultas/',
    },
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'tutores-tablero',
    que: '«Mi tablero» la ve también el tutor: su tablero de tutores.',
    motivo: 'Va con el cambio `tutores-tablero`: el tutor gana «Ver su tablero» y la ruta del tablero (Diego, 04/11).',
    perfiles: {
      tutor: ['+ Equipo de Desarrollo › Mi tablero'],
      'gestora+tutor': ['+ Equipo de Desarrollo › Mi tablero'],
    },
    rutas: { 'Equipo de Desarrollo › Mi tablero': 'GET /api/tasks/' },
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'historial-de-tareas',
    que: '«Equipo de Desarrollo › Por revisar» desaparece y en su sitio sale «Historial de tareas» a quien tiene tablero (CRM-ISEIE#419).',
    motivo: 'Diego y Carlos (10/11): quien hace la tarea la pasa a «Hecha» él mismo; las de programación las cierra Diego. Ya no hay una bandeja de «por aprobar» ni su contador (tampoco para Carlos): la pantalla y su ruta (`/api/tasks/review`) se quitan enteras. El historial enseña lo hecho con el alcance del tablero: no abre nada que no se viera ya en «Mi tablero».',
    perfiles: {
      superadmin: ['- Equipo de Desarrollo › Por revisar', '+ Equipo de Desarrollo › Historial de tareas'],
      admin: ['- Equipo de Desarrollo › Por revisar', '+ Equipo de Desarrollo › Historial de tareas'],
      'gestora+admin': ['- Equipo de Desarrollo › Por revisar', '+ Equipo de Desarrollo › Historial de tareas'],
      // Quien tiene tablero sin «Aprobar y cerrar»: no tenía «Por revisar» y gana el historial de lo suyo.
      colaborador: ['+ Equipo de Desarrollo › Historial de tareas'],
      tutor: ['+ Equipo de Desarrollo › Historial de tareas'],
      'gestora+tutor': ['+ Equipo de Desarrollo › Historial de tareas'],
    },
    rutas: {
      'Equipo de Desarrollo › Por revisar': 'GET /api/tasks/review',
      'Equipo de Desarrollo › Historial de tareas': 'GET /api/tasks/historial',
    },
    // La pantalla se va con su ruta: no es que se le cierre a alguien, es que ya no existe.
    quitadas: ['Equipo de Desarrollo › Por revisar'],
    aprobadoPor: 'Diego, 10/11',
  },
];

/** `{ perfil: ['+ …', '- …'] }`, todos los cambios de menú juntos. */
export function cambiosDeMenuPorPerfil() {
  const out = {};
  for (const c of CAMBIOS_DE_MENU) {
    for (const [perfil, lineas] of Object.entries(c.perfiles)) out[perfil] = [...(out[perfil] || []), ...lineas];
  }
  return out;
}

/**
 * Reglas nuevas que la comparación no ve, pero que cambian lo que se puede
 * hacer: las que dependen de lo que se MANDA (la ruta sigue abierta) y los
 * cambios en el corte del colaborador (`RUTAS_DEL_COLABORADOR`, que la
 * comparación evalúa con la copia congelada de antes). Van en la misma lista
 * para Diego.
 */
export const CAMBIOS_DE_REGLA = [
  {
    id: 'nadie-da-lo-que-no-tiene',
    que: 'Dar de alta a alguien o cambiarle el rol o los roles de más, y ponerle permisos a un rol: solo si quien lo hace tiene todo lo que se gana (salvo lo que es solo sobre lo suyo: sus cursos, su correo, su factura, su WhatsApp). Un admin ya no hace soporte a nadie. Soporte SÍ sigue dando de alta admins, gestoras y colaboradores (Diego, 26/10).',
    motivo: 'QA de Diego, punto 7: al cambiar el rol se podía dar más de lo que tenía quien lo cambiaba. «Nadie puede dar un rol o permiso que no tenga», como ya pasaba con las excepciones y el rol a medida. El alta de soporte, como hasta hoy (decisión 3).',
    roles: ['admin', 'soporte'],
    sentido: 'pierde',
    aprobadoPor: DIEGO,
  },
  {
    id: 'colaborador-catalogo-del-menu',
    que: 'El colaborador puede leer `GET /api/permissions/system-defaults`: lo que trae de serie cada rol, la lista que usa «Mis preferencias › Mi vista» para los nombres del menú. El tutor ya podía.',
    motivo: 'La auditoría del 03/11 (#631): «Mis preferencias» le daba 403 al colaborador. Solo es lectura y no trae datos de nadie, pero es una ruta más que deja pasar el corte del colaborador.',
    roles: ['colaborador'],
    sentido: 'gana',
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'tutores-tablero',
    que: 'El tutor puede pedir `/api/tasks`: su tablero de tutores. Ve sus tareas y las de su equipo de TUTORES (un equipo de tipo «tutores»); el de desarrollo, no. Solo tiene tablero de verdad —sale como responsable, en las cifras y en los resúmenes— mientras esté en un equipo de tutores.',
    motivo: 'Diego (04/11): «un tablero de tutores separado del de colaboradores». Es una ruta más que deja pasar el corte del tutor (`RUTAS_DEL_TUTOR`); el resto del tablero lo recorta el servicio.',
    roles: ['tutor'],
    sentido: 'gana',
    aprobadoPor: 'Diego, 04/11',
  },
  {
    id: 'historial-de-tareas',
    que: 'El tutor puede pedir `/api/tasks/historial`: lo hecho de su tablero de tutores (lo suyo y lo de su equipo), con quién y cuándo.',
    motivo: 'CRM-ISEIE#419 (Diego y Carlos, 10/11): «Por revisar» pasa a «Historial de tareas». Ya entraba por `/api/tasks` en el corte del tutor (`tutores-tablero`); el historial no enseña nada que no viera ya en su tablero.',
    roles: ['tutor'],
    sentido: 'gana',
    aprobadoPor: 'Diego, 10/11',
  },
];
