import { useMemo } from 'react';

/**
 * Los atajos de fecha: hoy, ayer, esta semana, este mes, mes pasado.
 *
 * Diego lo ha pedido TRES veces en cuatro dias --la cola de facturacion el 11,
 * Facturacion el 14, y otra vez el 14 sin decir la pantalla--. Que se repita
 * asi no significa que haya tres tareas: significa que falta en todas partes.
 * Por eso esto es UN componente y no un bloque de botones copiado en cada
 * pantalla; si se hace por sitio, acabaran siendo cinco atajos con cinco
 * comportamientos distintos.
 *
 * NO TOCA EL BACKEND. Rellena los mismos `desde`/`hasta` que la pantalla ya
 * tenia, asi que cualquier listado que ya filtre por rango lo acepta sin
 * cambiar una linea de servidor.
 *
 * Las fechas se calculan en la ZONA DEL NAVEGADOR y se mandan como
 * `YYYY-MM-DD`. Nada de `toISOString()`, que pasa por UTC: a las 23:00 en
 * España «hoy» saldria como el dia siguiente, y el usuario veria una lista
 * vacia sin entender por que.
 */

export type Rango = { from: string; to: string };

/** `YYYY-MM-DD` de una fecha local, sin pasar por UTC. */
function iso(d: Date): string {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

function calcular(clave: string): Rango {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  if (clave === 'hoy') return { from: iso(hoy), to: iso(hoy) };

  if (clave === 'ayer') {
    const a = new Date(hoy); a.setDate(a.getDate() - 1);
    return { from: iso(a), to: iso(a) };
  }

  if (clave === 'semana') {
    // La semana empieza en LUNES: en España nadie cuenta de domingo a sabado,
    // y getDay() devuelve 0 para el domingo, de ahi el ajuste.
    const desde = new Date(hoy);
    const dia = desde.getDay();
    desde.setDate(desde.getDate() - (dia === 0 ? 6 : dia - 1));
    return { from: iso(desde), to: iso(hoy) };
  }

  if (clave === 'mes') {
    return { from: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), to: iso(hoy) };
  }

  // Mes pasado: del 1 al ULTIMO dia, no hasta hoy. «El mes pasado» es un mes
  // cerrado; si terminara hoy, en dia 3 enseñaria tres dias y parecerian pocos.
  const primeroDelPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
  const ultimoDelPasado = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
  return { from: iso(primeroDelPasado), to: iso(ultimoDelPasado) };
}

const ATAJOS: { clave: string; texto: string }[] = [
  { clave: 'hoy', texto: 'Hoy' },
  { clave: 'ayer', texto: 'Ayer' },
  { clave: 'semana', texto: 'Esta semana' },
  { clave: 'mes', texto: 'Este mes' },
  { clave: 'pasado', texto: 'Mes pasado' },
];

export default function RangoRapido({
  valor,
  alElegir,
  className = '',
}: {
  valor: Rango;
  alElegir: (r: Rango) => void;
  className?: string;
}) {
  // Cual esta puesto. Se compara con lo que habria calculado cada atajo, asi
  // que tambien se enciende si las fechas se escribieron a mano y coinciden
  // --que es lo correcto: lo que importa es el rango, no como se puso--.
  const activo = useMemo(() => {
    if (!valor?.from || !valor?.to) return null;
    const hit = ATAJOS.find((a) => {
      const r = calcular(a.clave);
      return r.from === valor.from && r.to === valor.to;
    });
    return hit ? hit.clave : null;
  }, [valor?.from, valor?.to]);

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`} role="group" aria-label="Atajos de fecha">
      {ATAJOS.map((a) => {
        const puesto = activo === a.clave;
        return (
          <button
            key={a.clave}
            type="button"
            aria-pressed={puesto}
            onClick={() => alElegir(puesto ? { from: '', to: '' } : calcular(a.clave))}
            title={puesto ? 'Quitar este filtro' : undefined}
            className={
              'h-7 px-2.5 rounded-md border text-xs font-medium transition-colors '
              + (puesto
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted/60')
            }
          >
            {a.texto}
          </button>
        );
      })}
    </div>
  );
}
