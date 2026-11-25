import type { PasoRecorrido } from '@/shared/components/ui/RecorridoGuiado';
import { anclaje, FINAL_RECORRIDO } from '@/shared/lib/recorridosComun';

/*
  EL RECORRIDO GENERAL, SEGÚN EL ROL (CRM-ISEIE#681, gemela de CRM#1012; Diego, 23/11).

  «un recorrido general según tu rol»: qué partes del menú usa esa persona, para
  qué sirve cada una y dónde está lo que hace cada día. SOLO enseña lo que puede
  ver: los bloques y las entradas salen del MISMO filtro que el menú lateral
  (`entradasDeSeccion` de `Sidebar.jsx`, con sus permisos, roles y módulos), así
  que no se le explica nada que no tenga.

  Aquí solo se arma el texto (función pura, se prueba sin pintar nada). Quien lo
  lanza es `BotonRecorrido`, arriba a la derecha (directo en una pantalla sin recorrido,
  o desde su flecha); en el móvil abre antes el menú.
*/

/** Un bloque del menú tal como lo ve esa persona: su nombre y sus entradas. */
export interface BloqueVisible {
  label: string;
  /** El `data-recorrido` del bloque en el menú lateral. */
  ancla: string;
  entradas: string[];
}

export const NOMBRE_DEL_ROL: Record<string, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  gestor: 'Gestora',
  lider_equipo: 'Líder de equipo',
  soporte: 'Soporte',
  project_manager: 'Project manager',
  tutor: 'Tutor',
  colaborador: 'Colaborador',
  tutor_redactor: 'Tutor redactor',
};

/** Para qué sirve cada bloque. Uno nuevo sin texto aquí sale con sus entradas igual. */
export const PARA_QUE_SIRVE: Record<string, string> = {
  Testeo: 'Lo que se está probando en este servidor antes de salir a producción.',
  Hoy: 'Lo de cada mañana: el resumen del día, la cola de prospectos que te tocan hoy, el seguimiento de fin de mes y tu WhatsApp.',
  Comercial: 'Lo que se vende y a quién: prospectos, ventas, links de pago, clientes y duplicados.',
  'Proyecto IA': 'Las cifras de los proyectos de IA: suscripciones, pagos y bajas.',
  'Captación y publicidad': 'De dónde llegan los prospectos: formularios, widget de WhatsApp, correos y Meta Ads.',
  Académico: 'El catálogo de cursos y los tutores: productos, formaciones y quién imparte qué.',
  // Diego, 25/11: apartado Moodle.
  Moodle: 'Todo lo de Moodle: Mi campus, las consultas de los alumnos, los cursos y alumnos de cada campus, el curso de cada producto, los cursos pendientes, los diplomas y la conexión del campus.',
  Finanzas: 'El dinero: ventas cobradas, facturas, Stripe, gastos, comisiones y conciliación.',
  Análisis: 'Informes para decidir: reportes, feedback de los alumnos y cifras del equipo.',
  Configuración: 'Usuarios, roles, integraciones (Stripe, Brevo, MCP, webhooks) y las reglas del CRM.',
  Sistema: 'Lo técnico: registro de lo que pasa, correos enviados, estado del servidor y novedades.',
  'Equipo de Desarrollo': 'El tablero de tareas del equipo, su historial y su configuración.',
};

/** Dónde está lo de cada día, por rol (el principal manda). */
export const CADA_DIA: Record<string, string> = {
  superadmin: 'Cada día: «Hoy» para las cifras y las alertas, Comercial para el equipo y Finanzas para la cola de facturación y los cobros de Stripe. Solo tú creas y desactivas usuarios y cambias los roles (Configuración).',
  admin: 'Cada día: «Hoy» para las cifras y las alertas de tus campus, Comercial para los prospectos y las ventas del equipo, y Finanzas para facturar y revisar los cobros. Las integraciones, en Configuración.',
  gestor: 'Cada mañana: «Hoy», y en él «La cola del día» con los prospectos que te tocan (un paso por contacto y día). Cuando alguien compra, registra la venta y mándale el link de pago desde «Links de pago» o desde su ficha.',
  // CRM-ISEIE#761: una gestora que además lleva un equipo comercial.
  lider_equipo: 'Cada mañana, como una gestora: «Hoy» y «La cola del día» con lo tuyo. Además, lo de tu equipo: en Prospectos y en la cola eliges a una de tus gestoras, «Cómo voy» enseña el ranking de tu equipo con tu puesto, y en Reportes y Ventas ves sus cifras.',
  soporte: 'Tu día: Incidencias y Soporte para lo que llega del equipo, y Configuración y Sistema (registro, correos, estado) para ver qué pasa. Ves todos los campus.',
  project_manager: 'Tu día: las solicitudes de cambio y, como una gestora, tus prospectos y tus ventas. Las demás pantallas de tus campus las ves sin tocarlas.',
  tutor: 'Tu día: «Mi campus» para corregir tareas y ver a tus alumnos, Consultas para responderles y tus comisiones cuando toca cobrar.',
  tutor_redactor: 'Tu día: tu tablero de tareas con los cursos que haces, las consultas de los alumnos y, a fin de mes, «Mi factura».',
  colaborador: 'Tu día: tu tablero de tareas. A fin de mes, «Mi factura» para subir la tuya.',
};

/** «A, B, C y 4 más». */
export function enumerar(lista: string[], max = 6): string {
  const l = lista.filter(Boolean);
  if (!l.length) return '';
  if (l.length <= max) return l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} y ${l.at(-1)}`;
  return `${l.slice(0, max).join(', ')} y ${l.length - max} más`;
}

export function pasosDelRecorridoGeneral({ roles, bloques, nombre }: {
  /** Todos sus roles, el principal primero (`rolesDe`). */
  roles: string[];
  bloques: BloqueVisible[];
  nombre?: string | null;
}): PasoRecorrido[] {
  const principal = roles[0] || '';
  const nombreRol = roles.map((r) => NOMBRE_DEL_ROL[r] || r).join(' y ') || 'tu usuario';
  const saludo = nombre ? `${String(nombre).split(' ')[0]}, este` : 'Este';
  const pasos: PasoRecorrido[] = [
    {
      titulo: `Tu CRM, como ${nombreRol}`,
      texto: `${saludo} es el recorrido de lo que tú usas: las partes del menú que tus permisos te dejan ver, para qué sirve cada una y dónde está lo de cada día. Son {pasos} pasos.`,
    },
    {
      donde: anclaje('menu-buscar'),
      titulo: 'Buscar cualquier cosa',
      texto: 'Un prospecto, una venta, una pantalla… Escribe aquí o pulsa Ctrl K (⌘ K en Mac) desde cualquier sitio.',
    },
  ];
  for (const b of bloques) {
    if (!b.entradas.length) continue;
    const para = PARA_QUE_SIRVE[b.label] || '';
    const tienes = `Tienes: ${enumerar(b.entradas)}.`;
    pasos.push({
      donde: anclaje(b.ancla),
      titulo: b.label,
      texto: `${para}${para ? ' ' : ''}${tienes}`,
    });
  }
  const dia = CADA_DIA[principal];
  if (dia) pasos.push({ titulo: 'Lo de cada día', texto: dia });
  pasos.push(
    // (En ISEIE no hay selector de campus arriba, como en el 360: ese paso no va.)
    {
      donde: anclaje('cabecera-recorrido'),
      titulo: 'El recorrido de cada pantalla',
      texto: 'Cada pantalla que lo tiene, con sus botones y sus filtros de verdad: entra en ella y pulsa «Recorrido». Donde no hay, sale este. La flecha de al lado te deja elegir entre el de la pantalla y este general. Ninguno se abre solo.',
    },
    { titulo: 'Y listo', texto: FINAL_RECORRIDO },
  );
  return pasos;
}
