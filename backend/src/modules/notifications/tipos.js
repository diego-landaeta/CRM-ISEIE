/**
 * Que es cada aviso: si pide hacer algo o solo contarlo (#111).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTO EXISTE
 *
 * Diego, el 07/09, mirando el centro de notificaciones: 98 sin leer y casi
 * todas la misma —«Revisión diaria: hay cosas sin atar»—, repetida cada día
 * con el mismo texto. Lo dijo asi: «si todo avisa, nada avisa».
 *
 * El problema de fondo no es el numero. Es que «Tienes un prospecto nuevo» y
 * «revision diaria» estan en la misma lista, y no son lo mismo: uno pide que
 * alguien haga algo, el otro solo cuenta que ha pasado. Mezclados, el que pide
 * accion se pierde entre los que no.
 *
 * Asi que cada tipo dice de que va, y eso lo usan la campana, la lista y las
 * preferencias. Aqui y en ningun otro sitio: si la clasificacion vive en tres
 * ficheros, acaba diciendo tres cosas distintas —ya paso con las consultas del
 * reparto—.
 *
 * SOBRE `agrupa`
 *
 * Un aviso que se repite con el mismo texto se agrupa en una fila («×98, la
 * ultima hace 2h»). Uno que habla de una ficha concreta, no: seis prospectos
 * nuevos son seis cosas que hacer, no una.
 *
 * AL PORTARLO: ESTE MAPA NO SE COPIA TAL CUAL
 *
 * Aqui hay once porque este CRM emite once. ISEIE emite cinco: no tiene el
 * vigilante de catalogo —de donde salen las «Revisión diaria» repetidas—, ni el
 * reparto que avisa de prospecto asignado, ni el cobro de Stripe que cierra
 * ventas solo.
 *
 * Copiar los once alli seria repetir el fallo que este ticket arregla: la
 * pantalla de preferencias tenia siete interruptores para tipos que no existen,
 * asi que apagabas y no apagabas nada. El mapa se rehace con
 * `grep -rn "notifyAdmins({\|notifyUsers({" -A 6 backend/src` de cada
 * repositorio. Todo lo demas de este fichero vale igual en los dos.
 *
 * SOBRE LOS TIPOS QUE NO ESTAN AQUI
 *
 * Salen igual, como aviso y sin agrupar, con el nombre crudo por etiqueta. Un
 * tipo nuevo que se le olvide a alguien apuntar aqui tiene que verse —feo,
 * pero verse—, no desaparecer de la campana.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Pide que alguien haga algo. Va arriba y cuenta para el globo de la campana. */
export const ACCION = 'accion';
/** Solo cuenta lo que ha pasado. Va aparte y no marca el globo. */
export const AVISO = 'aviso';

export const TIPOS = {
  // ── Hacer ──
  lead_asignado: {
    clase: ACCION, etiqueta: 'Prospecto asignado', agrupa: false,
    descripcion: 'Cuando el reparto te adjudica una ficha',
  },
  lead_reasignado: {
    clase: ACCION, etiqueta: 'Prospecto reasignado', agrupa: false,
    descripcion: 'Cuando una ficha cambia de responsable, a quien la recibe y a quien la pierde',
  },
  lead_sin_tocar: {
    clase: ACCION, etiqueta: 'Prospecto sin tocar', agrupa: false,
    descripcion: 'Lleva demasiados días sin una interacción',
  },
  lead_reminder: {
    clase: ACCION, etiqueta: 'Recordatorio', agrupa: false,
    descripcion: 'Un recordatorio que pusiste ha vencido',
  },
  ticket_nuevo: {
    clase: ACCION, etiqueta: 'Ticket de soporte', agrupa: false,
    descripcion: 'Alguien del equipo ha reportado una averia o pedido algo',
  },
  // CRM#820: alguien pide un alta, un permiso, un campus o Claude. Le llega a
  // soporte y a los admins del campus que puedan verlo; hay que prepararlo.
  acceso_pedido: {
    clase: ACCION, etiqueta: 'Petición de acceso', agrupa: false,
    descripcion: 'Alguien del equipo pide un alta, un permiso, un campus o Claude',
  },
  // Y a quien la pidió, cuando soporte la mueve: en preparación, hecha o rechazada.
  acceso_respondido: {
    clase: AVISO, etiqueta: 'Tu petición de acceso', agrupa: false,
    descripcion: 'Soporte ha movido una petición de acceso tuya',
  },
  dup_review_pending: {
    clase: ACCION, etiqueta: 'Duplicados por revisar', agrupa: true,
    descripcion: 'Hay fichas esperando en la cola de revisión',
  },
  // Una versión nueva del CRM (Diego, 28/09). Pide algo —leerla— y por eso va
  // arriba y cuenta en la campana hasta que se abre. Una por versión.
  novedades: {
    clase: ACCION, etiqueta: 'Novedades del CRM', agrupa: false,
    descripcion: 'Cuando sale una versión nueva, con todo lo que trae',
  },
  // Una consulta desde la web de Certifex: un centro que quiere inscribir su campus,
  // o cualquier otra. Alguien tiene que contestar (modulo certifex).
  certifex_consulta: {
    clase: ACCION, etiqueta: 'Consulta desde Certifex', agrupa: false,
    descripcion: 'Un centro quiere inscribir su campus, o alguien escribe desde la web de Certifex',
  },
  // Un alumno pide su diploma desde Moodle (#272). Alguien de administracion tiene que
  // revisar el nombre y aprobarlo o rechazarlo en el panel Diplomas.
  certifex_solicitud: {
    clase: ACCION, etiqueta: 'Solicitud de diploma', agrupa: false,
    descripcion: 'Un alumno termina su formación y pide su diploma desde Moodle',
  },
  // Moodle da una formacion por terminada y el alumno aun no ha pedido el diploma (#272).
  // Solo lo cuenta: lo que se aprueba e imprime sale de la solicitud del alumno.
  certifex_completado: {
    clase: AVISO, etiqueta: 'Formación terminada sin pedir diploma', agrupa: false,
    descripcion: 'Moodle da la formación por terminada y el alumno aún no ha pedido su diploma',
  },
  // Confirmación de datos del diploma (#768): a administración del campus, cuando el
  // alumno confirma o corrige sus datos, vence su plazo o lo corregido no entra en Certifex.
  diploma_confirmacion: {
    clase: ACCION, etiqueta: 'Datos del diploma confirmados', agrupa: false,
    descripcion: 'Un alumno confirma o corrige los datos de su diploma, o vence el plazo para hacerlo',
  },
  rfc_created: {
    clase: ACCION, etiqueta: 'Solicitud de cambio', agrupa: false,
    descripcion: 'Alguien pide un cambio y hace falta aprobarlo',
  },
  // El gasto de IA del mes cruza el 80 % o el 100 % del tope (#30, #22). Solo a los
  // super admin, una vez por umbral y mes. Pide algo —decidir si se sube
  // IA_TOPE_MENSUAL_USD—, porque al 100 % la IA se para hasta el día 1.
  ia_tope_gasto: {
    clase: ACCION, etiqueta: 'Tope de gasto de IA', agrupa: false,
    descripcion: 'El gasto de IA del mes llega al 80 % o al 100 % del tope; al 100 % la IA se para hasta el día 1',
  },
  // Disputas de Stripe (#396): a los admins de la empresa del campus y a los
  // super admin. Una por disputa; la respuesta se da en Stripe.
  stripe_disputa: {
    clase: ACCION, etiqueta: 'Disputa de Stripe', agrupa: false,
    descripcion: 'Entra una disputa (contracargo) en la cuenta de Stripe de uno de tus campus',
  },
  stripe_disputa_vence: {
    clase: ACCION, etiqueta: 'Disputa de Stripe a punto de vencer', agrupa: false,
    descripcion: 'Una disputa sigue sin respuesta en Stripe y vence en pocos días',
  },
  task_asignada: {
    clase: ACCION, etiqueta: 'Tarea asignada', agrupa: false,
    descripcion: 'Cuando te asignan una tarea del equipo',
  },
  // Devuelta desde «Por revisar»: hay que hacer lo que dice el comentario.
  task_devuelta: {
    clase: ACCION, etiqueta: 'Tarea devuelta', agrupa: false,
    descripcion: 'Cuando revisan una tarea tuya y la devuelven a «En curso» con lo que falta',
  },

  // ── Saber ──
  task_estado_cambiado: {
    clase: AVISO, etiqueta: 'Estado de tarea', agrupa: false,
    descripcion: 'Cuando una tarea creada o seguida por ti cambia de estado',
  },
  task_comentario: {
    clase: AVISO, etiqueta: 'Comentario en tarea', agrupa: false,
    descripcion: 'Cuando alguien comenta en una tarea que tienes asignada o creaste',
  },
  // «Cualquier cambio, desde el más mínimo, queda guardado y notificado»
  // (Diego, WhatsApp 09/10).
  task_cambio: {
    clase: AVISO, etiqueta: 'Cambio en tarea', agrupa: false,
    descripcion: 'Cuando otra persona cambia algo de una tarea que tienes asignada o creaste',
  },
  // Facturas de colaboradores (#202): a los admins de esa empresa y al super
  // admin, cuando un colaborador sube la suya. Propuesta de la definición de
  // Diego (01/10), que la ficha del 07/10 dice programar.
  factura_colaborador: {
    clase: AVISO, etiqueta: 'Factura de colaborador', agrupa: false,
    descripcion: 'Cuando un colaborador sube su factura del mes',
  },
  // Monitask (#236): la factura por horas de un colaborador no cuadra con
  // Monitask (pasa del margen). A quien la paga, antes de pagarla.
  monitask_descuadre: {
    clase: ACCION, etiqueta: 'Horas que no cuadran con Monitask', agrupa: false,
    descripcion: 'Cuando las horas de la factura de un colaborador se separan de las de Monitask más del margen',
  },
  // La auditoría de facturación (#765): la pausa pide que alguien la resuelva.
  facturacion_pausada: {
    clase: ACCION, etiqueta: 'Facturación pausada', agrupa: false,
    descripcion: 'La auditoría de cada 2 horas ha encontrado un error y ha pausado la emisión de facturas',
  },
  facturacion_reanudada: {
    clase: AVISO, etiqueta: 'Facturación reanudada', agrupa: false,
    descripcion: 'La auditoría ha salido limpia y se ha reanudado la emisión de facturas',
  },
  // Cursos pendientes para las tutoras (#336): lo que pide hacer algo va arriba.
  curso_pendiente_asignado: {
    clase: ACCION, etiqueta: 'Curso pendiente asignado', agrupa: false,
    descripcion: 'Cuando te asignan un curso por crear',
  },
  curso_pendiente_vence: {
    clase: ACCION, etiqueta: 'Curso pendiente a punto de vencer', agrupa: false,
    descripcion: 'Faltan 3 días para la fecha comprometida de un curso tuyo',
  },
  curso_pendiente_retrasado: {
    clase: ACCION, etiqueta: 'Curso pendiente retrasado', agrupa: false,
    descripcion: 'La fecha comprometida ha pasado y el curso no está publicado',
  },
  curso_pendiente_sin_tutora: {
    clase: ACCION, etiqueta: 'Curso pendiente sin tutora', agrupa: false,
    descripcion: 'Un curso lleva más de 48 horas sin tutora asignada',
  },
  curso_pendiente_sin_habilitar: {
    clase: ACCION, etiqueta: 'Curso publicado con alumnas sin habilitar', agrupa: false,
    descripcion: 'Un curso publicado lleva más de 48 horas con alumnas sin habilitar',
  },
  curso_pendiente_alumna: {
    clase: AVISO, etiqueta: 'Alumna nueva en un curso pendiente', agrupa: false,
    descripcion: 'Se suma otra alumna a un curso pendiente tuyo',
  },
  curso_pendiente_semana: {
    clase: AVISO, etiqueta: 'Resumen semanal de cursos pendientes', agrupa: false,
    descripcion: 'Cada lunes, por campus: cursos abiertos, retrasados, alumnas esperando y carga por tutora (super admin)',
  },
  curso_pendiente_fecha_movida: {
    clase: AVISO, etiqueta: 'Fecha de un curso movida otra vez', agrupa: false,
    descripcion: 'La fecha comprometida de un curso se ha movido por segunda vez',
  },
  // Control de subidas (#771): solo campana, a quien lleva las subidas del campus.
  curso_pendiente_subida_vencida: {
    clase: ACCION, etiqueta: 'Subidas de un curso atrasadas', agrupa: false,
    descripcion: 'Un curso entregado tiene vídeos, módulos o datos de directores sin subir pasada su fecha límite',
  },
  // Consultas de alumnos (#190, decisión 4): al tutor, cuando una consulta
  // abierta llega a las 3/4 partes del plazo; a administración del campus,
  // cuando se pasa (para reasignarla). Y al tutor, la carga sin actualizar.
  consulta_cerca_del_plazo: {
    clase: ACCION, etiqueta: 'Consulta cerca del plazo', agrupa: false,
    descripcion: 'Un alumno lleva casi el plazo esperando tu respuesta',
  },
  consulta_fuera_de_plazo: {
    clase: ACCION, etiqueta: 'Consulta fuera de plazo', agrupa: false,
    descripcion: 'Una consulta de tus campus se ha pasado del plazo sin respuesta',
  },
  // Entregas sin corregir (#457; #681 y #769 en el CRM 360): a la tutora, sus entregas
  // que llevan más de 48 h sin corregir (una vez por entrega; un aviso por vuelta).
  entregas_sin_corregir: {
    clase: ACCION, etiqueta: 'Entregas sin corregir', agrupa: false,
    descripcion: 'Entregas de tus alumnos que llevan más de 48 h sin corregir',
  },
  // El segundo escalón: a administración del campus, las que siguen sin corregir pasado
  // el plazo (5 días o «Recordarme calificar antes de») y las de cursos sin tutora en el
  // CRM. Un aviso por campus y vuelta (tutores/tutor.entregasAdministracion.js).
  entregas_fuera_de_plazo: {
    clase: ACCION, etiqueta: 'Entregas sin corregir fuera de plazo', agrupa: false,
    descripcion: 'Entregas de alumnos de tus campus que siguen sin corregir pasado el plazo, o de cursos sin tutora en el CRM',
  },
  carga_desactualizada: {
    clase: ACCION, etiqueta: 'Carga de trabajo sin actualizar', agrupa: false,
    descripcion: 'Llevas más de una semana sin actualizar tu carga de trabajo',
  },
  // 17/11/2026: Brevo ha bloqueado el correo de alguien del equipo y no le llega
  // ningún aviso. Va a superadmins y admins de sus campus, una vez por bloqueo.
  brevo_bloqueado: {
    clase: ACCION, etiqueta: 'Correo bloqueado en Brevo', agrupa: false,
    descripcion: 'A alguien del equipo no le llegan los correos del CRM porque Brevo bloquea su dirección',
  },
  // MCP (#326): un Claude se ha conectado con tu URL y espera a que lo autorices.
  // Si no eres tú, es que la URL se ha colado: hay que rechazarlo.
  mcp_conexion_nueva: {
    clase: ACCION, etiqueta: 'Claude pide conectarse', agrupa: false,
    descripcion: 'Un Claude se ha conectado con tu URL del MCP y espera a que lo autorices',
  },
  // Moodle (#335): el de un campus ha dejado de responder o su token ya no vale. Lo arregla un
  // super admin (nuevo token en Conexión → Moodle, o revisar el servidor del campus).
  moodle_campus_caido: {
    clase: ACCION, etiqueta: 'Moodle de un campus', agrupa: false,
    descripcion: 'El Moodle de un campus no responde o su token ya no vale',
  },
  // Matrícula automática (#767): a administración del campus (sus admins y los super admin).
  // Una por alumno: cada una es una matrícula que hacer o que arreglar.
  matricula_moodle_lista: {
    clase: ACCION, etiqueta: 'Matrícula en Moodle lista', agrupa: false,
    descripcion: 'Un alumno ya ha pagado, ha llegado su día y toca matricularle en Moodle',
  },
  matricula_moodle_fallo: {
    clase: ACCION, etiqueta: 'Matrícula en Moodle fallida', agrupa: false,
    descripcion: 'No se pudo preparar la matrícula de un alumno en Moodle (con el motivo)',
  },
  // #471: la renovación diaria de un token de Meta Ads o de Instagram ha fallado,
  // o el token caduca en menos de 7 días. Hay que volver a conectar la cuenta.
  // Una vez por fallo y una por fecha de caducidad (jobs/metaTokensScheduler.js).
  meta_token: {
    clase: ACCION, etiqueta: 'Token de Meta o Instagram', agrupa: false,
    descripcion: 'La renovación de un token de Meta Ads o Instagram ha fallado, o el token caduca en menos de 7 días',
  },
  // MCP (Diego, 22/10): tu Claude consulta con la URL sola, conectado como antes
  // de la #326, y el CRM no le da datos. Hay que conectarlo una vez. Como mucho
  // uno al día por URL (mcp.conexiones.js).
  mcp_conector_antiguo: {
    clase: ACCION, etiqueta: 'Conectar Claude una vez', agrupa: false,
    descripcion: 'Tu Claude intenta consultar con tu URL del MCP sin haber iniciado sesión y hay que conectarlo una vez',
  },
  task_aprobada: {
    clase: AVISO, etiqueta: 'Tarea aprobada', agrupa: false,
    descripcion: 'Cuando aprueban una tarea tuya y pasa a «Hecha»',
  },
  venta_automatica: {
    clase: AVISO, etiqueta: 'Venta automática', agrupa: false,
    descripcion: 'Un cobro de Stripe crea o cierra una venta solo',
  },
  catalogo_revision: {
    clase: AVISO, etiqueta: 'Revisión diaria', agrupa: true,
    descripcion: 'El repaso diario de catálogo y cobros sin atar',
  },
  lead_deleted: {
    clase: AVISO, etiqueta: 'Prospecto eliminado', agrupa: false,
    descripcion: 'Alguien borra una ficha',
  },
  lead_merged: {
    clase: AVISO, etiqueta: 'Fichas fusionadas', agrupa: false,
    descripcion: 'Dos fichas duplicadas se unen en una',
  },
  lead: {
    clase: AVISO, etiqueta: 'Prospectos', agrupa: true,
    descripcion: 'Avisos sueltos de prospecto',
  },
  // #246 (Diego, 09/10): un tutor cambia su correo desde «Mi perfil». Es el correo
  // de la factura de su comisión, así que administración tiene que enterarse.
  tutor_correo_cambiado: {
    clase: AVISO, etiqueta: 'Correo de tutor cambiado', agrupa: false,
    descripcion: 'Un tutor cambia su correo desde «Mi perfil»',
  },
};

const DESCONOCIDO = { clase: AVISO, agrupa: false, descripcion: null };

/** Lo que sabemos de un tipo. Nunca devuelve `undefined`. */
export function metaDe(tipo) {
  const m = TIPOS[tipo];
  if (m) return m;
  return { ...DESCONOCIDO, etiqueta: tipo };
}

/** `true` si este tipo se colapsa en una sola fila cuando se repite. */
export function seAgrupa(tipo) {
  return metaDe(tipo).agrupa === true;
}

/** `'accion'` o `'aviso'`. */
export function claseDe(tipo) {
  return metaDe(tipo).clase;
}

/**
 * Los tipos que se pueden apagar, para pintar la pantalla de preferencias.
 *
 * Van todos los conocidos. Incluso los de accion: si alguien no quiere que le
 * avisen de los recordatorios que el mismo puso, es su decision, y prefiero
 * que la tome en la pantalla a que acabe ignorando la campana entera.
 */
export function tiposApagables() {
  return Object.entries(TIPOS).map(([tipo, m]) => ({
    tipo, clase: m.clase, etiqueta: m.etiqueta, descripcion: m.descripcion,
  }));
}
