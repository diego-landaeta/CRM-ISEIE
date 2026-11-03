import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, Check, WarningCircle, ArrowSquareOut } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { formatDate } from '@/shared/lib/format';

/**
 * Las ventas que no dicen de qué formación son (#41).
 *
 * 321 cobradas sin curso del catálogo detrás. La consecuencia no es estética:
 * sin formación no se sabe de quién es la comisión y **ningún profesor cobra**
 * por ellas; en los informes salen bajo «servicio académico», que es el texto
 * que traía el pago.
 *
 * Esta pantalla hace las dos primeras subfases: enseñar la lista con lo que se
 * sepa de cada una, y proponer el cruce de las que se puedan por el nombre.
 *
 * LO QUE NO HACE, Y ES A PROPÓSITO: atarlas sola. La sugerencia se propone y
 * la confirma una persona, de una en una. Atar un cobro a la formación
 * equivocada es peor que dejarlo sin atar — lo segundo se ve en esta lista;
 * lo primero se le paga a quien no era y no sale en ningún aviso. Ese aviso
 * está escrito desde el 14/09 en `scripts/venta-177-sin-formacion.sql`, a
 * cuenta de una tutora que casi cobra lo de otra.
 */

interface Sugerencia { id: number; nombre: string }
interface Fila {
  id: number;
  fecha: string;
  alumno: string | null;
  alumnoEmail: string | null;
  texto: string | null;
  importe: number;
  cobrado: number;
  sugerencia: Sugerencia | null;
}
interface Datos {
  filas: Fila[];
  total: number;
  conSugerencia: number;
  sinTexto: number;
  importe: number;
  /** Lo cobrado de verdad: lo que suma la tarjeta. `importe` es lo vendido. */
  cobrado: number;
}

const eur = (n: number) => n.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

export default function VentasSinFormacionPage() {
  const { activeProject } = useProjectContext() as { activeProject: { id?: number | null; nombre?: string } | null };
  const pid = activeProject?.id;
  const [datos, setDatos] = useState<Datos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [atando, setAtando] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    if (!pid) return;
    setCargando(true);
    try {
      const r = await client.get<Datos>(`/ventas/sin-formacion?projectId=${pid}`);
      setDatos(r?.success ? r.data : null);
    } catch { setDatos(null); } finally { setCargando(false); }
  }, [pid]);
  useEffect(() => { cargar(); }, [cargar]);

  /** Atar UNA venta a la formación propuesta. De una en una, y confirmando. */
  async function atar(f: Fila) {
    if (!f.sugerencia) return;
    if (!confirm(
      `Esta venta pasará a ser de «${f.sugerencia.nombre}».\n\n`
      + `Con eso, su comisión irá al profesor de esa formación. Comprueba que es la correcta: `
      + `atarla a la equivocada se le paga a quien no era.\n\n¿Seguir?`)) return;
    setAtando(f.id);
    try {
      const r = await client.patch(`/conversions/${f.id}`, { producto_contratado_id: f.sugerencia.id });
      if (r?.success) {
        toast({ title: 'Atada', description: `#${f.id} → ${f.sugerencia.nombre}` });
        await cargar();
      }
    } catch (e: unknown) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo atar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setAtando(null); }
  }

  if (!pid) return <div className="p-8 text-muted-foreground">Selecciona un proyecto.</div>;

  const sinSugerencia = (datos?.total || 0) - (datos?.conSugerencia || 0);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Ventas sin formación"
        subtitle={`Cobradas, pero sin curso del catálogo detrás — ${activeProject?.nombre || ''}`}
      />

      {cargando ? (
        <div className="h-24 rounded-lg bg-muted/40 animate-pulse" />
      ) : !datos || datos.total === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <GraduationCap size={28} className="mx-auto text-success mb-2" weight="duotone" />
          <p className="font-semibold text-sm">Todas las ventas cobradas tienen su formación</p>
          <p className="text-xs text-muted-foreground mt-1">No hay nada que cruzar en este proyecto.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Sin formación</p>
              <p className="text-2xl font-semibold tabular-nums">{datos.total}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">{eur(datos.cobrado)} cobrados</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Se pueden cruzar</p>
              <p className="text-2xl font-semibold tabular-nums text-success">
                {datos.conSugerencia}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">el nombre coincide con un curso</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">A mano</p>
              <p className="text-2xl font-semibold tabular-nums text-warning">
                {sinSugerencia}
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {datos.sinTexto > 0 ? `${datos.sinTexto} sin ningún texto` : 'sin candidato único'}
              </p>
            </div>
          </div>

          {/* Por qué esto importa, en una línea: sin esto la lista parece
              una tarea administrativa y es dinero que alguien no cobra. */}
          <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning-soft-foreground">
            Mientras una venta no diga de qué formación es, <strong>su profesor no cobra comisión</strong> por
            ella y en los informes sale como «servicio académico». Las sugerencias se confirman una a una: atar
            un cobro a la formación equivocada se le paga a quien no era.
          </div>

          <div className="bg-card border border-border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Fecha</th>
                  <th className="text-left px-4 py-2 font-medium">Alumno</th>
                  <th className="text-left px-4 py-2 font-medium">Lo que dice la venta</th>
                  <th className="text-right px-4 py-2 font-medium">Cobrado</th>
                  <th className="text-left px-4 py-2 font-medium">Formación propuesta</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {datos.filas.map((f) => (
                  <tr key={f.id} className="border-b last:border-0 border-border hover:bg-muted/30">
                    <td className="px-4 py-2 whitespace-nowrap">{formatDate(f.fecha)}</td>
                    <td className="px-4 py-2">
                      <p className="font-medium">{f.alumno || '—'}</p>
                      <p className="text-[11px] text-muted-foreground">{f.alumnoEmail || ''}</p>
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {f.texto || <span className="text-warning">— no dice nada —</span>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{eur(f.cobrado)}</td>
                    <td className="px-4 py-2 text-xs">
                      {f.sugerencia
                        ? <span className="text-success">{f.sugerencia.nombre}</span>
                        : <span className="text-muted-foreground">sin candidato único</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {f.sugerencia ? (
                        <button
                          onClick={() => atar(f)} disabled={atando === f.id}
                          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-success/40 text-[11px] font-semibold text-success hover:bg-success-soft disabled:opacity-50"
                        >
                          <Check size={11} weight="bold" /> {atando === f.id ? '…' : 'Atar'}
                        </button>
                      ) : (
                        <a
                          href={`${(import.meta.env.BASE_URL || '/').replace(/\/$/, '')}/ventas/${f.id}`} target="_blank" rel="noopener noreferrer"
                          title="Abrir la venta para ponerle la formación a mano"
                          className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-[11px] hover:bg-muted"
                        >
                          <ArrowSquareOut size={11} /> Abrir
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sinSugerencia > 0 && (
            <p className="text-[11px] text-muted-foreground flex items-start gap-1.5">
              <WarningCircle size={13} className="mt-0.5 flex-shrink-0" />
              Las {sinSugerencia} de «sin candidato único» son las que hay que mirar con Diego: o no dicen
              nada, o su texto encaja con más de un curso del catálogo y no se puede adivinar cuál.
            </p>
          )}
        </>
      )}
    </div>
  );
}
