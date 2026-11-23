import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PauseCircle, CheckCircle, ArrowClockwise, CaretDown, CaretUp } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';

/*
  FACTURACIÓN PAUSADA POR LA AUDITORÍA (#765).

  La auditoría de cada 2 horas ha encontrado un error y ha parado la emisión de
  facturas nuevas. Este aviso se queda arriba, en todas las pantallas, para
  superadmin y admin (`facturas.auditoria`) hasta que se resuelva.

  «Marcar como solucionado» vuelve a pasar la auditoría en el servidor: solo
  reanuda si sale limpia, y entonces emite en orden de cobro lo que entró
  durante la pausa. Si sigue habiendo errores, se dicen y la pausa sigue.

  Con el interruptor apagado (`FACTURACION_AUDITORIA_ACTIVA`) el servidor
  contesta `activa: false` y aquí no se pinta nada.
*/

type Incidencia = { tipo: string; serie?: string | null; texto: string };
type Estado = {
  activa: boolean;
  pausada?: boolean;
  dias?: number;
  pausa?: { id: number; pausada_at: string; motivo: string; incidencias: Incidencia[] } | null;
  cola?: { cobros: number; importe: number };
};
type Reanudar = {
  reanudada: boolean;
  incidencias?: Incidencia[];
  emitidas?: { resultado: string }[];
};

const CADA_MS = 5 * 60 * 1000;
const fecha = (t: string) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const euros = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export default function AvisoFacturacionPausada() {
  const { can } = usePermission();
  const puede = can('facturas.auditoria');
  const [estado, setEstado] = useState<Estado | null>(null);
  const [pendientes, setPendientes] = useState<Incidencia[] | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(() => {
    client.get('/facturacion-auditoria/estado')
      .then((r: { success: boolean; data: Estado }) => { if (r?.success) setEstado(r.data); })
      .catch(() => { /* sin el módulo (bundle apagado) o sin red: no se enseña nada */ });
  }, []);

  useEffect(() => {
    if (!puede) return undefined;
    cargar();
    const t = window.setInterval(cargar, CADA_MS);
    return () => window.clearInterval(t);
  }, [puede, cargar]);

  if (!puede || !estado?.activa || !estado.pausada || !estado.pausa) return null;

  const lista = pendientes ?? estado.pausa.incidencias ?? [];

  async function solucionado() {
    setTrabajando(true);
    try {
      const r = await client.post('/facturacion-auditoria/reanudar', {}) as { data: Reanudar };
      if (r.data.reanudada) {
        const n = (r.data.emitidas || []).filter((e) => e.resultado === 'emitida').length;
        toast({ title: 'Facturación reanudada', description: n ? `Se han emitido ${n} factura(s) de la cola, en orden de cobro.` : 'La auditoría ha salido limpia.' });
        setPendientes(null);
      } else {
        setPendientes(r.data.incidencias || []);
        setAbierto(true);
        toast({ title: 'Sigue habiendo errores', description: 'La facturación sigue pausada. Revisa la lista.', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'No se pudo reanudar', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setTrabajando(false);
      cargar();
    }
  }

  return (
    <div role="alert" className="mb-4 rounded-lg border border-destructive/30 bg-destructive-soft p-3 sm:p-4" data-recorrido="facturacion-pausada">
      <div className="flex items-start gap-3">
        <PauseCircle size={20} weight="fill" className="text-destructive flex-none mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-destructive-soft-foreground text-sm">
            Facturación pausada por la auditoría
          </p>
          <p className="text-sm text-destructive-soft-foreground mt-1 break-words">
            {pendientes ? `Sigue habiendo ${pendientes.length} error(es).` : estado.pausa.motivo}
            {' · '}desde el {fecha(estado.pausa.pausada_at)}
          </p>
          <p className="text-xs text-destructive-soft-foreground mt-1.5">
            No se emiten facturas nuevas. La auditoría no corrige nada: arréglalo y pulsa «Marcar como solucionado»;
            solo se reanuda si vuelve a salir limpia.
            {estado.cola?.cobros
              ? ` Esperan ${estado.cola.cobros} cobro(s) (${euros(estado.cola.importe)}) que se facturarán en orden al reanudar.`
              : ''}
          </p>
          {abierto && lista.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-destructive-soft-foreground max-h-48 overflow-y-auto">
              {lista.map((i, n) => <li key={n} className="break-words">· {i.texto}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <button
              type="button"
              onClick={solucionado}
              disabled={trabajando}
              data-recorrido="facturacion-solucionado"
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded bg-destructive text-destructive-foreground text-xs font-semibold hover:bg-destructive/90 disabled:opacity-50"
            >
              {trabajando ? <ArrowClockwise size={14} className="animate-spin" /> : <CheckCircle size={14} weight="bold" />}
              Marcar como solucionado
            </button>
            {lista.length > 0 && (
              <button
                type="button"
                onClick={() => setAbierto((v) => !v)}
                data-recorrido="facturacion-errores"
                className="inline-flex items-center gap-1 h-7 px-2.5 rounded border border-destructive/30 text-destructive-soft-foreground text-xs font-semibold hover:bg-destructive/10"
              >
                {abierto ? <CaretUp size={12} /> : <CaretDown size={12} />}
                {abierto ? 'Ocultar' : `Ver los ${lista.length} error(es)`}
              </button>
            )}
            <Link to="/accounting/facturas"
              className="inline-flex items-center h-7 px-2.5 rounded border border-destructive/30 text-destructive-soft-foreground text-xs font-semibold hover:bg-destructive/10">
              Ir a Facturación
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
