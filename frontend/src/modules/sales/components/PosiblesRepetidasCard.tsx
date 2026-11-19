import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CopySimple, CaretDown } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { formatCurrency } from '@/shared/lib/format';

/*
  POSIBLES REPETIDAS (CRM#898).

  Las ventas del mismo alumno y programa en el mismo campus, en grupos, para
  revisarlas: la regla es la misma que la del aviso al crear una venta (mismo
  prospecto, mismo correo o mismo nombre sin tildes ni mayúsculas, o uno que
  empieza por el otro). Casos reales del 18/11: segundas cuotas apuntadas como
  venta nueva y una carga desde facturas que creó una venta por factura.

  Solo para quien puede editar ventas (`conversions.edit`); una gestora ve los
  grupos donde hay alguna venta suya. Cerrada de entrada: se pide al abrirla.
*/

interface VentaDelGrupo {
  id: number;
  campus?: string | null;
  alumno?: string | null;
  email?: string | null;
  programa?: string | null;
  fecha?: string | null;
  total: number;
  cobrado: number;
  pendiente: number;
  gestora?: string | null;
  forzada_por?: string | null;
}
interface Grupo {
  project_id: number;
  campus?: string | null;
  alumno?: string | null;
  programa?: string | null;
  ventas: VentaDelGrupo[];
}

export default function PosiblesRepetidasCard({ projectId }: { projectId: number | null }) {
  const [abierta, setAbierta] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!abierta) return;
    let vivo = true;
    setGrupos(null);
    setError(null);
    client.get('/conversions/posibles-repetidas', { params: projectId ? { projectId } : {} })
      .then((r: any) => { if (vivo) setGrupos(r?.success ? (r.data || []) : []); })
      .catch((e: any) => { if (vivo) setError(e?.data?.error || e?.message || 'No se pudo cargar'); });
    return () => { vivo = false; };
  }, [abierta, projectId]);

  return (
    <section className="bg-card border border-border rounded-lg">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="w-full flex items-center gap-2 px-4 py-3 text-left"
      >
        <CopySimple size={16} className="text-amber-600 dark:text-amber-400" />
        <span className="font-semibold text-sm flex-1">
          Posibles repetidas
          {grupos && <span className="ml-1.5 text-muted-foreground font-normal">· {grupos.length} {grupos.length === 1 ? 'alumno' : 'alumnos'}</span>}
        </span>
        <span className="text-xs text-muted-foreground hidden sm:inline">Mismo alumno y programa con más de una venta</span>
        <CaretDown size={14} className={abierta ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      {abierta && (
        <div className="border-t border-border px-4 py-3 space-y-3 text-sm">
          {error && <p className="text-destructive">{error}</p>}
          {!error && !grupos && <p className="text-muted-foreground">Buscando…</p>}
          {grupos && grupos.length === 0 && (
            <p className="text-muted-foreground">No hay ventas repetidas del mismo alumno y programa.</p>
          )}
          {grupos && grupos.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Si son la misma compra, apunta los cobros en una de ellas y quita las demás. Las que se crearon con «Crear otra venta igualmente» ya no salen.
            </p>
          )}
          {grupos?.map((g) => (
            <div key={g.ventas.map((v) => v.id).join('-')} className="rounded-md border border-border">
              <div className="px-3 py-2 bg-muted/40 flex flex-wrap gap-x-2 gap-y-0.5 items-baseline">
                <span className="font-medium">{g.alumno || '—'}</span>
                <span className="text-muted-foreground">· {g.programa || '—'}</span>
                {!projectId && g.campus && <span className="text-xs text-muted-foreground">· {g.campus}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{g.ventas.length} ventas</span>
              </div>
              <ul className="divide-y divide-border">
                {g.ventas.map((v) => (
                  <li key={v.id} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link to={`/ventas/${v.id}`} className="text-primary hover:underline font-medium">Venta {v.id}</Link>
                    <span className="text-muted-foreground">{v.fecha || ''}</span>
                    <span className="truncate max-w-[14rem]" title={v.email || undefined}>{v.alumno}</span>
                    <span className="tabular-nums">{formatCurrency(v.cobrado)} de {formatCurrency(v.total)}</span>
                    {v.pendiente > 0.005 && <span className="text-xs text-amber-700 dark:text-amber-400 tabular-nums">pendiente {formatCurrency(v.pendiente)}</span>}
                    {v.gestora && <span className="text-xs text-muted-foreground">{v.gestora}</span>}
                    {v.forzada_por && <span className="text-xs text-muted-foreground">creada igualmente por {v.forzada_por}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
