import { useState } from 'react';
import { UsersThree, X, CaretRight } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import DialogoRepartoVenta, { eur, type Reparto } from './DialogoRepartoVenta';

/**
 * «Compartir» desde la ficha del prospecto.
 *
 * Diego: «debe de salir un botón para compartir porque no es nada intuitivo».
 * Repartir una venta ya se podía, pero solo entrando a la ficha de la venta, y
 * nadie llegaba ahí. Aquí está al lado de «Reasignar», que es su pareja
 * natural: reasignar es pasársela a otra, compartir es atenderla entre dos.
 *
 * No duplica nada: abre el MISMO diálogo de reparto. Lo único que hace de más
 * es encontrar la venta del prospecto — y preguntar cuál si tiene varias.
 */

interface VentaDelLead {
  id: number;
  fecha_conversion: string;
  producto_contratado: string | null;
  importe_total: string | number;
}

export default function CompartirVentaBoton({ leadId }: { leadId: number }) {
  const [cargando, setCargando] = useState(false);
  const [aElegir, setAElegir] = useState<VentaDelLead[] | null>(null);
  const [reparto, setReparto] = useState<Reparto | null>(null);

  async function abrirReparto(conversionId: number) {
    try {
      const r = await client.get<Reparto>(`/conversions/${conversionId}/reparto`);
      if (r.success) { setAElegir(null); setReparto(r.data); }
    } catch (err) {
      toast({
        title: 'No se pudo abrir el reparto',
        description: (err as { message?: string })?.message || '',
        variant: 'destructive',
      });
    }
  }

  async function alPulsar() {
    setCargando(true);
    try {
      const r = await client.get<VentaDelLead[]>(`/conversions/by-lead/${leadId}`);
      const ventas = r.success ? (r.data || []) : [];
      if (ventas.length === 0) {
        // Sin venta no hay nada que repartir: se dice, no se abre un diálogo vacío.
        toast({
          title: 'Todavía no hay venta',
          description: 'Este prospecto no tiene ninguna venta registrada, así que no hay nada que repartir.',
        });
      } else if (ventas.length === 1) {
        await abrirReparto(ventas[0].id);
      } else {
        setAElegir(ventas);
      }
    } catch (err) {
      toast({
        title: 'No se pudieron cargar sus ventas',
        description: (err as { message?: string })?.message || '',
        variant: 'destructive',
      });
    } finally { setCargando(false); }
  }

  return (
    <>
      <button
        onClick={alPulsar}
        disabled={cargando}
        aria-label="Compartir la venta con otra gestora"
        title="Atendida entre dos: repartir la venta"
        className="h-9 px-3 rounded-lg border border-border bg-secondary text-sm font-medium hover:bg-muted transition-colors flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2 disabled:opacity-50"
      >
        <UsersThree size={14} weight="bold" className="text-violet-600" />
        <span className="hidden sm:inline">{cargando ? 'Abriendo…' : 'Compartir'}</span>
      </button>

      {aElegir && (
        <div role="dialog" aria-modal="true" aria-label="Elegir la venta a repartir"
          className="fixed inset-0 z-[70] flex items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setAElegir(null)} aria-hidden="true" />
          <div className="relative z-10 flex max-h-full w-full flex-col overflow-hidden rounded-none border border-border bg-card shadow-xl sm:max-w-md sm:rounded-lg">
            <div className="flex items-start justify-between gap-3 border-b border-border p-4">
              <div>
                <h2 className="text-base font-semibold">¿Cuál de sus ventas?</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Este prospecto tiene {aElegir.length} ventas. El reparto es de una sola.
                </p>
              </div>
              <button type="button" onClick={() => setAElegir(null)} aria-label="Cerrar"
                className="rounded p-1 hover:bg-muted"><X size={18} /></button>
            </div>
            <ul className="divide-y divide-border overflow-y-auto">
              {aElegir.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => abrirReparto(v.id)}
                    className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{v.producto_contratado || 'Sin producto'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {v.fecha_conversion ? new Date(v.fecha_conversion).toLocaleDateString('es-ES') : '--'}
                        {' · '}{eur(Number(v.importe_total))}
                      </p>
                    </div>
                    <CaretRight size={14} weight="bold" className="flex-shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {reparto && (
        <DialogoRepartoVenta
          data={reparto}
          onCerrar={() => setReparto(null)}
          onGuardado={() => setReparto(null)}
        />
      )}
    </>
  );
}
