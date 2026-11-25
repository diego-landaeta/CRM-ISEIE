import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Stamp, WarningCircle } from '@phosphor-icons/react';
import usePermission from '@/shared/hooks/usePermission';
import { apostillasApi, type Apostilla } from '../api/apostillas.api';
import { textoDelEstado, estaAtascada, diasTexto, eur, RUTA_APOSTILLAS } from '../lib/apostillas';
import BarraDePasos from './BarraDePasos';
import ApostillaDialog from './ApostillaDialog';

/*
  El bloque «Apostilla de La Haya» de la ficha del cliente y de la de la venta
  (CRM#1130 / CRM-ISEIE#786): si está pagada, en qué paso va y cuánto lleva en
  él. Al pulsar, se abre su ficha. Sin apostillas (o sin `apostillas.view`), no
  se pinta nada.
*/

interface Props { leadId?: number | null; conversionId?: number | null }

export default function ApostillasBloque({ leadId = null, conversionId = null }: Props) {
  const { can } = usePermission();
  const puedeVer = can('apostillas.view');
  const [filas, setFilas] = useState<Apostilla[]>([]);
  const [abierta, setAbierta] = useState<number | null>(null);

  const cargar = useCallback(() => {
    if (!puedeVer || (!leadId && !conversionId)) return () => {};
    let vivo = true;
    const pedir = conversionId ? apostillasApi.deVenta(conversionId) : apostillasApi.deCliente(leadId as number);
    pedir.then((r) => { if (vivo) setFilas(r?.data || []); }).catch(() => { /* sin la migración o sin permiso: nada */ });
    return () => { vivo = false; };
  }, [puedeVer, leadId, conversionId]);

  useEffect(() => cargar(), [cargar]);

  if (!filas.length) return null;

  return (
    <section className="bg-card border border-border rounded-lg p-4 space-y-3 text-sm" aria-label="Apostilla de La Haya">
      <h3 className="font-semibold flex items-center gap-1.5">
        <Stamp size={15} weight="bold" /> Apostilla de La Haya
      </h3>
      <ul className="space-y-2">
        {filas.map((a) => {
          const atascada = estaAtascada(a);
          return (
            <li key={a.id}>
              <button type="button" onClick={() => setAbierta(a.id)}
                className="w-full text-left rounded-md border border-border px-3 py-2 hover:bg-muted space-y-1.5">
                <span className="flex flex-wrap items-center justify-between gap-2 text-[12px]">
                  <span className="font-semibold">{textoDelEstado(a.estado)}</span>
                  <span className={a.pagada ? 'text-success font-medium' : 'text-warning-soft-foreground font-medium'}>
                    {a.pagada ? `Pagada · ${eur(a.importe)}` : `Cobrado ${eur(a.cobrado)} de ${eur(a.importe)}`}
                  </span>
                </span>
                <BarraDePasos estado={a.estado} diasEnEstado={a.dias_en_estado} atascada={atascada} compacta />
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {atascada && <WarningCircle size={12} weight="bold" className="text-warning" />}
                  {a.estado === 'entregada' || a.estado === 'cancelada'
                    ? `Desde hace ${diasTexto(a.dias_en_estado)}`
                    : `Lleva ${diasTexto(a.dias_en_estado)} en este paso`}
                  {a.formacion && ` · ${a.formacion}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Link to={RUTA_APOSTILLAS} className="text-[12px] text-primary hover:underline">Ver todas las apostillas</Link>
      {abierta && <ApostillaDialog id={abierta} onCerrar={() => setAbierta(null)} onCambio={cargar} />}
    </section>
  );
}
