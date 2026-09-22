import { useEffect, useState } from 'react';
import { Trophy, TrendUp, TrendDown, Equals } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';

/**
 * Cómo voy yo este mes.
 *
 * Diego, 22/09: «debe mostrar en el dashboard y en prospectos: eres la gestora
 * número X de ventas», y «su tasa de conversión en prospectos y clientes, y
 * según los parámetros de sus % significa algo».
 *
 * LOS NÚMEROS SALEN DEL MISMO SITIO QUE EL INFORME del jefe —`asesorasPorMes`—
 * a propósito: si aquí se contara aparte, la gestora vería una cifra en su
 * pantalla y otra en la reunión, y a partir de ahí ninguna de las dos vale.
 *
 * QUÉ SIGNIFICA EL PORCENTAJE se dice comparándolo con el equipo y no con unos
 * tramos inventados. Un «8,2 %» a secas no dice nada; «8,2 % frente al 6,1 %
 * del equipo» se entiende sin que nadie tenga que decidir antes qué es bueno.
 * Cuando Carlos ponga su baremo, se suma encima de esto.
 *
 * Y NO ENSEÑA LOS NÚMEROS DE LAS DEMÁS: el puesto, la tasa, la media y lo que
 * falta para subir. Quién va delante es un dato del jefe, no de la carrera.
 */

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

  if (!d) return null;

  // Quien no tiene ni un prospecto ni una venta este mes no está en la
  // clasificación: decirle que es «la 0 de 7» no es información, es un palo.
  if (d.puesto === null && d.leads === 0 && d.ventas === 0) return null;

  const mejorQueElEquipo = d.tasa > d.tasa_equipo;
  const igualQueElEquipo = Math.abs(d.tasa - d.tasa_equipo) < 0.05;
  const Icono = igualQueElEquipo ? Equals : mejorQueElEquipo ? TrendUp : TrendDown;
  const tono = igualQueElEquipo
    ? 'text-muted-foreground'
    : mejorQueElEquipo ? 'text-success' : 'text-warning-soft-foreground';

  return (
    <section
      aria-label="Cómo voy este mes"
      className={`rounded-lg border border-border bg-card ${compacto ? 'px-3 py-2' : 'p-4'}`}
    >
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
        {/* La tasa, con lo que significa al lado. El icono va además del color,
            que un texto verde a secas no lo distingue quien no ve bien el color. */}
        <p className={`flex items-center gap-1.5 text-normal ${tono}`}>
          <Icono size={13} weight="bold" aria-hidden="true" />
          <span className="tabular-nums font-semibold">{numero(d.tasa)} %</span>
          <span className="text-muted-foreground">
            de tus {d.leads} {d.leads === 1 ? 'prospecto' : 'prospectos'} del mes
            {' · el equipo va al '}<span className="tabular-nums">{numero(d.tasa_equipo)} %</span>
          </span>
        </p>

        {/* Lo que falta para adelantar a quien va justo delante. Sin nombre: es
            para espabilar, no para señalar a nadie. */}
        {d.faltan_para_subir != null && d.faltan_para_subir > 0 && (
          <p className="text-secundario text-muted-foreground">
            A {numero(d.faltan_para_subir)} {d.faltan_para_subir === 1 ? 'venta' : 'ventas'} del puesto de arriba
          </p>
        )}
        {d.puesto === 1 && d.ventas > 0 && (
          <p className="text-secundario font-semibold text-success">Vas en cabeza</p>
        )}
      </div>
    </section>
  );
}
