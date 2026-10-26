// Matriz de permisos por defecto para los 4 roles fijos del sistema.
// Los roles custom parten de estos defaults según su base_role y luego
// los sobreescriben con su propio JSONB permissions.

export const SYSTEM_ROLE_DEFAULTS = {
  superadmin: null, // null = acceso total, se maneja antes de consultar esto

  admin: {
    'leads.view': true, 'leads.create': true, 'leads.edit': true, 'leads.delete': true,
    'leads.export': true, 'leads.assign': true, 'leads.bulk_action': true,
    'conversions.view': true, 'conversions.create': true, 'conversions.edit': true, 'conversions.delete': true,
    // Registrar una venta que no es de nadie. Ver el comentario de gestor.
    'conversions.sin_gestora': true,
    'products.view': true, 'products.create': true, 'products.edit': true, 'products.delete': true,
    'clients.view': true, 'clients.create': true, 'clients.edit': true, 'clients.delete': true, 'clients.export': true,
    'dossiers.view': true, 'dossiers.upload': true, 'dossiers.delete': true,
    'commissions.view': true, 'commissions.create': true, 'commissions.edit': true, 'commissions.delete': true,
    'matriculas.view': true, 'matriculas.create': true, 'matriculas.edit': true, 'matriculas.delete': true,
    'accounting.view': true, 'accounting.create': true, 'accounting.edit': true, 'accounting.delete': true,
    'accounts_payable.view': true, 'accounts_payable.create': true, 'accounts_payable.edit': true, 'accounts_payable.delete': true,
    'payroll.view': true, 'payroll.create': true, 'payroll.edit': true, 'payroll.delete': true,
    // Facturas de colaboradores (#202): las de las empresas de sus campus. «Marcar pagada», solo un admin.
    'facturas_colaborador.ver_todas': true, 'facturas_colaborador.gestionar': true, 'facturas_colaborador.anular': true, 'facturas_colaborador.pagar': true, 'facturas_colaborador.subir': false,
    'reports.view': true, 'reports.export': true,
    'ia.view': true,
    'woocommerce.view': true, 'woocommerce.sync': true,
    'webhooks.view': true, 'webhooks.create': true, 'webhooks.edit': true, 'webhooks.delete': true,
    'forms.view': true, 'forms.create': true, 'forms.edit': true, 'forms.delete': true,
    'email_sequences.view': true, 'email_sequences.create': true, 'email_sequences.edit': true, 'email_sequences.delete': true,
    'users.view': false, 'users.create': false, 'users.edit': false, 'users.delete': false,
    'settings.view': true, 'settings.edit': true,
    'field_defs.view': true, 'field_defs.edit': true,
    'channels.view': true, 'channels.edit': true,
    'roles.view': true, 'roles.edit': false,
    'tasks.view_all': true, 'tasks.view_own': true, 'tasks.create': true, 'tasks.assign': true, 'tasks.edit': true, 'tasks.delete': true, 'tasks.close': true, 'tasks.manage': true, 'tasks.manage_teams': true,
    // Diplomas de Certifex (#223, gemela de MultiCRM #384): VER la pantalla, en solo
    // lectura. El admin la ve y la maneja por su rol; esto es para darsela a quien no lo es.
    'diplomas.view': true,
    // EMITIR diplomas (Diego, 22/10/2026: «que Dayana pueda emitir»; la misma clave que en
    // MultiCRM). El admin ya emite por su rol; la clave es para darsela a quien no lo es.
    'diplomas.emit': true,
    // Meta Ads, solo ver (26/10/2026). El admin la ve por su rol; la clave es para dársela a otro.
    'meta_ads.view': true,
  },

  gestor: {
    'leads.view': true, 'leads.create': true, 'leads.edit': true, 'leads.delete': false,
    'leads.export': false, 'leads.assign': false, 'leads.bulk_action': false,
    'conversions.view': true, 'conversions.create': true, 'conversions.edit': true, 'conversions.delete': false,
    // VENTA SIN GESTORA. Apagado de serie para gestor y se enciende por
    // persona desde el panel de permisos.
    //
    // Hay gestoras que llevan la contabilidad de su empresa y registran ventas
    // que no son suyas: hoy el alta se las asigna a ellas --el creador gestor
    // se queda el lead-- y el informe dice que vendieron lo que solo
    // apuntaron. Con esto pueden decir que la venta no es de nadie.
    'conversions.sin_gestora': false,
    'products.view': true, 'products.create': false, 'products.edit': false, 'products.delete': false,
    'clients.view': true, 'clients.create': true, 'clients.edit': true, 'clients.delete': false, 'clients.export': false,
    'dossiers.view': true, 'dossiers.upload': false, 'dossiers.delete': false,
    'commissions.view': true, 'commissions.create': false, 'commissions.edit': false, 'commissions.delete': false,
    'matriculas.view': true, 'matriculas.create': true, 'matriculas.edit': true, 'matriculas.delete': false,
    'accounting.view': false, 'accounting.create': false, 'accounting.edit': false, 'accounting.delete': false,
    'accounts_payable.view': false, 'accounts_payable.create': false, 'accounts_payable.edit': false, 'accounts_payable.delete': false,
    'payroll.view': false, 'payroll.create': true, 'payroll.edit': false, 'payroll.delete': false,
    // Facturas de colaboradores (#202): no las ve.
    'facturas_colaborador.ver_todas': false, 'facturas_colaborador.gestionar': false, 'facturas_colaborador.anular': false, 'facturas_colaborador.pagar': false, 'facturas_colaborador.subir': false,
    'reports.view': false, 'reports.export': false,
    'ia.view': false,
    'woocommerce.view': false, 'woocommerce.sync': false,
    'webhooks.view': false, 'webhooks.create': false, 'webhooks.edit': false, 'webhooks.delete': false,
    'forms.view': false, 'forms.create': false, 'forms.edit': false, 'forms.delete': false,
    'email_sequences.view': false, 'email_sequences.create': false, 'email_sequences.edit': false, 'email_sequences.delete': false,
    'users.view': false, 'users.create': false, 'users.edit': false, 'users.delete': false,
    'settings.view': false, 'settings.edit': false,
    'field_defs.view': false, 'field_defs.edit': false,
    'channels.view': true, 'channels.edit': false,
    'roles.view': false, 'roles.edit': false,
    // Sin tablero (Diego, 09/10: «las gestoras no tienen tareas»): ni menú ni API.
    'tasks.view_all': false, 'tasks.view_own': false, 'tasks.create': false, 'tasks.assign': false, 'tasks.edit': false, 'tasks.delete': false, 'tasks.close': false, 'tasks.manage': false, 'tasks.manage_teams': false,
    // Diplomas de Certifex (#223): apagado de serie; se da por rol o por persona
    // desde Configuración › Roles. Solo VER, y solo sus campus.
    'diplomas.view': false,
    // EMITIR (22/10/2026): apagado de serie; se da igual, por rol o por persona.
    // Revisar, pasar a Pendientes, aprobar y emitir y enviar el diploma al
    // alumno, siempre en sus campus. Rechazar, corregir y revocar, no.
    'diplomas.emit': false,
  },

  soporte: {
    'leads.view': true, 'leads.create': true, 'leads.edit': true, 'leads.delete': false,
    'leads.export': false, 'leads.assign': false, 'leads.bulk_action': false,
    'conversions.view': true, 'conversions.create': false, 'conversions.edit': false, 'conversions.delete': false,
    'products.view': true, 'products.create': false, 'products.edit': false, 'products.delete': false,
    'clients.view': true, 'clients.create': false, 'clients.edit': false, 'clients.delete': false, 'clients.export': false,
    'dossiers.view': true, 'dossiers.upload': false, 'dossiers.delete': false,
    'commissions.view': false, 'commissions.create': false, 'commissions.edit': false, 'commissions.delete': false,
    'matriculas.view': true, 'matriculas.create': false, 'matriculas.edit': false, 'matriculas.delete': false,
    'accounting.view': false, 'accounting.create': false, 'accounting.edit': false, 'accounting.delete': false,
    'accounts_payable.view': false, 'accounts_payable.create': false, 'accounts_payable.edit': false, 'accounts_payable.delete': false,
    'payroll.view': false, 'payroll.create': false, 'payroll.edit': false, 'payroll.delete': false,
    // Facturas de colaboradores (#202): no las ve.
    'facturas_colaborador.ver_todas': false, 'facturas_colaborador.gestionar': false, 'facturas_colaborador.anular': false, 'facturas_colaborador.pagar': false, 'facturas_colaborador.subir': false,
    'reports.view': true, 'reports.export': false,
    'ia.view': true,
    'woocommerce.view': false, 'woocommerce.sync': false,
    'webhooks.view': true, 'webhooks.create': false, 'webhooks.edit': false, 'webhooks.delete': false,
    'forms.view': true, 'forms.create': false, 'forms.edit': false, 'forms.delete': false,
    'email_sequences.view': false, 'email_sequences.create': false, 'email_sequences.edit': false, 'email_sequences.delete': false,
    'users.view': false, 'users.create': false, 'users.edit': false, 'users.delete': false,
    'settings.view': false, 'settings.edit': false,
    'field_defs.view': false, 'field_defs.edit': false,
    'channels.view': true, 'channels.edit': false,
    'roles.view': false, 'roles.edit': false,
    // Sin tablero (Diego, 09/10: «las gestoras no tienen tareas»): ni menú ni API.
    'tasks.view_all': false, 'tasks.view_own': false, 'tasks.create': false, 'tasks.assign': false, 'tasks.edit': false, 'tasks.delete': false, 'tasks.close': false, 'tasks.manage': false, 'tasks.manage_teams': false,
    // Diplomas de Certifex (#223): no los ve (como hasta ahora), ni los emite.
    'diplomas.view': false,
    'diplomas.emit': false,
  },
  // Colaborador (#210, fase 5): solo su tablero de tareas. Lo que no esta aqui
  // es «no»: `resolvePermission` solo da por bueno un `true` explicito, y el
  // servidor le corta el resto de rutas en `verifyToken`.
  colaborador: {
    'tasks.view_all': false, 'tasks.view_own': true, 'tasks.create': true, 'tasks.assign': false, 'tasks.edit': true, 'tasks.delete': false, 'tasks.close': false, 'tasks.manage': false, 'tasks.manage_teams': false,
    // Facturas de colaboradores (#202): sube la suya («Mi factura»), y nada de administración.
    'facturas_colaborador.ver_todas': false, 'facturas_colaborador.gestionar': false, 'facturas_colaborador.anular': false, 'facturas_colaborador.pagar': false, 'facturas_colaborador.subir': true,
    // Diplomas de Certifex (#223): no.
    'diplomas.view': false,
    'diplomas.emit': false,
    // Meta Ads (26/10/2026): no de serie; se da por persona a quien la necesita.
    'meta_ads.view': false,
  },
};

export const ALL_RESOURCES = {
  leads:            ['view', 'create', 'edit', 'delete', 'export', 'assign', 'bulk_action'],
  conversions:      ['view', 'create', 'edit', 'delete'],
  products:         ['view', 'create', 'edit', 'delete'],
  clients:          ['view', 'create', 'edit', 'delete', 'export'],
  dossiers:         ['view', 'upload', 'delete'],
  commissions:      ['view', 'create', 'edit', 'delete'],
  matriculas:       ['view', 'create', 'edit', 'delete'],
  accounting:       ['view', 'create', 'edit', 'delete'],
  accounts_payable: ['view', 'create', 'edit', 'delete'],
  payroll:          ['view', 'create', 'edit', 'delete'],
  facturas_colaborador: ['ver_todas', 'gestionar', 'anular', 'pagar', 'subir'],
  reports:          ['view', 'export'],
  ia:               ['view'],
  woocommerce:      ['view', 'sync'],
  webhooks:         ['view', 'create', 'edit', 'delete'],
  forms:            ['view', 'create', 'edit', 'delete'],
  email_sequences:  ['view', 'create', 'edit', 'delete'],
  users:            ['view', 'create', 'edit', 'delete'],
  settings:         ['view', 'edit'],
  field_defs:       ['view', 'edit'],
  channels:         ['view', 'edit'],
  roles:            ['view', 'edit'],
  // manage_teams (26/10/2026): crear y archivar equipos del tablero, sus cargos y sus miembros.
  tasks:            ['view_all', 'view_own', 'create', 'assign', 'edit', 'delete', 'close', 'manage', 'manage_teams'],
  // Diplomas de Certifex (#223). `view`: verlos. `emit` (Diego, 22/10/2026):
  // revisar, pasar a Pendientes, aprobar y emitir y enviar el diploma al
  // alumno; quien emite tambien ve. Rechazar, corregir, revocar, la firma y el
  // A3 de imprenta siguen siendo de admin y superadmin, por su rol.
  diplomas:         ['view', 'emit'],
  // Meta Ads, solo VER (Diego, 26/10/2026: «en Meta tendrán acceso Ruth, Julián,
  // Jesús, Emmanuel…»). Conectar cuentas, sincronizar y asociar siguen siendo de
  // admin y superadmin, por su rol. Solo lo de sus campus.
  meta_ads:         ['view'],
};
