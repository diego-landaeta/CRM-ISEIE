import { euros, pdfFrenteAEscrito, type FacturaDelMes } from '../api/facturasColaborador.api';

/*
  La etiqueta del PDF en las listas de administración (#202). Corrección de
  Diego del 13/10: cuadra cuando el total que pone el PDF es el importe que
  escribió el colaborador.
  · «No cuadra», en aviso, con «PDF: 650,00 € · escrito: 636,00 €».
  · «PDF sin leer», neutra: no se pudo leer el importe (escaneado, roto, o una
    foto). No es «No cuadra»: hay que mirarlo a mano.
  · Si cuadra, nada.
  Debajo del estado, como «Pagada»: al lado no cabía la tabla en un portátil.
*/

type Fila = Pick<FacturaDelMes, 'estado' | 'subida_at' | 'cuadra' | 'importe_pdf' | 'importe' | 'total' | 'mime'> & Partial<Pick<FacturaDelMes, 'moneda'>>;

export default function EtiquetaDelPdf({ f }: { f: Fila }) {
  if (!f.subida_at || f.estado === 'anulada' || f.cuadra === true) return null;
  if (f.cuadra === false) {
    // Sin importe del PDF es una subida de antes del 13/10, cuando se comparaba con el desglose.
    const detalle = f.importe_pdf !== null && f.importe_pdf !== undefined
      ? pdfFrenteAEscrito(f.importe_pdf, f.importe, f.moneda)
      : `Escrito: ${euros(f.importe, f.moneda)} · el desglose da ${euros(f.total, f.moneda)} (regla anterior al 13/10)`;
    return (
      <div className="mt-0.5">
        <span title={detalle}
          className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap bg-warning-soft text-warning-soft-foreground">
          No cuadra
        </span>
      </div>
    );
  }
  const foto = Boolean(f.mime && f.mime.startsWith('image/'));
  const detalle = foto
    ? `Es una foto: el importe no se lee solo · escrito: ${euros(f.importe, f.moneda)}`
    : `No se pudo leer el importe del PDF · escrito: ${euros(f.importe, f.moneda)}`;
  return (
    <div className="mt-0.5">
      <span title={detalle}
        className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap bg-muted text-muted-foreground">
        {foto ? 'Foto sin leer' : 'PDF sin leer'}
      </span>
    </div>
  );
}
