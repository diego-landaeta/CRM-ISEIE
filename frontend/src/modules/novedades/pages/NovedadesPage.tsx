import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, DownloadSimple, PaperPlaneTilt, Sparkle, Wrench } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { rolesDe } from '@/shared/lib/roles';
import { toast } from '@/shared/hooks/useToast';
import {
  traerNovedades, traerEnvios, bajarPdf, enviarNovedades,
  type Novedades, type Envio,
} from '../api/novedades.api';

/**
 * Novedades: todo lo que trae cada versión (Diego, 28/09: «que tenga su
 * apartado para leer todo, con atajos»).
 *
 * El contenido viene del servidor (`modules/novedades/versiones.js`), el mismo
 * del correo, la campana y el PDF: no hay dos versiones de la verdad.
 *
 * Los ATAJOS: el índice de la izquierda salta a cada apartado —y las teclas 1…9
 * también—, y cada novedad trae un botón «Ir a…» a su pantalla, solo si a quien
 * lee le toca (una gestora no ve «Ir a Registro»: se lo contamos, pero no le
 * ofrecemos una puerta cerrada).
 *
 * Quien dirige el CRM (superadmin/soporte) puede además mandárselo a sí mismo
 * de prueba o al equipo; en producción, el envío al equipo sale solo al
 * arrancar la versión nueva, una vez.
 */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number);
  return a ? `${d} de ${MESES[m - 1]} de ${a}` : iso;
};
const cuando = (iso: string) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function NovedadesPage() {
  const { user } = useAuth() as { user: { role?: string; email?: string } | null };
  const roles = rolesDe(user as never);
  const dirige = roles.some((r) => r === 'superadmin' || r === 'soporte');
  const [datos, setDatos] = useState<Novedades | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [envios, setEnvios] = useState<Envio[]>([]);
  const [correo, setCorreo] = useState('');
  const [yendo, setYendo] = useState<null | 'pdf' | 'prueba' | 'equipo'>(null);

  useEffect(() => {
    traerNovedades().then((d) => { setDatos(d); setVersion(d?.actual ?? null); });
  }, []);
  useEffect(() => { setCorreo(user?.email || ''); }, [user?.email]);
  useEffect(() => {
    if (!version || !roles.some((r) => ['superadmin', 'soporte', 'admin'].includes(r))) return;
    traerEnvios(version).then(setEnvios);
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = useMemo(() => datos?.versiones.find((x) => x.version === version) || null, [datos, version]);
  const total = v ? v.grupos.reduce((s, g) => s + g.items.length, 0) : 0;
  const alEquipo = envios.find((e) => e.alcance === 'equipo');

  // Atajos de teclado: 1…9 salta a cada apartado; 0, a los arreglos.
  useEffect(() => {
    if (!v) return undefined;
    const alPulsar = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName)) return;
      const n = Number(e.key);
      if (!Number.isInteger(n)) return;
      const id = n === 0 ? 'arreglos' : `grupo-${n}`;
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('keydown', alPulsar);
    return () => window.removeEventListener('keydown', alPulsar);
  }, [v]);

  const leToca = (itemRoles: string[]) => !itemRoles?.length || itemRoles.some((r) => roles.includes(r as never));

  async function pdf() {
    if (!v || !datos) return;
    setYendo('pdf');
    try { await bajarPdf(v.version, datos.crm.nombre); } catch (e) {
      toast({ title: 'No se ha podido bajar el PDF', description: (e as Error).message, variant: 'destructive' });
    } finally { setYendo(null); }
  }

  async function mandar(alcance: 'prueba' | 'equipo') {
    if (!v) return;
    if (alcance === 'equipo' && !window.confirm(`Se manda la versión ${v.version} a TODO el equipo: aviso en la campana y correo con el PDF. Solo se puede hacer una vez. ¿Seguro?`)) return;
    setYendo(alcance);
    try {
      const r = await enviarNovedades(v.version, { alcance, correo: alcance === 'prueba' ? correo.trim() || null : null });
      toast({
        title: alcance === 'prueba' ? `Prueba: correo ${r?.correo || '¿?'}` : `Mandado a ${r?.personas} personas`,
        description: alcance === 'prueba' ? `A ${r?.a}. También tienes el aviso en la campana.` : `${r?.correos} correos enviados.`,
      });
      setEnvios(await traerEnvios(v.version));
    } catch (e) {
      const err = e as { data?: { error?: string }; message?: string };
      toast({ title: 'No se ha mandado', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally { setYendo(null); }
  }

  if (!datos || !v) {
    return (
      <div className="space-y-5">
        <PageHeader title="Novedades" />
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Novedades"
        subtitle={`${datos.crm.nombre} · ${v.titulo} · ${fechaLarga(v.fecha)}`}
        actions={(
          <div className="flex items-center gap-2">
            {datos.versiones.length > 1 && (
              <select value={v.version} onChange={(e) => setVersion(e.target.value)} aria-label="Versión"
                className="h-9 rounded-md border border-border bg-card px-2 text-sm">
                {datos.versiones.map((x) => <option key={x.version} value={x.version}>Versión {x.version}</option>)}
              </select>
            )}
            <button type="button" onClick={pdf} disabled={yendo === 'pdf'}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">
              <DownloadSimple size={15} weight="bold" /> {yendo === 'pdf' ? 'Preparando…' : 'PDF'}
            </button>
          </div>
        )}
      />

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkle size={20} weight="fill" /></span>
          <div>
            <p className="text-base leading-relaxed">{v.intro}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} novedades en {v.grupos.length} apartados y {v.arreglos.length} arreglos. Pulsa 1–{Math.min(v.grupos.length, 9)} para saltar a cada apartado y 0 para los arreglos.
            </p>
          </div>
        </div>

        {dirige && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="text-xs font-semibold text-muted-foreground">Mandármelo a mí (prueba)</span>
                <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} aria-label="Correo para la prueba"
                  className="mt-1 h-9 w-72 max-w-full rounded-md border border-border bg-background px-3 text-sm" />
              </label>
              <button type="button" onClick={() => mandar('prueba')} disabled={!!yendo || !correo.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted disabled:opacity-50">
                <PaperPlaneTilt size={15} /> {yendo === 'prueba' ? 'Mandando…' : 'Mandar prueba'}
              </button>
            </div>
            <div className="text-right">
              {alEquipo ? (
                <p className="text-sm text-muted-foreground">
                  Mandada al equipo el {cuando(alEquipo.created_at)}: {alEquipo.personas} personas, {alEquipo.correos} correos.
                </p>
              ) : (
                <button type="button" onClick={() => mandar('equipo')} disabled={!!yendo}
                  className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                  <PaperPlaneTilt size={15} weight="bold" /> {yendo === 'equipo' ? 'Mandando…' : 'Enviar a todo el equipo'}
                </button>
              )}
              <p className="mt-1 text-xs text-muted-foreground">En producción se manda sola al equipo al subir la versión, una vez.</p>
            </div>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[230px_1fr]">
        {/* Índice: los atajos a cada apartado. */}
        <nav aria-label="Apartados" className="lg:sticky lg:top-4 lg:self-start">
          <ol className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-2 lg:flex-col">
            {v.grupos.map((g, i) => (
              <li key={g.titulo}>
                <a href={`#grupo-${i + 1}`}
                  className="flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm hover:bg-muted lg:whitespace-normal">
                  <kbd className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">{i + 1}</kbd>
                  <span className="flex-1">{g.titulo}</span>
                  <span className="text-xs text-muted-foreground">{g.items.length}</span>
                </a>
              </li>
            ))}
            <li>
              <a href="#arreglos" className="flex items-center gap-2 whitespace-nowrap rounded-md px-2.5 py-2 text-sm hover:bg-muted">
                <kbd className="rounded border border-border px-1.5 text-[11px] text-muted-foreground">0</kbd>
                <span className="flex-1">Arreglos</span>
                <span className="text-xs text-muted-foreground">{v.arreglos.length}</span>
              </a>
            </li>
          </ol>
        </nav>

        <div className="min-w-0 space-y-8">
          {v.grupos.map((g, i) => (
            <section key={g.titulo} id={`grupo-${i + 1}`} className="scroll-mt-4">
              <h2 className="mb-3 text-lg font-bold"><span className="mr-2 text-muted-foreground">{i + 1}.</span>{g.titulo}</h2>
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {g.items.map((it) => (
                  <article key={it.titulo} className="flex flex-col rounded-xl border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold">{it.titulo}</h3>
                    <p className="mt-1.5 flex-1 text-sm leading-relaxed text-muted-foreground">{it.texto}</p>
                    {it.ruta && leToca(it.roles) && (
                      <Link to={it.ruta}
                        className="mt-3 inline-flex items-center gap-1.5 self-start rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5">
                        {it.boton || 'Ir'} <ArrowRight size={12} weight="bold" />
                      </Link>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ))}

          <section id="arreglos" className="scroll-mt-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><Wrench size={18} /> Arreglos</h2>
            <ul className="space-y-2 rounded-xl border border-border bg-card p-4">
              {v.arreglos.map((a) => (
                <li key={a} className="flex gap-2 text-sm leading-relaxed">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  {a}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
