import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowClockwise, DownloadSimple, MagnifyingGlass, WarningCircle,
  ArrowSquareOut, Info, CheckCircle, XCircle,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { toast } from '@/shared/hooks/useToast';
import client from '@/shared/api/client';
import { registroApi, type SucesoDelRegistro, type Fuente } from '../api/registro.api';

/**
 * El registro del sistema (#111).
 *
 * Dos vistas, y no es una preferencia de pintar: en «general» se busca a quien
 * hizo algo, y con los webhooks y las tareas mezclados —que son miles de filas
 * al dia— lo que hizo una persona no se encuentra. En «todos» se busca lo
 * contrario: por que fallo algo, y ahi los sucesos del sistema son el dato.
 */

/**
 * Una lista, o una vacia. Nunca otra cosa.
 *
 * `setFuentes(r.data)` daba por hecho que el servidor manda un array. Si manda
 * cualquier otra cosa —un error con forma rara, una respuesta a medias, un 200
 * de un proxy— `fuentes.filter` revienta y la pantalla se queda EN BLANCO. No
 * un aviso: en blanco.
 *
 * Lo cazo el smoke de rutas de ISEIE:
 *
 *     TypeError: fuentes.filter is not a function
 *
 * Una pantalla de registro que se cae cuando algo va mal es justo la que no
 * sirve: se mira precisamente cuando algo va mal.
 */
const lista = <T,>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);

type Vista = 'general' | 'todos';

interface Usuario { id: number; nombre: string }

/** La hora, corta; la fecha solo si no es hoy. */
function cuandoBonito(iso: string): string {
  const d = new Date(iso);
  const hoy = new Date();
  const mismoDia = d.toDateString() === hoy.toDateString();
  const hora = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  if (mismoDia) return hora;
  return `${d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' })} ${hora}`;
}

/** El color de cada fuente, para reconocerla sin leer. */
const COLOR: Record<string, string> = {
  ficha: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  documento: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  usuario: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  tarea: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  webhook: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  error: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
};

export default function RegistroPage() {
  const [vista, setVista] = useState<Vista>('general');
  const [filas, setFilas] = useState<SucesoDelRegistro[]>([]);
  const [fuentes, setFuentes] = useState<Fuente[]>([]);
  const [elegidas, setElegidas] = useState<string[]>([]);
  const [sinTabla, setSinTabla] = useState<string[]>([]);
  const [fallaron, setFallaron] = useState<string[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [usuarioId, setUsuarioId] = useState<number | ''>('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [busca, setBusca] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierta, setAbierta] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);

  const filtros = useMemo(() => ({
    vista,
    desde: desde || undefined,
    hasta: hasta || undefined,
    usuarioId: usuarioId || undefined,
    fuentes: elegidas.length ? elegidas : undefined,
    busca: busca.trim() || undefined,
  }), [vista, desde, hasta, usuarioId, elegidas, busca]);

  // Se pide al servidor con un respiro, que si no cada tecla del buscador es
  // una consulta a seis tablas.
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await registroApi.listar(filtros);
      if (r.success) {
        setFilas(lista(r.data?.filas));
        setSinTabla(lista(r.data?.sinTabla));
        setFallaron(lista(r.data?.fallaron));
      } else {
        setError(r.error || 'No se pudo leer el registro');
      }
    } catch (e: any) {
      setError(e?.message || 'No se pudo leer el registro');
    } finally {
      setCargando(false);
    }
  }, [filtros]);

  useEffect(() => {
    if (reloj.current) clearTimeout(reloj.current);
    reloj.current = setTimeout(cargar, 300);
    return () => { if (reloj.current) clearTimeout(reloj.current); };
  }, [cargar]);

  useEffect(() => {
    registroApi.fuentes().then((r) => { if (r.success) setFuentes(lista(r.data)); }).catch(() => {});
    // Para el filtro de usuario. Si no se puede —permisos, o la pantalla se
    // abre sin ellos— el filtro se queda sin lista y los demas siguen.
    client.get('/users?limit=200')
      .then((r) => setUsuarios(lista(r?.data).map((u: any) => ({ id: u.id, nombre: u.nombre }))))
      .catch(() => {});
  }, []);

  // Las fuentes elegidas se limpian al cambiar de vista: quedarse con «tarea»
  // marcado al volver a «general» dejaba la lista vacia sin decir por que.
  const cambiarVista = (v: Vista) => { setVista(v); setElegidas([]); };

  const alternarFuente = (n: string) =>
    setElegidas((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const descargar = async () => {
    setBajando(true);
    try {
      await registroApi.descargarCsv(filtros);
      toast({ title: 'Registro descargado', description: 'Con los filtros que tienes puestos.' });
    } catch (e: any) {
      toast({ title: 'No se pudo descargar', description: e?.message || 'Inténtalo de nuevo', variant: 'destructive' });
    } finally {
      setBajando(false);
    }
  };

  const hayFiltro = Boolean(desde || hasta || usuarioId || elegidas.length || busca.trim());
  const delaVista = fuentes.filter((f) => (vista === 'todos' ? true : !f.sistema));

  return (
    <div className="space-y-4">
      <PageHeader
        title="Registro"
        subtitle="Qué ha pasado en el sistema, y quién lo hizo."
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={cargar} disabled={cargando}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border hover:bg-muted disabled:opacity-50">
              <ArrowClockwise size={15} className={cargando ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button type="button" onClick={descargar} disabled={bajando || !filas.length}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50">
              <DownloadSimple size={15} /> {bajando ? 'Preparando…' : 'Descargar CSV'}
            </button>
          </div>
        }
      />

      {/* Las dos vistas */}
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        {(['general', 'todos'] as Vista[]).map((v) => (
          <button key={v} type="button" onClick={() => cambiarVista(v)}
            className={`px-4 py-1.5 text-sm font-medium transition-colors ${
              vista === v ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
            {v === 'general' ? 'General' : 'Todos'}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        {vista === 'general'
          ? 'Lo que ha hecho una persona: cambios en fichas, documentos y accesos.'
          : 'Todo, incluidos los sucesos del sistema: tareas programadas, webhooks y errores.'}
      </p>

      {/* Los filtros */}
      <div className="rounded-xl border border-border bg-card p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Desde
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Hasta
            <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Usuario
            <select value={usuarioId} onChange={(e) => setUsuarioId(e.target.value ? Number(e.target.value) : '')}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-background min-w-[160px]">
              <option value="">Cualquiera</option>
              {usuarios.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground flex-1 min-w-[200px]">
            Buscar
            <span className="relative">
              <MagnifyingGlass size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)}
                placeholder="Un nombre, un campo, un error…"
                className="w-full text-sm pl-7 pr-2 py-1.5 rounded-md border border-border bg-background" />
            </span>
          </label>
          {hayFiltro && (
            <button type="button"
              onClick={() => { setDesde(''); setHasta(''); setUsuarioId(''); setElegidas([]); setBusca(''); }}
              className="text-xs text-muted-foreground hover:text-foreground underline py-2">
              Quitar filtros
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5">
          {delaVista.map((f) => (
            <button key={f.nombre} type="button" disabled={!f.disponible}
              onClick={() => alternarFuente(f.nombre)}
              title={f.disponible ? undefined : 'Falta la migración de esta fuente'}
              className={`text-xs px-2.5 py-1 rounded-full font-medium transition-colors ${
                elegidas.includes(f.nombre) ? COLOR[f.nombre] : 'bg-muted text-muted-foreground hover:bg-muted/70'
              } ${f.disponible ? '' : 'opacity-40 cursor-not-allowed line-through'}`}>
              {f.titulo}
            </button>
          ))}
        </div>
      </div>

      {/* Una fuente que no se puede leer se DICE. Sin esto, «no pasó nada» y
          «falta una migración» se leen igual. */}
      {sinTabla.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200/60 dark:border-amber-800/40 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-sm">
          <WarningCircle size={16} weight="fill" className="text-amber-600 mt-0.5 shrink-0" />
          <span>
            No se está mirando{' '}
            <strong>{sinTabla.map((n) => fuentes.find((f) => f.nombre === n)?.titulo || n).join(', ')}</strong>:
            falta aplicar su migración. Lo demás sí está completo.
          </span>
        </div>
      )}

      {/* Una consulta que revienta NO es un dia tranquilo.
          Paso de verdad: se pedia `w.nombre` y la columna es `w.label`, asi que
          la fuente devolvia cero filas y la pantalla la enseñaba como una mas.
          Cero filas es justo lo que se espera ver a veces, por eso no lo vio
          nadie. Ahora se dice. */}
      {fallaron.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200/60 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm">
          <XCircle size={16} weight="fill" className="text-red-600 mt-0.5 shrink-0" />
          <span>
            No se ha podido leer{' '}
            <strong>{fallaron.map((n) => fuentes.find((f) => f.nombre === n)?.titulo || n).join(', ')}</strong>.
            Lo que ves está <strong>incompleto</strong>: falta lo de esa fuente, no es que no haya pasado nada.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200/60 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm">
          <XCircle size={16} weight="fill" className="text-red-600 shrink-0" /> {error}
        </div>
      )}

      {/* La lista */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {cargando && !filas.length ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Leyendo el registro…</p>
        ) : !filas.length ? (
          <div className="p-8 text-center space-y-1">
            <p className="text-sm font-medium">No hay nada que enseñar</p>
            <p className="text-xs text-muted-foreground">
              {hayFiltro
                ? 'Con estos filtros no sale nada. Prueba a quitar alguno.'
                : 'Todavía no ha pasado nada que deje rastro.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="text-left font-medium px-3 py-2 w-[110px]">Cuándo</th>
                  <th className="text-left font-medium px-3 py-2 w-[110px]">Dónde</th>
                  <th className="text-left font-medium px-3 py-2 w-[140px]">Quién</th>
                  <th className="text-left font-medium px-3 py-2">Qué pasó</th>
                  <th className="w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id}
                    className={`border-t border-border align-top ${f.ok ? '' : 'bg-red-50/50 dark:bg-red-950/10'}`}>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap"
                      title={new Date(f.cuando).toLocaleString('es-ES')}>
                      {cuandoBonito(f.cuando)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${COLOR[f.fuente] || 'bg-muted'}`}>
                        {fuentes.find((x) => x.nombre === f.fuente)?.titulo || f.fuente}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {f.usuario || <span className="text-muted-foreground italic">el sistema</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-start gap-1.5">
                        {!f.ok && <XCircle size={14} weight="fill" className="text-red-600 mt-0.5 shrink-0" />}
                        <span>{f.resumen}</span>
                      </span>
                      {abierta === f.id && f.detalle && (
                        <pre className="mt-1.5 text-[11px] bg-muted rounded-md p-2 overflow-x-auto">
                          {JSON.stringify(f.detalle, null, 2)}
                        </pre>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {f.detalle && (
                        <button type="button" title="Ver el detalle"
                          onClick={() => setAbierta((p) => (p === f.id ? null : f.id))}
                          className="text-muted-foreground hover:text-foreground">
                          <Info size={15} />
                        </button>
                      )}
                      {f.enlace && (
                        <Link to={f.enlace.replace(/^\/crm/, '')} title="Ir a la ficha"
                          className="ml-1 inline-block text-muted-foreground hover:text-foreground">
                          <ArrowSquareOut size={15} />
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filas.length > 0 && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <CheckCircle size={13} /> {filas.length} sucesos, los más recientes primero.
          {filas.length >= 100 && ' Hay más: afina con los filtros o descarga el CSV.'}
        </p>
      )}
    </div>
  );
}
