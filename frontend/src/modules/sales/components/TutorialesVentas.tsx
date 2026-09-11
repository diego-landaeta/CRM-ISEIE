import { useEffect, useState } from 'react';
import {
  X, UsersThree, Tag, CalendarBlank, Buildings, Receipt, ChartBar, CaretRight,
} from '@phosphor-icons/react';
// El tipo de los propios iconos. Escribirlo a mano salia mas estrecho que el
// suyo --su `size` admite texto ademas de numero-- y TypeScript lo rechazaba.
import type { Icon } from '@phosphor-icons/react';

/**
 * Los tutoriales de la pantalla de Ventas.
 *
 * Diego: «haz un tutorial en ventas que tenga varios y ponga tutorial y
 * tutorial de ventas divididas y así».
 *
 * Cada uno explica UNA cosa de esta pantalla y por qué está hecha así. No es
 * documentación de la aplicación entera: es lo que hace falta saber para no
 * malinterpretar los números que se están viendo — que es de donde salen casi
 * todas las dudas.
 */

interface Tutorial {
  id: string;
  titulo: string;
  resumen: string;
  icono: Icon;
  color: string;
  pasos: { que: string; detalle: string }[];
  ojo?: string;
}

const TUTORIALES: Tutorial[] = [
  {
    id: 'divididas',
    titulo: 'Ventas divididas',
    resumen: 'Dos gestoras atendieron a la misma persona: cómo repartir el mérito.',
    icono: UsersThree,
    color: 'text-violet-600 bg-violet-50 dark:bg-violet-950/40 dark:text-violet-300',
    pasos: [
      {
        que: 'Quién puede repartir',
        detalle: 'Solo admin y superadmin. La gestora registra la venta como siempre y ve el reparto, pero no lo cambia.',
      },
      {
        que: 'Cómo se hace',
        detalle: 'Entra en la venta y pulsa «Repartir venta». Sale 50/50 con la vendedora actual ya puesta. Puedes cambiar los porcentajes o añadir hasta cinco personas; tienen que sumar 100%.',
      },
      {
        que: 'Qué pasa con los números',
        detalle: 'La venta sigue siendo UNA para la empresa. Lo que se parte es lo que cuenta cada gestora: media venta y medio importe. Por eso en el equipo puedes ver 2,5 y 3,5 — y la suma sigue cuadrando con la tarjeta de arriba.',
      },
      {
        que: 'Dónde se nota',
        detalle: 'En el equipo aparece «1 compartida» debajo del número. En la lista, la fila lleva la etiqueta A MEDIAS. Y en los reportes por gestora, igual: media venta para cada una.',
      },
      {
        que: 'Deshacerlo',
        detalle: 'Desde la misma ficha, «Deshacer el reparto». La venta vuelve entera a su vendedora.',
      },
    ],
    ojo: 'Cada reparto queda registrado con quién lo hizo y cuándo, y deja una nota en la ficha del prospecto. Mueve el mérito de una persona a otra, así que tiene que poder mirarse después.',
  },
  {
    id: 'venta-cuota',
    titulo: 'Qué es VENTA y qué es CUOTA',
    resumen: 'Las etiquetas de cada fila de la lista, y por qué una venta puede salir dos veces.',
    icono: Tag,
    color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300',
    pasos: [
      { que: 'VENTA', detalle: 'Una venta nueva registrada en el periodo que estás mirando. Es dinero nuevo que entra.' },
      { que: 'CUOTA', detalle: 'Una mensualidad cobrada en el periodo, de una venta que puede ser de hace meses. Aparece con su número de factura, o «sin factura» si todavía no se ha emitido.' },
      { que: 'MISMA VENTA', detalle: 'Una segunda factura de una venta que ya está en la lista — se partió el cobro en dos. No es una venta más: si la contaras aparte, estarías duplicando.' },
      { que: 'A MEDIAS', detalle: 'La venta se atendió entre dos gestoras. Cada una suma su parte (ver el tutorial de ventas divididas).' },
    ],
    ojo: 'Si sumas las filas de la lista NO te da el total de ventas: la lista mezcla ventas y cuotas a propósito, para que veas todo el dinero del periodo. El número de ventas es el de la tarjeta de arriba.',
  },
  {
    id: 'fechas',
    titulo: 'Los filtros de fecha',
    resumen: 'Por defecto este mes, y qué significa exactamente cada atajo.',
    icono: CalendarBlank,
    color: 'text-sky-600 bg-sky-50 dark:bg-sky-950/40 dark:text-sky-300',
    pasos: [
      { que: 'Al entrar', detalle: 'La pantalla abre siempre con el mes en curso, del día 1 a hoy.' },
      { que: 'Esta semana', detalle: 'De LUNES a HOY. No los últimos siete días, y no llega hasta el domingo: enseñar días que aún no han pasado hace parecer que la semana va peor de lo que va.' },
      { que: 'Semana pasada', detalle: 'De lunes a domingo de la semana anterior, completa.' },
      { que: 'Este mes / Mes pasado', detalle: 'Del día 1 a hoy, y el mes anterior entero.' },
      { que: 'Fechas a mano', detalle: 'Puedes poner el rango que quieras. El título del equipo dice siempre lo que de verdad se está contando, no el mes.' },
    ],
  },
  {
    id: 'tarjetas',
    titulo: 'Las tarjetas de arriba',
    resumen: 'Qué cuenta cada una y por qué no son la misma cifra.',
    icono: ChartBar,
    color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-300',
    pasos: [
      { que: 'Ventas', detalle: 'Ventas nuevas registradas en el periodo, por fecha de venta.' },
      { que: 'Cuotas cobradas', detalle: 'Mensualidades cobradas en el periodo, vengan de la venta que vengan. Una venta de marzo que paga en septiembre cuenta aquí, no en Ventas.' },
      { que: 'Ventas por facturas', detalle: 'Lo mismo mirado desde Facturación. Al pasar el ratón te dice cuántas están facturadas y cuántas no.' },
      { que: 'Importe vendido / Cobrado', detalle: 'Lo que se vendió en el periodo, y lo que de eso ya ha entrado. No tienen por qué coincidir: una venta a plazos se cobra durante meses.' },
    ],
    ojo: 'Que Ventas y Facturación den cifras distintas casi siempre significa que estás comparando fechas distintas: la venta se cuenta el día que se vende, la factura el día que se emite.',
  },
  {
    id: 'empresa',
    titulo: 'Empresa y proyecto',
    resumen: 'Ver una sociedad entera o un solo campus.',
    icono: Buildings,
    color: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300',
    pasos: [
      { que: 'Elegir empresa', detalle: 'Enseña todos sus campus juntos, y debajo el reparto de ventas y cuotas proyecto por proyecto.' },
      { que: 'Elegir un proyecto', detalle: 'Solo ese. El equipo enseña únicamente a quien recibe leads ahí — o a quien haya vendido, aunque ya no reciba.' },
      { que: 'Todos', detalle: 'Todo menos el proyecto de pruebas: cinco ventas inventadas no pueden aparecer en el total de nadie.' },
    ],
  },
  {
    id: 'sin-factura',
    titulo: 'Por qué una venta no tiene factura',
    resumen: 'Tres motivos distintos, y solo uno es un problema.',
    icono: Receipt,
    color: 'text-rose-600 bg-rose-50 dark:bg-rose-950/40 dark:text-rose-300',
    pasos: [
      { que: 'No la requiere', detalle: 'Marcada como que no lleva factura. Es lo normal en ventas antiguas o facturadas por otra vía.' },
      { que: 'Importe cero', detalle: 'Una ficha sin importe: no hay nada que facturar.' },
      { que: 'Pendiente de facturar', detalle: 'Esta sí. Tiene importe, requiere factura y no se ha emitido. Es la que hay que mirar, y la franja azul te lleva a ellas con «Ver cuáles son».' },
    ],
    ojo: 'Un cobro que ya tiene factura emitida no se puede borrar: hay que anular la factura o emitir una rectificativa. El CRM te lo dice con el número de la factura.',
  },
];

export default function TutorialesVentas({ onCerrar }: { onCerrar: () => void }) {
  const [activo, setActivo] = useState(TUTORIALES[0].id);
  const t = TUTORIALES.find((x) => x.id === activo) || TUTORIALES[0];

  useEffect(() => {
    function alEscape(e: KeyboardEvent) { if (e.key === 'Escape') onCerrar(); }
    document.addEventListener('keydown', alEscape);
    return () => document.removeEventListener('keydown', alEscape);
  }, [onCerrar]);

  return (
    <div role="dialog" aria-modal="true" aria-label="Tutoriales de Ventas"
      className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onCerrar} aria-hidden="true" />
      <div className="relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-card shadow-xl sm:max-w-4xl sm:rounded-lg">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Tutoriales de Ventas</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Cómo leer esta pantalla sin malinterpretar los números
            </p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar"
            className="rounded p-1 hover:bg-muted"><X size={18} /></button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
          {/* La lista. En movil va arriba y se desliza en horizontal. */}
          <nav className="flex gap-2 overflow-x-auto border-b border-border p-3 md:w-64 md:flex-shrink-0 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r">
            {TUTORIALES.map((x) => {
              const Icono = x.icono;
              const esActivo = x.id === activo;
              return (
                <button
                  key={x.id}
                  type="button"
                  onClick={() => setActivo(x.id)}
                  className={`flex flex-shrink-0 items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors md:flex-shrink ${
                    esActivo ? 'bg-muted font-semibold' : 'hover:bg-muted/60'}`}
                >
                  <span className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded ${x.color}`}>
                    <Icono size={15} weight="duotone" />
                  </span>
                  <span className="whitespace-nowrap md:whitespace-normal">{x.titulo}</span>
                  {esActivo && <CaretRight size={12} weight="bold" className="ml-auto hidden md:block" />}
                </button>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-5">
            <h3 className="text-lg font-semibold">{t.titulo}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{t.resumen}</p>

            <ol className="mt-4 space-y-3">
              {t.pasos.map((p, i) => (
                <li key={p.que} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-bold tabular-nums">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{p.que}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">{p.detalle}</p>
                  </div>
                </li>
              ))}
            </ol>

            {t.ojo && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  Ojo con esto
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-amber-900 dark:text-amber-100">{t.ojo}</p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-border p-3">
          <button type="button" onClick={onCerrar}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
