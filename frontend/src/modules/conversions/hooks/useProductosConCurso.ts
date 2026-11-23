import { useEffect, useState } from 'react';
import client from '@/shared/api/client';

/*
  Los productos del campus unidos a un curso de Moodle (CRM#1036).

  Con ellos el formulario de venta sabe si la fecha de inicio del curso es
  obligatoria: solo lo es si el producto (o alguna línea) tiene curso, porque
  solo entonces hay matrícula que programar. Mientras carga, o si falla, es
  `null` y el formulario no la exige: el servidor lo vuelve a mirar al guardar.
*/
export function useProductosConCurso(projectId: number | null | undefined): Set<number> | null {
  const [ids, setIds] = useState<Set<number> | null>(null);
  useEffect(() => {
    setIds(null);
    if (!projectId || projectId < 1) return;
    let vivo = true;
    client.get('/conversions/productos-con-curso', { params: { projectId } })
      .then((r: any) => { if (vivo) setIds(new Set<number>((r?.success ? r.data : []).map(Number))); })
      .catch(() => { if (vivo) setIds(null); });
    return () => { vivo = false; };
  }, [projectId]);
  return ids;
}

/** ¿Alguno de esos productos tiene curso? */
export function algunoConCurso(conCurso: Set<number> | null, productIds: Array<number | null | undefined>): boolean {
  return Boolean(conCurso && productIds.some((id) => id != null && conCurso.has(Number(id))));
}
