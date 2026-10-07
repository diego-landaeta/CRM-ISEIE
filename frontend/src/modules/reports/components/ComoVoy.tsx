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
 * EL PUESTO ES POR LO FACTURADO desde el 30/09. Diego: «el ranking de gestoras
 * será por montos facturados; así es como se medirá». Lo calcula el servidor
 * (`miPuesto`); aquí solo se dice. Las ventas siguen al lado, como
 * contexto.
 *
 * LO QUE VE CADA UNA:
 *   · Una gestora: su puesto, su tasa, la media y cuánto le falta para subir.
 *     No los números de las demás — eso no la ayuda a vender.
 *   · Quien manda: la media del equipo y el ranking completo, plegado.
 */

export interface FilaDelRanking {
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

/** Una fila del ranking. Solo la recibe quien manda. */
export interface FilaRanking {
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

export interface Puesto {
  puesto: number | null;
  de: number;
  nombre: string | null;
  leads: number;
  ventas: number;
  vendido: number;
  cobrado: number;
  /** Por esto se ordena el puesto. */
  facturado: number;
  tasa: number;
  tasa_equipo: number;
  ventas_equipo: number;
  facturado_equipo: number;
  /** En euros facturados. */
  faltan_para_subir: number | null;
  mejor_facturado: number;
  mejor_ventas: number;
  /** Solo para quien manda. `null` para una gestora. */
  tabla: FilaDelRanking[] | null;
}

const numero = (n: number) =>
  new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(n || 0));

const euros = (n: number) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
    .format(Number(n || 0));

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
function Podio({ filas, compacto }: { filas: FilaRanking[]; compacto: boolean }) {
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
              <strong>{euros(f.facturado)}</strong>
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
          <span className="text-secundario font-semibold tabular-nums">{euros(f.facturado)}</span>
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
function anchoTasa(v: number, tope: number) {
  if (!(tope > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round((Number(v) || 0) * 100 / tope)));
}

export default function ComoVoy({
  gestoraId = null,
  compacto = false,
}: {
  /** Para que un jefe pueda mirar el de una gestora concreta. */
  gestoraId?: number | null;
  /** En una lista hay menos sitio que en el panel. */
  compacto?: boolean;
}) {
  const { activeProject, activeIssuerId } = useProjectContext();
  const [d, setD] = useState<Puesto | null>(null);
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    const p = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject });
    if (gestoraId) p.set('gestoraId', String(gestoraId));
    client.get(`/informes/mi-puesto?${p.toString()}`)
      .then((r: any) => { if (vivo) setD(r?.success ? r.data : null); })
      // Sin ruido: esto acompaña a la pantalla, no es la pantalla.
      .catch(() => { if (vivo) setD(null); });
    return () => { vivo = false; };
  }, [activeProject?.id, activeIssuerId, gestoraId]);

  const esJefe = Array.isArray(d?.tabla);
  const equipo = useMemo(() => {
    const t = d?.tabla || [];
    return {
      gente: t.length,
      ventas: t.reduce((s, x) => s + Number(x.ventas || 0), 0),
      facturado: t.reduce((s, x) => s + Number(x.facturado || 0), 0),
    };
  }, [d]);

  if (!d) return null;

  // Una gestora sin nada este mes no está en la clasificación: decirle que es
  // «la 0 de 7» no es información, es un palo. A quien manda se le enseña igual,
  // porque lo que mira es el equipo, no lo suyo.
  if (!esJefe && d.puesto === null && d.leads === 0 && d.ventas === 0 && !d.facturado) return null;

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
                El equipo este mes: <strong>{euros(equipo.facturado)}</strong> facturados
                {' · '}{numero(equipo.ventas)} {equipo.ventas === 1 ? 'venta' : 'ventas'}
              </span>
            </p>
            <p className="text-secundario tabular-nums text-muted-foreground">
              Tasa media <strong className="text-foreground">{numero(d.tasa_equipo)} %</strong>
              {' · '}{equipo.gente} {equipo.gente === 1 ? 'persona' : 'personas'}
            </p>
          </div>

          {/* Las tres primeras, siempre a la vista. */}
          <Podio filas={d.tabla || []} compacto={compacto} />

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

          {abierto && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-normal">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="py-1 pr-2 font-semibold">#</th>
                    <th className="py-1 pr-2 font-semibold">Gestora</th>
                    <th className="py-1 pr-2 text-right font-semibold">Facturado</th>
                    <th className="py-1 pr-2 text-right font-semibold">Ventas</th>
                    <th className="py-1 pr-2 text-right font-semibold">Prospectos</th>
                    <th className="py-1 text-right font-semibold">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.tabla || []).map((f) => {
                    const suya = f.user_id === undefined ? false : f.puesto === d.puesto;
                    return (
                      <tr key={f.user_id} className={`border-t border-border/60 ${suya ? 'font-semibold' : ''}`}>
                        <td className="py-1 pr-2 tabular-nums text-muted-foreground">{f.puesto}</td>
                        <td className="py-1 pr-2 truncate">{f.nombre || '—'}</td>
                        <td className="py-1 pr-2 text-right font-semibold tabular-nums">{euros(f.facturado)}</td>
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
                  {(d.tabla || []).length === 0 && (
                    <tr><td colSpan={6} className="py-2 text-muted-foreground">
                      Nadie con prospectos, ventas ni facturas este mes.
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
                  ? <>Vas <strong>{ordinal(d.puesto)}</strong> en facturación este mes</>
                  : <>Todavía sin facturación este mes</>}
              </p>
              <p className="text-secundario tabular-nums text-muted-foreground">
                <strong className="text-foreground">{euros(d.facturado)}</strong> facturados
                {' · '}{numero(d.ventas)} {d.ventas === 1 ? 'venta' : 'ventas'}
                {d.leads > 0 && <> · {d.leads} {d.leads === 1 ? 'prospecto' : 'prospectos'}</>}
              </p>
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
            {d.puesto === 1 && d.facturado > 0 && (
              <p className="text-secundario font-semibold text-success">Vas en cabeza</p>
            )}
            {d.mejor_facturado > 0 && d.puesto !== 1 && (
              <p className="text-secundario text-muted-foreground tabular-nums">
                La primera va por {euros(d.mejor_facturado)}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
