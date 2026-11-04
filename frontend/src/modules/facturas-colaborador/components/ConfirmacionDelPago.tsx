import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { fechaHora, type FacturaDelMes } from '../api/facturasColaborador.api';

/*
  «Pago confirmado por el colaborador» en las listas de administración (Diego,
  04/11): el colaborador pulsa «He recibido el pago y lo confirmo» en el correo
  de «Factura pagada», y si quiere deja su opinión (1 a 5 y un comentario).
  Debajo de «Pagada», como la etiqueta del PDF debajo del estado.
*/

type Fila = Pick<FacturaDelMes, 'pagada_at'> & Partial<Pick<FacturaDelMes,
  'pago_confirmado_at' | 'pago_valoracion' | 'pago_comentario' | 'pago_no_recibido_at' | 'pago_no_recibido_comentario'>>;

export const estrellas = (n: number) => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export default function ConfirmacionDelPago({ f }: { f: Fila }) {
  if (!f.pagada_at) return null;
  // «No lo he recibido» (04/11), en aviso, mientras no confirme: si confirma, se cierra.
  if (!f.pago_confirmado_at && f.pago_no_recibido_at) {
    return (
      <div className="mt-1 text-xs">
        <span title={`Lo dijo el ${fechaHora(f.pago_no_recibido_at)}`}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap bg-destructive-soft text-destructive-soft-foreground">
          <WarningCircle size={12} weight="bold" aria-hidden="true" /> El colaborador dice que no lo ha recibido
        </span>
        {f.pago_no_recibido_comentario && (
          <div className="mt-0.5 text-muted-foreground max-w-[16rem] whitespace-normal line-clamp-2" title={f.pago_no_recibido_comentario}>
            «{f.pago_no_recibido_comentario}»
          </div>
        )}
      </div>
    );
  }
  if (!f.pago_confirmado_at) return null;
  const valoracion = f.pago_valoracion ? Number(f.pago_valoracion) : null;
  return (
    <div className="mt-1 text-xs">
      <span title={`Lo confirmó el ${fechaHora(f.pago_confirmado_at)}`}
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold whitespace-nowrap bg-success-soft text-success-soft-foreground">
        <CheckCircle size={12} weight="bold" aria-hidden="true" /> Pago confirmado por el colaborador
      </span>
      {(valoracion || f.pago_comentario) && (
        <div className="mt-0.5 text-muted-foreground max-w-[16rem] whitespace-normal" title={f.pago_comentario || undefined}>
          {valoracion && <span className="text-warning-soft-foreground" aria-label={`Valoración: ${valoracion} de 5`}>{estrellas(valoracion)}</span>}
          {f.pago_comentario && <span className="line-clamp-2"> «{f.pago_comentario}»</span>}
        </div>
      )}
    </div>
  );
}
