/*
  Seguimiento y tiempos.

  Dos preguntas que se parecen y no son la misma, y por eso van en dos bloques:

    LA COHORTE    de los que ENTRARON en el periodo: a cuántos se les hizo
                  seguimiento, cuánto se tardó en tocarles y cuánto en
                  venderles. Sigue a las MISMAS personas de principio a fin,
                  así que los porcentajes y los tiempos significan algo.

    LA ACTIVIDAD  lo que se hizo DURANTE el periodo, entrara quien entrara. Es
                  el trabajo del mes, no el resultado de una cohorte.

  Un panel que las mezcla dice «60 % contactados» y nadie sabe si es de los que
  entraron o de los que se tocaron.

  Vive en `shared/` porque los dos CRMs enseñan exactamente el mismo bloque.
*/
import { useEffect, useState } from 'react';
import { UserFocus, Clock, Handshake, ChatCircleText, Phone, EnvelopeSimple, NotePencil } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';

/** Un hueco de tiempo dicho como lo diría una persona. */
function comoSeDice(segundos) {
  if (segundos == null) return null;
  const s = Number(segundos);
  if (!Number.isFinite(s)) return null;
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) {
    const h = s / 3600;
    return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  }
  const d = s / 86400;
  return `${d < 10 ? d.toFixed(1) : Math.round(d)} días`;
}

function dias(n) {
  if (n == null) return null;
  const d = Number(n);
  if (!Number.isFinite(d)) return null;
  // Medio día no se dice «0,5 días»: se dice «el mismo día».
  if (d < 1) return 'el mismo día';
  if (d < 2) return '1 día';
  return `${d < 10 ? d.toFixed(1).replace('.0', '') : Math.round(d)} días`;
}

function Dato({ icon: Icon, titulo, valor, pie }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {Icon && <Icon size={13} />} {titulo}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {pie && <div className="mt-0.5 text-[11px] text-muted-foreground">{pie}</div>}
    </div>
  );
}

export default function PanelSeguimiento({ projectId, issuerId, from, to }) {
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    const q = new URLSearchParams();
    ponerAmbito(q, { activeIssuerId: issuerId, activeProject: { id: projectId } });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    client.get(`/informes/seguimiento?${q.toString()}`)
      .then((r) => { if (vivo) setDatos(r?.success ? r.data : null); })
      .catch(() => { if (vivo) setDatos(null); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [projectId, issuerId, from, to]);

  if (cargando) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="h-4 w-40 rounded bg-muted animate-pulse" />
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-muted animate-pulse" />)}
        </div>
      </div>
    );
  }
  if (!datos) return null;

  const c = datos.cohorte || {};
  const a = datos.actividad || {};
  const t = a.por_tipo || {};
  const sinTocar = Math.max(0, Number(c.entraron || 0) - Number(c.con_seguimiento || 0));

  const primerContacto = comoSeDice(c.mediana_primer_contacto_seg);
  const hastaVenta = dias(c.mediana_dias_venta);

  const embudo = datos.embudo || c.embudo || [];

  const CANALES = [
    { k: 'whatsapp', label: 'WhatsApp', icon: ChatCircleText },
    { k: 'llamada', label: 'llamadas', icon: Phone },
    { k: 'email', label: 'correos', icon: EnvelopeSimple },
    { k: 'nota', label: 'notas', icon: NotePencil },
  ].filter((x) => Number(t[x.k] || 0) > 0);

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <UserFocus size={16} /> Seguimiento y tiempos
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          De los <strong className="text-foreground">{c.entraron}</strong> prospectos que{' '}
          <strong className="text-foreground">entraron</strong> en el periodo — se les sigue a ellos, no a los
          que se tocaron. Los tiempos son la <strong className="text-foreground">mediana</strong>: la media la
          rompe un solo lead viejo contactado ayer.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato
          icon={UserFocus}
          titulo="Con seguimiento"
          valor={`${c.pct_con_seguimiento}%`}
          pie={`${c.con_seguimiento} de ${c.entraron}${sinTocar > 0 ? ` · ${sinTocar} sin tocar` : ''}`}
        />
        <Dato
          icon={Clock}
          titulo="Hasta el 1er contacto"
          valor={primerContacto || '—'}
          pie={primerContacto ? 'sin contar notas internas' : 'nadie contactado todavía'}
        />
        <Dato
          icon={Handshake}
          titulo="Compraron"
          valor={`${c.pct_compraron}%`}
          pie={`${c.compraron} de ${c.entraron}`}
        />
        <Dato
          icon={Clock}
          titulo="Hasta la venta"
          valor={hastaVenta || '—'}
          pie={hastaVenta ? 'desde que entró la persona' : 'sin ventas de esta entrada'}
        />
      </div>

      {/* El embudo por numero de seguimiento. Es lo que convierte «99 % con
          seguimiento» en algo accionable: enseña DONDE se cae la gente. */}
      {embudo.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Hasta qué seguimiento llega cada uno
          </p>
          <div className="mt-2 space-y-1">
            {embudo.map((f) => {
              const ancho = c.entraron > 0 ? Math.max(2, (f.personas * 100) / c.entraron) : 0;
              return (
                <div key={f.nivel} className="flex items-center gap-2 text-[11px]">
                  <span className="w-14 shrink-0 font-semibold tabular-nums">{f.nivel}.º</span>
                  <span className="w-12 shrink-0 text-right tabular-nums font-semibold">{f.personas}</span>
                  <span className="h-3 min-w-0 flex-1 rounded-sm bg-muted overflow-hidden">
                    <span className="block h-full rounded-sm bg-primary/70" style={{ width: `${ancho}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{f.pct}%</span>
                  <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                    {f.compraron} compraron
                  </span>
                  <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{f.tasa}%</span>
                  <span className="w-20 shrink-0 text-right tabular-nums text-muted-foreground">
                    {comoSeDice(f.mediana_desde_anterior_seg) || '—'}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Cuántos llegaron a cada contacto, cuántos de ellos compraron, y cuánto se tardó desde el anterior
            (desde que entró, en el primero). Es <strong className="text-foreground">acumulativo</strong>: quien
            llega al 3.º está contado también en el 1.º y el 2.º — por eso la columna de compras baja sola.
          </p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            El número sale del <strong className="text-foreground">orden</strong> de los contactos, no del paso
            comercial: hoy el CRM no guarda a qué paso corresponde cada toque.
          </p>
        </div>
      )}

      {/* La actividad es OTRA pregunta: lo que se hizo, entrara quien entrara.
          Va debajo y dicho aparte para que no se lea como parte de la cohorte. */}
      <div className="rounded-lg border border-dashed border-border p-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Trabajo hecho en el periodo
        </p>
        <p className="mt-1 text-normal">
          <strong className="tabular-nums">{a.toques}</strong> contactos a{' '}
          <strong className="tabular-nums">{a.personas}</strong>{' '}
          {a.personas === 1 ? 'persona' : 'personas'}
          {a.personas > 0 && (
            <span className="text-muted-foreground">
              {' '}· <strong className="text-foreground tabular-nums">{a.toques_por_persona}</strong> por persona
            </span>
          )}
        </p>
        {CANALES.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {CANALES.map(({ k, label, icon: Icon }) => (
              <span key={k} className="inline-flex items-center gap-1">
                <Icon size={12} />
                <strong className="text-foreground tabular-nums">{t[k]}</strong> {label}
              </span>
            ))}
          </p>
        )}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Cuenta a cualquiera que se tocara en estas fechas, entrara cuando entrara — por eso puede ser más
          gente que la de arriba.
        </p>
      </div>
    </div>
  );
}
