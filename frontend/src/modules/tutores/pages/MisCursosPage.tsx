import { useCallback, useEffect, useMemo, useState } from 'react';
import { GraduationCap, Coins, Info, TrendUp, CaretRight, X, FilePdf, DownloadSimple } from '@phosphor-icons/react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell, LabelList,
} from 'recharts';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import {
  tutoresApi, type Colaboracion, type ResumenComision, type ComisionReal, type CursoFicha,
} from '../api/tutores.api';

// Lo que ve un tutor: SUS cursos y SU dinero. Nada mas.
//
// El recorte no depende de esta pantalla: el servidor le fuerza su propio
// identificador e ignora lo que pida por query. Esto es solo la forma de
// enseñarselo.
//
// Las dos graficas responden a las dos preguntas que se hace de verdad: «¿cuanto
// llevo ganado y como va mes a mes?» y «¿que curso me da mas?». Van con UN SOLO
// color a proposito: aqui se comparan tamaños, no identidades, y pintar cada
// barra de un color inventa una distincion que no significa nada.

const VIOLETA = '#8b5cf6';           // el mismo que usan las graficas del CRM
const VIOLETA_SUAVE = '#c4b5fd';

const euros = (n: number | string) =>
  Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Fecha corta: en una tabla de cobros lo que importa es el dia, no la hora.
const fecha = (f: string | null | undefined) => {
  if (!f) return '—';
  const [a, m, d] = String(f).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a.slice(2)}` : String(f).slice(0, 10);
};

// Solo el nombre de pila del alumno. El tutor necesita reconocer de quien es el
// pago; no necesita —ni debe tener— la lista de contactos de la escuela.
const primerNombre = (nombre: string | null | undefined) => {
  const limpio = String(nombre || '').trim();
  if (!limpio || limpio === '—') return '—';
  return limpio.split(/\s+/)[0];
};

const soloFecha = (f: string | null) => (f ? String(f).slice(0, 10) : null);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const mesCorto = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1] || p} ${p.slice(2, 4)}`;

function mesActual() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

export default function MisCursosPage() {
  const { user } = useAuth() as { user: { role?: string; nombre?: string } | null };
  const esTutor = user?.role === 'tutor';

  const [periodo, setPeriodo] = useState(mesActual());
  const [cursos, setCursos] = useState<Colaboracion[]>([]);
  const [comisiones, setComisiones] = useState<ComisionReal[]>([]);
  const [historico, setHistorico] = useState<ResumenComision[]>([]);
  // El historial completo: cada cobro de sus cursos desde que empezo. Es lo que
  // permite comprobar una cifra en vez de creersela — sin esto, el tutor ve un
  // total del mes y tiene que fiarse.
  const [ventas, setVentas] = useState<ComisionReal[]>([]);
  const [cargando, setCargando] = useState(true);
  // La ficha del curso elegido, tal como se publica. Solo para mirarla.
  const [elegido, setElegido] = useState<number | null>(null);
  const [ficha, setFicha] = useState<CursoFicha | null>(null);
  const [cargandoFicha, setCargandoFicha] = useState(false);
  const [bajando, setBajando] = useState(false);

  async function abrirBrochure(productId: number) {
    setBajando(true);
    try {
      const r = await tutoresApi.brochureDelCurso(productId);
      if (r.success && r.data?.url) window.open(r.data.url, '_blank', 'noopener');
    } finally { setBajando(false); }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [c, m, h, todo] = await Promise.all([
        tutoresApi.colaboraciones(),                 // sin id: el servidor pone el suyo
        tutoresApi.comisiones({ periodo }),
        tutoresApi.resumenComisiones({}),            // todos los meses, para la evolucion
        tutoresApi.comisiones({}),                   // sin periodo: TODO su historial
      ]);
      setCursos(c.success ? (c.data || []) : []);
      setComisiones(m.success ? (m.data || []) : []);
      setHistorico(h.success ? (h.data || []) : []);
      setVentas(todo.success ? (todo.data || []) : []);
    } finally { setCargando(false); }
  }, [periodo]);

  useEffect(() => { cargar(); }, [cargar]);

  // Si hay una ficha abierta, el historial se recorta a ese curso: es lo que se
  // espera al estar mirandolo. Si no, todos, del mas reciente al mas antiguo.
  const ventasVisibles = useMemo(() => {
    const lista = elegido ? ventas.filter((v) => v.product_id === elegido) : ventas;
    return [...lista].sort((a, b) => String(b.fecha_cobro || '').localeCompare(String(a.fecha_cobro || '')));
  }, [ventas, elegido]);

  // Lo devuelto no cuenta: ese dinero se reembolso al alumno.
  const totalHistorial = useMemo(
    () => ventasVisibles
      .filter((v) => v.estado !== 'revertida')
      .reduce((suma, v) => suma + Number(v.importe || 0), 0),
    [ventasVisibles],
  );

  useEffect(() => {
    if (elegido == null) { setFicha(null); return; }
    setCargandoFicha(true);
    tutoresApi.curso(elegido)
      .then((r) => setFicha(r.success ? r.data : null))
      .finally(() => setCargandoFicha(false));
  }, [elegido]);

  // Lo del mes elegido, por curso.
  const porCurso = useMemo(() => {
    const m = new Map<number, { comision: number; base: number; cobros: number; alumnos: Set<string> }>();
    for (const c of comisiones) {
      if (c.estado === 'revertida' || c.product_id == null) continue;
      const a = m.get(c.product_id) || { comision: 0, base: 0, cobros: 0, alumnos: new Set<string>() };
      a.comision += Number(c.importe);
      a.base += Number(c.base_calculo);
      a.cobros += 1;
      a.alumnos.add(c.alumno);
      m.set(c.product_id, a);
    }
    return m;
  }, [comisiones]);

  const pendiente = comisiones.filter((c) => c.estado === 'pendiente').reduce((s, c) => s + Number(c.importe), 0);
  const pagado = comisiones.filter((c) => c.estado === 'pagada').reduce((s, c) => s + Number(c.importe), 0);
  const base = comisiones.filter((c) => c.estado !== 'revertida').reduce((s, c) => s + Number(c.base_calculo), 0);

  // Los ultimos seis meses, en orden. Se rellenan los vacios: un mes sin cobros
  // es informacion —significa que no entro nada—, no un hueco que se salta.
  const evolucion = useMemo(() => {
    const suma = new Map<string, number>();
    for (const h of historico) {
      suma.set(h.periodo, (suma.get(h.periodo) || 0) + Number(h.pendiente) + Number(h.pagada));
    }
    const fin = new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5, 7)) - 1, 1);
    const meses = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(fin.getFullYear(), fin.getMonth() - i, 1);
      const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      meses.push({ periodo: p, mes: mesCorto(p), comision: Number((suma.get(p) || 0).toFixed(2)) });
    }
    return meses;
  }, [historico, periodo]);

  const totalHistorico = historico.reduce((s, h) => s + Number(h.pendiente) + Number(h.pagada), 0);

  // El reparto del mes, de mayor a menor: es una comparacion de tamaños.
  const reparto = useMemo(() => cursos
    .map((c) => ({
      nombre: c.formacion,
      corto: c.formacion.length > 34 ? c.formacion.slice(0, 33) + '…' : c.formacion,
      comision: Number((porCurso.get(c.product_id)?.comision || 0).toFixed(2)),
    }))
    .filter((x) => x.comision > 0)
    .sort((a, b) => b.comision - a.comision), [cursos, porCurso]);

  if (!esTutor) {
    return (
      <div className="bg-card border border-border rounded-lg p-6 text-center text-sm text-muted-foreground">
        Esta pantalla es la de los tutores. Para gestionarlos, ve a Tutores.
      </div>
    );
  }

  const cajaTooltip = {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
  };

  return (
    <div className="space-y-3">
      <PageHeader
        title="Mis cursos"
        subtitle="Lo que te corresponde por lo que se ha cobrado de tus formaciones"
        actions={(
          <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
        )}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard icon={Coins} iconBg="bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
          label="Pendiente de cobro" value={euros(pendiente)} />
        <KpiCard icon={Coins} iconBg="bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
          label="Ya pagado este mes" value={euros(pagado)} />
        <KpiCard icon={TrendUp} iconBg="bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
          label="Total acumulado" value={euros(totalHistorico)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold">Cómo va mes a mes</p>
          <p className="text-xs text-muted-foreground mb-3">Lo que te ha correspondido en cada mes</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={evolucion} margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="mes" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => `${v} €`} width={64} />
                <Tooltip contentStyle={cajaTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  formatter={(v: number) => [euros(v), 'Te corresponde']} />
                <Bar dataKey="comision" radius={[4, 4, 0, 0]} maxBarSize={44}>
                  {evolucion.map((e) => (
                    // El mes que se está mirando, en color pleno; los demás, apagados.
                    <Cell key={e.periodo} fill={e.periodo === periodo ? VIOLETA : VIOLETA_SUAVE} />
                  ))}
                  <LabelList dataKey="comision" position="top" fontSize={10}
                    fill="hsl(var(--muted-foreground))"
                    formatter={(v: number) => (v > 0 ? euros(v) : '')} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-card border border-border rounded-lg p-4">
          <p className="text-sm font-semibold">Qué curso te da más</p>
          <p className="text-xs text-muted-foreground mb-3">Este mes, de mayor a menor</p>
          <div className="h-56">
            {reparto.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Ningún curso ha generado comisión este mes
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={reparto} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                    tickLine={false} axisLine={false} tickFormatter={(v) => `${v} €`} />
                  <YAxis type="category" dataKey="corto" width={165} tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip contentStyle={cajaTooltip} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                    formatter={(v: number) => [euros(v), 'Te corresponde']}
                    labelFormatter={(_, p) => (p?.[0]?.payload?.nombre ?? '')} />
                  <Bar dataKey="comision" fill={VIOLETA} radius={[0, 4, 4, 0]} maxBarSize={26}>
                    <LabelList dataKey="comision" position="right" fontSize={10}
                      fill="hsl(var(--muted-foreground))" formatter={(v: number) => euros(v)} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-3 flex gap-2 text-sm">
        <Info size={16} weight="fill" className="text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-muted-foreground leading-relaxed">
          Cobras un porcentaje de lo que <strong>se ha cobrado de verdad</strong> de tus cursos, no de lo
          vendido. Si un alumno paga en tres veces, te corresponde tu parte en cada pago, según se
          cobra — no de golpe al matricularse.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-3 items-start">
        {/* Mis cursos: la lista. Pulsar uno abre su ficha al lado. */}
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-sm font-semibold">
              {cargando ? 'cargando…' : `Mis cursos · ${cursos.length}`}
            </span>
          </div>

          {!cargando && cursos.length === 0 ? (
            <EmptyState icon={GraduationCap} title="Todavía no tienes cursos asignados"
              description="Cuando te asignen uno aparecerá aquí, con tu porcentaje y desde qué fecha." />
          ) : (
            <div className="divide-y divide-border max-h-[32rem] overflow-y-auto">
              {cursos.map((c) => {
                const d = porCurso.get(c.product_id);
                const abierto = elegido === c.product_id;
                return (
                  <button key={c.id} type="button" onClick={() => setElegido(abierto ? null : c.product_id)}
                    className={`w-full text-left px-4 py-3 flex items-start gap-2 transition-colors border-l-2 ${
                      abierto ? 'bg-primary/10 border-l-primary' : 'hover:bg-muted/50 border-l-transparent'
                    } ${c.rige_hoy ? '' : 'opacity-60'}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm leading-snug">{c.formacion}</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums mt-0.5">
                        {c.proyecto} · {euros(c.precio)} · tu {Number(c.pct)} % · desde el {soloFecha(c.vigente_desde)}
                        {!c.rige_hoy && ' · no vigente'}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {d
                          ? `${d.alumnos.size} ${d.alumnos.size === 1 ? 'alumno' : 'alumnos'} · ${d.cobros} ${d.cobros === 1 ? 'cobro' : 'cobros'} · ${euros(d.base)} cobrados`
                          : 'sin cobros este mes'}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold tabular-nums text-sm">{d ? euros(d.comision) : '—'}</p>
                      <CaretRight size={13} weight="bold"
                        className={`ml-auto mt-1 text-muted-foreground transition-transform ${abierto ? 'rotate-90' : ''}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* La ficha del curso, tal como se publica. Solo para verla. */}
        <div className="bg-card border border-border rounded-lg p-4 min-h-[16rem]">
          {elegido == null ? (
            <EmptyState icon={GraduationCap} title="Elige uno de tus cursos"
              description="Verás su ficha completa: a quién va dirigido, objetivos, temario y metodología." />
          ) : cargandoFicha ? (
            <p className="text-sm text-muted-foreground">cargando la ficha…</p>
          ) : !ficha ? (
            <p className="text-sm text-muted-foreground">No se ha podido cargar la ficha de este curso.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold text-base leading-snug">{ficha.nombre}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    {ficha.proyecto} · {euros(ficha.precio)}
                    {ficha.fecha_inicio_texto ? ` · empieza el ${ficha.fecha_inicio_texto}` : ''}
                  </p>
                </div>
                <button type="button" onClick={() => setElegido(null)}
                  className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Cerrar">
                  <X size={16} weight="bold" />
                </button>
              </div>

              {ficha.brochure ? (
                <button type="button" disabled={bajando} onClick={() => abrirBrochure(ficha.id)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-md border border-border hover:bg-muted/50 transition-colors text-left">
                  <FilePdf size={20} weight="fill" className="text-red-600 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium truncate">{ficha.brochure.filename_original}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      Brochure del curso · versión {ficha.brochure.version}
                      {ficha.brochure.size_bytes ? ` · ${Math.round(ficha.brochure.size_bytes / 1024)} KB` : ''}
                    </span>
                  </span>
                  <DownloadSimple size={16} weight="bold" className="text-muted-foreground shrink-0" />
                </button>
              ) : (
                <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
                  Este curso todavía no tiene brochure subido.
                </p>
              )}

              <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
                Esto es la ficha del curso tal como se publica. Es solo para consultarla: el catálogo lo
                lleva el equipo del centro.
              </p>

              {[
                ['Temario', ficha.modulos_texto],
                ['Presentación', ficha.presentacion_texto],
                ['A quién va dirigido', ficha.dirigido_a_texto],
                ['Objetivos', ficha.objetivos_texto],
                ['Metodología', ficha.metodologia_texto],
                ['Para qué te prepara', ficha.para_que_te_prepara_texto],
                ['Beneficios', ficha.beneficios_texto],
                ['Preguntas frecuentes', ficha.faqs_texto],
              ].filter(([, v]) => v && String(v).trim()).map(([titulo, texto]) => (
                <section key={String(titulo)}>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                    {titulo}
                  </h3>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{String(texto).trim()}</p>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ─── Historial de ventas ───────────────────────────────────────────
          Cada cobro de sus cursos, con lo que le correspondio. Va DESPUES de
          las graficas a proposito: primero el resumen, y quien quiera
          comprobarlo tiene aqui el detalle, cobro a cobro. */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-bold">Historial de ventas</h2>
          <p className="text-xs text-muted-foreground flex-1">
            {elegido
              ? 'Solo del curso que tienes abierto. Cierra la ficha para verlos todos.'
              : 'Todos tus cursos, del cobro más reciente al más antiguo.'}
          </p>
          {ventasVisibles.length > 0 && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {ventasVisibles.length} {ventasVisibles.length === 1 ? 'cobro' : 'cobros'} ·{' '}
              <strong className="text-foreground">{euros(totalHistorial)}</strong> para ti
            </p>
          )}
        </div>

        {ventasVisibles.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted-foreground text-center">
            Todavía no se ha cobrado nada de tus cursos. Cuando un alumno pague, aparece aquí.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                  <th className="py-2 px-4 font-semibold">Fecha</th>
                  <th className="py-2 px-3 font-semibold">Curso</th>
                  <th className="py-2 px-3 font-semibold">Alumno</th>
                  <th className="py-2 px-3 font-semibold text-right">Se cobró</th>
                  <th className="py-2 px-3 font-semibold text-right">Tu %</th>
                  <th className="py-2 px-3 font-semibold text-right">Para ti</th>
                  <th className="py-2 px-4 font-semibold">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ventasVisibles.map((v) => (
                  <tr key={v.id} className={v.estado === 'revertida' ? 'opacity-60' : undefined}>
                    <td className="py-2 px-4 tabular-nums whitespace-nowrap">{fecha(v.fecha_cobro)}</td>
                    <td className="py-2 px-3">
                      <span className="block truncate max-w-[22rem]" title={v.formacion || ''}>
                        {v.formacion || '—'}
                      </span>
                    </td>
                    {/* Solo el nombre de pila: basta para reconocer al alumno y no
                        convierte esta pantalla en una lista de contactos. */}
                    <td className="py-2 px-3 text-muted-foreground">{primerNombre(v.alumno)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{euros(Number(v.cobro ?? v.base_calculo))}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-muted-foreground">{Number(v.pct)}%</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold">{euros(Number(v.importe))}</td>
                    <td className="py-2 px-4">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                        v.estado === 'pagada'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : v.estado === 'revertida'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}>
                        {v.estado === 'pagada' ? 'pagada' : v.estado === 'revertida' ? 'devuelta' : 'pendiente'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {ventasVisibles.some((v) => v.estado === 'revertida') && (
          <p className="px-4 py-2.5 text-[11px] text-muted-foreground border-t border-border">
            Una línea <strong>devuelta</strong> es un alumno al que se le devolvió el dinero: esa
            comisión se descuenta, porque el cobro dejó de existir.
          </p>
        )}
      </div>

    </div>
  );
}
