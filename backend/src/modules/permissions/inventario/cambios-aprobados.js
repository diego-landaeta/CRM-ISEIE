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
    aprobadoPor: null,
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
    que: 'Los webhooks que reciben prospectos y matrículas (Captación › Webhooks): solo el admin y el superadmin, cada uno los de sus campus. Gestoras, soporte y project manager dejan de verlos y de tocarlos.',
    motivo: 'Paridad 2.6.0 con MultiCRM (#198, 20/10): el webhook de admisión lleva los documentos del alumno y el token de cada webhook es la llave para meter datos en el CRM. Allí se cerró a admin y superadmin; en ISEIE se trae igual.',
    filas: [
      'GET /api/webhook-tokens/', 'GET /api/webhook-tokens/:id/status', 'POST /api/webhook-tokens/',
      'PATCH /api/webhook-tokens/:id', 'DELETE /api/webhook-tokens/:id',
      'POST /api/webhook-tokens/:id/listen', 'POST /api/webhook-tokens/:id/listen/stop',
    ],
    roles: ['gestor', 'soporte', 'project_manager', 'tutor', 'colaborador'],
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
    id: 'tutor-solo-lo-suyo',
    que: 'El tutor se queda con 5 permisos de serie: sus cursos y comisiones, sus consultas, cambiar su correo, las novedades y los mensajes. Pierde el aviso de comisiones, que nunca pudo usar.',
    motivo: 'Diego (03/11, #591): «el tutor solo ve lo de él». Venía en TODOS y el catálogo le daba 55, pero el servidor ya le cerraba todo menos `RUTAS_DEL_TUTOR`. La única ruta que el tutor alcanzaba es la del aviso, y su controlador pedía `tutores.gestionar`: ya daba 403.',
    filas: ['GET /api/tutores/comisiones/aviso', 'POST /api/tutores/comisiones/avisar'],
    roles: ['tutor'],
    sentido: 'pierde',
    aprobadoPor: 'Diego, 03/11',
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
    id: 'menu-claves-admin',
    que: '«Sistema › Claves y variables» la ve también el admin, con las claves de sus campus (CRM#632).',
    motivo: 'Va con el cambio `admin-ve-claves`: el admin ya puede leerlas en el servidor, y el menú se la enseña.',
    perfiles: {
      admin: ['+ Sistema › Claves y variables'],
      'gestora+admin': ['+ Sistema › Claves y variables'],
    },
    rutas: { 'Sistema › Claves y variables': 'GET /api/credentials/' },
    aprobadoPor: 'Diego, 03/11',
  },
  {
    id: 'menu-facturacion',
    que: '«Finanzas › Facturación» la ve quien puede facturar: el admin, quien lleva la cola (la casilla «factura_manager») y quien es admin como rol de más.',
    motivo: 'Antes la entrada preguntaba por `factura_manager` como si fuera un permiso y solo la veía el superadmin, aunque el servidor ya les dejaba entrar a todos ellos.',
    perfiles: {
      admin: ['+ Finanzas › Facturación'],
      'gestora con factura_manager': ['+ Finanzas › Facturación'],
      'gestora+admin': ['+ Finanzas › Facturación'],
    },
    rutas: { 'Finanzas › Facturación': 'GET /api/invoices/' },
    aprobadoPor: DIEGO,
  },
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
      project_manager: ['- Clientes › Matrículas', '- Principal › WhatsApp › Chat', '- Principal › WhatsApp › Conexión'],
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
      'Clientes › Matrículas': 'GET /api/matriculas/',
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
 * Reglas nuevas que dependen de lo que se MANDA, no de quién entra a la ruta:
 * la comparación no las ve (la ruta sigue abierta), pero cambian lo que se
 * puede hacer. Van en la misma lista para Diego.
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
];
