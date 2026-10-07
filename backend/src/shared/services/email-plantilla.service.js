/**
 * La envoltura comun de los correos del CRM. Tarea #83.
 *
 * Antes cada scheduler armaba su propio HTML con plantillas de cadena: tres
 * ficheros, tres estilos, y con la #82 iban a ser cuatro. Aqui esta la
 * envoltura y las piezas que se repiten; cada aviso solo aporta su contenido.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Esto NO es el CRM, es Outlook y Gmail. Las reglas son otras:
 *
 *   · Maquetacion con <table>. Outlook usa el motor de Word y no entiende ni
 *     flex ni grid; lo que aqui parece anticuado es lo unico que llega bien.
 *   · CSS en el atributo `style` de cada etiqueta, SIEMPRE. Esa es la base y
 *     tiene que bastar por si sola. Hay ademas una hoja en la cabecera, pero
 *     solo con lo que `style=` no puede hacer —el movil y el modo oscuro—: si
 *     un cliente se la come, el correo se sigue viendo bien.
 *   · Nada de JavaScript ni <svg>. Los graficos son celdas de tabla con color.
 *   · Que se lea sin imagenes: muchos clientes las bloquean por defecto, asi
 *     que toda imagen lleva `alt` y ninguna es imprescindible para entender el
 *     correo. El nombre del proyecto va escrito al lado del logo, no dentro.
 *   · Modo oscuro: ver `CABECERA_HTML` mas abajo, que es donde se explica.
 *   · Version en texto plano ademas del HTML. Sin ella mas filtros lo marcan
 *     como basura.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Y una regla que no es de diseño: TODO texto que salga a un correo va con sus
 * tildes. En los comentarios del codigo no las ponemos por convenio, pero un
 * correo lo lee una persona, y uno sin tildes parece automatico y mal hecho.
 */

/**
 * Los colores del CRM, no unos parecidos.
 *
 * Salen de `frontend/src/index.css`, resueltos de HSL a hexadecimal porque en
 * un correo no hay variables CSS. Si alguien cambia un token alli, hay que
 * traerlo aqui a mano: no hay forma de compartirlos.
 *
 * El ticket #83 pedia «neutros slate, acento cyan» citando el rediseño #78.
 * **El CRM de hoy no es eso**: los neutros son `zinc` y el acento es un azul
 * indigo. Se usa lo que hay en el codigo, que es lo que la gestora ve cada dia;
 * el correo tiene que parecerse al CRM que existe, no al que existira.
 */
const C = {
  fondo: '#fafafa',       // --background        0 0% 98%
  hoja: '#ffffff',        // --card              0 0% 100%
  borde: '#e4e4e7',       // --border            240 6% 90%
  suaveFondo: '#f4f4f5',  // --secondary/--muted 240 5% 96%
  suaveTexto: '#18181b',  // --secondary-fg      240 6% 10%
  texto: '#09090b',       // --foreground        240 10% 3.9%
  tenue: '#71717a',       // --muted-foreground  240 4% 46%
  primario: '#002776',    // azul de ISEIE (en MultiCRM, el indigo #3653e2)
  sobrePrimario: '#ffffff',
  // Los tintes del primario, que son LA seña del CRM: el menu pinta lo activo
  // con `bg-primary/10 text-primary`, las pildoras igual, y lo seleccionado
  // lleva una barra de 4px del primario a la izquierda. Sin esto el correo son
  // cajas blancas con borde gris — correcto y anonimo, que es justo lo que
  // pasaba. En un correo no hay opacidad fiable, asi que van ya mezclados
  // sobre blanco.
  tinte: '#e6e9f1',       // primary / 10 %
  tinteSuave: '#f2f4f8',  // primary /  5 %
  tinteBorde: '#ccd4e4',  // primary / 20 %
  // El primario aclarado sobre el tinte, para lo secundario de la cabecera.
  // Es un color de verdad y no un `opacity`, que Outlook ignora.
  primarioClaro: '#5470a6',
  destructivo: '#ef4444', // --destructive       0 84% 60%
  sube: '#16a34a',
  baja: '#ef4444',
};

// Los radios de `tailwind.config.js`, con --radius = 0.5rem.
const R = { sm: '4px', md: '6px', lg: '8px', xl: '10px', xl2: '12px' };

// `index.css` carga Inter y la aplica en `body`; `tailwind.config` declara Plus
// Jakarta Sans para `font-sans`. Van las dos, y detras la pila del sistema:
// ningun cliente de correo va a descargar una fuente web.
const FUENTE = "'Inter','Plus Jakarta Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/**
 * La paleta de estado de los prospectos, de `DESIGN_SYSTEM.md` §1.2.
 *
 * El documento es explicito: «no inventar nuevos status colors, ampliar el
 * mapping si hace falta». Estos son los mismos de `StatusBadge.jsx`, resueltos
 * a hexadecimal — la variante clara, que es la que corresponde al fondo del
 * correo; la oscura la pone la hoja de la cabecera.
 */
const ESTADO = {
  nuevo:                { fondo: '#eff6ff', texto: '#2563eb', nombre: 'Nuevo' },
  por_contactar:        { fondo: '#fff7ed', texto: '#ea580c', nombre: 'Por contactar' },
  contactado:           { fondo: '#ecfdf5', texto: '#059669', nombre: 'Contactado' },
  en_seguimiento:       { fondo: '#fffbeb', texto: '#d97706', nombre: 'En seguimiento' },
  convertido:           { fondo: '#f5f3ff', texto: '#7c3aed', nombre: 'Convertido' },
  no_interesado:        { fondo: '#fef2f2', texto: '#dc2626', nombre: 'No interesado' },
  proxima_convocatoria: { fondo: '#ecfeff', texto: '#0e7490', nombre: 'Próxima convocatoria' },
};

/**
 * La paleta de tono de `DESIGN_SYSTEM.md` §1.3, patron
 * `{color}-50 / text-{color}-700`.
 *
 * Sirve para que la urgencia se VEA. Un prospecto que lleva 26 horas y otro que
 * lleva 50 minutos salian con la misma pildora gris, y son cosas distintas: el
 * primero probablemente ya ha llamado a otro sitio.
 */
const TONO = {
  neutro:  { fondo: '#f4f4f5', texto: '#18181b' },
  exito:   { fondo: '#ecfdf5', texto: '#047857' }, // emerald
  aviso:   { fondo: '#fffbeb', texto: '#b45309' }, // amber
  urgente: { fondo: '#fef2f2', texto: '#b91c1c' }, // red
};

/** La paleta de canal de `DESIGN_SYSTEM.md` §1.4, tal cual. */
export const COLORES_CANAL = ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#ef4444', '#94a3b8'];

/**
 * El logo del proyecto.
 *
 * Los logos son ficheros publicos servidos por el propio CRM
 * (`frontend/public/projects/`), asi que valen tal cual en un correo: no hay
 * que alojarlos en ningun otro sitio ni incrustarlos en base64.
 *
 * Es el mismo mapa que `frontend/src/shared/lib/projectLogos.js`. Se copia
 * porque el backend no puede importar del frontal; si alli se añade un
 * proyecto, hay que añadirlo aqui.
 */
const LOGOS = {
  // En ISEIE los logos estan en la raiz del frontal, no en /projects.
  'iseie': 'iseie-icon-192.png',
};

export function logoDeProyecto(slug) {
  const f = slug ? LOGOS[slug] : null;
  return f ? `${base()}/${f}` : null;
}

/** La raiz del CRM, para que los enlaces lleven a alguna parte de verdad. */
export const base = () =>
  String(process.env.CRM_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');

/** Un enlace absoluto a una pantalla del CRM. */
export const enlace = (ruta = '') => `${base()}/${String(ruta).replace(/^\/+/, '')}`;

/**
 * Escapa lo que venga de la base de datos.
 *
 * Hace falta de verdad: hoy los schedulers interpolan `lead.nombre` en crudo, y
 * un prospecto llamado «Muñoz & Cia <SL>» rompe el HTML del correo. Con los
 * nombres que llegan de un formulario publico, esto no es una hipotesis.
 */
export function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Las piezas ──────────────────────────────────────────────────────────────

/**
 * El boton principal. «Abrir la ficha», «Ver mi panel».
 *
 * Va en una tabla y no en un <a> con padding porque Outlook ignora el relleno
 * de los enlaces y deja el boton del tamaño exacto del texto, sin margen.
 */
export function boton({ texto, url, tono = 'primario' }) {
  const neutro = tono === 'neutro';
  // Mismos valores que la primitiva `Button` del CRM en su variante por
  // defecto: `rounded-md` (6px), `text-sm` (14px), `font-medium` (500) y
  // `h-10 px-4`, que con esta fuente sale con 11px de relleno vertical.
  const fondo = neutro ? C.suaveFondo : C.primario;
  const color = neutro ? C.suaveTexto : C.sobrePrimario;
  return `
  <table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0 4px">
    <tr>
      <td style="background-color:${fondo};border-radius:${R.md}">
        <a href="${esc(url)}"
           style="display:inline-block;padding:11px 16px;font-family:${FUENTE};
                  font-size:14px;font-weight:500;line-height:18px;
                  color:${color};text-decoration:none">${esc(texto)}</a>
      </td>
    </tr>
  </table>`;
}

/**
 * El `StatusBadge` del CRM: la pildora del estado del prospecto, con su color.
 *
 * Faltaba, y era lo mas util que se podia enseñar de un vistazo: en una lista
 * de catorce, «Nuevo» en azul y «Por contactar» en naranja separan los que
 * acaban de entrar de los que llevan esperando desde antes.
 */
export function etiquetaEstado(estado) {
  const e = ESTADO[estado];
  if (!e) return '';
  return `<span class="chapa-estado" style="display:inline-block;background-color:${e.fondo};
                 color:${e.texto};border-radius:9999px;padding:3px 10px;font-family:${FUENTE};
                 font-size:12px;font-weight:600;line-height:16px">${esc(e.nombre)}</span>`;
}

/**
 * La primitiva `Badge`: `rounded-full`, `text-xs`, `font-semibold`, `px-2.5 py-0.5`.
 *
 * `tono` acepta ademas los de §1.3 —exito, aviso, urgente— para cuando la
 * pildora tiene que decir algo y no solo etiquetar.
 */
export function etiqueta(texto, tono = 'secundario') {
  if (TONO[tono]) {
    const t = TONO[tono];
    return `<span class="chapa-tono" style="display:inline-block;background-color:${t.fondo};
                   color:${t.texto};border-radius:9999px;padding:3px 10px;font-family:${FUENTE};
                   font-size:12px;font-weight:600;line-height:16px;white-space:nowrap">${esc(texto)}</span>`;
  }
  // La secundaria va con el tinte y el texto en indigo, igual que las pildoras
  // del menu (`bg-primary/10 text-primary`). En gris parecia de otro producto.
  const fondo = tono === 'primario' ? C.primario : C.tinte;
  const color = tono === 'primario' ? C.sobrePrimario : C.primario;
  return `<span class="chapa" style="display:inline-block;background-color:${fondo};color:${color};
                 border-radius:9999px;padding:3px 10px;font-family:${FUENTE};
                 font-size:12px;font-weight:600;line-height:16px;white-space:nowrap">${esc(texto)}</span>`;
}

/**
 * El texto que Gmail enseña en la lista de la bandeja, detras del asunto.
 *
 * Sin esto, ahi sale lo primero del correo — «Hola Ana,» — que no informa de
 * nada y desperdicia la unica linea que se lee ANTES de abrirlo. Con esto, la
 * bandeja ya dice «4 esperando · el primero lleva 26 h».
 *
 * Va oculto con las cuatro propiedades a la vez porque cada cliente respeta una
 * distinta, y con caracteres invisibles detras para que no arrastre el texto
 * que viene despues.
 */
function preCabecera(texto) {
  if (!texto) return '';
  return `<div class="precabecera" style="display:none;font-size:1px;color:${C.hoja};line-height:1px;
               max-height:0;max-width:0;opacity:0;overflow:hidden">${esc(texto)}
    ${'&#847;&zwnj;&nbsp;'.repeat(30)}</div>`;
}

/**
 * La ficha de un prospecto: nombre, programa, telefono y cuanto lleva
 * esperando, con su boton.
 *
 * Es la pieza mas importante de las cuatro. La #81 pide listas de catorce de
 * estas, asi que tiene que quedar legible repetida y no solo suelta.
 */
export function fichaProspecto({
  nombre, programa, telefono, correo, origen, esperando, estado, url,
  acciones = [], orden = null, urgencia = 'neutro',
}) {
  // El telefono y el correo van como `tel:` y `mailto:`, que es lo que
  // convierte este bloque en algo que se usa: la gestora abre el aviso en el
  // movil y llama desde ahi, sin copiar el numero a mano.
  // La etiqueta va en mayusculas, negrita y pequeña, que es como el sistema
  // de diseño define un label (§2: `text-xs font-bold uppercase
  // text-muted-foreground`). Antes iba en minusculas y del mismo tamaño que el
  // valor, y por eso la ficha se leia como un volcado de datos.
  const dato = (etq, valor, href) => `
    <tr>
      <td class="tenue" style="font-family:${FUENTE};font-size:11px;font-weight:700;
                 letter-spacing:.5px;text-transform:uppercase;line-height:20px;color:${C.tenue};
                 padding:3px 14px 3px 0;white-space:nowrap;vertical-align:top">${etq}</td>
      <td style="font-family:${FUENTE};font-size:14px;line-height:20px;padding:3px 0">
        ${href
          ? `<a class="enlace" href="${href}" style="color:${C.primario};text-decoration:none;font-weight:500">${esc(valor)}</a>`
          : `<span class="txt" style="color:${C.texto}">${esc(valor)}</span>`}
      </td>
    </tr>`;

  const filas = [
    programa ? dato('Programa', programa) : '',
    telefono ? dato('Teléfono', telefono, `tel:${String(telefono).replace(/[^+\d]/g, '')}`) : '',
    correo ? dato('Correo', correo, `mailto:${esc(correo)}`) : '',
    // De donde vino. La #81 lo pide para poder decidir a quien llamar primero:
    // un prospecto de campaña de pago no espera lo mismo que uno de organico.
    origen ? dato('Vino de', origen) : '',
  ].filter(Boolean).join('');

  // Los atajos como pildoras y no como enlaces sueltos: en un movil un enlace
  // de 13px es un blanco de 13px, y estos son justo los que se pulsan. Con
  // borde y relleno se convierten en algo que se puede dar con el pulgar.
  const atajos = (acciones || []).filter((a) => a && a.url).map((a) => `
    <a class="atajo" href="${esc(a.url)}"
       style="display:inline-block;margin:0 6px 6px 0;padding:7px 12px;
              border:1px solid ${C.tinteBorde};border-radius:${R.md};
              background-color:${C.tinteSuave};font-family:${FUENTE};
              font-size:13px;font-weight:600;line-height:16px;color:${C.primario};
              text-decoration:none">${esc(a.texto)}</a>`).join('');

  // La misma tarjeta que `.crm-card`: fondo de tarjeta, borde de 1px y
  // `rounded-lg`. Repetida catorce veces en la #81 tiene que seguir leyendose
  // como una lista, asi que el relleno es el mismo que el de una fila del CRM.
  return `
  <table class="tarjeta" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background-color:${C.hoja};border:1px solid ${C.borde};
                border-radius:${R.lg};margin:0 0 10px">
    <tr>
      <!-- La barra de acento del CRM: en el menu marca lo activo, y aqui hace
           que una lista de catorce fichas se lea como una lista del CRM y no
           como catorce recuadros. Es una celda y no un borde lateral porque
           Outlook redondea mal los bordes de una sola cara. -->
      <td width="4" class="barra"
          style="width:4px;background-color:${C.primario};
                 border-radius:${R.lg} 0 0 ${R.lg};font-size:0;line-height:0">&nbsp;</td>
      <td style="padding:16px 18px">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            ${orden ? `
            <!-- El numero de orden. La lista va ordenada por lo que llevan
                 esperando, pero sin numerar eso no se ve: parecen cuatro fichas
                 sueltas en vez de «a quien llamas primero, segundo y tercero». -->
            <td width="26" style="width:26px;vertical-align:top;padding:2px 10px 0 0">
              <span style="display:inline-block;width:22px;height:22px;
                     background-color:${C.tinte};border-radius:9999px;
                     font-family:${FUENTE};font-size:12px;font-weight:700;
                     line-height:22px;text-align:center;color:${C.primario}">${orden}</span>
            </td>` : ''}
            <td class="txt" style="font-family:${FUENTE};font-size:16px;font-weight:600;
                       line-height:24px;color:${C.texto};padding:0 8px 0 0">${esc(nombre)}</td>
            ${esperando
              ? `<td align="right" style="white-space:nowrap;vertical-align:top">${etiqueta(esperando, urgencia)}</td>`
              : ''}
          </tr>
        </table>
        ${estado ? `<div style="margin:7px 0 0">${etiquetaEstado(estado)}</div>` : ''}
        ${filas ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 0">${filas}</table>` : ''}
        ${atajos ? `<div style="margin:11px 0 0">${atajos}</div>` : ''}
        ${url && !atajos.length ? `
        <a class="enlace" href="${esc(url)}"
           style="display:inline-block;margin:10px 0 0;font-family:${FUENTE};
                  font-size:13px;font-weight:500;color:${C.primario};
                  text-decoration:none">Abrir la ficha →</a>` : ''}
      </td>
    </tr>
  </table>`;
}

/**
 * La flecha y el porcentaje respecto al periodo anterior.
 *
 * Vive aqui y no en un scheduler porque lo usan dos —el reporte semanal y el
 * resumen del dia— y produce justo lo que consume `tarjetaCifra`.
 */
export function comparar(ahora, antes) {
  const a = Number(ahora) || 0;
  const b = Number(antes) || 0;
  // Sin nada con que comparar no se inventa un porcentaje: de 0 a 5 no es
  // «+500 %», es «antes no habia nada».
  if (b === 0) return { texto: a === 0 ? '=' : 'nuevo', signo: a > 0 ? 'sube' : 'igual' };
  const pct = Math.round(((a - b) / b) * 100);
  if (pct === 0) return { texto: 'igual', signo: 'igual' };
  return { texto: `${pct > 0 ? '+' : ''}${pct} %`, signo: pct > 0 ? 'sube' : 'baja' };
}

/**
 * Una cifra con su comparacion. `comparacion` es `{ texto, signo }`, tal como
 * lo devuelve `comparar()`.
 */
export function tarjetaCifra({ etiqueta, valor, comparacion }) {
  const s = comparacion?.signo;
  const color = s === 'sube' ? C.sube : s === 'baja' ? C.baja : C.tenue;
  // Flecha en texto y no en imagen: se ve igual con las imagenes bloqueadas.
  const flecha = s === 'sube' ? '▲' : s === 'baja' ? '▼' : '·';
  return `
  <td class="col" width="50%" style="padding:4px">
    <table class="tarjeta" cellpadding="0" cellspacing="0" border="0" width="100%"
           style="background-color:${C.tinteSuave};border:1px solid ${C.tinteBorde};border-radius:${R.lg}">
      <tr>
        <td style="padding:14px 16px">
          <!-- Label en mayusculas y KPI con cifras tabulares, como manda el
               sistema de diseño (§2: «KPIs grandes: text-2xl font-semibold
               tabular-nums»). Sin ellas, dos tarjetas al lado no alinean los
               digitos y la rejilla baila. -->
          <div class="tenue" style="font-family:${FUENTE};font-size:11px;font-weight:700;
                      letter-spacing:.5px;text-transform:uppercase;line-height:16px;color:${C.tenue}">${esc(etiqueta)}</div>
          <div class="txt" style="font-family:${FUENTE};font-size:24px;font-weight:600;color:${C.texto};
                      line-height:32px;padding:3px 0 0;font-variant-numeric:tabular-nums">${esc(valor)}</div>
          ${comparacion ? `
          <div style="font-family:${FUENTE};font-size:12px;font-weight:500;line-height:16px;color:${color}">
            ${flecha} ${esc(comparacion.texto)}
          </div>` : ''}
        </td>
      </tr>
    </table>
  </td>`;
}

/** Las cifras en rejilla de dos columnas, que es lo que cabe en un movil. */
export function tarjetas(lista = []) {
  const celdas = lista.map(tarjetaCifra);
  const filas = [];
  for (let i = 0; i < celdas.length; i += 2) {
    // La celda vacia mantiene la rejilla cuando el numero de tarjetas es impar.
    // En movil se esconde: alli van apiladas y no hay hueco que rellenar.
    filas.push(`<tr class="fila">${celdas[i]}${celdas[i + 1] || '<td class="col vacia" width="50%"></td>'}</tr>`);
  }
  return `
  <table class="rejilla" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="border-collapse:separate;margin:4px 0 14px">${filas.join('')}</table>`;
}

/**
 * Una barra de progreso hecha con dos celdas de color.
 *
 * Es como se hacen los graficos en un correo: sin <svg>, sin imagen que haya
 * que alojar en algun sitio, y con el porcentaje escrito al lado para que se
 * entienda igual si el cliente no pinta los fondos.
 */
export function barraProgreso({ etiqueta, valor, total, tono = 'acento' }) {
  const v = Number(valor) || 0;
  const t = Number(total) || 0;
  const pct = t > 0 ? Math.max(0, Math.min(100, Math.round((v / t) * 100))) : 0;
  const color = tono === 'aviso' ? C.destructivo : C.primario;
  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 10px">
    <tr>
      <td class="tenue" style="font-family:${FUENTE};font-size:13px;line-height:20px;color:${C.tenue};padding:0 0 5px">
        ${esc(etiqueta)} — <strong style="color:${C.texto}">${v}</strong> de ${t} (${pct} %)
      </td>
    </tr>
    <tr>
      <td>
        <table cellpadding="0" cellspacing="0" border="0" width="100%"
               style="border-collapse:collapse;border-radius:5px">
          <tr>
            ${pct > 0 ? `<td width="${pct}%" height="8"
                 style="background-color:${color};border-radius:5px 0 0 5px;font-size:0;line-height:0">&nbsp;</td>` : ''}
            ${pct < 100 ? `<td width="${100 - pct}%" height="8"
                 style="background-color:${C.borde};border-radius:${pct > 0 ? '0 5px 5px 0' : '5px'};font-size:0;line-height:0">&nbsp;</td>` : ''}
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

/**
 * Un grafico de barras horizontales. La #81 pide dos: la entrada de prospectos
 * de los ultimos 7 dias y el reparto por canal.
 *
 * Se dibuja con celdas de tabla de colores, que es como se hacen los graficos
 * en un correo: sin JavaScript, sin <svg> y sin una imagen que haya que alojar
 * en algun sitio y que la mitad de los clientes bloquean.
 *
 * Cada barra lleva su cifra ESCRITA al lado. Si el cliente no pinta fondos
 * —pasa— el grafico se degrada a una lista de numeros, que sigue informando.
 *
 * @param {Array<{etiqueta:string, valor:number}>} lista
 */
export function barras(lista = [], { paleta = null } = {}) {
  const datos = (lista || []).filter((d) => d && d.etiqueta != null);
  if (!datos.length) return '';
  const tope = Math.max(...datos.map((d) => Number(d.valor) || 0), 1);

  const filas = datos.map((d, i) => {
    const v = Number(d.valor) || 0;
    const pct = Math.round((v / tope) * 100);
    // Con paleta, cada barra lleva su color —es lo que hace el CRM en las
    // graficas de canal— y sin ella todas van del primario, que es lo correcto
    // cuando la serie es una sola cosa medida en el tiempo.
    const color = paleta ? paleta[i % paleta.length] : C.primario;
    return `
    <tr>
      <td class="tenue" width="34%"
          style="font-family:${FUENTE};font-size:13px;line-height:18px;color:${C.tenue};
                 padding:3px 10px 3px 0;vertical-align:middle">${esc(d.etiqueta)}</td>
      <td width="52%" style="padding:3px 10px 3px 0;vertical-align:middle">
        <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse">
          <tr>
            ${pct > 0 ? `<td width="${pct}%" height="10"${paleta ? '' : ' class="barra"'}
                 style="background-color:${color};border-radius:3px;
                        font-size:0;line-height:0">&nbsp;</td>` : ''}
            ${pct < 100 ? `<td width="${100 - pct}%" height="10"
                 style="font-size:0;line-height:0">&nbsp;</td>` : ''}
          </tr>
        </table>
      </td>
      <td class="txt" width="14%" align="right"
          style="font-family:${FUENTE};font-size:13px;font-weight:600;line-height:18px;
                 color:${C.texto};padding:3px 0;vertical-align:middle">${v}</td>
    </tr>`;
  }).join('');

  return `
  <table cellpadding="0" cellspacing="0" border="0" width="100%"
         style="border-collapse:collapse;margin:0 0 14px">${filas}</table>`;
}

/** Un parrafo normal. Existe para no repetir la fuente en cada aviso. */
export const parrafo = (html) =>
  `<p class="txt" style="font-family:${FUENTE};font-size:14px;line-height:22px;color:${C.texto};margin:0 0 16px">${html}</p>`;

/**
 * Un titulo de seccion, con su filete.
 *
 * El filete no es adorno: en un correo largo —el resumen lleva cifras, lista y
 * dos graficas— sin una linea que separe, todo parece el mismo bloque y se lee
 * como un muro. Va en una tabla porque un `border-bottom` sobre un <h2> se lo
 * come Outlook.
 */
export const seccion = (texto) => `
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:26px 0 12px">
    <tr>
      <td class="txt" style="font-family:${FUENTE};font-size:11px;font-weight:700;
                 letter-spacing:.6px;text-transform:uppercase;line-height:16px;
                 color:${C.texto};padding:0 10px 0 0;white-space:nowrap">${esc(texto)}</td>
      <td class="linea" style="border-bottom:1px solid ${C.borde};font-size:0;line-height:0">&nbsp;</td>
    </tr>
  </table>`;

/**
 * Una nota destacada. Para lo unico sobre lo que hay que hacer algo.
 *
 * El ticket la pedia en ambar, pero **el CRM no tiene ambar**: sus tokens son
 * los neutros `zinc`, el primario y `destructive`. Se usa el fondo apagado con
 * una barra del primario, que es como el CRM destaca sin alarmar; el rojo aqui
 * diria «algo se ha roto», y esto es «tienes trabajo».
 */
export const nota = (html) => `
  <table class="nota" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background-color:${C.tinteSuave};border-radius:${R.md};margin:0 0 14px">
    <tr>
      <td width="4" class="barra"
          style="width:4px;background-color:${C.primario};
                 border-radius:${R.md} 0 0 ${R.md};font-size:0;line-height:0">&nbsp;</td>
      <td class="txt" style="padding:14px 16px;font-family:${FUENTE};font-size:14px;
                 line-height:22px;color:${C.suaveTexto}">${html}</td>
    </tr>
  </table>`;

// ─── La envoltura ────────────────────────────────────────────────────────────

/** La marca del proyecto: logo si lo hay, y su nombre SIEMPRE escrito al lado. */
function marca(proyecto = {}) {
  const nombre = proyecto.nombre || 'CRM';
  // El de la base primero; si no lo hay, el fichero que el propio CRM sirve
  // para ese proyecto. Son publicos, asi que valen en un correo tal cual.
  const logo = proyecto.logo_url || logoDeProyecto(proyecto.slug);
  if (logo) {
    return `
      <img src="${esc(logo)}" alt="${esc(nombre)}" width="30" height="30"
           style="display:inline-block;vertical-align:middle;border:0;
                  border-radius:${R.md};margin-right:12px">
      <span style="vertical-align:middle">${esc(nombre)}</span>`;
  }
  // Sin logo, el emoji del proyecto. Y si tampoco lo hay, solo el nombre: no se
  // inventa un cuadrado de color que con las imagenes bloqueadas no diria nada.
  // El espacio va DENTRO del span y no solo en el margen: el margen no existe
  // en la version de texto plano, y sin el quedaba «🎓ISEIH» todo junto.
  return `${proyecto.emoji ? `<span style="margin-right:10px">${esc(proyecto.emoji)} </span>` : ''}${esc(nombre)}`;
}

/**
 * El <head> del correo.
 *
 * Las dos etiquetas de `color-scheme` no son adorno: sin ellas, Apple Mail e
 * iOS invierten los colores por su cuenta y dejan texto oscuro sobre fondo
 * oscuro. Declarando que este correo es claro, dejan de hacerlo.
 *
 * Gmail en Android no respeta esa declaracion y fuerza el suyo. Contra eso solo
 * vale lo que ya hace el resto del fichero: fondo explicito en CADA celda y
 * color explicito en CADA texto, para que ninguna combinacion acabe siendo un
 * color sobre si mismo. Por eso tampoco se usa blanco puro en el marco.
 *
 * El `charset` es lo que hace que las tildes lleguen como tildes.
 */
const CABECERA_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<style>
  /* Todo lo de aqui es un AÑADIDO. Los estilos en linea siguen siendo la base,
     asi que si un cliente se come esta hoja, el correo se ve igual que antes en
     claro y de escritorio. Aqui solo estan las dos cosas que no se pueden
     resolver con un atributo style: el movil y el modo oscuro. */

  /* En un movil, dos tarjetas de cifra en la misma fila dejan 130 px por
     columna y «Prospectos nuevos» parte en dos lineas. A pantalla estrecha van
     una debajo de otra, y de paso desaparece el hueco que dejaba la tercera. */
  @media only screen and (max-width:600px) {
    /* Para apilar celdas en un correo no basta con la celda: la fila sigue
       siendo una fila de tabla y envuelve cada celda suelta en otra anonima,
       que se encoge a su contenido. Resultado: las tarjetas bajaban en
       escalera, cada una de un ancho. Hay que romper los tres niveles. */
    .rejilla, .fila, .col { display:block !important; width:100% !important; }
    .col { max-width:100% !important; padding:0 0 8px !important; }
    /* Y la tabla de dentro, que es la que pinta la tarjeta. */
    .col .tarjeta { width:100% !important; }
    .vacia { display:none !important; }
  }

  /* Gmail en Android invierte los colores haga lo que haga el remitente. Si no
     se le dan colores para oscuro, se los inventa: por eso el boton salia
     lavanda descolorido y las tarjetas sin borde. Dandoselos, el correo se ve
     COMO SE DECIDIO y no como le parezca al cliente. */
  @media (prefers-color-scheme: dark) {
    .fondo   { background-color:#18181b !important; }
    .hoja    { background-color:#09090b !important; border-color:#27272a !important; }
    .tarjeta { background-color:#1c1c26 !important; border-color:#2e2e46 !important; }
    .linea   { border-color:#27272a !important; }
    .txt     { color:#fafafa !important; }
    .tenue   { color:#a1a1aa !important; }
    /* El tinte de la cabecera y las pildoras, rehecho para fondo oscuro: el
       mismo indigo mezclado con negro en vez de con blanco. */
    .cab     { background-color:#0d1a33 !important; color:#8fa8d8 !important; }
    .chapa   { background-color:#0d1a33 !important; color:#8fa8d8 !important; }
    .barra   { background-color:#2f5bb3 !important; }
    /* El boton se queda con su indigo y su texto blanco: contrasta igual de
       bien sobre oscuro, y es lo unico de marca que tiene el correo. */
    .enlace  { color:#8fa8d8 !important; }
    .nota    { background-color:#1c1c26 !important; }
  }
</style>
</head>`;

/**
 * Arma el correo entero.
 *
 * @param {object}   opts
 * @param {object}   opts.proyecto  `{ nombre, logo_url, emoji }`
 * @param {string}   opts.titulo    el titular, dentro del correo
 * @param {string}   [opts.saludo]  «Hola Ana,»
 * @param {string[]} opts.bloques   HTML de las piezas de arriba
 * @param {object}   [opts.apagar]  `{ texto }` — el pie con el enlace para apagarlo
 * @returns {{ htmlContent: string, textContent: string }}
 */
export function correo({ proyecto = {}, titulo, saludo, bloques = [], apagar = null, resumen = null }) {
  const cuerpo = bloques.filter(Boolean).join('\n');
  const urlPreferencias = enlace('preferencias');
  // La fecha de hoy, escrita como la escribiria una persona. Va en la cabecera
  // porque un correo automatico sin fecha visible obliga a mirar la del buzon
  // para saber si es el de hoy o uno de la semana pasada.
  const fecha = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });

  const html = `${CABECERA_HTML}
<body class="fondo" style="margin:0;padding:0;background-color:${C.fondo}">
  ${preCabecera(resumen)}
  <table class="fondo" cellpadding="0" cellspacing="0" border="0" width="100%"
         style="background-color:${C.fondo};padding:32px 12px">
    <tr>
      <td align="center">
        <!-- 600 px: el ancho que cabe en el panel de lectura de Outlook. -->
        <table class="hoja" cellpadding="0" cellspacing="0" border="0" width="600"
               style="width:600px;max-width:100%;background-color:${C.hoja};
                      border:1px solid ${C.borde};border-radius:${R.xl2}">
          <tr>
            <!-- La cabecera con el tinte del primario y el nombre en indigo:
                 es lo que hace que al abrirlo se sepa de que producto es antes
                 de leer nada. En blanco sobre blanco no se sabia. -->
            <td class="cab" style="padding:20px 28px;background-color:${C.tinte};
                       border-radius:${R.xl2} ${R.xl2} 0 0">
              <table cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td style="font-family:${FUENTE};font-size:16px;font-weight:700;
                             line-height:30px;color:${C.primario};vertical-align:middle">${marca(proyecto)}</td>
                  <!-- La fecha, separada de verdad. Antes iban pegadas y con
                       una transparencia, que Outlook ignora: alli salia del
                       mismo color que el nombre y parecian una sola cosa
                       partida. Este tono claro es un color, no opacidad. -->
                  <td align="right" style="font-family:${FUENTE};font-size:12px;
                             font-weight:600;line-height:30px;color:${C.primarioClaro};
                             padding-left:24px;white-space:nowrap;vertical-align:middle">${esc(fecha)}</td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px">
              ${titulo ? `<h1 class="txt" style="font-family:${FUENTE};font-size:21px;font-weight:600;
                                     line-height:30px;color:${C.texto};margin:0 0 18px">${esc(titulo)}</h1>` : ''}
              ${saludo ? parrafo(`Hola ${esc(saludo)},`) : ''}
              ${cuerpo}
            </td>
          </tr>
          <tr>
            <td class="linea tenue" style="padding:18px 28px 22px;border-top:1px solid ${C.borde};
                       font-family:${FUENTE};font-size:12px;line-height:20px;color:${C.tenue}">
              Te lo manda el <strong class="txt" style="color:${C.texto}">CRM${proyecto.nombre ? ` de ${esc(proyecto.nombre)}` : ''}</strong>.
              ${apagar ? `<br>${esc(apagar.texto || 'Recibes este aviso porque lo tienes activado.')}
                 <a class="enlace" href="${esc(urlPreferencias)}" style="color:${C.primario};text-decoration:none">
                   Puedes apagarlo en Mis preferencias</a>.` : ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { htmlContent: html, textContent: aTextoPlano(html) };
}

/**
 * La version en texto plano, sacada del propio HTML.
 *
 * Se deriva en vez de pedirsela al que llama a proposito: mantener dos textos a
 * mano termina siempre igual, con uno de los dos desactualizado y nadie
 * mirandolo, porque el de texto plano no lo ve casi nadie.
 *
 * Los enlaces se conservan como «texto (url)»: sin eso, la version plana de un
 * correo cuyo contenido es un boton se queda sin el enlace, que es justo lo
 * unico que importaba.
 */
export function aTextoPlano(html) {
  return String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    // La pre-cabecera fuera: es para la bandeja, no para el cuerpo. Y su
    // relleno de caracteres invisibles se colaba tal cual —«&#847;&zwnj;»
    // treinta veces— encabezando la version en texto de todos los correos.
    .replace(/<div class="precabecera"[\s\S]*?<\/div>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
      (_, url, txt) => `${txt.replace(/<[^>]+>/g, '').trim()} (${url})`)
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, '$1')
    .replace(/<\/(p|h1|h2|h3|div|tr|table)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
    .trim();
}

/**
 * Los tokens sueltos, para el correo que necesite una pieza propia.
 *
 * Lo usa el reporte semanal para su tabla por gestora, que es la unica pieza
 * que no se repite en ningun otro aviso. Existe para que ese caso siga usando
 * los colores del CRM en vez de inventarse unos grises parecidos, que es
 * exactamente lo que hacia antes (`#e5e7eb`, `#6b7280`, `#111`).
 */
export const T = { ...C, fuente: FUENTE, radio: R };

export const _internos = { C, FUENTE, marca, CABECERA_HTML };
