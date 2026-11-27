import { cn } from '@/shared/lib/utils';

/*
  #791 (gemela de CRM#1135) · En qué está el diploma de un alumno, dicho igual en
  Diplomas › Pendientes y en la ficha del alumno: datos pedidos, contestados o emitido.

  Sale de la confirmación de datos del diploma (#768, `diploma_confirmaciones`). Las
  funciones son puras (se prueban sin pintar nada); los componentes solo las enseñan.
*/

export type EstadoConfirmacion = 'pendiente' | 'confirmado' | 'corregido' | 'vencido' | 'anulado';

/** Lo que trae cada fila de Pendientes (`confirmacion`, backend: `conConfirmacion`). */
export interface ConfirmacionDeDatos {
  estado: EstadoConfirmacion;
  pedidaEn: string | null;
  caducaEn: string | null;
  enviadaEn: string | null;
  simulado: boolean;
  envioError: string | null;
  respondidaEn: string | null;
  /** Corregida y aún sin pasar a Certifex: no se puede emitir todavía. */
  sinAplicar: boolean;
  aplicarError: string | null;
}

/** Una fila de `GET /leads/:id/diploma` (backend: `deLaFicha`). */
export interface DiplomaDeLaFicha {
  matricula_id: number;
  centro: string;
  project_id: number | null;
  campus: string | null;
  estado: EstadoConfirmacion;
  curso_nombre: string | null;
  pedido_at: string | null;
  caduca_at: string | null;
  enviado_at: string | null;
  envio_simulado: boolean;
  envio_error: string | null;
  respondido_at: string | null;
  aplicado_at: string | null;
  aplicar_error: string | null;
  nexpediente: string | null;
  emitido_at: string | null;
  diploma_enviado_at: string | null;
}

export type Tono = 'info' | 'success' | 'warning' | 'neutral';

export interface Lectura {
  /** Corto, para la etiqueta. */
  rotulo: string;
  tono: Tono;
  /** La frase entera: hasta cuándo, cuándo contestó, qué falta. */
  detalle: string;
  /** false = aún no se puede emitir por la confirmación (esperando o sin pasar a Certifex). */
  puedeEmitir: boolean;
}

/** «3 dic», en hora de Madrid (la de la oficina). */
export const dia = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' })
  : '—');

/** En qué está la confirmación de datos. */
export function leerConfirmacion(c: ConfirmacionDeDatos): Lectura {
  switch (c.estado) {
    case 'pendiente': {
      const correo = c.envioError
        ? ` El correo no salió: ${c.envioError}.`
        : c.simulado ? ' (Correo simulado: entorno de pruebas.)' : '';
      return {
        rotulo: 'Datos pedidos',
        tono: c.envioError ? 'warning' : 'info',
        detalle: `Se le pidieron los datos el ${dia(c.pedidaEn)}. Esperando al alumno hasta el ${dia(c.caducaEn)}; si no contesta, se podrá emitir con los datos actuales.${correo}`,
        puedeEmitir: false,
      };
    }
    case 'confirmado':
      return { rotulo: 'Datos confirmados', tono: 'success', detalle: `El alumno confirmó sus datos el ${dia(c.respondidaEn)}.`, puedeEmitir: true };
    case 'corregido':
      return c.sinAplicar
        ? {
          rotulo: 'Corregidos, sin pasar',
          tono: 'warning',
          detalle: `El alumno corrigió sus datos el ${dia(c.respondidaEn)}, pero aún no se han pasado a Certifex${c.aplicarError ? ` (${c.aplicarError})` : ''}.`,
          puedeEmitir: false,
        }
        : { rotulo: 'Datos corregidos', tono: 'success', detalle: `El alumno corrigió sus datos el ${dia(c.respondidaEn)}; ya están en Certifex.`, puedeEmitir: true };
    case 'vencido':
      return { rotulo: 'Plazo vencido', tono: 'neutral', detalle: 'No contestó en 7 días: el diploma sale con los datos actuales.', puedeEmitir: true };
    default:
      return { rotulo: 'Sin pedir', tono: 'neutral', detalle: 'No hay confirmación de datos viva.', puedeEmitir: true };
  }
}

/** En qué está el diploma en la ficha: emitido (y enviado), o lo que diga la confirmación. */
export function leerDiplomaDeLaFicha(f: DiplomaDeLaFicha): Lectura {
  if (f.nexpediente) {
    return {
      rotulo: 'Diploma emitido',
      tono: 'success',
      detalle: `${f.nexpediente}, emitido el ${dia(f.emitido_at)}. ${f.diploma_enviado_at ? `Enviado al alumno el ${dia(f.diploma_enviado_at)}.` : 'Aún no se le ha enviado.'}`,
      puedeEmitir: false,
    };
  }
  return leerConfirmacion({
    estado: f.estado,
    pedidaEn: f.pedido_at,
    caducaEn: f.caduca_at,
    enviadaEn: f.enviado_at,
    simulado: f.envio_simulado,
    envioError: f.envio_error,
    respondidaEn: f.respondido_at,
    sinAplicar: f.estado === 'corregido' && !f.aplicado_at,
    aplicarError: f.aplicar_error,
  });
}

const COLOR: Record<Tono, string> = {
  info: 'bg-info-soft text-info-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  success: 'bg-success-soft text-success-soft-foreground',
  neutral: 'bg-muted text-muted-foreground',
};

/** La etiqueta, con la frase entera al pasar por encima (y para el lector de pantalla). */
export function EtiquetaDiploma({ lectura, className }: { lectura: Lectura; className?: string }) {
  return (
    <span title={lectura.detalle} className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', COLOR[lectura.tono], className)}>
      {lectura.rotulo}
      <span className="sr-only">: {lectura.detalle}</span>
    </span>
  );
}
