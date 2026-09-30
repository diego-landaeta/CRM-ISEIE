import { useCallback, useEffect, useState } from 'react';
import {
  Plus, PlugsConnected, ArrowClockwise, Trash, PencilSimple,
  CheckCircle, XCircle, WarningCircle, Clock, MagicWand, DownloadSimple,
  Question, ArrowSquareOut, ShoppingBag, Robot,
} from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProyectosDelAmbito } from '@/shared/hooks/useAmbito';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';
import {
  conectoresApi, TIPOS, DESTINOS, type Conector,
} from '../api/connectors.api';
import DialogoConector from '../components/DialogoConector';
import ParaQuien from '../components/ParaQuien';
import { lista } from '@/shared/lib/lista';
import PanelMapeo from '../components/PanelMapeo';

/**
 * Conectores (#6). Desde el 29/09 en Conexión → Conectores, no en Captación:
 * «todo lo que sea conexión con WordPress y eso pase allí, a la sección de
 * conexión del menú». Las conexiones de Claude, en Conexión → MCP.
 *
 * Funciona con un campus, con una empresa y con «Todos los proyectos» arriba:
 * el super admin ve todo; un admin, lo de sus campus y sus empresas.
 *
 * Traer al CRM lo que ya existe fuera —los productos de una tienda WooCommerce,
 * las entradas de un WordPress— sin copiarlo a mano.
 *
 * El backend estaba hecho desde `bcf9c3e` y no habia forma de usarlo: ni
 * pantalla, ni modulo en el frontend. Esto es la puerta.
 *
 * QUE LA DISTINGUE DE LAS OTRAS CUATRO (#131)
 *
 * Diego, mirando /testeo: «no entiendo que hacen ahi, y le doy a nuevo conector
 * y no entiendo, porque no es como los otros». Hay cinco sitios en el CRM que
 * dicen casi la misma frase —Formularios, Make, Webhooks, Conectores y la
 * pantalla de WooCommerce— y ninguno decia en que se diferencia. «Entradas de
 * fuera» y «traer datos de fuera» son la misma frase.
 *
 * La division que importa es quien da el primer paso:
 *
 *   RECIBEN, alguien de fuera empuja      Formularios · Make · Webhooks
 *   VAN A BUSCAR, el CRM tira             Conectores · WooCommerce
 *
 * Eso es lo que ahora dice la pantalla cuando esta vacia, en vez de repetir la
 * frase que ya dicen las otras. Y por eso se enlaza a Webhooks: quien llega
 * aqui buscando «que me avisen cuando entre un prospecto» esta en la puerta
 * equivocada, y decirselo cuesta una linea.
 */

const nombreTipo = (t: string) => TIPOS.find((x) => x.id === t)?.label || t;
const nombreDestino = (d: string) => DESTINOS.find((x) => x.id === d)?.label || d;

/** «hace 12 min», «hace 5 meses», «nunca». */
function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 31) return `hace ${d} día${d > 1 ? 's' : ''}`;
  return `hace ${Math.floor(d / 30)} meses`;
}

/** Como fue la ultima importacion, dicho y con color. */
function Estado({ c }: { c: Conector }) {
  if (!c.last_sync_at) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock size={13} /> Sin importar todavía
      </span>
    );
  }
  const cuantos = c.last_sync_count ?? 0;
  if (c.last_sync_status === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <CheckCircle size={13} weight="fill" /> {cuantos} traídos · {hace(c.last_sync_at)}
      </span>
    );
  }
  if (c.last_sync_status === 'partial') {
    // «0 traídos, hubo fallos» tiene que leerse distinto de «12 traídos, hubo
    // fallos»: en el primero no entró NADA y el mensaje no puede sonar a que sí.
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <WarningCircle size={13} weight="fill" />
        {cuantos === 0
          ? `No entró ninguno: todos fallaron · ${hace(c.last_sync_at)}`
          : `${cuantos} traídos, algunos fallaron · ${hace(c.last_sync_at)}`}
      </span>
    );
  }
  if (c.last_sync_status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
        <XCircle size={13} weight="fill" /> Falló · {hace(c.last_sync_at)}
      </span>
    );
  }
  // «No sé qué pasó» y «falló» no son lo mismo, y el primero no debe alarmar
  // (#131). Antes el rojo era el caso por defecto: cualquier valor que la
  // pantalla no conociera se pintaba como fallo. Diego sembró un conector de
  // prueba con `last_sync_status = 'ok'` —los buenos son success, partial y
  // error— y la pantalla dijo «Falló» de algo que nunca llegó a fallar.
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Question size={13} /> Terminó, pero no se sabe cómo · {hace(c.last_sync_at)}
    </span>
  );
}

/**
 * Lo que esta pantalla NO es, que es lo que hacía falta decir (#131).
 *
 * Sale solo con la lista vacía: quien ya tiene conectores funcionando no
 * necesita que le expliquen dónde está. Quien llega por primera vez, sí — y
 * llega desde un menú donde cinco entradas dicen casi lo mismo.
 */
function QueNoEsEsto() {
  return (
    <div className="mx-auto max-w-xl space-y-2">
      <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">
        Si buscabas otra cosa
      </p>

      <Link
        to="/captacion/webhooks"
        className="flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted"
      >
        <ArrowSquareOut size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-xs">
          <span className="block font-semibold">Que te avisen cuando entre un prospecto → Webhooks</span>
          <span className="block text-muted-foreground">
            Ahí el de fuera empuja y el CRM espera. Aquí es al revés: el CRM va a buscar,
            cuando tú le das a importar.
          </span>
        </span>
      </Link>

      <Link
        to="/conexion/mcp"
        className="flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted"
      >
        <Robot size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-xs">
          <span className="block font-semibold">Consultar el CRM desde Claude → Conexión → MCP</span>
          <span className="block text-muted-foreground">
            Las conexiones de Claude, con su URL, para quién son y quién las creó, están allí.
          </span>
        </span>
      </Link>

      <Link
        to="/productos/woocommerce"
        className="flex items-start gap-3 rounded-md border border-border bg-card p-3 transition-colors hover:bg-muted"
      >
        <ShoppingBag size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 text-xs">
          <span className="block font-semibold">Una tienda WooCommerce → tiene su propia pantalla</span>
          <span className="block text-muted-foreground">
            Trae lo mismo que un conector y además sincroniza sola cada X minutos y saca
            el temario de la ficha del curso. Un conector de WooCommerce importa cuando
            se lo pides, y nada más.
          </span>
        </span>
      </Link>
    </div>
  );
}

export default function ConnectorsPage() {
  const { activeProject, activeIssuerId, activeIssuer, isAllProjects } = useProjectContext() as {
    activeProject: { id: number; nombre?: string } | null;
    activeIssuerId: number | null;
    activeIssuer: { nombre?: string } | null;
    isAllProjects: boolean;
  };
  // Con una EMPRESA puesta (Diego, 29/09: «no puedo estar con la empresa»),
  // los conectores de todos sus campus, cada uno con el suyo al lado. Con
  // «Todos los proyectos», todo lo que la persona puede ver.
  const conEmpresa = Boolean(activeIssuerId);
  const { user, projects } = useAuth() as {
    user: { role?: string } | null;
    projects: Array<{ id: number; nombre: string; sociedad_emisora_id?: number | null; sociedad_nombre?: string | null }>;
  };
  const campus = useProyectosDelAmbito<{ id: number; nombre: string; sociedad_emisora_id?: number | null }>();
  const projectId = !conEmpresa && !isAllProjects && activeProject?.id && activeProject.id !== TODOS_LOS_PROYECTOS ? activeProject.id : null;
  // Con más de un campus a la vista, cada conector dice de cuál es.
  const variosCampus = !projectId;

  const [conectores, setConectores] = useState<Conector[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `undefined` = cerrado; `null` = alta; un conector = cambio.
  const [editando, setEditando] = useState<Conector | null | undefined>(undefined);
  const [mapeando, setMapeando] = useState<Conector | null>(null);
  const [importando, setImportando] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await conectoresApi.listar(
        ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject: projectId ? { id: projectId } : null }),
        'datos',
      );
      if (r.success) setConectores(lista<Conector>(r.data));
      else setError(r.error || 'No se pudieron cargar los conectores');
    } catch (e: any) {
      setError(e?.message || 'No se pudieron cargar los conectores');
    } finally { setCargando(false); }
  }, [activeIssuerId, projectId]);

  useEffect(() => { cargar(); }, [cargar]);

  async function borrar(c: Conector) {
    // Se pregunta con el nombre delante. Borrar un conector no borra lo ya
    // importado, y eso conviene decirlo o parece que se lleva los productos.
    if (!window.confirm(
      `Se va a borrar el conector «${c.label}».\n\n`
      + 'Lo que ya se importó se queda en el CRM; lo que deja de funcionar es traer más. ¿Seguir?'
    )) return;
    try {
      const r = await conectoresApi.borrar(c.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      toast({ title: 'Conector borrado' });
      cargar();
    } catch (e: any) {
      toast({ title: 'No se pudo borrar', description: e?.message, variant: 'destructive' });
    }
  }

  /**
   * Lanza la importacion.
   *
   * El servidor contesta 202 en seguida y sigue por su cuenta, asi que el estado
   * no llega en la respuesta: se relee la lista a los pocos segundos. Se avisa de
   * que puede tardar en vez de dejar un boton girando sin explicacion.
   */
  async function importar(c: Conector) {
    if (!Object.keys(c.field_mapping || {}).length) {
      toast({
        title: 'Antes hay que mapear',
        description: 'Sin decir a qué campo va cada dato, la importación no puede crear nada.',
        variant: 'destructive',
      });
      setMapeando(c);
      return;
    }
    setImportando(c.id);
    try {
      const r = await conectoresApi.importar(c.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo lanzar');
      toast({
        title: 'Importación lanzada',
        description: 'Va por detrás. El resultado aparece aquí en cuanto termine.',
      });
      // Dos releidas: una pronto por si fue rapido, otra por si no.
      setTimeout(cargar, 3000);
      setTimeout(() => { cargar(); setImportando(null); }, 12000);
    } catch (e: any) {
      toast({ title: 'No se pudo lanzar', description: e?.message, variant: 'destructive' });
      setImportando(null);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Conectores"
        // «Traer datos de fuera» era la misma frase que dice Webhooks («entradas
        // de fuera») en el menú. Lo que las separa es quién da el primer paso.
        subtitle={`WordPress, tiendas y APIs: el CRM va a buscar fuera lo que ya está escrito allí · ${conEmpresa
          ? `${activeIssuer?.nombre || 'Empresa'} · ${campus.length} campus`
          : projectId ? activeProject?.nombre || '' : 'Todos los proyectos'}`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={cargar} disabled={cargando}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold hover:bg-muted disabled:opacity-50">
              <ArrowClockwise size={15} className={cargando ? 'animate-spin' : ''} /> Actualizar
            </button>
            <button type="button" onClick={() => setEditando(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
              <Plus size={15} weight="bold" /> Nuevo conector
            </button>
          </div>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200/60 dark:border-red-800/40 bg-red-50 dark:bg-red-950/30 px-3 py-2 text-sm">
          <XCircle size={16} weight="fill" className="text-red-600 shrink-0" /> {error}
        </div>
      )}

      {cargando && !conectores.length ? (
        <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : !conectores.length ? (
        <>
          <EmptyState
            icon={PlugsConnected}
            title="Todavía no hay conectores"
            description="Un conector va a buscar a otro sitio lo que ya tienes escrito allí y lo trae al CRM. Por ejemplo: los cursos de tu tienda WooCommerce pasan al catálogo sin copiarlos a mano, uno por uno."
            action={
              <button type="button" onClick={() => setEditando(null)}
                className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90">
                <Plus size={15} weight="bold" /> Crear el primero
              </button>
            }
          />
          <QueNoEsEsto />
        </>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {conectores.map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-card shadow-sm p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <PlugsConnected size={18} weight="duotone" className="text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{c.label}</h3>
                    {/* De quién es: todo el sistema, una empresa entera o un campus. */}
                    {(c.alcance !== 'campus' || variosCampus) && <ParaQuien c={c} />}
                    {!c.active && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        Apagado
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {nombreTipo(c.type)} → {nombreDestino(c.destination)}
                    {c.alcance && c.alcance !== 'campus' && c.proyecto && ` · por defecto a ${c.proyecto}`}
                  </p>
                  {c.config?.base_url && (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5 truncate">{c.config.base_url}</p>
                  )}
                  {c.creado_por && (
                    <p className="text-[11px] text-muted-foreground/80 mt-0.5">Creado por {c.creado_por}</p>
                  )}
                </div>
                {c.puede_tocar !== false && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" title="Editar" onClick={() => setEditando(c)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                      <PencilSimple size={15} />
                    </button>
                    <button type="button" title="Borrar" onClick={() => borrar(c)}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-red-600 hover:bg-muted">
                      <Trash size={15} />
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                <Estado c={c} />
                <div className="flex items-center gap-1.5 shrink-0">
                  <button type="button" onClick={() => setMapeando(c)}
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-bold hover:bg-muted">
                    <MagicWand size={12} /> Probar y mapear
                  </button>
                  <button type="button" onClick={() => importar(c)} disabled={importando === c.id}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2 text-[11px] font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                    <DownloadSimple size={12} /> {importando === c.id ? 'Importando…' : 'Importar'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {mapeando && (
        <PanelMapeo
          conector={mapeando}
          onCerrar={() => setMapeando(null)}
          onCambiado={() => { setMapeando(null); cargar(); }}
        />
      )}

      {editando !== undefined && (
        <DialogoConector
          conector={editando}
          projectId={projectId}
          issuerId={activeIssuerId}
          proyectos={projects || []}
          esSuperadmin={user?.role === 'superadmin'}
          onCerrar={() => setEditando(undefined)}
          onGuardado={() => {
            setEditando(undefined);
            cargar();
          }}
        />
      )}
    </div>
  );
}
