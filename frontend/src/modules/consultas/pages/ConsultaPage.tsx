import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, ArrowSquareOut, ArrowsClockwise, BookmarkSimple, CheckCircle, Checks, ClipboardText,
  ArrowsLeftRight, CaretRight, Copy, IdentificationCard, LinkSimple, NotePencil, Paperclip, PaperPlaneRight, SidebarSimple, Trash, UsersThree, Warning, X,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/shared/hooks/useToast';
import { Button } from '@/shared/components/ui/button';
import Select from '@/shared/components/ui/Select';
import Iniciales from '@/shared/components/ui/Iniciales';
import { cn } from '@/shared/lib/utils';
import {
  consultasApi, semaforo, haceCuanto as horasEnTexto,
  type ConsultaDetalle, type ConsultaFila, type ContextoConsulta, type NotaInterna, type ParticipanteChat, type RespuestaGuardada, type TipoDeGrupo,
} from '../api/consultas.api';

/*
  Una consulta (#188, #679), como un puesto de atención: a la izquierda la bandeja
  para saltar de una a otra, en el centro la conversación con sus herramientas
  (respuestas guardadas, insertar enlace, adjuntar, enviar y cerrar) y a la
  derecha la ficha del alumno (detalles, sus entregas sin corregir, sus cursos, sus
  otras consultas y la actividad). Es la dirección del botón «Responder en el CRM»
  del correo al tutor.

  Sistema: la escala de texto del CRM (text-normal 14 · text-secundario 12 ·
  text-tabla 11), cabeceras de 56 px alineadas en las tres columnas, controles de
  32 px y separadores finos en vez de cajas. El color, solo para el estado y la
  acción principal.
*/

const fecha = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', {
  day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
}) : '—');
const fechaCorta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '—');
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '');
const dia = (iso: string | null) => (iso ? new Date(iso).toDateString() : '');

/** «Hoy», «Ayer» o la fecha: el separador del chat. */
function etiquetaDia(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const hoy = new Date();
  const ayer = new Date(); ayer.setDate(hoy.getDate() - 1);
  if (d.toDateString() === hoy.toDateString()) return 'Hoy';
  if (d.toDateString() === ayer.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** En la bandeja: la hora si es de hoy; si no, el día. */
const cuando = (iso: string | null) => (iso && dia(iso) === new Date().toDateString() ? hora(iso) : fechaCorta(iso));

function ultimoAcceso(iso: string | null) {
  if (!iso) return 'Nunca ha entrado';
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (dias <= 0) return 'Entró hoy';
  if (dias === 1) return 'Entró ayer';
  return `Entró hace ${dias} días`;
}

const QUE_PASO: Record<string, string> = {
  entrada: 'Entró la consulta', asignada: 'Asignada', reasignada: 'Reasignada', leida: 'La abrió su tutora',
  respondida: 'Respondida', cerrada: 'Cerrada', reabierta: 'El alumno volvió a escribir',
  iniciada_por_tutor: 'La empezó el tutor («Escribir al alumno»)',
  recordatorio_plazo: 'Recordatorio al tutor: se acerca el plazo',
  fuera_de_plazo: 'Fuera de plazo: avisada administración',
};
const ESTADO: Record<string, string> = { abierta: 'Abierta', respondida: 'Respondida', cerrada: 'Cerrada' };

const MAX_ADJUNTOS = 5;
const MAX_MB = 10;

function mensajeDeError(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Inténtalo de nuevo.';
}

// ─── Piezas pequeñas ─────────────────────────────────────────────────────────

/** El plazo como punto + texto (no una cápsula): verde en plazo, ámbar cerca, rojo fuera. */
function Plazo({ c, plazoHoras, corto = false }: { c: Pick<ConsultaFila, 'estado' | 'espera_desde' | 'entrada_at'>; plazoHoras: number; corto?: boolean }) {
  const s = semaforo(c, plazoHoras);
  if (!s) return <span className="text-secundario text-muted-foreground">{ESTADO[c.estado] || c.estado}</span>;
  const tono = { verde: 'text-success', ambar: 'text-warning', rojo: 'text-destructive' }[s.color];
  const texto = { verde: 'En plazo', ambar: 'Cerca del plazo', rojo: 'Fuera de plazo' }[s.color];
  return (
    <span className="inline-flex items-center gap-1.5 text-secundario text-muted-foreground"
      title={`Espera respuesta desde ${new Date(c.espera_desde || c.entrada_at).toLocaleString('es-ES')} · plazo ${plazoHoras} h`}>
      <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full bg-current', tono)} />
      <span className={cn('font-medium', tono)}>{texto}</span>{!corto && <> · {horasEnTexto(s.horas)}</>}
    </span>
  );
}

/** Un botón de solo icono, con su nombre para el lector y su tooltip. */
function BotonIcono({ etiqueta, onClick, href, children, activo = false, className }: {
  etiqueta: string; onClick?: () => void; href?: string; children: React.ReactNode; activo?: boolean; className?: string;
}) {
  const clase = cn('inline-grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    activo && 'bg-muted text-foreground', className);
  if (href) {
    return <a href={href} target="_blank" rel="noopener noreferrer" title={etiqueta} aria-label={etiqueta} className={clase}>{children}</a>;
  }
  return <button type="button" onClick={onClick} title={etiqueta} aria-label={etiqueta} aria-pressed={activo || undefined} className={clase}>{children}</button>;
}

/** El texto con sus direcciones como enlaces (sin HTML: cada trozo es texto o un <a>). */
function ConEnlaces({ texto, claro }: { texto: string; claro: boolean }) {
  const trozos = texto.split(/(https?:\/\/[^\s<]+)/g);
  return (
    <>
      {trozos.map((t, i) => (i % 2 === 1 ? (
        <a key={i} href={t.replace(/[.,;:!?)»]+$/, '')} target="_blank" rel="noopener noreferrer"
          className={cn('break-all underline underline-offset-2',
            claro ? 'text-primary-foreground decoration-primary-foreground/50 hover:decoration-primary-foreground dark:text-primary dark:decoration-primary/40 dark:hover:decoration-primary' : 'text-primary decoration-primary/40 hover:decoration-primary')}>
          {t}
        </a>
      ) : t))}
    </>
  );
}

const Cabecera = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-border px-4', className)}>{children}</div>
);

/** Un apartado de la ficha, plegable: así la ficha no satura y cada una abre lo que necesita. */
const Seccion = ({ titulo, extra, abierta = false, children }: { titulo: string; extra?: React.ReactNode; abierta?: boolean; children: React.ReactNode }) => (
  <details open={abierta} className="group/seccion border-b border-border last:border-b-0">
    <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
      <CaretRight size={11} weight="bold" aria-hidden className="shrink-0 text-muted-foreground transition-transform group-open/seccion:rotate-90" />
      <h3 className="flex-1 text-tabla uppercase text-muted-foreground">{titulo}</h3>
      {extra}
    </summary>
    <div className="px-4 pb-4">{children}</div>
  </details>
);

// ─── Respuestas guardadas: en el servidor (personales y del campus) ──────────

interface Guardada { id: string; titulo: string; texto: string }
const GUARDADAS_INICIALES: Guardada[] = [
  { id: 'saludo', titulo: 'Saludo', texto: 'Hola {nombre}, gracias por escribir. ' },
  { id: 'revision', titulo: 'Reviso tu entrega', texto: 'Hola {nombre}, he recibido tu entrega. La reviso y te digo algo en las próximas 48 horas.' },
  { id: 'resuelto', titulo: '¿Resuelto?', texto: '¿Te ha quedado resuelta la duda? Si necesitas algo más, escríbeme por aquí.' },
];

/**
 * Las respuestas guardadas, del servidor: las suyas (la siguen a cualquier equipo) y
 * las de sus campus. La primera vez, las que tenía en este navegador (o las de serie)
 * pasan a su cuenta.
 */
function useRespuestas(userId: number | undefined) {
  const [lista, setLista] = useState<RespuestaGuardada[]>([]);
  useEffect(() => {
    if (!userId) return undefined;
    let vivo = true;
    (async () => {
      try {
        const r = await consultasApi.respuestas();
        let datos = r.data || [];
        // Lo leído, ya: si subir las del navegador falla, al menos se ven estas.
        if (vivo) setLista(datos);
        const clave = `crm.consultas.respuestas.${userId}`;
        const hecho = `crm.consultas.respuestas.subidas.${userId}`;
        let yaSubidas = false;
        try { yaSubidas = localStorage.getItem(hecho) === '1'; } catch { /* sin almacenamiento */ }
        if (!yaSubidas && !datos.some((x) => x.personal)) {
          let locales: Guardada[] = GUARDADAS_INICIALES;
          try { const v = localStorage.getItem(clave); if (v) locales = JSON.parse(v); } catch { /* las de serie */ }
          const imp = await consultasApi.importarRespuestas(locales.map(({ titulo, texto }) => ({ titulo, texto })));
          datos = imp.data?.respuestas || datos;
          try { localStorage.setItem(hecho, '1'); localStorage.removeItem(clave); } catch { /* sin almacenamiento */ }
        }
        if (vivo) setLista(datos);
      } catch { /* sin respuestas guardadas: el chat sigue funcionando */ }
    })();
    return () => { vivo = false; };
  }, [userId]);
  const crear = async (titulo: string, texto: string) => { const r = await consultasApi.crearRespuesta({ titulo, texto }); if (r.data) setLista(r.data); };
  const borrar = async (id: number) => { const r = await consultasApi.borrarRespuesta(id); if (r.data) setLista(r.data); };
  return { lista, crear, borrar };
}

// ─── Bandeja ─────────────────────────────────────────────────────────────────

function Bandeja({ actual, puedes, plazoHoras, version }: { actual: number; puedes: 'tutor' | 'admin'; plazoHoras: number; version: string }) {
  const [lista, setLista] = useState<ConsultaFila[] | null>(null);
  useEffect(() => {
    let vivo = true;
    const pedir = puedes === 'tutor' ? consultasApi.mias({ estado: 'pendientes' }) : consultasApi.panel({}, { estado: 'pendientes' });
    pedir.then((r) => { if (vivo) setLista(r.success && r.data ? r.data.consultas : []); }).catch(() => { if (vivo) setLista([]); });
    return () => { vivo = false; };
  }, [actual, puedes, version]);

  return (
    <nav aria-label="Consultas pendientes" className="hidden min-h-0 flex-col border-r border-border bg-card lg:flex">
      <Cabecera>
        <h2 className="flex-1 text-normal font-semibold text-foreground">Pendientes</h2>
        {lista && <span className="rounded-full bg-muted px-2 py-0.5 text-secundario font-medium tabular-nums text-muted-foreground">{lista.length}</span>}
      </Cabecera>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {!lista && [0, 1, 2].map((i) => (
          <li key={i} className="flex gap-3 px-4 py-3"><span className="h-8 w-8 animate-pulse rounded-full bg-muted" /><span className="h-9 flex-1 animate-pulse rounded bg-muted" /></li>
        ))}
        {lista && lista.length === 0 && (
          <li className="px-4 py-10 text-center">
            <CheckCircle size={22} weight="duotone" className="mx-auto text-success" aria-hidden />
            <p className="mt-2 text-normal font-medium text-foreground">Todo al día</p>
            <p className="text-secundario text-muted-foreground">No quedan consultas pendientes.</p>
          </li>
        )}
        {lista?.map((k) => {
          const activa = k.id === actual;
          return (
            <li key={k.id} className="px-2">
              <Link to={`/consultas/${k.id}`} aria-current={activa ? 'page' : undefined}
                className={cn('flex gap-3 rounded-md px-2 py-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  activa ? 'bg-muted' : 'hover:bg-muted/60')}>
                <Iniciales nombre={k.alumno_nombre} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={cn('truncate text-normal text-foreground', activa ? 'font-semibold' : 'font-medium')}>{k.alumno_nombre || 'Alumno'}</span>
                    <span className="shrink-0 text-secundario tabular-nums text-muted-foreground">{cuando(k.espera_desde || k.entrada_at)}</span>
                  </span>
                  <span className="block truncate text-secundario text-muted-foreground">{k.ultimo_mensaje || k.curso_nombre || k.campus}</span>
                  {k.estado === 'abierta' && <span className="mt-0.5 block"><Plazo c={k} plazoHoras={plazoHoras} corto /></span>}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ─── Ficha del alumno ────────────────────────────────────────────────────────

function Ficha({ c, ctx, cargando, alInsertar, puedeEscribir, admin }: {
  c: ConsultaDetalle; ctx: ContextoConsulta | null; cargando: boolean; alInsertar: (texto: string) => void;
  puedeEscribir: boolean; admin: React.ReactNode;
}) {
  const fila = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 py-1">
      <dt className="text-secundario text-muted-foreground">{k}</dt>
      <dd className="min-w-0 truncate text-secundario text-foreground">{v}</dd>
    </div>
  );
  return (
    <div>
      <Seccion titulo="Detalles" abierta>
        <dl>
          {fila('Estado', <Plazo c={c} plazoHoras={c.plazoHoras} />)}
          {fila('Atiende', c.tutor || 'Sin tutor asignado')}
          {fila('Campus', c.campus + (c.empresa ? ` · ${c.empresa}` : ''))}
          {c.curso_nombre && fila('Curso', c.curso_nombre)}
          {c.alumno_email && fila('Correo', <a href={`mailto:${c.alumno_email}`} className="hover:text-primary hover:underline">{c.alumno_email}</a>)}
          {fila('Entró', fecha(c.entrada_at))}
          {fila('1.ª respuesta', c.primera_respuesta_at ? fecha(c.primera_respuesta_at) : 'Todavía no')}
        </dl>
        {admin}
      </Seccion>

      {cargando && !ctx && (
        <div className="space-y-3 p-4" aria-busy="true" aria-label="Leyendo el campus">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}
        </div>
      )}

      {ctx?.error && (
        <p role="alert" className="mx-4 my-3 flex items-start gap-2 rounded-md bg-warning-soft dark:bg-warning/15 px-3 py-2 text-secundario text-warning-soft-foreground">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden /> {ctx.error}
        </p>
      )}

      {ctx && (
        <>
          <Seccion titulo="Entregas sin corregir" abierta extra={ctx.entregas.length > 0 && <span className="text-secundario font-medium tabular-nums text-warning">{ctx.entregas.length}</span>}>
            {ctx.entregas.length === 0 ? (
              <p className="text-secundario text-muted-foreground">Ninguna pendiente.</p>
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {ctx.entregas.map((e) => (
                  <li key={e.tareaId} className="group flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/60">
                    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground">
                      <ClipboardText size={14} weight="bold" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-secundario font-medium text-foreground">{e.tarea}</span>
                      <span className="block truncate text-secundario text-muted-foreground">Entregada el {fechaCorta(e.entregadaAt)}</span>
                    </span>
                    {/* Se corrige en Moodle, en su calificador. */}
                    <a href={e.corregirUrl} target="_blank" rel="noopener noreferrer" aria-label={`Corregir «${e.tarea || 'la tarea'}» en Moodle`}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2 text-secundario font-medium text-foreground hover:bg-muted">
                      Moodle <ArrowSquareOut size={11} aria-hidden />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Cursos">
            {ctx.cursos.length === 0 ? (
              <p className="text-secundario text-muted-foreground">{ctx.error ? '—' : 'No está matriculado en ningún curso.'}</p>
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {ctx.cursos.map((k) => (
                  <li key={k.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60">
                    <span className="min-w-0 flex-1">
                      <a href={k.url} target="_blank" rel="noopener noreferrer" className="block truncate text-secundario font-medium text-foreground hover:text-primary">{k.nombre}</a>
                      <span className="block text-secundario text-muted-foreground">{ultimoAcceso(k.ultimoAcceso)}</span>
                    </span>
                    {puedeEscribir && (
                      <BotonIcono etiqueta={`Insertar el enlace a ${k.nombre} en la respuesta`} onClick={() => alInsertar(k.url)} className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                        <LinkSimple size={14} aria-hidden />
                      </BotonIcono>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Seccion>

          <Seccion titulo="Otras consultas">
            {ctx.anteriores.length === 0 ? (
              <p className="text-secundario text-muted-foreground">Es su primera consulta.</p>
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {ctx.anteriores.map((a) => (
                  <li key={a.id}>
                    <Link to={`/consultas/${a.id}`} className="block rounded-md px-2 py-1.5 hover:bg-muted/60">
                      <span className="flex items-baseline justify-between gap-2 text-secundario">
                        <span className="font-medium text-foreground">{ESTADO[a.estado] || a.estado}</span>
                        <span className="tabular-nums text-muted-foreground">{fechaCorta(a.entradaAt)}</span>
                      </span>
                      <span className="line-clamp-2 text-secundario text-muted-foreground">{a.resumen}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </>
      )}

      <Seccion titulo="Actividad">
        <ol className="relative space-y-2.5 border-l border-border pl-4">
          {c.eventos.map((e, i) => (
            <li key={i} className="relative">
              <span aria-hidden className="absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full border-2 border-card bg-muted-foreground/50" />
              <p className="text-secundario text-foreground">{QUE_PASO[e.tipo] || e.tipo}{e.quien ? <span className="text-muted-foreground"> · {e.quien}</span> : null}</p>
              <p className="text-secundario tabular-nums text-muted-foreground">{fecha(e.at)}</p>
            </li>
          ))}
        </ol>
      </Seccion>
    </div>
  );
}

// ─── Respuestas guardadas ────────────────────────────────────────────────────

function Guardadas({ lista, texto, alElegir, alCrear, alBorrar, alCerrar }: {
  lista: RespuestaGuardada[]; texto: string; alElegir: (t: string) => void;
  alCrear: (titulo: string, texto: string) => Promise<void>; alBorrar: (id: number) => Promise<void>; alCerrar: () => void;
}) {
  const [titulo, setTitulo] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) alCerrar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') alCerrar(); };
    document.addEventListener('mousedown', fuera); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [alCerrar]);
  return (
    <div ref={panel} role="dialog" aria-label="Respuestas guardadas"
      className="absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-lg border border-border bg-card shadow-lg sm:right-auto sm:w-[26rem]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="text-secundario font-semibold text-foreground">Respuestas guardadas</p>
        <p className="text-secundario text-muted-foreground"><code className="rounded bg-muted px-1">{'{nombre}'}</code> = nombre del alumno</p>
      </div>
      <ul className="max-h-64 overflow-y-auto p-1">
        {lista.map((g) => (
          <li key={g.id} className="group flex items-start gap-1 rounded-md hover:bg-muted">
            <button type="button" onClick={() => alElegir(g.texto)} className="min-w-0 flex-1 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="flex items-center gap-1.5 text-secundario font-medium text-foreground">
                {g.titulo}
                {!g.personal && <span className="rounded-full bg-info-soft dark:bg-info/15 px-1.5 py-px text-[10px] font-medium text-info-soft-foreground">Del campus{g.campus ? ` · ${g.campus}` : ''}</span>}
              </span>
              <span className="line-clamp-2 text-secundario text-muted-foreground">{g.texto}</span>
            </button>
            {g.personal && (
              <button type="button" onClick={() => alBorrar(g.id).catch((e) => toast({ title: 'No se ha podido borrar', description: mensajeDeError(e), variant: 'destructive' }))} aria-label={`Borrar «${g.titulo}»`}
                className="mr-1 mt-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100">
                <Trash size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
        {lista.length === 0 && <li className="px-3 py-3 text-secundario text-muted-foreground">No tienes respuestas guardadas.</li>}
      </ul>
      {texto.trim() && (
        <form className="flex gap-1.5 border-t border-border p-2"
          onSubmit={(e) => { e.preventDefault(); if (!titulo.trim()) return; alCrear(titulo.trim(), texto.trim()).then(() => { setTitulo(''); toast({ title: 'Respuesta guardada', description: 'La tienes en cualquier equipo.' }); }, (err) => toast({ title: 'No se ha podido guardar', description: mensajeDeError(err), variant: 'destructive' })); }}>
          <label htmlFor="titulo-guardada" className="sr-only">Nombre de la respuesta</label>
          <input id="titulo-guardada" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Guardar lo escrito como…"
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 text-secundario focus:outline-none focus:ring-2 focus:ring-ring/30" />
          <Button type="submit" size="sm" variant="outline" className="h-8" disabled={!titulo.trim()}>Guardar</Button>
        </form>
      )}
    </div>
  );
}

// ─── Nota interna ────────────────────────────────────────────────────────────

function Nota({ n }: { n: NotaInterna }) {
  return (
    <li className="my-3 flex justify-center">
      <div className="w-full max-w-[92%] rounded-lg border border-warning/40 bg-warning-soft dark:bg-warning/15 px-3.5 py-2.5 sm:max-w-[80%]">
        <p className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-warning-soft-foreground">
          <NotePencil size={12} weight="bold" aria-hidden /> Nota interna · solo personal
          <span className="font-normal normal-case tracking-normal">{n.autor_nombre || 'Alguien del equipo'} · {fecha(n.at)}</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-normal leading-6 text-foreground">{n.texto}</p>
      </div>
    </li>
  );
}

// ─── Chat de grupo (#679, plugin 1.9.0) ──────────────────────────────────────

/**
 * La consulta es un chat de grupo (plugin 1.9.0). Se dice arriba, con las tutoras de dentro:
 *  · 'plugin': el chat del alumno con las tutoras de su curso; todas lo ven y responden desde
 *    Moodle, pero en el CRM la consulta la lleva (y la responde) solo su tutora asignada;
 *  · 'curso' (#285): la conversación de un grupo del curso, que leen TODOS sus alumnos.
 */
function ChatDeGrupo({ participantes, alumno, tipo }: { participantes: ParticipanteChat[]; alumno: string | null; tipo: TipoDeGrupo }) {
  const tutoras = participantes.filter((p) => p.tutora).map((p) => p.nombre || 'Sin nombre');
  const delCurso = tipo === 'curso';
  const quien = delCurso
    ? (tutoras.length ? `tutoras dentro: ${tutoras.join(', ')}` : 'sin ninguna tutora dentro')
    : (tutoras.length
      ? `${tutoras.join(', ')} y ${alumno || 'el alumno'}`
      : `Solo ${alumno || 'el alumno'}: ahora no hay ninguna tutora disponible dentro`);
  return (
    <div role="note" aria-label={delCurso ? 'Conversación de un grupo del curso' : 'Chat de grupo'} data-testid="chat-de-grupo"
      className="flex items-start gap-2 border-b border-border bg-muted/50 px-4 py-1.5 text-secundario text-muted-foreground sm:px-8">
      <UsersThree size={14} weight="bold" className="mt-[3px] shrink-0 text-foreground" aria-hidden />
      <p className="min-w-0 flex-1 break-words">
        <strong className="font-semibold text-foreground">{delCurso ? 'Grupo del curso' : 'Chat de grupo'}</strong>
        {' · '}
        <span>{quien}</span>
        {!delCurso && <span className="hidden sm:inline">{' · '}todas lo ven en Moodle y responden desde allí; desde el CRM, su tutora asignada</span>}
      </p>
    </div>
  );
}

/**
 * Antes de responder en la conversación de un grupo del curso: la respuesta la leen todos
 * sus alumnos, no solo el de la consulta. Obligatorio (revisión de la #689).
 */
function AvisoGrupoDelCurso() {
  return (
    <p role="note" data-testid="aviso-grupo-del-curso"
      className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-md border border-warning/40 bg-warning-soft dark:bg-warning/15 px-3 py-2 text-secundario text-warning-soft-foreground">
      <Warning size={14} weight="fill" className="mt-[2px] shrink-0" aria-hidden />
      <span>
        <strong className="font-semibold">Lo leen todos los alumnos del grupo.</strong>
        {' '}Esta consulta viene de la conversación de un grupo del curso: tu respuesta sale ahí, no en privado.
        Para algo solo de este alumno, escríbele por su chat con las tutoras.
      </span>
    </p>
  );
}

// ─── La página ───────────────────────────────────────────────────────────────

export default function ConsultaPage() {
  const { id } = useParams();
  const consultaId = Number(id);
  const { user } = useAuth() as { user: { userId?: number; id?: number } | null };
  const [c, setC] = useState<ConsultaDetalle | null>(null);
  const [ctx, setCtx] = useState<ContextoConsulta | null>(null);
  const [cargandoCtx, setCargandoCtx] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [faltaTexto, setFaltaTexto] = useState(false);
  const [adjuntos, setAdjuntos] = useState<File[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [tutores, setTutores] = useState<Array<{ id: number; nombre: string }>>([]);
  const [nuevoTutor, setNuevoTutor] = useState<number | null>(null);
  const [verGuardadas, setVerGuardadas] = useState(false);
  const [verFicha, setVerFicha] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const caja = useRef<HTMLTextAreaElement>(null);
  const { lista: guardadas, crear: crearGuardada, borrar: borrarGuardada } = useRespuestas(user?.userId ?? user?.id);
  // Responder al alumno o dejar una nota interna (#679). Administración solo deja notas.
  const [modo, setModo] = useState<'respuesta' | 'nota'>('respuesta');
  const [relevoVisto, setRelevoVisto] = useState(false);
  const cuantos = c?.mensajes.length ?? 0;
  // La consulta que se está viendo: una respuesta que llega tarde (Moodle es lento) de la
  // consulta anterior no se pinta en esta.
  const vigente = useRef(consultaId);
  vigente.current = consultaId;

  // Como en cualquier chat: al abrir y con cada mensaje nuevo, al último.
  useEffect(() => {
    const el = lista.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cuantos, consultaId]);

  const cargar = useCallback(async () => {
    let r;
    try {
      r = await consultasApi.ver(consultaId);
      if (vigente.current !== consultaId) return;
      if (r.success && r.data) { setC(r.data); setError(null); }
    } catch (e) { if (vigente.current === consultaId) setError(mensajeDeError(e)); return; }
    if (r.success && r.data?.puedes === 'admin') {
      try {
        const t = await consultasApi.tutoresPosibles(consultaId);
        if (vigente.current === consultaId && t.success && t.data) setTutores(t.data);
      } catch { setTutores([]); }
    }
  }, [consultaId]);

  const cargarFicha = useCallback(async () => {
    setCargandoCtx(true);
    try {
      const r = await consultasApi.contexto(consultaId);
      if (vigente.current === consultaId) setCtx(r.success && r.data ? r.data : null);
    } catch { if (vigente.current === consultaId) setCtx(null); } finally { if (vigente.current === consultaId) setCargandoCtx(false); }
  }, [consultaId]);

  useEffect(() => { setC(null); setCtx(null); setTexto(''); setAdjuntos([]); cargar(); cargarFicha(); }, [cargar, cargarFicha]);

  function elegirArchivos(nuevosArchivos: FileList | null) {
    const nuevos = [...adjuntos, ...Array.from(nuevosArchivos || [])];
    const grande = nuevos.find((f) => f.size > MAX_MB * 1024 * 1024);
    if (grande) { toast({ title: 'Adjunto demasiado grande', description: `«${grande.name}» pasa de ${MAX_MB} MB.`, variant: 'destructive' }); return; }
    if (nuevos.length > MAX_ADJUNTOS) { toast({ title: 'Demasiados adjuntos', description: `Como mucho ${MAX_ADJUNTOS} por respuesta.`, variant: 'destructive' }); return; }
    setAdjuntos(nuevos);
    if (archivo.current) archivo.current.value = '';
  }

  /** Mete un texto donde está el cursor (o al final) y deja el foco en la caja. */
  function insertar(trozo: string) {
    const el = caja.current;
    const nombre = (c?.alumno_nombre || '').split(/\s+/)[0] || '';
    const t = trozo.replace(/\{nombre\}/g, nombre).trim();
    if (!el) { setTexto((x) => (x ? `${x} ${t}` : t)); return; }
    const ini = el.selectionStart ?? texto.length;
    const fin = el.selectionEnd ?? texto.length;
    const antes = texto.slice(0, ini);
    const sep = antes && !/\s$/.test(antes) ? ' ' : '';
    const nuevo = `${antes}${sep}${t}${texto.slice(fin)}`;
    setTexto(nuevo); setFaltaTexto(false); setVerGuardadas(false);
    requestAnimationFrame(() => { el.focus(); const p = (antes + sep + t).length; el.setSelectionRange(p, p); });
  }

  async function enviar(cerrarDespues = false) {
    if (!texto.trim()) { setFaltaTexto(true); caja.current?.focus(); return; }
    if (modoReal === 'nota') { await guardarNota(); return; }
    setOcupado(true);
    try {
      const r = await consultasApi.responder(consultaId, texto.trim(), adjuntos);
      if (r.success && r.data) {
        if (vigente.current === consultaId) { setTexto(''); setAdjuntos([]); setFaltaTexto(false); }
        if (r.data.enviado) toast({ title: cerrarDespues ? 'Respondida y cerrada' : 'Respuesta enviada', description: 'Le llega al alumno en el campus.' });
        else toast({ title: 'Respuesta guardada, pero no ha llegado al campus', description: r.data.error || '', variant: 'destructive' });
        if (cerrarDespues && r.data.enviado) await consultasApi.cerrar(consultaId);
        await cargar();
      }
    } catch (err) {
      toast({ title: 'No se ha podido responder', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  /** Nota interna: se guarda en el CRM y no sale al campus. */
  async function guardarNota() {
    setOcupado(true);
    try {
      await consultasApi.anotar(consultaId, texto.trim());
      if (vigente.current === consultaId) { setTexto(''); setFaltaTexto(false); }
      toast({ title: 'Nota guardada', description: 'Solo la ve el personal: al alumno no le llega.' });
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha podido guardar la nota', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  /** Reintentar: puede volver a fallar (sin token, campus caído): se dice, no «enviada». */
  async function reintentar(mensajeId: number) {
    setOcupado(true);
    try {
      const r = await consultasApi.reintentar(mensajeId);
      if (r.data?.enviado) toast({ title: 'Respuesta enviada al campus' });
      else toast({ title: 'Sigue sin llegar al campus', description: r.data?.error || 'Inténtalo más tarde.', variant: 'destructive' });
      await cargar();
    } catch (err) {
      toast({ title: 'No se ha podido reintentar', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function hacer(fn: () => Promise<{ success: boolean; data?: unknown }>, hecho: string) {
    setOcupado(true);
    try {
      const r = await fn();
      if (r.success) { toast({ title: hecho }); await cargar(); }
    } catch (err) {
      toast({ title: 'No se ha podido', description: mensajeDeError(err), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  function copiarEnlace() {
    navigator.clipboard?.writeText(window.location.href)
      .then(() => toast({ title: 'Enlace copiado' }), () => toast({ title: 'No se ha podido copiar', variant: 'destructive' }));
  }

  const otrosTutores = useMemo(() => tutores.filter((t) => t.id !== c?.tutor_id), [tutores, c?.tutor_id]);
  const yo = user?.userId ?? user?.id;
  const modoReal: 'respuesta' | 'nota' = c?.puedes === 'admin' ? 'nota' : modo;
  /** ¿Le ha llegado por un relevo automático (su tutora anterior no estaba)? */
  const relevo = useMemo(() => {
    const e = [...(c?.eventos || [])].reverse().find((x) => x.tipo === 'reasignada');
    const d = (e?.detalle || {}) as { a?: number; automatica?: boolean };
    return Boolean(e && d.automatica && yo && Number(d.a) === Number(yo));
  }, [c?.eventos, yo]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl space-y-3 py-6">
        <Link to="/consultas" className="inline-flex items-center gap-1 text-normal font-medium text-primary hover:underline"><ArrowLeft size={14} aria-hidden /> Consultas</Link>
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive-soft dark:bg-destructive/15 p-4">
          <p className="text-normal font-semibold text-foreground">No se ha podido abrir la consulta</p>
          <p className="mt-1 text-secundario text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const puedeEscribir = c?.puedes === 'tutor' && c.estado !== 'cerrada';
  const reasignar = c?.puedes === 'admin' ? (
    <div className="mt-3 space-y-2 border-t border-border pt-3">
      <p className="text-secundario font-medium text-foreground">Reasignar</p>
      <Select<number | null>
        value={nuevoTutor}
        onChange={setNuevoTutor}
        ariaLabel="Reasignar a otro tutor"
        options={[{ value: null, label: otrosTutores.length ? 'Elige el tutor…' : 'No hay otro tutor disponible' },
          ...otrosTutores.map((t) => ({ value: t.id, label: t.nombre }))]}
      />
      <Button size="sm" className="h-8 w-full" disabled={ocupado || !nuevoTutor}
        onClick={() => nuevoTutor && hacer(() => consultasApi.reasignar(consultaId, nuevoTutor), 'Consulta reasignada').then(() => setNuevoTutor(null))}>
        Reasignar
      </Button>
    </div>
  ) : null;

  // Alto fijo a la pantalla también en el móvil: se desplazan los mensajes, no la página,
  // y la caja de respuesta queda siempre abajo, a la vista. De borde a borde en el móvil:
  // deshace el p-3 del contenido de ISEIE (en MultiCRM es p-4, de ahí el -mx-4 de allí).
  return (
    <div className="-mx-3 -mb-3 flex h-[calc(100dvh-5rem)] min-h-[26rem] flex-col sm:mx-0 sm:mb-0 sm:h-[calc(100dvh-6rem)] lg:h-[calc(100dvh-7.5rem)]">
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden border-y border-border bg-card sm:rounded-lg sm:border lg:grid-cols-[18rem_minmax(0,1fr)] xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <Bandeja actual={consultaId} puedes={c?.puedes || 'tutor'} plazoHoras={c?.plazoHoras ?? 24} version={`${c?.estado}-${cuantos}`} />

        <section aria-label={c ? `Conversación con ${c.alumno_nombre || 'el alumno'}` : 'Conversación'} className="flex min-h-0 min-w-0 flex-col">
          {!c ? (
            <>
              <Cabecera><span className="h-8 w-8 animate-pulse rounded-full bg-muted" /><span className="h-4 w-40 animate-pulse rounded bg-muted" /></Cabecera>
              <div className="flex-1 space-y-4 p-6" aria-busy="true" aria-label="Cargando la consulta">
                <div className="h-14 w-2/3 animate-pulse rounded-2xl bg-muted" />
                <div className="ml-auto h-14 w-1/2 animate-pulse rounded-2xl bg-muted" />
              </div>
            </>
          ) : (
            <>
              <Cabecera className="gap-3">
                <Link to="/consultas" aria-label="Volver a Consultas" className="-ml-1 inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden">
                  <ArrowLeft size={16} aria-hidden />
                </Link>
                <Iniciales nombre={c.alumno_nombre} tamano="md" />
                {/* El nombre manda: con la bandeja y la ficha abiertas (1024-1440 px) el plazo baja
                    a la segunda línea, y el nombre nunca se queda sin sitio. */}
                <div className="min-w-[8rem] flex-1">
                  <h1 className="truncate text-normal font-semibold leading-5 text-foreground">{c.alumno_nombre || 'Alumno sin nombre'}</h1>
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-secundario text-muted-foreground">{c.curso_nombre || c.campus}{c.curso_nombre ? ` · ${c.campus}` : ''}</p>
                    <span className="hidden shrink-0 sm:inline-flex 2xl:hidden"><Plazo c={c} plazoHoras={c.plazoHoras} /></span>
                  </div>
                </div>
                <span className="hidden shrink-0 whitespace-nowrap 2xl:inline-flex"><Plazo c={c} plazoHoras={c.plazoHoras} /></span>
                <span aria-hidden className="mx-1 hidden h-5 w-px bg-border 2xl:block" />
                <div className="flex items-center gap-0.5">
                  {ctx?.conversacionUrl && (
                    <BotonIcono etiqueta="Abrir esta conversación en Moodle" href={ctx.conversacionUrl}><ArrowSquareOut size={16} aria-hidden /></BotonIcono>
                  )}
                  <BotonIcono etiqueta="Copiar el enlace a esta consulta" onClick={copiarEnlace} className="hidden sm:inline-grid"><Copy size={16} aria-hidden /></BotonIcono>
                  <BotonIcono etiqueta={verFicha ? 'Ocultar la ficha del alumno' : 'Ver la ficha del alumno'} onClick={() => setVerFicha((v) => !v)} activo={verFicha} className="xl:hidden">
                    <SidebarSimple size={16} aria-hidden />
                  </BotonIcono>
                </div>
                {c.estado !== 'cerrada' && (
                  <Button variant="outline" size="sm" disabled={ocupado} title="Cerrar la consulta" className="ml-1 h-8 px-2.5 text-secundario 2xl:px-3"
                    onClick={() => hacer(() => consultasApi.cerrar(consultaId), 'Consulta cerrada')}>
                    <CheckCircle size={14} weight="bold" className="2xl:mr-1.5" aria-hidden />
                    <span className="hidden 2xl:inline">Cerrar</span><span className="sr-only 2xl:hidden">Cerrar la consulta</span>
                  </Button>
                )}
              </Cabecera>

              {verFicha && (
                <div className="max-h-[55vh] overflow-y-auto border-b border-border xl:hidden">
                  <Ficha c={c} ctx={ctx} cargando={cargandoCtx} alInsertar={insertar} puedeEscribir={puedeEscribir} admin={reasignar} />
                </div>
              )}

              {c.conversacion_grupo_id != null && (
                <ChatDeGrupo participantes={c.participantes || []} alumno={c.alumno_nombre} tipo={c.grupo_tipo ?? 'plugin'} />
              )}

              {/* El relevo solo existe en las consultas privadas de antes: en el chat de grupo lo ven todas. */}
              {relevo && c.conversacion_grupo_id == null && c.puedes === 'tutor' && !relevoVisto && (
                <div role="note" className="flex items-center gap-2 border-b border-border bg-info-soft dark:bg-info/15 px-4 py-1.5 text-secundario text-info-soft-foreground sm:px-8">
                  <ArrowsLeftRight size={14} weight="bold" className="shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate" title="Su tutora anterior no está disponible: lee el historial y las notas internas antes de responder.">
                    <strong className="font-semibold">Relevo:</strong> su tutora anterior no está disponible{(c.notas || []).length ? ' · hay notas internas' : ''}
                  </span>
                  <button type="button" onClick={() => setRelevoVisto(true)} aria-label="Cerrar el aviso del relevo" className="grid h-6 w-6 shrink-0 place-items-center rounded hover:bg-info/10">
                    <X size={12} weight="bold" aria-hidden />
                  </button>
                </div>
              )}

              {/* Los mensajes */}
              <div ref={lista} data-testid="chat-mensajes" className="min-h-[18rem] flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-8">
                {c.mensajes.length === 0 && (
                  <p className="grid h-full place-items-center text-secundario text-muted-foreground">Todavía no hay mensajes en esta conversación.</p>
                )}
                <ol className="flex flex-col" aria-label="Mensajes">
                  {c.mensajes.map((m, i) => {
                    const delTutor = m.autor === 'tutor';
                    const anterior = c.mensajes[i - 1];
                    const notasAntes = (c.notas || []).filter((n) => new Date(n.at) <= new Date(m.escrito_at || 0)
                      && (!anterior || new Date(n.at) > new Date(anterior.escrito_at || 0)));
                    const nuevoDia = !anterior || dia(anterior.escrito_at) !== dia(m.escrito_at);
                    const mismo = (x?: typeof m) => x && x.autor === m.autor && x.autor_nombre === m.autor_nombre;
                    const empiezaGrupo = nuevoDia || !mismo(anterior);
                    const quien = delTutor ? (m.autor_nombre || 'Tutora') : (c.alumno_nombre || 'Alumno');
                    return (
                      <Fragment key={m.id}>
                      {notasAntes.map((n) => <Nota key={`n-${n.id}`} n={n} />)}
                      <li className={cn('flex flex-col', delTutor ? 'items-end' : 'items-start', empiezaGrupo && !nuevoDia ? 'mt-4' : 'mt-1')}>
                        {nuevoDia && (
                          <div className="my-4 flex w-full items-center gap-3" role="separator" aria-label={etiquetaDia(m.escrito_at)}>
                            <span className="h-px flex-1 bg-border" />
                            <span className="text-tabla uppercase text-muted-foreground">{etiquetaDia(m.escrito_at)}</span>
                            <span className="h-px flex-1 bg-border" />
                          </div>
                        )}
                        {empiezaGrupo && (
                          <p className={cn('mb-1 flex items-center gap-2 px-1 text-secundario', delTutor && 'flex-row-reverse')}>
                            <Iniciales nombre={quien} tamano="xs" />
                            <span className="font-medium text-foreground">{quien}</span>
                          </p>
                        )}
                        <div title={fecha(m.escrito_at)}
                          className={cn('max-w-[88%] rounded-2xl px-3.5 py-2 text-normal leading-6 sm:max-w-[75%]',
                            delTutor ? 'bg-primary text-primary-foreground dark:bg-primary/15 dark:text-foreground dark:ring-1 dark:ring-inset dark:ring-primary/30' : 'bg-muted text-foreground',
                            delTutor ? (empiezaGrupo ? 'rounded-tr-md' : '') : (empiezaGrupo ? 'rounded-tl-md' : ''))}>
                          {/* Quién lo escribe, también para el lector de pantalla cuando el nombre no se repite encima. */}
                          {!empiezaGrupo && <span className="sr-only">{quien}: </span>}
                          <p className="whitespace-pre-wrap break-words"><ConEnlaces texto={m.texto} claro={delTutor} /></p>
                          {m.adjuntos.length > 0 && (
                            <ul className="mt-2 flex flex-wrap gap-1.5">
                              {m.adjuntos.map((a) => (
                                <li key={a.id}>
                                  <button type="button" className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-secundario font-medium',
                                    delTutor ? 'bg-primary-foreground/15 text-primary-foreground hover:bg-primary-foreground/25 dark:bg-card dark:text-foreground dark:ring-1 dark:ring-border dark:hover:bg-background' : 'bg-card text-foreground ring-1 ring-border hover:bg-background')}
                                    onClick={() => consultasApi.abrirAdjunto(a).catch((err) => toast({ title: 'No se ha podido abrir', description: mensajeDeError(err), variant: 'destructive' }))}>
                                    <Paperclip size={12} aria-hidden /> {a.nombre}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <span className={cn('-mb-0.5 mt-0.5 flex items-center justify-end gap-1 text-[11px] leading-4 tabular-nums',
                            delTutor ? 'text-primary-foreground/80 dark:text-muted-foreground' : 'text-muted-foreground')}>
                            <time dateTime={m.escrito_at || undefined}>{hora(m.escrito_at)}</time>
                            {delTutor && m.en_el_campus && (
                              <span title="En el campus" className="inline-flex dark:text-primary"><Checks size={13} weight="bold" aria-label="En el campus" /></span>
                            )}
                          </span>
                        </div>
                        {delTutor && !m.en_el_campus && (
                          <div role="alert" className="mt-1 flex max-w-[88%] flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-warning-soft dark:bg-warning/15 px-2.5 py-1.5 text-secundario text-warning-soft-foreground sm:max-w-[75%]">
                            <Warning size={13} weight="fill" className="shrink-0" aria-hidden />
                            <span>No ha llegado al campus{m.error_envio ? `: ${m.error_envio}` : '.'}</span>
                            <button type="button" disabled={ocupado} className="inline-flex items-center gap-1 font-semibold underline-offset-2 hover:underline" onClick={() => reintentar(m.id)}>
                              <ArrowsClockwise size={12} aria-hidden /> Reintentar
                            </button>
                          </div>
                        )}
                      </li>
                      </Fragment>
                    );
                  })}
                  {(c.notas || []).filter((n) => {
                    const ultimo = c.mensajes[c.mensajes.length - 1];
                    return !ultimo || new Date(n.at) > new Date(ultimo.escrito_at || 0);
                  }).map((n) => <Nota key={`n-${n.id}`} n={n} />)}
                </ol>
              </div>

              {c.puedes === 'tutor' && c.estado === 'cerrada' && (
                <div className="flex items-center justify-center gap-2 border-t border-border px-5 py-3.5 text-secundario text-muted-foreground">
                  <CheckCircle size={14} weight="fill" className="text-success" aria-hidden />
                  Consulta cerrada. Si el alumno vuelve a escribir, se reabre sola.
                </div>
              )}

              {(puedeEscribir || c.puedes === 'admin') && (
                <form onSubmit={(e) => { e.preventDefault(); enviar(false); }} noValidate className="relative border-t border-border p-3 sm:px-8 sm:py-4">
                  {c.grupo_tipo === 'curso' && modoReal !== 'nota' && <AvisoGrupoDelCurso />}
                  {verGuardadas && (
                    <Guardadas lista={guardadas} texto={texto} alElegir={insertar} alCrear={crearGuardada} alBorrar={borrarGuardada} alCerrar={() => setVerGuardadas(false)} />
                  )}
                  <div className={cn('mx-auto max-w-3xl rounded-lg border shadow-sm transition-shadow focus-within:ring-2',
                    modoReal === 'nota' ? 'border-warning/50 bg-warning-soft/40 focus-within:ring-warning/20 dark:border-warning/30 dark:bg-warning/[0.06]' : 'bg-background focus-within:border-ring focus-within:ring-ring/20',
                    faltaTexto ? 'border-destructive' : (modoReal === 'nota' ? '' : 'border-input'))}>
                    <label htmlFor="consulta-respuesta" className="sr-only">{modoReal === 'nota' ? 'Tu nota interna' : 'Tu respuesta'}</label>
                    <textarea id="consulta-respuesta" ref={caja} value={texto}
                      onChange={(e) => { setTexto(e.target.value); if (e.target.value.trim()) setFaltaTexto(false); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); enviar(e.shiftKey); } }}
                      rows={Math.min(8, Math.max(2, texto.split('\n').length + 1))} maxLength={20000}
                      placeholder={modoReal === 'nota'
                        ? 'Nota para el equipo (relevo, coordinación). El alumno no la ve.'
                        : `Responder a ${(c.alumno_nombre || 'el alumno').split(/\s+/)[0]}…`}
                      aria-invalid={faltaTexto || undefined} aria-describedby={faltaTexto ? 'consulta-respuesta-error' : undefined}
                      className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3.5 pb-1 pt-3 text-normal leading-6 text-foreground placeholder:text-muted-foreground focus:outline-none" />
                    {adjuntos.length > 0 && (
                      <ul className="flex flex-wrap gap-1.5 px-3 pb-1" aria-label="Adjuntos">
                        {adjuntos.map((f, i) => (
                          <li key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted px-2 py-1 text-secundario text-foreground">
                            <Paperclip size={12} className="shrink-0" aria-hidden /> <span className="truncate">{f.name}</span>
                            <button type="button" aria-label={`Quitar ${f.name}`} onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))}
                              className="ml-0.5 shrink-0 rounded text-muted-foreground hover:text-destructive"><X size={12} weight="bold" aria-hidden /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="flex items-center gap-0.5 px-2 pb-2">
                      {puedeEscribir ? (
                        <button type="button" aria-pressed={modoReal === 'nota'} onClick={() => setModo(modoReal === 'nota' ? 'respuesta' : 'nota')}
                          title={modoReal === 'nota' ? 'Volver a responder al alumno' : 'Escribir una nota interna (el alumno no la ve)'}
                          className={cn('inline-flex h-8 items-center gap-1 rounded-md px-2 text-secundario font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            modoReal === 'nota' ? 'bg-warning-soft dark:bg-warning/15 text-warning-soft-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                          <NotePencil size={16} aria-hidden />
                          <span className={cn(modoReal === 'nota' ? 'inline' : 'sr-only')}>Nota interna</span>
                        </button>
                      ) : (
                        <span className="inline-flex h-8 items-center gap-1 px-2 text-secundario font-medium text-warning-soft-foreground"><NotePencil size={16} aria-hidden /> Nota interna</span>
                      )}
                      {modoReal === 'respuesta' && <>
                      <BotonIcono etiqueta="Respuestas guardadas" onClick={() => setVerGuardadas((v) => !v)} activo={verGuardadas}><BookmarkSimple size={16} aria-hidden /></BotonIcono>
                      <input ref={archivo} type="file" multiple className="peer sr-only" id="consulta-adjuntos"
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
                        onChange={(e) => elegirArchivos(e.target.files)} />
                      <label htmlFor="consulta-adjuntos" title={`Adjuntar · PDF, imágenes, Word, Excel o texto · hasta ${MAX_MB} MB · ${MAX_ADJUNTOS} como mucho`}
                        className="inline-grid h-8 w-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring">
                        <Paperclip size={16} aria-hidden /><span className="sr-only">Adjuntar archivos</span>
                      </label>
                      {ctx?.cursos[0] && (
                        <BotonIcono etiqueta={`Insertar el enlace al curso (${ctx.cursos[0].nombre})`} onClick={() => insertar(ctx.cursos[0].url)}><LinkSimple size={16} aria-hidden /></BotonIcono>
                      )}
                      </>}
                      <span className="ml-auto hidden whitespace-nowrap pr-2 text-secundario text-muted-foreground 2xl:inline">
                        <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px]">Ctrl</kbd> <kbd className="rounded border border-border bg-muted px-1 font-sans text-[10px]">Intro</kbd> envía
                      </span>
                      {modoReal === 'respuesta' && (
                        <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => enviar(true)} className="ml-auto h-8 px-2.5 text-secundario md:ml-0 lg:hidden 2xl:inline-flex" title="Enviar y cerrar (Ctrl + Mayús + Intro)">
                          Enviar y cerrar
                        </Button>
                      )}
                      <Button type="submit" size="sm" disabled={ocupado} className={cn('h-8 px-3 text-secundario', modoReal === 'nota' ? 'ml-auto md:ml-0' : 'lg:ml-auto 2xl:ml-0')}>
                        {modoReal === 'nota'
                          ? <><NotePencil size={14} weight="bold" className="mr-1.5" aria-hidden /> {ocupado ? 'Guardando…' : 'Guardar nota'}</>
                          : <><PaperPlaneRight size={14} weight="fill" className="mr-1.5" aria-hidden /> {ocupado ? 'Enviando…' : 'Enviar'}</>}
                      </Button>
                    </div>
                  </div>
                  {faltaTexto && (
                    <p id="consulta-respuesta-error" className="mx-auto mt-1.5 max-w-3xl text-secundario font-medium text-destructive">Falta la respuesta: escríbela aquí.</p>
                  )}
                </form>
              )}
            </>
          )}
        </section>

        <aside aria-label="Ficha del alumno" className="hidden min-h-0 flex-col border-l border-border bg-card xl:flex">
          <Cabecera>
            <IdentificationCard size={16} className="text-muted-foreground" aria-hidden />
            <h2 className="flex-1 text-normal font-semibold text-foreground">Ficha del alumno</h2>
            {ctx?.perfilUrl && <BotonIcono etiqueta="Abrir su perfil en Moodle" href={ctx.perfilUrl}><ArrowSquareOut size={16} aria-hidden /></BotonIcono>}
          </Cabecera>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {c && <Ficha c={c} ctx={ctx} cargando={cargandoCtx} alInsertar={insertar} puedeEscribir={puedeEscribir} admin={reasignar} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
