import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PaperPlaneTilt, FilePdf, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import usePermission from '@/shared/hooks/usePermission';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import { formatDateNumeric } from '@/shared/lib/format';
import { invoicesApi } from '@/modules/invoices/api/invoices.api';
import type { FacturaSola } from '../api/facturaAutomatica.api';

/*
  «POR ENVIAR» (Diego, 25/11; ISEIE con FACTURA_ENVIO_REVISION_ADMIN).

  La factura automática sale con su número y los datos que cargó la gestora,
  pero no se le manda al alumno: queda aquí. Administración la verifica (datos,
  importe, PDF y correo) y la envía. Cambiar los datos de la factura es la
  pantalla de Facturas de siempre; aquí solo se comprueba y se manda.
*/

const euros = (n: number | string) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

interface Props {
  facturas: FacturaSola[];
  rutaVenta: (id: number) => string;
  onEnviada: () => void;
}

export default function PorEnviar({ facturas, rutaVenta, onEnviada }: Props) {
  const { can } = usePermission();
  const puedeEnviar = can('facturas.envio_auto') && can('facturas.enviar');
  const [abierta, setAbierta] = useState<FacturaSola | null>(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);

  const abrir = (f: FacturaSola) => { setAbierta(f); setEmail(f.envio_email || ''); };

  async function enviar() {
    if (!abierta) return;
    const correo = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
      toast({ title: 'Ese correo no es válido', description: 'Revisa el correo al que va la factura.', variant: 'destructive' });
      return;
    }
    setEnviando(true);
    try {
      await invoicesApi.send(abierta.id, correo);
      toast({ title: `✓ Factura ${abierta.codigo} enviada`, description: `A ${correo}.` });
      setAbierta(null);
      onEnviada();
    } catch (err) {
      toast({ title: 'No se pudo enviar', description: (err as Error)?.message, variant: 'destructive' });
    } finally { setEnviando(false); }
  }

  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="fa-por-enviar">
      <h2 className="px-4 py-2.5 border-b border-border font-semibold text-sm flex items-center gap-2">
        <PaperPlaneTilt size={15} weight="bold" aria-hidden="true" /> Por enviar
        <span className="text-xs font-normal text-muted-foreground">· {facturas.length}</span>
      </h2>
      <p className="px-4 pt-2 text-xs text-muted-foreground">
        Facturas que salieron solas con los datos de la gestora y esperan a administración: verifica y envía.
      </p>
      {facturas.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No hay ninguna por enviar.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {facturas.map((f) => (
            <li key={f.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-mono text-[12px] font-semibold">{f.codigo}</span>
              <span className="text-[12px] text-muted-foreground">{formatDateNumeric(f.fecha)} · {f.campus}</span>
              {f.conversion_id
                ? <Link to={rutaVenta(f.conversion_id)} className="hover:underline">{f.cliente_nombre || '—'}</Link>
                : <span>{f.cliente_nombre || '—'}</span>}
              <span className="tabular-nums font-semibold">{euros(f.total)}</span>
              {puedeEnviar && (
                <button type="button" onClick={() => abrir(f)}
                  className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                  Verificar y enviar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {abierta && (
        <Portal>
          <div role="dialog" aria-modal="true" aria-labelledby="por-enviar-titulo" className="fixed inset-0 !m-0 z-[70] flex items-center justify-center p-4">
            <div className="fixed inset-0 !m-0 bg-black/50" onClick={() => setAbierta(null)} />
            <div className="relative bg-card rounded-lg border border-border w-full max-w-md p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 id="por-enviar-titulo" className="font-semibold">Verificar y enviar · {abierta.codigo}</h3>
                <button type="button" aria-label="Cerrar" onClick={() => setAbierta(null)}><X size={18} /></button>
              </div>
              <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Cliente</dt><dd>{abierta.cliente_nombre || '—'}</dd>
                <dt className="text-muted-foreground">Documento</dt><dd>{abierta.cliente_nif || <span className="text-warning-soft-foreground">sin documento</span>}</dd>
                <dt className="text-muted-foreground">Total</dt><dd className="tabular-nums font-semibold">{euros(abierta.total)}</dd>
                <dt className="text-muted-foreground">Fecha</dt><dd>{formatDateNumeric(abierta.fecha)} · {abierta.campus}</dd>
              </dl>
              <button type="button" onClick={() => invoicesApi.openPdf(abierta.id).catch((e: unknown) => toast({ title: 'No se pudo abrir el PDF', description: (e as Error)?.message, variant: 'destructive' }))}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-xs font-semibold">
                <FilePdf size={14} aria-hidden="true" /> Ver el PDF
              </button>
              <Field label="Enviar a este correo" htmlFor="por-enviar-email">
                <input id="por-enviar-email" type="email" autoComplete="off" className={inputClass}
                  value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              <p className="text-xs text-muted-foreground">
                Si algún dato está mal, corrígelo antes en la factura (Facturas) o en la venta.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setAbierta(null)} className="h-9 px-3 rounded-md border border-border text-sm">Cancelar</button>
                <button type="button" disabled={enviando} onClick={enviar}
                  className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
                  {enviando ? 'Enviando…' : 'Enviar factura'}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </section>
  );
}
