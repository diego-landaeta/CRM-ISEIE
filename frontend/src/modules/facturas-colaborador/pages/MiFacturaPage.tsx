import { useCallback, useEffect, useState } from 'react';
import { ArrowSquareOut, FileText, Receipt } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import SubirFactura from '../components/SubirFactura';
import {
  ESTADO, FORMA_PAGO_ES, avisoDelPdf, diaDelPago, euros, facturasColaboradorApi, primeraMayuscula, type FacturaDelColaborador, urlDelArchivo,
} from '../api/facturasColaborador.api';

/**
 * «Mi factura» (#202): el colaborador con usuario en el CRM ve sus meses, su
 * enlace y el estado de cada factura, y la sube desde aquí. Solo lo suyo: lo
 * comprueba el servidor. Y el estado del pago de cada mes (segunda parte).
 */
export default function MiFacturaPage() {
  const [meses, setMeses] = useState<FacturaDelColaborador[]>([]);
  const [cargando, setCargando] = useState(true);
  const [abierta, setAbierta] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await facturasColaboradorApi.mias();
      setMeses(r.data);
      // Se abre sola la primera que falta por subir.
      setAbierta((a) => a ?? r.data.find((m) => !['recibida', 'sin_factura', 'anulada', 'caducado'].includes(m.estado))?.id ?? null);
    } catch (err: any) {
      toast({ title: 'No se pudieron cargar tus facturas', description: err?.message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { void cargar(); }, [cargar]);

  async function verArchivo(id: number) {
    try {
      const r = await facturasColaboradorApi.archivoMio(id);
      window.open(urlDelArchivo(r.data.url), '_blank', 'noopener');
    } catch (err: any) {
      toast({ title: 'No se pudo abrir el archivo', description: err?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-3xl mx-auto">
      <PageHeader title="Mi factura" subtitle="Tus facturas del mes: súbelas aquí o desde el enlace del correo" />

      {meses.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={cargando ? 'Cargando…' : 'Todavía no tienes facturas que subir'}
          description="El último día de cada mes aparece aquí el mes que tienes que facturar."
        />
      ) : (
        <div className="space-y-3">
          {meses.map((m) => (
            <div key={m.id} className="bg-card border border-border rounded-lg">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{primeraMayuscula(m.mes)} · {m.empresa.razon_social}</p>
                  <p className="text-xs text-muted-foreground">
                    {m.recibida
                      ? `Recibida · ${m.recibida.numero_recepcion} · ${euros(m.recibida.importe, m.moneda)}`
                      : m.importe_acordado !== null ? `Acordado: ${euros(m.importe_acordado, m.moneda)}` : 'Sin importe acordado'}
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ESTADO[m.estado].clase}`}>
                  {m.estado === 'recibida' || m.estado === 'sin_factura' || m.estado === 'anulada' || m.estado === 'caducado' ? ESTADO[m.estado].rotulo : 'Pendiente'}
                </span>
                {/* El pago, aparte del estado de la factura: «Pagada 05/10 · Transferencia» o «Por pagar». */}
                {m.recibida && (m.pago ? (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-success-soft text-success-soft-foreground">
                    Pagada {diaDelPago(m.pago.pagada_at)}{m.pago.forma_pago ? ` · ${FORMA_PAGO_ES[m.pago.forma_pago]}` : ''}
                  </span>
                ) : (
                  <span className="rounded-full px-2.5 py-0.5 text-xs font-semibold bg-warning-soft text-warning-soft-foreground">Por pagar</span>
                ))}
                {m.recibida && (
                  <Button variant="outline" size="sm" onClick={() => verArchivo(m.id!)}>
                    <FileText size={13} className="mr-1.5" /> Ver archivo
                  </Button>
                )}
                {m.enlace && (
                  <a href={m.enlace} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-primary inline-flex items-center gap-1 underline underline-offset-2">
                    Tu enlace <ArrowSquareOut size={12} />
                  </a>
                )}
                {!m.recibida && m.estado !== 'sin_factura' && m.estado !== 'anulada' && m.estado !== 'caducado' && (
                  <Button size="sm" variant={abierta === m.id ? 'outline' : 'default'} onClick={() => setAbierta(abierta === m.id ? null : m.id!)}>
                    {abierta === m.id ? 'Cerrar' : 'Subir mi factura'}
                  </Button>
                )}
              </div>
              {/* Lo que dice el PDF frente a lo escrito (Diego, 13/10): si no cuadra o no se pudo leer. */}
              {m.recibida && avisoDelPdf(m.recibida, m.moneda) && (
                <p role="status" className={`border-t border-border px-4 py-2 text-xs ${
                  m.recibida.cuadra === false ? 'bg-warning-soft text-warning-soft-foreground' : 'bg-muted text-foreground'
                }`}>
                  {avisoDelPdf(m.recibida, m.moneda)}
                </p>
              )}
              {/* Montado aunque esté cerrado: al abrir otro mes (o «Cerrar») no se pierde lo que
                  ya había puesto —el archivo, el número, las horas—. Diana, prueba a mano del 12/10. */}
              {!m.recibida && m.estado !== 'sin_factura' && m.estado !== 'anulada' && m.estado !== 'caducado' && (
                <div className={abierta === m.id ? 'border-t border-border p-4' : 'hidden'}>
                  <SubirFactura
                    factura={m}
                    alSubir={async (archivo, importe, numero, desglose) => {
                      const r = await facturasColaboradorApi.subirMia(m.id!, archivo, importe, numero, desglose);
                      // Si el PDF no dice lo escrito, o no se pudo leer, se dice ya (y queda debajo del mes).
                      const aviso = r?.data?.recibida ? avisoDelPdf(r.data.recibida, r.data.moneda) : null;
                      toast({ title: 'Factura enviada', description: aviso || `${primeraMayuscula(m.mes)} · ${m.empresa.razon_social}` });
                      setAbierta(null);
                      await cargar();
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
