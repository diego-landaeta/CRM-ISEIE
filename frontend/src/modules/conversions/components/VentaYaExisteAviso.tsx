import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Warning, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import { toast } from '@/shared/hooks/useToast';
import { useEscapeKey } from '@/shared/hooks/useDialogA11y';
import { formatCurrency } from '@/shared/lib/format';
import { conversionsApi, type Conversion } from '../api/conversions.api';
import PaymentDialog from './PaymentDialog';

/*
  «ESTE ALUMNO YA TIENE UNA VENTA DE ESTE PROGRAMA» (CRM#898).

  Casos reales del 18/11: la gestora creaba una venta nueva para la segunda
  cuota en vez de apuntar el cobro en la que ya había. El servidor responde
  409 VENTA_YA_EXISTE con esa venta; aquí se enseña y se ofrecen las dos
  salidas, por este orden:

    1. «Apuntar el cobro en esa venta»: abre el cobro de la venta que existe.
    2. «Crear otra venta igualmente»: reenvía con `forzar: true` y el servidor
       deja apuntado quién lo forzó.

  Mismo estilo que el aviso de factura posiblemente duplicada (#819) y el de
  cuota ya pagada (CRM#888). Lo usan el formulario de Ventas y el de la ficha.
*/

export interface VentaExistente {
  id: number;
  lead_id: number;
  alumno?: string | null;
  programa?: string | null;
  fecha?: string | null;
  total: number;
  cobrado: number;
  pendiente: number;
  motivo?: 'mismo_prospecto' | 'mismo_correo' | 'mismo_nombre';
  otras?: number;
}

/** La venta que ya existe, si el error es un 409 VENTA_YA_EXISTE; si no, null. */
export function ventaYaExistente(err: unknown): VentaExistente | null {
  const e = err as { data?: { code?: string; data?: { venta?: VentaExistente } } };
  return e?.data?.code === 'VENTA_YA_EXISTE' && e.data.data?.venta ? e.data.data.venta : null;
}

const POR_QUE: Record<string, string> = {
  mismo_prospecto: 'Es el mismo prospecto.',
  mismo_correo: 'Otro prospecto con el mismo correo.',
  mismo_nombre: 'Otro prospecto con el mismo nombre.',
};

interface Props {
  venta: VentaExistente | null;
  /** Cerrar el aviso sin hacer nada (se vuelve al formulario). */
  onCancelar: () => void;
  /** Reenviar el alta con `forzar: true`. */
  onCrearIgualmente: () => void | Promise<void>;
  /** Se apuntó el cobro en la venta que existía: el formulario ya no hace falta. */
  onCobroApuntado?: () => void;
  /**
   * Apuntar el cobro a su manera, en vez de abrir el formulario de cobro. Lo usa
   * Conciliación (CRM#906): el cobro es el de un cargo de Stripe, y se apunta
   * enlazando ese cargo con la venta que existe.
   */
  onApuntarCobro?: (venta: VentaExistente) => Promise<void>;
}

export default function VentaYaExisteAviso({ venta, onCancelar, onCrearIgualmente, onCobroApuntado, onApuntarCobro }: Props) {
  const [conversion, setConversion] = useState<Conversion | null>(null);
  const [cargando, setCargando] = useState(false);
  const [creando, setCreando] = useState(false);
  useEscapeKey(onCancelar, !!venta && !conversion);

  if (!venta) return null;

  async function apuntarCobro() {
    setCargando(true);
    try {
      if (onApuntarCobro) {
        await onApuntarCobro(venta!);
        onCobroApuntado?.();
        return;
      }
      const r = await conversionsApi.getById(venta!.id);
      if (!r?.data) throw new Error('No se encontró la venta');
      setConversion(r.data);
    } catch (err: any) {
      toast({ title: onApuntarCobro ? 'No se pudo apuntar el cobro' : 'No se pudo abrir esa venta', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setCargando(false);
    }
  }

  async function crearIgualmente() {
    setCreando(true);
    try { await onCrearIgualmente(); } finally { setCreando(false); }
  }

  if (conversion) {
    return (
      <PaymentDialog
        open
        conversion={conversion}
        onClose={() => setConversion(null)}
        onPaid={() => { setConversion(null); onCobroApuntado?.(); }}
      />
    );
  }

  return (
    <Portal>
      <div role="alertdialog" aria-modal="true" aria-labelledby="venta-ya-existe-titulo"
        className="fixed inset-0 !m-0 z-[90] flex items-center justify-center p-4">
        <div className="fixed inset-0 !m-0 bg-black/50 backdrop-blur-sm" onClick={onCancelar} />
        <div className="relative bg-card rounded-lg border border-amber-300 dark:border-amber-800 w-full max-w-md p-5 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center flex-shrink-0">
              <Warning size={18} weight="bold" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 id="venta-ya-existe-titulo" className="font-semibold text-base">
                Este alumno ya tiene una venta de este programa
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                (total {formatCurrency(venta.total)}, pendiente {formatCurrency(venta.pendiente)})
              </p>
            </div>
            <button type="button" onClick={onCancelar} aria-label="Cerrar" className="p-1 rounded hover:bg-muted text-muted-foreground">
              <X size={18} />
            </button>
          </div>

          <div className="bg-muted/50 rounded-md p-3 text-sm space-y-1">
            {venta.alumno && <div><span className="text-muted-foreground">Alumno:</span> {venta.alumno}</div>}
            {venta.programa && <div><span className="text-muted-foreground">Programa:</span> {venta.programa}</div>}
            {venta.fecha && <div><span className="text-muted-foreground">Venta del</span> {venta.fecha}</div>}
            <div className="tabular-nums">
              <span className="text-muted-foreground">Cobrado:</span> {formatCurrency(venta.cobrado)} de {formatCurrency(venta.total)}
            </div>
            {venta.motivo && POR_QUE[venta.motivo] && <div className="text-xs text-muted-foreground">{POR_QUE[venta.motivo]}</div>}
            {!!venta.otras && venta.otras > 0 && (
              <div className="text-xs text-amber-700 dark:text-amber-400">Y {venta.otras} venta{venta.otras === 1 ? '' : 's'} más del mismo programa.</div>
            )}
            <Link to={`/ventas/${venta.id}`} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
              Ver esa venta
            </Link>
          </div>

          <p className="text-sm">
            Si es una cuota o un pago más de la misma compra, apúntalo en esa venta. Crea otra solo si el alumno ha comprado el programa otra vez.
          </p>

          <div className="flex flex-col gap-2">
            <button type="button" onClick={apuntarCobro} disabled={cargando || creando}
              className="h-9 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {cargando ? 'Abriendo…' : 'Apuntar el cobro en esa venta'}
            </button>
            <button type="button" onClick={crearIgualmente} disabled={cargando || creando}
              className="h-9 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50">
              {creando ? 'Creando…' : 'Crear otra venta igualmente'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
