import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowClockwise, ArrowCounterClockwise, ArrowSquareOut, BookOpenText, Certificate, CheckCircle, DownloadSimple, Envelope, FileXls, FilePdf,
  FlagCheckered, HourglassMedium, LinkSimple, NotePencil, PaperPlaneTilt, PencilSimple, PlugsConnected, Plus, Printer, Prohibit, SealCheck, Trash, Warning, X, XCircle,
} from '@phosphor-icons/react';
import { toast, useToast } from '@/shared/hooks/useToast';
import { useModalAccesible } from '@/shared/hooks/useDialogA11y';
import KpiCard from '@/shared/components/ui/KpiCard';
import Card, { CardSection } from '@/shared/components/ui/Card';
import EmptyState from '@/shared/components/ui/EmptyState';
import StatusDot from '@/shared/components/ui/StatusDot';
import ConfirmDialog from '@/shared/components/ui/ConfirmDialog';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import Select from '@/shared/components/ui/Select';
import SearchableSelect from '@/shared/components/ui/SearchableSelect';
import Portal from '@/shared/components/ui/portal';
import { Button } from '@/shared/components/ui/button';
import { cn } from '@/shared/lib/utils';
import { copyToClipboard } from '@/shared/lib/clipboard';
import { runExport, type ExportColumn } from '@/shared/lib/export';
import {
  diplomasApi, emisionesApi,
  type CambiosSolicitud, type CampusCertifex, type CatalogoDelCampus, type ConexionCertifex, type CursoCertifex, type Diploma, type FiltroAviso,
  type PestanaDiplomas, type ProgramaDelCrm, type ProgramaOficial, type ResultadoAprobarEmitir, type ResumenDiplomas, type Solicitud, type Terminado,
} from '../api/certifex.api';
import { Avance, AvisoCasiListo, AvisoDireccionPublica, Buscador, EnElCrmEtiqueta, Etiqueta, Pestana } from '../components/piezas';

/**
 * Certifex · Diplomas (#272): lo que los alumnos piden desde Moodle y los diplomas ya
 * emitidos, en cinco pestañas: Pendientes · Terminaron sin pedir · Emitidos · Rechazados ·
 * Revocados. («Emitidos» conserva la clave `enviados` en la URL, por los enlaces que ya hay.)
 *
 * El recorrido, con las decisiones del 08/10:
 *  1. El alumno termina, escribe su nombre (sin DNI) y lo pide. Llega aquí y suena la
 *     campana. El nombre que escribió es el que se imprime: va destacado junto al de
 *     Moodle para revisarlo.
 *  2. «Aprobar y emitir»: visto bueno y diploma, en un paso. NO avisa al alumno.
 *  3. El diploma queda «pendiente de aviso»: se ve el PDF y, si está bien, «Enviar
 *     diploma al alumno». Solo entonces sale el correo, y solo si una persona lo aprueba.
 *  4. Un nombre mal escrito se CORRIGE (mismo número, queda registrado); revocar es para
 *     lo que no debía emitirse.
 */

const PESTANAS: { clave: PestanaDiplomas; rotulo: string }[] = [
  { clave: 'pendientes', rotulo: 'Pendientes' },
  { clave: 'terminados', rotulo: 'Terminaron sin pedir' },
  { clave: 'enviados', rotulo: 'Emitidos' },
  { clave: 'rechazados', rotulo: 'Rechazados' },
  { clave: 'revocados', rotulo: 'Revocados' },
];

/** Por llamada: emitir baja el expediente de Moodle en serie (ver TANDA_EMITIR en Emisiones). */
const TANDA_EMITIR = 10;
/** Cada aviso genera el PDF y manda un correo: tandas cortas para no pasar del minuto de nginx. */
const TANDA_AVISOS = 10;
const TAM = 50;

const fecha = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—');
const fechaHora = (iso: string | null | undefined) => (iso
  ? new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—');
const sinAcentos = (t: string) => t.toLocaleLowerCase('es').normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
const hoy = () => new Date().toLocaleDateString('sv-SE');
/** Para Excel: «09/10/2026 14:30», en hora de Madrid (la de la oficina), como texto. */
const fechaExcel = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
};

/** Lo mismo que piden Certifex y el servidor del CRM al motivo de rechazar, revocar o corregir. */
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 500;

/**
 * El nombre tal y como saldrá en el diploma: la MISMA regla que Certifex y el servidor
 * del CRM (letras, espacios, apóstrofo, guion y punto; de 3 a 160; nombre y apellido).
 * El apóstrofo tipográfico (O’Neill) vale como el recto. null si no es un nombre válido.
 */
function nombreValido(v: string): string | null {
  const s = v.normalize('NFC').replace(/[‘’ʼ]/g, "'").replace(/[‐‑]/g, '-').replace(/\s+/g, ' ').trim();
  if (s.length < 3 || s.length > 160 || !s.includes(' ') || !/^\p{L}[\p{L}\p{M}' .-]*\p{L}\.?$/u.test(s)) return null;
  if (/\p{M}{3,}/u.test(s)) return null;
  return s;
}
const MSG_NOMBRE = 'Escribe el nombre completo (nombre y apellidos), de 3 a 160 caracteres, solo con letras.';

/** «8,8 · aprobado desde 5». */
const notaTexto = (nota: number | null, umbral: number | null) => (nota == null
  ? '—'
  : `${nota.toLocaleString('es', { maximumFractionDigits: 2 })}${umbral != null ? ` · aprobado desde ${umbral.toLocaleString('es', { maximumFractionDigits: 2 })}` : ''}`);

type Fallo = { quien: string; error: string };
type Dialogo =
  | null
  | { tipo: 'aprobarEmitir'; ids: number[] }
  | { tipo: 'emitir'; ids: number[] }
  | { tipo: 'rechazar'; ids: number[] }
  | { tipo: 'avisos'; exps: string[]; reenvio: boolean; fuera?: boolean }
  | { tipo: 'avisoRechazo'; ids: number[] }
  | { tipo: 'revocar'; d: Diploma }
  | { tipo: 'corregir'; d: Diploma };

const ROTULO_AVISO: Record<string, string> = {
  enviado: 'enviado',
  correo_apagado: 'correo apagado en el servidor',
  sin_correo: 'sin correo',
  error: 'error al enviar',
};

async function enTandas<T, R>(xs: T[], n: number, fn: (lote: T[]) => Promise<R[]>, avance?: (hechas: number) => void) {
  const out: R[] = [];
  for (let i = 0; i < xs.length; i += n) {
    out.push(...(await fn(xs.slice(i, i + n))));
    avance?.(Math.min(i + n, xs.length));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── piezas

/** El nombre que se imprimirá, destacado, y el de Moodle debajo para compararlo. */
function NombreDiploma({ c }: { c: Solicitud }) {
  const pedido = c.solicitud?.nombre?.trim() || '';
  const moodle = c.titular.nombre?.trim() || '';
  const igual = pedido && moodle && pedido === moodle;
  const casi = !igual && pedido && moodle && sinAcentos(pedido) === sinAcentos(moodle);
  const revisado = c.solicitud?.revisado;
  const delAlumno = c.solicitud?.nombreAlumno?.trim() || '';
  return (
    <div className="min-w-0 max-w-[280px]">
      <div className="truncate text-[15px] font-semibold text-foreground" title={pedido || undefined}>
        {pedido || <span className="italic text-muted-foreground">Sin nombre</span>}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="truncate" title={moodle || undefined}>En Moodle: {moodle || '—'}</span>
        {pedido && moodle && !igual && (
          casi ? <Etiqueta tono="neutral">Tildes o mayúsculas</Etiqueta> : <Etiqueta tono="warning">Distinto de Moodle</Etiqueta>
        )}
        {revisado && (
          <span title={`Revisado por ${revisado.por} el ${fechaHora(revisado.en)}${delAlumno && delAlumno !== pedido ? `. Lo escribió el alumno: ${delAlumno}` : ''}`}>
            <Etiqueta tono="info">Nombre revisado</Etiqueta>
          </span>
        )}
      </div>
    </div>
  );
}

/** El correo con el que se busca al alumno en el CRM, si alguien lo revisó a mano. */
function CorreoDelAlumno({ c }: { c: Solicitud }) {
  return (
    <>
      <div className="mt-0.5 max-w-[280px] truncate text-xs text-muted-foreground" title={c.titular.email ?? undefined}>{c.titular.email || 'sin correo'}</div>
      {c.edicion?.emailCrm && (
        <div className="mt-0.5 max-w-[280px] truncate text-xs text-info-soft-foreground" title={`Se busca en el CRM con ${c.edicion.emailCrm} (revisado a mano)`}>
          En el CRM: {c.edicion.emailCrm}
        </div>
      )}
    </>
  );
}

// «1.500 h»: en español `toLocaleString` no agrupa los números de cuatro cifras.
const miles = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const resumenPrograma = (p: ProgramaOficial) => [
  p.horas ? `${miles(p.horas)} h` : null,
  p.modulos.length ? `${p.modulos.length} ${p.modulos.length === 1 ? 'módulo' : 'módulos'}` : null,
].filter(Boolean).join(' · ');

/** La lista de módulos, plegada: se abre para revisarla antes de aprobar. */
function Modulos({ programa, rotulo }: { programa: ProgramaOficial; rotulo: string }) {
  return (
    <details className="group mt-1 max-w-[280px] text-xs">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded text-success-soft-foreground hover:underline focus:outline-none focus:ring-2 focus:ring-primary/40">
        <BookOpenText size={13} /> {rotulo}
      </summary>
      {programa.modulos.length > 0 && (
        <ol className="mt-1 list-decimal space-y-0.5 rounded-md border border-border bg-muted/30 py-1.5 pl-6 pr-2 text-muted-foreground">
          {programa.modulos.map((m, i) => (
            <li key={i}><span className="text-foreground">{m.titulo}</span>{m.horas != null && <span className="tabular-nums"> · {m.horas} h</span>}</li>
          ))}
        </ol>
      )}
    </details>
  );
}

/**
 * Lo que se imprimirá en el diploma si se aprueba ahora: el programa de la formación
 * vendida (horas y módulos), o el aviso de que se usará lo de Moodle, con el motivo.
 */
function ProgramaAImprimir({ p }: { p: ProgramaDelCrm | null | undefined }) {
  if (p === undefined) return null;
  if (p?.programa) {
    const rotulo = p.editado
      ? `Programa editado a mano · ${resumenPrograma(p.programa)}`
      : p.elegida ? `Formación elegida a mano · ${resumenPrograma(p.programa)}` : resumenPrograma(p.programa);
    return (
      <>
        <Modulos programa={p.programa} rotulo={rotulo} />
        {p.elegida && p.formacion && (
          <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted-foreground" title={p.formacion.nombre}>Formación: {p.formacion.nombre}</p>
        )}
      </>
    );
  }
  return (
    <div className="mt-1 max-w-[280px]" title={p?.motivo ?? undefined}>
      <Etiqueta tono="warning">Sin programa del CRM: se usará lo de Moodle</Etiqueta>
      {p?.motivo && <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{p.motivo}</p>}
    </div>
  );
}

/** Lo que dice una fila sin diploma sobre su programa, en una línea (Aprobados sin diploma). */
const lineaPrograma = (p: ProgramaDelCrm | null | undefined) => {
  if (!p?.programa) return 'sin programa del CRM';
  if (p.editado) return `programa editado a mano · ${resumenPrograma(p.programa)}`;
  if (p.elegida) return `formación elegida a mano · ${resumenPrograma(p.programa)}`;
  return resumenPrograma(p.programa);
};

/** ¿Lo emitió este CRM? Un Certifex/CRM anterior no manda la marca: se da por hecho que sí. */
const delCrm = (d: Pick<Diploma, 'emitidoEnCrm'>) => d.emitidoEnCrm !== false;

function EstadoAviso({ d }: { d: Diploma }) {
  const a = d.aviso;
  if (!a && !delCrm(d)) {
    return (
      <StatusDot tono="neutral" title={`Lo emitió ${d.emitidaPor || 'alguien'} fuera del CRM: nadie del CRM tiene que avisar. Si hace falta, «Reenviar».`}>
        Emitido fuera del CRM
      </StatusDot>
    );
  }
  if (!a) return <StatusDot tono="warning">Pendiente de aviso</StatusDot>;
  const detalle = <div className="mt-0.5 max-w-[180px] truncate text-[11px] text-muted-foreground" title={a.por}>{fecha(a.en)} · {a.por}</div>;
  if (a.resultado === 'enviado') return <div><StatusDot tono="success">Enviado</StatusDot>{detalle}</div>;
  if (a.resultado === 'correo_apagado') {
    return <div><StatusDot tono="warning" title="Se aprobó el envío, pero el correo está apagado en el servidor de Certifex: no ha salido">Aviso aprobado (correo apagado)</StatusDot>{detalle}</div>;
  }
  if (a.resultado === 'sin_correo') return <div><StatusDot tono="danger" title="El alumno no tiene correo en Certifex">Sin correo</StatusDot>{detalle}</div>;
  return <div><StatusDot tono="danger">Error al enviar</StatusDot>{detalle}</div>;
}

function IconoAccion({ etiqueta, onClick, children, disabled, peligro }: {
  etiqueta: string; onClick: () => void; children: React.ReactNode; disabled?: boolean; peligro?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={etiqueta}
      title={etiqueta}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors',
        'hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50',
        peligro && 'hover:text-destructive',
      )}
    >
      {children}
    </button>
  );
}

function Casilla({ id, etiqueta, marcada, alCambiar }: { id: string; etiqueta: string; marcada: boolean; alCambiar: () => void }) {
  return <input id={id} type="checkbox" aria-label={etiqueta} checked={marcada} onChange={alCambiar} className="h-4 w-4 accent-[hsl(var(--primary))]" />;
}

const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th className={cn('px-2 py-2 text-left font-medium', className)}>{children}</th>
);

function Esqueleto() {
  return <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-md bg-muted" />)}</div>;
}

/**
 * Una tabla ancha: en pantallas estrechas se desliza a los lados. Se dice (no todo el
 * mundo ve que hay más columnas) y la barra de desplazamiento queda a la vista.
 */
function TablaDesplazable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <>
      <p className="flex items-center gap-1 px-4 pt-2 text-[11px] text-muted-foreground lg:hidden" aria-hidden="true">
        Desliza la tabla a los lados para ver todas las columnas y las acciones →
      </p>
      <div className={cn('overflow-x-auto pb-1 [scrollbar-color:hsl(var(--border))_transparent] [scrollbar-width:thin]', className)} tabIndex={0} role="region" aria-label="Tabla desplazable">
        {children}
      </div>
    </>
  );
}

/** «hace 3 h», «hace 2 días». */
function hace(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'hace menos de una hora';
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/**
 * La salud del enlace con cada Moodle: el plugin manda un latido diario desde su tarea
 * programada, que solo corre si el cron de Moodle funciona. Sin latido, los avisos del
 * plugin («ha terminado», la solicitud) se quedan en la cola de Moodle. Los campus sin
 * Moodle no salen; con un Certifex que no manda `salud`, no sale nada.
 */
function SaludCampus({ campus }: { campus: CampusCertifex[] | null }) {
  const conSalud = (campus ?? []).filter((c) => c.salud && c.salud.cron !== 'sin_moodle');
  if (!conSalud.length) return null;
  const mal = conSalud.filter((c) => c.salud!.cron === 'sin_latido' || c.salud!.cron === 'nunca');
  const bien = conSalud.filter((c) => c.salud!.cron === 'ok');
  return (
    <div className="space-y-2">
      {mal.map((c) => (
        <div key={c.codigo} role="status" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2.5 text-sm text-warning-soft-foreground">
          <Warning size={16} weight="bold" className="mt-0.5 flex-none" />
          <span>
            El cron del campus <strong>{c.nombre || c.codigo}</strong>{' '}
            {c.salud!.cron === 'nunca' || !c.salud!.latidoEn
              ? 'no ha dado señales nunca'
              : <>no da señales desde el {fechaHora(c.salud!.latidoEn)}</>}
            : los avisos de Moodle pueden no llegar.
            {c.salud!.cron === 'nunca' && ' (Plugin anterior a la 2.7.0, o el cron de Moodle no ha corrido.)'}
          </span>
        </div>
      ))}
      {bien.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {bien.map((c) => (
            <span key={c.codigo} title={[hace(c.salud!.latidoEn) ? `Último latido ${hace(c.salud!.latidoEn)}` : null, c.salud!.plugin ? `plugin ${c.salud!.plugin}` : null, c.salud!.moodle ? `Moodle ${c.salud!.moodle}` : null].filter(Boolean).join(' · ')}>
              <Etiqueta tono="success">{c.nombre || c.codigo} · Moodle al día</Etiqueta>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── página

export default function CertifexDiplomasPage() {
  const [params, setParams] = useSearchParams();
  const pestana: PestanaDiplomas = (PESTANAS.find((p) => p.clave === params.get('pestana'))?.clave) ?? 'pendientes';
  const irA = (p: PestanaDiplomas) => setParams(p === 'pendientes' ? {} : { pestana: p }, { replace: true });

  const [conexion, setConexion] = useState<ConexionCertifex | null>(null);
  // No se pudo PREGUNTAR (500, red, 403): no es lo mismo que «no está configurado».
  const [errorEstado, setErrorEstado] = useState<string | null>(null);
  const [comprobar, setComprobar] = useState(0);
  const [campus, setCampus] = useState<CampusCertifex[] | null>(null);
  const [centro, setCentro] = useState('');
  const [cursos, setCursos] = useState<CursoCertifex[]>([]);
  const [curso, setCurso] = useState('');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [buscar, setBuscar] = useState('');
  const [q, setQ] = useState('');
  const [filtroAviso, setFiltroAviso] = useState<FiltroAviso | ''>('');
  const [pagina, setPagina] = useState(1);
  const [recarga, setRecarga] = useState(0);

  const [resumen, setResumen] = useState<ResumenDiplomas | null>(null);
  const [solicitudes, setSolicitudes] = useState<Solicitud[]>([]);
  const [terminados, setTerminados] = useState<Terminado[]>([]);
  const [diplomas, setDiplomas] = useState<Diploma[]>([]);
  const [despues, setDespues] = useState<{ porAvisar: Solicitud[]; sinEmitir: Solicitud[] }>({ porAvisar: [], sinEmitir: [] });
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [elegidas, setElegidas] = useState<Set<string>>(new Set());
  const [elegidasAviso, setElegidasAviso] = useState<Set<string>>(new Set());
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [lote, setLote] = useState<{ hechas: number; total: number } | null>(null);
  const [fallos, setFallos] = useState<Fallo[]>([]);
  // En un lote con fallos, lo que SÍ se emitió, con su número: el aviso cuenta cada una (Certifex#96).
  const [hechos, setHechos] = useState<{ quien: string; nexpediente: string }[]>([]);
  // Emitidos sin programa del CRM (con lo de Moodle): no es un fallo, pero se dice.
  const [notas, setNotas] = useState<Fallo[]>([]);
  const [correoApagado, setCorreoApagado] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [visor, setVisor] = useState<{ d: Pick<Diploma, 'nexpediente' | 'alumno' | 'titulacion' | 'centro' | 'aviso' | 'diplomaUrl' | 'imprenta'>; enviable: boolean } | null>(null);
  // Tras corregir, el PDF cambia: se pide otra vez sin caché.
  const [versiones, setVersiones] = useState<Record<string, number>>({});
  // «Editar»: revisar los datos de una solicitud antes de aprobarla.
  const [editando, setEditando] = useState<Solicitud | null>(null);
  // El error del servidor en un diálogo con texto (rechazar, revocar, corregir): el
  // diálogo sigue abierto y no pierde lo escrito.
  const [errorDialogo, setErrorDialogo] = useState<string | null>(null);
  // Los avisos de abajo a la derecha: con alguno a la vista, la barra fija sube.
  const { toasts, addListener } = useToast();
  useEffect(() => addListener(), [addListener]);

  const recargar = () => setRecarga((n) => n + 1);
  const abrir = (d: Dialogo) => { setErrorDialogo(null); setDialogo(d); };

  // ── carga ───────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    setErrorEstado(null);
    (async () => {
      try {
        const e = await emisionesApi.estado();
        if (!vivo) return;
        setConexion(e.data);
        if (e.data.conectado) {
          const c = await emisionesApi.centros().catch(() => null);
          if (vivo) setCampus(c?.data ?? null);
        }
      } catch (e) {
        if (vivo) { setConexion(null); setErrorEstado((e as Error).message || 'Sin respuesta del servidor'); }
      }
    })();
    return () => { vivo = false; };
  }, [comprobar]);

  /** El nombre del campus, si Certifex lo da; si no, su código. */
  const nombreCampus = useMemo(() => {
    const m = new Map((campus ?? []).map((c) => [c.codigo, c.nombre || c.codigo]));
    return (codigo: string) => m.get(codigo) ?? codigo;
  }, [campus]);

  useEffect(() => {
    setCurso('');
    setCursos([]);
    if (!centro) return;
    emisionesApi.cursos(centro).then((r) => setCursos(r.data)).catch(() => setCursos([]));
  }, [centro]);

  useEffect(() => {
    const t = setTimeout(() => setQ(buscar.trim()), 300);
    return () => clearTimeout(t);
  }, [buscar]);

  // Cambiar de pestaña o de filtro vuelve a la primera página y suelta la selección.
  useEffect(() => { setPagina(1); }, [pestana, centro, curso, q, desde, hasta, filtroAviso]);
  useEffect(() => { setElegidas(new Set()); setElegidasAviso(new Set()); }, [pestana, centro, curso, q, desde, hasta, filtroAviso, pagina, recarga]);

  const filtros = useMemo(() => ({
    centro: centro || undefined,
    curso: curso ? Number(curso) : undefined,
    q: q || undefined,
    desde: desde || undefined,
    hasta: hasta || undefined,
  }), [centro, curso, q, desde, hasta]);

  useEffect(() => {
    if (!conexion?.conectado) return;
    diplomasApi.resumen(centro || undefined).then((r) => setResumen(r.data)).catch(() => setResumen(null));
  }, [conexion?.conectado, centro, recarga]);

  useEffect(() => {
    if (!conexion?.conectado) return;
    let vivo = true;
    setCargando(true);
    setError(null);
    (async () => {
      try {
        if (pestana === 'pendientes') {
          const [s, d] = await Promise.all([
            diplomasApi.solicitudes({ ...filtros, estado: 'pendiente', pagina, tam: TAM }),
            diplomasApi.porAvisar({ centro: filtros.centro, q: filtros.q }),
          ]);
          if (!vivo) return;
          setSolicitudes(s.data.filas);
          setTotal(s.data.total);
          // «Por avisar» y «sin diploma» no vienen paginados: la formación y las fechas se
          // aplican aquí con la misma regla que el servidor (fecha de la solicitud).
          const pasa = (c: Solicitud) => {
            if (filtros.curso !== undefined && c.curso.ref !== filtros.curso) return false;
            const dia = c.solicitud?.en ? new Date(c.solicitud.en).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null;
            if (filtros.desde && (!dia || dia < filtros.desde)) return false;
            if (filtros.hasta && (!dia || dia > filtros.hasta)) return false;
            return true;
          };
          setDespues({ porAvisar: d.data.porAvisar.filter(pasa), sinEmitir: d.data.sinEmitir.filter(pasa) });
        } else if (pestana === 'terminados') {
          // Sin fechas: Certifex no dice cuándo terminó cada uno.
          const t = await diplomasApi.terminados({ centro: filtros.centro, curso: filtros.curso, q: filtros.q, pagina, tam: TAM });
          if (!vivo) return;
          setTerminados(t.data.filas);
          setTotal(t.data.total);
        } else if (pestana === 'rechazados') {
          const s = await diplomasApi.solicitudes({ ...filtros, estado: 'rechazada', pagina, tam: TAM });
          if (!vivo) return;
          setSolicitudes(s.data.filas);
          setTotal(s.data.total);
        } else {
          const d = await diplomasApi.diplomas({
            ...filtros,
            estado: pestana === 'enviados' ? 'vigentes' : 'revocados',
            aviso: pestana === 'enviados' && filtroAviso ? filtroAviso : undefined,
            pagina,
            tam: TAM,
          });
          if (!vivo) return;
          setDiplomas(d.data.filas);
          setTotal(d.data.total);
        }
      } catch (e) {
        if (vivo) setError((e as Error).message);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => { vivo = false; };
  }, [conexion?.conectado, pestana, filtros, filtroAviso, pagina, recarga]);

  // ── derivados ───────────────────────────────────────────────────
  const nombres = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of [...solicitudes, ...despues.porAvisar, ...despues.sinEmitir]) {
      m.set(c.matriculaId, c.solicitud?.nombre || c.titular.nombre || c.titular.email || `Matrícula #${c.matriculaId}`);
    }
    return m;
  }, [solicitudes, despues]);
  const nombre = (id: number | null) => (id != null && nombres.get(id)) || `Matrícula #${id}`;
  const nombreDe = (exp: string | null) => {
    const d = diplomas.find((x) => x.nexpediente === exp) ?? despues.porAvisar.find((c) => c.nexpediente === exp)?.diploma;
    return d ? `${d.alumno} (${exp})` : exp ?? 'Diploma';
  };
  const paginas = Math.max(1, Math.ceil(total / TAM));
  const filasClave = pestana === 'enviados' || pestana === 'revocados'
    ? diplomas.map((d) => d.nexpediente)
    : solicitudes.map((s) => String(s.matriculaId));
  const todas = filasClave.length > 0 && filasClave.every((k) => elegidas.has(k));
  const alternar = (setter: typeof setElegidas, k: string) => setter((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const conFechas = pestana !== 'terminados';
  const hayFiltros = !!(centro || curso || (conFechas && (desde || hasta)) || buscar || filtroAviso);
  const contar = (p: PestanaDiplomas) => {
    if (!resumen) return undefined;
    if (p === 'pendientes') return resumen.pendientes + resumen.porAvisar + resumen.sinEmitir;
    if (p === 'terminados') return resumen.terminados;
    if (p === 'enviados') return resumen.vigentes;
    if (p === 'rechazados') return resumen.rechazadas;
    return resumen.revocados;
  };

  // ── acciones ────────────────────────────────────────────────────
  async function ejecutar(fn: () => Promise<void>, titulo: string) {
    setTrabajando(true);
    setFallos([]);
    setHechos([]);
    setNotas([]);
    try { await fn(); } catch (e) { toast({ title: titulo, description: (e as Error).message, variant: 'destructive' }); }
    finally { setTrabajando(false); setLote(null); recargar(); }
  }

  /**
   * Lo que se escribe en un diálogo (motivo, nombre corregido): si el servidor dice que
   * no, el diálogo sigue abierto, con su texto y el mensaje tal cual. Solo se cierra al
   * salir bien.
   */
  async function ejecutarEnDialogo(fn: () => Promise<void>) {
    setTrabajando(true);
    setErrorDialogo(null);
    setFallos([]);
    setHechos([]);
    setNotas([]);
    try {
      await fn();
      setDialogo(null);
      recargar();
    } catch (e) {
      setErrorDialogo((e as Error).message || 'No se pudo completar');
    } finally {
      setTrabajando(false);
    }
  }

  const emitidasDe = (res: ResultadoAprobarEmitir[]) => res
    .filter((r) => r.ok && r.nexpediente)
    .map((r) => ({ quien: nombre(r.matriculaId), nexpediente: r.nexpediente! }));

  const anotarPrograma = (res: ResultadoAprobarEmitir[]) => setNotas(res
    .filter((r) => r.ok && r.sinPrograma)
    .map((r) => ({ quien: nombre(r.matriculaId), error: r.sinPrograma! })));

  const aprobarEmitir = (ids: number[]) => ejecutar(async () => {
    setLote({ hechas: 0, total: ids.length });
    const res = await enTandas(ids, TANDA_EMITIR, async (l) => (await diplomasApi.aprobarEmitir(l)).data.resultados,
      (h) => setLote({ hechas: h, total: ids.length }));
    anotarPrograma(res);
    const ok = res.filter((r) => r.ok).length;
    setFallos(res.filter((r) => !r.ok).map((r) => ({ quien: nombre(r.matriculaId), error: r.error ?? 'Error' })));
    setHechos(emitidasDe(res));
    toast({
      title: `${ok} ${ok === 1 ? 'diploma emitido' : 'diplomas emitidos'}`,
      description: ok ? 'Quedan pendientes de aviso: revisa el PDF y envíalo al alumno.' : 'Ninguno se ha podido emitir: el motivo, en pantalla.',
      variant: ok ? undefined : 'destructive',
    });
  }, 'No se pudo aprobar y emitir');

  const emitir = (ids: number[]) => ejecutar(async () => {
    setLote({ hechas: 0, total: ids.length });
    const res = await enTandas(ids, TANDA_EMITIR, async (l) => (await diplomasApi.emitir(l)).data.resultados,
      (h) => setLote({ hechas: h, total: ids.length }));
    anotarPrograma(res);
    const ok = res.filter((r) => r.ok).length;
    setFallos(res.filter((r) => !r.ok).map((r) => ({ quien: nombre(r.matriculaId), error: r.error ?? 'Error' })));
    setHechos(emitidasDe(res));
    toast(ok
      ? { title: `${ok} ${ok === 1 ? 'diploma emitido' : 'diplomas emitidos'}`, description: res.length > ok ? `Quedan pendientes de aviso. ${res.length - ok} sin emitir: el motivo, en pantalla.` : 'Quedan pendientes de aviso.' }
      : { title: 'No se ha emitido ninguno', description: 'El motivo de cada uno, en pantalla.', variant: 'destructive' });
  }, 'No se pudo emitir');

  const rechazar = (ids: number[], motivo: string) => ejecutarEnDialogo(async () => {
    const r = await diplomasApi.rechazar(ids, motivo);
    const malas = r.data.resultados.filter((x) => !x.ok);
    setFallos(malas.map((m) => ({ quien: nombre(m.matriculaId), error: m.error ?? 'Error' })));
    const n = r.data.resultados.length - malas.length;
    toast({ title: `${n} ${n === 1 ? 'solicitud rechazada' : 'solicitudes rechazadas'}`, description: 'El alumno no recibe nada hasta que apruebes el aviso de rechazo.' });
  });

  const enviarAvisos = (exps: string[]) => ejecutar(async () => {
    setLote({ hechas: 0, total: exps.length });
    let activo = true;
    const res = await enTandas(exps, TANDA_AVISOS, async (l) => {
      const r = await diplomasApi.avisos(l);
      if (!r.data.correoActivo) activo = false;
      return r.data.resultados;
    }, (h) => setLote({ hechas: h, total: exps.length }));
    const enviados = res.filter((r) => r.resultado === 'enviado').length;
    setCorreoApagado(!activo);
    setFallos(res.filter((r) => r.resultado !== 'enviado' && r.resultado !== 'correo_apagado')
      .map((r) => ({ quien: nombreDe(r.nexpediente), error: r.error ?? (r.resultado ? `Aviso aprobado, pero ${ROTULO_AVISO[r.resultado]}` : 'Error') })));
    toast(activo
      ? { title: `${enviados} ${enviados === 1 ? 'diploma enviado' : 'diplomas enviados'} al alumno` }
      : { title: 'Aprobado, pero el correo está apagado', description: 'No ha salido ningún correo: el servidor de Certifex tiene el envío apagado.', variant: 'destructive' });
  }, 'No se pudo enviar');

  const avisarRechazo = (ids: number[]) => ejecutar(async () => {
    const r = await diplomasApi.avisosRechazo(ids);
    setCorreoApagado(!r.data.correoActivo);
    const enviados = r.data.resultados.filter((x) => x.resultado === 'enviado').length;
    setFallos(r.data.resultados.filter((x) => !x.ok && x.resultado !== 'correo_apagado')
      .map((x) => ({ quien: nombre(x.matriculaId), error: x.error ?? (x.resultado ? `Aviso aprobado, pero ${ROTULO_AVISO[x.resultado] ?? x.resultado}` : 'Error') })));
    toast(r.data.correoActivo
      ? { title: `${enviados} ${enviados === 1 ? 'aviso de rechazo enviado' : 'avisos de rechazo enviados'}` }
      : { title: 'Aprobado, pero el correo está apagado', description: 'No ha salido ningún correo: el servidor de Certifex tiene el envío apagado.', variant: 'destructive' });
  }, 'No se pudo enviar el aviso');

  const revocar = (d: Diploma, motivo: string) => ejecutarEnDialogo(async () => {
    await diplomasApi.revocar(d.nexpediente, motivo);
    toast({ title: 'Diploma revocado', description: `${d.nexpediente}: la verificación pública ya dice «revocado». No se ha avisado al alumno.` });
  });

  const corregir = (d: Diploma, valor: string, motivo: string) => ejecutarEnDialogo(async () => {
    await diplomasApi.corregirNombre(d.nexpediente, valor, motivo);
    setVersiones((v) => ({ ...v, [d.nexpediente]: Date.now() }));
    toast({
      title: 'Nombre corregido',
      description: d.aviso ? 'Mismo número y mismo QR. El alumno ya recibió el anterior: usa «Reenviar» si quieres mandarle el corregido.' : 'Mismo número y mismo QR. Revisa el PDF antes de enviarlo.',
    });
  });

  async function copiarEnlace(d: Diploma) {
    if (!d.verificarUrl) {
      toast({ title: 'Sin enlace público', description: 'Certifex no tiene una dirección que abra desde fuera: el enlace no funcionaría. Mira el aviso de arriba.', variant: 'destructive' });
      return;
    }
    const ok = await copyToClipboard(d.verificarUrl);
    toast(ok ? { title: 'Enlace de verificación copiado', description: d.verificarUrl } : { title: 'No se pudo copiar', description: d.verificarUrl, variant: 'destructive' });
  }

  // ── exportar ────────────────────────────────────────────────────
  async function exportar() {
    setExportando(true);
    try {
      const todo = { ...filtros, todo: '1' as const };
      type FilaX = Record<string, unknown>;
      let filas: FilaX[] = [];
      let truncado = false;
      const deSolicitud = (c: Solicitud, estado: string): FilaX => ({
        estado,
        nombreDiploma: c.solicitud?.nombre ?? '',
        nombreMoodle: c.titular.nombre ?? '',
        email: c.titular.email ?? '',
        campus: nombreCampus(c.centro),
        formacion: c.curso.nombre,
        solicitada: fechaExcel(c.solicitud?.en),
        nota: c.notaFinal,
        nexpediente: c.nexpediente ?? c.diploma?.nexpediente ?? '',
        decision: c.decision ? `${c.decision.decision} · ${c.decision.decididoPor}` : '',
        decididaEn: fechaExcel(c.decision?.decididoEn),
        motivo: c.decision?.motivo ?? '',
        avisoRechazo: c.avisoRechazo ? `${ROTULO_AVISO[c.avisoRechazo.resultado] ?? c.avisoRechazo.resultado} · ${c.avisoRechazo.por}` : '',
      });
      const deDiploma = (d: Diploma): FilaX => ({
        nexpediente: d.nexpediente,
        alumno: d.alumno,
        campus: nombreCampus(d.centro),
        titulacion: d.titulacion,
        emitido: fechaExcel(d.emitidoEn),
        emitidaPor: d.emitidaPor ?? '',
        aviso: d.aviso ? ROTULO_AVISO[d.aviso.resultado] ?? d.aviso.resultado : delCrm(d) ? 'pendiente de aviso' : 'emitido fuera del CRM',
        avisoEn: fechaExcel(d.aviso?.en),
        avisoPor: d.aviso?.por ?? '',
        revocadoEn: fechaExcel(d.revocacion?.en),
        revocadoPor: d.revocacion?.por ?? '',
        motivoRevocacion: d.revocacion?.motivo ?? '',
        verificar: d.verificarUrl ?? '',
      });
      const deTerminado = (c: Terminado): FilaX => ({
        alumno: c.titular.nombre ?? '',
        email: c.titular.email ?? '',
        campus: nombreCampus(c.centro),
        formacion: c.curso.nombre,
        nota: c.notaFinal,
        avance: `${c.actividades.calificadas}/${c.actividades.total}`,
        enCrm: c.crm ? `${c.crm.ventas} ${c.crm.ventas === 1 ? 'venta' : 'ventas'}` : c.crm === null ? 'no está' : '',
        aviso: fechaExcel(c.aviso?.recibidoEn),
      });
      if (pestana === 'terminados') {
        const t = await diplomasApi.terminados({ centro: filtros.centro, curso: filtros.curso, q: filtros.q, todo: '1' });
        truncado = !!t.data.truncado;
        filas = t.data.filas.map(deTerminado);
      } else if (pestana === 'pendientes' || pestana === 'rechazados') {
        const s = await diplomasApi.solicitudes({ ...todo, estado: pestana === 'pendientes' ? 'pendiente' : 'rechazada' });
        truncado = !!s.data.truncado;
        filas = s.data.filas.map((c) => deSolicitud(c, pestana === 'pendientes' ? 'Por decidir' : 'Rechazada'));
        if (pestana === 'pendientes') {
          filas.push(...despues.porAvisar.map((c) => deSolicitud(c, 'Emitido, falta enviarlo')));
          filas.push(...despues.sinEmitir.map((c) => deSolicitud(c, 'Aprobado sin diploma')));
        }
      } else {
        const d = await diplomasApi.diplomas({ ...todo, estado: pestana === 'enviados' ? 'vigentes' : 'revocados', aviso: pestana === 'enviados' && filtroAviso ? filtroAviso : undefined });
        truncado = !!d.data.truncado;
        filas = d.data.filas.map(deDiploma);
      }
      // Las fechas van como texto en hora de Madrid («09/10/2026 14:30»), y cada columna con
      // su ancho: con el de por defecto salían «####» y nombres cortados.
      const col = (key: string, label: string, width: number, type: ExportColumn<FilaX>['type'] = 'string'): ExportColumn<FilaX> => ({ key, label, type, width, value: (r) => r[key] });
      const F = 18; // una fecha con hora
      const columnas = pestana === 'terminados'
        ? [col('alumno', 'Alumno (Moodle)', 32), col('email', 'Correo', 34), col('campus', 'Campus', 20), col('formacion', 'Formación', 48),
          col('nota', 'Nota', 8, 'number'), col('avance', 'Actividades calificadas', 14), col('enCrm', 'En el CRM', 14), col('aviso', 'Aviso recibido', F)]
        : pestana === 'pendientes' || pestana === 'rechazados'
          ? [col('estado', 'Estado', 22), col('nombreDiploma', 'Nombre para el diploma', 32), col('nombreMoodle', 'Nombre en Moodle', 28), col('email', 'Correo', 34),
            col('campus', 'Campus', 20), col('formacion', 'Formación', 48), col('solicitada', 'Solicitada', F), col('nota', 'Nota', 8, 'number'),
            col('nexpediente', 'Nº expediente', 24), col('decision', 'Decisión', 36), col('decididaEn', 'Decidida', F), col('motivo', 'Motivo', 48), col('avisoRechazo', 'Aviso de rechazo', 36)]
          : pestana === 'revocados'
            // Revocado no hay aviso que enseñar: sin esas columnas.
            ? [col('nexpediente', 'Nº expediente', 24), col('alumno', 'Alumno', 32), col('campus', 'Campus', 20), col('titulacion', 'Titulación', 48),
              col('emitido', 'Emitido', F), col('emitidaPor', 'Emitido por', 34), col('revocadoEn', 'Revocado', F), col('revocadoPor', 'Revocado por', 34),
              col('motivoRevocacion', 'Motivo de revocación', 48), col('verificar', 'Enlace de verificación', 50)]
            : [col('nexpediente', 'Nº expediente', 24), col('alumno', 'Alumno', 32), col('campus', 'Campus', 20), col('titulacion', 'Titulación', 48),
              col('emitido', 'Emitido', F), col('emitidaPor', 'Emitido por', 34), col('aviso', 'Aviso al alumno', 24), col('avisoEn', 'Aviso aprobado', F),
              col('avisoPor', 'Aviso aprobado por', 34), col('verificar', 'Enlace de verificación', 50)];
      await runExport({
        context: 'certifex-diplomas',
        filename: `diplomas-${pestana}-${hoy()}`,
        format: 'xlsx',
        columns: columnas,
        config: columnas.map((c) => ({ key: c.key, label: c.label, included: true })),
        rows: filas,
      });
      toast({
        title: `${filas.length} ${filas.length === 1 ? 'fila exportada' : 'filas exportadas'}`,
        description: truncado ? 'Hay más de 10 000: acota con los filtros para sacarlo todo.' : undefined,
        variant: truncado ? 'destructive' : undefined,
      });
    } catch (e) {
      toast({ title: 'No se pudo exportar', description: (e as Error).message, variant: 'destructive' });
    } finally { setExportando(false); }
  }

  // ── sin conexión ────────────────────────────────────────────────
  const reintentarEstado = (
    <Button size="sm" variant="outline" onClick={() => setComprobar((n) => n + 1)}>
      <ArrowClockwise size={13} className="mr-1.5" /> Reintentar
    </Button>
  );
  // No se pudo preguntar (500, red, 403): no se sabe si está conectado.
  if (errorEstado) {
    return (
      <Card padding="none">
        <EmptyState icon={Warning} title="No se pudo comprobar la conexión con Certifex" description={errorEstado} action={reintentarEstado} />
      </Card>
    );
  }
  if (conexion && !conexion.conectado) {
    return (
      <Card padding="none">
        <EmptyState
          icon={PlugsConnected}
          title="Certifex no está conectado"
          // Sin `error`, el servidor dice de verdad que falta configurarlo; con él, Certifex
          // está configurado pero no contesta o no acepta la clave.
          description={conexion.error || 'Faltan CERTIFEX_API_URL y CERTIFEX_CRM_CLAVE en el .env del servidor del CRM.'}
          action={reintentarEstado}
        />
      </Card>
    );
  }

  const fechaRotulo = pestana === 'enviados' || pestana === 'revocados' ? 'Emitido' : 'Solicitado';
  // En bloque solo lo emitido por el CRM: lo de fuera se reenvía de uno en uno, a propósito.
  const enviables = [...elegidas].filter((k) => diplomas.some((d) => d.nexpediente === k && (delCrm(d) || d.aviso)));
  const conAviso = enviables.filter((k) => diplomas.find((d) => d.nexpediente === k)?.aviso).length;
  const reenvioEnBloque = conAviso > 0;
  const rotuloEnBloque = conAviso === 0 ? 'Enviar al alumno' : conAviso === enviables.length ? 'Reenviar' : 'Enviar o reenviar';

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="inline-flex flex-wrap items-center gap-2">
          {conexion?.conectado
            ? <StatusDot tono="success">Conectado{conexion.nombre ? ` como ${conexion.nombre}` : ''}</StatusDot>
            : 'Conectando con Certifex…'}
          <span>· Emitir no avisa al alumno: el correo sale solo cuando lo apruebas aquí</span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={recargar} disabled={trabajando || !conexion?.conectado}>
            <ArrowClockwise size={13} weight="bold" className="mr-1.5" /> Actualizar
          </Button>
          <Button variant="outline" size="sm" onClick={exportar} disabled={exportando || !conexion?.conectado}>
            <FileXls size={13} weight="bold" className="mr-1.5" /> {exportando ? 'Exportando…' : 'Exportar a Excel'}
          </Button>
        </div>
      </div>

      {/* La salud del enlace con cada Moodle (latido diario del plugin). */}
      <SaludCampus campus={campus} />

      {/* Certifex en una dirección local: sus enlaces no abrirían (Certifex#96). */}
      <AvisoCasiListo />
      <AvisoDireccionPublica conexion={conexion} />

      {/* Contadores: del campus elegido, o de todos. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <KpiCard icon={HourglassMedium} iconBg="bg-info-soft text-info-soft-foreground" label="Por decidir" value={resumen ? resumen.pendientes.toLocaleString('es') : '…'} />
        {/* Lo mismo que el filtro «Pendiente de aviso» de Emitidos: emitido por el CRM y sin aviso. */}
        <KpiCard icon={PaperPlaneTilt} iconBg="bg-warning-soft text-warning-soft-foreground" label="Por enviar al alumno" value={resumen ? (resumen.porEnviar ?? resumen.porAvisar).toLocaleString('es') : '…'} />
        <KpiCard icon={SealCheck} iconBg="bg-success-soft text-success-soft-foreground" label="Diplomas vigentes" value={resumen ? resumen.vigentes.toLocaleString('es') : '…'} />
        <KpiCard icon={XCircle} iconBg="bg-destructive-soft text-destructive-soft-foreground" label="Rechazadas" value={resumen ? resumen.rechazadas.toLocaleString('es') : '…'} />
        <KpiCard icon={Prohibit} iconBg="bg-muted text-muted-foreground" label="Revocados" value={resumen ? resumen.revocados.toLocaleString('es') : '…'} />
      </div>

      {correoApagado && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm text-warning-soft-foreground">
          <Warning size={18} weight="bold" className="mt-0.5 flex-none" />
          <div className="flex-1">
            <p className="font-semibold">Aprobado, pero el correo está apagado en el servidor de Certifex</p>
            <p className="mt-0.5">El envío queda aprobado y registrado a tu nombre, pero <strong>no ha salido ningún correo</strong>. Cuando se encienda el correo en Certifex, usa «Reenviar».</p>
          </div>
          <button type="button" aria-label="Cerrar aviso" onClick={() => setCorreoApagado(false)} className="rounded p-1 hover:bg-background/40"><X size={14} /></button>
        </div>
      )}

      {fallos.length > 0 && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-medium text-destructive-soft-foreground">
              {fallos.length} {fallos.length === 1 ? 'no se ha podido completar' : 'no se han podido completar'}
            </span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setFallos([]); setHechos([]); }}>Cerrar</button>
          </div>
          <ul className="space-y-1">
            {fallos.slice(0, 12).map((f, i) => (
              <li key={i} className="text-xs"><span className="font-medium">{f.quien}:</span> <span className="text-muted-foreground">{f.error}</span></li>
            ))}
          </ul>
          {fallos.length > 12 && <p className="mt-1 text-xs text-muted-foreground">y {fallos.length - 12} más.</p>}
          {hechos.length > 0 && (
            <div className="mt-2 border-t border-destructive/20 pt-2">
              <p className="mb-1 text-xs font-medium text-foreground">
                {hechos.length} {hechos.length === 1 ? 'sí se ha emitido' : 'sí se han emitido'} (pendientes de enviar al alumno):
              </p>
              <ul className="space-y-1">
                {hechos.slice(0, 12).map((h) => (
                  <li key={h.nexpediente} className="text-xs"><span className="font-medium">{h.quien}:</span> <span className="font-mono text-muted-foreground">{h.nexpediente}</span></li>
                ))}
              </ul>
              {hechos.length > 12 && <p className="mt-1 text-xs text-muted-foreground">y {hechos.length - 12} más.</p>}
            </div>
          )}
        </div>
      )}

      {notas.length > 0 && (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="font-medium text-warning-soft-foreground">
              {notas.length} {notas.length === 1 ? 'diploma emitido' : 'diplomas emitidos'} sin programa del CRM: llevan lo de Moodle
            </span>
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setNotas([])}>Cerrar</button>
          </div>
          <ul className="space-y-1">
            {notas.slice(0, 12).map((f, i) => (
              <li key={i} className="text-xs"><span className="font-medium">{f.quien}:</span> <span className="text-muted-foreground">{f.error}</span></li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">Revisa su PDF antes de enviarlo. Si el temario no es el bueno, corrige la venta o el catálogo antes de emitir los siguientes.</p>
        </div>
      )}

      <Card padding="none">
        {/* Pestañas y filtros */}
        <CardSection className="flex flex-wrap items-center gap-2">
          {PESTANAS.map((p) => (
            <Pestana key={p.clave} activa={pestana === p.clave} cuenta={contar(p.clave)} onClick={() => irA(p.clave)}>{p.rotulo}</Pestana>
          ))}
        </CardSection>
        <CardSection className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Campus
            <Select<string>
              value={centro}
              onChange={setCentro}
              ariaLabel="Campus"
              className="w-48 normal-case tracking-normal"
              options={[{ value: '', label: 'Todos los campus' }, ...(campus ?? []).map((c) => ({ value: c.codigo, label: c.nombre }))]}
            />
          </label>
          <div className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Formación
            {centro ? (
              <SearchableSelect
                value={curso}
                onChange={setCurso}
                ariaLabel="Formación"
                allLabel="Todas las formaciones"
                placeholder="Buscar formación…"
                maxWidth="260px"
                className="w-[260px] normal-case tracking-normal"
                options={cursos.map((c) => ({ value: String(c.cursoRef), label: c.cursoNombre }))}
              />
            ) : (
              <span className="flex h-9 w-[260px] items-center rounded-md border border-dashed border-border px-3 text-sm normal-case tracking-normal text-muted-foreground">Elige antes un campus</span>
            )}
          </div>
          {conFechas && (
            <>
              <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {fechaRotulo} desde
                <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm normal-case text-foreground outline-none dark:[color-scheme:dark] focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                hasta
                <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)}
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm normal-case text-foreground outline-none dark:[color-scheme:dark] focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </label>
            </>
          )}
          <div className="min-w-[200px] flex-1 sm:max-w-[300px]">
            <Buscador id="diplomas-buscar" valor={buscar} alCambiar={setBuscar}
              placeholder={pestana === 'enviados' || pestana === 'revocados' ? 'Nombre, nº de expediente o titulación…' : 'Nombre o correo…'} />
          </div>
          {hayFiltros && (
            <button type="button" className="h-9 text-xs text-muted-foreground underline hover:text-foreground"
              onClick={() => { setCentro(''); setCurso(''); setDesde(''); setHasta(''); setBuscar(''); setFiltroAviso(''); }}>
              Limpiar filtros
            </button>
          )}
        </CardSection>
        {pestana === 'terminados' && (
          <CardSection className="text-sm text-muted-foreground">
            Moodle da la formación por terminada, pero el alumno aún no ha pedido su diploma. Cuando lo pida, pasará a Pendientes.
          </CardSection>
        )}
        {pestana === 'enviados' && (
          <CardSection className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Aviso al alumno:</span>
            {([['', 'Todos'], ['pendiente', 'Pendiente de aviso'], ['enviado', 'Enviado'], ['no_salio', 'No salió'], ['fuera', 'Emitido fuera del CRM']] as [FiltroAviso | '', string][]).map(([k, r]) => (
              <Pestana key={k || 'todos'} activa={filtroAviso === k} onClick={() => setFiltroAviso(k)}>{r}</Pestana>
            ))}
          </CardSection>
        )}

        {/* Contenido de la pestaña */}
        {error ? (
          <EmptyState icon={Warning} title="No se pudo cargar" description={error} action={<Button size="sm" variant="outline" onClick={recargar}><ArrowClockwise size={13} className="mr-1.5" /> Reintentar</Button>} />
        ) : cargando && !solicitudes.length && !diplomas.length && !terminados.length ? (
          <Esqueleto />
        ) : pestana === 'terminados' ? (
          terminados.length === 0 ? (
            <EmptyState icon={FlagCheckered} title={hayFiltros ? 'Nada coincide con los filtros' : 'Nadie ha terminado sin pedir el diploma'}
              description={hayFiltros ? 'Prueba con otros filtros o límpialos.' : 'Cuando Moodle dé una formación por terminada y el alumno no pida su diploma, aparecerá aquí.'} />
          ) : (
            <TablaDesplazable>
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <Th className="pl-4">Alumno</Th>
                    <Th>Formación</Th>
                    <Th className="text-right">Nota · avance</Th>
                    <Th>En el CRM</Th>
                    <Th className="pr-4">Aviso de Certifex</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {terminados.map((c) => (
                    <tr key={c.matriculaId} className="align-top hover:bg-muted/40">
                      <td className="px-2 py-3 pl-4">
                        <div className="max-w-[260px] truncate font-semibold" title={c.titular.nombre ?? undefined}>{c.titular.nombre || '—'}</div>
                        <div className="max-w-[260px] truncate text-xs text-muted-foreground" title={c.titular.email ?? undefined}>{c.titular.email || 'sin correo'}</div>
                      </td>
                      <td className="px-2 py-3">
                        <div className="max-w-[280px] truncate" title={c.curso.nombre}>{c.curso.nombre}</div>
                        <div className="text-xs text-muted-foreground">{nombreCampus(c.centro)}</div>
                      </td>
                      <td className="px-2 py-3 text-right">
                        <div className="tabular-nums">{notaTexto(c.notaFinal, c.umbral)}</div>
                        <div className="mt-1"><Avance hechas={c.actividades.calificadas} total={c.actividades.total} /></div>
                      </td>
                      <td className="px-2 py-3"><EnElCrmEtiqueta crm={c.crm} /></td>
                      <td className="whitespace-nowrap px-2 py-3 pr-4 text-xs">
                        {c.aviso?.recibidoEn ? fechaHora(c.aviso.recibidoEn) : <span className="text-muted-foreground">Sin aviso</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TablaDesplazable>
          )
        ) : pestana === 'pendientes' ? (
          <>
            {despues.porAvisar.length > 0 && (
              <BloquePorAvisar
                filas={despues.porAvisar}
                nombreCampus={nombreCampus}
                elegidas={elegidasAviso}
                alternar={(k) => alternar(setElegidasAviso, k)}
                todas={() => setElegidasAviso(elegidasAviso.size === despues.porAvisar.length ? new Set() : new Set(despues.porAvisar.map((c) => c.nexpediente!)))}
                ocupado={trabajando}
                verPdf={(c) => c.diploma && setVisor({ d: c.diploma, enviable: true })}
                enviar={(exps) => setDialogo({ tipo: 'avisos', exps, reenvio: false })}
              />
            )}
            {despues.sinEmitir.length > 0 && (
              <div className="border-b border-border bg-info-soft/40 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">Aprobados sin diploma ({despues.sinEmitir.length})</p>
                    <p className="text-xs text-muted-foreground">El visto bueno está dado, pero la emisión no terminó. Se puede reintentar.</p>
                  </div>
                  <Button size="sm" variant="secondary" disabled={trabajando} onClick={() => setDialogo({ tipo: 'emitir', ids: despues.sinEmitir.map((c) => c.matriculaId) })}>
                    <Certificate size={14} className="mr-1.5" /> Emitir {despues.sinEmitir.length}
                  </Button>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {despues.sinEmitir.slice(0, 20).map((c) => (
                    <li key={c.matriculaId} className="inline-flex items-center gap-1">
                      <Etiqueta tono={c.programaCrm?.programa ? 'info' : 'warning'}>
                        {nombre(c.matriculaId)}{c.solicitud?.revisado ? ' (nombre revisado)' : ''} · {c.curso.nombre} · {lineaPrograma(c.programaCrm)}
                      </Etiqueta>
                      <button type="button" disabled={trabajando} onClick={() => setEditando(c)} aria-label={`Editar los datos de ${nombre(c.matriculaId)}`}
                        className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50">
                        <NotePencil size={12} /> Editar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-2 px-4 pt-3">
              <h3 className="text-sm font-semibold">Por decidir</h3>
              <span className="text-xs text-muted-foreground">Revisa el nombre que se imprimirá antes de aprobar</span>
            </div>
            {solicitudes.length === 0 ? (
              <EmptyState
                icon={CheckCircle}
                title={hayFiltros ? 'Nada coincide con los filtros' : 'No hay solicitudes por decidir'}
                description={hayFiltros ? 'Prueba con otros filtros o límpialos.' : 'Cuando un alumno termine su formación y pida su diploma desde Moodle, aparecerá aquí y sonará la campana.'}
              />
            ) : (
              <TablaDesplazable>
                <table className="w-full min-w-[980px] text-sm">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr className="border-b border-border">
                      <th className="w-10 px-4 py-2 text-left"><Casilla id="diplomas-elegir-todas" etiqueta="Elegir toda la página" marcada={todas} alCambiar={() => setElegidas(todas ? new Set() : new Set(filasClave))} /></th>
                      <Th>Nombre para el diploma</Th>
                      <Th>Formación · programa a imprimir</Th>
                      <Th>Solicitado</Th>
                      <Th className="text-right">Nota · avance</Th>
                      <Th>En el CRM</Th>
                      <Th className="pr-4 text-right">Acciones</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {solicitudes.map((c) => {
                      const k = String(c.matriculaId);
                      return (
                        <tr key={k} className={cn('align-top transition-colors', elegidas.has(k) ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                          <td className="px-4 py-3"><Casilla id={`diplomas-elegir-${k}`} etiqueta={`Elegir a ${nombre(c.matriculaId)}`} marcada={elegidas.has(k)} alCambiar={() => alternar(setElegidas, k)} /></td>
                          <td className="px-2 py-3">
                            <NombreDiploma c={c} />
                            <CorreoDelAlumno c={c} />
                          </td>
                          <td className="px-2 py-3">
                            <div className="max-w-[260px] truncate" title={c.curso.nombre}>{c.curso.nombre}</div>
                            <div className="text-xs text-muted-foreground">{nombreCampus(c.centro)}</div>
                            <ProgramaAImprimir p={c.programaCrm} />
                          </td>
                          <td className="whitespace-nowrap px-2 py-3 text-xs">{fecha(c.solicitud?.en)}</td>
                          <td className="px-2 py-3 text-right">
                            <div className="tabular-nums">{c.notaFinal == null ? <span className="text-muted-foreground">—</span> : notaTexto(c.notaFinal, c.umbral)}</div>
                            <div className="mt-1"><Avance hechas={c.actividades.calificadas} total={c.actividades.total} /></div>
                          </td>
                          <td className="px-2 py-3"><EnElCrmEtiqueta crm={c.crm} /></td>
                          <td className="px-2 py-3 pr-4">
                            <div className="flex flex-col items-stretch gap-1.5">
                              <Button size="sm" disabled={trabajando} onClick={() => setDialogo({ tipo: 'aprobarEmitir', ids: [c.matriculaId] })}>
                                <SealCheck size={14} className="mr-1.5" /> Aprobar y emitir
                              </Button>
                              <Button size="sm" variant="outline" disabled={trabajando} onClick={() => abrir({ tipo: 'rechazar', ids: [c.matriculaId] })}>
                                <XCircle size={14} className="mr-1.5" /> Rechazar
                              </Button>
                              <Button size="sm" variant="ghost" disabled={trabajando} onClick={() => setEditando(c)} aria-label={`Editar los datos de ${nombre(c.matriculaId)}`}>
                                <NotePencil size={14} className="mr-1.5" /> Editar
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TablaDesplazable>
            )}
          </>
        ) : pestana === 'rechazados' ? (
          solicitudes.length === 0 ? (
            <EmptyState icon={XCircle} title={hayFiltros ? 'Nada coincide con los filtros' : 'No hay solicitudes rechazadas'}
              description={hayFiltros ? 'Prueba con otros filtros o límpialos.' : 'Lo que rechaces aparecerá aquí, con el motivo, para avisar al alumno.'} />
          ) : (
            <TablaDesplazable>
              <table className="w-full min-w-[980px] text-sm">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="w-10 px-4 py-2 text-left"><Casilla id="diplomas-elegir-todas" etiqueta="Elegir toda la página" marcada={todas} alCambiar={() => setElegidas(todas ? new Set() : new Set(filasClave))} /></th>
                    <Th>Alumno</Th>
                    <Th>Formación</Th>
                    <Th>Motivo</Th>
                    <Th>Rechazada</Th>
                    <Th>Aviso de rechazo</Th>
                    <Th className="pr-4 text-right">Acción</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {solicitudes.map((c) => {
                    const k = String(c.matriculaId);
                    const a = c.avisoRechazo;
                    return (
                      <tr key={k} className={cn('align-top transition-colors', elegidas.has(k) ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                        <td className="px-4 py-3"><Casilla id={`diplomas-elegir-${k}`} etiqueta={`Elegir a ${nombre(c.matriculaId)}`} marcada={elegidas.has(k)} alCambiar={() => alternar(setElegidas, k)} /></td>
                        <td className="px-2 py-3">
                          <NombreDiploma c={c} />
                          <div className="mt-0.5 max-w-[260px] truncate text-xs text-muted-foreground">{c.titular.email || 'sin correo'}</div>
                        </td>
                        <td className="px-2 py-3"><div className="max-w-[200px] truncate" title={c.curso.nombre}>{c.curso.nombre}</div><div className="text-xs text-muted-foreground">{nombreCampus(c.centro)}</div></td>
                        <td className="px-2 py-3"><p className="max-w-[260px] text-sm italic text-muted-foreground">«{c.decision?.motivo || 'sin motivo'}»</p></td>
                        <td className="whitespace-nowrap px-2 py-3 text-xs">{fecha(c.decision?.decididoEn)}<div className="max-w-[160px] truncate text-muted-foreground" title={c.decision?.decididoPor}>{c.decision?.decididoPor}</div></td>
                        <td className="px-2 py-3">
                          {!a ? <StatusDot tono="neutral">Sin avisar</StatusDot>
                            : a.resultado === 'enviado' ? <StatusDot tono="success">Enviado</StatusDot>
                              : a.resultado === 'correo_apagado' ? <StatusDot tono="warning">Aviso aprobado (correo apagado)</StatusDot>
                                : <StatusDot tono="danger">{ROTULO_AVISO[a.resultado] ?? a.resultado}</StatusDot>}
                          {a && <div className="mt-0.5 max-w-[170px] truncate text-[11px] text-muted-foreground" title={a.por}>{fecha(a.en)} · {a.por}</div>}
                        </td>
                        <td className="px-2 py-3 pr-4 text-right">
                          <Button size="sm" variant={a?.resultado === 'enviado' ? 'outline' : 'secondary'} disabled={trabajando} onClick={() => setDialogo({ tipo: 'avisoRechazo', ids: [c.matriculaId] })}>
                            <Envelope size={14} className="mr-1.5" /> {a ? 'Reenviar aviso' : 'Enviar aviso de rechazo'}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TablaDesplazable>
          )
        ) : diplomas.length === 0 ? (
          <EmptyState
            icon={pestana === 'enviados' ? Certificate : Prohibit}
            title={hayFiltros ? 'Nada coincide con los filtros' : pestana === 'enviados' ? 'Todavía no hay diplomas emitidos' : 'No hay diplomas revocados'}
            description={hayFiltros ? 'Prueba con otros filtros o límpialos.' : pestana === 'enviados' ? 'Al aprobar y emitir una solicitud, el diploma aparece aquí.' : 'Un diploma revocado sale aquí con su motivo, quién y cuándo.'}
          />
        ) : (
          <TablaDesplazable>
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr className="border-b border-border">
                  {pestana === 'enviados' && <th className="w-10 px-4 py-2 text-left"><Casilla id="diplomas-elegir-todas" etiqueta="Elegir toda la página" marcada={todas} alCambiar={() => setElegidas(todas ? new Set() : new Set(filasClave))} /></th>}
                  <Th className={pestana === 'revocados' ? 'pl-4' : undefined}>Alumno</Th>
                  <Th>Titulación</Th>
                  <Th>Emitido</Th>
                  {pestana === 'enviados' ? <Th>Aviso al alumno</Th> : <><Th>Revocado</Th><Th>Motivo</Th></>}
                  <Th className="pr-4 text-right">Acciones</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {diplomas.map((d) => {
                  const k = d.nexpediente;
                  return (
                    <tr key={k} className={cn('align-top transition-colors', elegidas.has(k) ? 'bg-primary/5' : 'hover:bg-muted/40')}>
                      {pestana === 'enviados' && <td className="px-4 py-3"><Casilla id={`diplomas-elegir-${k}`} etiqueta={`Elegir ${k}`} marcada={elegidas.has(k)} alCambiar={() => alternar(setElegidas, k)} /></td>}
                      <td className={cn('px-2 py-3', pestana === 'revocados' && 'pl-4')}>
                        <div className="max-w-[180px] truncate font-semibold" title={d.alumno}>{d.alumno}</div>
                        <div className="select-all font-mono text-[11px] text-primary">{d.nexpediente}</div>
                      </td>
                      <td className="px-2 py-3"><div className="max-w-[170px] truncate" title={d.titulacion}>{d.titulacion}</div><div className="text-xs text-muted-foreground">{nombreCampus(d.centro)}</div></td>
                      <td className="whitespace-nowrap px-2 py-3 text-xs">{fecha(d.emitidoEn)}<div className="max-w-[120px] truncate text-muted-foreground" title={d.emitidaPor ?? undefined}>{d.emitidaPor}</div></td>
                      {pestana === 'enviados' ? (
                        <td className="px-2 py-3"><EstadoAviso d={d} /></td>
                      ) : (
                        <>
                          <td className="whitespace-nowrap px-2 py-3 text-xs">{fecha(d.revocacion?.en)}<div className="max-w-[160px] truncate text-muted-foreground" title={d.revocacion?.por ?? undefined}>{d.revocacion?.por || '—'}</div></td>
                          <td className="px-2 py-3"><p className="max-w-[260px] text-sm italic text-muted-foreground">«{d.revocacion?.motivo || 'sin motivo'}»</p></td>
                        </>
                      )}
                      <td className="px-2 py-3 pr-4">
                        <div className="flex justify-end gap-1.5 whitespace-nowrap">
                          {pestana === 'enviados' && (
                            !d.aviso && !delCrm(d) ? (
                              // Emitido fuera del CRM: nadie lo tiene pendiente. Reenviar es secundario y pide confirmación.
                              <Button size="sm" variant="ghost" disabled={trabajando}
                                onClick={() => abrir({ tipo: 'avisos', exps: [d.nexpediente], reenvio: true, fuera: true })}>
                                <PaperPlaneTilt size={14} className="mr-1.5" /> Reenviar
                              </Button>
                            ) : (
                              <Button size="sm" variant={d.aviso ? 'outline' : 'default'} disabled={trabajando}
                                onClick={() => abrir({ tipo: 'avisos', exps: [d.nexpediente], reenvio: !!d.aviso })}>
                                <PaperPlaneTilt size={14} className="mr-1.5" /> {d.aviso ? 'Reenviar' : 'Enviar al alumno'}
                              </Button>
                            )
                          )}
                          {/* Revocado, Certifex ya no sirve su PDF (404): solo el enlace, que dice «revocado». */}
                          {pestana === 'enviados' && <IconoAccion etiqueta="Ver PDF" onClick={() => setVisor({ d, enviable: !d.aviso && delCrm(d) })}><FilePdf size={15} /></IconoAccion>}
                          <IconoAccion etiqueta={d.verificarUrl ? 'Copiar enlace de verificación' : 'Sin enlace público: Certifex no tiene una dirección que abra desde fuera'} disabled={!d.verificarUrl} onClick={() => copiarEnlace(d)}><LinkSimple size={15} /></IconoAccion>
                          {pestana === 'enviados' && (
                            <>
                              <IconoAccion etiqueta="Corregir nombre" disabled={trabajando} onClick={() => abrir({ tipo: 'corregir', d })}><PencilSimple size={15} /></IconoAccion>
                              <IconoAccion etiqueta="Revocar" peligro disabled={trabajando} onClick={() => abrir({ tipo: 'revocar', d })}><Prohibit size={15} /></IconoAccion>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TablaDesplazable>
        )}

        {total > 0 && !error && (
          <CardSection className="flex flex-wrap items-center justify-between gap-2 border-t text-xs text-muted-foreground">
            <span>{total.toLocaleString('es')} {total === 1 ? 'fila' : 'filas'}{cargando ? ' · cargando…' : ''}</span>
            {paginas > 1 && (
              <span className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={pagina <= 1 || cargando} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
                {pagina} / {paginas}
                <Button variant="outline" size="sm" disabled={pagina >= paginas || cargando} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button>
              </span>
            )}
          </CardSection>
        )}
      </Card>

      {/* Barra de acciones en bloque */}
      {elegidas.size > 0 && (
        // Con avisos (toasts) a la vista, la barra sube por encima de ellos: si no, los
        // avisos tapaban sus botones.
        <div className="sticky z-30 flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-card px-4 py-3 shadow-lg transition-[bottom]"
          style={{ bottom: toasts.length ? 16 + Math.min(toasts.length, 3) * 92 : 16 }}>
          <span className="text-sm font-semibold">{elegidas.size} {elegidas.size === 1 ? 'elegida' : 'elegidas'}</span>
          <button type="button" className="text-xs text-muted-foreground underline hover:text-foreground" onClick={() => setElegidas(new Set())}>Quitar selección</button>
          <div className="ml-auto flex flex-wrap gap-2">
            {pestana === 'pendientes' && (
              <>
                <Button variant="outline" size="sm" disabled={trabajando} onClick={() => abrir({ tipo: 'rechazar', ids: [...elegidas].map(Number) })}>
                  <XCircle size={14} className="mr-1.5" /> Rechazar ({elegidas.size})
                </Button>
                <Button size="sm" disabled={trabajando} onClick={() => setDialogo({ tipo: 'aprobarEmitir', ids: [...elegidas].map(Number) })}>
                  <SealCheck size={14} className="mr-1.5" />
                  {trabajando && lote ? `Emitiendo ${lote.hechas} de ${lote.total}…` : `Aprobar y emitir (${elegidas.size})`}
                </Button>
              </>
            )}
            {pestana === 'rechazados' && (
              <Button size="sm" variant="secondary" disabled={trabajando} onClick={() => setDialogo({ tipo: 'avisoRechazo', ids: [...elegidas].map(Number) })}>
                <Envelope size={14} className="mr-1.5" /> Enviar aviso de rechazo ({elegidas.size})
              </Button>
            )}
            {pestana === 'enviados' && (
              <Button size="sm" disabled={trabajando || enviables.length === 0} onClick={() => abrir({ tipo: 'avisos', exps: enviables, reenvio: reenvioEnBloque })}
                title={enviables.length < elegidas.size ? 'Lo emitido fuera del CRM no entra en un envío en bloque: reenvíalo de uno en uno.' : undefined}>
                <PaperPlaneTilt size={14} className="mr-1.5" />
                {trabajando && lote ? `Enviando ${lote.hechas} de ${lote.total}…` : `${rotuloEnBloque} (${enviables.length})`}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Confirmaciones */}
      <ConfirmDialog
        open={dialogo?.tipo === 'aprobarEmitir' || dialogo?.tipo === 'emitir'}
        title={dialogo?.tipo === 'aprobarEmitir' ? `Aprobar y emitir ${dialogo.ids.length}` : dialogo?.tipo === 'emitir' ? `Emitir ${dialogo.ids.length}` : ''}
        message={
          <>
            {dialogo?.tipo === 'aprobarEmitir' ? 'Se aprueban y se emite su diploma en Certifex con el nombre que escribió cada alumno. ' : 'Se emite el diploma de lo ya aprobado. '}
            <strong>No se avisa al alumno</strong>: el diploma queda pendiente de aviso hasta que revises el PDF y lo envíes. Cada diploma gasta un número de expediente en un registro que no se borra. Queda a tu nombre.
          </>
        }
        confirmLabel="Emitir"
        tone="warning"
        loading={trabajando}
        onCancel={() => setDialogo(null)}
        onConfirm={() => {
          const d = dialogo;
          setDialogo(null);
          if (d?.tipo === 'aprobarEmitir') void aprobarEmitir(d.ids);
          else if (d?.tipo === 'emitir') void emitir(d.ids);
        }}
      />
      <ConfirmDialog
        open={dialogo?.tipo === 'avisos'}
        title={dialogo?.tipo === 'avisos'
          ? (dialogo.exps.length === 1
            ? (dialogo.reenvio ? 'Reenviar el diploma al alumno' : 'Enviar el diploma al alumno')
            : `${dialogo.reenvio ? 'Enviar o reenviar' : 'Enviar'} ${dialogo.exps.length} diplomas a sus alumnos`)
          : ''}
        message={dialogo?.tipo === 'avisos' && dialogo.fuera
          ? <>Este diploma se emitió <strong>fuera del CRM</strong> y nadie lo tiene pendiente de enviar. Si lo reenvías, sale un correo al alumno con su diploma en PDF y el enlace de verificación. Queda registrado a tu nombre.</>
          : <>Sale un correo a cada alumno con su diploma en PDF y el enlace de verificación. Hazlo después de comprobar el PDF. Queda registrado a tu nombre.</>}
        confirmLabel={dialogo?.tipo === 'avisos' && dialogo.reenvio ? 'Reenviar' : 'Enviar'}
        tone={dialogo?.tipo === 'avisos' && dialogo.fuera ? 'warning' : 'info'}
        loading={trabajando}
        onCancel={() => setDialogo(null)}
        onConfirm={() => {
          const d = dialogo;
          setDialogo(null);
          if (d?.tipo === 'avisos') void enviarAvisos(d.exps);
        }}
      />
      <ConfirmDialog
        open={dialogo?.tipo === 'avisoRechazo'}
        title={dialogo?.tipo === 'avisoRechazo' ? (dialogo.ids.length === 1 ? 'Enviar el aviso de rechazo' : `Enviar ${dialogo.ids.length} avisos de rechazo`) : ''}
        message="Sale un correo a cada alumno con el motivo del rechazo, para que pueda corregirlo y volver a pedirlo. Queda registrado a tu nombre."
        confirmLabel="Enviar aviso"
        tone="warning"
        loading={trabajando}
        onCancel={() => setDialogo(null)}
        onConfirm={() => {
          const d = dialogo;
          setDialogo(null);
          if (d?.tipo === 'avisoRechazo') void avisarRechazo(d.ids);
        }}
      />
      {/* Rechazar y revocar: el diálogo no se cierra hasta que el servidor dice que sí. */}
      <PromptDialog
        open={dialogo?.tipo === 'rechazar'}
        title={dialogo?.tipo === 'rechazar' ? (dialogo.ids.length === 1 ? `Rechazar a ${nombre(dialogo.ids[0])}` : `Rechazar ${dialogo.ids.length} solicitudes`) : ''}
        message="El motivo es obligatorio: es lo que leerá el alumno si apruebas el aviso de rechazo. Rechazar no le avisa."
        label="Motivo del rechazo"
        placeholder="Ej.: el nombre no coincide con el de la matrícula, falta el trabajo final…"
        confirmLabel="Rechazar"
        multiline
        minLength={MOTIVO_MIN}
        maxLength={MOTIVO_MAX}
        error={dialogo?.tipo === 'rechazar' ? errorDialogo : null}
        loading={trabajando}
        onCancel={() => !trabajando && setDialogo(null)}
        onConfirm={(motivo: string) => {
          if (dialogo?.tipo === 'rechazar') void rechazar(dialogo.ids, motivo.trim());
        }}
      />
      <PromptDialog
        open={dialogo?.tipo === 'revocar'}
        title={dialogo?.tipo === 'revocar' ? `Revocar ${dialogo.d.nexpediente}` : ''}
        message={<>La verificación pública pasará a decir «revocado», con este motivo. No se avisa al alumno. <strong>Si solo está mal el nombre, corrígelo</strong>: no hace falta revocar.</>}
        label="Motivo de la revocación"
        placeholder="Ej.: se emitió por error, la matrícula se anuló…"
        confirmLabel="Revocar"
        multiline
        minLength={MOTIVO_MIN}
        maxLength={MOTIVO_MAX}
        error={dialogo?.tipo === 'revocar' ? errorDialogo : null}
        loading={trabajando}
        onCancel={() => !trabajando && setDialogo(null)}
        onConfirm={(motivo: string) => {
          if (dialogo?.tipo === 'revocar') void revocar(dialogo.d, motivo.trim());
        }}
      />
      {dialogo?.tipo === 'corregir' && (
        <DialogoCorregir
          d={dialogo.d}
          ocupado={trabajando}
          error={errorDialogo}
          alCancelar={() => !trabajando && setDialogo(null)}
          alConfirmar={(valor, motivo) => { void corregir(dialogo.d, valor, motivo); }}
        />
      )}

      {editando && (
        <DialogoEditar
          c={editando}
          alCerrar={() => setEditando(null)}
          alGuardar={(fila) => {
            setEditando(null);
            toast({ title: 'Datos revisados', description: `${fila.solicitud?.nombre || nombre(fila.matriculaId)}: «Aprobar y emitir» usará lo que has guardado.` });
            recargar();
          }}
        />
      )}

      {visor && (
        <VisorPdf
          d={visor.d}
          version={versiones[visor.d.nexpediente]}
          alCerrar={() => setVisor(null)}
          alEnviar={visor.enviable ? () => { const exp = visor.d.nexpediente; setVisor(null); setDialogo({ tipo: 'avisos', exps: [exp], reenvio: false }); } : undefined}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── bloques

/** Lo emitido que espera a que alguien vea el PDF y lo envíe al alumno. */
function BloquePorAvisar({ filas, nombreCampus, elegidas, alternar, todas, ocupado, verPdf, enviar }: {
  filas: Solicitud[];
  nombreCampus: (codigo: string) => string;
  elegidas: Set<string>;
  alternar: (k: string) => void;
  todas: () => void;
  ocupado: boolean;
  verPdf: (c: Solicitud) => void;
  enviar: (exps: string[]) => void;
}) {
  const marcadas = filas.filter((c) => elegidas.has(c.nexpediente!)).map((c) => c.nexpediente!);
  return (
    <div className="border-b border-border bg-warning-soft/30">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <div>
          <h3 className="text-sm font-semibold">Emitidos, falta enviarlos al alumno ({filas.length})</h3>
          <p className="text-xs text-muted-foreground">Revisa el PDF de cada uno; el correo sale solo cuando pulsas «Enviar».</p>
        </div>
        {marcadas.length > 0 && (
          <Button size="sm" disabled={ocupado} onClick={() => enviar(marcadas)}>
            <PaperPlaneTilt size={14} className="mr-1.5" /> Enviar {marcadas.length} al alumno
          </Button>
        )}
      </div>
      <TablaDesplazable>
        <table className="mt-2 w-full min-w-[860px] text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border">
              <th className="w-10 px-4 py-2 text-left"><Casilla id="diplomas-aviso-todas" etiqueta="Elegir todos los pendientes de aviso" marcada={marcadas.length === filas.length} alCambiar={todas} /></th>
              <Th>Nombre en el diploma</Th>
              <Th>Formación</Th>
              <Th>Nº de expediente</Th>
              <Th>Emitido</Th>
              <Th className="pr-4 text-right">Acciones</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filas.map((c) => {
              const k = c.nexpediente!;
              return (
                <tr key={k} className="align-top">
                  <td className="px-4 py-2.5"><Casilla id={`diplomas-aviso-${k}`} etiqueta={`Elegir ${k}`} marcada={elegidas.has(k)} alCambiar={() => alternar(k)} /></td>
                  <td className="px-2 py-2.5">
                    <div className="max-w-[260px] truncate font-semibold">{c.diploma?.alumno ?? c.solicitud?.nombre}</div>
                    <div className="max-w-[260px] truncate text-xs text-muted-foreground">{c.titular.email || 'sin correo'}</div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="max-w-[240px] truncate" title={c.curso.nombre}>{c.curso.nombre}</div>
                    <div className="text-xs text-muted-foreground">{nombreCampus(c.centro)}</div>
                    {c.programa
                      ? <Modulos programa={c.programa} rotulo={`Programa del CRM · ${resumenPrograma(c.programa)}`} />
                      : <div className="mt-1"><Etiqueta tono="neutral">Con lo de Moodle</Etiqueta></div>}
                  </td>
                  <td className="px-2 py-2.5 font-mono text-[11px] text-primary">{k}</td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs">{fecha(c.diploma?.emitidoEn)}</td>
                  <td className="px-2 py-2.5 pr-4">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => verPdf(c)}><FilePdf size={14} className="mr-1.5" /> Ver PDF</Button>
                      <Button size="sm" disabled={ocupado} onClick={() => enviar([k])}><PaperPlaneTilt size={14} className="mr-1.5" /> Enviar diploma al alumno</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TablaDesplazable>
    </div>
  );
}

// ── Revisar antes de aprobar ─────────────────────────────────────

type ModuloForm = { titulo: string; horas: string };
type ProgramaForm = { horas: string; modulos: ModuloForm[] };

const aForm = (p: ProgramaOficial | null | undefined): ProgramaForm => ({
  horas: p?.horas ? String(p.horas) : '',
  modulos: (p?.modulos ?? []).map((m) => ({ titulo: m.titulo, horas: m.horas != null ? String(m.horas) : '' })),
});

/** Los mismos límites que Certifex: si el programa no cabe, no se guarda. */
function deForm(f: ProgramaForm): { programa: ProgramaOficial | null; error: string | null } {
  const entero = (t: string) => (/^\d+$/.test(t.trim()) ? Number(t.trim()) : NaN);
  let horas: number | null = null;
  if (f.horas.trim()) {
    horas = entero(f.horas);
    if (!Number.isInteger(horas) || horas < 1 || horas > 5000) return { programa: null, error: 'Las horas totales van de 1 a 5.000 (número entero).' };
  }
  if (f.modulos.length > 100) return { programa: null, error: 'Como mucho 100 módulos.' };
  const modulos: ProgramaOficial['modulos'] = [];
  for (const [i, m] of f.modulos.entries()) {
    const titulo = m.titulo.replace(/\s+/g, ' ').trim();
    if (!titulo || titulo.length > 300) return { programa: null, error: `El módulo ${i + 1} necesita un título (hasta 300 caracteres).` };
    if (m.horas.trim()) {
      const h = entero(m.horas);
      if (!Number.isInteger(h) || h < 0 || h > 2000) return { programa: null, error: `Las horas del módulo ${i + 1} van de 0 a 2.000 (número entero).` };
      modulos.push({ titulo, horas: h });
    } else {
      modulos.push({ titulo });
    }
  }
  if (horas == null && modulos.length === 0) return { programa: null, error: 'Pon las horas totales o al menos un módulo.' };
  return { programa: { ...(horas != null ? { horas } : {}), modulos }, error: null };
}

const mismoPrograma = (a: ProgramaOficial | null | undefined, b: ProgramaOficial | null | undefined) => {
  const n = (p: ProgramaOficial | null | undefined) => (p
    ? JSON.stringify({ horas: p.horas ?? null, modulos: p.modulos.map((m) => ({ titulo: m.titulo, horas: m.horas ?? null })) })
    : null);
  return n(a) === n(b);
};
const normalizarNombre = (t: string) => t.replace(/\s+/g, ' ').trim();
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * «Revisar datos antes de aprobar»: con qué se trabaja para verificar al alumno y qué
 * se imprimirá. El nombre se guarda en Certifex (es quien imprime); el correo del CRM,
 * la formación vendida y el programa, en el CRM. Solo antes de emitir: después, Corregir.
 */
function DialogoEditar({ c, alCerrar, alGuardar }: {
  c: Solicitud; alCerrar: () => void; alGuardar: (fila: Solicitud) => void;
}) {
  const ed = c.edicion ?? null;
  const [catalogo, setCatalogo] = useState<CatalogoDelCampus | null>(null);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const [nombreD, setNombreD] = useState(c.solicitud?.nombre ?? '');
  const [correo, setCorreo] = useState(ed?.emailCrm ?? '');
  const [producto, setProducto] = useState(ed?.productoId ? String(ed.productoId) : '');
  // `tocado`: el programa es el escrito a mano. Si no, se imprime el del catálogo.
  const [tocado, setTocado] = useState(!!ed?.programaEditado);
  const [form, setForm] = useState<ProgramaForm>(aForm(ed?.programaEditado ?? c.programaCrm?.programa));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // «Sincronizar con el producto» (12/10): los módulos de la página del curso.
  const [sincronizando, setSincronizando] = useState(false);
  const [avisoTemario, setAvisoTemario] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    diplomasApi.formaciones(c.centro)
      .then((r) => { if (vivo) setCatalogo(r.data); })
      .catch((e) => { if (vivo) setErrorCatalogo((e as Error).message); });
    return () => { vivo = false; };
  }, [c.centro]);

  // El programa «del catálogo» de lo elegido: el de esa formación, o el automático.
  const automatico = c.programaCrm?.auto ?? (c.programaCrm && !c.programaCrm.editado && !c.programaCrm.elegida ? c.programaCrm : null);
  const baseDe = (sel: string): ProgramaOficial | null => {
    if (!sel) return automatico?.programa ?? null;
    const f = catalogo?.formaciones.find((x) => String(x.id) === sel);
    if (!f) return c.programaCrm?.formacion && String(c.programaCrm.formacion.id) === sel ? c.programaCrm.programa : null;
    return f.horas == null && f.modulos.length === 0 ? null : { ...(f.horas != null ? { horas: f.horas } : {}), modulos: f.modulos };
  };
  const base = baseDe(producto);

  const elegirFormacion = (sel: string) => {
    setProducto(sel);
    setAvisoTemario(null);
    if (!tocado) setForm(aForm(baseDe(sel)));
  };

  // La formación con la que se trabaja: la elegida o, en «Automática», la que encaja.
  const formacionActual = producto ? Number(producto) : (automatico?.formacion?.id ?? null);
  async function sincronizar() {
    if (!formacionActual || sincronizando) return;
    setSincronizando(true);
    setAvisoTemario(null);
    try {
      const r = (await diplomasApi.sincronizarTemario(c.centro, formacionActual)).data;
      const f = r.formacion;
      if (f) {
        setCatalogo((cat) => (cat ? { ...cat, formaciones: cat.formaciones.map((x) => (x.id === f.id ? f : x)) } : cat));
      }
      if (r.modulos > 0 && f) {
        // Se cargan en la lista para revisarlos: se pueden cambiar, quitar o añadir.
        const horas = form.horas.trim() || (f.horas != null ? String(f.horas) : '');
        setForm({ horas, modulos: f.modulos.map((m) => ({ titulo: m.titulo, horas: m.horas != null ? String(m.horas) : '' })) });
        setTocado(true);
        setAvisoTemario(`${r.modulos} módulos cargados de la página del curso${r.fuente ? ` (${new URL(r.fuente).hostname})` : ''}. Revísalos antes de guardar.`);
      } else {
        setAvisoTemario(r.motivo ?? 'No se encontraron módulos en la página del curso.');
      }
    } catch (e) {
      setAvisoTemario(`No se pudo sincronizar: ${(e as Error).message}`);
    } finally {
      setSincronizando(false);
    }
  }
  const cambiarForm = (fn: (f: ProgramaForm) => ProgramaForm) => { setForm(fn); setTocado(true); };
  const volverAlCatalogo = () => { setForm(aForm(base)); setTocado(false); };

  const revisado = c.solicitud?.revisado;
  const delAlumno = c.solicitud?.nombreAlumno ?? c.solicitud?.nombre ?? '';
  const nombreN = nombreValido(nombreD) ?? normalizarNombre(nombreD);
  const errorNombre = !nombreD.trim()
    ? 'Falta el nombre: es el que se imprimirá en el diploma.'
    : !nombreValido(nombreD) ? MSG_NOMBRE : null;
  const correoN = correo.trim().toLowerCase();
  const errorCorreo = correoN && !CORREO.test(correoN) ? 'Ese correo no es válido.' : null;
  const prog = tocado ? deForm(form) : { programa: null, error: null };
  const sumaModulos = form.modulos.reduce((s, m) => s + (/^\d+$/.test(m.horas.trim()) ? Number(m.horas) : 0), 0);
  const horasTotales = /^\d+$/.test(form.horas.trim()) ? Number(form.horas) : null;

  const cambios: CambiosSolicitud = { matriculaId: c.matriculaId };
  if (nombreN !== normalizarNombre(c.solicitud?.nombre ?? '')) cambios.nombre = nombreN;
  if (correoN !== (ed?.emailCrm ?? '')) cambios.emailCrm = correoN || null;
  const productoN = producto ? Number(producto) : null;
  if (productoN !== (ed?.productoId ?? null)) cambios.productoId = productoN;
  if (tocado && prog.programa && !mismoPrograma(prog.programa, ed?.programaEditado)) cambios.programa = prog.programa;
  if (!tocado && ed?.programaEditado) cambios.programa = null;
  const hayCambios = Object.keys(cambios).length > 1;
  const listo = !guardando && hayCambios && !errorNombre && !errorCorreo && !prog.error;

  // Con cambios sin guardar, Escape, el fondo o «Cancelar» preguntan antes de descartar.
  const [preguntar, setPreguntar] = useState(false);
  const intentarCerrar = () => {
    if (guardando) return;
    if (hayCambios) setPreguntar(true);
    else alCerrar();
  };
  const ref = useRef<HTMLFormElement>(null);
  useModalAccesible(ref, { onClose: intentarCerrar, bloqueado: guardando });

  async function guardar() {
    if (!listo) return;
    setGuardando(true);
    setError(null);
    try {
      const r = await diplomasApi.editar(cambios);
      alGuardar(r.data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(false);
    }
  }

  const campo = 'mt-1 h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';
  const opciones = [
    { value: '', label: 'Automática (la que encaje con el curso)' },
    ...(catalogo?.formaciones ?? []).map((f) => ({
      value: String(f.id),
      label: [f.nombre, f.horas ? `${miles(f.horas)} h` : null, f.modulos.length ? `${f.modulos.length} módulos` : null, f.activa ? null : 'inactiva'].filter(Boolean).join(' · '),
    })),
  ];

  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={intentarCerrar} />
        <form
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="editar-titulo"
          onSubmit={(e) => { e.preventDefault(); void guardar(); }}
          className="relative flex max-h-[100dvh] w-full max-w-2xl flex-col border border-border bg-card sm:max-h-[92vh] sm:rounded-lg"
        >
          <div className="flex items-start gap-3 border-b border-border px-5 pb-3 pt-5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><NotePencil size={20} /></div>
            <div className="min-w-0 flex-1">
              <h2 id="editar-titulo" className="text-base font-semibold">Revisar datos antes de aprobar</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground" title={`${c.curso.nombre} · ${c.centro}`}>{c.curso.nombre} · {c.centro}</p>
            </div>
            <button type="button" onClick={intentarCerrar} disabled={guardando} aria-label="Cerrar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Nombre: vive en Certifex, que es quien lo imprime. */}
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Nombre para el diploma</span>
              <input data-autofocus value={nombreD} onChange={(e) => setNombreD(e.target.value)} maxLength={160} aria-invalid={!!errorNombre} className={campo} />
              <span className="mt-1 block text-xs text-muted-foreground">Lo escribió el alumno: <span className="text-foreground">{delAlumno || '—'}</span></span>
              {revisado && <span className="mt-0.5 block text-xs text-muted-foreground">Revisado por {revisado.por} el {fechaHora(revisado.en)}</span>}
              {errorNombre && <span className="mt-0.5 block text-xs text-destructive" role="alert">{errorNombre}</span>}
            </label>

            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Correo del alumno en el CRM</span>
              <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} maxLength={254} placeholder={c.titular.email || 'correo@ejemplo.com'} aria-invalid={!!errorCorreo} className={campo} />
              <span className="mt-1 block text-xs text-muted-foreground">
                Sirve para encontrar su venta y su estado de pago. Déjalo vacío para usar el de Moodle{c.titular.email ? ` (${c.titular.email})` : ''}.
              </span>
              {errorCorreo && <span className="mt-0.5 block text-xs text-destructive">{errorCorreo}</span>}
            </label>

            <div className="text-sm">
              <span className="text-xs font-medium text-muted-foreground">Formación vendida</span>
              <Select<string> value={producto} onChange={elegirFormacion} ariaLabel="Formación vendida" className="mt-1 w-full" options={opciones} disabled={!catalogo} />
              <span className="mt-1 block text-xs text-muted-foreground">
                {errorCatalogo ? `No se pudo cargar el catálogo: ${errorCatalogo}`
                  : !catalogo ? 'Cargando el catálogo…'
                    : catalogo.motivo ? catalogo.motivo
                      : producto ? `Del catálogo de ${catalogo.proyecto?.nombre}, aunque no se llame como el curso.`
                        : automatico?.formacion ? `Ahora encaja: ${automatico.formacion.nombre}.`
                          : automatico?.motivo ?? 'La que el alumno compró y se llame como el curso de Moodle.'}
                {correoN !== (ed?.emailCrm ?? '') && !producto ? ' Con otro correo, la automática se recalcula al guardar.' : ''}
              </span>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => void sincronizar()}
                  disabled={!formacionActual || sincronizando || !catalogo} aria-busy={sincronizando}
                  title={formacionActual ? 'Lee los módulos de la página del curso y los guarda en el catálogo' : 'Elige antes la formación vendida'}>
                  <ArrowClockwise size={14} className={cn('mr-1.5', sincronizando && 'animate-spin')} />
                  {sincronizando ? 'Sincronizando…' : 'Sincronizar módulos con el producto'}
                </Button>
                {avisoTemario && <span className="text-xs text-muted-foreground" role="status">{avisoTemario}</span>}
              </div>
            </div>

            {/* Programa a imprimir: el del catálogo o uno escrito a mano. */}
            <fieldset className="min-w-0 rounded-md border border-border p-3 [min-inline-size:0]">
              <legend className="px-1 text-xs font-medium text-muted-foreground">Programa a imprimir</legend>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs">
                  {tocado
                    ? <Etiqueta tono="info">Editado a mano: es lo que se imprimirá</Etiqueta>
                    : base ? <Etiqueta tono="success">Del catálogo del CRM</Etiqueta>
                      : <Etiqueta tono="warning">Sin programa del CRM: escríbelo o se usará lo de Moodle</Etiqueta>}
                </span>
                {tocado && (
                  <Button type="button" size="sm" variant="ghost" onClick={volverAlCatalogo}>
                    <ArrowCounterClockwise size={14} className="mr-1.5" /> Volver al del catálogo
                  </Button>
                )}
              </div>
              <label className="block text-sm">
                <span className="text-xs font-medium text-muted-foreground">Horas totales</span>
                <input inputMode="numeric" value={form.horas} onChange={(e) => cambiarForm((f) => ({ ...f, horas: e.target.value }))} placeholder="Ej.: 1500"
                  className={cn(campo, 'block w-36')} aria-label="Horas totales" />
              </label>
              <div className="mt-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">Módulos ({form.modulos.length})</span>
                  {form.modulos.length > 0 && (
                    <span className={cn('text-[11px]', horasTotales != null && sumaModulos !== horasTotales ? 'text-warning-soft-foreground' : 'text-muted-foreground')}>
                      Suman {miles(sumaModulos)} h{horasTotales != null && sumaModulos !== horasTotales ? ` (el total dice ${miles(horasTotales)} h)` : ''}
                    </span>
                  )}
                </div>
                {form.modulos.length === 0 ? (
                  <p className="mt-1 text-xs italic text-muted-foreground">Sin módulos.</p>
                ) : (
                  <ol className="mt-1 space-y-1.5">
                    {form.modulos.map((m, i) => (
                      <li key={i} className="flex min-w-0 items-center gap-2">
                        <span className="w-6 flex-none text-right text-xs tabular-nums text-muted-foreground">{i + 1}.</span>
                        <input value={m.titulo} maxLength={300} aria-label={`Título del módulo ${i + 1}`} placeholder="Título del módulo"
                          onChange={(e) => cambiarForm((f) => ({ ...f, modulos: f.modulos.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)) }))}
                          className="h-9 min-w-0 flex-1 rounded-md border border-border bg-muted/30 px-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        <input value={m.horas} inputMode="numeric" aria-label={`Horas del módulo ${i + 1}`} placeholder="h"
                          onChange={(e) => cambiarForm((f) => ({ ...f, modulos: f.modulos.map((x, j) => (j === i ? { ...x, horas: e.target.value } : x)) }))}
                          className="h-9 w-20 flex-none rounded-md border border-border bg-muted/30 px-2.5 text-right text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40" />
                        <IconoAccion etiqueta={`Quitar el módulo ${i + 1}`} peligro onClick={() => cambiarForm((f) => ({ ...f, modulos: f.modulos.filter((_, j) => j !== i) }))}>
                          <Trash size={14} />
                        </IconoAccion>
                      </li>
                    ))}
                  </ol>
                )}
                <Button type="button" size="sm" variant="outline" className="mt-2" disabled={form.modulos.length >= 100}
                  onClick={() => cambiarForm((f) => ({ ...f, modulos: [...f.modulos, { titulo: '', horas: '' }] }))}>
                  <Plus size={14} className="mr-1.5" /> Añadir módulo
                </Button>
              </div>
              {prog.error && <p className="mt-2 text-xs text-destructive">{prog.error}</p>}
            </fieldset>

            {ed?.por && (
              <p className="text-xs text-muted-foreground">Correo, formación o programa revisados por {ed.por} el {fechaHora(ed.en)}.</p>
            )}
            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/20 p-4">
            <span className="mr-auto text-xs text-muted-foreground">No se avisa al alumno. Queda a tu nombre.</span>
            <button type="button" onClick={intentarCerrar} disabled={guardando} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={!listo} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog
        open={preguntar}
        title="¿Descartar los cambios?"
        message="Has cambiado datos de esta solicitud y no los has guardado. Si sales, se pierden."
        confirmLabel="Descartar"
        cancelLabel="Seguir editando"
        tone="warning"
        onCancel={() => setPreguntar(false)}
        onConfirm={() => { setPreguntar(false); alCerrar(); }}
      />
    </Portal>
  );
}

/**
 * Corregir el nombre: mismo número y mismo QR, con motivo. La misma regla que Certifex
 * (nombre y apellido, solo letras, de 3 a 160) y el motivo de 3 a 500. Si el servidor
 * dice que no (p. ej. «Es el mismo valor…»), el diálogo sigue abierto con lo escrito.
 */
function DialogoCorregir({ d, ocupado, error, alCancelar, alConfirmar }: {
  d: Diploma; ocupado: boolean; error: string | null; alCancelar: () => void; alConfirmar: (valor: string, motivo: string) => void;
}) {
  const [valor, setValor] = useState(d.alumno);
  const [motivo, setMotivo] = useState('');
  const ref = useRef<HTMLFormElement>(null);
  useModalAccesible(ref, { onClose: alCancelar, bloqueado: ocupado });
  const limpio = nombreValido(valor);
  const errorNombre = !valor.trim() ? 'Falta el nombre.' : !limpio ? MSG_NOMBRE : limpio === d.alumno.trim() ? 'Es el mismo nombre que ya tiene.' : null;
  const m = motivo.trim();
  const errorMotivo = m && m.length < MOTIVO_MIN ? `Escribe al menos ${MOTIVO_MIN} caracteres.` : null;
  const listo = !ocupado && !errorNombre && m.length >= MOTIVO_MIN && m.length <= MOTIVO_MAX;
  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[80] flex items-center justify-center sm:p-4">
        <div className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-sm" onClick={alCancelar} />
        <form
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby="corregir-titulo"
          onSubmit={(e) => { e.preventDefault(); if (listo && limpio) alConfirmar(limpio, m); }}
          className="relative flex w-full max-w-md flex-col border border-border bg-card sm:rounded-lg"
        >
          <div className="space-y-3 px-5 pb-3 pt-5">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><PencilSimple size={20} /></div>
              <div className="min-w-0 flex-1">
                <h2 id="corregir-titulo" className="text-base font-semibold">Corregir el nombre</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  <span className="font-mono text-xs">{d.nexpediente}</span>. Mismo número y mismo QR; queda registrado quién, cuándo y por qué. No se avisa al alumno.
                </p>
              </div>
              <button type="button" onClick={alCancelar} disabled={ocupado} aria-label="Cerrar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
            </div>
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Nombre correcto</span>
              <input data-autofocus value={valor} onChange={(e) => setValor(e.target.value)} maxLength={160} aria-invalid={!!errorNombre}
                className="mt-1 h-10 w-full rounded-md border border-border bg-muted/30 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              {errorNombre && valor !== d.alumno && <span className="mt-0.5 block text-xs text-destructive">{errorNombre}</span>}
            </label>
            <label className="block text-sm">
              <span className="text-xs font-medium text-muted-foreground">Motivo (obligatorio)</span>
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={3} maxLength={MOTIVO_MAX} aria-invalid={!!errorMotivo}
                placeholder="Ej.: faltaba una tilde, el segundo apellido estaba mal…"
                className="mt-1 w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40" />
              <span className="mt-0.5 flex justify-between gap-2 text-xs">
                <span className={errorMotivo ? 'text-destructive' : 'text-muted-foreground'}>{errorMotivo || (!m ? `Mínimo ${MOTIVO_MIN} caracteres.` : '')}</span>
                <span className="tabular-nums text-muted-foreground">{motivo.length}/{MOTIVO_MAX}</span>
              </span>
            </label>
            {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">{error}</div>}
          </div>
          <div className="flex justify-end gap-2 border-t border-border bg-muted/20 p-4">
            <button type="button" onClick={alCancelar} disabled={ocupado} className="inline-flex h-9 items-center rounded-md border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Cancelar</button>
            <button type="submit" disabled={!listo} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              {ocupado ? 'Procesando…' : 'Corregir'}
            </button>
          </div>
        </form>
      </div>
    </Portal>
  );
}

/** El PDF del diploma, traído por el servidor del CRM (Certifex no se deja incrustar). */
function VisorPdf({ d, version, alCerrar, alEnviar }: {
  d: Pick<Diploma, 'nexpediente' | 'alumno' | 'titulacion' | 'centro' | 'diplomaUrl' | 'imprenta'>;
  version?: number;
  alCerrar: () => void;
  alEnviar?: () => void;
}) {
  const [pdf, setPdf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useModalAccesible(ref, { onClose: alCerrar });
  useEffect(() => {
    let url: string | null = null;
    let vivo = true;
    emisionesApi.diploma(d.nexpediente, version)
      .then((b) => { if (vivo) { url = URL.createObjectURL(b); setPdf(url); } })
      .catch((e) => { if (vivo) setError((e as Error).message); });
    return () => { vivo = false; if (url) URL.revokeObjectURL(url); };
  }, [d.nexpediente, version]);
  return (
    <Portal>
      <div className="fixed inset-0 !m-0 z-[70] flex items-center justify-center bg-black/50 sm:p-4" onClick={alCerrar}>
        <div ref={ref} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="visor-titulo"
          className="flex h-[100dvh] w-full max-w-4xl flex-col overflow-hidden border border-border bg-card shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-lg">
          {/* En móvil, el nombre arriba a lo ancho y los botones debajo: antes se apretaban en una línea. */}
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-start">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{d.centro} · <span className="break-all font-mono">{d.nexpediente}</span></p>
                <h2 id="visor-titulo" className="break-words text-base font-bold leading-snug">{d.alumno}</h2>
                <p className="break-words text-xs text-muted-foreground">{d.titulacion}</p>
              </div>
              <button type="button" onClick={alCerrar} aria-label="Cerrar" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground sm:order-last"><X size={16} weight="bold" /></button>
            </div>
            <div className="flex flex-wrap gap-2">
              {pdf && (
                <>
                  <Button variant="outline" size="sm" asChild><a href={pdf} target="_blank" rel="noreferrer noopener"><ArrowSquareOut size={14} className="mr-1.5" /> Abrir</a></Button>
                  <Button variant="outline" size="sm" asChild><a href={pdf} download={`${d.nexpediente}.pdf`}><DownloadSimple size={14} className="mr-1.5" /> Descargar</a></Button>
                </>
              )}
              {d.imprenta && <BotonImprenta nexpediente={d.nexpediente} />}
              {alEnviar && <Button size="sm" disabled={!pdf} onClick={alEnviar}><PaperPlaneTilt size={14} className="mr-1.5" /> Está bien: enviar al alumno</Button>}
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 sm:p-4">
            {error ? (
              <div className="space-y-3 rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-sm text-destructive">No se pudo traer el PDF: {error}</p>
                {d.diplomaUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={d.diplomaUrl} target="_blank" rel="noreferrer noopener"><ArrowSquareOut size={14} className="mr-1.5" /> Ver el diploma en Certifex</a>
                  </Button>
                )}
              </div>
            ) : pdf ? (
              <iframe title={`Diploma ${d.nexpediente}`} src={pdf} className="h-full min-h-[60vh] w-full rounded-md border border-border bg-muted sm:h-[70vh]" />
            ) : (
              <div className="h-[60vh] animate-pulse rounded-md bg-muted sm:h-[70vh]" />
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * El A3 de imprenta (#95 de Certifex). Al alumno le llega siempre el digital A4, que es el
 * que se ve en este visor; el A3 es solo para la imprenta. Generarlo tarda unos segundos,
 * así que el botón dice que está trabajando —también a un lector de pantalla— y no se
 * puede pulsar dos veces.
 */
function BotonImprenta({ nexpediente }: { nexpediente: string }) {
  const [bajando, setBajando] = useState(false);
  async function bajar() {
    if (bajando) return;
    setBajando(true);
    try {
      const { blob, nombre } = await emisionesApi.diplomaImprenta(nexpediente);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nombre;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revocar en el mismo turno deja a algún navegador sin llegar a leer el blob.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      toast({ title: 'No se pudo bajar el A3', description: (e as Error).message, variant: 'destructive' });
    } finally {
      setBajando(false);
    }
  }
  return (
    <Button variant="outline" size="sm" onClick={bajar} disabled={bajando} aria-busy={bajando}
      title="Solo para la imprenta. Al alumno le llega el diploma digital A4.">
      <Printer size={14} className="mr-1.5" aria-hidden="true" />
      {bajando ? 'Generando el A3…' : 'PDF de imprenta (A3)'}
      <span className="sr-only"> (solo para la imprenta; al alumno le llega el digital A4)</span>
    </Button>
  );
}
