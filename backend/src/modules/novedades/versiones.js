/**
 * Las novedades de cada versión, en UN solo sitio (Diego, 28/09).
 *
 * De aquí salen el apartado «Novedades», el aviso de la campana, el correo
 * al equipo y su PDF. Una versión nueva se añade ARRIBA: la primera es la
 * actual, y es la que se manda sola al arrancar en producción.
 *
 * `roles`: quién la ve con botón «Ir a…» (si no le toca, se lee igual).
 * `ruta`: la pantalla; null si no tiene una propia.
 */
/** Cómo se llama este CRM y su color: portada del PDF y cabecera del correo. */
export const CRM = { nombre: 'CRM ISEIE', color: '#002776' };

const LISTA = [
  {
    "version": "2.6.0",
    "fecha": "2026-11-03",
    "titulo": "Versión 2.6.0",
    "intro": "Las consultas de los alumnos llegan al CRM, Soporte guarda los tickets, los cursos pendientes tienen su pantalla y Claude ya consulta los Moodle de los campus. Además, más pantallas se abren con «Todos los proyectos» o con una empresa, la actividad de cada comercial en Reportes, las cifras del equipo más claras y una tanda de arreglos de seguridad y de cobros. Esto es lo que llega después de la 2.5.19.",
    "grupos": [
      {
        "titulo": "Consultas de alumnos",
        "items": [
          {
            "titulo": "Las dudas del campus, en el CRM",
            "texto": "Lo que los alumnos escriben al tutor en el campus (Moodle) entra en el menú Consultas: la bandeja, los alumnos sin mensajes, la carga de cada tutor y lo que se tarda en responder. Se responde desde el CRM y la respuesta llega al campus. Avisa cuando una consulta se acerca al plazo o se pasa de él.",
            "roles": [
              "tutor",
              "admin",
              "superadmin"
            ],
            "ruta": "/consultas",
            "boton": "Ir a Consultas"
          },
          {
            "titulo": "Cada campus, conectado una vez",
            "texto": "El campus se conecta en Finanzas → Integraciones con la dirección y la clave de su Moodle, marcando «Leer las consultas de este campus». Desde ese momento entran las consultas nuevas; lo anterior no se importa.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/integrations",
            "boton": "Ir a Integraciones"
          }
        ]
      },
      {
        "titulo": "Soporte y cursos pendientes",
        "items": [
          {
            "titulo": "Los tickets de Soporte se guardan",
            "texto": "Lo que se manda desde Soporte queda guardado con sus pasos, lo que esperabas y lo que pasó, y llega a quien lo tiene que mirar con un aviso en la campana. Se ve el estado de cada ticket y cuánto se tarda en responder y en cerrarlo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/soporte",
            "boton": "Ir a Soporte"
          },
          {
            "titulo": "Cursos pendientes",
            "texto": "Los cursos vendidos que aún no tienen fecha, por campus, con su tutora, la fecha comprometida y las alumnas que esperan. Avisa antes de la fecha y los lunes hace un resumen. Ahora también lo ven las gestoras y las tutoras.",
            "roles": [
              "gestor",
              "tutor",
              "admin",
              "superadmin"
            ],
            "ruta": "/products/pending",
            "boton": "Ir a Cursos pendientes"
          }
        ]
      },
      {
        "titulo": "«Todos los proyectos» y empresas",
        "items": [
          {
            "titulo": "Más pantallas con «Todos» o una empresa",
            "texto": "Con «Todos los proyectos» o una empresa arriba se abren más pantallas, sumando los campus que te tocan. Las que trabajan con un solo campus (Duplicados, Meta Ads, Moodle) te dejan elegirlo dentro de la propia pantalla, sin cambiar el de arriba.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "El filtro de campus sigue a la empresa",
            "texto": "En Prospectos, el filtro de campus enseña solo los de la empresa elegida arriba, y con «Todos» deja fuera los campus de pruebas.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "«Nuevo tutor» con una empresa arriba",
            "texto": "Ya no hace falta cambiar a un campus para dar de alta a un tutor: el formulario pide el campus y enseña los cursos de su catálogo.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores",
            "boton": "Ir a Tutores"
          }
        ]
      },
      {
        "titulo": "Reportes y cifras",
        "items": [
          {
            "titulo": "Actividad por comercial",
            "texto": "En Reportes y en el Dashboard: lo que ha hecho cada gestora en el periodo (contactos, pasos y ventas) y de dónde llegó cada prospecto, ChatGPT incluido.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Ir a Reportes"
          },
          {
            "titulo": "Una sola tasa de cierre",
            "texto": "La tasa de cierre se calcula igual en todas partes, con su «¿de dónde sale?», y el baremo que dice si es buena o mala se puede cambiar. Además, «¿dónde ponemos el dinero?» compara canales y campañas, y Meta Ads llega del gasto hasta la venta cobrada.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Ir a Reportes"
          },
          {
            "titulo": "«El equipo este mes», cada cifra con lo suyo",
            "texto": "Lo cobrado va con el número de cobros, y las ventas nuevas van aparte con lo vendido. El Dashboard enseña lo facturado y, al lado, lo cobrado: la misma cifra que en Prospectos y Clientes.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/",
            "boton": "Ir al Dashboard"
          },
          {
            "titulo": "«Productos vendidos», con los abonos aparte",
            "texto": "Cada programa enseña lo facturado, y las facturas rectificativas salen en su propia línea. Antes restaban dentro del programa y alguno salía en negativo o a cero. El total no cambia.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/",
            "boton": "Ir al Dashboard"
          },
          {
            "titulo": "«Programas más vendidos» dice su periodo",
            "texto": "La tarjeta dice el periodo que enseña («Este mes», «Últimos 30 días» o las fechas), en vez de «Histórico».",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/ventas",
            "boton": "Ir a Ventas"
          },
          {
            "titulo": "Ventas sin formación",
            "texto": "Una pantalla con las ventas que no dicen de qué formación son, para completarlas.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/ventas/sin-formacion",
            "boton": "Ir a Ventas sin formación"
          }
        ]
      },
      {
        "titulo": "Claude y el buscador",
        "items": [
          {
            "titulo": "Claude consulta los Moodle",
            "texto": "El Claude conectado al CRM ve los cursos, los alumnos y los recursos de cada campus con su Moodle conectado, además de matrículas, catálogo, correos, WhatsApp, nóminas, clientes y la publicidad de Meta. Si un Moodle deja de responder, avisa.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/moodle",
            "boton": "Ir a Moodle"
          },
          {
            "titulo": "El buscador encuentra más",
            "texto": "El buscador (Ctrl K) encuentra también tutores, facturas de colaboradores, diplomas y cursos de Moodle, cada uno solo si puedes verlos.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Usuarios y accesos",
        "items": [
          {
            "titulo": "Invitar sin sorpresas",
            "texto": "Al invitar a alguien, el formulario dice antes qué roles no puedes dar y cuál quitar, en vez de avisar al guardar.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/configuracion",
            "boton": "Ir a Configuración"
          },
          {
            "titulo": "Recuperar la contraseña",
            "texto": "Desde la pantalla de entrada se puede pedir un correo para poner una contraseña nueva.",
            "roles": [
              "gestor",
              "tutor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Webhooks, solo para admin y superadmin",
            "texto": "Captación → Webhooks (los que reciben prospectos y matrículas) queda para el admin y el superadmin, cada uno con los de sus campus: el token de cada webhook es la llave para meter datos en el CRM.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/webhooks",
            "boton": "Ir a Webhooks"
          }
        ]
      },
      {
        "titulo": "Matrículas, diplomas y cobros",
        "items": [
          {
            "titulo": "Matrículas con su historial y sus documentos",
            "texto": "Cada matrícula guarda su historia completa y sus cinco documentos, se abre en un panel lateral y se filtra por empresa. Borrar una venta ya no borra su matrícula.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas",
            "boton": "Ir a Matrículas"
          },
          {
            "titulo": "«Pasar a pendientes» pregunta antes",
            "texto": "En Diplomas, si el alumno no tiene nota o le falta avance, «Pasar a pendientes» pide confirmarlo. Cada fila enseña cuántas tareas ha entregado.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Cobros repetidos",
            "texto": "Los cobros apuntados dos veces y los apuntados a mano que repetían un pago de Stripe se quitan solo cuando está claro, y lo pagado de cada venta vuelve a cuadrar. Lo que no está claro queda en una lista para revisarlo, sin borrar nada.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      }
    ],
    "arreglos": [
      "«Contactar» en la cola del día marca hecho el paso que enseñaba: la persona ya no vuelve a salir al recargar.",
      "Un formulario que llega por Make a un escenario sin campos configurados ya no se pierde: el CRM reconoce los campos habituales y avisa a los admins para completarlo.",
      "Cada uno ve y toca solo lo de sus campus también en Seguimiento, Reportes, Convocatorias, Duplicados, ventas, matrículas, facturas, metas, comisiones y tutores.",
      "El tutor ve solo lo suyo: sus cursos, sus consultas, sus mensajes y Novedades.",
      "La marca de arriba dice «CRM ISEIE», y el Dashboard lleva sus tildes.",
      "Ningún enlace de dentro de las pantallas lleva a «Página no encontrada».",
      "Los formularios del CRM avisan de todo lo que falta en un solo mensaje.",
      "El programa de una venta es el del catálogo, no el nombre del cliente; las ventas viejas que lo tenían mal se han corregido, y las de varias líneas del mismo curso ya dicen de qué curso son.",
      "El tutorial de Plantillas de WhatsApp enseña sus cuatro pasos.",
      "El enlace para subir la factura de colaborador vale hasta el día 6 del mes siguiente."
    ]
  },
  {
    "version": "2.5.19",
    "fecha": "2026-11-02",
    "titulo": "Versión 2.5.19",
    "intro": "El reparto de prospectos por actividad, las pulsaciones del botón de WhatsApp de las webs, las facturas de colaboradores en su moneda, el buscador nuevo y más seguridad: cada uno ve solo lo de sus campus. Esto es lo que ha llegado de la 2.5.0 a la 2.5.19.",
    "grupos": [
      {
        "titulo": "Prospectos y reparto",
        "items": [
          {
            "titulo": "Los prospectos se reparten por actividad",
            "texto": "Un prospecto nuevo va a una gestora que esté trabajando: la que ha tenido actividad en los últimos 5 minutos. Cada campus reparte aparte, y vale igual para lo que llega por Make que para los formularios que entran directos al CRM. Se mira y se ajusta en Conexión → Asignación de leads, por empresa o por campus.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/asignacion-leads",
            "boton": "Ir a Asignación de leads"
          },
          {
            "titulo": "Los formularios marcan los duplicados",
            "texto": "Si la persona ya estaba en el CRM, el prospecto nuevo sale unido al anterior como duplicado, también cuando entra por un formulario del propio CRM.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "De dónde llegó cada prospecto",
            "texto": "El correo «Resumen del día» dice si cada prospecto entró por un formulario, por WhatsApp o lo dio de alta alguien a mano.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "La gestora que está trabajando, sombreada",
            "texto": "En Prospectos se ve sombreada la gestora que está activa ahora mismo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          }
        ]
      },
      {
        "titulo": "WhatsApp",
        "items": [
          {
            "titulo": "Cuántas veces se pulsa el botón de cada web",
            "texto": "Captación → WhatsApp cuenta las pulsaciones del botón de WhatsApp de cada web y las cruza con las altas que llegan por WhatsApp. Con una empresa o «Todos» arriba, salen sumadas.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/captacion/whatsapp",
            "boton": "Ir al botón de WhatsApp"
          },
          {
            "titulo": "Apuntar un contacto desde el chat",
            "texto": "Desde el chat se apunta una llamada, un correo, un WhatsApp o una nota. Lo que no es nota cuenta como contacto con la persona y como actividad para el reparto.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/whatsapp",
            "boton": "Abrir WhatsApp"
          },
          {
            "titulo": "WhatsApp → Actividad",
            "texto": "Si cada gestora responde: los chats que tiene, los respondidos, los que esperan respuesta y lo que tarda en contestar.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/whatsapp/actividad",
            "boton": "Ver la actividad"
          },
          {
            "titulo": "El saludo del botón de la web",
            "texto": "El mensaje que se escribe solo al pulsar el botón saluda a la gestora, en vez de «Hola, soy …».",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Finanzas",
        "items": [
          {
            "titulo": "Facturas de colaboradores en su moneda",
            "texto": "Cada empresa de la ficha del colaborador lleva su moneda, euros o dólares, y la factura del mes la hereda; al subirla se puede cambiar. Los totales se suman cada moneda por su lado, sin convertir.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas-colaboradores",
            "boton": "Ir a Facturas de colaboradores"
          },
          {
            "titulo": "«Este mes no facturo a esta empresa»",
            "texto": "Desde el enlace del correo, el colaborador avisa de que este mes no factura a una empresa. Ya no le llega el recordatorio del día 5 ni cuenta como pendiente. Se deshace desde el mismo enlace o subiendo la factura.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas-colaboradores",
            "boton": "Ir a Facturas de colaboradores"
          },
          {
            "titulo": "Facturación respeta las fechas",
            "texto": "Las tarjetas de arriba y «Ventas sin factura» cuentan solo lo de las fechas elegidas.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas",
            "boton": "Ir a Facturación"
          }
        ]
      },
      {
        "titulo": "Buscar y pantallas",
        "items": [
          {
            "titulo": "El buscador (Ctrl K), nuevo",
            "texto": "Encuentra personas, productos, ventas por su número, facturas, tareas y usuarios. Da igual escribir con o sin tildes («gonzalez» encuentra «González») y los teléfonos se encuentran por sus cifras. Cada uno solo encuentra lo que puede abrir.",
            "roles": [
              "gestor",
              "admin",
              "superadmin",
              "soporte"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Feedback abre con todo",
            "texto": "El panel de Feedback abre en «Desde siempre», también con «Todos los proyectos» arriba. Antes abría en «Este mes» y a principio de mes parecía vacío.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes/feedback",
            "boton": "Ir a Feedback"
          },
          {
            "titulo": "El tablero de tareas, por empresa",
            "texto": "Con una empresa o un campus arriba, el tablero, «Por revisar» y las cifras del equipo enseñan solo las tareas de esa empresa.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "Análisis IA para cualquier campus",
            "texto": "El análisis con IA sale para cualquier campus, y las pantallas ya no enseñan datos de ejemplo cuando no hay datos de verdad.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Seguridad",
        "items": [
          {
            "titulo": "Cada uno, solo lo de sus campus",
            "texto": "Prospectos, facturas y sus cifras enseñan solo los campus de quien mira: pedir los de otro campus da «sin acceso». El project manager y quien tiene la gestora como rol de más ven solo lo suyo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      }
    ],
    "arreglos": [
      "El botón de la cola del día ya no apunta contactos que la gestora no ha hecho.",
      "El PDF de una factura con caracteres raros en la dirección (como «n⁰») ya se descarga, se genera y se envía.",
      "La ficha de un producto ya carga: decía siempre «Producto no encontrado».",
      "Diplomas ya no desaparece del menú después de una actualización.",
      "Cada diploma de Certifex sale con el centro exacto de su campus.",
      "En el proceso comercial, las plantillas de cada paso salen al pulsarlo.",
      "En Facturas de colaboradores, una leyenda explica cada estado."
    ]
  },
  {
    "version": "2.4.5",
    "fecha": "2026-10-28",
    "titulo": "Versión 2.4.5",
    "intro": "Un permiso para cada acción, como en Shopify, y un solo tablero de tareas con filtros. Esto es lo que ha llegado de la 2.4.0 a la 2.4.5.",
    "grupos": [
      {
        "titulo": "Roles y permisos",
        "items": [
          {
            "titulo": "Un permiso para cada acción",
            "texto": "En Roles cada pantalla tiene sus casillas: ver, crear, editar, borrar… Cada rol trae las suyas de serie y a una persona se le pueden dar o quitar sueltas. Nadie puede dar un permiso que no tiene.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/roles",
            "boton": "Ir a Roles"
          }
        ]
      },
      {
        "titulo": "Tareas",
        "items": [
          {
            "titulo": "Un solo tablero, con filtros",
            "texto": "Un tablero de cuatro columnas, sin bloques por persona. Arriba se elige Mis tareas, Mi equipo o Todo, y se filtra por persona, equipo, área, etiqueta, prioridad, campus o solo las vencidas. El periodo, por día, semana o mes.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "Cuándo se creó y cuándo se terminó",
            "texto": "Cada tarjeta lo dice, y la ficha de la tarea dice también quién la cerró y su fecha límite.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "«Todo» del mes para admin y superadmin",
            "texto": "Admin y superadmin ven todas las tareas del mes, y lo que no se cerró pasa solo al mes siguiente.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "El equipo de una tarea es el de quien la lleva",
            "texto": "Una tarea cuenta en el equipo de la persona que la lleva, no en el de quien la creó.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      }
    ],
    "arreglos": [
      "El recorrido guiado ya no tapa la ficha de una tarea: «Crear tarea» vuelve a guardar, y los avisos dicen qué falta."
    ]
  },
  {
    "version": "2.3.1",
    "fecha": "2026-10-26",
    "titulo": "Versión 2.3.1",
    "intro": "El tablero de tareas por empresa y con equipos, los correos de las tareas y más datos para el Claude conectado al CRM. Esto es lo que ha llegado con la 2.3.0 y la 2.3.1.",
    "grupos": [
      {
        "titulo": "Tareas",
        "items": [
          {
            "titulo": "Equipos con cargos y supervisor",
            "texto": "El tablero es por empresa. Cada equipo tiene cargos por nivel y un supervisor: cada uno se crea sus tareas y las puede dar a quien está por debajo en su equipo. Mover y comentar una tarea lo hacen quien la lleva, su supervisor y el superadmin.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "«Mi tablero»",
            "texto": "Junta lo que llevas, lo que supervisas y lo que creaste.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir Mi tablero"
          },
          {
            "titulo": "Correo al cambiar de estado",
            "texto": "Cuando una tarea cambia de columna, avisa a quien la lleva, a su supervisor y a quien la creó. Varios cambios seguidos llegan en un solo correo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "El resumen de la tarde",
            "texto": "De lunes a viernes, a las 18:00 de Venezuela, un correo con lo que hiciste hoy y lo que te falta, con lo vencido primero.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Claude conectado al CRM",
        "items": [
          {
            "titulo": "Publicidad y actividad por comercial",
            "texto": "Claude puede consultar las cuentas y las campañas de publicidad (solo admin y superadmin, y nunca enseña el token) y lo que ha hecho cada comercial entre dos fechas. Quien no es admin solo se ve a sí misma.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/mcp",
            "boton": "Ir a Conexión → MCP"
          }
        ]
      }
    ],
    "arreglos": [
      "La tabla de Usuarios ya no se sale por la derecha y la columna «Acciones» queda siempre a la vista."
    ]
  },
  {
    "version": "2.2.21",
    "fecha": "2026-10-26",
    "titulo": "Versión 2.2.21",
    "intro": "El DNI en los diplomas, emitir sin ser admin, los webhooks de cada empresa por separado y una tanda de arreglos en Facturación y en las sesiones. Esto es lo que ha llegado de la 2.2.9 a la 2.2.21.",
    "grupos": [
      {
        "titulo": "Diplomas de Certifex",
        "items": [
          {
            "titulo": "El DNI, obligatorio para emitir",
            "texto": "Se rellena en «Revisar datos antes de aprobar» o en «Nuevo diploma». Sin DNI, el diploma no se emite.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Emitir sin ser admin",
            "texto": "El permiso «Diplomas (Certifex) · Emitir» deja emitir a quien se le dé, por ejemplo a una gestora. Se da en Roles o en la ficha de la persona.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/roles",
            "boton": "Ir a Roles"
          },
          {
            "titulo": "«Pasar a pendientes»",
            "texto": "En Diplomas y en Emisiones, para devolver una solicitud a pendientes sin perderla.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Diplomas sin ser admin",
            "texto": "Ver Diplomas ya no pide ser admin, y a una tutora se le pueden añadir formaciones de otro campus.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          }
        ]
      },
      {
        "titulo": "Webhooks y Make",
        "items": [
          {
            "titulo": "Los envíos de cada empresa, aparte",
            "texto": "Los webhooks de una empresa no se ven desde otra, y desde un campus se ven los de los demás campus de su empresa.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/webhook-transferencias",
            "boton": "Abrir el webhook"
          },
          {
            "titulo": "«Enviar prueba» con datos reales",
            "texto": "La prueba sale con la misma forma que un aviso de verdad: campus, empresa, cuenta, quien la lanza y el importe de la transferencia. El aviso trae también los campos sueltos que esperan los escenarios de Make.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/webhook-transferencias",
            "boton": "Abrir el webhook"
          }
        ]
      },
      {
        "titulo": "Facturación",
        "items": [
          {
            "titulo": "Proforma y cola por campus",
            "texto": "«Emitir proforma» usa el campus de cada venta, y con una empresa arriba hay una cola por cada campus. Una venta con cobros dice «Cobrada · factúrala desde la cola».",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas",
            "boton": "Ir a Facturación"
          },
          {
            "titulo": "«¿Ha pagado?» hay que elegirlo",
            "texto": "Al convertir un prospecto en venta ya no viene puesto «Sin pago»: hay que elegirlo, porque la forma de pago sola no apunta el cobro.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Meta Ads",
        "items": [
          {
            "titulo": "Solo ver, para el equipo",
            "texto": "Con el permiso «Meta Ads · Ver», se ven los anuncios de sus campus. Conectar, sincronizar y asociar siguen siendo de admin.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/meta-ads",
            "boton": "Ir a Meta Ads"
          }
        ]
      }
    ],
    "arreglos": [
      "Filtrar por gestora en el resumen de Ventas ya no da error.",
      "En «Editar» de un diploma ya no salen horas por módulo, solo las totales.",
      "Facturación vuelve al menú de las gestoras que facturan.",
      "Al cambiar el rol de alguien o desactivarlo, su sesión de antes deja de valer al momento.",
      "El Claude conectado como antes de la última actualización avisa una vez de que hay que volver a conectarlo."
    ]
  },
  {
    "version": "2.2.0",
    "fecha": "2026-10-16",
    "titulo": "Versión 2.2.0",
    "intro": "Los diplomas de Certifex, ya desde el CRM y con la firma del alumno, y una tanda de mejoras en Finanzas, reportes, usuarios y correos. Aquí está todo lo nuevo, con un botón para ir a cada pantalla.",
    "grupos": [
      {
        "titulo": "Diplomas de Certifex",
        "items": [
          {
            "titulo": "Aprobar, emitir y enviar los diplomas",
            "texto": "En Matrículas → Diplomas ves lo que piden los alumnos desde Moodle y lo apruebas; Certifex emite el diploma con el temario de la formación. Emitir no escribe al alumno: el correo sale cuando pulsas «Enviar al alumno», después de ver el PDF. Las consultas de la web y las emisiones están en Matrículas → Certificaciones.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "La firma del alumno, en el diploma",
            "texto": "Va impresa sobre «El interesado». Se coge la de su solicitud de admisión y, si no la tiene, la subes en «Revisar datos antes de aprobar»: una foto o un escaneo, y el CRM le quita el fondo y la recorta. En «Por decidir» cada fila dice «Con firma» o «Sin firma · Subir».",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Cada empresa numera sus diplomas",
            "texto": "El número de expediente lleva el prefijo de la empresa que expide y cuenta desde 000001: CEDIA-2026-000001 (Psiko, ISEIH, Fono, ISAEG, ISECD, ISEF e ISSLOGG), ISEIE-2026-000001, ICTESS-2026-000001 y LTS-2026-000001 (Academia IA).",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "El temario, desde la página del curso",
            "texto": "Antes de aprobar, «Sincronizar módulos con el producto» copia los módulos de la página del curso, y se pueden retocar a mano. Un nombre mal escrito se corrige sin revocar: mismo número de expediente y mismo QR, y queda anotado quién y por qué.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Nuevo diploma, desde el CRM",
            "texto": "Para quien no lo pide desde Moodle: «Nuevo diploma», eliges el campus, el cliente y la formación vendida, y queda en «Por decidir» para aprobarlo y emitirlo como los demás.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          },
          {
            "titulo": "Horas y temario en todo el catálogo",
            "texto": "Las formaciones ya traen sus horas y su temario, sacados de la página de cada curso. Si a alguna le faltan los módulos, el panel lo avisa en rojo para escribirlos antes de aprobar.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/matriculas/diplomas",
            "boton": "Ir a Diplomas"
          }
        ]
      },
      {
        "titulo": "Nuevo en el CRM",
        "items": [
          {
            "titulo": "El tablero del equipo",
            "texto": "Equipo de Desarrollo → Tablero: las tareas del equipo por áreas, con «Por revisar» para aprobar o devolver y «Configurar tablero» para las columnas, las áreas y los proyectos. Quién puede qué se cambia en Configuración → Roles.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tareas",
            "boton": "Abrir el tablero"
          },
          {
            "titulo": "Facturas de colaboradores",
            "texto": "Los colaboradores suben su factura del mes en «Mi factura». En Finanzas → Facturas de colaboradores se revisan: enviadas, por pagar, pagadas e historial, con el desglose de cada una, «marcar pagada» y el ZIP del mes para administración.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas-colaboradores",
            "boton": "Ir a Facturas de colaboradores"
          },
          {
            "titulo": "Convocatorias",
            "texto": "Prospectos → Convocatorias: cada convocatoria de becas como una campaña, con su embudo y sus topes, y la beca de cada persona en su ficha.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/convocatorias",
            "boton": "Ir a Convocatorias"
          }
        ]
      },
      {
        "titulo": "Finanzas",
        "items": [
          {
            "titulo": "El Dashboard cuenta lo facturado",
            "texto": "Las cifras del Dashboard, también las del equipo, son lo facturado, con una fila «Sin gestora» para las ventas que no tienen. En Ventas, las que aún no tienen ningún cobro salen aparte.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/",
            "boton": "Ir al Dashboard"
          },
          {
            "titulo": "Egresos, por empresa",
            "texto": "Un egreso puede ser de un campus, de toda una empresa o general (este, solo el super admin). La pantalla funciona igual en los dos CRM y cada uno ve solo lo de sus campus.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/expenses",
            "boton": "Ir a Egresos"
          },
          {
            "titulo": "Ingresos más limpio",
            "texto": "Los nombres de los cursos ya no salen con «&amp;», y los atajos de fecha («Hoy · Ayer · …») salen una sola vez.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/revenue",
            "boton": "Ir a Ingresos"
          },
          {
            "titulo": "Una factura tapa un solo cobro",
            "texto": "Una factura sin cobro enganchado ya no da por facturados todos los cobros del mismo importe: solo uno.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Buscar una factura por el alumno",
            "texto": "El buscador de Facturas encuentra también por el nombre y el correo del alumno de la venta: una factura a nombre de su empresa ya sale buscando a la persona.",
            "roles": [
              "admin",
              "superadmin",
              "gestor"
            ],
            "ruta": "/accounting/facturas",
            "boton": "Ir a Facturas"
          },
          {
            "titulo": "El ranking separa de dónde viene lo cobrado",
            "texto": "En Reportes → Asesoras, «Cómo voy» y el correo semanal, cada gestora tiene su vendido, facturado, cobrado y pendiente por separado, y lo cobrado se parte en ventas del periodo, ventas anteriores (con la venta y su fecha) y cuotas. Las filas «Sin gestora» y «Total» cuadran con la tarjeta de cobrado.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Ir a Reportes"
          },
          {
            "titulo": "«Tu semana», con lo tuyo",
            "texto": "El correo de cada lunes te enseña tus prospectos y tus ventas, no los del equipo, y de dónde viene lo que cobraste: ventas de la semana, ventas anteriores y cuotas.",
            "roles": [
              "gestor"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Un cobro de Stripe no se queda suelto",
            "texto": "Si se borra un cobro y se vuelve a apuntar, el cargo de Stripe se engancha al nuevo al pulsar «Sincronizar».",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Conexión",
        "items": [
          {
            "titulo": "Aviso de cobros por transferencia o depósito",
            "texto": "En Conexión → «Webhook de transferencias» pulsas «Nuevo webhook» y pones la dirección que debe recibir los datos (Make, tu contabilidad, otro programa). Desde entonces, cada cobro apuntado por transferencia o depósito bancario manda sus datos ahí, solo. Se configura por empresa, y arriba se ve si ahora mismo se avisa a alguien. Con tarjeta, Stripe, Bizum o efectivo no sale nada.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/webhook-transferencias",
            "boton": "Abrir el webhook"
          }
        ]
      },
      {
        "titulo": "Usuarios y tutores",
        "items": [
          {
            "titulo": "Un admin con toda su empresa",
            "texto": "Al dar de alta o editar un admin, el super admin puede marcar «Todos los campus de esta empresa, también los que se creen». Sigue sin ver otras empresas ni gestionar usuarios.",
            "roles": [
              "superadmin"
            ],
            "ruta": "/configuracion",
            "boton": "Ir a Configuración"
          },
          {
            "titulo": "Contraseña de tutor y correo de un super admin",
            "texto": "La contraseña de un tutor la pueden poner el super admin y el admin (este, solo de sus campus). Un super admin puede cambiar el correo de otro super admin, y queda registrado.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores",
            "boton": "Ir a Tutores"
          },
          {
            "titulo": "«Cobra desde» en Editar tutor",
            "texto": "La fecha desde la que cobra un tutor se cambia en «Editar tutor», también hacia atrás para que cuadre. Y lo que factura avisa cuando ya está todo pagado.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores",
            "boton": "Ir a Tutores"
          }
        ]
      },
      {
        "titulo": "Correos y detalles",
        "items": [
          {
            "titulo": "Cada correo con la marca de su campus",
            "texto": "Los avisos al equipo (bienvenida, prospecto asignado o sin contactar, solicitudes de cambio, Google Ads…) usan la plantilla común con el logo del campus y salen con el nombre de su marca.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Ningún enlace a «Página no encontrada»",
            "texto": "El buscador (Ctrl+K), los atajos y los avisos de la campana llevan siempre a una pantalla que existe. El filtro «Hoy» de Prospectos ya no salta a mañana por la noche en Latinoamérica.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          }
        ]
      },
      {
        "titulo": "Como en MultiCRM",
        "items": [
          {
            "titulo": "Mensajes del equipo",
            "texto": "Sistema → Mensajes: el chat interno del equipo, el mismo que en MultiCRM.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/mensajes",
            "boton": "Abrir Mensajes"
          },
          {
            "titulo": "Registro de actividad",
            "texto": "Sistema → Registro: quién hizo qué y cuándo, como en MultiCRM.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/registro",
            "boton": "Abrir el Registro"
          }
        ]
      }
    ]
  },
  {
    "version": "2.1.0",
    "fecha": "2026-10-07",
    "titulo": "Versión 2.1.0",
    "intro": "Facturas que no pasan de lo cobrado, Prospectos con su resumen del día, cada pantalla dentro de tus campus y una conexión con Claude más segura. Aquí está todo lo nuevo, con un botón para ir a cada pantalla.",
    "grupos": [
      {
        "titulo": "Facturas y ventas",
        "items": [
          {
            "titulo": "La factura no pasa de lo cobrado",
            "texto": "Al facturar una venta, «Nueva factura» propone lo cobrado que falta por facturar, no el precio entero. Si pones más, te dice cuánto queda; si la diferencia es justo el IVA, te pide marcar «IVA incluido». Para un caso de verdad, como una empresa que paga a 30 días, se puede emitir igualmente.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas",
            "boton": "Ir a Facturación"
          },
          {
            "titulo": "La cola de facturación, sin cobros ya cubiertos",
            "texto": "Un cobro deja de pedir factura si la venta ya tiene una que la cubre entera. Y el botón de factura de una venta ya enseña los errores, que antes se perdían sin aviso.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/pendiente-facturar",
            "boton": "Ver pendientes de facturar"
          },
          {
            "titulo": "Borrar una venta devuelve la ficha",
            "texto": "Si se borra la única venta de una persona, su ficha vuelve al estado que tenía antes (o a «Contactado») y vuelve a salir en Prospectos. Antes se quedaba en «convertido» y no salía ni en Prospectos ni en Clientes.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          }
        ]
      },
      {
        "titulo": "Prospectos y la cola del día",
        "items": [
          {
            "titulo": "Prospectos, con sus cifras y el «Resumen del día»",
            "texto": "Arriba, cuatro cifras: prospectos, sin asignar, los que piden atención (al pulsarla se filtran) y convertidos. Debajo, el «Resumen del día», plegado al entrar: el reparto por estado, las siguientes acciones (lo más atrasado primero) y los accesos que te tocan. Recuerda si lo dejaste abierto.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "Ficha rápida o completa, desde la lista",
            "texto": "Cada fila de Prospectos tiene dos atajos: uno abre la ficha rápida sin salir de la lista y otro la ficha completa, que también se puede abrir en otra pestaña.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "La cola del día, de un vistazo",
            "texto": "Arriba, cómo va el día: «3 de 7 llegan tarde» y una barra con lo atrasado, lo de hoy, lo de mañana y lo de la semana. El paso de cada fila va en una pastilla («Paso 2»).",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/cola",
            "boton": "Abrir la cola del día"
          }
        ]
      },
      {
        "titulo": "Usuarios y accesos",
        "items": [
          {
            "titulo": "Cada uno, dentro de sus campus",
            "texto": "Con «Todos» o con una empresa elegida, cada pantalla enseña solo los campus que tienes asignados: contabilidad, nóminas, comisiones, WhatsApp, conectores… Un campus que no es tuyo no se abre. Super admin y soporte lo siguen viendo todo.",
            "roles": [
              "gestor",
              "admin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Cambiar el correo o la contraseña de alguien",
            "texto": "En Configuración → Usuarios, el super admin cambia el correo o la contraseña de cualquiera, menos de otro super admin. Al cambiar el correo se cierran sus sesiones, a la dirección vieja le llega un aviso y, con «Reenviar enlace de acceso», a la nueva el enlace para poner contraseña. Si esa persona recibe prospectos por Make, se avisa antes de guardar: hay que cambiarlo también allí.",
            "roles": [
              "superadmin"
            ],
            "ruta": "/configuracion",
            "boton": "Ir a Configuración"
          },
          {
            "titulo": "Tutores: correo y contraseña, solo el super admin",
            "texto": "Cambiar el correo o la contraseña de un tutor pasa a ser solo del super admin; antes podían también admin y colaboraciones. La contraseña nueva se escribe dos veces y pide 8 caracteres, una mayúscula y un número.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores",
            "boton": "Ir a Tutores"
          }
        ]
      },
      {
        "titulo": "Claude (MCP), más seguro",
        "items": [
          {
            "titulo": "Las conexiones de Claude, en un solo sitio",
            "texto": "En Conexión → MCP, super admin y admin trabajan con «Conexiones de Claude»: el nombre, para quién es, y cada persona saca ahí su URL. Si te queda una URL personal suelta, sale aparte para revocarla. Las gestoras con acceso siguen con «Tu URL personal».",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/mcp",
            "boton": "Abrir Conexión → MCP"
          },
          {
            "titulo": "Las URLs de Claude caducan",
            "texto": "Cada URL dura 90 días y 7 días antes te llega un correo para sacar una nueva. Una URL que no se usa en 30 días se anula sola, y al desactivar a una persona se anulan las suyas. En pantalla ves cuándo caduca cada una y desde dónde se usó por última vez.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/mcp",
            "boton": "Ver mis URLs"
          },
          {
            "titulo": "Actividad y alertas",
            "texto": "En Conexión → MCP → Actividad: quién preguntó qué a Claude, cuándo, desde dónde y con qué resultado. Un admin ve lo de sus empresas. Ante algo raro (muchas consultas seguidas, un equipo o una red nuevos, consultas de madrugada) llega una alerta por correo.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/mcp",
            "boton": "Ver la actividad"
          },
          {
            "titulo": "Interruptor y datos protegidos",
            "texto": "El super admin puede apagar Claude para todos con un botón y volver a encenderlo. En las listas, Claude ya no enseña correos ni teléfonos completos y abrevia los nombres; los datos completos, solo si se piden, y queda registrado. Como mucho, 100 filas por respuesta.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/conexion/mcp",
            "boton": "Abrir Conexión → MCP"
          },
          {
            "titulo": "Claude conoce el catálogo",
            "texto": "Pregúntale por las formaciones de tus campus: precio, moneda, enlace, plazas, cierre de convocatoria, dossier y tutor, o un resumen de precios por campus. Nunca da enlaces de pago, y si un dato no está en el CRM, lo dice.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Claude y las entregas de los tutores",
            "texto": "Claude dice qué ha entregado cada tutor (foto, vídeo y porcentaje de módulos), igual que la columna «Entregado» de Comisiones, y qué comisiones se pueden pagar ya.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores/comisiones",
            "boton": "Ir a Comisiones"
          }
        ]
      }
    ],
    "arreglos": [
      "Al borrar la última factura de una serie, la siguiente ya no se salta números.",
      "El botón «Asignar pendientes» de Prospectos ya sale cuando hay prospectos sin gestora.",
      "En la cabecera de Prospectos ya no está «Audiencias», que llevaba a una pantalla que no existe. «Reportes» pasa al «Resumen del día».",
      "El asunto del correo «¿por qué has desistido?» lleva el nombre de la persona, bien escrito.",
      "El logo de la cabecera de los correos se reconoce en el móvil.",
      "Los documentos de una matrícula (DNI, título, firma) se abren con un enlace que vale 15 minutos. Si «Ver documento» no abre, recarga la ficha.",
      "Los correos de Claude (la URL que caduca, el bloqueo y las alertas) y el de «ha cambiado tu correo» llevan ya el mismo formato que el resto de correos del CRM, con su marca."
    ]
  },
  {
    "version": "2.0.0",
    "fecha": "2026-09-29",
    "titulo": "Versión 2.0.0",
    "intro": "El proceso comercial completo, la encuesta a quien no compra con la marca de ISEIE y mejoras en ventas y facturación. Aquí está todo lo nuevo, con un botón para ir a cada pantalla.",
    "grupos": [
      {
        "titulo": "Proceso comercial",
        "items": [
          {
            "titulo": "Seguimiento de fin de mes",
            "texto": "Pantalla nueva dentro de Prospectos. Reúne a quien entró hace más de 15 días, no ha comprado ni ha dicho que no, y nadie ha tocado en el último mes. Primero sale quien nunca recibió un contacto; se filtra por nombre, formación, antigüedad y estado.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/seguimiento",
            "boton": "Abrir el seguimiento"
          },
          {
            "titulo": "El seguimiento, en bloque y para Wasapi",
            "texto": "Cada fila lleva WhatsApp y correo para atender a la persona sin abrir nada. Si marcas varias, les apuntas el contacto de una vez o copias sus teléfonos o correos. Y la lista entera se descarga en el formato de Wasapi.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/seguimiento",
            "boton": "Ir al seguimiento"
          },
          {
            "titulo": "El proceso dentro de la ficha",
            "texto": "Al abrir un prospecto hay una pestaña «Proceso»: qué paso le toca, cuáles lleva hechos y el mensaje del paso listo para copiar, más un botón para escribir el correo del paso con su plantilla. En «Recordatorios» se ven las fechas de cada paso.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "Filtro por paso en Prospectos",
            "texto": "En los filtros aparece «Proceso de ventas»: eliges en qué paso va cada persona. El paso se calcula igual que en la cola, así que las dos pantallas dicen lo mismo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "La cola, también en Prospectos",
            "texto": "Arriba de Prospectos salen los contadores de la cola: atrasados, para hoy, para mañana y esta semana. Cada número abre la cola ya filtrada, y al lado está el acceso al seguimiento de fin de mes.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          },
          {
            "titulo": "La cola del día, para trabajarla sin salir",
            "texto": "Al pulsar a una persona se abre su panel con el mensaje del paso ya escrito con sus datos. Lo copias, apuntas el contacto y pasas a la siguiente. La lista se agrupa por paso (día 1, día 2…).",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/cola",
            "boton": "Abrir la cola del día"
          },
          {
            "titulo": "Buscar y filtrar en la cola",
            "texto": "Encima de la lista hay buscador por nombre, correo o teléfono, y filtros por formación, estado y fechas. Cada fila dice su estado, el historial se despliega dentro del panel y la cola enseña a todo el mundo, por páginas. El filtro de formación solo ofrece las que tiene la gente de la lista.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/cola",
            "boton": "Ir a la cola"
          },
          {
            "titulo": "Acciones en bloque en Prospectos",
            "texto": "Al marcar varias personas, además de cambiar el estado o reasignar, les apuntas el contacto a todas o copias sus teléfonos y correos para una difusión.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads",
            "boton": "Ir a Prospectos"
          }
        ]
      },
      {
        "titulo": "«¿Por qué has desistido?» y la marca",
        "items": [
          {
            "titulo": "El correo y la encuesta",
            "texto": "Cuando alguien pasa a «No interesado» le llega un correo con la marca de ISEIE desde noresponder@iseie.com y un enlace a una encuesta corta de seis preguntas. También a quien, 7 días después de su primer contacto, no ha comprado (cuenta desde el 29/09). Solo llega una vez por persona. Si pone Regular, Mal o Muy mal a la atención se le pide un comentario, y al final puede dejar los suyos. Lo que conteste queda en su ficha y su gestora recibe un aviso.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Descartar con motivo",
            "texto": "Al descartar a alguien del seguimiento se abre una ventana grande: quién es, qué va a pasar y el motivo en botones. Puedes confirmar y enviar, o elegir «Quiero verlo antes»: el correo espera en su ficha con «Enviar» o «No enviar».",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/leads/seguimiento",
            "boton": "Ir al seguimiento"
          },
          {
            "titulo": "«Que me contacte más adelante»",
            "texto": "Si en la encuesta pide que le volvamos a contactar, elige cuándo: en dos semanas, en un mes… o el año que viene. A su gestora le aparece un recordatorio ese día.",
            "roles": [
              "gestor"
            ],
            "ruta": null,
            "boton": null
          },
          {
            "titulo": "Panel de Feedback",
            "texto": "En Análisis → Feedback: cuántos correos salieron, cuántos contestaron, los motivos que más se repiten, la nota media de atención de cada gestora y todo lo que escribieron: en «Otro», el porqué de una nota baja y sus comentarios. En «Mes a mes», cada cifra abre la lista de personas.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes/feedback",
            "boton": "Abrir Feedback"
          },
          {
            "titulo": "El feedback, también en Reportes",
            "texto": "Reportes tiene un bloque con esas cifras para las fechas elegidas y un botón para descargar las respuestas. El Excel de Reportes lleva además una hoja «Feedback».",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Abrir Reportes"
          },
          {
            "titulo": "Configuración → Marca",
            "texto": "Sección nueva en Configuración: logo, color, el fondo sobre el que va el logo (con vista previa), el remitente «no contestar» y la cuenta de envío de correos. Es lo que ven los alumnos en el correo de feedback y en su encuesta, y se cambia sin tocar nada más.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/configuracion",
            "boton": "Ir a Configuración"
          }
        ]
      },
      {
        "titulo": "Equipo y resultados",
        "items": [
          {
            "titulo": "Tus correos del CRM, con datos y con la marca",
            "texto": "Cada noche te llega «Tu día y lo de mañana»: lo que hiciste hoy, lo que te toca mañana en la cola, tus recordatorios con enlace y cómo va tu mes. Los lunes, «Tu semana»: tus números contra la semana anterior y la media del equipo, y tu puesto. Se apagan en «Mis preferencias».",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/preferencias",
            "boton": "Ver mis avisos"
          },
          {
            "titulo": "Resumen del día y reporte semanal, por empresa",
            "texto": "Dirección recibe cada tarde el resumen del día y los lunes el reporte de la semana, con una sección por empresa —su logo, sus cifras, cada gestora y cada campus—. Quien lleva varias empresas recibe un solo correo con todas.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Abrir Reportes"
          },
          {
            "titulo": "«Cómo voy»",
            "texto": "Cada gestora ve su puesto del mes, sus ventas y su tasa de conversión al lado de la media del equipo. Quien dirige ve un podio con las tres primeras y el ranking completo. Sale en el Dashboard, en Prospectos y en Clientes.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/dashboard",
            "boton": "Ir al Dashboard"
          },
          {
            "titulo": "Asesoras: la cuenta «Contabilidad»",
            "texto": "En «Asesoras, mes a mes» hay una tercera forma de contar, «Contabilidad», que es la que cuadra con las hojas de facturación: cada factura cuenta en el mes en que queda cobrada. Pasa a ser la que sale por defecto.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/informes",
            "boton": "Abrir Reportes"
          }
        ]
      },
      {
        "titulo": "WhatsApp",
        "items": [
          {
            "titulo": "Tus propias plantillas",
            "texto": "Con «Nueva mía» guardas una plantilla sin salir del chat, a partir de lo que estás escribiendo, y el filtro «Mías» te enseña solo las tuyas. Son del número de WhatsApp, no de quien entra.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/whatsapp/chat",
            "boton": "Abrir el chat"
          },
          {
            "titulo": "Plantillas por paso, desde cualquier sitio del chat",
            "texto": "Las plantillas se filtran por paso del proceso (Día 1, Día 2…) y se abren también desde la barra de arriba del chat, aunque no tengas una conversación abierta. Elegir una plantilla no la envía.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/whatsapp/chat",
            "boton": "Abrir el chat"
          }
        ]
      },
      {
        "titulo": "Ventas, facturación y usuarios",
        "items": [
          {
            "titulo": "«Nueva venta», con tres tipos",
            "texto": "El botón abre un menú: venta propia, venta de otra gestora (eliges el prospecto y la venta queda de quien lo lleva) y venta sin gestora, que no cuenta para nadie. La venta sin gestora solo pide el nombre y no le quita el turno a nadie.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/ventas",
            "boton": "Ir a Ventas"
          },
          {
            "titulo": "Cambiar una cuota pendiente",
            "texto": "En el plan de cuotas, cada cuota sin cobrar deja cambiar su fecha y su importe. Ya no hace falta borrar el plan y rehacerlo.",
            "roles": [
              "gestor",
              "admin",
              "superadmin"
            ],
            "ruta": "/ventas",
            "boton": "Ir a Ventas"
          },
          {
            "titulo": "Aviso de números de factura que faltan",
            "texto": "El Dashboard y Facturación avisan cuando en la serie falta algún número de factura, para completarlo antes de una revisión.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/accounting/facturas",
            "boton": "Ir a Facturación"
          },
          {
            "titulo": "Más de un rol por persona",
            "texto": "Al editar un usuario, «Y además es…» le suma otro rol. Por ejemplo, una gestora que también da clase ve Prospectos y además sus cursos de tutora.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/configuracion",
            "boton": "Ir a Configuración"
          },
          {
            "titulo": "Sin tutor: también lo de antes del corte",
            "texto": "La casilla «Incluir ventas anteriores al corte» enseña también las formaciones sin tutor vendidas antes del 1 de agosto. Salen marcadas para no mezclarlas con las de ahora.",
            "roles": [
              "admin",
              "superadmin"
            ],
            "ruta": "/tutores/sin-tutor",
            "boton": "Ver formaciones sin tutor"
          }
        ]
      }
    ],
    "arreglos": [
      "Los prospectos dados de alta a mano o por carga masiva ya entran en la cola del día.",
      "Los atajos de la cola en Prospectos llevan a su pantalla. Antes no llevaban a ninguna parte.",
      "Un teléfono copiado de un chat de WhatsApp ya no se rechaza por caracteres invisibles.",
      "Se puede crear un prospecto con solo el usuario de WhatsApp.",
      "Un lead creado desde WhatsApp ya no le quita el turno del reparto a otra gestora.",
      "Una venta con fecha pasada y cliente nuevo ya no da error.",
      "Una venta repartida entre dos gestoras sale marcada en Ingresos y en Ventas, y en Reportes a cada una le cuenta su mitad.",
      "La gestora puede cambiar el número de una factura, y si ya está cogido se le avisa.",
      "Los permisos que se dan a una persona concreta ya se respetan en pantalla.",
      "Al quitar a un tutor de un curso, el curso vuelve a «Sin tutor» y queda la fecha en que dejó de estar.",
      "El catálogo lee bien las horas de cada programa desde la web.",
      "Las notas admiten textos largos: hasta 10.000 caracteres.",
      "Un móvil español escrito sin +34 ya se guarda como español.",
      "El aviso de números de factura que faltan vuelve a funcionar."
    ]
  }
];

/**
 * Cada versión con sus listas aunque no traiga alguna. La 2.2.0 no tenía
 * `arreglos`, y la pantalla, el PDF, el correo y la campana hacían
 * `v.arreglos.length`: Novedades salía en «Algo se ha roto». Una versión sin
 * arreglos es una lista vacía, no un fallo (CRM#625 / ISEIE#352, de Hugo).
 */
export const VERSIONES = LISTA.map((v) => ({
  ...v,
  grupos: (v.grupos || []).map((g) => ({ ...g, items: g.items || [] })),
  arreglos: v.arreglos || [],
}));

export const ACTUAL = VERSIONES[0];

export function versionDe(version) {
  return VERSIONES.find((v) => v.version === version) || null;
}
