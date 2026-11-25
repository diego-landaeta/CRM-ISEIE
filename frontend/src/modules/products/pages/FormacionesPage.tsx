import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import ElegirCampus from '@/shared/components/ui/ElegirCampus';
import usePermission from '@/shared/hooks/usePermission';
import { useCampusDeLaPantalla } from '@/shared/hooks/useCampusDeLaPantalla';
import { casaPorTrozos } from '@/shared/lib/buscarPorTrozos';
import { rutaDeFormacion } from '../lib/rutasFormacion';
import { alumnosApi, type ResumenDelCampus } from '../api/alumnos.api';
import { ordenarFormaciones, totalesDelCampus, type OrdenFormaciones } from '../lib/alumnosFormacion';
import AccesoAlumnosCampus from '../components/AccesoAlumnosCampus';

/**
 * Productos › Formaciones (CRM-ISEIE#767, gemela de CRM#1113): las formaciones del catálogo de un campus,
 * para crear una nueva o abrir una y editarla entera —datos, módulos y tutoras—
 * en su ficha. Una formación ES un producto: la lista es el catálogo del campus.
 *
 * Con `products.alumnos`, cada formación lleva sus alumnos activos y cuántos de
 * ellos tienen un impago, y se puede ordenar por eso (CRM-ISEIE#767). Las cifras
 * vienen en una sola petición para todo el campus.
 */

const ORDENES: Array<{ id: OrdenFormaciones; texto: string }> = [
  { id: 'nombre', texto: 'Nombre' },
  { id: 'activos', texto: 'Activos' },
  { id: 'impago', texto: 'Con impago' },
];

type Fila = {
  id: number;
  nombre: string;
  precio?: number | string | null;
  moneda?: string | null;
  horas?: string | null;
  modalidad?: string | null;
  num_modulos?: number | null;
};

export default function FormacionesPage() {
  const campus = useCampusDeLaPantalla();
  const { can } = usePermission();
  const [filas, setFilas] = useState<Fila[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const verAlumnos = can('products.alumnos');
  const [alumnos, setAlumnos] = useState<ResumenDelCampus | null>(null);
  const [orden, setOrden] = useState<OrdenFormaciones>('nombre');

  useEffect(() => {
    if (!campus.id) { setFilas([]); return undefined; }
    let vivo = true;
    setCargando(true);
    setError(null);
    client.get('/products', { params: { projectId: campus.id } })
      .then((r) => { if (vivo) setFilas((r.data as Fila[]) ?? []); })
      .catch((e) => { if (vivo) { setError((e as Error).message); setFilas([]); } })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [campus.id]);

  // Los alumnos de cada formación (CRM#1113). Si falla, la lista sigue sin las cifras.
  useEffect(() => {
    setAlumnos(null);
    if (!campus.id || !verAlumnos) return undefined;
    let vivo = true;
    alumnosApi.delCampus(campus.id)
      .then((r) => { if (vivo) setAlumnos(r.data ?? null); })
      .catch(() => { if (vivo) setAlumnos(null); });
    return () => { vivo = false; };
  }, [campus.id, verAlumnos]);

  const cifras = alumnos?.por_producto ?? null;
  const totales = useMemo(() => totalesDelCampus(cifras), [cifras]);

  const visibles = useMemo(() => {
    const lista = texto.trim() ? filas.filter((f) => casaPorTrozos(texto, f.nombre)) : filas;
    return ordenarFormaciones(lista, cifras ? orden : 'nombre', cifras);
  }, [filas, texto, orden, cifras]);

  return (
    <div className="space-y-3 p-4 pb-8 sm:p-6">
      <div className="flex items-center gap-2 sm:gap-3">
        <h1 className="flex min-w-0 items-center gap-2 text-base font-semibold text-foreground sm:text-lg">
          <BookOpen size={20} weight="duotone" aria-hidden="true" className="shrink-0 text-primary" />
          <span className="truncate">Formaciones</span>
        </h1>
        {campus.id && !cargando && (
          <span className="hidden shrink-0 text-sm text-muted-foreground tabular-nums sm:inline">{filas.length}</span>
        )}
        {campus.id && can('products.create') && (
          <Link
            to={rutaDeFormacion('nueva', campus.id)}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
          >
            <Plus size={14} weight="bold" aria-hidden="true" />
            Nueva formación
          </Link>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Cada formación con sus módulos (título, horas y temario), sus horas, precio, fechas y tutoras. Los módulos son los que imprime el diploma.
      </p>

      <ElegirCampus campus={campus} que="las formaciones" />

      {campus.id && alumnos && can('products.edit') && (
        <AccesoAlumnosCampus campusId={campus.id} regla={alumnos.regla}
          alGuardar={() => { alumnosApi.delCampus(campus.id!).then((r) => setAlumnos(r.data ?? null)).catch(() => {}); }} />
      )}

      {campus.id && (
        <>
          <label className="flex h-8 min-w-0 max-w-md items-center gap-2 rounded-md border border-border bg-card px-2.5 focus-within:border-primary">
            <MagnifyingGlass size={14} aria-hidden="true" className="shrink-0 text-muted-foreground" />
            <input
              value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar formación"
              aria-label="Buscar formación" className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {texto && (
              <button type="button" onClick={() => setTexto('')} aria-label="Limpiar búsqueda" className="text-muted-foreground hover:text-foreground">
                <X size={13} aria-hidden="true" />
              </button>
            )}
          </label>

          {cifras && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <span>
                <strong className="tabular-nums text-foreground">{totales.activos}</strong> alumnos activos
                {totales.impago > 0 && <> · <strong className="tabular-nums text-destructive">{totales.impago}</strong> con impago</>}
                {totales.baja > 0 && <> · <strong className="tabular-nums text-foreground">{totales.baja}</strong> de baja</>}
                {alumnos?.solo_lo_suyo && ' (de tus ventas)'}
              </span>
              <span className="flex items-center gap-1" role="group" aria-label="Ordenar por">
                Ordenar:
                {ORDENES.map((o) => (
                  <button key={o.id} type="button" onClick={() => setOrden(o.id)} aria-pressed={orden === o.id}
                    className={`h-6 rounded-full border px-2 font-medium ${orden === o.id ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-foreground hover:bg-muted'}`}>
                    {o.texto}
                  </button>
                ))}
              </span>
            </div>
          )}

          {error && <p className="rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground" role="alert">{error}</p>}
          {cargando && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {!cargando && !error && visibles.length === 0 && (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              {texto ? 'Ninguna formación con ese nombre.' : 'Este campus aún no tiene formaciones en el catálogo.'}
            </p>
          )}
          {!cargando && visibles.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
              {visibles.map((f) => (
                <li key={f.id}>
                  <Link to={rutaDeFormacion(f.id, campus.id!)} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{f.nombre}</span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
                      {[f.horas, f.num_modulos ? `${f.num_modulos} módulos` : null, f.modalidad].filter(Boolean).join(' · ')}
                    </span>
                    {cifras && <CifrasAlumnos activos={cifras[String(f.id)]?.activos ?? 0} impago={cifras[String(f.id)]?.impago ?? 0} baja={cifras[String(f.id)]?.baja ?? 0} />}
                    {f.precio != null && f.precio !== '' && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-foreground">
                        {Number(f.precio).toLocaleString('es-ES')} {f.moneda || 'EUR'}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Activos y, si hay, con impago y de baja, de una formación de la lista. */
function CifrasAlumnos({ activos, impago, baja = 0 }: { activos: number; impago: number; baja?: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums" aria-label={`${activos} activos, ${impago} con impago, ${baja} de baja`}>
      <span className={activos ? 'rounded-full bg-primary/10 px-1.5 font-semibold text-primary' : 'px-1.5 text-muted-foreground'} title="Alumnos activos">
        {activos}
      </span>
      {impago > 0 && (
        <span className="rounded-full bg-destructive-soft px-1.5 font-semibold text-destructive-soft-foreground" title="Activos con impago">
          {impago}
        </span>
      )}
      {baja > 0 && (
        <span className="rounded-full bg-warning-soft px-1.5 font-semibold text-warning-soft-foreground" title="De baja">
          {baja}
        </span>
      )}
    </span>
  );
}
