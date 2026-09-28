import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChatCircleText, DownloadSimple, EnvelopeSimple, Percent, Star, ArrowRight } from '@phosphor-icons/react';
import KpiCard from '@/shared/components/ui/KpiCard';
import { ponerAmbito } from '@/shared/lib/ambitoInforme';
import { toast } from '@/shared/hooks/useToast';
import { traerPanel, traerLista, type PanelFeedback, type FilaFeedback } from '../api/feedback.api';

/**
 * El feedback, también en Reportes (Diego, 28/09: «esas métricas, y también
 * medibles en reportes»).
 *
 * Son las MISMAS cifras que «Análisis → Feedback» —el mismo endpoint, con el
 * rango y el ámbito (campus o empresa) de Reportes—, así que no pueden
 * contradecirse. Aquí va el resumen y la descarga de las respuestas; el
 * desglose por gestora, campus y mes sigue en su panel.
 *
 * `onDatos` sube el panel a la página para que el CSV general del reporte lo
 * lleve también.
 */

type Props = {
  from: string; to: string;
  issuerId: number | null;
  project: { id: number } | null | undefined;
  onDatos?: (d: PanelFeedback | null) => void;
};

const celda = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/** Lo contestado por una persona, en texto: «Otro motivo: «me mudo»», «4 · Bien»… */
function respuestaEnTexto(datos: PanelFeedback, clave: string, valor: unknown) {
  const p = datos.preguntas.find((x) => x.clave === clave);
  const texto = (v: unknown) => p?.opciones?.find((o) => o.clave === String(v))?.texto || String(v);
  if (valor === undefined || valor === null || valor === '') return '';
  if (p?.tipo === 'escala') return `${valor} · ${texto(valor)}`;
  return (Array.isArray(valor) ? valor : [valor]).map(texto).join(', ');
}

export function feedbackEnCsv(datos: PanelFeedback, sep: (fila: unknown[]) => string) {
  const t = datos.totales;
  const filas: string[] = [];
  filas.push(sep(['Feedback · por qué no compran']));
  filas.push(sep(['Enviados', 'Respondidos', 'Tasa de respuesta (%)', 'Esperando revisión', 'Sin correo', 'Fallidos']));
  filas.push(sep([t.enviados, t.respondidos, t.tasa, t.en_revision, t.sin_correo, t.fallidos]));
  filas.push('');
  if (datos.porMotivo.length) {
    filas.push(sep(['Motivo', 'Respuestas']));
    datos.porMotivo.forEach((m) => filas.push(sep([datos.motivos.find((x) => x.clave === m.clave)?.texto || m.clave, m.n])));
    filas.push('');
  }
  if (datos.porGestora.length) {
    filas.push(sep(['Gestora', 'Enviados', 'Respondidos', 'No le contestaron a tiempo', 'Nota de atención (1-5)', 'Notas']));
    datos.porGestora.forEach((g) => filas.push(sep([g.nombre, g.enviados, g.respondidos, g.no_le_contestaron, g.nota_atencion ?? '—', g.notas])));
    filas.push('');
  }
  datos.preguntas.filter((p) => p.clave !== 'motivo' && p.respondieron > 0 && p.opciones?.length).forEach((p) => {
    filas.push(sep([p.texto, `${p.respondieron} respuestas${p.media != null ? ` · media ${p.media}` : ''}`]));
    p.opciones!.forEach((o) => filas.push(sep([p.tipo === 'escala' ? `${o.clave} · ${o.texto}` : o.texto, o.n])));
    filas.push('');
  });
  return filas;
}

export default function FeedbackEnReportes({ from, to, issuerId, project, onDatos }: Props) {
  const [datos, setDatos] = useState<PanelFeedback | null>(null);
  const [bajando, setBajando] = useState(false);

  const base = useMemo(() => {
    const p = ponerAmbito(new URLSearchParams(), { activeIssuerId: issuerId, activeProject: project });
    if (from) p.set('desde', from);
    if (to) p.set('hasta', to);
    return p;
  }, [issuerId, project?.id, from, to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let vivo = true;
    traerPanel(base).then((d) => {
      if (!vivo) return;
      setDatos(d);
      onDatos?.(d);
    }).catch(() => { if (vivo) { setDatos(null); onDatos?.(null); } });
    return () => { vivo = false; };
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!datos) return null;
  const t = datos.totales;
  const nota = datos.preguntas.find((p) => p.clave === 'nota_atencion');
  const motivoTop = datos.porMotivo[0];
  const textoMotivo = motivoTop ? (datos.motivos.find((m) => m.clave === motivoTop.clave)?.texto || motivoTop.clave) : null;

  // Una fila por persona que contestó, con cada pregunta en su columna.
  async function descargarRespuestas() {
    setBajando(true);
    try {
      const p = new URLSearchParams(base);
      p.set('que', 'respondidos');
      const filas: FilaFeedback[] = await traerLista(p);
      const preguntas = datos!.preguntas;
      const conOtro = preguntas.filter((q) => filas.some((f) => f.respuestas?.[`${q.clave}_otro`]));
      const cab = ['Contestó', 'Prospecto', 'Correo', 'Campus', 'Gestora', 'Cuándo se envió',
        ...preguntas.map((q) => q.texto), ...conOtro.map((q) => `${q.texto} · lo que escribió`)];
      const lineas = [cab.map(celda).join(',')];
      for (const f of filas) {
        const r = f.respuestas || {};
        lineas.push([
          f.respondido_at?.slice(0, 10), f.lead_nombre, f.email, f.proyecto, f.gestora,
          datos!.disparadores[f.disparador] || f.disparador,
          ...preguntas.map((q) => respuestaEnTexto(datos!, q.clave, r[q.clave] ?? (q.clave === 'motivo' ? f.motivo : undefined))),
          ...conOtro.map((q) => r[`${q.clave}_otro`] ?? ''),
        ].map(celda).join(','));
      }
      const blob = new Blob([`﻿${lineas.join('\n')}`], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `feedback-respuestas-${from}_${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: `${filas.length} ${filas.length === 1 ? 'respuesta descargada' : 'respuestas descargadas'}` });
    } catch (err) {
      toast({ title: 'No se ha podido descargar', description: (err as Error).message, variant: 'destructive' });
    } finally { setBajando(false); }
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4" aria-labelledby="feedback-en-reportes">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 id="feedback-en-reportes" className="flex items-center gap-2 text-sm font-semibold">
          <ChatCircleText size={16} /> Feedback · por qué no compran
        </h3>
        <div className="flex items-center gap-2">
          <button type="button" onClick={descargarRespuestas} disabled={bajando || t.respondidos === 0}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
            <DownloadSimple size={14} weight="bold" /> {bajando ? 'Preparando…' : 'Respuestas (CSV)'}
          </button>
          <Link to="/informes/feedback" className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
            Ver el panel <ArrowRight size={12} weight="bold" />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard icon={EnvelopeSimple} label="Enviados" value={t.enviados} />
        <KpiCard icon={ChatCircleText} label="Respondidos" value={t.respondidos} tone="success" />
        <KpiCard icon={Percent} label="Tasa de respuesta" value={`${t.tasa}%`} />
        <KpiCard icon={Star} label="Nota de atención" value={nota?.media != null ? `${nota.media} / 5` : '—'} />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        {textoMotivo
          ? <>El motivo que más se repite: <strong className="text-foreground">{textoMotivo}</strong> ({motivoTop!.n} de {t.respondidos}).</>
          : 'Todavía no ha contestado nadie en este periodo.'}
      </p>
    </section>
  );
}
