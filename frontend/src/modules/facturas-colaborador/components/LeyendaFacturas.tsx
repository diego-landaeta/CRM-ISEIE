import { ArrowCounterClockwise, ClockCounterClockwise, FileText, HandCoins, PaperPlaneTilt, Prohibit, Receipt } from '@phosphor-icons/react';
import { ESTADO, type EstadoFactura } from '../api/facturasColaborador.api';

/*
  La leyenda de Facturas de colaboradores (#586, Diego 31/10: «una leyenda para
  ver qué significa cada cosa»). Los botones de cada fila solo tenían su texto al
  pasar el ratón, y en el móvil no se veía nada.

  Los iconos salen de aquí para la fila y para la leyenda: si uno cambia, la
  leyenda no se queda atrás. «Marcar pagada» ya no es una «€»: las facturas
  pueden ir en dólares (v2.5.14).
*/
export const ACCION = {
  archivo: { Icono: FileText, rotulo: 'Ver el archivo', explica: 'Abre la factura que subió, en PDF o en foto.' },
  registro: { Icono: ClockCounterClockwise, rotulo: 'Ver el registro', explica: 'Todo lo que ha pasado con ella: enviada, abierta, recibida, pagada…' },
  reenviar: { Icono: PaperPlaneTilt, rotulo: 'Reenviar el enlace', explica: 'Le manda un enlace nuevo para subirla. El anterior deja de valer.' },
  pagar: { Icono: HandCoins, rotulo: 'Marcar pagada', explica: 'Apunta el pago (fecha, forma y justificante) y se lo avisa.' },
  justificante: { Icono: Receipt, rotulo: 'Ver el justificante', explica: 'El comprobante del pago.' },
  deshacer: { Icono: ArrowCounterClockwise, rotulo: 'Deshacer el pago', explica: 'Quita la marca de pagada, con el motivo.' },
  anular: { Icono: Prohibit, rotulo: 'Anular', explica: 'Deja de valer. Se crea otra del mismo mes y se le manda su enlace.' },
} as const;
export type Accion = keyof typeof ACCION;

/** Qué quiere decir cada estado de la columna Factura (todos los de `ESTADO`). */
export const EXPLICA_ESTADO: Record<EstadoFactura, string> = {
  sin_enviar: 'Preparada, pero el correo con su enlace aún no ha salido.',
  enviado: 'Le llegó el correo con su enlace y todavía no lo ha abierto.',
  abierto: 'Abrió el enlace, pero aún no ha subido la factura.',
  recibida: 'Ya subió su factura.',
  sin_factura: 'Dijo desde el enlace que este mes no factura a esta empresa. No recibe el recordatorio.',
  anulada: 'Se anuló. En su lugar hay otra del mismo mes.',
  no_enviado: 'El correo no salió. Reenvía el enlace.',
  caducado: 'El enlace caducó sin que la subiera. Reenvía el enlace.',
};

const pildora = 'rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap';

/** Las otras marcas que salen en la fila, además del estado. */
const OTRAS = [
  { rotulo: 'Pagada 05/11', clase: 'bg-success-soft text-success-soft-foreground', explica: 'Pagada ese día; al pasar el ratón, la forma de pago y la referencia.' },
  { rotulo: 'Por pagar', clase: 'bg-warning-soft text-warning-soft-foreground', explica: 'Recibida y todavía sin pagar.' },
  { rotulo: 'No cuadra', clase: 'bg-warning-soft text-warning-soft-foreground', explica: 'El total del PDF no es el importe que escribió. Se recibió igual.' },
  { rotulo: 'PDF sin leer', clase: 'bg-muted text-muted-foreground', explica: 'No se pudo leer el importe del archivo (o es una foto): revísalo a mano.' },
];

export default function LeyendaFacturas({ conEnlace = false }: {
  /** «Del mes» tiene la columna Enlace; las demás pestañas, la de Pago. */
  conEnlace?: boolean;
}) {
  return (
    <details open className="rounded-lg border border-border bg-card px-4 py-3 text-sm" data-testid="leyenda-facturas">
      <summary className="cursor-pointer select-none font-semibold">Qué significa cada cosa</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <section className="min-w-0 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Los botones de cada fila</h3>
          <ul className="space-y-1.5">
            {(Object.keys(ACCION) as Accion[]).map((k) => {
              const { Icono, rotulo, explica } = ACCION[k];
              return (
                <li key={k} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-flex h-6 w-6 flex-none items-center justify-center rounded-md border border-border text-muted-foreground">
                    <Icono size={14} aria-hidden="true" />
                  </span>
                  <span className="min-w-0"><b>{rotulo}</b> <span className="text-muted-foreground">· {explica}</span></span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">Cada botón sale solo cuando se puede usar: por ejemplo, «Marcar pagada» solo con la factura recibida.</p>
        </section>
        <section className="min-w-0 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Columna Factura</h3>
          <ul className="space-y-1.5">
            {(Object.keys(ESTADO) as EstadoFactura[]).map((e) => (
              <li key={e} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={`${pildora} ${ESTADO[e].clase}`}>{ESTADO[e].rotulo}</span>
                <span className="text-muted-foreground">{EXPLICA_ESTADO[e]}</span>
              </li>
            ))}
            {OTRAS.map((o) => (
              <li key={o.rotulo} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={`${pildora} ${o.clase}`}>{o.rotulo}</span>
                <span className="text-muted-foreground">{o.explica}</span>
              </li>
            ))}
          </ul>
          {conEnlace && (
            <p className="text-xs text-muted-foreground">
              <b className="text-foreground">Columna Enlace:</b> «Enviado» y el día en que salió el correo, o «Abierto» y el día en que lo abrió. «—»: todavía no se ha enviado.
            </p>
          )}
        </section>
      </div>
    </details>
  );
}
