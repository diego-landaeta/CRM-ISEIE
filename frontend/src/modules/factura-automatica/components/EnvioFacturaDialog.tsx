import { useEffect, useRef, useState } from 'react';
import { toast } from '@/shared/hooks/useToast';
import { facturaAutomaticaApi, type EnvioDeLaVenta } from '../api/facturaAutomatica.api';
import EnvioFacturaCampos, { aEnvioFactura, envioInicial, faltaConfirmar, type EnvioEnEdicion } from './EnvioFacturaCampos';

/*
  «Enviar factura automáticamente» y el correo de una venta, desde la cola de
  facturación (#764, 24/11): el cobro espera ahí y la gestora decide antes de
  que salga la factura.
*/
export default function EnvioFacturaDialog({ conversionId, cliente, onClose, onGuardado }: {
  conversionId: number; cliente?: string | null; onClose: () => void; onGuardado?: (d: EnvioDeLaVenta) => void;
}) {
  const [datos, setDatos] = useState<EnvioDeLaVenta | null>(null);
  const [envio, setEnvio] = useState<EnvioEnEdicion | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Cerrar si no se puede leer, sin volver a pedirla cada vez que el padre se pinta.
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    facturaAutomaticaApi.envio(conversionId)
      .then((r) => {
        if (!r?.data) return;
        setDatos(r.data);
        setEnvio(envioInicial(r.data.email_ficha, { auto: r.data.auto, email: r.data.email, confirmado: r.data.confirmado, editando: false }));
      })
      .catch((err) => {
        toast({ title: 'No se pudo leer la venta', description: (err as Error)?.message, variant: 'destructive' });
        cerrar.current();
      });
  }, [conversionId]);

  async function guardar() {
    if (!datos || !envio) return;
    if (faltaConfirmar(envio, datos.email_ficha)) {
      toast({ title: 'Falta confirmar el correo', description: 'Pulsa «Confirmar» en «Enviar a este correo».', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await facturaAutomaticaApi.guardarEnvio(conversionId, aEnvioFactura(envio, datos.email_ficha));
      if (r?.data) {
        toast({
          title: 'Guardado',
          description: r.data.formulario_reenviado ? `Formulario mandado de nuevo a ${r.data.email_efectivo}.` : undefined,
        });
        onGuardado?.(r.data);
        onClose();
      }
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4" onClick={() => !guardando && onClose()}>
      <div role="dialog" aria-labelledby="envio-factura-titulo"
        className="bg-card rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <h3 id="envio-factura-titulo" className="font-semibold text-base">Envío de la factura</h3>
          {cliente && <p className="text-xs text-muted-foreground mt-0.5">{cliente}</p>}
        </div>
        <div className="p-4">
          {datos && envio
            ? <EnvioFacturaCampos value={envio} onChange={setEnvio} emailFicha={datos.email_ficha} idBase={`envio-cola-${conversionId}`} />
            : <p className="text-sm text-muted-foreground">Cargando…</p>}
        </div>
        <div className="p-3 border-t border-border flex justify-end gap-2 bg-muted/20">
          <button type="button" onClick={onClose} disabled={guardando} className="h-9 px-3 rounded-md border border-border bg-card text-sm">Cancelar</button>
          <button type="button" onClick={guardar} disabled={guardando || !datos}
            className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
