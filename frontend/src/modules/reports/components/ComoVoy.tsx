import { useEffect, useMemo, useState } from 'react';
import { Trophy, TrendUp, TrendDown, Equals, CaretDown, Users } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';

/**
 * Cómo voy yo este mes — y, si mandas, cómo va el equipo.
 *
 * Diego, 22/09: «debe mostrar en el dashboard y en prospectos: eres la gestora
 * número X de ventas», y «su tasa de conversión en prospectos y clientes,
 * según los parámetros de sus % significa algo». Y el 23/09: «para el admin
 * debe tener como un desplegable del ranking y el % de conversión de la media».
 *
 * LOS NÚMEROS SALEN DEL MISMO SITIO QUE EL INFORME del jefe —`asesorasPorMes`—
 * a propósito: si aquí se contara aparte, la gestora vería una cifra en su
 * pantalla y otra en la reunión, y a partir de ahí ninguna de las dos vale.
 *
 * QUÉ SIGNIFICA EL PORCENTAJE se dice comparándolo con el equipo y no con unos
 * tramos inventados. Un «8,2 %» a secas no dice nada; «8,2 % frente al 6,1 %
 * del equipo» se entiende sin que nadie tenga que decidir antes qué es bueno.
 * Cuando Carlos ponga su baremo, se suma encima.
 *
 * EL PUESTO ES POR LO COBRADO desde el 08/10 (Diego, 08/10: «en los reportes el ranking de gestora es por lo cobrado»; del 30/09 al 08/10 fue por lo facturado). Lo calcula el servidor
 * (`miPuesto`); aquí solo se dice. Las ventas siguen al lado, como
 * contexto.
 *
 * LO QUE VE CADA UNA:
 *   · Una gestora: su puesto, su tasa, la media y cuánto le falta para subir.
 *     No los números de las demás — eso no la ayuda a vender.
 *   · Quien manda: la media del equipo y el ranking completo, plegado.
 *
 * CIFRAS SEPARADAS (Diego, 19/10/2026). Diana salió primera de la semana con
 * 2.100 € cobrados y 0 ventas: era una venta del 30/09 cobrada el 16/10 más una
 * cuota. No estaba mal contado, pero no se veía de dónde venía. Ahora el
 * ranking lleva Vendido, Facturado, Cobrado (partido en de ventas del mes, de
 * ventas anteriores —las grandes con su nº y su fecha— y cuotas) y Pendiente,
 * cada columna con la fecha por la que cuenta, más una fila «Sin gestora» y un
 * «Total» que es la tarjeta Cobrado del mismo mes. Sigue ordenado por lo
 * cobrado. Lo calcula `miPuesto`; aquí solo se pinta. Con `medida="facturado"`
 * (el Dashboard, #224) la tabla es la de siempre: tiene su propia fuente y su
 * propio orden.
 */

/** Un cobro grande de una venta anterior: «1.975 € · venta #676 del 30/09». */
export interface AnteriorGrande {
  venta_id: number;
  fecha_venta: string;
  importe: number;
}

/** Las cifras separadas de una fila (19/10/2026). */
export interface CifrasSeparadas {
  leads: number;
  ventas: number;
  vendido: number;
  cobrado: number;
  /**
   * Cuántos cobros (#534). Es el número que va con lo cobrado: el de ventas
   * (`ventas`) cuenta las ventas NUEVAS del periodo, que es otra cosa.
   */
  cobros?: number;
  /** Cobros de ventas cuya fecha de venta cae en el periodo. */
  cobrado_del_periodo: number;
  /** Cobros de ventas de antes, sin las cuotas. */
  cobrado_anteriores: number;
  /** Cuotas de un plan de pago y mensualidades. */
  cobrado_en_cuotas: number;
  ventas_anteriores: number;
  anteriores_grandes: AnteriorGrande[];
  facturado: number;
  /** De las ventas del periodo, lo que aún les falta por cobrar hoy. */
  pendiente: number;
  tasa: number;
}

export interface FilaDelRanking extends CifrasSeparadas {
  puesto: number;
  user_id: number;
  nombre: string | null;
}

/** Una fila del ranking. Solo la recibe quien manda. */
export interface FilaRanking extends Partial<CifrasSeparadas> {
  puesto: number;
  user_id: number;
  nombre: string | null;
  leads: number;
  ventas: number;
  vendido: number;
  cobrado: number;
  facturado: number;
  tasa: number;
}

export interface Puesto extends CifrasSeparadas {
  puesto: number | null;
  de: number;
  nombre: string | null;
  /** Por esto se ordena el puesto. */
  cobrado: number;
  tasa_equipo: number;
  ventas_equipo: number;
  cobrado_equipo: number;
  facturado_equipo: number;
  /** En euros cobrados. */
  faltan_para_subir: number | null;
  mejor_cobrado: number;
  mejor_facturado: number;
  mejor_ventas: number;
  /** Solo para quien manda. `null` para una gestora. */
  tabla: FilaDelRanking[] | null;
  /** Lo que no es de ninguna gestora. Solo para quien manda. */
  sin_gestora: CifrasSeparadas | null;
  /** Todas las filas, «Sin gestora» incluida: la tarjeta Cobrado. Solo para quien manda. */
  total: CifrasSeparadas | null;
}

const numero = (n: number) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(n || 0));

const euros = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(Number(n || 0));

/** «82 cobros», «1 cobro». */
const cuantos = (n: number | undefined, uno: string, varios: string) =>
  `${numero(Number(n || 0))} ${Number(n || 0) === 1 ? uno : varios}`;

/** «30/09» a partir de '2026-09-30'. */
function diaMes(iso: string) {
  const [, m, d] = String(iso || '').slice(0, 10).split('-');
  return d && m ? `${d}/${m}` : '';
}

/** «1.975 € · venta #676 del 30/09». */
const textoAnterior = (g: AnteriorGrande) => `${euros(g.importe)} · venta #${g.venta_id} del ${diaMes(g.fecha_venta)}`;

/**
 * Las celdas de cifras de una fila del ranking por lo cobrado, de Cobrado a
 * Pendiente. Las usan las gestoras, «Sin gestora» y el Total: así las tres
 * filas se pintan igual y la suma se comprueba a ojo.
 */
function CeldasDeCifras({ f, fuerte = false }: { f: Partial<CifrasSeparadas>; fuerte?: boolean }) {
  const grandes = f.anteriores_grandes || [];
  return (
    <>
      <td className="py-1 pr-2 text-right font-semibold tabular-nums">{euros(f.cobrado || 0)}</td>
      <td className="py-1 pr-2 text-right tabular-nums">{euros(f.cobrado_del_periodo || 0)}</td>
      <td className="py-1 pr-2 text-right tabular-nums">
        {euros(f.cobrado_anteriores || 0)}
        {!fuerte && grandes.map((g) => (
          <span key={g.venta_id} className="block whitespace-nowrap text-[10px] text-muted-foreground">{textoAnterior(g)}</span>
        ))}
      </td>
      <td className="py-1 pr-2 text-right tabular-nums">{euros(f.cobrado_en_cuotas || 0)}</td>
      <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{numero(f.ventas || 0)} · {euros(f.vendido || 0)}</td>
      <td className="py-1 pr-2 text-right tabular-nums">{euros(f.facturado || 0)}</td>
      <td className="py-1 pr-2 text-right tabular-nums">{euros(f.pendiente || 0)}</td>
    </>
  );
}

/** Cómo se dice un puesto: «la 1.ª», «la 3.ª». */
function ordinal(n: number) {
  return `${n}.ª`;
}

/** El nombre, corto: los de cuatro palabras rompen la fila. */
function corto(nombre: string | null) {
  const partes = String(nombre || '—').trim().split(/\s+/);
  return partes.length <= 2 ? partes.join(' ') : `${partes[0]} ${partes[1]}`;
}

/**
 * Las tres primeras, en un podio.
 *
 * Diego, 23/09: «el equipo de ventas será como un podio, no así». Lo que había
 * era una lista con barras; se leía, pero no se veía. Un podio se entiende sin
 * leerlo: la primera está más alta y en el centro.
 *
 * El ORDEN visual es 2 · 1 · 3, como en un podio de verdad, y el de lectura
 * sigue siendo 1 · 2 · 3 --la lista va en ese orden y se recoloca con CSS-- para
 * que un lector de pantalla no cante la segunda primero.
 *
 * Con MENOS DE TRES no se dibuja el podio: dos cajones y un hueco parecen una
 * avería. Con una o dos personas sale una línea y ya.
 */
function Podio({ filas, compacto, importe = (f) => f.cobrado }: {
  filas: FilaRanking[]; compacto: boolean;
  /** Qué cifra se enseña: lo cobrado (por defecto) o lo facturado (Dashboard). */
  importe?: (f: FilaRanking) => number;
}) {
  const tres = filas.slice(0, 3);
  if (!tres.length) return null;

  if (tres.length < 3) {
    return (
      <ol className={compacto ? 'mt-1.5 space-y-1' : 'mt-3 space-y-1'} aria-label="Las primeras del mes">
        {tres.map((f) => (
          <li key={f.user_id} className="flex items-baseline gap-2 text-normal">
            <span className="w-4 shrink-0 text-right font-bold tabular-nums text-muted-foreground">{f.puesto}</span>
            <span className="truncate font-medium">{corto(f.nombre)}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              <strong>{euros(importe(f))}</strong>
              <span className="text-muted-foreground"> · {numero(f.ventas)} {f.ventas === 1 ? 'venta' : 'ventas'}</span>
            </span>
          </li>
        ))}
      </ol>
    );
  }

  // La altura del cajón sale del puesto, no de las ventas: un podio dice quién
  // va delante, no cuánto. La distancia exacta está en el número de al lado y
  // en el ranking de abajo.
  const CAJON: Record<number, string> = {
    1: compacto ? 'h-12' : 'h-20',
    2: compacto ? 'h-8' : 'h-14',
    3: compacto ? 'h-6' : 'h-10',
  };
  const TONO: Record<number, string> = {
    1: 'bg-primary text-primary-foreground',
    2: 'bg-primary/55 text-primary-foreground',
    3: 'bg-primary/35 text-foreground',
  };
  // 2 · 1 · 3. `order` recoloca sin tocar el orden de lectura.
  const SITIO: Record<number, string> = { 1: 'order-2', 2: 'order-1', 3: 'order-3' };

  return (
    <ol
      className={`flex items-end justify-center gap-2 sm:gap-3 ${compacto ? 'mt-2' : 'mt-4'}`}
      aria-label="El podio del mes"
    >
      {tres.map((f) => (
        <li key={f.user_id} className={`flex min-w-0 flex-1 flex-col items-center ${SITIO[f.puesto] || ''}`}>
          <span className="max-w-full truncate text-center text-normal font-semibold" title={f.nombre || ''}>
            {corto(f.nombre)}
          </span>
          <span className="text-secundario font-semibold tabular-nums">{euros(importe(f))}</span>
          <span className="text-secundario tabular-nums text-muted-foreground">
            {numero(f.ventas)} {f.ventas === 1 ? 'venta' : 'ventas'}
          </span>
          <span
            className={`mt-1 flex w-full items-start justify-center rounded-t-md pt-1 font-bold tabular-nums ${CAJON[f.puesto]} ${TONO[f.puesto]}`}
          >
            {/* La copa solo para quien gana, y ADEMAS del sitio: el cajón más
                alto ya lo dice, pero en móvil los tres se estrechan. */}
            {f.puesto === 1 ? <Trophy size={compacto ? 13 : 16} weight="fill" /> : f.puesto}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Cuánto ocupa una tasa en la barra.
 *
 * La escala llega hasta la mayor de las dos que se comparan y no hasta 100: con
 * tasas del 8 % --que es lo normal aquí-- una barra sobre 100 es una raya que
 * no se ve, y entonces no compara nada.
 */
/** Lo que devuelve `/ventas/facturado` (#224). */
interface Facturado {
  total: { facturado: number; ventas: number };
  gestoras: Array<{ user_id: number; nombre: string | null; facturado: number; ventas: number }>;
  sin_gestora: { facturado: number; ventas: number };
}

/**
 * El mes en curso, del día 1 a hoy, en fecha LOCAL. Es exactamente el «Mes» de
 * la tarjeta «Productos vendidos» (`rangeFor('mes')`): mismo periodo y misma
 * consulta, así que las dos cifras no pueden salir distintas.
 */
function mesEnCurso() {
  const hoy = new Date();
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), to: iso(hoy) };
}

/** La línea pequeña de debajo de una cabecera: por qué fecha cuenta. */
const SUBCABECERA = 'block text-[9px] font-normal normal-case tracking-normal';

function anchoTasa(v: number, tope: number) {
  if (!(tope > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round((Number(v) || 0) * 100 / tope)));
}

export default function ComoVoy({
  gestoraId = null,
  compacto = false,
  medida = 'cobrado',
}: {
  /** Para que un jefe pueda mirar el de una gestora concreta. */
  gestoraId?: number | null;
  /** En una lista hay menos sitio que en el panel. */
  compacto?: boolean;
  /**
   * Qué cuenta el bloque DEL EQUIPO (lo que ve quien manda).
   *
   * · 'cobrado' (por defecto): el ranking de gestoras, que va por lo cobrado
   *   desde el 08/10. Es lo que se ve en Prospectos y Clientes.
   * · 'facturado': el Dashboard. Diego, 10/10 (#224): «el Dashboard cuenta lo
   *   FACTURADO, también en el bloque del equipo, porque hay ventas sin
   *   gestora que tienen que facturarse». Sale de `/ventas/facturado`, la
   *   misma consulta que «Productos vendidos», y lleva la fila «Sin gestora»
   *   para que el bloque sume el total.
   *
   * Lo que ve una gestora de sí misma (su puesto) no cambia: va por lo cobrado.
   */
  medida?: 'cobrado' | 'facturado';
}) {
  const { activeProject, activeIssuerId } = useProjectContext();
  const [d, setD] = useState<Puesto | null>(null);
  const [fact, setFact] = useState<Facturado | null>(null);
  const [abierto, setAbierto] = useState(false);
  const porFacturado = medida === 'facturado';

  useEffect(() => {
    let vivo = true;
    const p = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject });
    if (gestoraId) p.set('gestoraId', String(gestoraId));
    // Con lo facturado, el MISMO mes que la tarjeta de productos.
    if (porFacturado) { const m = mesEnCurso(); p.set('from', m.from); p.set('to', m.to); }
    client.get(`/informes/mi-puesto?${p.toString()}`)
      .then((r: any) => { if (vivo) setD(r?.success ? r.data : null); })
      // Sin ruido: esto acompaña a la pantalla, no es la pantalla.
      .catch(() => { if (vivo) setD(null); });
    return () => { vivo = false; };
  }, [activeProject?.id, activeIssuerId, gestoraId, porFacturado]);

  const esJefe = Array.isArray(d?.tabla);

  // Lo facturado del equipo, solo para quien manda y solo en el Dashboard.
  useEffect(() => {
    if (!porFacturado || !esJefe) { setFact(null); return undefined; }
    let vivo = true;
    const p = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject });
    const m = mesEnCurso();
    p.set('from', m.from); p.set('to', m.to);
    client.get(`/ventas/facturado?${p.toString()}`)
      .then((r: any) => { if (vivo) setFact(r?.success ? r.data : null); })
      .catch(() => { if (vivo) setFact(null); });
    return () => { vivo = false; };
  }, [porFacturado, esJefe, activeProject?.id, activeIssuerId]);

  /*
    El ranking POR LO FACTURADO: las gestoras de lo facturado, con los
    prospectos y la tasa de `mi-puesto` al lado. Quien tiene prospectos pero
    nada facturado sale con 0: está en el equipo aunque este mes no facture.
  */
  const filasFacturado = useMemo<FilaRanking[] | null>(() => {
    if (!fact) return null;
    const tabla = d?.tabla || [];
    const ids = new Set<number>([...fact.gestoras.map((g) => g.user_id), ...tabla.map((x) => x.user_id)]);
    const filas = [...ids].map((id) => {
      const g = fact.gestoras.find((x) => x.user_id === id);
      const x = tabla.find((y) => y.user_id === id);
      return {
        puesto: 0,
        user_id: id,
        nombre: g?.nombre ?? x?.nombre ?? null,
        leads: x?.leads ?? 0,
        ventas: g?.ventas ?? 0,
        vendido: x?.vendido ?? 0,
        cobrado: x?.cobrado ?? 0,
        facturado: g?.facturado ?? 0,
        tasa: x?.tasa ?? 0,
      };
    }).sort((a, b) => b.facturado - a.facturado || b.ventas - a.ventas);
    filas.forEach((f, i) => { f.puesto = i + 1; });
    return filas;
  }, [fact, d]);
  const equipo = useMemo(() => {
    const t = d?.tabla || [];
    return {
      gente: t.length,
      // EL TOTAL, «Sin gestora» incluida (19/10/2026): antes se sumaban solo
      // las filas visibles y el dinero sin gestora no salía en ningún sitio.
      // Es la misma cifra que la fila Total y que la tarjeta Cobrado del mes.
      ventas: d?.total ? Number(d.total.ventas || 0) : t.reduce((s, x) => s + Number(x.ventas || 0), 0),
      vendido: d?.total ? Number(d.total.vendido || 0) : t.reduce((s, x) => s + Number(x.vendido || 0), 0),
      cobrado: d?.total ? Number(d.total.cobrado || 0) : t.reduce((s, x) => s + Number(x.cobrado || 0), 0),
      cobros: d?.total ? Number(d.total.cobros || 0) : t.reduce((s, x) => s + Number(x.cobros || 0), 0),
    };
  }, [d]);

  if (!d) return null;

  // Una gestora sin nada este mes no está en la clasificación: decirle que es
  // «la 0 de 7» no es información, es un palo. A quien manda se le enseña igual,
  // porque lo que mira es el equipo, no lo suyo.
  if (!esJefe && d.puesto === null && d.leads === 0 && d.ventas === 0 && !d.cobrado) return null;

  const mejorQueElEquipo = d.tasa > d.tasa_equipo;
  // Con un poco de aire por encima, para que la barra llena no toque el borde.
  const topeTasa = Math.max(d.tasa, d.tasa_equipo) * 1.15;
  const igualQueElEquipo = Math.abs(d.tasa - d.tasa_equipo) < 0.05;
  const Icono = igualQueElEquipo ? Equals : mejorQueElEquipo ? TrendUp : TrendDown;
  const tono = igualQueElEquipo
    ? 'text-muted-foreground'
    : mejorQueElEquipo ? 'text-success' : 'text-warning-soft-foreground';

  return (
    <section
      aria-label={esJefe ? 'Cómo va el equipo este mes' : 'Cómo voy este mes'}
      className={`rounded-lg border border-border bg-card ${compacto ? 'px-3 py-2' : 'p-4'}`}
    >
      {esJefe ? (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <p className="flex items-baseline gap-2">
              <Users size={compacto ? 15 : 18} weight="duotone" className="translate-y-0.5 text-primary" />
              <span className={compacto ? 'text-normal' : 'text-seccion'}>
                {/* CADA IMPORTE CON SU RECUENTO (#534). Antes Prospectos decía
                    «18.048 € cobrados · 43 ventas»: el importe eran los cobros
                    del mes y el 43, las ventas NUEVAS. Ahora lo cobrado va con
                    cuántos cobros, lo facturado con cuántas ventas facturadas y
                    las ventas nuevas aparte, cada una con su nombre. */}
                {fact ? (
                  // EL TOTAL, con lo que no es de ninguna gestora dentro: es
                  // la misma cifra que «Productos vendidos · Mes».
                  <span title="Facturas y abonos emitidos este mes, por su fecha de factura. Una venta cuenta una vez aunque tenga varias facturas.">
                    El equipo este mes: <strong>{euros(fact.total.facturado)}</strong> facturados
                    {' · '}{cuantos(fact.total.ventas, 'venta facturada', 'ventas facturadas')}
                  </span>
                ) : (
                  <span title="Los pagos registrados este mes, por su fecha de cobro.">
                    El equipo este mes: <strong>{euros(equipo.cobrado)}</strong> cobrados
                    {' · '}{cuantos(equipo.cobros, 'cobro', 'cobros')}
                  </span>
                )}
              </span>
            </p>
            <p className="text-secundario tabular-nums text-muted-foreground">
              {/* Lo que el otro panel enseña, para que las dos pantallas se
                  puedan cuadrar sin abrir el ranking. */}
              {fact && d.total ? (
                <span title="Los pagos registrados este mes, por su fecha de cobro: lo mismo que el panel de Prospectos.">
                  {euros(equipo.cobrado)} cobrados · {cuantos(equipo.cobros, 'cobro', 'cobros')}
                </span>
              ) : (
                <span title="Ventas cerradas este mes, por su fecha de venta.">
                  {cuantos(equipo.ventas, 'venta nueva', 'ventas nuevas')} · {euros(equipo.vendido)} vendidos
                </span>
              )}
              {' · '}
              <span title="Ventas entre prospectos de las gestoras, sin «Sin gestora». La fila Total del ranking sí la incluye, y por eso da otra cifra.">
                Tasa media de las gestoras <strong className="text-foreground">{numero(d.tasa_equipo)} %</strong>
              </span>
              {' · '}{equipo.gente} {equipo.gente === 1 ? 'persona' : 'personas'}
            </p>
          </div>

          {/* Las tres primeras, siempre a la vista. */}
          <Podio
            filas={filasFacturado || d.tabla || []}
            compacto={compacto}
            importe={filasFacturado ? (f) => f.facturado : undefined}
          />

          {/* El ranking entero, plegado. Abierto de serie ocupa media pantalla
              en una lista que ya es larga. */}
          <button
            type="button"
            onClick={() => setAbierto((v) => !v)}
            aria-expanded={abierto}
            className="mt-2 inline-flex items-center gap-1 text-normal font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring/40 rounded"
          >
            <Trophy size={13} weight="duotone" />
            {abierto ? 'Ocultar el ranking' : 'Ver el ranking'}
            <CaretDown size={11} weight="bold" className={abierto ? 'rotate-180 transition-transform' : 'transition-transform'} />
          </button>

          {abierto && !filasFacturado && (
            <div className="mt-2 overflow-x-auto">
              {/* EL RANKING POR LO COBRADO, con las cifras separadas (19/10/2026).
                  Cada cabecera dice por qué fecha cuenta; las filas, «Sin
                  gestora» y el Total suman igual columna a columna. */}
              <table className="w-full text-normal">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground align-bottom">
                    <th className="py-1 pr-2 font-semibold">#</th>
                    <th className="py-1 pr-2 font-semibold">Gestora</th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Los pagos registrados en el mes, por su fecha de cobro. Es la suma de las tres columnas siguientes, y por esto se ordena el ranking.">
                      Cobrado<span className={SUBCABECERA}>por fecha de cobro</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Cobros de ventas cuya fecha de venta cae en este mes.">
                      De ventas del mes<span className={SUBCABECERA}>ventas de este mes</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Cobros de ventas de antes de este mes, sin las cuotas. Las de 300 € o más salen con su nº de venta y su fecha.">
                      De ventas anteriores<span className={SUBCABECERA}>ventas de antes</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Cobros que saldan una cuota de un plan de pago, o de una ficha marcada como mensualidad.">
                      Cuotas<span className={SUBCABECERA}>plan o mensualidad</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Ventas del mes, número e importe, por su fecha de venta. Sin mensualidades ni ventas sin ningún cobro; una compartida cuenta su parte.">
                      Vendido<span className={SUBCABECERA}>por fecha de venta</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Facturas y abonos emitidos en el mes, IVA incluido.">
                      Facturado<span className={SUBCABECERA}>por fecha de factura</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="De las ventas del mes, su importe menos todo lo cobrado de ellas hasta hoy.">
                      Pendiente<span className={SUBCABECERA}>de las ventas del mes</span>
                    </th>
                    <th className="py-1 pr-2 text-right font-semibold" title="Prospectos por su fecha de entrada.">Prospectos</th>
                    <th className="py-1 text-right font-semibold">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.tabla || []).map((f) => (
                    <tr key={f.user_id} className={`border-t border-border/60 ${f.puesto === d.puesto ? 'font-semibold' : ''}`}>
                      <td className="py-1 pr-2 tabular-nums text-muted-foreground">{f.puesto}</td>
                      <td className="py-1 pr-2 truncate">{f.nombre || '—'}</td>
                      <CeldasDeCifras f={f} />
                      <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{f.leads}</td>
                      {/* La tasa, comparada con la media del equipo: es lo
                          que dice si ese número es bueno o no. */}
                      <td className={`py-1 text-right tabular-nums ${
                        f.tasa > d.tasa_equipo ? 'text-success'
                          : f.tasa < d.tasa_equipo ? 'text-warning-soft-foreground' : ''
                      }`}>
                        {numero(f.tasa)} %
                      </td>
                    </tr>
                  ))}
                  {/* SIN GESTORA: ventas sin vendedora de prospectos sin
                      responsable. No compite, pero cuenta en el Total. */}
                  {d.sin_gestora && (d.sin_gestora.cobrado !== 0 || d.sin_gestora.ventas > 0 || d.sin_gestora.facturado !== 0) && (
                    <tr className="border-t border-border/60 text-muted-foreground"
                      title="Ventas sin vendedora de prospectos sin responsable: no compiten, pero cuentan en el total.">
                      <td className="py-1 pr-2">—</td>
                      <td className="py-1 pr-2 italic">Sin gestora</td>
                      <CeldasDeCifras f={d.sin_gestora} />
                      <td className="py-1 pr-2 text-right tabular-nums">{d.sin_gestora.leads}</td>
                      <td className="py-1" />
                    </tr>
                  )}
                  {d.total && (
                    <tr className="border-t-2 border-border font-semibold"
                      title="Todas las filas, «Sin gestora» incluida. Su Cobrado es la tarjeta Ingresos de Reportes para este mes; con ventas compartidas puede haber un céntimo de redondeo.">
                      <td className="py-1 pr-2" />
                      <td className="py-1 pr-2">Total</td>
                      <CeldasDeCifras f={d.total} fuerte />
                      <td className="py-1 pr-2 text-right tabular-nums">{d.total.leads}</td>
                      <td className="py-1 text-right tabular-nums"
                        title="Con «Sin gestora». La «Tasa media de las gestoras» de arriba no la lleva: por eso son cifras distintas.">
                        {numero(d.total.tasa)} %
                      </td>
                    </tr>
                  )}
                  {(d.tabla || []).length === 0 && !d.total?.cobrado && (
                    <tr><td colSpan={11} className="py-2 text-muted-foreground">
                      Nadie con prospectos, ventas ni cobros este mes.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* POR LO FACTURADO (el Dashboard, #224): la tabla de siempre, con su
              fuente y su orden. Solo se dice por qué fecha cuenta. */}
          {abierto && filasFacturado && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-normal">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold">#</th>
                    <th className="py-1 pr-2 font-semibold">Gestora</th>
                    <th className="py-1 pr-2 text-right font-semibold" title={filasFacturado ? 'Facturas y abonos emitidos este mes, por su fecha de factura.' : 'Por fecha de cobro.'}>{filasFacturado ? 'Facturado' : 'Cobrado'}</th>
                    <th
                      className="py-1 pr-2 text-right font-semibold"
                      title={filasFacturado ? 'Ventas con alguna factura emitida este mes' : undefined}
                    >Ventas</th>
                    <th className="py-1 pr-2 text-right font-semibold">Prospectos</th>
                    <th className="py-1 text-right font-semibold">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {(filasFacturado || d.tabla || []).map((f) => {
                    const suya = f.user_id === undefined ? false : f.puesto === d.puesto;
                    return (
                      <tr key={f.user_id} className={`border-t border-border/60 ${suya ? 'font-semibold' : ''}`}>
                        <td className="py-1 pr-2 tabular-nums text-muted-foreground">{f.puesto}</td>
                        <td className="py-1 pr-2 truncate">{f.nombre || '—'}</td>
                        <td className="py-1 pr-2 text-right font-semibold tabular-nums">{euros(filasFacturado ? f.facturado : f.cobrado)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{numero(f.ventas)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums text-muted-foreground">{f.leads}</td>
                        {/* La tasa, comparada con la media del equipo: es lo
                            que dice si ese número es bueno o no. */}
                        <td className={`py-1 text-right tabular-nums ${
                          f.tasa > d.tasa_equipo ? 'text-success'
                            : f.tasa < d.tasa_equipo ? 'text-warning-soft-foreground' : ''
                        }`}>
                          {numero(f.tasa)} %
                        </td>
                      </tr>
                    );
                  })}
                  {/* SIN GESTORA y el TOTAL (#224): con ellas el bloque suma lo
                      mismo que «Productos vendidos». Antes lo que no era de
                      nadie no salía en ninguna fila. */}
                  {fact && (fact.sin_gestora.ventas > 0 || fact.sin_gestora.facturado !== 0) && (
                    <tr className="border-t border-border/60 text-muted-foreground">
                      <td className="py-1 pr-2">—</td>
                      <td className="py-1 pr-2 italic">Sin gestora</td>
                      <td className="py-1 pr-2 text-right font-semibold tabular-nums">{euros(fact.sin_gestora.facturado)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{numero(fact.sin_gestora.ventas)}</td>
                      <td className="py-1 pr-2" />
                      <td className="py-1" />
                    </tr>
                  )}
                  {fact && (
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="py-1 pr-2" />
                      <td className="py-1 pr-2">Total</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{euros(fact.total.facturado)}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{numero(fact.total.ventas)}</td>
                      <td className="py-1 pr-2" />
                      <td className="py-1" />
                    </tr>
                  )}
                  {(filasFacturado || d.tabla || []).length === 0 && !fact && (
                    <tr><td colSpan={6} className="py-2 text-muted-foreground">
                      Nadie con prospectos, ventas ni cobros este mes.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          {/* SU PUESTO, EN GRANDE. Diego, 23/09: «para las gestoras algo más
              único e individual». Lo que había era una frase entre otras; esto
              es lo suyo y se lee sin buscarlo. */}
          <div className="flex items-center gap-3">
            <span className={`flex shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary ${compacto ? 'h-11 w-11' : 'h-14 w-14'}`}>
              {d.puesto ? (
                <>
                  <strong className={`leading-none tabular-nums ${compacto ? 'text-lg' : 'text-2xl'}`}>{d.puesto}</strong>
                  <span className="text-[9px] font-semibold uppercase tracking-wide">de {d.de}</span>
                </>
              ) : (
                <Trophy size={compacto ? 18 : 24} weight="duotone" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className={compacto ? 'text-normal' : 'text-seccion'}>
                {d.puesto
                  ? <>Vas <strong>{ordinal(d.puesto)}</strong> en lo cobrado este mes</>
                  : <>Todavía sin cobros este mes</>}
              </p>
              <p className="text-secundario tabular-nums text-muted-foreground">
                <strong className="text-foreground">{euros(d.cobrado)}</strong> cobrados
                {' · '}{cuantos(d.cobros, 'cobro', 'cobros')}
                {' · '}{cuantos(d.ventas, 'venta nueva', 'ventas nuevas')}
                {d.leads > 0 && <> · {d.leads} {d.leads === 1 ? 'prospecto' : 'prospectos'}</>}
              </p>
              {/* De dónde viene lo cobrado (19/10/2026): si es de una venta
                  vieja, que lo vea ella también. */}
              {d.cobrado > 0 && (
                <p className="text-secundario tabular-nums text-muted-foreground"
                  title={(d.anteriores_grandes || []).map(textoAnterior).join('\n') || undefined}>
                  {euros(d.cobrado_del_periodo)} de ventas del mes · {euros(d.cobrado_anteriores)} de ventas anteriores
                  {' · '}{euros(d.cobrado_en_cuotas)} de cuotas
                  {!compacto && (d.anteriores_grandes || []).length > 0 && (
                    <> ({(d.anteriores_grandes || []).map(textoAnterior).join('; ')})</>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* SU TASA CONTRA LA DEL EQUIPO, dibujada. Un «16,5 %» a secas no dice
              si es bueno; al lado de la media del equipo, sí. La marca de la
              media va encima de la barra: es la línea que hay que pasar. */}
          {(d.leads > 0 || d.tasa_equipo > 0) && (
            <div className={compacto ? 'mt-2' : 'mt-3'}>
              <div className="flex items-baseline justify-between gap-2">
                <span className={`flex items-center gap-1.5 text-normal font-semibold ${tono}`}>
                  <Icono size={13} weight="bold" aria-hidden="true" />
                  <span className="tabular-nums">{numero(d.tasa)} %</span>
                  <span className="font-normal text-muted-foreground">de cierre</span>
                </span>
                <span className="text-secundario tabular-nums text-muted-foreground">
                  el equipo, {numero(d.tasa_equipo)} %
                </span>
              </div>
              {/* La escala llega hasta la mayor de las dos, no hasta 100: con
                  tasas del 8 % una barra sobre 100 es una raya invisible. */}
              <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${mejorQueElEquipo ? 'bg-success' : 'bg-primary'}`}
                  style={{ width: `${anchoTasa(d.tasa, topeTasa)}%` }}
                />
                {d.tasa_equipo > 0 && (
                  <span
                    className="absolute inset-y-0 w-0.5 bg-foreground/50"
                    style={{ left: `${anchoTasa(d.tasa_equipo, topeTasa)}%` }}
                    aria-hidden="true"
                    title={`Media del equipo: ${numero(d.tasa_equipo)} %`}
                  />
                )}
              </div>
            </div>
          )}

          {/* Lo que falta para adelantar a quien va justo delante. Sin nombre:
              es para espabilar, no para señalar a nadie. */}
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${compacto ? 'mt-1.5' : 'mt-2'}`}>
            {d.faltan_para_subir != null && d.faltan_para_subir > 0 && (
              <p className="text-secundario text-muted-foreground">
                A <strong className="text-foreground tabular-nums">{euros(d.faltan_para_subir)}</strong> del puesto de arriba
              </p>
            )}
            {d.puesto === 1 && d.cobrado > 0 && (
              <p className="text-secundario font-semibold text-success">Vas en cabeza</p>
            )}
            {d.mejor_cobrado > 0 && d.puesto !== 1 && (
              <p className="text-secundario text-muted-foreground tabular-nums">
                La primera va por {euros(d.mejor_cobrado)}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
