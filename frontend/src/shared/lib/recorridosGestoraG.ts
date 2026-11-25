import type { RecorridoCobros } from '@/shared/lib/recorridosCobros';
import { FINAL_RECORRIDO as FINAL, anclaje } from '@/shared/lib/recorridosComun';

/**
 * LOS RECORRIDOS DEL BLOQUE ACADÉMICO (#619, tanda I, la última; gemela de
 * CRM#941). Diego, 19/11: «las que son así, dáselas a Ángel CEDIA». Lo que le
 * faltaba al bloque, en el orden del menú:
 *
 *  · Productos: el catálogo del campus.
 *  · Cursos pendientes: lo vendido que aún no existe en el campus.
 *  · WooCommerce: la tienda de la web y la importación de sus productos.
 *  · Árbol de categorías: las categorías del catálogo.
 *  · Mis cursos: lo que le corresponde a un tutor por sus cursos.
 *  · Sin tutor: lo que ya cobra y no tiene a quién pagarle comisión.
 *
 * Ya tenían el suyo: Cursos de Moodle (`recorridosCobros.ts`), Tutores
 * (`recorridosGestoraD.ts`), Mi campus y Consultas (novedades y tanda E) y
 * Comisiones de tutores (`recorridosFinanzas.ts`). Diplomas no entra: es de
 * Certifex.
 *
 * El mismo modelo que `recorridosCobros.ts`, que es donde se registran: allí se
 * suman a `RECORRIDOS_COBROS`, y así `VerRecorrido`, el botón «Recorrido» de la
 * cabecera (por sus `rutas`) y las pruebas de siempre (la de los anclajes y la
 * de 375 px) los ven sin tocar nada más. Ninguno se abre solo (#1012).
 *
 *  · Cada paso apunta a un `data-recorrido` de su pantalla; lo que no está en ese
 *    momento (no hay productos, la tienda sin conectar, la vista de subidas, lo
 *    de supervisión a una tutora) se salta solo.
 *  · El permiso de cada recorrido es el de la pantalla en el menú; el de un
 *    paso, el del botón que explica.
 *
 * Solo importa TIPOS de `recorridosCobros` (se borran al compilar): así no hay un
 * ciclo de módulos entre los dos ficheros.
 *
 * PARIDAD: mismos ids y anclajes que en el 360. Cambian las rutas (aquí el
 * catálogo cuelga de `/products`; allí, de `/productos`) y lo que cada pantalla
 * tiene: «Mis cursos» solo existe aquí (allí la tutora trabaja desde «Mi
 * campus»); «Productos por categoría», solo allí. Aquí el catálogo, la tienda y
 * el árbol son de un campus (allí, con una empresa o «Todos» arriba, se ven
 * todos), el catálogo cambia entre cuadrícula y lista y se edita desde la
 * ficha, y la tienda puede ser también páginas de WordPress sin WooCommerce.
 */

export type IdRecorridoGestoraG =
  | 'productos'
  | 'cursos-pendientes'
  | 'woocommerce'
  | 'arbol-categorias'
  | 'mis-cursos'
  | 'sin-tutor';

type RecorridoGestoraG = Omit<RecorridoCobros, 'id'> & { id: IdRecorridoGestoraG };

/** Por el menú: Académico. */
export const RECORRIDOS_GESTORA_G: Record<IdRecorridoGestoraG, RecorridoGestoraG> = {
  // ─── Académico › Productos ────────────────────────────────────────────────
  productos: {
    id: 'productos',
    rutas: ['/products'],
    titulo: 'Productos',
    permiso: 'products.view',
    pantalla: ['modules/products/pages/ProductsPage.tsx'],
    pasos: [
      {
        titulo: 'El catálogo',
        texto: 'Los cursos que vende el campus, con su precio: lo que se elige al apuntar una venta. Son {pasos} pasos.',
      },
      {
        donde: anclaje('productos-nuevo'),
        permiso: 'products.create',
        titulo: 'Nuevo producto',
        texto: 'Nombre, SKU, precio e IVA, la imagen y los datos del curso (horas, módulos, modalidad, plazas). El dossier en PDF se sube luego, en su ficha. Se crea en el campus de arriba.',
      },
      {
        donde: anclaje('productos-buscar'),
        titulo: 'Buscar',
        texto: 'Por nombre o SKU.',
      },
      {
        donde: anclaje('productos-vista'),
        titulo: 'Cuadrícula o lista',
        texto: 'En tarjetas, con su imagen, o en una lista más corta, uno debajo de otro.',
      },
      {
        donde: anclaje('productos-lista'),
        titulo: 'Los productos',
        texto: 'Cada uno con su SKU, su precio y su modalidad; los inactivos lo dicen. Pulsa uno para abrir su ficha: todo lo que se publica de él y su dossier en PDF.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Cursos pendientes ────────────────────────────────────────
  'cursos-pendientes': {
    id: 'cursos-pendientes',
    rutas: ['/products/pending'],
    titulo: 'Cursos pendientes',
    // Como en el menú: «Ver productos», o «Sus cursos» para la tutora (#770).
    permiso: ['products.view', 'tutores.mis_cursos'],
    pantalla: ['modules/cursos-pendientes/pages/CursosPendientesPage.tsx'],
    pasos: [
      {
        titulo: 'Lo vendido que aún no existe',
        texto: 'Las formaciones que se vendieron y todavía no están en el campus: quién las crea, para cuándo y qué alumnas esperan. Una tutora ve las suyas; quien supervisa, las de sus campus. Son {pasos} pasos.',
      },
      {
        donde: anclaje('pendientes-campus'),
        titulo: 'Campus a campus',
        texto: 'Una pestaña por campus con sus abiertos, sus retrasados y las alumnas que esperan, también los que están a cero. «Todos los campus» los junta, agrupados.',
      },
      {
        donde: anclaje('pendientes-vista'),
        permiso: 'tutores.gestionar',
        titulo: 'Cursos o control de subidas',
        texto: '«Control de subidas» enseña, curso a curso, qué falta por subir: los vídeos, los módulos en Moodle y los datos de la web.',
      },
      {
        donde: anclaje('pendientes-filtros'),
        titulo: 'Contadores y filtros',
        texto: 'Lo que suma la pestaña elegida. Puedes ver solo los retrasados, sacar también los cerrados y cancelados o, si supervisas, quedarte con una tutora. La flecha lo recarga.',
      },
      {
        donde: anclaje('pendientes-nuevo'),
        titulo: 'Nuevo pendiente',
        texto: 'Apunta a mano una formación vendida que aún no existe: el campus, el nombre tal como se vendió y el tipo. Si ya había uno abierto, no lo duplica. La tutora y la fecha se ponen luego, en su ficha.',
      },
      {
        donde: anclaje('pendientes-lista'),
        titulo: 'La lista',
        texto: 'Por fecha comprometida, con los retrasados arriba y en rojo (los días en negativo). Su estado, cómo va (foto, vídeo, módulos) y su tutora. Pulsa uno para abrir su ficha y moverlo.',
      },
      {
        donde: anclaje('pendientes-carga'),
        titulo: 'Carga y tiempos',
        texto: 'Solo para quien supervisa: cuántos cursos lleva cada tutora y cuántos se le retrasan, y por campus cuánto tarda una alumna, de la venta a tener su curso.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › WooCommerce ──────────────────────────────────────────────
  woocommerce: {
    id: 'woocommerce',
    rutas: ['/woocommerce'],
    titulo: 'WooCommerce',
    permiso: 'woocommerce.view',
    pantalla: ['modules/woocommerce/pages/WooCommercePage.tsx'],
    pasos: [
      {
        titulo: 'La tienda de la web',
        texto: 'WooCommerce es la tienda de la web del campus. Aquí se conecta y se traen sus productos al catálogo del CRM. Son {pasos} pasos.',
      },
      {
        donde: anclaje('woo-credenciales'),
        permiso: 'woocommerce.edit',
        titulo: 'Conectar la tienda',
        texto: 'La dirección de la tienda y sus claves de la API de WooCommerce (ck_ y cs_). La divisa vale para todo lo que se importe. Con la sincronización automática, el servidor la revisa cada tantos minutos.',
      },
      {
        donde: anclaje('woo-wordpress'),
        permiso: 'woocommerce.edit',
        titulo: 'WordPress y la página del curso',
        texto: 'Para traer más que la ficha de la tienda: el usuario de WordPress y su contraseña de aplicación, de dónde salen los cursos (la tienda, sus tipos de contenido o las páginas de WordPress, si la web no tiene tienda) y el lector de la página pública (temario, objetivos…). Todo se guarda con «Guardar», abajo.',
      },
      {
        donde: anclaje('woo-importar'),
        permiso: 'woocommerce.sync',
        titulo: 'Importar',
        texto: '«Preview» enseña cómo llega un producto (o el de la dirección que pegues) y debajo, qué campo va a cada campo del CRM; «Guardar mapeo» antes de importar. «Importar ahora» los trae todos, en segundo plano, y aquí se ve cómo va.',
      },
      {
        donde: anclaje('woo-historial'),
        titulo: 'Historial de imports',
        texto: 'Cada importación con cuántos productos trajo, cuántos creó, cuántos actualizó y cuántos se saltó. Si falló, el motivo.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Árbol de categorías ──────────────────────────────────────
  'arbol-categorias': {
    id: 'arbol-categorias',
    rutas: ['/configuracion/categorias-arbol'],
    titulo: 'Árbol de categorías',
    permiso: 'products.categorias',
    pantalla: ['modules/product-categories/pages/CategoriesTreePage.tsx'],
    pasos: [
      {
        titulo: 'Las categorías del catálogo',
        texto: 'Las categorías del campus, con los niveles que hagan falta. Vienen de la tienda (WC), del menú de WordPress o se crean a mano. Son {pasos} pasos.',
      },
      {
        donde: anclaje('arbol-acciones'),
        titulo: 'Sincronizar o crear',
        texto: '«Sincronizar WC» trae las categorías (y los productos) de la tienda; arriba sale cómo va. «Categoría raíz» crea una en el primer nivel.',
      },
      {
        donde: anclaje('arbol-filtros'),
        titulo: 'Buscar y filtrar',
        texto: 'Busca por nombre, quédate con las de un origen (a mano, WC o el menú de WordPress) u oculta las que no tienen productos.',
      },
      {
        donde: anclaje('arbol-lista'),
        titulo: 'El árbol',
        texto: 'Cada categoría con sus productos y su origen; la flecha abre las de debajo. Al pasar el ratón (en el móvil, siempre): «+» crea una subcategoría, el lápiz la renombra y la papelera la borra; antes te lo pregunta.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Mis cursos (el tutor; solo en este CRM) ──────────────────
  'mis-cursos': {
    id: 'mis-cursos',
    rutas: ['/mis-cursos'],
    titulo: 'Mis cursos',
    permiso: 'tutores.mis_cursos',
    pantalla: ['modules/tutores/pages/MisCursosPage.tsx'],
    pasos: [
      {
        titulo: 'Tus cursos y lo tuyo',
        texto: 'Lo que te corresponde por lo que se ha cobrado de tus cursos, mes a mes. Solo ves lo tuyo. Son {pasos} pasos.',
      },
      {
        donde: anclaje('miscursos-mes'),
        titulo: 'El mes',
        texto: 'Las cifras, lo que hay que facturar y el reparto por curso son de este mes. Cámbialo para ver otro.',
      },
      {
        donde: anclaje('miscursos-cifras'),
        titulo: 'Las cifras',
        texto: 'Lo que tienes pendiente de cobro y lo que ya se te pagó este mes, y todo lo que llevas desde que empezaste.',
      },
      {
        donde: anclaje('miscursos-facturar'),
        titulo: 'Lo que tienes que facturar',
        texto: 'La cuenta para tu factura del mes: la base, más el IVA y menos la retención, con los céntimos ya redondeados como van en la factura.',
      },
      {
        donde: anclaje('miscursos-graficas'),
        titulo: 'Mes a mes y por curso',
        texto: 'Lo que te ha correspondido en los últimos seis meses (el elegido, en color pleno) y qué curso te da más este mes.',
      },
      {
        donde: anclaje('miscursos-lista'),
        titulo: 'Tus cursos',
        texto: 'Cada uno con tu porcentaje, desde cuándo y lo de este mes. Pulsa uno para ver su ficha tal como se publica y bajar su brochure.',
      },
      {
        donde: anclaje('miscursos-historial'),
        titulo: 'Historial de ventas',
        texto: 'Cada cobro de tus cursos, del más reciente al más antiguo: lo que se cobró, tu porcentaje y lo que es para ti. Con un curso abierto, solo los suyos. Una línea «devuelta» no cuenta.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },

  // ─── Académico › Sin tutor ────────────────────────────────────────────────
  'sin-tutor': {
    id: 'sin-tutor',
    rutas: ['/tutores/sin-tutor'],
    titulo: 'Formaciones sin tutor',
    permiso: 'tutores.gestionar',
    pantalla: ['modules/tutores/pages/FormacionesSinTutorPage.tsx'],
    pasos: [
      {
        titulo: 'Lo que vende sin tutor',
        texto: 'Las formaciones que ya han cobrado algo y no tienen tutor: ese dinero no le genera comisión a nadie. Solo salen las que tienen al menos un cobro, no el catálogo entero. Son {pasos} pasos.',
      },
      {
        donde: anclaje('sintutor-corte'),
        titulo: 'Antes del corte',
        texto: 'De entrada cuentan los cobros desde que se pagan comisiones. Márcalo para ver también las que vendieron antes y siguen sin tutor: salen con «antes del corte».',
      },
      {
        donde: anclaje('sintutor-total'),
        titulo: 'Lo que suma',
        texto: 'Cuánto se ha cobrado entre todas, en cuántos cobros y de cuántos alumnos. Se arregla dándole un tutor a cada una.',
      },
      {
        donde: anclaje('sintutor-buscar'),
        titulo: 'Buscar',
        texto: 'Cuántas son y un buscador por el nombre de la formación.',
      },
      {
        donde: anclaje('sintutor-lista'),
        titulo: 'La lista',
        texto: 'Cada formación con sus alumnos, sus cobros, lo cobrado y el último cobro (en el móvil, desliza para ver más columnas).',
      },
      {
        donde: anclaje('sintutor-meta'),
        titulo: 'Se busca tutor',
        texto: 'Si se busca tutor para ella y con qué anuncio de Meta: activo o pausado, con su gasto y sus leads. Púlsalo para marcar que se busca y elegir el anuncio.',
      },
      {
        donde: anclaje('sintutor-asignar'),
        titulo: 'Asignar tutor',
        texto: 'Lleva a Tutores con la formación ya elegida: allí se le da un tutor con su porcentaje.',
      },
      {
        titulo: 'Y listo',
        texto: FINAL,
      },
    ],
  },
};
