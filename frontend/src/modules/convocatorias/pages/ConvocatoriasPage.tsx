import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GraduationCap, WarningCircle, Plus, CaretRight } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
// En ISEIE no hay `shared/lib/fechas`: el mismo `formatFecha` vive aquí.
import { formatFecha } from '@/modules/leads/lib/leadFormat';
import {
  traerConvocatorias, crearConvocatoria, editarConvocatoria, traerEmbudo, traerPendientes,
  type Convocatoria, type Embudo, type Pendiente,
} from '../api/convocatorias.api';
import { tramosDelEmbudo, hayEmbudo } from '../lib/ofrecimiento';

/**
 * Convocatorias: las campañas, el embudo y a quién hay que contestarle hoy (#86).
 *
 * Tres preguntas distintas, en el orden en que se hacen:
 *
 *   1. ¿a quién le debo una respuesta?   — lo urgente, arriba del todo
 *   2. ¿esto cierra ventas o entretiene? — el embudo
 *   3. ¿qué campañas hay?                — la administración, abajo
 *
 * «Le dije que te contesto el 24» y no contestar es peor que no haber ofrecido
 * nada, así que eso va primero aunque sea lo que menos filas ocupa.
 */

const fecha = (iso?: string | null) => formatFecha(iso) ?? '—';

const campo = 'h-9 rounded-md border border-border bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
const boton = 'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40';

// ISEIE no tiene la escala de texto de MultiCRM (titulo, seccion, secundario,
// cifra) ni el espaciado «bloque» en su tailwind.config: escritas así no
// harían nada. Van las de Tailwind del mismo tamaño —xl, base, xs, space-y-6—
// y, para las cifras, el `text-2xl` de los contadores de la cola.
function Cifra({ etiqueta, valor, pie }: { etiqueta: string; valor: string; pie?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{etiqueta}</p>
      <p className="mt-0.5 text-2xl font-semibold tabular-nums">{valor}</p>
      {pie && <p className="text-xs text-muted-foreground">{pie}</p>}
    </div>
  );
}

export default function ConvocatoriasPage() {
  const { activeProject, user } = useAuth();
  const projectId = activeProject?.id ?? null;
  const esAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  const [campanas, setCampanas] = useState<Convocatoria[]>([]);
  const [embudo, setEmbudo] = useState<Embudo | null>(null);
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [elegida, setElegida] = useState<number | ''>('');
  const [verInactivas, setVerInactivas] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  const [creando, setCreando] = useState(false);
  const [nueva, setNueva] = useState({ nombre: '', tope_nueva: '40', tope_habilitada: '70', descripcion: '' });

  const cargar = useCallback(async () => {
    setCargando(true);
    const [c, e, p] = await Promise.all([
      traerConvocatorias({ projectId, incluirInactivas: verInactivas }).catch(() => []),
      traerEmbudo({ projectId, convocatoriaId: elegida === '' ? null : elegida }).catch(() => null),
      traerPendientes({ projectId }).catch(() => []),
    ]);
    setCampanas(c);
    setEmbudo(e);
    setPendientes(p);
    setCargando(false);
  }, [projectId, verInactivas, elegida]);

  useEffect(() => { cargar(); }, [cargar]);

  async function crear() {
    setFallo(null);
    const nombre = nueva.nombre.trim();
    if (nombre.length < 2) { setFallo('La convocatoria necesita un nombre.'); return; }
    try {
      await crearConvocatoria({
        nombre,
        descripcion: nueva.descripcion.trim() || undefined,
        tope_nueva: Number(nueva.tope_nueva),
        tope_habilitada: Number(nueva.tope_habilitada),
      }, projectId);
      setCreando(false);
      setNueva({ nombre: '', tope_nueva: '40', tope_habilitada: '70', descripcion: '' });
      await cargar();
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      setFallo(err?.status === 403 ? 'Crear convocatorias es cosa de un administrador.' : (err?.message || 'No se ha podido crear.'));
    }
  }

  async function cambiarActiva(c: Convocatoria) {
    setFallo(null);
    try {
      await editarConvocatoria(c.id, { activa: !c.activa }, projectId);
      await cargar();
    } catch (e: unknown) {
      const err = e as { message?: string };
      setFallo(err?.message || 'No se ha podido cambiar.');
    }
  }

  const tramos = tramosDelEmbudo(embudo);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <GraduationCap size={22} weight="duotone" className="text-primary" />
            Convocatorias
          </h1>
          <p className="text-xs text-muted-foreground">
            Las becas que se ofrecen, a quién se le ofrecieron y en qué acabaron.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Convocatoria</span>
          <select
            className={campo} value={elegida}
            aria-label="Filtrar por convocatoria"
            onChange={(e) => setElegida(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">— Todas —</option>
            {campanas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
      </header>

      {fallo && <p className="text-sm text-destructive">{fallo}</p>}

      {/* 1 · Lo urgente. Ofrecer una beca, prometer respuesta para el 24 y no
          contestar es peor que no haberla ofrecido. */}
      <section aria-label="Le debemos respuesta" className="rounded-xl border border-border bg-card p-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <WarningCircle size={16} weight="duotone" className="text-warning" />
          Le debemos respuesta hoy
          {pendientes.length > 0 && (
            <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground tabular-nums">
              {pendientes.length}
            </span>
          )}
        </h2>
        {cargando ? (
          <div className="mt-3 h-10 animate-pulse rounded-lg bg-muted" />
        ) : pendientes.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Nadie espera respuesta. Es la única cifra de esta pantalla que se quiere en cero.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {pendientes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <Link to={`/leads/${p.lead_id}`} className="font-medium text-primary hover:underline">
                  {p.lead_nombre || `Prospecto ${p.lead_id}`}
                </Link>
                <span className="text-muted-foreground">{p.convocatoria}</span>
                <span className="text-xs text-muted-foreground">
                  prometido para el {fecha(p.fecha_resultado)}
                </span>
                {/* Hoy todavía se está a tiempo; ayer ya se rompió lo
                    prometido. Pintar los dos del mismo color hace que el que
                    de verdad urge no se distinga del que solo toca. */}
                <span className={`ml-auto rounded px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                  p.dias_de_retraso === 0
                    ? 'bg-warning-soft text-warning-soft-foreground'
                    : 'bg-destructive-soft text-destructive-soft-foreground'
                }`}>
                  {p.dias_de_retraso === 0
                    ? 'le toca hoy'
                    : `${p.dias_de_retraso} ${p.dias_de_retraso === 1 ? 'día' : 'días'} de retraso`}
                </span>
                {p.gestora && <span className="text-xs text-muted-foreground">{p.gestora}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2 · El embudo. */}
      <section aria-label="El embudo" className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-base font-semibold">De ofrecerla a venderla</h2>
        {cargando ? (
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
          </div>
        ) : !hayEmbudo(embudo) ? (
          // Cuatro ceros en fila se leen como «la beca no funciona», y lo que
          // pasa es que nadie la ha ofrecido. No es lo mismo.
          <p className="mt-2 text-xs text-muted-foreground">
            Todavía no se ha ofrecido ninguna. Cuando se ofrezca la primera, aquí saldrá cuántas
            llenaron la solicitud y cuántas acabaron en venta.
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tramos.map((t) => (
                <Cifra
                  key={t.clave}
                  etiqueta={t.etiqueta}
                  valor={String(t.valor)}
                  pie={t.pct == null ? undefined : `${t.pct} % de las ofrecidas`}
                />
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Cifra
                etiqueta="De los que la pidieron, compraron"
                valor={`${embudo!.pct_compraron_de_los_que_llenaron} %`}
                pie="la cifra que dice si la beca cierra ventas"
              />
              <Cifra
                etiqueta="Descuento medio"
                valor={embudo!.descuento_medio == null ? '—' : `${embudo!.descuento_medio} %`}
                pie={embudo!.descuento_maximo == null ? undefined : `el mayor, ${embudo!.descuento_maximo} %`}
              />
              <Cifra etiqueta="No la llenaron" valor={String(embudo!.no_llenaron)} />
              {/* «Sin preguntar» no es un cero disfrazado: es trabajo que
                  queda por hacer, y contarlo como un no haría que el embudo
                  pareciera peor de lo que es. */}
              <Cifra
                etiqueta="Sin preguntar todavía"
                valor={String(embudo!.sin_saber)}
                pie="ni sí ni no: falta preguntárselo"
              />
            </div>
          </>
        )}
      </section>

      {/* 3 · Las campañas. */}
      <section aria-label="Las convocatorias" className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Las convocatorias</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input type="checkbox" checked={verInactivas} onChange={(e) => setVerInactivas(e.target.checked)} />
              Ver también las cerradas
            </label>
            {esAdmin && !creando && (
              <button type="button" className={boton} onClick={() => { setCreando(true); setFallo(null); }}>
                <Plus size={13} weight="bold" /> Nueva
              </button>
            )}
          </div>
        </div>

        {creando && (
          <div className="mt-3 rounded-lg border border-border bg-muted/40 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-muted-foreground">Nombre</span>
                <input className={campo} value={nueva.nombre} placeholder="Convocatoria CETLAT"
                  onChange={(e) => setNueva((n) => ({ ...n, nombre: e.target.value }))} />
              </label>
              {/* La convocatoria NO lleva descuento: «son aleatorias porque el
                  proceso de venta decide cuánto dar». Lo que lleva son los
                  topes, que es hasta dónde se puede llegar. */}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Tope formación nueva</span>
                <input type="number" min={0} max={100} className={campo} value={nueva.tope_nueva}
                  onChange={(e) => setNueva((n) => ({ ...n, tope_nueva: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted-foreground">Tope si ya está habilitada</span>
                <input type="number" min={0} max={100} className={campo} value={nueva.tope_habilitada}
                  onChange={(e) => setNueva((n) => ({ ...n, tope_habilitada: e.target.value }))} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-4">
                <span className="text-xs text-muted-foreground">Descripción</span>
                <input className={campo} value={nueva.descripcion}
                  onChange={(e) => setNueva((n) => ({ ...n, descripcion: e.target.value }))} />
              </label>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={crear}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary/40">
                Crear
              </button>
              <button type="button" className={boton} onClick={() => setCreando(false)}>Cancelar</button>
            </div>
          </div>
        )}

        {cargando ? (
          <div className="mt-3 h-16 animate-pulse rounded-lg bg-muted" />
        ) : campanas.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No hay ninguna convocatoria. {esAdmin ? 'Crea la primera con «Nueva».' : 'Pídele a un administrador que cree la primera.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {campanas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5">
                <span className="text-sm font-medium">{c.nombre}</span>
                {!c.activa && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">cerrada</span>
                )}
                <span className="text-xs text-muted-foreground">
                  topes {c.tope_nueva} % · {c.tope_habilitada} %
                </span>
                {c.ofrecimientos != null && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    ofrecida {c.ofrecimientos} {c.ofrecimientos === 1 ? 'vez' : 'veces'}
                  </span>
                )}
                {esAdmin && (
                  <button type="button" className={`${boton} ml-auto`} onClick={() => cambiarActiva(c)}>
                    {c.activa ? 'Cerrar' : 'Reabrir'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link to="/leads/cola" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
        Ver la cola del día <CaretRight size={12} weight="bold" />
      </Link>
    </div>
  );
}
