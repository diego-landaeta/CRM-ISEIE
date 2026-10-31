import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Receipt } from '@phosphor-icons/react';
import SubirFactura from '../components/SubirFactura';
import { facturasColaboradorApi, type FacturaDelColaborador } from '../api/facturasColaborador.api';

/**
 * La página del enlace personal del colaborador (#202). Sin usuario ni
 * contraseña del CRM: el enlace del correo es la llave, y sirve solo para su
 * factura de ese mes y esa empresa.
 */
export default function FacturaEnlacePage() {
  const { token = '' } = useParams();
  const [factura, setFactura] = useState<FacturaDelColaborador | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const r = await facturasColaboradorApi.verEnlace(token);
      setFactura(r.data);
    } catch (err: any) {
      setError(err?.data?.error || err?.message || 'Este enlace no existe o ya no es válido');
    }
  }, [token]);

  useEffect(() => { void cargar(); }, [cargar]);

  return (
    <div className="min-h-screen bg-background flex items-start sm:items-center justify-center p-4">
      <div className="w-full max-w-xl bg-card border border-border rounded-xl shadow-sm p-5 sm:p-6 space-y-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Receipt size={16} /> Tu factura del mes
        </div>
        {error ? (
          <p role="alert" className="rounded-md bg-destructive-soft text-destructive-soft-foreground px-3 py-2">{error}</p>
        ) : !factura ? (
          <p className="text-muted-foreground">Cargando…</p>
        ) : (
          <SubirFactura
            factura={factura}
            alSubir={async (archivo, importe, numero, desglose) => {
              const r = await facturasColaboradorApi.subirPorEnlace(token, archivo, importe, numero, desglose);
              setFactura(r.data);
            }}
            alNoFacturar={async (motivo) => {
              const r = await facturasColaboradorApi.sinFacturaPorEnlace(token, motivo);
              setFactura(r.data);
            }}
            alDeshacerNoFacturar={async () => {
              const r = await facturasColaboradorApi.quitarSinFacturaPorEnlace(token);
              setFactura(r.data);
            }}
          />
        )}
      </div>
    </div>
  );
}
