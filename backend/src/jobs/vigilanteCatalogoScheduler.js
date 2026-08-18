import { statSync, existsSync } from 'fs';
import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { notifyAdmins } from '../modules/notifications/notifications.service.js';

// El vigilante de los agujeros que no dan la cara.
//
// Todo lo que revisa aqui tiene algo en comun: NO da error, no rompe ninguna
// pantalla y nadie se entera hasta que alguien va a cuadrar algo. Son los peores
// —el CRM parece que va bien— y por eso hay que preguntarles cada dia en vez de
// esperar a tropezarse con ellos.
//
// Los cuatro que ya nos han mordido:
//
//  1 · Cursos que se venden como pagina suelta y NO estan en el catalogo. El de
//      Cintia estuvo asi: la web lo vendia, el CRM no sabia que existia, y por
//      tanto ni se le podia atribuir una venta ni pagarle su comision. La
//      sincronizacion no los trae porque no son productos de WooCommerce.
//  2 · Cobros cuya venta no dice de que formacion es: dinero que no genera
//      comision para nadie.
//  3 · Cobros de Stripe sin asociar a ninguna venta: no generan factura.
//  4 · Facturas con el PDF guardado mas viejo que la propia factura: al
//      descargarla sale el documento equivocado (por ejemplo, con el sello de
//      proforma cuando ya es factura).

const TICK_MS = parseInt(process.env.VIGILANTE_TICK_MS || String(24 * 60 * 60 * 1000)); // un dia
let corriendo = false;

// ── 1 · cursos publicados que el CRM no conoce ──────────────────────────────
//
// Se leen los mapas del sitio de WordPress. Solo se miran las direcciones que
// parecen formacion —diplomado, master, curso, experto— para no comparar contra
// avisos legales ni entradas del blog.
// Una direccion es una FICHA DE CURSO, no un articulo del blog, si:
//   · cuelga de una seccion de formacion —/cursos/, /masters/, /diplomados/—, o
//   · su ultimo tramo empieza por «curso-de», «diplomado-en», «master-en»…
//
// Sin esto entraban «por-que-estudiar-un-master-en-...» y «los-mejores-cursos-
// de-derecho», que son entradas del blog. Con 382 avisos de los que 370 son
// ruido, nadie lee el que importa — y el de Cintia era justo uno de los buenos.
const SECCION_FORMACION = /\/(cursos|masters|m[aá]sters|diplomados|maestrias|maestr[ií]as|expertos|programas)\//i;
const EMPIEZA_POR_CURSO = /^(curso|diplomado|master|maestria|maestr[ií]a|experto|especializacion|especializaci[oó]n)[-_](de|en|para)?[-_]?[a-z0-9]/i;
const SOLO_SECCION = /\/(cursos|masters|m[aá]sters|diplomados|maestrias|expertos|programas)\/?$/i;

function pareceFichaDeCurso(url) {
  const limpia = String(url).replace(/\/+$/, '');
  if (SOLO_SECCION.test(limpia)) return false;          // la portada de la seccion
  const ultimo = limpia.split('/').pop() || '';
  return SECCION_FORMACION.test(limpia + '/') || EMPIEZA_POR_CURSO.test(ultimo);
}

async function cursosDeLaWeb(base) {
  const mapas = [`${base}/wp-sitemap.xml`, `${base}/sitemap_index.xml`, `${base}/sitemap.xml`];
  const urls = new Set();
  for (const mapa of mapas) {
    try {
      const r = await fetch(mapa, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((m) => m[1]);
      // Un indice de mapas apunta a otros mapas: se sigue un nivel.
      const hijos = locs.filter((u) => /\.xml$/i.test(u)).slice(0, 12);
      for (const h of hijos) {
        try {
          const rh = await fetch(h, { signal: AbortSignal.timeout(15000) });
          if (!rh.ok) continue;
          const x = await rh.text();
          for (const m of x.matchAll(/<loc>([^<]+)<\/loc>/gi)) urls.add(m[1]);
        } catch { /* ese mapa no contesta: se sigue con los demas */ }
      }
      for (const u of locs.filter((u) => !/\.xml$/i.test(u))) urls.add(u);
      if (urls.size) break;
    } catch { /* se prueba el siguiente nombre de mapa */ }
  }
  return [...urls].filter(pareceFichaDeCurso);
}

// Del texto de una direccion al nombre probable del curso, para poder comparar.
function aPalabras(url) {
  const ultimo = String(url).replace(/\/+$/, '').split('/').pop() || '';
  return ultimo
    .replace(/[-_]+/g, ' ')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

async function cursosQueFaltan() {
  const { rows: proyectos } = await query(
    `SELECT p.id, p.nombre, c.store_url
       FROM projects p JOIN wc_credentials c ON c.project_id = p.id
      WHERE c.store_url IS NOT NULL AND c.store_url <> ''`);

  const faltan = [];
  for (const proy of proyectos) {
    const base = String(proy.store_url).replace(/\/+$/, '');
    const publicados = await cursosDeLaWeb(base);
    if (!publicados.length) continue;

    const { rows: mios } = await query(
      `SELECT nombre, url_info FROM products WHERE project_id = $1`, [proy.id]);
    const nombres = new Set(mios.map((m) => aPalabras(m.nombre).replace(/\s+/g, ' ')));
    const enlaces = new Set(mios.map((m) => String(m.url_info || '').replace(/\/+$/, '')));

    for (const u of publicados) {
      if (enlaces.has(u.replace(/\/+$/, ''))) continue;
      const palabras = aPalabras(u);
      // Coincidencia por nombre: basta con que el del catalogo contenga lo que
      // dice la direccion, o al reves. Los titulos largos se acortan en la URL.
      let esta = false;
      for (const n of nombres) {
        if (n.includes(palabras) || palabras.includes(n.replace(/\s+/g, ' '))) { esta = true; break; }
      }
      if (!esta) faltan.push({ proyecto: proy.nombre, url: u });
    }
  }
  return faltan;
}

// ── 2, 3 y 4 · el dinero que se queda a medias ──────────────────────────────
async function dineroSinAtribuir() {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cobros, COALESCE(SUM(cp.importe), 0) AS importe
       FROM conversion_payments cp
       JOIN conversions cv ON cv.id = cp.conversion_id
       CROSS JOIN tutor_settings s
      WHERE cv.producto_contratado_id IS NULL
        AND cp.fecha >= GREATEST(s.aplica_desde, CURRENT_DATE - INTERVAL '60 days')`);
  return rows[0];
}

async function stripeSinAsociar() {
  // Que un cargo no este ENLAZADO no significa que falte el dinero: casi
  // siempre esta ya apuntado a mano en su venta y lo unico que no cuadra es el
  // correo o la razon social con la que pago el cliente.
  //
  // De 106 cargos sueltos, 88 estaban en ese caso. Avisar de los 106 seria dar
  // la lata con trabajo ya hecho; se avisa solo de los que NO tienen ningun
  // cobro equivalente —mismo importe y fecha a menos de tres dias—, que son los
  // que de verdad pueden ser dinero sin registrar.
  const { rows } = await query(
    `SELECT COUNT(*)::int AS cobros, COALESCE(SUM(s.amount), 0) AS importe
       FROM stripe_payments s
      WHERE s.status = 'succeeded' AND COALESCE(s.refunded, false) = false
        AND s.conversion_id IS NULL
        AND s.stripe_created_at >= CURRENT_DATE - INTERVAL '60 days'
        AND NOT EXISTS (
          SELECT 1 FROM conversion_payments cp
           WHERE ABS(cp.importe - s.amount) < 0.01
             AND cp.fecha BETWEEN s.stripe_created_at::date - 3 AND s.stripe_created_at::date + 3)`);
  return rows[0];
}

async function facturasConPdfViejo() {
  // Se compara el FICHERO en disco con la fila, no solo las marcas de tiempo de
  // la base: el PDF se escribe milisegundos antes de actualizar la fila y eso no
  // es un PDF caduco. Con un minuto de margen, de 66 «sospechosas» quedaba 1 de
  // verdad — la diferencia entre un aviso util y uno que se ignora.
  const { rows } = await query(
    `SELECT pdf_path, updated_at FROM invoices WHERE pdf_path IS NOT NULL`);
  let n = 0;
  for (const f of rows) {
    try {
      if (!existsSync(f.pdf_path)) continue;
      const disco = statSync(f.pdf_path).mtime;
      if ((new Date(f.updated_at) - disco) / 1000 > 60) n++;
    } catch { /* si no se puede mirar el fichero, no se cuenta */ }
  }
  return n;
}

export async function revisarCatalogoYDinero() {
  if (corriendo) return null;
  corriendo = true;
  try {
    const [faltan, sinFormacion, sinAsociar, pdfsViejos] = await Promise.all([
      cursosQueFaltan().catch((e) => { logger.warn({ err: e.message }, 'vigilante: la web no contesta'); return []; }),
      dineroSinAtribuir(),
      stripeSinAsociar(),
      facturasConPdfViejo(),
    ]);

    const avisos = [];
    if (faltan.length) {
      avisos.push(`${faltan.length} ${faltan.length === 1 ? 'curso publicado que no está' : 'cursos publicados que no están'} en el catálogo`);
    }
    if (sinFormacion.cobros > 0) {
      avisos.push(`${sinFormacion.cobros} cobros (${Number(sinFormacion.importe).toFixed(2)} €) de ventas sin formación identificada`);
    }
    if (sinAsociar.cobros > 0) {
      avisos.push(`${sinAsociar.cobros} cobros de Stripe (${Number(sinAsociar.importe).toFixed(2)} €) sin asociar y SIN cobro equivalente`);
    }
    if (pdfsViejos > 0) {
      avisos.push(`${pdfsViejos} facturas con el PDF anterior al último cambio`);
    }

    logger.info({
      cursosQueFaltan: faltan.length,
      cobrosSinFormacion: sinFormacion.cobros,
      stripeSinAsociar: sinAsociar.cobros,
      pdfsViejos,
    }, 'Vigilante de catálogo y dinero');

    // Solo se avisa si hay algo. Un aviso diario diciendo «todo bien» se ignora
    // a la semana, y entonces tampoco se lee el que importa.
    if (avisos.length) {
      await notifyAdmins({
        type: 'catalogo_revision',
        title: 'Revisión diaria: hay cosas sin atar',
        message: avisos.join(' · '),
        link_path: '/tutores/comisiones',
        metadata: {
          cursos_que_faltan: faltan.slice(0, 20),
          cobros_sin_formacion: sinFormacion.cobros,
          stripe_sin_asociar: sinAsociar.cobros,
          pdfs_viejos: pdfsViejos,
        },
      });
    }
    return { faltan, sinFormacion, sinAsociar, pdfsViejos };
  } catch (e) {
    logger.error({ err: e.message }, 'Vigilante de catálogo: FALLO');
    return null;
  } finally {
    corriendo = false;
  }
}

export function startVigilanteCatalogoScheduler() {
  if (process.env.VIGILANTE_DISABLED === '1') {
    logger.info('Vigilante de catálogo desactivado (VIGILANTE_DISABLED=1)');
    return;
  }
  // Cinco minutos despues de arrancar, para no cargar el arranque; y luego una
  // vez al dia. Leer los mapas del sitio es lo mas lento y no urge.
  setTimeout(revisarCatalogoYDinero, 5 * 60 * 1000);
  setInterval(revisarCatalogoYDinero, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Vigilante de catálogo iniciado');
}
