/**
 * EL CATÁLOGO DE PERMISOS (#423). La única lista.
 *
 * Diego, 21/10: «cada acción con su permiso, roles como Shopify». Aquí está
 * cada pantalla del CRM con lo que se puede hacer en ella, agrupado como el
 * menú. Un permiso nuevo se registra AQUÍ —clave, nombre, una frase y qué roles
 * lo traen— y sale solo en Configuración › Roles, en la ficha de cada persona y
 * en el mapa de /auth/me. `permissions.defaults.js` ya no es una tabla a mano:
 * se calcula de esto.
 *
 * Cada acción:
 *   accion       la segunda mitad de la clave (`leads.view` → `view`)
 *   nombre       lo que se lee en la casilla
 *   descripcion  una frase: qué deja hacer
 *   roles        los roles fijos que la traen de serie (superadmin, siempre)
 *   requiere     otras claves sin las que no tiene sentido; ver/crear/editar…
 *                de un recurso ya piden su `view` sin decirlo (`dependencias`)
 *   nunca        roles a los que NO se les puede dar, ni con excepción (si TODOS
 *                sus roles están en la lista)
 *   nuncaPrincipal  ni con excepción, si su rol PRINCIPAL es uno de estos,
 *                aunque tenga otros de más: lo que antes miraba solo el rol
 *                principal (WhatsApp, MCP) y no puede cambiar con #423
 *   soloPrincipal de serie la trae solo el rol PRINCIPAL; los roles de más no
 *                la suman (WhatsApp y MCP lo miraban así antes de #423)
 *   propia       solo sobre lo suyo (sus cursos, su correo, su factura): no da
 *                poder sobre nada de otros. Quien da un rol no necesita
 *                tenerla (un admin da de alta a un tutor, o a una gestora
 *                aunque su propio WhatsApp esté apagado)
 *   soloPantalla esconde o enseña algo en la pantalla y ninguna ruta lo pide
 *                (exportar lo que ya se ve, por ejemplo)
 *   independiente no pide el `view` de su recurso: es otra pantalla (cuentas por
 *                cobrar no es «editar» el dashboard de finanzas)
 *
 * Los valores de `roles` no se han inventado: son quién entra HOY a las rutas
 * de cada clave (`inventario/asignacion.js`), y la prueba
 * `catalogoPermisos.test.js` lo comprueba rol por rol.
 */

const TODOS = ['admin', 'gestor', 'soporte', 'project_manager', 'tutor'];
const ADMIN = ['admin'];
const ADMIN_SOPORTE = ['admin', 'soporte'];
const SOPORTE = ['soporte'];
const COMERCIAL = ['admin', 'gestor', 'soporte'];
const NADIE = [];

const a = (accion, nombre, descripcion, roles, extra = {}) => ({ accion, nombre, descripcion, roles, ...extra });

export const ROLES_FIJOS = [
  { clave: 'superadmin', nombre: 'Superadmin', descripcion: 'Todo, siempre. El único que cambia los roles fijos y lo que vale para todas las empresas.' },
  { clave: 'admin', nombre: 'Admin', descripcion: 'Lleva sus campus: prospectos, ventas, finanzas y su equipo.' },
  { clave: 'gestor', nombre: 'Gestora', descripcion: 'Atiende prospectos y registra ventas, solo los suyos.' },
  { clave: 'soporte', nombre: 'Soporte', descripcion: 'Soporte técnico: ve todos los campus y la configuración del sistema.' },
  { clave: 'project_manager', nombre: 'Project manager', descripcion: 'Lleva las solicitudes de cambio; en lo demás, como una gestora.' },
  { clave: 'tutor', nombre: 'Tutor', descripcion: 'Da clase: sus cursos, sus comisiones y su perfil.' },
  { clave: 'colaborador', nombre: 'Colaborador', descripcion: 'Externo: su tablero de tareas y su factura del mes. Nada más.' },
];

export const SECCIONES = [
  {
    clave: 'principal', nombre: 'Principal',
    recursos: [
      {
        clave: 'leads', nombre: 'Prospectos', acciones: [
          a('view', 'Ver prospectos', 'Abrir la lista y la ficha de los prospectos (una gestora, solo los suyos).', TODOS),
          a('create', 'Crear prospectos', 'Dar de alta prospectos, uno a uno o en bloque.', TODOS),
          a('edit', 'Editar prospectos', 'Cambiar datos y estado, apuntar llamadas y recordatorios, fusionar fichas.', TODOS),
          a('delete', 'Borrar prospectos', 'Borrar un prospecto suyo por prueba, spam o duplicado.', ADMIN_SOPORTE),
          a('delete_cualquiera', 'Borrar cualquier prospecto', 'Borrar por cualquier motivo, aunque no sea suyo o tenga ventas.', ADMIN_SOPORTE, { requiere: ['leads.delete'] }),
          a('restaurar', 'Recuperar prospectos borrados', 'Devolver a la lista un prospecto borrado.', SOPORTE),
          a('assign', 'Asignar prospectos', 'Cambiar la gestora de un prospecto y repartir los que no tienen.', ADMIN_SOPORTE),
          a('duplicados', 'Revisar duplicados', 'Ver la cola de posibles duplicados y decidir qué se hace con cada uno.', ADMIN_SOPORTE),
          a('reportar_spam', 'Marcar como spam', 'Avisar de que un prospecto es spam.', ADMIN_SOPORTE),
          // ISEIE (#230): la lista y el contador de avisos los veía también el admin; resolverlos,
          // solo soporte y el superadmin (antes, roleGuard de admin y de superadmin).
          a('spam', 'Ver avisos de spam', 'La lista de avisos de spam y cuántos hay.', ADMIN_SOPORTE),
          a('spam_resolver', 'Resolver avisos de spam', 'Dar por bueno o descartar un aviso de spam.', SOPORTE, { requiere: ['leads.spam'] }),
          a('enviar_correo', 'Escribir a un prospecto', 'Mandar un correo desde la ficha.', TODOS),
          a('exportar_wasapi', 'Exportar para Wasapi', 'Descargar la lista de prospectos con el formato de Wasapi.', TODOS),
          a('export', 'Exportar la lista', 'Descargar en CSV los prospectos que se ven en pantalla.', ADMIN, { soloPantalla: true }),
        ],
      },
      {
        clave: 'proceso', nombre: 'Proceso comercial', acciones: [
          a('view', 'Ver la cola y el seguimiento', 'La cola del día, el seguimiento de fin de mes y los pasos de cada prospecto.', TODOS),
          a('trabajar', 'Trabajar la cola', 'Marcar pasos hechos y añadir seguimientos a un prospecto.', TODOS),
          a('configurar_pasos', 'Configurar los pasos', 'Crear, ordenar, editar y quitar los pasos del proceso.', ADMIN_SOPORTE),
          a('replanificar', 'Replanificar un prospecto', 'Volver a calcular los pasos de un prospecto desde hoy.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'convocatorias', nombre: 'Convocatorias', acciones: [
          a('view', 'Ver convocatorias', 'Las convocatorias, su embudo y a quién se le han ofrecido.', TODOS),
          a('ofrecer', 'Ofrecer plaza', 'Ofrecer una convocatoria a un prospecto y apuntar su respuesta.', TODOS),
          a('create', 'Crear convocatorias', 'Abrir una convocatoria nueva.', ADMIN_SOPORTE),
          a('edit', 'Editar convocatorias', 'Cambiar fechas, plazas y datos de una convocatoria.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'whatsapp', nombre: 'WhatsApp', acciones: [
          // Antes, usar, supervisar y las plantillas compartidas los decidía el rol PRINCIPAL
          // (chat.controller.js · usuarioObjetivo, el banco): un rol de más no sumaba, y un tutor o un
          // project manager con otro rol de más seguía sin WhatsApp (QA de Diego, punto 6).
          a('usar', 'Usar su WhatsApp', 'Enlazar su número y atender sus chats desde el CRM.', COMERCIAL,
            { nunca: ['tutor', 'colaborador'], nuncaPrincipal: ['tutor', 'colaborador', 'project_manager'], soloPrincipal: true, propia: true }),
          a('supervisar', 'Supervisar el WhatsApp de otros', 'Abrir la sesión de otra persona de sus campus y el banco de mensajes de todas.', ADMIN, { nunca: ['tutor', 'colaborador'], soloPrincipal: true }),
          a('cola', 'Ver la cola de WhatsApp', 'Los prospectos que esperan respuesta por WhatsApp.', TODOS),
          a('plantillas', 'Sus plantillas', 'Crear y usar sus propias plantillas de mensaje.', TODOS, { propia: true }),
          a('plantillas_compartidas', 'Plantillas compartidas', 'Crear y cambiar las plantillas de todo el equipo, y las de otras personas.', ADMIN_SOPORTE, { requiere: ['whatsapp.plantillas'], soloPrincipal: true }),
          a('forma_avisos', 'Forma de los avisos', 'Ver y reiniciar cómo llegan los avisos de WhatsApp (diagnóstico).', SOPORTE),
        ],
      },
      {
        clave: 'ventas', nombre: 'Ventas', acciones: [
          a('view', 'Ver sus ventas', 'Sus cifras: por cliente, por producto, facturado y su evolución.', TODOS),
          a('registrar', 'Registrar una venta', 'Apuntar una venta nueva desde Ventas.', COMERCIAL),
          a('view_equipo', 'Ver las ventas del equipo', 'El resumen y las ventas por asesora de todo el equipo.', ADMIN_SOPORTE, { requiere: ['ventas.view'] }),
          a('metas', 'Metas de venta', 'Poner y quitar metas (una gestora, solo la suya).', TODOS),
        ],
      },
    ],
  },
  {
    clave: 'tareas', nombre: 'Tareas',
    recursos: [
      {
        clave: 'tasks', nombre: 'Tablero de tareas', acciones: [
          a('view_own', 'Ver su tablero', 'Entrar al tablero y ver las tareas que tiene asignadas.', ['admin', 'colaborador']),
          a('view_all', 'Ver todo el equipo', 'El tablero de cualquiera, «Todo el equipo» y las métricas.', ADMIN),
          a('create', 'Crear tareas', 'Crearse tareas.', ['admin', 'colaborador'], { requiere: ['tasks.view_own'] }),
          a('assign', 'Asignar tareas', 'Asignar o reasignar tareas a otras personas.', ADMIN, { requiere: ['tasks.view_own'] }),
          a('edit', 'Editar tareas', 'Cambiar, mover y completar las tareas que puede ver.', ['admin', 'colaborador'], { requiere: ['tasks.view_own'] }),
          a('delete', 'Archivar tareas', 'Archivar cualquier tarea y borrar comentarios ajenos.', ADMIN, { requiere: ['tasks.view_own'] }),
          a('close', 'Aprobar y cerrar', 'Aprobar, devolver, cerrar y reabrir tareas en «Por revisar».', ADMIN, { requiere: ['tasks.view_own'] }),
          a('manage', 'Configurar el tablero', 'Columnas, áreas y proyectos del tablero.', ADMIN, { requiere: ['tasks.view_own'] }),
          // Diego, 26/10/2026: «Admin y superadmin pueden crear, renombrar y archivar
          // equipos y gestionar sus miembros y encargados».
          a('manage_teams', 'Gestionar equipos', 'Crear, renombrar y archivar equipos del tablero, sus cargos y quién está en cada uno.', ADMIN, { requiere: ['tasks.view_own'] }),
        ],
      },
    ],
  },
  {
    clave: 'captacion', nombre: 'Captación',
    recursos: [
      {
        clave: 'email_sequences', nombre: 'Email de seguimiento', acciones: [
          a('view', 'Ver secuencias', 'Las secuencias de correo y sus envíos.', TODOS),
          a('create', 'Crear secuencias', 'Montar una secuencia nueva.', ADMIN_SOPORTE),
          a('edit', 'Editar secuencias', 'Cambiar los correos y los tiempos de una secuencia.', ADMIN_SOPORTE),
          a('delete', 'Borrar secuencias', 'Quitar una secuencia.', ADMIN_SOPORTE),
          a('lanzar', 'Lanzar y parar secuencias', 'Poner a un prospecto en una secuencia o sacarlo.', COMERCIAL),
        ],
      },
      {
        clave: 'email_templates', nombre: 'Plantillas de correo', acciones: [
          a('view', 'Ver plantillas', 'Las plantillas de correo y su vista previa.', TODOS),
          a('create', 'Crear plantillas', 'Una plantilla nueva.', ADMIN_SOPORTE),
          a('edit', 'Editar plantillas', 'Cambiar el texto de una plantilla.', ADMIN_SOPORTE),
          a('delete', 'Borrar plantillas', 'Quitar una plantilla.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'forms', nombre: 'Formularios', acciones: [
          a('view', 'Ver formularios', 'Los formularios de la web y lo que han recibido.', TODOS),
          a('create', 'Crear formularios', 'Conectar un formulario nuevo.', ADMIN_SOPORTE),
          a('edit', 'Editar formularios', 'Cambiar un formulario y ponerlo a escuchar.', ADMIN_SOPORTE),
          a('delete', 'Borrar formularios', 'Quitar un formulario.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'make', nombre: 'Make', acciones: [
          a('view', 'Ver escenarios de Make', 'Las entradas de Make y lo que han entregado.', ADMIN_SOPORTE),
          a('create', 'Crear entradas de Make', 'Una entrada nueva.', ADMIN_SOPORTE),
          a('edit', 'Editar entradas de Make', 'Cambiarla o renovar su secreto.', ADMIN_SOPORTE),
          a('delete', 'Borrar entradas de Make', 'Quitar una entrada.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'webhooks', nombre: 'Webhooks de entrada', acciones: [
          // ISEIE (#230): la lista y su estado las pedía cualquiera con sesión, y crearlos,
          // cambiarlos y borrarlos, admin y soporte. Así se queda.
          a('view', 'Ver webhooks', 'Los webhooks que reciben prospectos y su estado (de sus campus).', TODOS),
          a('create', 'Crear webhooks', 'Un webhook nuevo.', ADMIN_SOPORTE),
          a('edit', 'Editar webhooks', 'Cambiarlo o ponerlo a escuchar.', ADMIN_SOPORTE),
          a('delete', 'Borrar webhooks', 'Quitar un webhook.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'widget', nombre: 'Widget web', acciones: [
          a('view', 'Ver el widget', 'La configuración del botón de WhatsApp de la web.', TODOS),
          a('edit', 'Configurar el widget', 'Cambiar el botón y los teléfonos que salen en él.', TODOS),
        ],
      },
    ],
  },
  {
    clave: 'publicidad', nombre: 'Publicidad',
    recursos: [
      {
        clave: 'meta_ads', nombre: 'Meta Ads', acciones: [
          a('view', 'Ver Meta Ads', 'Cuentas, campañas, anuncios y su rendimiento.', ADMIN_SOPORTE),
          a('edit', 'Conectar y sincronizar Meta Ads', 'Conectar cuentas, sincronizarlas y asociar campañas a productos.', ADMIN_SOPORTE),
        ],
      },
    ],
  },
  {
    clave: 'catalogo', nombre: 'Catálogo',
    recursos: [
      {
        clave: 'products', nombre: 'Productos', acciones: [
          a('view', 'Ver productos', 'El catálogo, sus categorías y sus módulos.', TODOS),
          a('create', 'Crear productos', 'Un producto nuevo.', ADMIN_SOPORTE),
          a('edit', 'Editar productos', 'Datos, imagen y módulos de un producto.', ADMIN_SOPORTE),
          a('delete', 'Borrar productos', 'Quitar un producto.', ADMIN_SOPORTE),
          a('categorias', 'Árbol de categorías', 'Crear, mover y quitar categorías.', ADMIN_SOPORTE),
          a('export', 'Exportar el catálogo', 'Descargar el catálogo.', TODOS),
        ],
      },
      {
        clave: 'dossiers', nombre: 'Dossieres', acciones: [
          a('view', 'Ver dossieres', 'Abrir el dossier de un producto y su historial.', TODOS),
          a('upload', 'Subir dossieres', 'Subir una versión nueva del dossier.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'woocommerce', nombre: 'WooCommerce', acciones: [
          a('view', 'Ver WooCommerce', 'La conexión, el mapeo y las importaciones.', ADMIN_SOPORTE),
          a('edit', 'Configurar WooCommerce', 'Credenciales y mapeo de campos.', ADMIN_SOPORTE),
          a('sync', 'Importar de WooCommerce', 'Lanzar una importación de productos.', ADMIN_SOPORTE),
        ],
      },
    ],
  },
  {
    clave: 'tutores', nombre: 'Tutores',
    recursos: [
      {
        clave: 'tutores', nombre: 'Tutores', acciones: [
          a('mis_cursos', 'Sus cursos y comisiones', 'El tutor ve sus colaboraciones, sus cursos y sus comisiones.', ['tutor'], { propia: true }),
          a('gestionar', 'Gestionar colaboraciones', 'Dar de alta tutores, asignarles cursos, calcular sus comisiones y ver las fichas de los de sus campus.', ADMIN),
          a('liquidar', 'Liquidar comisiones', 'Pagar o revertir las comisiones de un tutor (mueve dinero).', ADMIN, { requiere: ['tutores.gestionar'] }),
          a('ajustes', 'Ajustes de comisiones', 'Cambiar los porcentajes y reglas de las comisiones.', ADMIN, { requiere: ['tutores.gestionar'] }),
          a('contrasena', 'Contraseña de un tutor', 'Ponerle contraseña nueva a un tutor de sus campus.', ADMIN, { requiere: ['tutores.gestionar'] }),
          a('cambiar_correo', 'Correo de un tutor', 'Cambiar el correo de un tutor (es el de su factura).', NADIE, { requiere: ['tutores.gestionar'] }),
        ],
      },
    ],
  },
  {
    clave: 'finanzas', nombre: 'Finanzas',
    recursos: [
      {
        clave: 'accounting', nombre: 'Caja', acciones: [
          a('view', 'Ver el dashboard de finanzas', 'La caja del mes.', ADMIN_SOPORTE),
          a('por_cobrar', 'Cuentas por cobrar', 'Lo pendiente de cobro (una gestora, lo suyo).', COMERCIAL, { independiente: true }),
        ],
      },
      {
        clave: 'conversions', nombre: 'Conversiones', acciones: [
          a('view', 'Ver conversiones', 'Los que compraron, sus cobros y sus cuotas.', TODOS),
          a('create', 'Crear conversiones', 'Registrar una conversión.', TODOS),
          a('edit', 'Editar conversiones', 'Cambiar los datos de una conversión.', TODOS),
          a('delete', 'Borrar conversiones', 'Quitar una conversión (una gestora, solo las suyas).', TODOS),
          a('cobros', 'Cobros y cuotas', 'Apuntar cobros, generar y pagar cuotas.', TODOS),
          a('reparto', 'Repartir una venta', 'Repartir una venta entre varias gestoras.', ADMIN),
          a('devoluciones', 'Devoluciones', 'Apuntar y quitar devoluciones.', ADMIN_SOPORTE),
          a('sin_gestora', 'Venta sin gestora', 'Registrar una venta que no es de nadie: no cuenta en el informe de ninguna gestora.', ADMIN),
        ],
      },
      {
        clave: 'facturas', nombre: 'Facturación', acciones: [
          a('view', 'Ver facturas', 'Facturas, series, emisores y su PDF (una gestora, las suyas).', TODOS),
          a('create', 'Crear facturas', 'Hacer una factura o una proforma.', TODOS),
          a('completar', 'Completar datos y marcar entregada', 'Rellenar los datos fiscales del cliente y marcarla entregada.', TODOS),
          a('enviar', 'Enviar facturas', 'Mandar la factura al cliente.', TODOS),
          a('cobrar', 'Marcar cobrada', 'Marcar una factura como cobrada.', TODOS),
          a('anular', 'Anular facturas', 'Anular una factura sin emitir.', TODOS),
          a('emitir_borrador', 'Emitir un borrador', 'Darle número a un borrador.', TODOS),
          a('emitir', 'Poner número al cobrar', 'Que el cobro salga facturado y la proforma sin esperar visto bueno.', ADMIN),
          a('gestionar', 'Corregir y abonar', 'Corregir, abonar (rectificativa), asociar a una venta y borrar facturas (una gestora, las suyas).', ADMIN),
          a('cola', 'Emitir desde la cola', 'Emitir los cobros de la cola, cobrar proformas y mover la fecha «al día».', NADIE),
          a('editar_fechas', 'Cambiar fechas', 'Cambiar la fecha de emisión y de pago, sin tocar importes.', ADMIN),
          a('edit', 'Editar facturas', 'Cambiar cualquier dato de una factura.', ADMIN_SOPORTE),
          a('configurar', 'Configurar la facturación', 'Empresas emisoras, regímenes, plantillas, series y ajustes.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'expenses', nombre: 'Egresos', acciones: [
          a('view', 'Ver egresos', 'Los gastos y sus comprobantes.', ADMIN_SOPORTE),
          a('create', 'Apuntar egresos', 'Un gasto nuevo con su comprobante.', ADMIN_SOPORTE),
          a('edit', 'Editar egresos', 'Cambiar un gasto.', ADMIN_SOPORTE),
          a('delete', 'Borrar egresos', 'Quitar un gasto.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'accounts_payable', nombre: 'Cuentas por pagar', acciones: [
          a('view', 'Ver cuentas por pagar', 'Lo pendiente de pago.', ADMIN_SOPORTE),
          a('create', 'Apuntar cuentas por pagar', 'Una deuda nueva.', ADMIN_SOPORTE),
          a('edit', 'Editar y pagar', 'Cambiarla y apuntar pagos.', ADMIN_SOPORTE),
          a('delete', 'Borrar cuentas por pagar', 'Quitarla.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'commissions', nombre: 'Comisiones del equipo', acciones: [
          a('view', 'Ver comisiones', 'Las comisiones del equipo comercial y sus reglas.', ADMIN_SOPORTE),
          a('edit', 'Recalcular comisiones', 'Volver a calcular la comisión de una venta.', ADMIN_SOPORTE),
          a('pagar', 'Pagar comisiones', 'Marcar una comisión como pagada.', ADMIN_SOPORTE),
          a('reglas', 'Reglas de comisión', 'Crear, cambiar y quitar las reglas.', SOPORTE),
        ],
      },
      {
        clave: 'payroll', nombre: 'Nóminas', acciones: [
          a('view', 'Ver nóminas', 'Planes, horas y periodos.', ADMIN_SOPORTE),
          a('create', 'Apuntar horas', 'Registrar horas trabajadas.', COMERCIAL, { independiente: true }),
          a('edit', 'Gestionar nóminas', 'Planes, generar, cerrar y pagar periodos, ajustes.', ADMIN_SOPORTE),
          a('delete', 'Borrar en nóminas', 'Quitar planes, horas y ajustes.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'stripe', nombre: 'Pagos de Stripe', acciones: [
          a('view', 'Ver pagos de Stripe', 'Los cobros por Stripe, y traer los nuevos.', TODOS),
          a('edit', 'Asociar pagos de Stripe', 'Enlazar un pago con su venta y llevar las disputas.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'facturas_colaborador', nombre: 'Facturas de colaboradores', acciones: [
          a('subir', 'Subir su factura', '«Mi factura»: el colaborador sube la suya del mes.', ['colaborador'], { propia: true }),
          a('ver_todas', 'Ver las facturas', 'Las facturas de los colaboradores de sus empresas.', ADMIN),
          a('gestionar', 'Gestionar colaboradores', 'Dar de alta colaboradores y reenviarles el enlace.', ADMIN),
          a('anular', 'Anular facturas de colaboradores', 'Anular una factura recibida.', ADMIN, { requiere: ['facturas_colaborador.ver_todas'] }),
          a('pagar', 'Pagar facturas de colaboradores', 'Marcarlas pagadas con su justificante.', ADMIN, { requiere: ['facturas_colaborador.ver_todas'] }),
        ],
      },
      {
        clave: 'integrations', nombre: 'Integraciones', acciones: [
          a('view', 'Ver integraciones', 'Los servicios conectados (Stripe, Brevo…).', ADMIN_SOPORTE),
          a('edit', 'Configurar integraciones', 'Conectarlos, probarlos y desconectarlos.', ADMIN_SOPORTE),
        ],
      },
    ],
  },
  {
    clave: 'analisis', nombre: 'Análisis',
    recursos: [
      {
        clave: 'reports', nombre: 'Reportes', acciones: [
          a('mis_informes', 'Ver informes', 'Los informes de ventas, prospectos y seguimiento (una gestora, los suyos).', TODOS, { independiente: true }),
          a('view', 'Ver el resumen general', 'El resumen de todo el equipo.', ADMIN_SOPORTE),
          a('puesto_ajeno', 'El puesto de otra gestora', 'Ver en qué puesto va otra gestora del ranking.', ADMIN_SOPORTE, { requiere: ['reports.mis_informes'], independiente: true }),
        ],
      },
      {
        clave: 'feedback', nombre: 'Feedback', acciones: [
          a('view', 'Ver feedback', 'El panel y las respuestas de los clientes.', TODOS),
          a('enviar', 'Enviar la encuesta', 'Mandar, o no, la encuesta revisada a un cliente.', TODOS),
        ],
      },
    ],
  },
  {
    clave: 'clientes', nombre: 'Clientes',
    recursos: [
      {
        clave: 'clients', nombre: 'Clientes', acciones: [
          a('view', 'Ver clientes', 'La lista de clientes.', [...COMERCIAL, 'project_manager'], { soloPantalla: true }),
          a('create', 'Vender a un cliente', 'Registrar otra compra de un cliente.', ['admin', 'gestor', 'project_manager'], { soloPantalla: true }),
          a('edit', 'Editar clientes', 'Cambiar los datos de un cliente.', ['admin', 'gestor', 'project_manager'], { soloPantalla: true }),
          a('delete', 'Borrar clientes', 'Quitar un cliente.', ADMIN, { soloPantalla: true }),
          a('export', 'Exportar clientes', 'Descargar en CSV los clientes que se ven.', ADMIN, { soloPantalla: true }),
        ],
      },
      {
        clave: 'matriculas', nombre: 'Matrículas', acciones: [
          a('view', 'Ver matrículas', 'Las matrículas y sus documentos.', COMERCIAL),
          a('create', 'Crear matrículas', 'Una matrícula nueva.', COMERCIAL),
          a('edit', 'Editar matrículas', 'Cambiar datos y subir documentos.', COMERCIAL),
          a('cambiar_estado', 'Cambiar el estado', 'Validar, rechazar o cerrar una matrícula.', ADMIN_SOPORTE),
          a('delete', 'Borrar matrículas', 'Quitar una matrícula.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'diplomas', nombre: 'Diplomas (Certifex)', acciones: [
          a('view', 'Ver diplomas', 'La pantalla Diplomas en solo lectura (de sus campus).', ADMIN),
          // Diego, 22/10 (#437/#438): «que Dayana pueda emitir». Quien emite también ve.
          a('emit', 'Emitir diplomas', 'Revisar los datos (nombre, DNI, correo, formación), pasar a pendientes, aprobar y emitir, enviar el diploma al alumno y crear uno nuevo, en sus campus. Rechazar, corregir y revocar, no.', ADMIN, { independiente: true }),
          a('view_emisiones', 'Ver emisiones y firmas', 'El historial de emisiones, las formaciones y las firmas.', ADMIN),
          a('aprobar', 'Aprobar y emitir', 'Aprobar, rechazar y emitir diplomas, y crear uno nuevo.', ADMIN),
          a('edit', 'Corregir diplomas', 'Corregir datos, subir la firma y sincronizar formaciones.', ADMIN),
          a('avisar', 'Avisar al alumno', 'Mandar el aviso de diploma emitido o rechazado.', ADMIN),
          a('revocar', 'Revocar diplomas', 'Anular un diploma ya emitido.', ADMIN),
          a('imprenta', 'Diploma para imprenta', 'Descargar el diploma en formato de imprenta.', ADMIN),
        ],
      },
      {
        clave: 'certifex_consultas', nombre: 'Consultas de Certifex', acciones: [
          a('view', 'Ver consultas', 'Lo que escriben los centros desde la web de Certifex.', ADMIN_SOPORTE),
          a('edit', 'Responder consultas', 'Marcar una consulta como atendida.', ADMIN_SOPORTE),
        ],
      },
    ],
  },
  {
    clave: 'conexion', nombre: 'Conexión',
    recursos: [
      {
        clave: 'mcp', nombre: 'MCP (Claude)', acciones: [
          // Antes lo decidía el rol principal (mcp.acceso.js · puedeUsarMcp): admin de serie, el
          // resto con la casilla, y un tutor nunca, aunque tuviera otro rol de más (QA, punto 6).
          a('usar', 'Usar el MCP', 'Conectar su Claude al CRM con su URL personal.', ADMIN, { nunca: ['tutor'], nuncaPrincipal: ['tutor'], soloPrincipal: true }),
          a('administrar', 'Administrar el MCP', 'Dar o quitar el MCP a personas de sus campus y ver qué se ha consultado.', ADMIN),
          a('supervisar', 'Apagar el MCP', 'El interruptor de emergencia y rechazar conexiones ajenas.', NADIE),
        ],
      },
      {
        clave: 'connectors', nombre: 'Conectores', acciones: [
          a('view', 'Ver conectores', 'Los conectores de sus campus.', ADMIN),
          a('create', 'Crear conectores', 'Un conector nuevo.', ADMIN),
          a('edit', 'Editar conectores', 'Cambiarlo, probarlo e importar.', ADMIN),
          a('delete', 'Borrar conectores', 'Quitar un conector.', ADMIN),
          a('sistema', 'Conectores de todo el sistema', 'Conectores que valen para todas las empresas.', NADIE),
        ],
      },
      {
        clave: 'webhooks_salientes', nombre: 'Webhooks de salida', acciones: [
          a('view', 'Ver webhooks de salida', 'Los avisos que el CRM manda a otros sistemas y sus envíos.', ADMIN),
          a('create', 'Crear webhooks de salida', 'Uno nuevo.', ADMIN),
          a('edit', 'Editar webhooks de salida', 'Cambiarlo, probarlo y reenviar.', ADMIN),
          a('delete', 'Borrar webhooks de salida', 'Quitarlo.', ADMIN),
          a('todas', 'Para todas las empresas', 'Webhooks que valen para todas las empresas.', NADIE),
        ],
      },
    ],
  },
  {
    clave: 'sistema', nombre: 'Sistema',
    recursos: [
      {
        clave: 'novedades', nombre: 'Novedades', acciones: [
          a('view', 'Ver novedades', 'Lo que trae cada versión del CRM.', TODOS),
          a('envios', 'Ver a quién llegó', 'A quién se ha mandado cada versión.', ADMIN_SOPORTE),
          a('enviar', 'Mandar novedades', 'Mandar el correo de una versión.', SOPORTE),
        ],
      },
      {
        clave: 'mensajes', nombre: 'Mensajes internos', acciones: [
          a('usar', 'Usar los mensajes', 'Escribirse con el resto del equipo.', TODOS),
        ],
      },
      {
        clave: 'change_requests', nombre: 'Solicitudes de cambio', acciones: [
          a('view', 'Ver solicitudes', 'Las solicitudes de cambio y sus adjuntos.', TODOS),
          a('create', 'Pedir un cambio', 'Abrir una solicitud.', TODOS),
          a('edit', 'Editar solicitudes', 'Cambiarla y adjuntar.', TODOS),
          a('approve', 'Aprobar solicitudes', 'Firmar la aprobación.', TODOS),
          a('delete', 'Borrar solicitudes', 'Quitar una solicitud.', ['admin', 'soporte', 'project_manager']),
          a('reopen', 'Reabrir solicitudes', 'Volver a abrir una cerrada.', ['admin', 'soporte', 'project_manager']),
        ],
      },
      {
        clave: 'registro', nombre: 'Registro', acciones: [
          a('view', 'Ver el registro', 'Quién cambió qué y cuándo.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'status', nombre: 'Estado del sistema', acciones: [
          a('view', 'Ver el estado', 'Errores, piezas y correos del sistema.', ADMIN_SOPORTE),
          a('edit', 'Apuntar incidencias', 'Abrir y cerrar incidencias y cambiar el estado de cada pieza.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'credentials', nombre: 'Claves y variables', acciones: [
          a('view', 'Ver claves', 'Qué claves hay, sin verlas, y su registro.', SOPORTE),
          a('edit', 'Guardar claves', 'Guardar, probar y quitar claves de servicios.', SOPORTE),
        ],
      },
      {
        clave: 'documents', nombre: 'Documentos', acciones: [
          a('view', 'Ver documentos', 'Los documentos generados y descargarlos.', TODOS),
          a('create', 'Generar documentos', 'Generar, regenerar y reenviar documentos.', ADMIN_SOPORTE),
          a('numeracion', 'Numeración', 'Ver y cambiar el siguiente número.', ADMIN_SOPORTE),
          a('delete', 'Borrar documentos', 'Quitar un documento.', ADMIN_SOPORTE),
          a('auditar', 'Auditoría de documentos', 'Quién generó y descargó cada documento.', SOPORTE),
        ],
      },
    ],
  },
  {
    clave: 'configuracion', nombre: 'Configuración',
    recursos: [
      {
        clave: 'users', nombre: 'Usuarios', acciones: [
          a('view', 'Ver usuarios', 'La lista del equipo y su disponibilidad.', ADMIN_SOPORTE),
          a('create', 'Crear usuarios', 'Dar de alta a alguien (con su bienvenida por correo).', ADMIN_SOPORTE),
          a('edit', 'Editar usuarios', 'Datos, campus, disponibilidad y reactivar.', ADMIN_SOPORTE),
          a('delete', 'Desactivar usuarios', 'Dar de baja a alguien.', ADMIN_SOPORTE),
          a('excepciones', 'Permisos de cada persona', 'Dar o quitar permisos sueltos a personas de sus campus, y su rol a medida.', ADMIN, { requiere: ['users.view'] }),
          a('contrasena', 'Contraseña de otros', 'Ponerle contraseña a otra persona (un admin, a tutores de sus campus).', ADMIN),
          a('empresas', 'Empresas enteras y correos', 'Dar empresas enteras a un admin y cambiar el correo de alguien.', NADIE),
          a('aviso_correo', 'Aviso de cambio de correo', 'Ver el aviso que recibe quien cambia de correo.', NADIE),
        ],
      },
      {
        clave: 'roles', nombre: 'Roles y permisos', acciones: [
          a('view', 'Ver roles', 'Qué trae cada rol y los roles a medida.', ADMIN),
          // Diego, 26/10: el admin SIGUE cambiando lo que trae cada rol y los
          // roles a medida, como antes de #423; soporte, no. Y nadie le pone a un
          // rol lo que él mismo no tiene (permissions.editar.js).
          a('edit', 'Cambiar roles', 'Cambiar lo que trae un rol fijo y crear o cambiar roles a medida (para todas las empresas), sin darles lo que uno no tiene.', ADMIN),
        ],
      },
      {
        clave: 'projects', nombre: 'Proyectos', acciones: [
          a('view', 'Ver proyectos', 'Los campus, sus empresas y sus atajos.', TODOS),
          a('create', 'Crear proyectos', 'Un campus o una empresa nueva.', SOPORTE),
          a('edit', 'Configurar proyectos', 'Datos de un campus y su clave de webhook.', SOPORTE),
        ],
      },
      {
        clave: 'channels', nombre: 'Canales', acciones: [
          a('view', 'Ver canales', 'Los canales de entrada de cada campus.', TODOS),
          a('edit', 'Configurar canales', 'Crear, cambiar y quitar canales.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'field_defs', nombre: 'Campos personalizados', acciones: [
          a('view', 'Ver campos', 'Los campos de más de cada campus.', TODOS),
          a('edit', 'Configurar campos', 'Crear, ordenar y quitar campos.', ADMIN_SOPORTE),
        ],
      },
      {
        clave: 'installation', nombre: 'Instalación', acciones: [
          a('view', 'Ver la instalación', 'Qué módulos del CRM están encendidos.', TODOS),
          a('edit', 'Encender módulos', 'Encender y apagar módulos del CRM.', SOPORTE),
        ],
      },
      {
        clave: 'cuenta', nombre: 'Su cuenta', acciones: [
          a('cambiar_correo', 'Cambiar su correo', 'Cambiar el correo con el que entra (el de su factura).', ['tutor'], { propia: true }),
        ],
      },
    ],
  },
];

/** Todas las acciones, planas, con su clave entera y su sección. */
export const ACCIONES = SECCIONES.flatMap((s) => s.recursos.flatMap((r) => r.acciones.map((x) => ({
  ...x, clave: `${r.clave}.${x.accion}`, recurso: r.clave, recursoNombre: r.nombre, seccion: s.clave, seccionNombre: s.nombre,
}))));

export const CLAVES = new Set(ACCIONES.map((x) => x.clave));
export const POR_CLAVE = Object.fromEntries(ACCIONES.map((x) => [x.clave, x]));

/**
 * Lo que necesita una clave para tener sentido: lo que dice `requiere` y,
 * para todo lo que no es `view`, el `view` de su recurso si existe.
 */
export function dependencias(clave) {
  const x = POR_CLAVE[clave];
  if (!x) return [];
  const ver = `${x.recurso}.view`;
  const deps = new Set(x.requiere || []);
  if (x.accion !== 'view' && !x.independiente && CLAVES.has(ver)) deps.add(ver);
  return [...deps];
}

/** Los valores de serie de cada rol fijo: `{ rol: { clave: bool } }`. Superadmin, todo. */
export function valoresPorDefecto() {
  const out = {};
  for (const r of ROLES_FIJOS) {
    if (r.clave === 'superadmin') { out.superadmin = null; continue; }
    out[r.clave] = Object.fromEntries(ACCIONES.map((x) => [x.clave, x.roles.includes(r.clave)]));
  }
  return out;
}

/** `{ recurso: [acciones] }`, como lo esperaba quien leía ALL_RESOURCES. */
export function recursos() {
  const out = {};
  for (const x of ACCIONES) (out[x.recurso] ||= []).push(x.accion);
  return out;
}

/** El catálogo para la pantalla: secciones con sus recursos y acciones, y los roles fijos. */
export function catalogoParaPantalla() {
  return {
    roles: ROLES_FIJOS,
    secciones: SECCIONES.map((s) => ({
      clave: s.clave, nombre: s.nombre,
      recursos: s.recursos.map((r) => ({
        clave: r.clave, nombre: r.nombre,
        acciones: r.acciones.map((x) => {
          const clave = `${r.clave}.${x.accion}`;
          return {
            clave, accion: x.accion, nombre: x.nombre, descripcion: x.descripcion,
            roles: x.roles, requiere: dependencias(clave), nunca: x.nunca || [], nuncaPrincipal: x.nuncaPrincipal || [],
            soloPantalla: x.soloPantalla === true,
          };
        }),
      })),
    })),
  };
}

/**
 * ¿No se le puede dar esta acción a esta persona, ni con excepción? Su `nunca`
 * (todos sus roles en la lista) o su `nuncaPrincipal` (su rol principal).
 */
export function vetada(x, role, rolesExtra = []) {
  const todos = [...new Set([role, ...rolesExtra].filter(Boolean))];
  if (x.nunca?.length && todos.length && todos.every((r) => x.nunca.includes(r))) return true;
  return Boolean(x.nuncaPrincipal?.includes(role));
}
