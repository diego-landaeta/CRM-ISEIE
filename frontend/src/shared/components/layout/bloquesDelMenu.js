/*
  EL MENÚ POR BLOQUES DE USO (gemela de CRM#900 y #903; #534 del 360, parte 3;
  aquí, CRM-ISEIE#367).

  Manuel, 29/10: el menú estaba ordenado según se fue construyendo y no según
  quién lo usa. La maqueta de Diego (03/11) lo reparte por uso: Hoy, Comercial,
  Captación y publicidad, Académico, Finanzas, Análisis y Configuración, con el
  Equipo de desarrollo al final. Es el mismo reparto que en MultiCRM.

  AQUÍ SOLO CAMBIA EL SITIO, NUNCA EL ACCESO. Las entradas son las mismas de
  siempre, con sus permisos y sus roles: `Sidebar.jsx` las sigue declarando en
  sus secciones de antes (`SECCIONES_DE_ANTES`) y este fichero dice adónde va
  cada una. Así:
    · quien veía una entrada la sigue viendo, y quien no, tampoco;
    · lo que un grupo o una sección imponía a lo suyo (`module`, `salvoTipo`)
      baja a cada entrada al moverla. Hoy ISEIE no usa ninguno de los dos —no
      hay módulos por campus en el menú ni proyectos IA—, pero se deja igual
      que en MultiCRM para que el día que lo use no se pierda nada al moverla;
    · la foto del menú por perfil (#423) se traslada con esta MISMA tabla, de
      modo que cualquier entrada que aparezca o desaparezca por otra cosa sigue
      saltando en la prueba.

  REUBICACIONES: [dirección de antes, dirección nueva, { despuesDe }?], con las direcciones
  como salen en el menú («Sección › Entrada» o «Sección › Grupo › Entrada»).
  Gana la primera que encaje, y una entrada encaja con su dirección o con
  cualquiera que la contenga («Catálogo» mueve todo el Catálogo). Lo que no
  encaja con ninguna se queda donde estaba (Finanzas, Análisis, Sistema...).
  `despuesDe`: la entrada va justo detrás de esa otra de su bloque nuevo; sin
  él, al final de lo que el bloque ya tenía.

  Aprobado por Diego el 18/11 en la #534 del 360 (CRM#903), junto con sacar del
  menú las tres «Próximamente» (`menu-sin-proximamente-534` en `cambios-aprobados.js`).
*/

export const BLOQUES_DEL_MENU = {
  id: 'menu-por-bloques-534',
  que: 'El menú se reparte por uso (Hoy, Comercial, Captación y publicidad, Académico, Finanzas, Análisis, Configuración) sin cambiar quién ve qué.',
  aprobadoPor: 'Diego, 18/11',
};

export const REUBICACIONES = [
  // HOY: lo de cada mañana.
  ['Principal › Dashboard', 'Hoy › Dashboard'],
  ['Principal › Prospectos › La cola del día', 'Hoy › La cola del día'],
  // Solo existe con el proceso en pruebas (`PROCESO_EN_PRUEBAS`, /staging).
  ['Principal › Prospectos › Seguimiento de fin de mes', 'Hoy › Seguimiento de fin de mes'],
  ['Principal › WhatsApp', 'Hoy › WhatsApp'],
  // COMERCIAL: los prospectos, lo que se vende y quién compró.
  ['Principal › Prospectos', 'Comercial › Prospectos'],
  ['Principal › Ventas', 'Comercial › Ventas'],
  // Estaba dos veces (Principal y Finanzas): una sola, junto a lo comercial.
  ['Finanzas › Ventas', 'Comercial › Ventas'],
  // Duplicados es de Prospectos, no de Clientes: va junto a Prospectos, fuera
  // del grupo (como en MultiCRM).
  ['Clientes › Revisión duplicados', 'Comercial › Revisión duplicados'],
  ['Clientes › Buscar duplicados', 'Comercial › Buscar duplicados'],
  ['Clientes › Diplomas', 'Académico › Diplomas'],
  ['Clientes', 'Comercial'],
  // CAPTACIÓN Y PUBLICIDAD.
  ['Captación', 'Captación y publicidad'],
  ['Publicidad', 'Captación y publicidad'],
  // ACADÉMICO: el catálogo y los tutores.
  ['Catálogo', 'Académico'],
  // Las comisiones, en Finanzas: las de los tutores junto a las del equipo.
  ['Tutores › Comisiones', 'Finanzas › Comisiones de tutores', { despuesDe: 'Comisiones' }],
  ['Tutores', 'Académico'],
  // CONFIGURACIÓN: integraciones y conexiones juntas, y lo de administrar.
  // (En ISEIE no hay «Claves y variables» ni «Correos» en Sistema.)
  ['Finanzas › Integraciones', 'Configuración › Integraciones'],
  ['Conexión', 'Configuración'],
  ['Sistema › Registro', 'Configuración › Registro'],
  ['Sistema › Status', 'Configuración › Status'],
];

/** El orden de los bloques. Los que no estén aquí van al final, en su orden. */
export const ORDEN_DE_LOS_BLOQUES = [
  'Hoy', 'Comercial', 'Captación y publicidad', 'Académico',
  'Finanzas', 'Análisis', 'Configuración', 'Sistema', 'Equipo de Desarrollo',
];

const SEP = ' › ';

/** Dónde se coloca: la regla que mueve esa dirección, o null. */
function reglaDe(direccion, reubicaciones) {
  return reubicaciones.find(([antes]) => direccion === antes || direccion.startsWith(antes + SEP)) || null;
}

/** La dirección nueva de una entrada (o la misma si no se mueve). */
export function reubicar(direccion, reubicaciones = REUBICACIONES) {
  for (const [antes, ahora] of reubicaciones) {
    if (direccion === antes) return ahora;
    if (direccion.startsWith(antes + SEP)) return ahora + direccion.slice(antes.length);
  }
  return direccion;
}

/** Una lista de direcciones del menú de antes, en el de ahora (sin repetir). */
export function aplicarReubicaciones(direcciones, reubicaciones = REUBICACIONES) {
  return [...new Set(direcciones.map((d) => reubicar(d, reubicaciones)))];
}

const union = (a, b) => {
  const out = [...new Set([...(a || []), ...(b || [])])];
  return out.length ? out : undefined;
};

/** Lo que una sección o un grupo imponía a lo suyo, puesto en la entrada. */
function heredar(item, { salvoTipo, module } = {}) {
  const out = { ...item };
  const st = union(item.salvoTipo, salvoTipo);
  if (st) out.salvoTipo = st;
  if (module && !item.module) out.module = module;
  return out;
}

/**
 * Las secciones nuevas a partir de las de antes.
 *
 * @param {Array} secciones   las de antes, con sus entradas tal cual
 * @param {Object} bloques    { [nombre]: { icon } } para las secciones nuevas
 */
export function reagruparMenu(secciones, bloques = {}, reubicaciones = REUBICACIONES) {
  const nuevas = new Map();          // nombre → { label, icon, items }
  const deAntes = new Map(secciones.map((s) => [s.label, s]));
  const seccion = (nombre) => {
    if (!nuevas.has(nombre)) {
      const vieja = deAntes.get(nombre);
      const icon = bloques[nombre]?.icon ?? vieja?.icon;
      nuevas.set(nombre, {
        label: nombre,
        ...(icon ? { icon } : {}),
        // Una sección que no cambia de nombre conserva lo suyo; en una nueva,
        // lo que impusiera cada sección de antes va ya en cada entrada.
        ...(vieja?.salvoTipo && !reubicaciones.some(([a]) => a === nombre) ? { salvoTipo: vieja.salvoTipo } : {}),
        items: [],
      });
    }
    return nuevas.get(nombre);
  };
  const pendientesDeGrupo = [];      // entradas que van DENTRO de un grupo
  const colocarDespues = [];         // entradas con sitio fijo en su bloque

  for (const s of secciones) {
    // Lo que la sección imponía solo hace falta bajarlo si la entrada se va.
    const imponeSeccion = s.salvoTipo ? { salvoTipo: s.salvoTipo } : {};
    for (const item of s.items) {
      const dir = `${s.label}${SEP}${item.label}`;
      const nueva = reubicar(dir, reubicaciones).split(SEP);
      const seVa = nueva[0] !== s.label;
      const base = seVa ? heredar(item, imponeSeccion) : item;

      if (nueva.length === 3) {          // entra en un grupo de otra sección
        pendientesDeGrupo.push({ seccion: nueva[0], grupo: nueva[1], item: { ...base, label: nueva[2] } });
        continue;
      }
      if (!item.children) {
        const destino = seccion(nueva[0]);
        // Si dos entradas de antes acaban en la misma (Ventas), una sola.
        if (!destino.items.some((x) => x.label === nueva[1])) {
          const despuesDe = reglaDe(dir, reubicaciones)?.[2]?.despuesDe;
          if (despuesDe) colocarDespues.push({ seccion: nueva[0], despuesDe, label: nueva[1] });
          destino.items.push({ ...base, label: nueva[1] });
        }
        continue;
      }
      // Un grupo: sus hijos van con él salvo los que tengan otro sitio.
      const quedan = [];
      for (const hijo of item.children) {
        const dirHijo = `${dir}${SEP}${hijo.label}`;
        const nh = reubicar(dirHijo, reubicaciones).split(SEP);
        if (nh.length === 3 && nh[0] === nueva[0] && nh[1] === nueva[1]) { quedan.push({ ...hijo, label: nh[2] }); continue; }
        // Sale del grupo: se lleva lo que le imponía el grupo y, si además
        // cambia de sección, lo que le imponía la sección.
        // Sin icono propio, el del grupo: dentro del grupo lo pintaba así (NavGroup).
        const delGrupo = heredar({ ...hijo, icon: hijo.icon || item.icon }, { salvoTipo: item.salvoTipo, module: item.module });
        const suelto = nh[0] !== s.label ? heredar(delGrupo, imponeSeccion) : delGrupo;
        if (nh.length === 3) pendientesDeGrupo.push({ seccion: nh[0], grupo: nh[1], item: { ...suelto, label: nh[2] } });
        else seccion(nh[0]).items.push({ ...suelto, label: nh[1] });
      }
      seccion(nueva[0]).items.push({ ...base, label: nueva[1], children: quedan });
    }
  }

  for (const p of pendientesDeGrupo) {
    const grupo = seccion(p.seccion).items.find((x) => x.label === p.grupo && x.children);
    if (!grupo) throw new Error(`bloquesDelMenu: no existe el grupo «${p.seccion}${SEP}${p.grupo}» para «${p.item.label}»`);
    grupo.children.push(p.item);
  }

  for (const c of colocarDespues) {
    const items = seccion(c.seccion).items;
    const i = items.findIndex((x) => x.label === c.label);
    const [entrada] = items.splice(i, 1);
    const ancla = items.findIndex((x) => x.label === c.despuesDe);
    if (ancla < 0) throw new Error(`bloquesDelMenu: «${c.seccion}${SEP}${c.despuesDe}» no existe para colocar «${c.label}»`);
    items.splice(ancla + 1, 0, entrada);
  }

  const orden = (n) => {
    const i = ORDEN_DE_LOS_BLOQUES.indexOf(n);
    return i < 0 ? ORDEN_DE_LOS_BLOQUES.length : i;
  };
  return [...nuevas.values()]
    .filter((s) => s.items.length > 0)
    .sort((a, b) => orden(a.label) - orden(b.label));
}
