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
  tasa: number;
  tasa_equipo: number;
  ventas_equipo: number;
  faltan_para_subir: number | null;
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
      vendido: t.reduce((s, x) => s + Number(x.vendido || 0), 0),
    };
  }, [d]);

  if (!d) return null;

  // Una gestora sin nada este mes no está en la clasificación: decirle que es
  // «la 0 de 7» no es información, es un palo. A quien manda se le enseña igual,
  // porque lo que mira es el equipo, no lo suyo.
  if (!esJefe && d.puesto === null && d.leads === 0 && d.ventas === 0) return null;

  const mejorQueElEquipo = d.tasa > d.tasa_equipo;
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
                El equipo este mes: <strong>{numero(equipo.ventas)}</strong>{' '}
                {equipo.ventas === 1 ? 'venta' : 'ventas'} · {euros(equipo.vendido)}
              </span>
            </p>
            <p className="text-secundario tabular-nums text-muted-foreground">
              Tasa media <strong className="text-foreground">{numero(d.tasa_equipo)} %</strong>
              {' · '}{equipo.gente} {equipo.gente === 1 ? 'persona' : 'personas'}
            </p>
          </div>

          {/* El ranking, plegado. Abierto de serie ocupa media pantalla en una
              lista que ya es larga; y lo que se mira a diario es la media. */}
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
                    <th className="py-1 pr-2 text-right font-semibold">Ventas</th>
                    <th className="py-1 pr-2 text-right font-semibold">Vendido</th>
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
                        <td className="py-1 pr-2 text-right tabular-nums">{numero(f.ventas)}</td>
                        <td className="py-1 pr-2 text-right tabular-nums">{euros(f.vendido)}</td>
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
                      Nadie con prospectos ni ventas este mes.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <p className="flex items-baseline gap-2">
              <Trophy size={compacto ? 15 : 18} weight="duotone" className="translate-y-0.5 text-primary" />
              <span className={compacto ? 'text-normal' : 'text-seccion'}>
                {d.puesto
                  ? <>Vas <strong>{ordinal(d.puesto)}</strong> de {d.de} en ventas este mes</>
                  : <>Todavía sin ventas este mes</>}
              </span>
            </p>

            <p className="text-secundario tabular-nums text-muted-foreground">
              {numero(d.ventas)} {d.ventas === 1 ? 'venta' : 'ventas'} · {euros(d.vendido)}
            </p>
          </div>

          <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${compacto ? 'mt-1' : 'mt-2'}`}>
            {/* La tasa, con lo que significa al lado. El icono va además del
                color: un texto verde a secas no lo distingue quien no ve bien
                el color. */}
            <p className={`flex items-center gap-1.5 text-normal ${tono}`}>
              <Icono size={13} weight="bold" aria-hidden="true" />
              <span className="tabular-nums font-semibold">{numero(d.tasa)} %</span>
              <span className="text-muted-foreground">
                de tus {d.leads} {d.leads === 1 ? 'prospecto' : 'prospectos'} del mes
                {' · el equipo va al '}<span className="tabular-nums">{numero(d.tasa_equipo)} %</span>
              </span>
            </p>

            {/* Lo que falta para adelantar a quien va justo delante. Sin nombre:
                es para espabilar, no para señalar a nadie. */}
            {d.faltan_para_subir != null && d.faltan_para_subir > 0 && (
              <p className="text-secundario text-muted-foreground">
                A {numero(d.faltan_para_subir)} {d.faltan_para_subir === 1 ? 'venta' : 'ventas'} del puesto de arriba
              </p>
            )}
            {d.puesto === 1 && d.ventas > 0 && (
              <p className="text-secundario font-semibold text-success">Vas en cabeza</p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
