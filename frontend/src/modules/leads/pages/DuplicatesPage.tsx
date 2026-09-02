// #102 · Repaso de duplicados sobre lo que YA está guardado.
//
// No es la cola de revisión (#13): aquella solo recoge lo que entra por el
// webhook, y en el momento de entrar. Esta repasa toda la base del proyecto,
// que es donde están los que se escaparon — sobre todo los que se completaron
// a mano después de crearse.
//
// Dos fichas caen en el mismo grupo si comparten correo, teléfono o usuario de
// WhatsApp, y el grupo se encadena: si A comparte el correo con B y B el
// teléfono con C, las tres son la misma persona y se fusionan de una vez.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowsClockwise, GitMerge, Warning, MagnifyingGlass, CheckCircle,
  ArrowSquareOut, Phone, EnvelopeSimple, WhatsappLogo, Crown,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';

const RUTA_FICHA = '/leads';

interface LeadDup {
  id: number;
  nombre: string | null;
  email: string | null;
  telefono: string | null;
  whatsapp_usuario: string | null;
  status: string | null;
  created_at: string;
  lead_duplicado_de: number | null;
  responsable_nombre: string | null;
  producto_nombre: string | null;
  n_interacciones: string | number;
  n_conversiones: string | number;
}

interface Grupo {
  key: string;
  motivos: string[];
  total: number;
  ya_marcado: boolean;
  con_conversion: number;
  leads: LeadDup[];
}

const ETIQUETA_MOTIVO: Record<string, { texto: string; Icono: typeof Phone }> = {
  correo: { texto: 'mismo correo', Icono: EnvelopeSimple },
  telefono: { texto: 'mismo teléfono', Icono: Phone },
  whatsapp: { texto: 'mismo usuario de WhatsApp', Icono: WhatsappLogo },
};

function fecha(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Por defecto se queda la que tiene ventas; si ninguna o varias las tienen, la
// más antigua. Nunca se propone cerrar una ficha con dinero detrás.
function porDefecto(g: Grupo): number {
  const conVenta = g.leads.filter((l) => Number(l.n_conversiones) > 0);
  const lista = conVenta.length ? conVenta : g.leads;
  return lista.reduce((a, b) => (new Date(a.created_at) <= new Date(b.created_at) ? a : b)).id;
}

export default function DuplicatesPage() {
  const { activeProject } = useAuth() as { activeProject: { id?: number; nombre?: string } | null };
  const projectId = activeProject?.id;

  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [soloSinMarcar, setSoloSinMarcar] = useState(false);
  const [sequeda, setSequeda] = useState<Record<string, number>>({});
  const [fuera, setFuera] = useState<Record<string, number[]>>({});
  const [comentario, setComentario] = useState<Record<string, string>>({});
  const [fusionando, setFusionando] = useState<string | null>(null);

  function load() {
    if (!projectId) return;
    setLoading(true);
    client.get<Grupo[]>('/leads/duplicados', { params: { projectId } })
      .then((r: any) => {
        const gs: Grupo[] = r?.data || [];
        setGrupos(gs);
        const elegidos: Record<string, number> = {};
        const excluidos: Record<string, number[]> = {};
        for (const g of gs) {
          elegidos[g.key] = porDefecto(g);
          excluidos[g.key] = [];
        }
        setSequeda(elegidos);
        setFuera(excluidos);
      })
      .catch(() => setGrupos([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return grupos.filter((g) => {
      if (soloSinMarcar && g.ya_marcado) return false;
      if (!q) return true;
      return g.leads.some((l) => [l.nombre, l.email, l.telefono, l.whatsapp_usuario, String(l.id)]
        .some((v) => (v || '').toString().toLowerCase().includes(q)));
    });
  }, [grupos, busca, soloSinMarcar]);

  function aFusionar(g: Grupo): number[] {
    const gana = sequeda[g.key];
    const excluidos = fuera[g.key] || [];
    return g.leads.map((l) => l.id).filter((id) => id !== gana && !excluidos.includes(id));
  }

  async function fusionar(g: Grupo) {
    const gana = sequeda[g.key];
    const cierran = aFusionar(g);
    const nota = (comentario[g.key] || '').trim();
    if (!cierran.length) {
      toast({ title: 'No hay nada que fusionar', description: 'Deja al menos una ficha marcada para cerrar.', variant: 'destructive' });
      return;
    }
    if (nota.length < 3) {
      toast({ title: 'Falta el motivo', description: 'Escribe por qué son la misma persona (mínimo 3 caracteres).', variant: 'destructive' });
      return;
    }
    setFusionando(g.key);
    try {
      await client.post(`/leads/${gana}/merge`, { loser_ids: cierran, comment: nota });
      toast({
        title: 'Fusionadas',
        description: `${cierran.length} ficha${cierran.length > 1 ? 's' : ''} cerrada${cierran.length > 1 ? 's' : ''} en el lead #${gana}. El historial se ha movido entero.`,
      });
      setGrupos((prev) => prev.filter((x) => x.key !== g.key));
    } catch (err: any) {
      toast({
        title: 'No se pudo fusionar',
        description: err?.data?.error || err?.message || 'fallo desconocido',
        variant: 'destructive',
      });
    } finally { setFusionando(null); }
  }

  if (!projectId || projectId === -1) {
    return (
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg p-6 text-center text-sm text-amber-800 dark:text-amber-300">
        Selecciona un proyecto para repasar sus duplicados.
      </div>
    );
  }

  const sinMarcar = grupos.filter((g) => !g.ya_marcado).length;
  const deTresOMas = grupos.filter((g) => g.total > 2).length;

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Duplicados</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Fichas de <strong>{activeProject?.nombre}</strong> que comparten correo, teléfono o usuario de
          WhatsApp con otra. Elige cuál se queda y fusiona: el historial completo —interacciones,
          recordatorios, ventas, matrículas, correos y el chat de WhatsApp— se mueve a la que se queda,
          y las demás van a la papelera apuntando a ella.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: grupos.length, t: 'grupos', d: 'personas con más de una ficha' },
          { n: grupos.reduce((s, g) => s + g.total, 0), t: 'fichas', d: 'implicadas en total' },
          { n: sinMarcar, t: 'sin revisar', d: 'nadie las ha marcado aún' },
          { n: deTresOMas, t: 'de tres o más', d: 'no se podían fusionar antes' },
        ].map((k) => (
          <div key={k.t} className="bg-card border border-border rounded-lg p-3">
            <div className="text-2xl font-bold tabular-nums">{k.n}</div>
            <div className="text-xs font-semibold text-foreground">{k.t}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{k.d}</div>
          </div>
        ))}
      </div>

      <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <MagnifyingGlass size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre, correo, teléfono o número de ficha"
            className="w-full h-9 pl-8 pr-3 rounded-md border border-border bg-background text-sm"
          />
        </div>
        <label className="h-9 px-3 rounded-md border border-border bg-background text-sm flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={soloSinMarcar} onChange={(e) => setSoloSinMarcar(e.target.checked)} />
          Solo los que nadie ha revisado
        </label>
        <button onClick={load} className="h-9 px-3 rounded-md border border-border bg-card text-sm hover:bg-muted flex items-center gap-1.5">
          <ArrowsClockwise size={14} /> Refrescar
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 bg-muted/40 rounded animate-pulse" />)}
        </div>
      ) : visibles.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-10 text-center text-muted-foreground">
          <CheckCircle size={40} weight="duotone" className="mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-semibold">
            {grupos.length === 0 ? 'Ninguna ficha repetida en este proyecto' : 'Nada que encaje con el filtro'}
          </p>
          <p className="text-xs mt-1">Se comprueba correo, teléfono normalizado y usuario de WhatsApp.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibles.map((g) => {
            const gana = sequeda[g.key];
            const cierran = aFusionar(g);
            const excluidos = fuera[g.key] || [];
            const ventasQueSeCierran = g.leads.filter((l) => cierran.includes(l.id) && Number(l.n_conversiones) > 0);

            return (
              <div key={g.key} className="bg-card border border-border rounded-lg overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold">{g.total} fichas</span>
                  {g.motivos.map((m) => {
                    const e = ETIQUETA_MOTIVO[m];
                    if (!e) return null;
                    return (
                      <span key={m} className="text-[11px] px-2 py-0.5 rounded-full bg-background border border-border flex items-center gap-1">
                        <e.Icono size={12} /> {e.texto}
                      </span>
                    );
                  })}
                  {g.ya_marcado && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                      ya marcado como duplicado
                    </span>
                  )}
                  {g.con_conversion > 0 && (
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                      {g.con_conversion} con venta
                    </span>
                  )}
                </div>

                <div className="divide-y divide-border">
                  {g.leads.map((l) => {
                    const esLaQueSeQueda = l.id === gana;
                    const seCierra = cierran.includes(l.id);
                    return (
                      <div
                        key={l.id}
                        className={`px-4 py-3 flex items-start gap-3 ${
                          esLaQueSeQueda ? 'bg-emerald-50/50 dark:bg-emerald-950/20' : seCierra ? '' : 'opacity-50'
                        }`}
                      >
                        <label className="flex items-center pt-0.5 cursor-pointer" title="Esta es la ficha que se queda">
                          <input
                            type="radio"
                            name={`gana-${g.key}`}
                            checked={esLaQueSeQueda}
                            onChange={() => setSequeda((p) => ({ ...p, [g.key]: l.id }))}
                          />
                        </label>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            {esLaQueSeQueda && <Crown size={14} weight="fill" className="text-emerald-600 dark:text-emerald-400" />}
                            <Link
                              to={`${RUTA_FICHA}/${l.id}`}
                              target="_blank"
                              className="font-semibold text-sm hover:underline flex items-center gap-1"
                            >
                              {l.nombre || '(sin nombre)'} <ArrowSquareOut size={12} />
                            </Link>
                            <span className="text-[11px] text-muted-foreground tabular-nums">#{l.id}</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{l.status || '—'}</span>
                            {Number(l.n_conversiones) > 0 && (
                              <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 font-semibold">
                                {l.n_conversiones} venta{Number(l.n_conversiones) > 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                            <span>{l.email || 'sin correo'}</span>
                            <span>{l.telefono || 'sin teléfono'}</span>
                            {l.whatsapp_usuario && <span>@{l.whatsapp_usuario}</span>}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 flex flex-wrap gap-x-4">
                            <span>alta {fecha(l.created_at)}</span>
                            <span>{l.responsable_nombre || 'sin gestora'}</span>
                            <span>{l.producto_nombre || 'sin producto'}</span>
                            <span>{l.n_interacciones} interacciones</span>
                          </div>
                        </div>

                        {!esLaQueSeQueda && (
                          <label className="text-[11px] flex items-center gap-1.5 cursor-pointer select-none whitespace-nowrap pt-0.5">
                            <input
                              type="checkbox"
                              checked={seCierra}
                              onChange={(e) => setFuera((p) => ({
                                ...p,
                                [g.key]: e.target.checked
                                  ? (p[g.key] || []).filter((x) => x !== l.id)
                                  : [...(p[g.key] || []), l.id],
                              }))}
                            />
                            fusionar
                          </label>
                        )}
                      </div>
                    );
                  })}
                </div>

                {ventasQueSeCierran.length > 0 && (
                  <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-t border-amber-200 dark:border-amber-900 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
                    <Warning size={15} className="flex-none mt-0.5" />
                    <span>
                      {ventasQueSeCierran.length === 1 ? 'Una de las fichas que vas a cerrar tiene venta' : `${ventasQueSeCierran.length} de las fichas que vas a cerrar tienen ventas`}.
                      No se pierde nada —las ventas pasan a la ficha #{gana}— pero comprueba que de verdad es la misma persona.
                    </span>
                  </div>
                )}

                <div className="px-4 py-3 border-t border-border bg-muted/20 flex items-center gap-2 flex-wrap">
                  <input
                    value={comentario[g.key] || ''}
                    onChange={(e) => setComentario((p) => ({ ...p, [g.key]: e.target.value }))}
                    placeholder="Por qué son la misma persona (queda en el historial de todas)"
                    className="flex-1 min-w-[240px] h-9 px-3 rounded-md border border-border bg-background text-sm"
                  />
                  <button
                    onClick={() => fusionar(g)}
                    disabled={fusionando === g.key || !cierran.length}
                    className="h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
                  >
                    <GitMerge size={15} />
                    {fusionando === g.key
                      ? 'Fusionando…'
                      : `Fusionar ${cierran.length} en #${gana}`}
                  </button>
                  {excluidos.length > 0 && (
                    <span className="text-[11px] text-muted-foreground">
                      {excluidos.length} se queda{excluidos.length > 1 ? 'n' : ''} aparte
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
