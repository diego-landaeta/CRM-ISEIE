import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import RangoRapido from '@/shared/components/ui/RangoRapido';
import { useProjectContext } from '@/contexts/ProjectContext';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';
import { rangoPorDefecto } from '@/shared/lib/rangosDeFecha';
import {
  traerPanel, traerLista, type PanelFeedback, type FilaFeedback,
} from '../api/feedback.api';

/**
 * El panel de feedback (#170): qué contestan los que no compran.
 *
 * Arriba, antes que los motivos, lo que pidió Diego el 28/09: CUÁNTOS ENVIADOS
 * y CUÁNTOS RESPONDIDOS. Sin esos dos, «40 dijeron precio» no dice nada.
 *
 * Cada número abre las personas que tiene detrás. Saber que hubo 40 no ayuda si
 * no se puede ver a quién.
 *
 * «No me contestaron a tiempo» va aparte y junto a cada gestora: es el único
 * motivo que depende de nosotros, y si aparece el arreglo no es de marketing,
 * es de la cola del día.
 */

type Detalle = { titulo: string; params: Record<string, string> };

const pct = (a: number, b: number) => (b ? `${Math.round((a * 1000) / b) / 10} %` : '—');
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString('es-ES') : '—');
const MES = (m: string) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};

export default function FeedbackPanelPage() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null } | null; activeIssuerId: number | null;
  };
  const [rango, setRango] = useState(() => rangoPorDefecto());
  const [datos, setDatos] = useState<PanelFeedback | null>(null);
  const [cargando, setCargando] = useState(true);
  const [pestaña, setPestaña] = useState<'campus' | 'gestora' | 'disparador'>('gestora');
  const [detalle, setDetalle] = useState<Detalle | null>(null);

  // El ámbito y las fechas, en un solo sitio: el panel y su lista piden lo mismo.
  const base = useMemo(() => {
    const p = ponerAmbito(new URLSearchParams(), { activeIssuerId, activeProject });
    if (rango.from) p.set('desde', rango.from);
    if (rango.to) p.set('hasta', rango.to);
    return p;
  }, [activeIssuerId, activeProject?.id, rango.from, rango.to]);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    traerPanel(base)
      .then((d) => { if (vivo) setDatos(d); })
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [base]);

  const t = datos?.totales;
  const textoMotivo = (clave: string | null) =>
    datos?.motivos.find((m) => m.clave === clave)?.texto || clave || '—';
  const totalRespuestas = (datos?.porMotivo || []).reduce((s, m) => s + m.n, 0);
  const abrir = (titulo: string, params: Record<string, string>) => setDetalle({ titulo, params });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Feedback"
        subtitle="Por qué no compran: lo que contestan al correo de «¿por qué has desistido?»"
        actions={<RangoRapido valor={rango} alElegir={(r) => setRango(r)} />}
      />

      {/* ── Enviados · respondidos · % ─────────────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="Envíos y respuestas">
        <Cifra etiqueta="Enviados" valor={t?.enviados} cargando={cargando}
          onClick={() => abrir('Enviados', { que: 'enviados' })} />
        <Cifra etiqueta="Respondidos" valor={t?.respondidos} cargando={cargando}
          onClick={() => abrir('Respondidos', { que: 'respondidos' })} />
        <Cifra etiqueta="Tasa de respuesta" valor={t ? `${t.tasa} %` : undefined} cargando={cargando} />
      </section>
      {t && (t.en_revision + t.bloqueados + t.sin_correo + t.fallidos) > 0 && (
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>No salieron y no cuentan como enviados:</span>
          {t.en_revision > 0 && <BotonTexto onClick={() => abrir('Esperando revisión', { que: 'revision' })}>{t.en_revision} esperando revisión</BotonTexto>}
          {t.bloqueados > 0 && <BotonTexto onClick={() => abrir('Parados por el freno de pruebas', { que: 'bloqueados' })}>{t.bloqueados} parados por el freno de pruebas</BotonTexto>}
          {t.sin_correo > 0 && <BotonTexto onClick={() => abrir('Sin correo', { que: 'sin_correo' })}>{t.sin_correo} sin correo</BotonTexto>}
          {t.fallidos > 0 && <BotonTexto onClick={() => abrir('Fallidos', { que: 'fallidos' })}>{t.fallidos} fallidos</BotonTexto>}
        </p>
      )}

      {/* ── Por qué no compran ─────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Por qué no compran</h2>
        {!cargando && totalRespuestas === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Todavía no ha contestado nadie en estas fechas.</p>
        )}
        <ul className="mt-3 space-y-2">
          {(datos?.porMotivo || []).map((m) => (
            <li key={m.clave}>
              <button type="button" onClick={() => abrir(textoMotivo(m.clave), { que: 'respondidos', motivo: m.clave })}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/60 focus:outline-none focus:ring-2 focus:ring-ring/40">
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  <span className={m.clave === 'sin_respuesta' ? 'font-semibold text-warning-soft-foreground' : ''}>
                    {textoMotivo(m.clave)}
                    {m.clave === 'sin_respuesta' && <span className="ml-2 text-xs font-normal">· depende de nosotros</span>}
                  </span>
                  <span className="tabular-nums text-muted-foreground">{m.n} · {pct(m.n, totalRespuestas)}</span>
                </span>
                <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary"
                    style={{ width: `${totalRespuestas ? (m.n * 100) / totalRespuestas : 0}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Pregunta a pregunta ────────────────────────────────────── */}
      {(datos?.preguntas || []).some((p) => (p.clave !== 'motivo' && p.respondieron > 0) || (p.escritos || []).length > 0) && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Lo que contestaron, pregunta a pregunta</h2>
          <div className="mt-3 grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* El motivo ya tiene sus barras arriba: aquí solo lo que escribieron en «Otro motivo». */}
            {datos!.preguntas.filter((p) => p.clave !== 'motivo' || (p.escritos || []).length > 0).map((p) => (
              <div key={p.clave} className={p.tipo === 'texto' || p.clave === 'motivo' ? 'lg:col-span-2' : ''}>
                <h3 className="text-sm font-semibold">{p.clave === 'motivo' ? 'Lo que escribieron en «Otro motivo»' : p.texto}</h3>
                <p className="text-xs text-muted-foreground">
                  {p.clave === 'motivo'
                    ? `${p.escritos!.length} de ${p.respondieron} ${p.respondieron === 1 ? 'respuesta' : 'respuestas'}`
                    : `${p.respondieron} ${p.respondieron === 1 ? 'respuesta' : 'respuestas'}`}
                  {p.tipo === 'escala' && p.media != null && <> · media <strong className="text-foreground">{p.media.toLocaleString('es-ES')}</strong> de 5</>}
                  {p.tipo === 'varias' && ' · podían marcar varias'}
                </p>
                {p.tipo !== 'texto' && p.clave !== 'motivo' && (
                  <ul className="mt-2 space-y-1.5">
                    {(p.opciones || []).map((o) => (
                      <li key={o.clave} className="text-sm">
                        <span className="flex justify-between gap-3"><span>{p.tipo === 'escala' ? `${o.clave} · ${o.texto}` : o.texto}</span>
                          <span className="tabular-nums text-muted-foreground">{o.n} · {pct(o.n, p.respondieron)}</span></span>
                        <span className="mt-0.5 block h-1.5 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${p.respondieron ? (o.n * 100) / p.respondieron : 0}%` }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Lo escrito: en las de «Otro», solo si alguien escribió. */}
                {(p.tipo === 'texto' || (p.escritos || []).length > 0) && (
                  (p.escritos || []).length === 0
                    ? <p className="mt-2 text-sm text-muted-foreground">Nadie ha escrito nada todavía.</p>
                    : (
                      <ul className="mt-2 space-y-2">
                        {p.escritos!.map((e, k) => (
                          <li key={k} className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                            <span className="italic">«{e.texto}»</span>
                            <span className="mt-1 block text-xs text-muted-foreground">
                              <Link to={`/leads/${e.lead_id}`} className="hover:underline">{e.lead_nombre || 'Sin nombre'}</Link>
                              {e.gestora ? ` · de ${e.gestora}` : ''} · {fecha(e.fecha)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Desglose ───────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Desglose</h2>
          <div className="inline-flex rounded-md border border-border p-0.5 text-sm" role="tablist">
            {([['gestora', 'Por gestora'], ['campus', 'Por campus'], ['disparador', 'Por disparador']] as const).map(([k, etq]) => (
              <button key={k} type="button" role="tab" aria-selected={pestaña === k} onClick={() => setPestaña(k)}
                className={`rounded px-2.5 py-1 ${pestaña === k ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {etq}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-2 text-left font-semibold">{pestaña === 'gestora' ? 'Gestora' : pestaña === 'campus' ? 'Campus' : 'Cuándo se envió'}</th>
                <th className="py-2 text-right font-semibold">Enviados</th>
                <th className="py-2 text-right font-semibold">Respondidos</th>
                <th className="py-2 text-right font-semibold">%</th>
                {pestaña === 'gestora' && <th className="py-2 text-right font-semibold">Nota de atención</th>}
                {pestaña === 'gestora' && <th className="py-2 text-right font-semibold">No le contestaron a tiempo</th>}
              </tr>
            </thead>
            <tbody>
              {pestaña === 'gestora' && (datos?.porGestora || []).map((g) => {
                const extra: Record<string, string> = g.gestora_id ? { gestoraId: String(g.gestora_id) } : {};
                return (
                  <tr key={g.gestora_id ?? 'nadie'} className="border-t border-border">
                    <td className="py-2">{g.nombre}</td>
                    <Num n={g.enviados} onClick={() => abrir(`Enviados · ${g.nombre}`, { que: 'enviados', ...extra })} />
                    <Num n={g.respondidos} onClick={() => abrir(`Respondidos · ${g.nombre}`, { que: 'respondidos', ...extra })} />
                    <td className="py-2 text-right tabular-nums">{pct(g.respondidos, g.enviados)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {g.notas > 0 ? <>{Number(g.nota_atencion).toLocaleString('es-ES')} <span className="text-xs text-muted-foreground">de 5 · {g.notas}</span></> : <span className="text-muted-foreground">—</span>}
                    </td>
                    <Num n={g.no_le_contestaron} aviso
                      onClick={() => abrir(`No le contestaron a tiempo · ${g.nombre}`, { que: 'respondidos', motivo: 'sin_respuesta', ...extra })} />
                  </tr>
                );
              })}
              {pestaña === 'campus' && (datos?.porCampus || []).map((c) => (
                <tr key={c.project_id} className="border-t border-border">
                  <td className="py-2">{c.nombre}</td>
                  <Num n={c.enviados} onClick={() => abrir(`Enviados · ${c.nombre}`, { que: 'enviados', soloCampus: String(c.project_id) })} />
                  <Num n={c.respondidos} onClick={() => abrir(`Respondidos · ${c.nombre}`, { que: 'respondidos', soloCampus: String(c.project_id) })} />
                  <td className="py-2 text-right tabular-nums">{pct(c.respondidos, c.enviados)}</td>
                </tr>
              ))}
              {pestaña === 'disparador' && (datos?.porDisparador || []).map((d) => (
                <tr key={d.clave} className="border-t border-border">
                  <td className="py-2">{datos?.disparadores[d.clave] || d.clave}</td>
                  <Num n={d.enviados} onClick={() => abrir(`Enviados · ${datos?.disparadores[d.clave]}`, { que: 'enviados', disparador: d.clave })} />
                  <Num n={d.respondidos} onClick={() => abrir(`Respondidos · ${datos?.disparadores[d.clave]}`, { que: 'respondidos', disparador: d.clave })} />
                  <td className="py-2 text-right tabular-nums">{pct(d.respondidos, d.enviados)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Mes a mes ──────────────────────────────────────────────── */}
      {(datos?.porMes || []).length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-base font-semibold">Mes a mes</h2>
          <table className="mt-3 w-full text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr><th className="py-2 text-left font-semibold">Mes</th><th className="py-2 text-right font-semibold">Enviados</th>
                <th className="py-2 text-right font-semibold">Respondidos</th><th className="py-2 text-right font-semibold">%</th></tr>
            </thead>
            <tbody>
              {datos!.porMes.map((m) => (
                <tr key={m.mes} className="border-t border-border">
                  <td className="py-2 capitalize">{MES(m.mes)}</td>
                  {/* Cada número abre quiénes son, de ese mes y dentro del rango de arriba. */}
                  <Num n={m.enviados} onClick={() => abrir(`Enviados · ${MES(m.mes)}`, { que: 'enviados', ...delMes(m.mes, rango) })} />
                  <Num n={m.respondidos} onClick={() => abrir(`Respondidos · ${MES(m.mes)}`, { que: 'respondidos', ...delMes(m.mes, rango) })} />
                  <td className="py-2 text-right tabular-nums">{pct(m.respondidos, m.enviados)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {detalle && <ListaDeDetras detalle={detalle} base={base} textoMotivo={textoMotivo}
        disparadores={datos?.disparadores || {}} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}

function Cifra({ etiqueta, valor, cargando, onClick }: {
  etiqueta: string; valor: number | string | undefined; cargando: boolean; onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick}
      className={`rounded-lg border border-border bg-card p-4 text-left ${onClick ? 'hover:bg-muted/40 focus:outline-none focus:ring-2 focus:ring-ring/40' : ''}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{etiqueta}</span>
      <span className="mt-1 block text-3xl font-bold tabular-nums">{cargando ? '…' : (valor ?? '—')}</span>
    </Tag>
  );
}

/** Del 1 al último día de ese mes («2026-09»), recortado al rango elegido arriba. */
function delMes(mes: string, rango: { from?: string; to?: string }) {
  const [a, m] = mes.split('-').map(Number);
  const inicio = `${mes}-01`;
  const fin = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`;
  return {
    desde: rango.from && rango.from > inicio ? rango.from : inicio,
    hasta: rango.to && rango.to < fin ? rango.to : fin,
  };
}

function Num({ n, onClick, aviso = false }: { n: number; onClick: () => void; aviso?: boolean }) {
  return (
    <td className="py-2 text-right tabular-nums">
      {n > 0
        ? <button type="button" onClick={onClick}
            className={`underline-offset-2 hover:underline ${aviso ? 'font-semibold text-warning-soft-foreground' : ''}`}>{n}</button>
        : <span className="text-muted-foreground">0</span>}
    </td>
  );
}

function BotonTexto({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="underline underline-offset-2 hover:text-foreground">{children}</button>;
}

/** Las personas detrás de un número. Con el mismo recorte que el panel. */
function ListaDeDetras({ detalle, base, textoMotivo, disparadores, onCerrar }: {
  detalle: Detalle; base: URLSearchParams; textoMotivo: (c: string | null) => string;
  disparadores: Record<string, string>; onCerrar: () => void;
}) {
  const [filas, setFilas] = useState<FilaFeedback[] | null>(null);
  useEffect(() => {
    const p = new URLSearchParams(base);
    const { soloCampus, ...resto } = detalle.params;
    // Un campus concreto desde el desglose: sustituye a la empresa, no se suma.
    if (soloCampus) { p.delete('issuerId'); p.set('projectId', soloCampus); }
    Object.entries(resto).forEach(([k, v]) => p.set(k, v));
    setFilas(null);
    traerLista(p).then(setFilas);
  }, [detalle, base]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onCerrar}>
      <div role="dialog" aria-modal="true" aria-label={detalle.titulo}
        className="max-h-[85vh] w-full max-w-3xl overflow-hidden rounded-t-xl bg-card sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="font-semibold">{detalle.titulo}{filas ? ` · ${filas.length}` : ''}</h3>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded p-1 hover:bg-muted"><X size={16} /></button>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {!filas && <p className="p-4 text-sm text-muted-foreground">Cargando…</p>}
          {filas && filas.length === 0 && <p className="p-4 text-sm text-muted-foreground">Nadie.</p>}
          {filas && filas.length > 0 && (
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-card text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-semibold">Persona</th>
                  <th className="px-2 py-2 text-left font-semibold">Campus · gestora</th>
                  <th className="px-2 py-2 text-left font-semibold">Enviado</th>
                  <th className="px-4 py-2 text-left font-semibold">Contestó</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.id} className="border-t border-border align-top">
                    <td className="px-4 py-2">
                      <Link to={`/leads/${f.lead_id}`} className="font-medium hover:underline">{f.lead_nombre || 'Sin nombre'}</Link>
                      <span className="block text-xs text-muted-foreground">{f.email || 'sin correo'}</span>
                    </td>
                    <td className="px-2 py-2">
                      {f.proyecto || '—'}
                      <span className="block text-xs text-muted-foreground">{f.gestora || 'sin gestora'}</span>
                    </td>
                    <td className="px-2 py-2">
                      {fecha(f.enviado_at)}
                      <span className="block text-xs text-muted-foreground">{disparadores[f.disparador] || f.disparador}</span>
                      {f.nota_envio && f.estado !== 'enviado' && <span className="block text-xs text-muted-foreground">{f.nota_envio}</span>}
                    </td>
                    <td className="px-4 py-2">
                      {f.respondido_at
                        ? <>{textoMotivo(f.motivo)}<span className="block text-xs text-muted-foreground">{fecha(f.respondido_at)}{f.comentario ? ` · «${f.comentario}»` : ''}</span></>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
