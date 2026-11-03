/**
 * Las comprobaciones de rol que viven DENTRO de controladores y servicios (#423).
 *
 * El inventario de rutas (`rutas.js`) solo ve los guardias. Esto es lo que no
 * ve: el `if (!isAdmin(req)) throw 403` en mitad de una función. Cada entrada
 * dice en qué funciones está (`controladores`, del módulo), qué regla aplica
 * —una de `legado.manual`, copia congelada de la del fichero— y, si solo se
 * aplica a veces, cuándo (`condicion`).
 *
 * - Sin `condicion`: se suma a los guardias de la ruta. Para entrar hacen falta
 *   los dos.
 * - Con `condicion`: es otra acción dentro de la misma ruta («emitir una
 *   rectificativa» dentro de «crear factura») y se cuenta aparte.
 *
 * `ALCANCE` son las que deciden SOBRE QUÉ datos —la gestora ve sus prospectos,
 * el admin sus campus— y no si se entra. Se apuntan para que se vean en
 * `docs/PERMISOS.md`, pero no son permisos y #423 no las toca.
 */

export const PUERTAS = [
  // ── Facturación ──
  {
    id: 'invoices.administrar', modulo: 'invoices', regla: 'facturasAdministrar',
    donde: 'invoices.controller.js · isAdmin(req)',
    controladores: ['createIssuer', 'updateIssuer', 'deleteIssuer', 'uploadIssuerLogo', 'deleteIssuerLogo',
      'createRegimen', 'updateRegimen', 'deleteRegimen', 'createTemplate', 'updateTemplate', 'deleteTemplate',
      'setSequence', 'updateConfig'],
  },
  {
    id: 'invoices.gestionar', modulo: 'invoices', regla: 'facturasGestionar',
    donde: 'invoices.model.js · puedeGestionarFactura',
    controladores: ['corregir', 'asociarVenta', 'destroy', 'rectificar'],
    alcance: 'la gestora, solo las facturas de sus prospectos (FACTURA_DE)',
  },
  {
    id: 'invoices.fechas', modulo: 'invoices', regla: 'facturasFechas',
    donde: 'invoices.model.js · puedeEditarFechas', controladores: ['updateFechas'],
  },
  {
    id: 'invoices.cola', modulo: 'invoices', regla: 'facturasCola',
    donde: 'invoices.controller.js · esFacturaManager',
    controladores: ['setFacturacionAlDia', 'generarDeCola', 'emitirColaHasta', 'cobrarProforma'],
    alcance: 'cobrar proforma: la gestora, solo las suyas',
  },
  {
    id: 'invoices.rectificativa', modulo: 'invoices', regla: 'facturasRectificar',
    donde: 'invoices.controller.js · create', controladores: ['create'],
    condicion: 'la factura es rectificativa (de abono)',
  },
  {
    id: 'invoices.proforma_sin_aprobacion', modulo: 'invoices', regla: 'facturasEmitir',
    donde: 'invoices.controller.js · create', controladores: ['create'],
    condicion: 'una proforma sin esperar visto bueno (si no, queda pendiente de aprobar; no da 403)',
  },
  {
    id: 'conversions.emitir_al_cobrar', modulo: 'conversions', regla: 'facturasEmitir',
    donde: 'conversion.service.js · autoInvoice (puedeEmitirFactura)', controladores: ['addPayment'],
    condicion: 'que el cobro salga ya facturado (si no, queda en la cola; no da 403)',
  },

  // ── Certifex ──
  {
    id: 'certifex.imprenta', modulo: 'certifex', regla: 'adminConExtras',
    donde: 'certifex.emisiones.js · diploma', controladores: ['diploma'],
    condicion: 'el diploma en formato de imprenta',
  },

  // ── Prospectos ──
  {
    id: 'leads.borrar_cualquiera', modulo: 'leads', regla: 'adminYSoporteConExtras',
    donde: 'lead.controller.js · softDelete', controladores: ['softDelete'],
    condicion: 'borrar por cualquier motivo, aunque no sea suyo o tenga ventas',
  },

  // ── Tutores ──
  {
    id: 'tutores.gestionar', modulo: 'tutores', regla: 'tutoresGestionar',
    donde: 'tutor.controller.js · exigirGestion',
    controladores: ['listar', 'alta', 'crearColaboracion', 'editarColaboracion', 'cambiarCobraDesde',
      'borrarColaboracion', 'ajustes', 'calcular', 'formacionesSinTutor', 'marcarBusqueda',
      'anunciosDeTutores', 'pagosSinFormacion', 'retirarTutor', 'reactivarTutor', 'cambiarEstadoComision',
      // Sus campus y empresas (#187, staging 22/10): exigirTutorGestionable.
      'asignarCampus', 'comprobarCampus', 'asignarEmpresa', 'quitarEmpresa', 'cambiarDisponible'],
  },
  {
    id: 'tutores.ficha_ajena', modulo: 'tutores', regla: 'tutoresGestionar',
    donde: 'tutor.controller.js · exigirGestion', controladores: ['ficha', 'guardarPerfil', 'campusDelTutor'],
    condicion: 'la ficha de otro tutor (la suya, el tutor siempre)',
  },
  {
    id: 'tutores.lo_suyo', modulo: 'tutores', regla: 'tutoresLoSuyo',
    donde: 'tutor.controller.js · esTutor || exigirGestion',
    controladores: ['colaboraciones', 'simulacion', 'listarComisiones', 'resumenComisiones', 'cursoDetalle', 'brochureDelCurso'],
    alcance: 'el tutor, solo lo suyo',
  },
  {
    id: 'tutores.correo', modulo: 'tutores', regla: 'soloSuperadmin',
    donde: 'tutor.controller.js · guardarPerfil', controladores: ['guardarPerfil'],
    condicion: 'cambiar el correo del tutor',
  },
  {
    id: 'tutores.administrar', modulo: 'tutores', regla: 'tutoresAdministrar',
    donde: 'tutor.controller.js', controladores: ['guardarAjustes', 'liquidar', 'revertirComision', 'cambiarContrasena'],
  },

  // ── Consultas de alumnos (#188, staging 22/10) ──
  {
    id: 'consultas.administracion', modulo: 'consultas', regla: 'consultasAdministracion',
    donde: 'consultas.controller.js · esAdministracion / exigirVer(…) === «admin»',
    controladores: ['panel', 'leerAhora', 'panelDeTutores', 'sincronizarAlumnosAhora', 'campusSinTutor',
      'tutoresPosibles', 'reasignar'],
    alcance: 'el admin, solo las consultas de sus campus',
  },
  {
    id: 'consultas.tutor', modulo: 'consultas', regla: 'consultasTutor',
    donde: 'consultas.controller.js · esTutorUsuario', controladores: ['miCarga', 'guardarMiCarga'],
  },
  {
    id: 'consultas.lo_suyo', modulo: 'consultas', regla: 'consultasTutor',
    donde: 'consultas.controller.js · quienYAmbito (sin ?todas)', controladores: ['alumnosSinMensajes', 'verMetricas'],
    alcance: 'el tutor, solo lo suyo',
  },
  {
    id: 'consultas.las_de_todos', modulo: 'consultas', regla: 'consultasAdministracion',
    donde: 'consultas.controller.js · quienYAmbito (?todas=1)', controladores: ['alumnosSinMensajes', 'verMetricas'],
    condicion: 'las de todos los tutores (?todas=1)',
  },
  {
    id: 'consultas.token_del_tutor', modulo: 'consultas', regla: 'consultasGestionTutor',
    donde: 'consultas.controller.js · exigirGestionDelTutor', controladores: ['tokensDelTutor', 'guardarToken'],
    alcance: 'el admin, solo los campus que comparte con el tutor',
  },

  // ── Usuarios ──
  {
    id: 'users.empresas', modulo: 'users', regla: 'soloSuperadmin',
    donde: 'user.controller.js · create/update', controladores: ['create', 'update'],
    condicion: 'dar empresas enteras a un admin, o cambiar el correo de alguien',
  },
  {
    // Nueva en #423: antes no había comprobación (bastaba con poder editar
    // usuarios). Por eso su regla de antes es «sí».
    id: 'users.cambiar_rol', modulo: 'users', regla: 'siempre',
    donde: 'user.controller.js · update (cambiaQuienEs)', controladores: ['update'],
    condicion: 'cambiar el rol, los roles de más o «se dedica a colaboraciones» de alguien',
  },
  {
    id: 'users.contrasena_ajena', modulo: 'users', regla: 'soloAdmin',
    donde: 'user.controller.js · setPassword', controladores: ['setPassword'],
    alcance: 'el admin, solo a tutores de sus campus; el superadmin, a cualquiera',
  },

  // ── MCP ──
  {
    id: 'mcp.usar', modulo: 'mcp', regla: 'mcpUsar',
    donde: 'mcp.acceso.js · puedeUsarMcp',
    controladores: ['crearToken', 'crearCodigo', 'desbloquearUrl', 'atenderPeticion'],
  },
  {
    id: 'mcp.rechazar_ajenas', modulo: 'mcp', regla: 'soloSuperadmin',
    donde: 'mcp.conexiones.js · decidir', controladores: ['decidirConexion'],
    condicion: 'rechazar un Claude conectado a la URL de otra persona',
  },

  // ── WhatsApp ──
  {
    id: 'whatsapp.usar', modulo: 'whatsapp', regla: 'whatsappUsar',
    donde: 'chat.controller.js · usuarioObjetivo (rol con WhatsApp + casilla usa_whatsapp)',
    controladores: ['chats', 'etiquetasDeWhatsapp', 'chat', 'enviar', 'abrirChat', 'ficha', 'adjunto',
      'descargarAdjunto', 'noEscribir', 'etiquetarChat', 'registrarLlamada', 'respuestaLlamada',
      'guardarRespuestaLlamada', 'sincronizacion', 'reintentarArchivos', 'desconectar', 'conexion',
      'emparejar', 'sinLeer', 'traerHistorial', 'reenviar', 'editarMensaje'],
  },
  {
    id: 'whatsapp.banco', modulo: 'whatsapp', regla: 'whatsappBanco',
    donde: 'chat.controller.js · sesionesQuePuedeMirar', controladores: ['banco', 'bancoNumeros'],
    alcance: 'admin y superadmin, todas las líneas; el resto, la suya',
  },
  {
    id: 'whatsapp.supervisar', modulo: 'whatsapp', regla: 'whatsappSupervisar',
    donde: 'chat.controller.js · usuarioObjetivo (usuarioId ajeno)', controladores: ['chats', 'chat', 'enviar'],
    condicion: 'trabajar sobre la sesión de otra persona',
    alcance: 'el admin, solo quien comparta campus con él',
  },
  {
    id: 'whatsapp.plantillas_compartidas', modulo: 'whatsapp', regla: 'adminYSoporte',
    donde: 'whatsapp.controller.js · createTemplate/permitida',
    controladores: ['createTemplate', 'updateTemplate', 'deleteTemplate'],
    condicion: 'plantillas compartidas o de otra persona',
  },

  // ── Ventas ──
  {
    id: 'sales.sin_gestora', modulo: 'sales', regla: 'ventaSinGestora',
    donde: 'sales.controller.js · resolvePermission(conversions.sin_gestora)', controladores: ['create'],
    condicion: 'registrar una venta que no es de nadie («sin gestora»)',
  },

  // ── Conectores y webhooks de salida ──
  {
    id: 'connectors.sistema', modulo: 'connectors', regla: 'soloSuperadmin',
    donde: 'connectors.controller.js · esSuperadmin', controladores: ['create', 'update', 'remove'],
    condicion: 'conectores de todo el sistema (alcance «sistema»)',
  },
  {
    id: 'webhooks-salientes.todas', modulo: 'webhooks-salientes', regla: 'soloSuperadmin',
    donde: 'webhooks-salientes.controller.js · esSuperadmin', controladores: ['crear', 'cambiar'],
    condicion: 'webhooks para todas las empresas',
  },

  // ── Lo de cada uno ──
  {
    id: 'auth.correo_propio', modulo: 'auth', regla: 'soloTutor',
    donde: 'auth.controller.js · updateMyEmail', controladores: ['updateMyEmail'],
  },
  {
    id: 'reports.puesto_ajeno', modulo: 'reports', regla: 'adminYSoporte',
    donde: 'report.controller.js · miPuesto', controladores: ['miPuesto'],
    condicion: 'ver el puesto de otra gestora (gestoraId)',
  },
];

/**
 * Las que YA preguntan al mapa de permisos, dentro del servicio. No hace falta
 * convertirlas: ya obedecen al catálogo (y #423 solo cambia de dónde sale el mapa).
 */
export const YA_CON_PERMISO = [
  { modulo: 'tasks', donde: 'tasks.service.js · permisosDe (buildPermissionsMap)', que: 'cada acción del tablero mira su clave tasks.* (ver todo, ver lo suyo, crear, asignar, editar, borrar, aprobar, configurar)' },
];

/** Las de «sobre qué datos». No son permisos: se documentan y no se tocan. */
export const ALCANCE = [
  { modulo: 'leads', donde: 'lead.controller.js · list, quickCounts, revisar, stats, exportWasapi, exigirQueSeaSuyo', que: 'la gestora solo ve y toca sus prospectos (responsable)' },
  { modulo: 'leads', donde: 'lead.service.js · updateInteraction/deleteInteraction', que: 'la gestora solo edita sus propias interacciones' },
  { modulo: 'conversions', donde: 'conversion.controller.js · list, cuotas, filas, removePayment, remove, listProductos', que: 'la gestora solo ve y toca sus ventas' },
  { modulo: 'sales', donde: 'sales.controller.js · topProducts, facturado, desglose', que: 'la gestora solo cuenta sus ventas' },
  { modulo: 'sales', donde: 'sales.goals.js · setGoal/deleteGoal', que: 'la gestora solo pone y borra su propia meta' },
  { modulo: 'accounting', donde: 'accounting.controller.js · receivable', que: 'la gestora solo ve lo suyo' },
  { modulo: 'invoices', donde: 'invoices.controller.js · list', que: 'la gestora solo ve sus facturas; filtrar por empresa, solo admin' },
  { modulo: 'feedback', donde: 'feedback.controller.js · exigirQueSeaSuyo', que: 'la gestora solo toca el correo de sus prospectos' },
  { modulo: 'whatsapp', donde: 'whatsapp.controller.js · cola; chat.controller.js · usuarios', que: 'la gestora, su cola y su sesión' },
  { modulo: 'proceso', donde: 'proceso.controller.js · deQuienEsLaCola; proceso.ambito.js', que: 'de quién es la cola y qué campus entran' },
  { modulo: 'notifications', donde: 'notifications.service.js · visibilityClause', que: 'qué avisos ve cada uno' },
  { modulo: '(todo el CRM)', donde: 'shared/utils/ambito.js · veTodoElCrm, proyectosDelAmbito; projectAccess', que: 'superadmin y soporte ven todos los campus; el resto, los suyos' },
  { modulo: 'users', donde: 'user.controller.js · uploadAvatar/deleteAvatar; user.views.controller.js · canEdit', que: 'cada uno su foto y su vista; el superadmin, la de cualquiera' },
  { modulo: 'mcp', donde: 'mcp.controller.js · cambiarAcceso; mcp.model.js · listarPersonas', que: 'el admin, solo personas de sus campus' },
  { modulo: 'expenses', donde: 'expense.service.js', que: 'gastos de los campus de cada uno' },
  { modulo: 'certifex', donde: 'certifex.alcance.js', que: 'diplomas de los campus de cada uno' },
  { modulo: 'tutores', donde: 'tutor.controller.js · exigirTutorDeMisCampus', que: 'fichas de tutores de sus campus' },
  { modulo: 'facturas-colaborador', donde: 'facturas-colaborador.service.js · ambitoDe', que: 'facturas de las empresas de sus campus' },
  { modulo: 'consultas', donde: 'consultas.controller.js · exigirVer, escribirAlAlumno', que: 'cada consulta, su tutor; administración, las de sus campus (superadmin y soporte, todas)' },
  { modulo: 'webhook-tokens', donde: 'token.controller.js · comprobarCampus', que: 'cada admin, los webhooks de sus campus; el superadmin, todos' },
];
