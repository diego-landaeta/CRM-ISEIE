/*
  Lo que el profesional tiene que facturar.

  Diego, 14/09/2026: «necesito el cálculo que el profesional me tiene que enviar,
  que sería la cantidad de 17,82 € + 21 % de 17,82 € (3,74 €) − retención del
  15 % (2,67 €) = 18,89 €».

  La base es el TOTAL DEL MES de ese tutor, no una línea suelta.

  Se redondea CADA LÍNEA a dos decimales, no el resultado: con 17,82 € el IVA es
  3,7422 y la retención 2,673, y redondear al final da un céntimo distinto del
  que el tutor va a escribir en su factura. Un céntimo de diferencia es una
  factura que no cuadra y una conversación.

  Vive aquí, y no dentro de la pantalla de Comisiones, porque lo ven dos: quien
  paga —en la fila del cobro— y el propio tutor en «Mis cursos». Diego: «el
  tutor debe ver ese cuadro de él y sus recaudos». Y es lo que hay que meter en
  el correo de «Avisar tutor» cuando se haga.
*/

const IVA = 0.21;
const IRPF = 0.15;
const dos = (n: number) => Math.round(n * 100) / 100;

export function loQueFactura(base: number) {
  const iva = dos(base * IVA);
  const retencion = dos(base * IRPF);
  return { base: dos(base), iva, retencion, total: dos(dos(base) + iva - retencion) };
}

const euros = (n: number) =>
  n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

export default function LoQueFactura({
  base, titulo = 'Lo que tiene que facturar', className = '',
}: {
  base: number;
  titulo?: string;
  className?: string;
}) {
  if (!(base > 0)) return null;
  const f = loQueFactura(base);
  return (
    <div className={`rounded-md border border-border bg-muted/30 p-3 ${className}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">{titulo}</p>
      <dl className="space-y-1 text-xs max-w-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">Comisión</dt>
          <dd className="tabular-nums font-semibold">{euros(f.base)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">+ IVA (21 %)</dt>
          <dd className="tabular-nums">{euros(f.iva)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">− retención IRPF (15 %)</dt>
          <dd className="tabular-nums">−{euros(f.retencion)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-1 mt-1">
          <dt className="font-semibold">Total a facturar</dt>
          <dd className="tabular-nums font-bold text-sm">{euros(f.total)}</dd>
        </div>
      </dl>
      <ul className="mt-2 space-y-0.5 text-[11px] text-muted-foreground">
        <li>— Comisión sujeta a IVA (21 %).</li>
        <li>— Retención de IRPF orientativa: cada profesional aplica la suya; el 15 % es la más común.</li>
      </ul>
    </div>
  );
}
