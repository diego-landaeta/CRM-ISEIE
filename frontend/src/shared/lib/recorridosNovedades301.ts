import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS NUEVOS DE LA 3.0.0 (Diego, 24/11: «actualiza Novedades para ver
 * y que los recorridos estén actualizados»): los de lo que trajeron la 2.9.8 y la
 * 3.0.0 y aún no tenía recorrido.
 *
 *  1. Consultas y el chat del campus (3.0.0). Los dos de Consultas llevan además
 *     los pasos de la tanda D de recorridos (#619 / CRM#941): las pestañas,
 *     «Mis consultas / Todas», la bandeja de la izquierda y la ficha del alumno.
 *     Un solo «Ver recorrido» por pantalla.
 *  2. Conciliación › Facturas y cobros (2.9.8, CRM#905).
 *  3. El avance del alumno en la pestaña «Campus» de su ficha (3.0.0, #532).
 *
 * Como los demás, se suman a `RECORRIDOS_COBROS`: el botón «Recorrido» de la
 * cabecera, «Ver recorrido» de cada pantalla y de Novedades, y las pruebas de
 * siempre los ven. Solo importa TIPOS de `recorridosCobros` (sin ciclo).
 */
export type IdRecorridoNovedades301 = 'consultas-chat' | 'conciliacion-facturas' | 'avance-alumno' | 'consulta-responder' | 'facturacion-automatica';

type RecorridoNovedades301 = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoNovedades301 };

const anclaje = (nombre: string) => `[data-recorrido="${nombre}"]`;

export const RECORRIDOS_NOVEDADES_301: Record<IdRecorridoNovedades301, RecorridoNovedades301> = {
  // ─── Consultas: el chat del campus (3.0.0) ─────────────────────────────────
  'consultas-chat': {
    id: 'consultas-chat',
    rutas: ['/consultas'],
    titulo: 'Consultas y el chat del campus',
    permiso: ['consultas.view', 'consultas.atender'],
    pantalla: ['modules/consultas/pages/ConsultasPage.tsx'],
    pasos: [
      {
        titulo: 'Las dudas de los alumnos',
        texto: 'Lo que el alumno escribe en el chat de Moodle llega aquí. Se contesta desde el CRM y la respuesta le sale en Moodle, a nombre de su tutora. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consultas-pestanas'),
        titulo: 'Las pestañas',
        texto: 'Además de la bandeja: los alumnos que no han escrito nunca, tu carga si eres tutora, los tutores si llevas el equipo, las métricas y, si coordinas, las respuestas del campus.',
      },
      {
        donde: anclaje('consultas-vista'),
        titulo: 'Las tuyas o todas',
        texto: 'Si eres tutora y además llevas el equipo: «Mis consultas» son las que te tocan responder; «Todas», las de todos los tutores.',
      },
      {
        donde: anclaje('consultas-estado'),
        titulo: 'Pendientes primero',
        texto: '«Pendientes» son las que esperan respuesta. El color dice cuánto llevan esperando: verde, a tiempo; ámbar, cerca del plazo; rojo, pasado el plazo. En «Todas», «Solo sin tutor» deja las que no tienen a nadie.',
      },
      {
        donde: anclaje('consultas-buscar'),
        titulo: 'Buscar',
        texto: 'Por el nombre del alumno, su correo o el curso.',
      },
      {
        donde: anclaje('consultas-lista'),
        titulo: 'Abrir y contestar',
        texto: 'Pulsa una consulta para ver la conversación entera y escribir la respuesta. Si pone «respuesta sin llegar al campus», ábrela: desde la consulta se vuelve a enviar.',
      },
      {
        donde: anclaje('consultas-leer'),
        permiso: 'consultas.gestionar',
        titulo: 'Leer el campus ahora',
        texto: 'El CRM lee el campus solo cada 5 minutos. Si esperas una duda que acaba de escribir un alumno, pulsa aquí.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
  // ─── Finanzas › Conciliación › Facturas y cobros (2.9.8, #905) ─────────────
  'conciliacion-facturas': {
    id: 'conciliacion-facturas',
    rutas: ['/accounting/conciliacion/facturas'],
    titulo: 'Conciliación: facturas y cobros',
    permiso: 'facturas.gestionar',
    pantalla: ['modules/accounting/pages/ConciliacionFacturasPage.tsx'],
    pasos: [
      {
        titulo: 'Cada factura con su cobro',
        texto: 'Aquí salen las facturas emitidas que no tienen su cobro apuntado y los cobros que no tienen factura, para enlazarlos. Enlazar no cambia el número, el importe ni los datos del cliente. Son {pasos} pasos.',
      },
      {
        donde: anclaje('conciliacion-filtros'),
        titulo: 'Campus y mes',
        texto: 'Elige el campus y el mes que quieres cuadrar. Arriba ves cuántas hay de cada tipo.',
      },
      {
        donde: anclaje('conciliacion-sin-cobro'),
        titulo: 'Facturas sin cobro',
        texto: 'Cada factura propone los cobros que le pueden corresponder: mismo campus, mismo importe, a 7 días o menos y del mismo cliente (venta, correo, nombre o NIF). «Enlazar» la une con el que es.',
      },
      {
        donde: anclaje('conciliacion-sin-factura'),
        titulo: 'Cobros sin factura',
        texto: 'Los cobros que no tienen factura, con la factura que les puede corresponder. Si no tienen ninguna, «Emitir factura» te lleva a la cola de facturación de su campus.',
      },
      {
        donde: anclaje('conciliacion-todas'),
        titulo: 'Enlazar todas las seguras',
        texto: 'Las parejas «seguras» (la factura solo casa con ese cobro y el cobro solo con esa factura) se enlazan de una vez. Antes te pide confirmar.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
  // ─── Ficha del cliente › pestaña «Campus»: su avance en Moodle (#532) ───────
  'avance-alumno': {
    id: 'avance-alumno',
    rutas: ['/clients/:id'],
    titulo: 'El avance del alumno en Moodle',
    permiso: 'clients.view',
    pantalla: [
      'modules/clients/pages/ClientDetailPage.tsx',
      'modules/clients/components/AvanceMoodle.tsx',
    ],
    pasos: [
      {
        titulo: 'Cómo va en el campus',
        texto: 'En la ficha del cliente se ve lo que dice Moodle de él, sin entrar en Moodle: cada curso, cuándo entró por última vez, cuánto lleva hecho y sus notas. Son {pasos} pasos.',
      },
      {
        donde: anclaje('ficha-pestana-campus'),
        titulo: 'La pestaña «Campus»',
        texto: 'Sale cuando su campus tiene Moodle conectado. Púlsala para ver su avance; si ya estás en ella, sigue.',
      },
      {
        donde: anclaje('avance-campus'),
        titulo: 'Cada campus, con su alumno',
        texto: 'Arriba, cuándo entró por última vez y el enlace a su perfil en Moodle. Debajo, sus cursos.',
      },
      {
        donde: anclaje('avance-curso'),
        titulo: 'Cada curso',
        texto: 'Cuándo se matriculó, su último acceso y el % hecho. «Sin seguimiento» quiere decir que ese curso no tiene activada la finalización de actividades en Moodle.',
      },
      {
        donde: anclaje('avance-actualizar'),
        titulo: 'Actualizar',
        texto: 'Se lee de Moodle al abrir la pestaña. Si el alumno acaba de entregar algo, pulsa «Actualizar».',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
  // ─── Consultas › una consulta: responder al alumno (24/11) ──────────────────
  'consulta-responder': {
    id: 'consulta-responder',
    rutas: ['/consultas/:id'],
    titulo: 'Responder una consulta',
    permiso: ['consultas.view', 'consultas.atender'],
    pantalla: ['modules/consultas/pages/ConsultaPage.tsx'],
    pasos: [
      {
        titulo: 'Contestar al alumno',
        texto: 'Lo que escribes aquí le llega al alumno en el chat de Moodle, a nombre de su tutora. Son {pasos} pasos.',
      },
      {
        donde: anclaje('consulta-bandeja'),
        titulo: 'Las pendientes',
        texto: 'Las que esperan respuesta, con el plazo de cada una. Pulsa otra para pasar a ella sin volver a la lista.',
      },
      {
        donde: anclaje('consulta-mensajes'),
        titulo: 'La conversación',
        texto: 'Todo lo que se han escrito, por días. La doble marca quiere decir que la respuesta ya está en el campus. Si no llegó, sale un aviso con «Reintentar».',
      },
      {
        donde: anclaje('consulta-escribir'),
        permiso: 'consultas.atender',
        titulo: 'Escribe la respuesta',
        texto: 'Escríbela aquí. Con Ctrl + Intro se envía.',
      },
      {
        donde: anclaje('consulta-nota'),
        titulo: 'Nota interna',
        texto: 'Para dejar algo al resto del equipo: el alumno no la ve. Administración solo puede dejar notas; responde la tutora.',
      },
      {
        donde: anclaje('consulta-guardadas'),
        permiso: 'consultas.atender',
        titulo: 'Respuestas guardadas',
        texto: 'Las que más repites, a un clic. Las guardas tú, o las comparte el campus.',
      },
      {
        donde: anclaje('consulta-adjuntar'),
        permiso: 'consultas.atender',
        titulo: 'Adjuntar',
        texto: 'PDF, imágenes, Word, Excel o texto. Llegan al alumno con la respuesta.',
      },
      {
        donde: anclaje('consulta-enviar'),
        permiso: 'consultas.atender',
        titulo: 'Enviar',
        texto: '«Enviar» la manda y deja la consulta abierta. «Enviar y cerrar» la manda y la da por resuelta.',
      },
      {
        donde: anclaje('consulta-cerrar'),
        titulo: 'Cerrar',
        texto: 'Cuando ya está resuelta. Si el alumno vuelve a escribirte por privado, se abre sola (lo que escriba en el grupo del curso no la reabre).',
      },
      {
        donde: anclaje('consulta-ficha'),
        titulo: 'La ficha del alumno',
        texto: 'Quién la atiende, sus entregas sin corregir, sus cursos, sus otras consultas y su actividad, por apartados. Si llevas el equipo, aquí está «Reasignar» a otro tutor.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
  // ─── Finanzas › Facturas › Facturación automática (3.0.0, #764/#765) ───────
  'facturacion-automatica': {
    id: 'facturacion-automatica',
    rutas: ['/accounting/facturas/automatica'],
    titulo: 'Facturación automática',
    permiso: 'facturas.automatica',
    pantalla: ['modules/factura-automatica/pages/FacturacionAutomaticaPage.tsx'],
    pasos: [
      {
        titulo: 'La factura sale sola',
        texto: 'Al entrar un cobro, el alumno recibe un formulario para sus datos fiscales. Al contestarlo, la factura sale sola con su número y le llega en PDF. A los 7 días sin respuesta, sale con su ficha si está completa; si no, queda en la cola. Son {pasos} pasos.',
      },
      {
        donde: anclaje('fa-resumen'),
        titulo: 'De un vistazo',
        texto: 'Formularios enviados, contestados, vencidos (sin respuesta en el plazo) y esperando; las que necesitan a una persona y las facturas que salieron solas.',
      },
      {
        donde: anclaje('fa-atencion'),
        titulo: 'Lo que necesita a una persona',
        texto: 'En revisión (faltan datos válidos), posible duplicada, sin correo… Cada una dice por qué no salió sola y qué hacer, con el botón para ir a la cola o a la venta.',
      },
      {
        donde: anclaje('fa-formularios'),
        titulo: 'Los formularios',
        texto: 'A qué correo se mandó cada uno, si lo contestó y hasta cuándo tiene. Filtra por «Esperando», «Contestados», «Vencidos» o «En revisión».',
      },
      {
        donde: anclaje('fa-facturas'),
        titulo: 'Las facturas que salieron solas',
        texto: 'Con su número y a qué correo se mandó el PDF. Si la venta dice «Enviar factura automáticamente: No», pone «No se envía automáticamente: la envía la gestora».',
      },
      {
        donde: anclaje('fa-auditoria'),
        permiso: 'facturas.auditoria',
        titulo: 'La auditoría',
        texto: 'Cada 2 horas mira números repetidos, facturas sin datos fiscales y cobros sin factura. Aquí ves la última vuelta y las pausas. La «Pasada en seco» dice qué encontraría hoy sin pausar nada.',
      },
      {
        titulo: 'Sí o No, y el correo',
        texto: 'Al registrar la venta, en la ficha de la venta o en la cola: «Enviar factura automáticamente: Sí / No» y «Enviar a este correo», con «Confirmar» o «Editar». El formulario y el PDF van a ese correo.',
      },
      { titulo: 'Y listo', texto: FINAL },
    ],
  },
};
