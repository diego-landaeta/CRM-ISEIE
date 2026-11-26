import { useEffect, useState } from 'react';
import { Receipt } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { facturaAutomaticaApi, type EnvioDeLaVenta } from '../api/facturaAutomatica.api';
import EnvioFacturaCampos, { aEnvioFactura, envioInicial, faltaConfirmar, type EnvioEnEdicion } from './EnvioFacturaCampos';

/*
  La factura automática de UNA venta (#764, 24/11), en su ficha.

  En qué está el formulario de datos fiscales, «Enviar factura automáticamente:
  Sí / No» y «Enviar a este correo». Cambiarlo vale para los cobros que falten
  (las cuotas reutilizan la elección). Si el formulario aún espera y el correo
  cambia, el servidor se lo manda de nuevo al correo bueno.

  Con la factura automática apagada en este servidor, y sin petición, no se pinta.
*/

const fecha = (t: string | null | undefined) => (t
  ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—');

const ESTADO: Record<string, string> = {
  pendiente: 'Formulario enviado: esperando sus datos',
  respondido: 'El alumno contestó el formulario',
  ficha: 'Sin respuesta en el plazo: se factura con su ficha',
  revision: 'En revisión: faltan datos válidos',
};

export default function FacturaAutomaticaVentaCard({ conversionId }: { conversionId: number }) {
  const { can } = usePermission();
  // Cambiar el envío: solo administración (25/11).
  const puedeEditar = can('facturas.envio_auto');
  const puedeReenviar = can('facturas.cola');
  const [datos, setDatos] = useState<EnvioDeLaVenta | null>(null);
  const [envio, setEnvio] = useState<EnvioEnEdicion | null>(null);
  const [guardando, setGuardando] = useState(false);

  function aplicar(d: EnvioDeLaVenta) {
    setDatos(d);
    setEnvio(envioInicial(d.email_ficha, { auto: d.auto, email: d.email, confirmado: d.confirmado, editando: false }));
  }

  useEffect(() => {
    let vivo = true;
    facturaAutomaticaApi.envio(conversionId)
      .then((r) => { if (vivo && r?.success && r.data) aplicar(r.data); })
      .catch(() => { /* sin el módulo o sin permiso: no se enseña */ });
    return () => { vivo = false; };
  }, [conversionId]);

  if (!datos || !envio || (!datos.activa && !datos.peticion)) return null;

  const cambiado = envio.auto !== datos.auto
    || (aEnvioFactura(envio, datos.email_ficha).email || null) !== (datos.email_efectivo || null)
    || (envio.confirmado && !datos.confirmado);

  async function guardar() {
    if (!envio || !datos) return;
    if (faltaConfirmar(envio, datos.email_ficha)) {
      toast({ title: 'Falta confirmar el correo', description: 'Pulsa «Confirmar» en «Enviar a este correo».', variant: 'destructive' });
      return;
    }
    setGuardando(true);
    try {
      const r = await facturaAutomaticaApi.guardarEnvio(conversionId, aEnvioFactura(envio, datos.email_ficha));
      if (r?.data) {
        aplicar({ ...datos, ...r.data });
        toast({
          title: 'Guardado',
          description: r.data.formulario_reenviado
            ? `El formulario de datos fiscales se ha mandado de nuevo a ${r.data.email_efectivo}.`
            : (r.data.auto ? 'La factura se le enviará al alumno en PDF.' : 'La factura se emitirá sin mandarla: la envías tú.'),
        });
      }
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  async function reenviar() {
    try {
      const r = await facturaAutomaticaApi.reenviar(conversionId);
      toast({ title: r?.data?.enviado ? 'Formulario enviado de nuevo' : 'No se pudo mandar el correo', variant: r?.data?.enviado ? undefined : 'destructive' });
      const d = await facturaAutomaticaApi.envio(conversionId);
      if (d?.data) aplicar(d.data);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo reenviar', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  const p = datos.peticion;
  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3 text-sm" data-recorrido="venta-factura-automatica">
      <h3 className="font-semibold flex items-center gap-1.5"><Receipt size={15} weight="bold" /> Factura automática</h3>
      {p ? (
        <div className="text-[12px] space-y-0.5">
          <p className="font-medium">{ESTADO[p.estado] || p.estado}</p>
          {p.enviado_a && <p className="text-muted-foreground">Formulario enviado a {p.enviado_a} · {fecha(p.enviado_at)}</p>}
          {p.estado === 'pendiente' && <p className="text-muted-foreground">Plazo hasta el {fecha(p.caduca_at)}</p>}
          {p.envio_error && <p className="text-destructive">El correo no salió: {p.envio_error}</p>}
          {p.motivo_revision && <p className="text-warning-soft-foreground">{p.motivo_revision}</p>}
          {puedeReenviar && ['pendiente', 'revision'].includes(p.estado) && (
            <button type="button" onClick={reenviar} className="mt-1 text-[12px] font-semibold text-primary hover:underline">
              Reenviar el formulario
            </button>
          )}
        </div>
      ) : (
        <p className="text-[12px] text-muted-foreground">Al entrar el primer cobro se le pide al alumno sus datos fiscales.</p>
      )}
      {puedeEditar ? (
        <>
          <EnvioFacturaCampos value={envio} onChange={setEnvio} emailFicha={datos.email_ficha} idBase={`envio-venta-${conversionId}`} compacto />
          {cambiado && (
            <div className="flex justify-end">
              <button type="button" onClick={guardar} disabled={guardando}
                className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold disabled:opacity-50">
                {guardando ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="text-[12px]">
          {datos.auto ? `Se envía sola a ${datos.email_efectivo || '—'}.` : `${datos.nota}.`}
        </p>
      )}
      {datos.confirmado_por && (
        <p className="text-[11px] text-muted-foreground">Elegido por {datos.confirmado_por} · {fecha(datos.confirmado_at)}</p>
      )}
    </div>
  );
}
