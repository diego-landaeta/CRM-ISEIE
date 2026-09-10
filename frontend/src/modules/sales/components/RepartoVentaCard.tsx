import { useCallback, useEffect, useState } from 'react';
import { UsersThree } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import DialogoRepartoVenta, { eur, type Reparto } from './DialogoRepartoVenta';

/**
 * «Esta venta la atendimos entre dos», en la ficha de la venta.
 *
 * Diego: «hay casos que dos gestoras atienden a una persona y vende, y hay que
 * compartirlo, mitad y mitad».
 *
 * QUIEN PUEDE. Verlo, cualquiera: la gestora tiene derecho a saber cómo se
 * repartió su venta. Cambiarlo, solo admin y superadmin — y el backend lo
 * vuelve a comprobar, esto de aquí es únicamente para no enseñar un botón que
 * va a dar 403.
 *
 * QUE PASA CON LOS NUMEROS. La venta sigue siendo UNA para la empresa. Lo que
 * se parte es lo que cuenta cada gestora: media venta y medio importe. Por eso
 * en el equipo pueden salir 2,5 ventas y la suma sigue cuadrando con el total.
 */
export default function RepartoVentaCard({ conversionId }: { conversionId: number | string }) {
  const { user } = useAuth();
  const puedeRepartir = user?.role === 'admin' || user?.role === 'superadmin';

  const [data, setData] = useState<Reparto | null>(null);
  const [cargando, setCargando] = useState(true);
  const [abierto, setAbierto] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await client.get<Reparto>(`/conversions/${conversionId}/reparto`);
      if (res.success) setData(res.data);
    } catch {
      // Una venta sin reparto no es un error que haya que gritar: la tarjeta
      // simplemente no aparece.
    } finally { setCargando(false); }
  }, [conversionId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function deshacer() {
    try {
      await client.delete(`/conversions/${conversionId}/reparto`);
      toast({ title: 'Reparto deshecho', description: 'La venta vuelve entera a su vendedora.' });
      cargar();
    } catch (err) {
      toast({
        title: 'No se pudo deshacer',
        description: (err as { message?: string })?.message || '',
        variant: 'destructive',
      });
    }
  }

  if (cargando || !data) return null;

  return (
    <>
      <div className="bg-card border border-border rounded-lg p-4 text-sm">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <UsersThree size={16} weight="duotone" className="text-violet-600" />
            Vendedoras
          </h3>
          {puedeRepartir && (
            <button
              type="button"
              onClick={() => setAbierto(true)}
              className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted"
            >
              {data.compartida ? 'Cambiar reparto' : 'Repartir venta'}
            </button>
          )}
        </div>

        {!data.compartida ? (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Vendedora</span>
              <span className="font-medium">{data.titular?.nombre || '—'}</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              La venta cuenta entera para {data.titular?.nombre || 'su vendedora'}.
            </p>
          </>
        ) : (
          <>
            <ul className="space-y-2">
              {data.partes.map((p) => (
                <li key={p.user_id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate font-medium">{p.nombre}</span>
                  <span className="flex items-center gap-2 tabular-nums whitespace-nowrap">
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                      {p.porcentaje}%
                    </span>
                    <span className="text-muted-foreground">{eur(p.importe)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {data.nota && (
              <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground whitespace-pre-line">
                {data.nota}
              </p>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">
              {data.repartida_por ? `Repartida por ${data.repartida_por}` : 'Venta repartida'}
              {data.repartida_el ? ` · ${new Date(data.repartida_el).toLocaleDateString('es-ES')}` : ''}
              {' · '}cada una suma su parte en Ventas.
            </p>
            {puedeRepartir && (
              <button
                type="button"
                onClick={deshacer}
                className="mt-2 text-[11px] font-medium text-red-600 hover:underline dark:text-red-400"
              >
                Deshacer el reparto
              </button>
            )}
          </>
        )}
      </div>

      {abierto && (
        <DialogoRepartoVenta
          data={data}
          onCerrar={() => setAbierto(false)}
          onGuardado={() => { setAbierto(false); cargar(); }}
        />
      )}
    </>
  );
}
