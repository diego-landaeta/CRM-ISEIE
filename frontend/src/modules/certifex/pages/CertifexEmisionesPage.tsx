import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowClockwise, ArrowSquareOut, Books, Buildings, CaretDown, Certificate, CheckCircle, DownloadSimple,
  GraduationCap, HourglassMedium, Lightning, MagnifyingGlass, PlugsConnected, SealCheck, X, XCircle,
} from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import Card, { CardSection } from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import StatusDot from '@/shared/components/ui/StatusDot';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import {
  emisionesApi,
  type CampusCertifex,
  type Candidato,
  type ConexionCertifex,
  type CursoCertifex,
  type EstadoEmision,
  type Recuentos,
  type ResultadoEmision,
} from '../api/certifex.api';

/**
 * Certifex · Emisiones: quién recibe su título, decidido desde el CRM.
 *
 * El recorrido es el de la Emisión de Certifex —campus → curso → personas—, porque es
 * el orden en que existe la decisión: un curso es lo que alguien sabe dar por
 * terminado, y un listado plano de mil matrículas no se puede revisar. El aspecto es el
 * del CRM: sus tarjetas, sus KPI, sus botones y sus colores.
 *
 * El 21/09 Certifex emitió 86 credenciales y solo dos personas habían terminado: Moodle
 * no sabe si alguien ha pagado o se dio de baja; el CRM sí. En un campus conectado a
 * este CRM, Certifex no emite nada que no se apruebe aquí — desde aquí ni desde su
 * panel. Aprobar y emitir son dos pasos: aprobar dice «tiene derecho»; emitir gasta un
 * número de expediente en un registro que no se borra.
 *
 * Aquí no se manda ningún correo. Si Certifex avisa al alumno al emitir, lo decide
 * Certifex con su propia configuración.
 */

const ESTADOS: { clave: EstadoEmision; rotulo: string; cuenta: (r: Recuentos) => number }[] = [
  { clave: 'pendiente', rotulo: 'Por decidir', cuenta: (r) => r.porDecidir },
  { clave: 'aprobada', rotulo: 'Aprobadas', cuenta: (r) => r.aprobadasSinEmitir },
  { clave: 'rechazada', rotulo: 'Rechazadas', cuenta: (r) => r.rechazadas },
  { clave: 'todas', rotulo: 'Todas', cuenta: (r) => r.matriculados },
];

/**
 * Cuántas matrículas por llamada al emitir. Certifex acepta hasta 50 (MAX_EMISIONES),
 * pero en un campus con Moodle cada una baja su expediente del campus, en serie: 50
 * pasan del minuto que espera nginx, y el CRM recibiría un 504 aunque la emisión
 * terminara. Con 10 cada tanda cabe de sobra, y se reparte en más llamadas.
 */
const TANDA_EMITIR = 10;

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' });
const host = (url: string | null) => {
  if (!url) return null;
  try { return new URL(url).host; } catch { return url; }
};
const sinAcentos = (t: string) => t.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '');
const suma = (xs: Recuentos[]): Recuentos => xs.reduce(
  (a, x) => ({
    matriculados: a.matriculados + x.matriculados,
    porDecidir: a.porDecidir + x.porDecidir,
    aprobadasSinEmitir: a.aprobadasSinEmitir + x.aprobadasSinEmitir,
    rechazadas: a.rechazadas + x.rechazadas,
    emitidas: a.emitidas + x.emitidas,
  }),
  { matriculados: 0, porDecidir: 0, aprobadasSinEmitir: 0, rechazadas: 0, emitidas: 0 },
);

type Accion =
  | null
  | { tipo: 'emitir' | 'aprobarEmitir'; ids: number[] }
  | { tipo: 'rechazar'; ids: number[] }
  | { tipo: 'emitirTodo'; n: number };

// ─────────────────────────────────────────────────────────────── piezas

/**
 * Logo y tono, por ruta: el mismo logo sale en la tarjeta, en la cabecera y en la
 * ficha, y no hace falta traerlo ni medirlo tres veces. Lo trae el servidor del CRM
 * porque el navegador no deja leer los píxeles de una imagen de otro dominio, y hace
 * falta leerlos para saber si el logo es claro (Academia IA es texto blanco: sin fondo
 * oscuro, no se ve).
 */
const logos = new Map<string, Promise<{ url: string; tono: 'claro' | 'oscuro' }>>();

function medirTono(img: HTMLImageElement): 'claro' | 'oscuro' {
  try {
    const lado = 32;
    const lienzo = document.createElement('canvas');
    lienzo.width = lado;
    lienzo.height = lado;
    const ctx = lienzo.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 'oscuro';
    ctx.drawImage(img, 0, 0, lado, lado);
    const { data } = ctx.getImageData(0, 0, lado, lado);
    let total = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 40) continue;
      total += 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
      n++;
    }
    return n && total / n > 150 ? 'claro' : 'oscuro';
  } catch {
    return 'oscuro';
  }
}

function cargarLogo(ruta: string) {
  let p = logos.get(ruta);
  if (!p) {
    p = emisionesApi.logo(ruta).then((b) => new Promise<{ url: string; tono: 'claro' | 'oscuro' }>((resolver, fallar) => {
      const url = URL.createObjectURL(b);
      const img = new Image();
      img.onload = () => resolver({ url, tono: medirTono(img) });
      img.onerror = () => fallar(new Error('logo'));
      img.src = url;
    }));
    p.catch(() => logos.delete(ruta));
    logos.set(ruta, p);
  }
  return p;
}

function LogoCampus({ c, size = 44 }: { c: Pick<CampusCertifex, 'codigo' | 'logo'>; size?: number }) {
  const [logo, setLogo] = useState<{ url: string; tono: 'claro' | 'oscuro' } | null>(null);
  useEffect(() => {
    let vivo = true;
    setLogo(null);
    if (c.logo) cargarLogo(c.logo).then((l) => { if (vivo) setLogo(l); }).catch(() => {});
    return () => { vivo = false; };
  }, [c.logo]);
  if (logo) {
    return (
      <span
        className={cn('grid flex-none place-items-center overflow-hidden rounded-md border border-border p-1.5',
          logo.tono === 'claro' ? 'bg-zinc-800' : 'bg-white')}
        style={{ width: size, height: size }}
      >
        <img src={logo.url} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  return (
    <span className="grid flex-none place-items-center rounded-md bg-primary/10 font-semibold uppercase text-primary"
      style={{ width: size, height: size, fontSize: size / 3.4 }}>
      {c.codigo.slice(0, 2)}
    </span>
  );
}

/** Barra fina de avance, con el color de estado del CRM según lo que falta. */
function Barra({ valor, tono = 'primary', className }: { valor: number; tono?: 'primary' | 'success' | 'warning' | 'destructive'; className?: string }) {
  const color = { primary: 'bg-primary', success: 'bg-success', warning: 'bg-warning', destructive: 'bg-destructive' }[tono];
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${Math.max(0, Math.min(100, valor))}%` }} />
    </div>
  );
}

function Avance({ hechas, total }: { hechas: number; total: number }) {
  if (!total) return <span className="text-xs text-muted-foreground" title="Este campus no publica sus actividades">sin actividades</span>;
  const pct = Math.round((Math.min(hechas, total) / total) * 100);
  const tono = hechas >= total ? 'success' : pct >= 50 ? 'warning' : 'destructive';
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={`${hechas} de ${total} actividades calificadas`}>
      <Barra valor={pct} tono={tono} className="w-16" />
      <span className={cn('w-9 text-right text-xs tabular-nums', hechas >= total ? 'font-medium text-success-soft-foreground' : 'text-muted-foreground')}>{pct}%</span>
    </span>
  );
}

function Decision({ c }: { c: Candidato }) {
  if (c.decision?.decision === 'aprobada') return <StatusDot tono="success">Aprobada</StatusDot>;
  if (c.decision?.decision === 'rechazada') return <StatusDot tono="danger">Rechazada</StatusDot>;
  return <StatusDot tono="info">Por decidir</StatusDot>;
}

/** Etiqueta suave con los tokens de estado del CRM. */
function Etiqueta({ tono, children }: { tono: 'info' | 'success' | 'warning' | 'destructive' | 'neutral'; children: React.ReactNode }) {
  const c = {
    info: 'bg-info-soft text-info-soft-foreground',
    warning: 'bg-warning-soft text-warning-soft-foreground',
    success: 'bg-success-soft text-success-soft-foreground',
    destructive: 'bg-destructive-soft text-destructive-soft-foreground',
    neutral: 'bg-muted text-muted-foreground',
  }[tono];
  return <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap', c)}>{children}</span>;
}

const euros = (n: number) => n.toLocaleString('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

/**
 * Lo que dice el CRM de este alumno: si compró y si lo tiene pagado. Es lo que
 * Moodle no sabe y la razón de aprobar desde aquí.
 */
function EnElCrmEtiqueta({ crm }: { crm: Candidato['crm'] }) {
  if (crm === undefined) return <span className="text-xs text-muted-foreground">—</span>;
  if (crm === null) return <Etiqueta tono="neutral">No está en el CRM</Etiqueta>;
  if (crm.ventas === 0) return <Etiqueta tono="warning">Sin venta</Etiqueta>;
  if (crm.pendiente > 0.05) return <Etiqueta tono="warning">Debe {euros(crm.pendiente)}</Etiqueta>;
  if (crm.pendiente < -0.05) return <Etiqueta tono="info">Cobrado de más</Etiqueta>;
  return <Etiqueta tono="success">Pagado</Etiqueta>;
}

function Pestana({ activa, onClick, children, cuenta }: { activa: boolean; onClick: () => void; children: React.ReactNode; cuenta?: number }) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={cn(
        'h-8 px-3 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors',
        activa ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:bg-muted/60',
      )}
    >
      {children}
      {cuenta !== undefined && (
        <span className={cn('rounded-full px-1.5 text-[10px] font-semibold', activa ? 'bg-background/80 text-foreground' : 'bg-muted text-muted-foreground')}>
          {cuenta}
        </span>
      )}
    </button>
  );
}

function Buscador({ id, valor, alCambiar, placeholder, autoFocus }: { id: string; valor: string; alCambiar: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      <input
        id={id}
        value={valor}
        autoFocus={autoFocus}
        onChange={(e) => alCambiar(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}

/** Lo que hay que hacer en un curso (o en el campus), en una línea. */
function ResumenLinea({ r }: { r: Recuentos }) {
  return (
    <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
      {r.porDecidir > 0 && <span className="text-info-soft-foreground">{r.porDecidir} por decidir</span>}
      {r.aprobadasSinEmitir > 0 && <span className="text-success-soft-foreground">{r.aprobadasSinEmitir} por emitir</span>}
      <span>{r.emitidas}/{r.matriculados} con título</span>
    </span>
  );
}

/**
 * El curso, en un desplegable. Un campus real tiene cientos de cursos y el trabajo vive
 * en unos pocos: por eso lleva buscador, «solo con trabajo» encendido de salida, y cada
 * opción dice lo que tiene pendiente sin tener que abrirla.
 */
function SelectorCurso({ campus, cursos, curso, alElegir }: {
  campus: CampusCertifex;
  cursos: CursoCertifex[] | null;
  curso: number | null;
  alElegir: (c: number | null) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [buscar, setBuscar] = useState('');
  const [soloConTrabajo, setSoloConTrabajo] = useState(true);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!caja.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); window.removeEventListener('keydown', esc); };
  }, [abierto]);

  const visibles = useMemo(() => {
    const t = sinAcentos(buscar.trim());
    return (cursos ?? [])
      .filter((c) => !soloConTrabajo || c.porDecidir + c.aprobadasSinEmitir > 0 || c.cursoRef === curso)
      .filter((c) => !t || sinAcentos(c.cursoNombre).includes(t));
  }, [cursos, soloConTrabajo, buscar, curso]);

  const elegido = cursos?.find((c) => c.cursoRef === curso) ?? null;
  const elegir = (c: number | null) => { alElegir(c); setAbierto(false); setBuscar(''); };

  return (
    <div ref={caja} className="relative w-full sm:w-[420px]">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
        className="flex h-auto min-h-[44px] w-full items-center gap-2.5 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-left hover:bg-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        {elegido ? <GraduationCap size={16} className="flex-none text-primary" /> : <Books size={16} className="flex-none text-muted-foreground" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{elegido?.cursoNombre ?? 'Todos los cursos'}</span>
          <ResumenLinea r={elegido ?? campus} />
        </span>
        <span className="flex-none text-[11px] text-muted-foreground">{cursos ? `${cursos.length} cursos` : '…'}</span>
        <CaretDown size={13} className={cn('flex-none text-muted-foreground transition-transform', abierto && 'rotate-180')} />
      </button>

      {abierto && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 rounded-md border border-border bg-card shadow-lg">
          <div className="flex items-center gap-2 border-b border-border p-2">
            <div className="flex-1"><Buscador id="certifex-buscar-curso" valor={buscar} alCambiar={setBuscar} placeholder="Buscar un curso…" autoFocus /></div>
            <Pestana activa={soloConTrabajo} onClick={() => setSoloConTrabajo((v) => !v)}>Solo con trabajo</Pestana>
          </div>
          <ul role="listbox" className="max-h-[340px] overflow-y-auto p-1">
            <OpcionCurso activa={curso === null} icono={Books} titulo="Todos los cursos" r={campus} onClick={() => elegir(null)} />
            {cursos === null && <li className="px-3 py-4 text-center text-xs text-muted-foreground">Cargando cursos…</li>}
            {cursos !== null && visibles.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                {soloConTrabajo ? 'Ningún curso con trabajo pendiente.' : 'Ningún curso coincide.'}
              </li>
            )}
            {visibles.map((c) => (
              <OpcionCurso key={c.cursoRef} activa={curso === c.cursoRef} icono={GraduationCap} titulo={c.cursoNombre} r={c} onClick={() => elegir(c.cursoRef)} />
            ))}
          </ul>
          {cursos && (
            <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
              {visibles.length} de {cursos.length} cursos
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function OpcionCurso({ activa, icono: Icono, titulo, r, onClick }: {
  activa: boolean; icono: typeof Books; titulo: string; r: Recuentos; onClick: () => void;
}) {
  return (
    <li role="option" aria-selected={activa}>
      <button
        type="button"
        onClick={onClick}
        className={cn('flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-left transition-colors', activa ? 'bg-primary/10' : 'hover:bg-muted/60')}
      >
        <Icono size={15} className={activa ? 'text-primary' : 'text-muted-foreground'} />
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[13px] font-medium', activa && 'text-primary')}>{titulo}</span>
          <ResumenLinea r={r} />
        </span>
        {activa && <CheckCircle size={15} weight="fill" className="flex-none text-primary" />}
      </button>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────── página

/**
 * `embebida`: dentro de Matrículas → Certificaciones. Sin el título grande de página
 * (ya lo pone Matrículas), pero con el estado de la conexión y los botones.
 */
export default function CertifexEmisionesPage({ embebida = false }: { embebida?: boolean } = {}) {
  const Cabecera = ({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) => (
    embebida
      ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground"><div>{subtitle}</div>{actions && <div className="flex flex-wrap gap-2">{actions}</div>}</div>
      : <PageHeader title={title} subtitle={subtitle} actions={actions} />
  );
  const [conexion, setConexion] = useState<ConexionCertifex | null>(null);
  const [campus, setCampus] = useState<CampusCertifex[] | null>(null);
  const [centro, setCentro] = useState<string | null>(null);
  const [cursos, setCursos] = useState<CursoCertifex[] | null>(null);
  const [curso, setCurso] = useState<number | null>(null);
  const [estado, setEstado] = useState<EstadoEmision>('pendiente');
  const [buscar, setBuscar] = useState('');
  const [q, setQ] = useState('');
  const [pagina, setPagina] = useState(1);
  const [filas, setFilas] = useState<Candidato[]>([]);
  const [total, setTotal] = useState(0);
  const [tam, setTam] = useState(50);
  const [cargandoFilas, setCargandoFilas] = useState(false);
  const [elegidas, setElegidas] = useState<Set<number>>(new Set());
  const [accion, setAccion] = useState<Accion>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [lote, setLote] = useState<{ hechas: number; total: number } | null>(null);
  const [fallos, setFallos] = useState<{ quien: string; error: string }[]>([]);
  const [abierta, setAbierta] = useState<Candidato | null>(null);

  const base = conexion?.urlPublica ?? null;

  // ── carga ───────────────────────────────────────────────────────
  const cargarCampus = useCallback(async () => {
    const r = await emisionesApi.centros();
    setCampus(r.data);
    // Por defecto, el primero con trabajo: es a donde se viene casi siempre.
    setCentro((actual) => actual ?? (r.data.find((c) => c.porDecidir + c.aprobadasSinEmitir > 0) ?? r.data[0])?.codigo ?? null);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const e = await emisionesApi.estado();
        setConexion(e.data);
        if (e.data.conectado) await cargarCampus();
      } catch {
        setConexion({ conectado: false });
      }
    })();
  }, [cargarCampus]);

  const cargarCursos = useCallback(async (cod: string) => {
    try {
      const r = await emisionesApi.cursos(cod);
      setCursos(r.data);
    } catch (e) {
      setCursos([]);
      toast({ title: 'No se pudieron cargar los cursos', description: (e as Error).message, variant: 'destructive' });
    }
  }, []);

  useEffect(() => {
    setCurso(null);
    setCursos(null);
    setPagina(1);
    if (centro) void cargarCursos(centro);
  }, [centro, cargarCursos]);

  // La búsqueda de personas va al servidor (la lista está paginada): se espera a que
  // se deje de teclear.
  useEffect(() => {
    const t = setTimeout(() => { setQ(buscar.trim()); setPagina(1); }, 300);
    return () => clearTimeout(t);
  }, [buscar]);

  const cargarFilas = useCallback(async () => {
    if (!centro) return;
    setCargandoFilas(true);
    try {
      const r = await emisionesApi.listar({ estado, centro, curso: curso ?? undefined, q: q || undefined, pagina });
      setFilas(r.data.filas);
      setTotal(r.data.total);
      setTam(r.data.tam);
      // La selección es DE LA PÁGINA: lo que se ve es lo que se decide.
      setElegidas(new Set());
    } catch (e) {
      toast({ title: 'No se pudo cargar', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargandoFilas(false); }
  }, [centro, curso, estado, q, pagina]);

  useEffect(() => { void cargarFilas(); }, [cargarFilas]);

  const recargarTodo = useCallback(async () => {
    await Promise.all([cargarCampus(), centro ? cargarCursos(centro) : null, cargarFilas()]);
  }, [cargarCampus, cargarCursos, cargarFilas, centro]);

  // ── derivados ───────────────────────────────────────────────────
  const elegido = campus?.find((c) => c.codigo === centro) ?? null;
  const totales = useMemo(() => suma(campus ?? []), [campus]);
  const cursoElegido = cursos?.find((c) => c.cursoRef === curso) ?? null;
  const ambito: Recuentos | null = cursoElegido ?? elegido;

  const porId = useMemo(() => new Map(filas.map((f) => [f.matriculaId, f])), [filas]);
  const seleccion = [...elegidas].map((id) => porId.get(id)).filter((c): c is Candidato => !!c);
  const emitibles = seleccion.filter((c) => c.decision?.decision === 'aprobada' && !c.nexpediente);
  const sinTitulo = seleccion.filter((c) => !c.nexpediente);
  const todasElegidas = filas.length > 0 && filas.every((f) => elegidas.has(f.matriculaId));
  const paginas = Math.max(1, Math.ceil(total / tam));
  const nombre = (id: number | null) => {
    const c = id !== null ? porId.get(id) : undefined;
    return c ? (c.titular.nombre || c.titular.email || `Matrícula #${c.matriculaId}`) : `Matrícula #${id}`;
  };
  const alternar = (id: number) => setElegidas((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  // ── acciones ────────────────────────────────────────────────────
  async function decidir(ids: number[], decision: 'aprobada' | 'rechazada', motivo: string | null = null) {
    const r = await emisionesApi.decidir(ids.map((matriculaId) => ({ matriculaId, decision, motivo })));
    const malas = r.data.resultados.filter((x) => !x.ok);
    return { buenas: r.data.resultados.length - malas.length, malas, yaEmitidas: r.data.resultados.filter((x) => x.yaEmitida) };
  }

  async function emitirEnTandas(ids: number[]) {
    const out: ResultadoEmision[] = [];
    for (let i = 0; i < ids.length; i += TANDA_EMITIR) {
      const r = await emisionesApi.emitir(ids.slice(i, i + TANDA_EMITIR));
      out.push(...r.data.resultados);
      setLote({ hechas: Math.min(i + TANDA_EMITIR, ids.length), total: ids.length });
    }
    return out;
  }

  function contarEmision(res: ResultadoEmision[], errores: { quien: string; error: string }[]) {
    const nuevas = res.filter((r) => r.ok && !r.yaExistia).length;
    const yaTenian = res.filter((r) => r.ok && r.yaExistia).length;
    errores.push(...res.filter((r) => !r.ok).map((r) => ({ quien: nombre(r.matriculaId), error: r.error ?? 'Error' })));
    toast({
      title: `${nuevas} ${nuevas === 1 ? 'título emitido' : 'títulos emitidos'}`,
      description: [yaTenian ? `${yaTenian} ya lo tenían` : '', errores.length ? `${errores.length} sin emitir: el motivo, en pantalla` : ''].filter(Boolean).join(' · ') || undefined,
      variant: errores.length && !nuevas ? 'destructive' : undefined,
    });
    setFallos(errores);
  }

  async function ejecutar(fn: () => Promise<void>, error: string) {
    setTrabajando(true);
    setFallos([]);
    try { await fn(); await recargarTodo(); }
    catch (e) { toast({ title: error, description: (e as Error).message, variant: 'destructive' }); }
    finally { setTrabajando(false); setLote(null); }
  }

  const aprobar = (ids: number[]) => ejecutar(async () => {
    const { buenas, malas } = await decidir(ids, 'aprobada');
    toast({ title: `${buenas} ${buenas === 1 ? 'aprobada' : 'aprobadas'}`, description: 'Ya se pueden emitir, desde aquí o desde el panel de Certifex.' });
    setFallos(malas.map((m) => ({ quien: nombre(m.matriculaId), error: m.error ?? 'Error' })));
  }, 'No se pudo aprobar');

  const rechazar = (ids: number[], motivo: string) => ejecutar(async () => {
    const { buenas, malas, yaEmitidas } = await decidir(ids, 'rechazada', motivo);
    toast({ title: `${buenas} ${buenas === 1 ? 'rechazada' : 'rechazadas'}` });
    setFallos([
      ...malas.map((m) => ({ quien: nombre(m.matriculaId), error: m.error ?? 'Error' })),
      // Rechazar no revoca: si ya tenía título, alguien tiene que mirarlo en Certifex.
      ...yaEmitidas.map((m) => ({ quien: nombre(m.matriculaId), error: `Ya tenía título (${m.yaEmitida}). Rechazarla no lo revoca: eso se hace en el panel de Certifex.` })),
    ]);
  }, 'No se pudo rechazar');

  const emitir = (ids: number[], aprobarAntes: boolean) => ejecutar(async () => {
    const errores: { quien: string; error: string }[] = [];
    let aEmitir = ids;
    if (aprobarAntes) {
      const { malas } = await decidir(ids, 'aprobada');
      errores.push(...malas.map((m) => ({ quien: nombre(m.matriculaId), error: m.error ?? 'Error' })));
      const fallidas = new Set(malas.map((m) => m.matriculaId));
      aEmitir = ids.filter((id) => !fallidas.has(id));
    }
    contarEmision(aEmitir.length ? await emitirEnTandas(aEmitir) : [], errores);
  }, 'No se pudo emitir');

  /**
   * Todo lo aprobado y sin título del campus (o del curso elegido), en tandas y con el
   * avance a la vista. Solo lo APROBADO: lo que está por decidir sigue necesitando que
   * alguien lo mire.
   */
  const emitirTodo = () => ejecutar(async () => {
    if (!centro) return;
    const ids: number[] = [];
    for (let p = 1; ; p++) {
      const r = await emisionesApi.listar({ estado: 'aprobada', centro, curso: curso ?? undefined, pagina: p });
      ids.push(...r.data.filas.filter((f) => !f.nexpediente).map((f) => f.matriculaId));
      if (p * r.data.tam >= r.data.total || r.data.filas.length === 0) break;
    }
    contarEmision(ids.length ? await emitirEnTandas(ids) : [], []);
  }, 'No se pudo emitir');

  const acciones = (
    <>
      {base && (
        <Button variant="outline" size="sm" asChild>
          <a href={base} target="_blank" rel="noreferrer noopener">
            <ArrowSquareOut size={13} weight="bold" className="mr-1.5" /> Abrir Certifex
          </a>
        </Button>
      )}
      {conexion?.conectado && (
        <Button variant="outline" size="sm" onClick={recargarTodo} disabled={trabajando}>
          <ArrowClockwise size={13} weight="bold" className="mr-1.5" /> Actualizar
        </Button>
      )}
    </>
  );

  // ── sin conexión ────────────────────────────────────────────────
  if (conexion && !conexion.conectado) {
    return (
      <div className="space-y-4">
        <Cabecera title="Certifex · Emisiones" subtitle="El visto bueno y la emisión de títulos en Certifex" />
        <Card padding="none">
          <EmptyState
            icon={PlugsConnected}
            title="Certifex no está conectado"
            description={conexion.error || 'Faltan CERTIFEX_API_URL y CERTIFEX_CRM_CLAVE en el .env del servidor del CRM. La clave se genera en Certifex con «npm run crm:clave» y solo va en el servidor: el navegador no la ve nunca.'}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-24">
      <Cabecera
        title="Certifex · Emisiones"
        subtitle={conexion?.conectado
          ? <span className="inline-flex flex-wrap items-center gap-2">
              <StatusDot tono="success">Conectado{conexion.nombre ? ` como ${conexion.nombre}` : ''}</StatusDot>
              <span>· Certifex no emite nada que no se apruebe aquí</span>
            </span>
          : 'Conectando con Certifex…'}
        actions={acciones}
      />

      {/* Resumen de todos los campus de este CRM. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard icon={HourglassMedium} iconBg="bg-info-soft text-info-soft-foreground" label="Por decidir" value={campus ? totales.porDecidir.toLocaleString('es') : '…'} />
        <KpiCard icon={SealCheck} iconBg="bg-success-soft text-success-soft-foreground" label="Listas para emitir" value={campus ? totales.aprobadasSinEmitir.toLocaleString('es') : '…'} />
        <KpiCard icon={XCircle} iconBg="bg-destructive-soft text-destructive-soft-foreground" label="Rechazadas" value={campus ? totales.rechazadas.toLocaleString('es') : '…'} />
        <KpiCard
          icon={Certificate}
          label="Con título"
          value={campus ? totales.emitidas.toLocaleString('es') : '…'}
          badge={campus && totales.matriculados ? `${Math.round((totales.emitidas / totales.matriculados) * 100)}%` : null}
        />
      </div>

      {/* Los campus. */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Campus <span className="font-normal text-muted-foreground">· {campus?.length ?? '…'}</span></h2>
          <span className="text-xs text-muted-foreground">Elige un campus para ver sus cursos y sus alumnos</span>
        </div>
        {campus === null ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />)}</div>
        ) : campus.length === 0 ? (
          <Card padding="none">
            <EmptyState icon={Buildings} title="Este CRM no tiene campus en Certifex" description="Al dar de alta la clave del CRM en Certifex se eligen sus campus (npm run crm:clave)." />
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {campus.map((c) => {
              const activo = c.codigo === centro;
              const pct = c.matriculados ? Math.round((c.emitidas / c.matriculados) * 100) : 0;
              return (
                <button
                  key={c.codigo}
                  type="button"
                  aria-pressed={activo}
                  onClick={() => setCentro(c.codigo)}
                  className={cn(
                    'rounded-lg border bg-card p-4 text-left shadow-sm transition-colors',
                    activo ? 'border-primary ring-2 ring-primary/20' : 'border-border hover:border-foreground/20',
                  )}
                >
                  <div className="flex items-start gap-3">
                    <LogoCampus c={c} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold">{c.nombre}</span>
                        {!c.activo && <Etiqueta tono="neutral">Inactivo</Etiqueta>}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {c.codigo} · {host(c.moodleUrl) ?? 'importación, sin Moodle'}
                      </div>
                    </div>
                    {activo && <CheckCircle size={18} weight="fill" className="flex-none text-primary" />}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.porDecidir > 0 && <Etiqueta tono="info">{c.porDecidir} por decidir</Etiqueta>}
                    {c.aprobadasSinEmitir > 0 && <Etiqueta tono="success">{c.aprobadasSinEmitir} por emitir</Etiqueta>}
                    {c.rechazadas > 0 && <Etiqueta tono="destructive">{c.rechazadas} rechazadas</Etiqueta>}
                    {c.porDecidir + c.aprobadasSinEmitir === 0 && <Etiqueta tono="neutral">Al día</Etiqueta>}
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{c.emitidas.toLocaleString('es')} de {c.matriculados.toLocaleString('es')} con título</span>
                      <span>{c.cursos} {c.cursos === 1 ? 'curso' : 'cursos'}</span>
                    </div>
                    <Barra valor={pct} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Alumnos del campus elegido: el curso se elige en el desplegable. */}
      {elegido && (
        <section className="space-y-3">
          {fallos.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="font-medium text-destructive-soft-foreground">
                  {fallos.length} {fallos.length === 1 ? 'no se ha podido completar' : 'no se han podido completar'}
                </span>
                <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setFallos([])}>Cerrar</button>
              </div>
              <ul className="space-y-1">
                {fallos.slice(0, 12).map((f, i) => (
                  <li key={i} className="text-xs"><span className="font-medium">{f.quien}:</span> <span className="text-muted-foreground">{f.error}</span></li>
                ))}
              </ul>
              {fallos.length > 12 && <p className="mt-1 text-xs text-muted-foreground">y {fallos.length - 12} más.</p>}
            </div>
          )}

          <Card padding="none">
            <CardSection className="flex flex-wrap items-center gap-3">
              <LogoCampus c={elegido} size={36} />
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">Alumnos de</div>
                <div className="truncate font-semibold">{elegido.nombre}</div>
              </div>
              <div className="order-last w-full sm:order-none sm:ml-auto sm:w-auto">
                <SelectorCurso campus={elegido} cursos={cursos} curso={curso} alElegir={(c) => { setCurso(c); setPagina(1); }} />
              </div>
              {ambito && ambito.aprobadasSinEmitir > 0 && (
                <Button size="sm" disabled={trabajando} onClick={() => setAccion({ tipo: 'emitirTodo', n: ambito.aprobadasSinEmitir })}>
                  <Lightning size={14} weight="bold" className="mr-1.5" />
                  {trabajando && lote ? `Emitiendo ${lote.hechas} de ${lote.total}…` : `Emitir todo lo aprobado (${ambito.aprobadasSinEmitir})`}
                </Button>
              )}
            </CardSection>
            <CardSection className="flex flex-wrap items-center gap-2">
              {ESTADOS.map((e) => (
                <Pestana key={e.clave} activa={estado === e.clave} cuenta={ambito ? e.cuenta(ambito) : undefined}
                  onClick={() => { setEstado(e.clave); setPagina(1); }}>
                  {e.rotulo}
                </Pestana>
              ))}
              <div className="ml-auto min-w-[200px] flex-1 sm:max-w-[300px]">
                <Buscador id="certifex-buscar-alumno" valor={buscar} alCambiar={setBuscar} placeholder="Nombre, correo o DNI…" />
              </div>
            </CardSection>

            {cargandoFilas && filas.length === 0 ? (
              <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />)}</div>
            ) : filas.length === 0 ? (
              <EmptyState
                icon={estado === 'pendiente' ? CheckCircle : SealCheck}
                title={q ? 'Nadie coincide con la búsqueda' : estado === 'pendiente' ? 'Nada por decidir aquí' : 'Nada por aquí'}
                description={q ? 'Prueba con otra parte del nombre, el correo o el DNI.' : estado === 'pendiente' ? 'Cuando Certifex proponga a alguien de este campus para su título, aparecerá aquí.' : undefined}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="w-10 px-4 py-2 text-left">
                        <input id="certifex-elegir-todas" type="checkbox" aria-label="Elegir toda la página" checked={todasElegidas}
                          onChange={() => setElegidas(todasElegidas ? new Set() : new Set(filas.map((f) => f.matriculaId)))} />
                      </th>
                      <th className="px-2 py-2 text-left font-medium">Alumno</th>
                      {curso === null && <th className="px-2 py-2 text-left font-medium">Curso</th>}
                      <th className="px-2 py-2 text-right font-medium">Nota · avance</th>
                      <th className="px-2 py-2 text-left font-medium" title="Lo que dice el CRM de ese correo: si compró y si lo tiene pagado">En el CRM</th>
                      <th className="px-2 py-2 text-left font-medium">Visto bueno</th>
                      <th className="px-2 py-2 pr-4 text-left font-medium">Título</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filas.map((c) => (
                      <tr key={c.matriculaId} onClick={() => setAbierta(c)}
                        className={cn('cursor-pointer transition-colors', elegidas.has(c.matriculaId) ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                        <td className="px-4 py-2.5 align-top" onClick={(e) => e.stopPropagation()}>
                          <input id={`certifex-elegir-${c.matriculaId}`} type="checkbox" aria-label={`Elegir a ${c.titular.nombre ?? c.matriculaId}`}
                            checked={elegidas.has(c.matriculaId)} onChange={() => alternar(c.matriculaId)} />
                        </td>
                        <td className="px-2 py-2.5 align-top">
                          <div className="max-w-[240px] truncate font-medium">{c.titular.nombre || c.titular.email || '—'}</div>
                          <div className="max-w-[240px] truncate text-xs text-muted-foreground">{c.titular.email || 'sin correo'}</div>
                        </td>
                        {curso === null && <td className="px-2 py-2.5 align-top"><div className="max-w-[220px] truncate" title={c.curso.nombre}>{c.curso.nombre}</div></td>}
                        <td className="px-2 py-2.5 text-right align-top">
                          <div className="whitespace-nowrap">
                            {c.notaFinal == null ? <span className="text-muted-foreground">—</span> : (
                              <span className={cn('tabular-nums', c.umbral != null && c.notaFinal >= c.umbral ? 'font-medium text-success-soft-foreground' : 'text-muted-foreground')}>
                                {c.notaFinal.toLocaleString('es', { maximumFractionDigits: 2 })}
                                {c.umbral != null && <span className="text-[11px] text-muted-foreground"> /{c.umbral}</span>}
                              </span>
                            )}
                          </div>
                          <div className="mt-1"><Avance hechas={c.actividades.calificadas} total={c.actividades.total} /></div>
                        </td>
                        <td className="px-2 py-2.5 align-top"><EnElCrmEtiqueta crm={c.crm} /></td>
                        <td className="px-2 py-2.5 align-top">
                          <Decision c={c} />
                          {c.decision && <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-muted-foreground">{c.decision.decididoPor}</div>}
                        </td>
                        <td className="px-2 py-2.5 pr-4 align-top">
                          {c.nexpediente ? (
                            <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-primary">
                              <Certificate size={14} /> {c.nexpediente}
                            </span>
                          ) : c.propuesto ? <Etiqueta tono="neutral">Propuesto</Etiqueta> : <span className="text-xs text-muted-foreground">Sin emitir</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {total > 0 && (
              <CardSection className="flex flex-wrap items-center justify-between gap-2 border-t text-xs text-muted-foreground">
                <span>{total.toLocaleString('es')} {total === 1 ? 'matrícula' : 'matrículas'}{cargandoFilas ? ' · cargando…' : ''}</span>
                {paginas > 1 && (
                  <span className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={pagina <= 1 || cargandoFilas} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
                    {pagina} / {paginas}
                    <Button variant="outline" size="sm" disabled={pagina >= paginas || cargandoFilas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button>
                  </span>
                )}
              </CardSection>
            )}
          </Card>
        </section>
      )}

      {/* Barra de acciones: solo con algo elegido, y dice cuántas de verdad se pueden emitir. */}
      {elegidas.size > 0 && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card px-4 py-3 shadow-lg">
          <span className="text-sm font-semibold">{elegidas.size} {elegidas.size === 1 ? 'elegida' : 'elegidas'}</span>
          <span className="text-xs text-muted-foreground">
            {emitibles.length} lista{emitibles.length === 1 ? '' : 's'} para emitir · {sinTitulo.length} sin título
          </span>
          <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setElegidas(new Set())}>Quitar selección</button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={trabajando || sinTitulo.length === 0} onClick={() => aprobar(sinTitulo.map((c) => c.matriculaId))}>
              <CheckCircle size={14} className="mr-1.5" /> Aprobar
            </Button>
            <Button variant="outline" size="sm" disabled={trabajando} onClick={() => setAccion({ tipo: 'rechazar', ids: [...elegidas] })}>
              <XCircle size={14} className="mr-1.5" /> Rechazar
            </Button>
            <Button variant="secondary" size="sm" disabled={trabajando || sinTitulo.length === 0} onClick={() => setAccion({ tipo: 'aprobarEmitir', ids: sinTitulo.map((c) => c.matriculaId) })}>
              <SealCheck size={14} className="mr-1.5" /> Aprobar y emitir ({sinTitulo.length})
            </Button>
            <Button size="sm" disabled={trabajando || emitibles.length === 0} onClick={() => setAccion({ tipo: 'emitir', ids: emitibles.map((c) => c.matriculaId) })}>
              <Certificate size={14} weight="bold" className="mr-1.5" />
              {trabajando && lote ? `Emitiendo ${lote.hechas} de ${lote.total}…` : `Emitir ${emitibles.length}`}
            </Button>
          </div>
        </div>
      )}

      {/* Confirmaciones, con los diálogos del CRM. */}
      <ConfirmDialog
        open={!!accion && accion.tipo !== 'rechazar'}
        title={accion?.tipo === 'emitirTodo'
          ? `Emitir ${accion.n} ${accion.n === 1 ? 'título' : 'títulos'}`
          : accion?.tipo === 'aprobarEmitir' ? `Aprobar y emitir ${accion.ids.length}`
            : accion?.tipo === 'emitir' ? `Emitir ${accion.ids.length} ${accion.ids.length === 1 ? 'título' : 'títulos'}` : ''}
        message={
          <>
            {accion?.tipo === 'emitirTodo'
              ? <>Todo lo aprobado y sin título de <strong>{cursoElegido?.cursoNombre ?? elegido?.nombre}</strong>. </>
              : accion?.tipo === 'aprobarEmitir' ? 'Se aprueban y se emiten en Certifex. ' : 'Se emiten en Certifex. '}
            Cada título gasta un número de expediente en un registro que <strong>no se borra</strong>: si luego resulta que no tocaba, solo se puede revocar. Queda a tu nombre.
          </>
        }
        confirmLabel="Emitir"
        tone="warning"
        loading={trabajando}
        onCancel={() => setAccion(null)}
        onConfirm={() => {
          const a = accion;
          setAccion(null);
          if (a?.tipo === 'emitirTodo') void emitirTodo();
          else if (a && a.tipo !== 'rechazar') void emitir(a.ids, a.tipo === 'aprobarEmitir');
        }}
      />
      <PromptDialog
        open={accion?.tipo === 'rechazar'}
        title={`Rechazar ${accion?.tipo === 'rechazar' ? accion.ids.length : 0}`}
        message="Certifex no les emitirá título mientras sigan rechazadas. Si alguna ya lo tenía, no se revoca: se avisa en pantalla."
        placeholder="Motivo: sin pagar, baja, no entregó el trabajo final…"
        confirmLabel="Rechazar"
        multiline
        loading={trabajando}
        onCancel={() => setAccion(null)}
        onConfirm={(motivo: string) => {
          const a = accion;
          setAccion(null);
          if (a?.tipo === 'rechazar') void rechazar(a.ids, motivo.trim());
        }}
      />

      {abierta && (
        <Ficha
          c={abierta}
          campus={campus?.find((x) => x.codigo === abierta.centro) ?? null}
          base={base}
          ocupado={trabajando}
          alCerrar={() => setAbierta(null)}
          alAprobar={() => { const id = abierta.matriculaId; setAbierta(null); void aprobar([id]); }}
          alRechazar={() => { const id = abierta.matriculaId; setAbierta(null); setAccion({ tipo: 'rechazar', ids: [id] }); }}
          alEmitir={() => {
            const c = abierta;
            setAbierta(null);
            setAccion({ tipo: c.decision?.decision === 'aprobada' ? 'emitir' : 'aprobarEmitir', ids: [c.matriculaId] });
          }}
        />
      )}
    </div>
  );
}

/**
 * La ficha de una matrícula: lo que Certifex sabe de ella, el visto bueno y, si ya
 * tiene título, el título mismo. El diploma se ve aquí dentro (lo trae el servidor del
 * CRM: Certifex no se deja incrustar en otro dominio); la verificación pública se abre
 * en Certifex, como la vería cualquiera que escanee el QR.
 */
function Ficha({ c, campus, base, ocupado, alCerrar, alAprobar, alRechazar, alEmitir }: {
  c: Candidato;
  campus: CampusCertifex | null;
  base: string | null;
  ocupado: boolean;
  alCerrar: () => void;
  alAprobar: () => void;
  alRechazar: () => void;
  alEmitir: () => void;
}) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [errorPdf, setErrorPdf] = useState<string | null>(null);

  useEffect(() => {
    if (!c.nexpediente) return;
    let url: string | null = null;
    let vivo = true;
    emisionesApi.diploma(c.nexpediente)
      .then((b) => { if (vivo) { url = URL.createObjectURL(b); setPdf(url); } })
      .catch((e) => { if (vivo) setErrorPdf((e as Error).message); });
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [c.nexpediente]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && alCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [alCerrar]);

  const dato = (k: string, v: React.ReactNode) => (v !== null && v !== undefined && v !== '' ? (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="w-28 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">{k}</span>
      <span className="min-w-0 break-words">{v}</span>
    </div>
  ) : null);
  const exp = c.nexpediente ? encodeURIComponent(c.nexpediente) : '';
  const aprobada = c.decision?.decision === 'aprobada';

  return (
    // `!m-0`: el contenedor de la página pone margen al primer hijo (igual que en Consultas).
    <div className="fixed inset-0 !m-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={alCerrar}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={c.titular.nombre ?? 'Ficha'}
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg border border-border bg-card shadow-2xl">
        <div className="flex items-start gap-3 border-b border-border p-4">
          {campus && <LogoCampus c={campus} size={40} />}
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{campus?.nombre ?? c.centro} · matrícula #{c.matriculaId}</p>
            <h2 className="truncate font-bold">{c.titular.nombre || c.titular.email || 'Sin nombre'}</h2>
            <p className="truncate text-xs text-muted-foreground">{c.curso.nombre}</p>
          </div>
          <button type="button" onClick={alCerrar} aria-label="Cerrar" className="shrink-0 text-muted-foreground hover:text-foreground">
            <X size={16} weight="bold" />
          </button>
        </div>

        <div className="grid gap-5 p-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="space-y-4">
            <div className="divide-y divide-border">
              {dato('Correo', c.titular.email ? <span className="select-all font-mono text-[13px]">{c.titular.email}</span> : null)}
              {dato('DNI', c.titular.dni ? <span className="select-all font-mono text-[13px]">{c.titular.dni}</span> : null)}
              {dato('Nota', c.notaFinal == null ? '—' : (
                <span className={c.umbral != null && c.notaFinal >= c.umbral ? 'font-medium text-success-soft-foreground' : ''}>
                  {c.notaFinal.toLocaleString('es', { maximumFractionDigits: 2 })}{c.umbral != null ? ` (aprueba con ${c.umbral})` : ''}
                </span>
              ))}
              {dato('Avance', <Avance hechas={c.actividades.calificadas} total={c.actividades.total} />)}
              {c.crm !== undefined && dato('En el CRM', c.crm === null ? 'Ese correo no está en el CRM' : (
                <span className="inline-flex flex-col gap-1">
                  <EnElCrmEtiqueta crm={c.crm} />
                  {c.crm.ventas > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {c.crm.ventas} {c.crm.ventas === 1 ? 'venta' : 'ventas'} · vendido {euros(c.crm.vendido)} · cobrado {euros(c.crm.cobrado)}
                    </span>
                  )}
                  <a href={`${import.meta.env.BASE_URL}prospectos/${c.crm.leadId}`} target="_blank" rel="noreferrer noopener" className="text-xs text-primary hover:underline">
                    Abrir su ficha en el CRM
                  </a>
                </span>
              ))}
              {dato('En Moodle', c.completado === true ? 'Curso completado' : c.completado === false ? 'Sin completar' : 'Finalización desconocida')}
              {dato('Certifex', c.propuesto ? 'Propuesto para título' : 'No propuesto')}
            </div>

            <Card padding="sm" className="shadow-none">
              <div className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Visto bueno del CRM</div>
              <div className="flex flex-wrap items-center gap-2">
                <Decision c={c} />
                {c.decision && <span className="text-xs text-muted-foreground">{c.decision.decididoPor} · {fecha(c.decision.decididoEn)}</span>}
              </div>
              {c.decision?.motivo && <p className="mt-1.5 text-sm italic text-muted-foreground">«{c.decision.motivo}»</p>}
              {!c.nexpediente && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {!aprobada && <Button variant="outline" size="sm" disabled={ocupado} onClick={alAprobar}><CheckCircle size={14} className="mr-1.5" /> Aprobar</Button>}
                  {c.decision?.decision !== 'rechazada' && <Button variant="outline" size="sm" disabled={ocupado} onClick={alRechazar}><XCircle size={14} className="mr-1.5" /> Rechazar</Button>}
                  <Button size="sm" disabled={ocupado} onClick={alEmitir}>
                    <Certificate size={14} weight="bold" className="mr-1.5" /> {aprobada ? 'Emitir título' : 'Aprobar y emitir'}
                  </Button>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Título</div>
            {!c.nexpediente ? (
              <div className="rounded-md border border-dashed border-border">
                <EmptyState
                  icon={Certificate}
                  title="Todavía sin título"
                  description={aprobada ? 'Está aprobada: se puede emitir ahora.' : 'Primero hay que darle el visto bueno.'}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-primary/5 px-3 py-2.5">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Nº de expediente</div>
                    <div className="select-all font-mono font-semibold text-primary">{c.nexpediente}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {base && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={`${base}/verificar?exp=${exp}`} target="_blank" rel="noreferrer noopener">
                          <SealCheck size={14} className="mr-1.5" /> Verificación pública
                        </a>
                      </Button>
                    )}
                    {pdf && (
                      <>
                        <Button variant="outline" size="sm" asChild>
                          <a href={pdf} target="_blank" rel="noreferrer noopener"><ArrowSquareOut size={14} className="mr-1.5" /> Abrir</a>
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                          <a href={pdf} download={`${c.nexpediente}.pdf`}><DownloadSimple size={14} className="mr-1.5" /> PDF</a>
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {errorPdf ? (
                  <p className="text-sm text-destructive">No se pudo traer el diploma: {errorPdf}</p>
                ) : pdf ? (
                  <iframe title={`Diploma ${c.nexpediente}`} src={pdf} className="h-[460px] w-full rounded-md border border-border bg-muted" />
                ) : (
                  <div className="h-[460px] animate-pulse rounded-md bg-muted" />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
