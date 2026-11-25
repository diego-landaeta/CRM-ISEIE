import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, WarningCircle, GearSix, MagnifyingGlass } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ambitoComoObjeto } from '@/shared/lib/ambitoInforme';
import { cn } from '@/shared/lib/utils';
import { inputClass } from '@/shared/lib/ui';
import { apostillasApi, type Apostilla, type AjusteApostillas } from '../api/apostillas.api';
import { ESTADOS, textoDelEstado, estaAtascada, diasTexto, eur, type EstadoApostilla } from '../lib/apostillas';
import BarraDePasos from '../components/BarraDePasos';
import ApostillaDialog from '../components/ApostillaDialog';
import CifrasApostillas from '../components/CifrasApostillas';

/*
  Clientes › Apostillas de La Haya (CRM#1130 / CRM-ISEIE#786).

  Diego, 25/11/2026: la ven todos los que entran al CRM (no tutores,
  colaboradores ni redactoras), es un producto propio que se mide (cuántas,
  cuánto dinero, por campus, mes y estado) y «que se vea simple»: cada
  apostilla con su barra de pasos y, si lleva los días del aviso en el mismo
  paso, en amarillo (y el aviso en la campana de su gestora).

  Dos pestañas: «Todas» y «Sin asociar» (cobros de un link de Stripe que no se
  sabe de quién son). La ficha se abre también con ?id= (el enlace de la
  campana). Qué puede cambiar cada uno lo dice el servidor en cada fila.
*/

type Pestana = 'todas' | 'sin_asociar';
const LIMITE = 50;

export default function ApostillasPage() {
  const { can } = usePermission();
  const { activeProject, activeIssuerId, projects } = useProjectContext() as {
    activeProject: { id: number | null } | null; activeIssuerId: number | null;
    projects: Array<{ id: number; nombre: string; type?: string }>;
  };
  const ambito = useMemo(() => ambitoComoObjeto({ activeIssuerId, activeProject }) as Record<string, number>,
    [activeIssuerId, activeProject]);
  const [params, setParams] = useSearchParams();
  const abierta = Number(params.get('id')) || null;

  const [pestana, setPestana] = useState<Pestana>('todas');
  const [estado, setEstado] = useState<EstadoApostilla | ''>('');
  const [q, setQ] = useState('');
  const [mias, setMias] = useState(false);
  const [atascadas, setAtascadas] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<Apostilla[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [nueva, setNueva] = useState<{ projectId: string; leadId: string; formacion: string } | null>(null);
  const [ajustes, setAjustes] = useState<AjusteApostillas[] | null>(null);

  const puedeGestionar = can('apostillas.edit');
  const puedeAsociar = can('apostillas.asociar');
  const puedeConfigurar = can('apostillas.config');
  const clave = JSON.stringify(ambito);

  const cargar = useCallback(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    apostillasApi.listar({
      estado, q: q.trim() || undefined, mias, atascadas, sinAsociar: pestana === 'sin_asociar', page: pagina, limit: LIMITE,
    }, ambito)
      .then((r) => { if (!vivo) return; setFilas(r?.data || []); setTotal(r?.pagination?.total || 0); })
      .catch((e: { data?: { error?: string }; message?: string }) => { if (vivo) setError(e?.data?.error || e?.message || 'No se pudieron cargar'); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, q, mias, atascadas, pestana, pagina, clave]);

  useEffect(() => cargar(), [cargar, recarga]);
  useEffect(() => { setPagina(1); }, [estado, q, mias, atascadas, pestana, clave]);

  function abrir(id: number | null) {
    const p = new URLSearchParams(params);
    if (id) p.set('id', String(id)); else p.delete('id');
    setParams(p, { replace: true });
  }

  async function crear() {
    if (!nueva) return;
    const projectId = Number(nueva.projectId || (activeProject?.id && activeProject.id > 0 ? activeProject.id : 0));
    if (!projectId) { toast({ title: 'Elige el campus', variant: 'destructive' }); return; }
    try {
      const r = await apostillasApi.crear({
        projectId, leadId: nueva.leadId ? Number(nueva.leadId) : null, formacion: nueva.formacion.trim() || null,
      });
      setNueva(null);
      setRecarga((n) => n + 1);
      if (r?.data?.id) abrir(r.data.id);
      toast({ title: 'Apostilla creada' });
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo crear', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  async function verAjustes() {
    if (ajustes) { setAjustes(null); return; }
    try { setAjustes((await apostillasApi.ajustes())?.data || []); } catch { setAjustes([]); }
  }

  async function guardarDias(projectId: number, dias: number) {
    try {
      await apostillasApi.guardarAjustes(projectId, dias);
      setAjustes((xs) => (xs || []).map((x) => (x.project_id === projectId ? { ...x, dias_aviso: dias } : x)));
      toast({ title: `El aviso salta a los ${dias} días` });
      setRecarga((n) => n + 1);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  const campusElegibles = (projects || []).filter((p) => p.id > 0 && p.type !== 'ia');
  const paginas = Math.max(1, Math.ceil(total / LIMITE));
  // La clase del campo vive en un solo sitio (#106): aquí solo se ajusta el alto y el ancho.
  const campo = cn(inputClass, 'h-8 px-2 w-auto');

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Apostillas de La Haya"
        subtitle="Cada apostilla vendida, en qué paso va y quién la lleva. Al alumno no se le escribe nada: los avisos son para el equipo."
        actions={(
          <div className="flex flex-wrap gap-2">
            {puedeConfigurar && (
              <button type="button" onClick={verAjustes}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md border border-border text-[12px] font-semibold hover:bg-muted">
                <GearSix size={14} /> Aviso de atascadas
              </button>
            )}
            {puedeAsociar && (
              <button type="button" onClick={() => setNueva(nueva ? null : { projectId: '', leadId: '', formacion: '' })}
                className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold">
                <Plus size={14} weight="bold" /> Nueva apostilla
              </button>
            )}
          </div>
        )}
      />

      {ajustes && (
        <section className="rounded-md border border-border bg-card p-3 space-y-2 text-sm" aria-label="Aviso de atascadas">
          <p className="text-[12px] text-muted-foreground">
            Si una apostilla lleva estos días en el mismo paso (sin contar Entregada ni Cancelada), le llega un aviso en la campana a su gestora
            (o a los admins si no tiene), y otro cada tantos días mientras siga igual.
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {ajustes.map((x) => (
              <li key={x.project_id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate">{x.campus}</span>
                <select className={campo} value={x.dias_aviso} aria-label={`Días del aviso en ${x.campus}`}
                  onChange={(e) => guardarDias(x.project_id, Number(e.target.value))}>
                  {[3, 5, 7, 10, 14, 21, 30].concat([x.dias_aviso]).filter((v, i, a) => a.indexOf(v) === i).sort((m, n) => m - n)
                    .map((d) => <option key={d} value={d}>{d} días</option>)}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {nueva && (
        <section className="rounded-md border border-border bg-card p-3 space-y-2 text-sm" aria-label="Nueva apostilla">
          <p className="text-[12px] text-muted-foreground">
            Para una apostilla cuyo cobro no está en el CRM. Las que se venden con el producto «Apostilla de La Haya» se crean solas.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="text-[12px]"><span className="text-muted-foreground">Campus</span>
              <select className={cn(campo, 'mt-1 block w-full')} value={nueva.projectId} onChange={(e) => setNueva({ ...nueva, projectId: e.target.value })}>
                <option value="">{activeProject?.id && activeProject.id > 0 ? 'El campus de arriba' : 'Elige…'}</option>
                {campusElegibles.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select></label>
            <label className="text-[12px]"><span className="text-muted-foreground">N.º de ficha del cliente (opcional)</span>
              <input className={cn(campo, 'mt-1 block w-full')} inputMode="numeric" value={nueva.leadId} onChange={(e) => setNueva({ ...nueva, leadId: e.target.value })} /></label>
            <label className="text-[12px]"><span className="text-muted-foreground">Título que se apostilla</span>
              <input className={cn(campo, 'mt-1 block w-full')} maxLength={500} value={nueva.formacion} onChange={(e) => setNueva({ ...nueva, formacion: e.target.value })} /></label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNueva(null)} className="h-8 px-3 rounded-md border border-border text-[12px] font-semibold hover:bg-muted">Cancelar</button>
            <button type="button" onClick={crear} className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold">Crear</button>
          </div>
        </section>
      )}

      <CifrasApostillas ambito={ambito} recarga={recarga} />

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Qué apostillas" className="inline-flex rounded-md border border-border p-0.5">
          {([['todas', 'Todas'], ['sin_asociar', 'Sin asociar']] as const).map(([k, t]) => (
            <button key={k} type="button" role="tab" aria-selected={pestana === k} onClick={() => setPestana(k)}
              className={cn('h-7 px-3 rounded text-[12px] font-semibold', pestana === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>
              {t}
            </button>
          ))}
        </div>
        <select className={campo} value={estado} aria-label="Paso" onChange={(e) => setEstado(e.target.value as EstadoApostilla | '')}>
          <option value="">Todos los pasos</option>
          {ESTADOS.map((e) => <option key={e.clave} value={e.clave}>{e.texto}</option>)}
        </select>
        <label className="relative">
          <MagnifyingGlass size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input className={cn(campo, 'pl-7 w-56')} placeholder="Cliente, correo o título" aria-label="Buscar"
            value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {puedeGestionar && (
          <label className="inline-flex items-center gap-1.5 text-[12px]">
            <input type="checkbox" checked={mias} onChange={(e) => setMias(e.target.checked)} /> Solo las que gestiono
          </label>
        )}
        <label className="inline-flex items-center gap-1.5 text-[12px]">
          <input type="checkbox" checked={atascadas} onChange={(e) => setAtascadas(e.target.checked)} /> Solo atascadas
        </label>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[12px] text-muted-foreground border-b border-border">
              <th className="py-2 px-3 font-medium">Cliente</th>
              <th className="py-2 px-3 font-medium">Campus</th>
              <th className="py-2 px-3 font-medium">Paso</th>
              <th className="py-2 px-3 font-medium">En el paso</th>
              <th className="py-2 px-3 font-medium text-right">Importe</th>
              <th className="py-2 px-3 font-medium">Pagada</th>
              <th className="py-2 px-3 font-medium">La lleva</th>
            </tr>
          </thead>
          <tbody>
            {!cargando && filas.length === 0 && (
              <tr><td colSpan={7} className="py-6 px-3 text-center text-muted-foreground">
                {pestana === 'sin_asociar' ? 'Ninguna sin asociar.' : 'Todavía no hay apostillas con estos filtros.'}
              </td></tr>
            )}
            {filas.map((a) => {
              const atascada = estaAtascada(a);
              return (
                <tr key={a.id} className="border-b border-border last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => abrir(a.id)}>
                  <td className="py-2 px-3">
                    <button type="button" className="text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); abrir(a.id); }}>
                      {a.cliente || <span className="text-muted-foreground">Sin asociar{a.cobro_email ? ` · ${a.cobro_email}` : ''}</span>}
                    </button>
                    {a.formacion && <span className="block text-[11px] text-muted-foreground truncate max-w-[16rem]">{a.formacion}</span>}
                  </td>
                  <td className="py-2 px-3 text-[12px]">{a.campus}</td>
                  <td className="py-2 px-3">
                    <span className="block text-[12px] mb-1">{textoDelEstado(a.estado)}</span>
                    <BarraDePasos estado={a.estado} diasEnEstado={a.dias_en_estado} atascada={atascada} compacta />
                  </td>
                  <td className={cn('py-2 px-3 text-[12px] whitespace-nowrap', atascada && 'text-warning-soft-foreground font-semibold')}>
                    {atascada && <WarningCircle size={12} weight="bold" className="inline mr-1 text-warning" />}
                    {diasTexto(a.dias_en_estado)}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums text-[12px]">{eur(a.importe)}</td>
                  <td className="py-2 px-3 text-[12px]">{a.pagada ? 'Sí' : `${eur(a.cobrado)} cobrado`}</td>
                  <td className="py-2 px-3 text-[12px]">{a.responsable || a.gestora || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <div className="flex items-center justify-end gap-2 text-[12px]">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)} className="h-8 px-3 rounded-md border border-border disabled:opacity-40">Anterior</button>
          <span className="tabular-nums">{pagina} de {paginas} · {total} apostillas</span>
          <button type="button" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)} className="h-8 px-3 rounded-md border border-border disabled:opacity-40">Siguiente</button>
        </div>
      )}

      {abierta && <ApostillaDialog id={abierta} onCerrar={() => abrir(null)} onCambio={() => setRecarga((n) => n + 1)} />}
    </div>
  );
}
