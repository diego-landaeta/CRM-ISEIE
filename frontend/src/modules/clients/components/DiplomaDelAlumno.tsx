import { useEffect, useState } from 'react';
import { Certificate } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import {
  EtiquetaDiploma, leerDiplomaDeLaFicha, type DiplomaDeLaFicha,
} from '@/modules/diploma-confirmacion/components/EstadoDelDiploma';

/**
 * #791 (gemela de CRM#1135) · El diploma en la ficha del alumno: datos pedidos,
 * contestados o emitido, curso a curso. Sale de la confirmación de datos unida a ESTA
 * ficha (la de su campus). Sin nada que contar, no se pinta: la ficha queda como estaba.
 */
export default function DiplomaDelAlumno({ leadId }: { leadId: number | string | null | undefined }) {
  const [filas, setFilas] = useState<DiplomaDeLaFicha[]>([]);

  useEffect(() => {
    let vigente = true;
    setFilas([]);
    if (!leadId) return undefined;
    (client.get(`/leads/${leadId}/diploma`) as Promise<{ data?: DiplomaDeLaFicha[] }>)
      .then((r) => { if (vigente) setFilas(Array.isArray(r?.data) ? r.data : []); })
      // El resto de la ficha no depende de esto: si falla, no se enseña.
      .catch(() => {});
    return () => { vigente = false; };
  }, [leadId]);

  if (!filas.length) return null;
  return (
    <section aria-labelledby="ficha-diploma" className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h3 id="ficha-diploma" className="text-sm font-bold text-foreground flex items-center gap-1.5">
        <Certificate size={15} weight="duotone" aria-hidden="true" /> Diploma
      </h3>
      <ul className="space-y-3 divide-y divide-border/60">
        {filas.map((f) => {
          const l = leerDiplomaDeLaFicha(f);
          return (
            <li key={f.matricula_id} className="pt-3 first:pt-0 space-y-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-medium text-foreground min-w-0 break-words">{f.curso_nombre || 'Curso sin nombre'}</p>
                <EtiquetaDiploma lectura={l} className="shrink-0" />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed" aria-hidden="true">{l.detalle}</p>
              {f.campus && <p className="text-[11px] text-muted-foreground/80">{f.campus}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
