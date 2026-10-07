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

export const VERSIONES = [
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

export const ACTUAL = VERSIONES[0];

export function versionDe(version) {
  return VERSIONES.find((v) => v.version === version) || null;
}
