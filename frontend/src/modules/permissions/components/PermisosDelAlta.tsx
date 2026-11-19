import { useEffect, useState } from 'react';
import { ShieldCheck } from '@phosphor-icons/react';
import * as api from '../api/permissions.api';
import type { Catalogo, VistaPreviaDeAlta } from '../api/permissions.api';
import { clavesDeSeccion } from '../lib/permisos';
import ListaDePermisos, { type Eleccion } from './ListaDePermisos';

/**
 * #694 · Los permisos, ya en el alta de un usuario.
 *
 * Al elegir el rol se ve lo que trae, con el mismo «de dónde le viene» que en
 * su ficha, y —quien tiene «Permisos de cada persona»— se pueden ajustar las
 * excepciones ANTES de crearlo. Las excepciones viven en el formulario
 * (`excepciones` / `onCambiar`) y viajan con el alta: el servidor las comprueba
 * antes de crear a nadie y las guarda en la misma operación.
 *
 * «Sí» no se ofrece para lo que quien da de alta no tiene: nadie da lo que no
 * tiene (el servidor lo vuelve a comprobar). Y hasta que no se elija uno de sus
 * campus no se pueden tocar: sus permisos solo los cambia quien comparte campus
 * con ella, y el servidor lo dice (`motivo`).
 */
export default function PermisosDelAlta({
  role, rolesExtra, projectIds = [], excepciones, onCambiar,
}: {
  role: string;
  rolesExtra: string[];
  /** Los campus elegidos en el alta. */
  projectIds?: number[];
  excepciones: Record<string, boolean>;
  onCambiar: (excepciones: Record<string, boolean>) => void;
}) {
  const [catalogo, setCatalogo] = useState<Catalogo | null>(null);
  const [vista, setVista] = useState<VistaPreviaDeAlta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    api.getCatalogo().then((c) => { if (vivo) setCatalogo(c); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  // Se recalcula con cada rol, rol de más, campus o excepción.
  const clave = JSON.stringify([role, rolesExtra, [...projectIds].sort(), excepciones]);
  useEffect(() => {
    let vivo = true;
    api.vistaPreviaDeAlta({ role, roles_extra: rolesExtra, excepciones, projectIds })
      .then((v) => { if (vivo) { setVista(v); setError(null); } })
      .catch((e) => { if (vivo) setError(e instanceof Error ? e.message : 'No se pudo calcular'); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  // Si ya no puede ajustarlas (por ejemplo, ha pasado el rol a admin y no es
  // superadmin), las excepciones que llevaba se quitan: si no, el alta daría 403.
  useEffect(() => {
    if (vista && !vista.puedeEditar && Object.keys(excepciones).length) onCambiar({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vista]);

  function elegir(c: string, e: Eleccion) {
    const siguiente = { ...excepciones };
    if (e === 'rol') delete siguiente[c]; else siguiente[c] = e === 'si';
    onCambiar(siguiente);
  }

  const total = catalogo ? catalogo.secciones.flatMap(clavesDeSeccion) : [];
  const mios = vista?.misPermisos ? new Set(vista.misPermisos) : null;
  const cuantas = Object.keys(excepciones).length;

  return (
    <section aria-labelledby="permisos-alta-titulo" className="space-y-3">
      <div>
        <h3 id="permisos-alta-titulo" className="flex items-center gap-1.5 text-normal font-semibold">
          <ShieldCheck size={16} weight="bold" /> Permisos
        </h3>
        <p className="text-secundario text-muted-foreground">
          Lo que trae el rol{vista && catalogo ? `: podrá ${total.filter((k) => vista.mapa[k]).length} de ${total.length}` : ''}
          {cuantas > 0 && ` · ${cuantas} ${cuantas === 1 ? 'excepción' : 'excepciones'} suyas`}
          {vista && !vista.puedeEditar && !vista.motivo && ' · solo lectura'}
        </p>
        {vista?.motivo && <p className="text-secundario text-muted-foreground">{vista.motivo}</p>}
      </div>
      {error && <p className="rounded-lg bg-destructive-soft p-3 text-normal text-destructive-soft-foreground">{error}</p>}
      {(!vista || !catalogo) && !error && <p className="text-normal text-muted-foreground">Cargando…</p>}
      {vista && catalogo && (
        <ListaDePermisos catalogo={catalogo} mapa={vista.mapa} origenes={vista.origenes} excepciones={excepciones}
          puedeEditar={vista.puedeEditar} onElegir={elegir} puedeDar={(c) => !mios || mios.has(c)} role={role} />
      )}
    </section>
  );
}
