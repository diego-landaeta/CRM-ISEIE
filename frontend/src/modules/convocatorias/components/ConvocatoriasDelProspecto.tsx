import { useCallback, useEffect, useState } from 'react';
import { GraduationCap, WarningCircle, CheckCircle, Plus, X } from '@phosphor-icons/react';
// En ISEIE no hay `shared/lib/fechas`: el mismo `formatFecha` —que lee
// «2026-09-16» como día del calendario y no como medianoche UTC— vive aquí.
import { formatFecha } from '@/modules/leads/lib/leadFormat';
// Los nombres de los canales ya estan escritos una vez, en el proceso.
import { nombreDeCanal } from '@/modules/proceso/lib/canales';
import {
  traerConvocatorias, traerOfrecimientosDeLead, ofrecer, actualizarOfrecimiento,
  type Convocatoria, type Ofrecimiento, type ResultadoOfrecimiento,
} from '../api/convocatorias.api';
import {
  estadoDeSolicitud, TEXTO_SOLICITUD, TEXTO_RESULTADO, tonoDelResultado,
  textoDeLaVentana, pasaDelTope,
} from '../lib/ofrecimiento';

/**
 * Las becas de esta persona, en su ficha (#86).
 *
 * La convocatoria es la campaña; el ofrecimiento es lo que le pasó a ESTA
 * persona con ella. Aquí se ofrece y se anota lo que va pasando: si llenó la
 * solicitud, cuánto descuento se le dio y en qué quedó.
 *
 * LO QUE NO SE TECLEA AQUÍ
 * ------------------------
 * «Si compró» no se guarda: se deduce de sus ventas posteriores al
 * ofrecimiento. Un dato copiado que hay que mantener a mano acaba
 * contradiciendo al original.
 *
 * El aviso de que un descuento pasa del tope lo escribe el servidor. No
 * bloquea, avisa: bloquear un descuento autorizado a mano lleva a no
 * registrarlo, y eso es perder el dato.
 */

// Los canales por los que se ofrece una beca son los del proceso más dos que
// solo existen aquí: una beca se ofrece también en persona. `nombreDeCanal` no
// los conoce y devolvería la clave en minúscula, así que se nombran aquí.
const CANALES = ['llamada', 'whatsapp', 'email', 'presencial', 'otro'] as const;
const SOLO_DE_BECAS: Record<string, string> = { presencial: 'En persona', otro: 'Otro' };
const textoDeCanal = (c: string) => SOLO_DE_BECAS[c] ?? nombreDeCanal(c);
const RESULTADOS: ResultadoOfrecimiento[] = ['pendiente', 'concedida', 'denegada', 'caducada'];

const fecha = (iso: string) => formatFecha(iso) ?? iso;

const campo = 'h-8 rounded-md border border-border bg-card px-2 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/40';
const boton = 'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40';

function Pastilla({ tono, children }: { tono: 'success' | 'destructive' | 'muted' | 'info' | 'warning'; children: React.ReactNode }) {
  const clases = {
    success: 'bg-success-soft text-success-soft-foreground',
    destructive: 'bg-destructive-soft text-destructive-soft-foreground',
    warning: 'bg-warning-soft text-warning-soft-foreground',
    info: 'bg-info-soft text-info-soft-foreground',
    muted: 'bg-muted text-muted-foreground',
  }[tono];
  return <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${clases}`}>{children}</span>;
}

export default function ConvocatoriasDelProspecto({
  leadId,
  projectId,
}: {
  leadId: number;
  projectId?: number | null;
}) {
  const [ofrecimientos, setOfrecimientos] = useState<Ofrecimiento[] | null>(null);
  const [campanas, setCampanas] = useState<Convocatoria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [nueva, setNueva] = useState({ convocatoriaId: '', canal: 'whatsapp', fecha_limite: '', fecha_resultado: '', nota: '' });
  /** Lo que el servidor contestó al último guardado, por ofrecimiento. */
  const [avisos, setAvisos] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    setOfrecimientos(await traerOfrecimientosDeLead(leadId).catch(() => []));
  }, [leadId]);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      traerOfrecimientosDeLead(leadId).catch(() => []),
      traerConvocatorias({ projectId }).catch(() => []),
    ]).then(([o, c]) => {
      if (!vivo) return;
      setOfrecimientos(o);
      setCampanas(c);
    }).finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [leadId, projectId]);

  const conRecarga = async (accion: () => Promise<unknown>, queFallo: string) => {
    setOcupado(true);
    setFallo(null);
    try {
      const r = await accion();
      const aviso = (r as Ofrecimiento | null)?.aviso;
      const id = (r as Ofrecimiento | null)?.id;
      if (id) setAvisos((a) => ({ ...a, [id]: aviso || '' }));
      await cargar();
      return true;
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string };
      setFallo(err?.status === 403 ? 'No tienes permiso para esto.' : (err?.message || queFallo));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  if (cargando) return null;

  const activas = campanas.filter((c) => c.activa);
  // Sin campañas y sin nada ofrecido no hay nada que enseñar: una tarjeta vacía
  // en cada ficha del CRM es ruido en todas para servir en ninguna.
  if (activas.length === 0 && (!ofrecimientos || ofrecimientos.length === 0)) return null;

  async function enviarOfrecimiento() {
    const id = Number(nueva.convocatoriaId);
    if (!id) { setFallo('Elige la convocatoria.'); return; }
    const bien = await conRecarga(() => ofrecer(id, {
      leadId,
      canal: nueva.canal,
      fecha_limite: nueva.fecha_limite || undefined,
      fecha_resultado: nueva.fecha_resultado || undefined,
      nota: nueva.nota.trim() || undefined,
    }), 'No se ha podido registrar.');
    if (bien) {
      setAbriendo(false);
      setNueva({ convocatoriaId: '', canal: 'whatsapp', fecha_limite: '', fecha_resultado: '', nota: '' });
    }
  }

  return (
    <section aria-label="Becas y convocatorias" className="bg-card border border-border rounded-xl p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <GraduationCap size={16} weight="duotone" className="text-primary" />
          Becas y convocatorias
        </h3>
        {activas.length > 0 && !abriendo && (
          <button type="button" className={boton} onClick={() => { setAbriendo(true); setFallo(null); }}>
            <Plus size={11} weight="bold" /> Ofrecer una
          </button>
        )}
      </div>

      {abriendo && (
        <div className="mb-3 rounded-lg border border-border bg-muted/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Ofrecerle una beca</p>
            <button type="button" aria-label="Cerrar" className="text-muted-foreground hover:text-foreground" onClick={() => setAbriendo(false)}>
              <X size={12} weight="bold" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Convocatoria</span>
              <select className={campo} value={nueva.convocatoriaId}
                onChange={(e) => setNueva((n) => ({ ...n, convocatoriaId: e.target.value }))}>
                <option value="">— Elige —</option>
                {activas.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Por dónde</span>
              <select className={campo} value={nueva.canal}
                onChange={(e) => setNueva((n) => ({ ...n, canal: e.target.value }))}>
                {CANALES.map((c) => <option key={c} value={c}>{textoDeCanal(c)}</option>)}
              </select>
            </label>
            <span />
            {/* Las dos fechas son lo que se le promete. Van juntas: decirle
                hasta cuándo puede pedirla sin decirle cuándo se le contesta es
                la mitad del trato, y la mitad que genera la llamada de
                «¿se sabe algo?». */}
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Puede pedirla hasta</span>
              <input type="date" className={campo} value={nueva.fecha_limite}
                onChange={(e) => setNueva((n) => ({ ...n, fecha_limite: e.target.value }))} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Le contestamos el</span>
              <input type="date" className={campo} value={nueva.fecha_resultado}
                onChange={(e) => setNueva((n) => ({ ...n, fecha_resultado: e.target.value }))} />
            </label>
            <label className="col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Nota</span>
              <input type="text" className={campo} value={nueva.nota} placeholder="Lo que se le dijo"
                onChange={(e) => setNueva((n) => ({ ...n, nota: e.target.value }))} />
            </label>
          </div>
          <button type="button" disabled={ocupado} onClick={enviarOfrecimiento}
            className="mt-2 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/40">
            {ocupado ? 'Guardando…' : 'Registrar el ofrecimiento'}
          </button>
        </div>
      )}

      {fallo && <p className="mb-2 text-[11px] text-destructive">{fallo}</p>}

      {(!ofrecimientos || ofrecimientos.length === 0) ? (
        <p className="text-[12px] text-muted-foreground">Todavía no se le ha ofrecido ninguna.</p>
      ) : (
        <ul className="space-y-2.5">
          {ofrecimientos.map((o) => (
            <FilaDeOfrecimiento
              key={o.id}
              ofrecimiento={o}
              aviso={avisos[o.id]}
              ocupado={ocupado}
              onGuardar={(datos) => conRecarga(
                () => actualizarOfrecimiento(o.id, datos),
                'No se ha podido guardar.',
              )}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function FilaDeOfrecimiento({
  ofrecimiento: o,
  aviso,
  ocupado,
  onGuardar,
}: {
  ofrecimiento: Ofrecimiento;
  aviso?: string;
  ocupado: boolean;
  onGuardar: (datos: Parameters<typeof actualizarOfrecimiento>[1]) => Promise<boolean>;
}) {
  const [descuento, setDescuento] = useState(o.descuento == null ? '' : String(o.descuento));
  const solicitud = estadoDeSolicitud(o);
  const n = descuento === '' ? null : Number(descuento);
  const alto = pasaDelTope(n, o);
  const ventana = textoDeLaVentana(o, fecha);

  return (
    <li className="rounded-lg border border-border p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] font-semibold">{o.convocatoria || 'Convocatoria'}</span>
        <Pastilla tono={tonoDelResultado(o.resultado)}>{TEXTO_RESULTADO[o.resultado]}</Pastilla>
        {o.compro && (
          <Pastilla tono="success"><CheckCircle size={11} weight="fill" /> Compró después</Pastilla>
        )}
        {o.debe_respuesta && (
          <Pastilla tono="warning"><WarningCircle size={11} weight="fill" /> Le debemos respuesta</Pastilla>
        )}
      </div>

      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Ofrecida el {fecha(o.ofrecida_at)}
        {o.canal ? ` por ${textoDeCanal(o.canal)}` : ''}
        {o.ofrecida_por_nombre ? ` · ${o.ofrecida_por_nombre}` : ''}
      </p>
      {ventana && <p className="text-[11px] text-muted-foreground">Le dijimos: {ventana}</p>}
      {o.nota && <p className="mt-1 text-[11px] text-muted-foreground">{o.nota}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
        {/* «Sin preguntar» no es un botón: el servidor no puede volver a
            dejarlo en blanco, y ofrecer algo que no se puede deshacer como si
            se pudiera es peor que no ofrecerlo. Es el estado de partida. */}
        <span className="text-[11px] text-muted-foreground">¿Llenó la solicitud?</span>
        {/* La respuesta elegida NO se deshabilita. Un botón deshabilitado se
            pinta a media tinta, y entonces la que está marcada se ve más
            apagada que la otra: exactamente al revés de lo que dice. Se marca
            con `aria-pressed` y con color entero, y volver a pulsarla no manda
            nada. */}
        <button type="button" disabled={ocupado} aria-pressed={solicitud === 'llenada'}
          onClick={() => { if (solicitud !== 'llenada') onGuardar({ solicitud_llenada: true }); }}
          className={`${boton} ${solicitud === 'llenada' ? 'border-success bg-success-soft text-success-soft-foreground' : ''}`}>
          Sí
        </button>
        <button type="button" disabled={ocupado} aria-pressed={solicitud === 'no_llenada'}
          onClick={() => { if (solicitud !== 'no_llenada') onGuardar({ solicitud_llenada: false }); }}
          className={`${boton} ${solicitud === 'no_llenada' ? 'border-destructive bg-destructive-soft text-destructive-soft-foreground' : ''}`}>
          No
        </button>
        {solicitud === 'sin_saber' && (
          <span className="text-[11px] italic text-muted-foreground">{TEXTO_SOLICITUD.sin_saber}</span>
        )}
        {o.solicitud_at && solicitud === 'llenada' && (
          <span className="text-[11px] text-muted-foreground">el {fecha(o.solicitud_at)}</span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">Descuento</span>
          <input
            type="number" min={0} max={100} step="0.5" inputMode="decimal"
            value={descuento}
            onChange={(e) => setDescuento(e.target.value)}
            aria-label="Descuento concedido, en porcentaje"
            className={`${campo} w-20 ${alto ? 'border-warning' : ''}`}
          />
          <span className="text-[11px] text-muted-foreground">%</span>
        </label>
        <button type="button" disabled={ocupado || descuento === '' || n == null || Number.isNaN(n)}
          className={boton}
          onClick={() => onGuardar({ descuento: Number(descuento) })}>
          Guardar
        </button>

        <label className="ml-auto flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground">En qué quedó</span>
          <select
            className={`${campo} w-32`} value={o.resultado} disabled={ocupado}
            aria-label="Resultado de la beca"
            onChange={(e) => onGuardar({ resultado: e.target.value as ResultadoOfrecimiento })}
          >
            {RESULTADOS.map((r) => <option key={r} value={r}>{TEXTO_RESULTADO[r]}</option>)}
          </select>
        </label>
      </div>

      {/* Los topes se enseñan siempre, no solo cuando ya se ha pasado: saber
          hasta dónde se puede llegar ANTES de escribir el número evita la
          mitad de los avisos. */}
      {(o.tope_nueva != null || o.tope_habilitada != null) && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Topes: {o.tope_nueva} % formación nueva · {o.tope_habilitada} % si ya está habilitada.
        </p>
      )}
      {aviso && (
        <p className="mt-1 rounded bg-warning-soft px-2 py-1 text-[11px] font-medium text-warning-soft-foreground">
          {aviso}
        </p>
      )}
    </li>
  );
}
