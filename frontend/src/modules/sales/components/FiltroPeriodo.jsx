import { useMemo, useState } from 'react';
import { CalendarBlank } from '@phosphor-icons/react';

// El periodo de la pantalla de Ventas, elegido una sola vez.
//
// Antes cada tarjeta traia el suyo: «Cursos vendidos» en Hoy, «Programas mas
// vendidos» en historico, el equipo clavado al mes y la seccion de abajo con
// otro selector. Con cuatro periodos a la vez los numeros de la misma pantalla
// no se pueden comparar entre si.

const OPCIONES = [
  { k: 'hoy', label: 'Hoy' },
  { k: 'semana', label: 'Semana' },
  { k: 'mes', label: 'Mes' },
  { k: '90d', label: '90 días' },
  { k: 'ytd', label: 'Año en curso' },
  { k: 'all', label: 'Todo 2026' },
];

const iso = (d) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export function rangoDe(clave) {
  const hoy = new Date();
  if (clave === 'hoy') return { from: iso(hoy), to: iso(hoy) };
  if (clave === 'semana') {
    const l = new Date(hoy);
    l.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7)); // lunes
    return { from: iso(l), to: iso(hoy) };
  }
  if (clave === 'mes') return { from: iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), to: iso(hoy) };
  if (clave === '90d') return { from: iso(new Date(hoy.getTime() - 90 * 86400000)), to: iso(hoy) };
  if (clave === 'ytd') return { from: `${hoy.getFullYear()}-01-01`, to: iso(hoy) };
  return { from: '2026-01-01', to: iso(hoy) };
}

// Las metas son mensuales. Si el rango cae dentro de un mes, ese; si no, el
// mes en curso, que es lo unico que tiene sentido para una meta.
export function mesDe(from, to) {
  if (from && to && from.slice(0, 7) === to.slice(0, 7)) return from.slice(0, 7);
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function FiltroPeriodo({ valor, onChange, desde, hasta, onFechas }) {
  const activo = !desde && !hasta;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {OPCIONES.map((o) => (
        <button
          key={o.k}
          type="button"
          onClick={() => { onFechas('', ''); onChange(o.k); }}
          className={`h-8 px-2.5 rounded-md text-[13px] font-medium border transition-colors ${
            activo && valor === o.k
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-card border-border hover:bg-muted'
          }`}
        >
          {o.label}
        </button>
      ))}
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground px-1">
        <CalendarBlank size={13} weight="bold" /> o entre fechas
      </span>
      <input
        type="date" value={desde} onChange={(e) => onFechas(e.target.value, hasta)} aria-label="Desde"
        className="h-8 px-2 rounded-md border border-border bg-card text-[13px]"
      />
      <input
        type="date" value={hasta} onChange={(e) => onFechas(desde, e.target.value)} aria-label="Hasta"
        className="h-8 px-2 rounded-md border border-border bg-card text-[13px]"
      />
      {(desde || hasta) && (
        <button
          type="button" onClick={() => onFechas('', '')}
          className="h-8 px-2 rounded-md text-xs text-muted-foreground hover:bg-muted"
        >
          Quitar
        </button>
      )}
    </div>
  );
}

// El rango que sale de todo lo anterior: las fechas a mano mandan sobre el boton.
export function useRango(clave, desde, hasta) {
  return useMemo(
    () => (desde && hasta ? { from: desde, to: hasta } : rangoDe(clave)),
    [clave, desde, hasta],
  );
}

export function useEstadoPeriodo(inicial = 'mes') {
  const [periodo, setPeriodo] = useState(inicial);
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const rango = useRango(periodo, desde, hasta);
  const onFechas = (d, h) => { setDesde(d); setHasta(h); };
  return { periodo, setPeriodo, desde, hasta, onFechas, rango, mes: mesDe(rango.from, rango.to) };
}
