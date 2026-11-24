import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, PaperPlaneTilt, CheckCircle, Clock, WarningCircle, Receipt, ShieldCheck, ArrowClockwise,
} from '@phosphor-icons/react';
import client from '@/shared/api/client';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import { useProjectContext } from '@/contexts/ProjectContext';
import usePermission from '@/shared/hooks/usePermission';
import { toast } from '@/shared/hooks/useToast';
import { formatDateNumeric } from '@/shared/lib/format';
import VerRecorrido from '@/shared/components/ui/VerRecorrido';
import { facturaAutomaticaApi, type Panel, type Formulario } from '../api/facturaAutomatica.api';

/*
  FACTURACIÓN AUTOMÁTICA (#764) Y AUDITORÍA (#765), EN UN SITIO (24/11).

  Diego, al encender la factura automática en producción: «un sitio para VER la
  facturación automática y la auditoría», dentro de Facturación y para quien
  gestiona facturas (`facturas.automatica`). Solo mira; lo que se hace sigue
  donde estaba: la cola de facturación (Facturas), la ficha de la venta y el
  aviso fijo de la pausa (arriba, para la administración).

    · Formularios de datos fiscales: enviados, contestados, vencidos, esperando.
    · Facturas que salieron solas: su número, si se mandó el PDF y a qué correo.
    · Lo que necesita a una persona: en revisión, posible duplicada…, con su
      motivo y qué hacer.
    · La auditoría (con `facturas.auditoria`): la última vuelta, sus
      incidencias, las pausas y la pasada en seco.
*/

const euros = (n: unknown) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n || 0));
const cuando = (t: string | null | undefined) => (t
  ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '—');

const SITUACION: Record<string, { texto: string; tono: string }> = {
  esperando: { texto: 'Esperando', tono: 'bg-info-soft text-info-soft-foreground' },
  contestado: { texto: 'Contestado', tono: 'bg-success-soft text-success-soft-foreground' },
  vencido: { texto: 'Vencido', tono: 'bg-warning-soft text-warning-soft-foreground' },
  revision: { texto: 'En revisión', tono: 'bg-destructive-soft text-destructive-soft-foreground' },
};
const FILTROS = [['todos', 'Todos'], ['esperando', 'Esperando'], ['contestado', 'Contestados'], ['vencido', 'Vencidos'], ['revision', 'En revisión']] as const;

function Chip({ s }: { s: string }) {
  const c = SITUACION[s] || { texto: s, tono: 'bg-muted text-muted-foreground' };
  return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${c.tono}`}>{c.texto}</span>;
}

function useAmbito(): string {
  const { activeProject, activeIssuer } = useProjectContext() as {
    activeProject: { id?: number | null } | null; activeIssuer: { id: number } | null;
  };
  if (activeIssuer?.id) return `?issuerId=${activeIssuer.id}`;
  const pid = Number(activeProject?.id || 0);
  return pid > 0 ? `?projectId=${pid}` : '';
}

export default function FacturacionAutomaticaPage() {
  const { can } = usePermission();
  const puede = can('facturas.automatica');
  const ambito = useAmbito();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [cargando, setCargando] = useState(true);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number][0]>('todos');

  const cargar = useCallback(() => {
    if (!puede) { setCargando(false); return; }
    setCargando(true);
    facturaAutomaticaApi.panel(ambito)
      .then((r) => { if (r?.success && r.data) setPanel(r.data); })
      .catch((err) => toast({ title: 'No se pudo cargar', description: (err as Error)?.message, variant: 'destructive' }))
      .finally(() => setCargando(false));
  }, [puede, ambito]);
  useEffect(() => { cargar(); }, [cargar]);

  const formularios = useMemo(
    () => (panel?.formularios || []).filter((f) => filtro === 'todos' || f.situacion === filtro || (filtro === 'revision' && f.estado === 'revision')),
    [panel, filtro],
  );

  if (!puede) {
    return <div className="p-8 text-muted-foreground">No tienes acceso a la facturación automática.</div>;
  }
  const r = panel?.resumen;

  return (
    <div className="space-y-5 pb-8">
      <Link to="/accounting/facturas" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft size={14} weight="bold" /> Facturas
      </Link>
      <PageHeader
        title="Facturación automática"
        subtitle={panel
          ? (panel.activa
            ? `Encendida · el alumno tiene ${panel.dias} días para dar sus datos · PDF al alumno: ${panel.enviar_pdf ? 'sí' : 'no (apagado en este servidor)'}`
            : 'Apagada en este servidor: las facturas se emiten desde la cola, como siempre.')
          : 'Cargando…'}
        actions={(
          <span className="flex flex-wrap gap-2">
            <VerRecorrido id="facturacion-automatica" listo={!cargando} />
            <button type="button" onClick={cargar}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
              <ArrowClockwise size={14} weight="bold" /> Actualizar
            </button>
          </span>
        )}
      />

      {r && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-recorrido="fa-resumen">
          <KpiCard icon={PaperPlaneTilt} iconBg="bg-info-soft text-info-soft-foreground" label="Formularios enviados" numericValue={r.enviados} />
          <KpiCard icon={CheckCircle} iconBg="bg-success-soft text-success-soft-foreground" label="Contestados" numericValue={r.contestados} />
          <KpiCard icon={Clock} iconBg="bg-warning-soft text-warning-soft-foreground" label="Vencidos (sin respuesta)" numericValue={r.vencidos} />
          <KpiCard icon={Clock} iconBg="bg-muted text-muted-foreground" label="Esperando" numericValue={r.esperando} />
          <KpiCard icon={WarningCircle} iconBg="bg-destructive-soft text-destructive-soft-foreground" label="Necesitan a una persona" numericValue={r.atencion} />
          <KpiCard icon={Receipt} iconBg="bg-primary/10 text-primary" label="Facturas solas" numericValue={r.facturas}
            badge={`${r.pdf_enviados} PDF enviados · ${r.las_envia_la_gestora} los envía la gestora`} badgeColor="bg-muted text-muted-foreground" />
        </div>
      )}

      {/* Lo que necesita a una persona */}
      <section className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="fa-atencion">
        <h2 className="px-4 py-2.5 border-b border-border font-semibold text-sm flex items-center gap-2">
          <WarningCircle size={15} weight="bold" className="text-warning" /> Necesitan a una persona
          <span className="text-[11px] font-normal text-muted-foreground">· en revisión, posible duplicada, sin correo…</span>
        </h2>
        {!panel?.atencion.length ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{cargando ? 'Cargando…' : 'Nada: todo sale solo o está esperando al alumno.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-cifras w-full text-[13px]">
              <thead className="text-[11px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left">Alumno</th>
                  <th className="px-3 py-2 text-left">Motivo</th>
                  <th className="px-3 py-2 text-left">Qué hacer</th>
                  <th className="px-3 py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody>
                {panel.atencion.map((a) => (
                  <tr key={a.id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-3 py-2">
                      <span className="font-medium">{a.alumno || '—'}</span>
                      <span className="block text-[11px] text-muted-foreground">{a.campus}{a.gestora ? ` · ${a.gestora}` : ''}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="font-semibold text-warning-soft-foreground">{a.motivo}</span>
                      {a.detalle && <span className="block text-[11px] text-muted-foreground max-w-[28rem] whitespace-normal">{a.detalle}</span>}
                    </td>
                    <td className="px-3 py-2 text-[12px] max-w-[24rem] whitespace-normal">{a.texto}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {a.donde === 'cola' && a.cobro_id ? (
                        <Link to={`/accounting/facturas?cobro=${a.cobro_id}&campus=${a.project_id}`} className="text-[12px] font-semibold text-primary hover:underline">Abrir en la cola</Link>
                      ) : a.donde === 'config' ? (
                        <Link to="/accounting/facturas/configuracion" className="text-[12px] font-semibold text-primary hover:underline">Configuración</Link>
                      ) : (
                        <Link to={`/ventas/${a.conversion_id}`} className="text-[12px] font-semibold text-primary hover:underline">Ver la venta</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Formularios de datos fiscales */}
      <section className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="fa-formularios">
        <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-sm flex items-center gap-2"><PaperPlaneTilt size={15} weight="bold" /> Formularios de datos fiscales</h2>
          <div className="inline-flex flex-wrap rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {FILTROS.map(([k, t]) => (
              <button key={k} type="button" onClick={() => setFiltro(k)} aria-pressed={filtro === k}
                className={`h-7 px-2.5 ${filtro === k ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>{t}</button>
            ))}
          </div>
        </div>
        {!formularios.length ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{cargando ? 'Cargando…' : 'Ninguno.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-cifras w-full text-[13px]">
              <thead className="text-[11px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left">Alumno</th>
                  <th className="px-3 py-2 text-left">Enviado a</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Plazo / respuesta</th>
                  <th className="px-3 py-2 text-left">Factura</th>
                </tr>
              </thead>
              <tbody>
                {formularios.map((f: Formulario) => (
                  <tr key={f.id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-3 py-2">
                      <Link to={`/ventas/${f.conversion_id}`} className="font-medium hover:underline">{f.alumno || '—'}</Link>
                      <span className="block text-[11px] text-muted-foreground">{f.campus}{f.gestora ? ` · ${f.gestora}` : ''}</span>
                    </td>
                    <td className="px-3 py-2">
                      {f.enviado_a || <span className="text-destructive">{f.envio_error || 'no salió'}</span>}
                      <span className="block text-[11px] text-muted-foreground">{cuando(f.enviado_at)}</span>
                    </td>
                    <td className="px-3 py-2"><Chip s={f.estado === 'revision' ? 'revision' : f.situacion} /></td>
                    <td className="px-3 py-2 text-[12px]">
                      {f.respondido_at ? `Contestó ${cuando(f.respondido_at)}`
                        : f.origen_datos === 'ficha' ? 'Sin respuesta: con su ficha'
                          : `Hasta ${cuando(f.caduca_at)}`}
                    </td>
                    <td className="px-3 py-2 text-[12px]">
                      {f.facturas ? `${f.facturas} emitida${f.facturas > 1 ? 's' : ''}` : '—'}
                      <span className={`block text-[11px] ${f.factura_envio_auto === false ? 'text-warning-soft-foreground' : 'text-muted-foreground'}`}>
                        {f.factura_envio_auto === false ? f.envio_nota : `PDF a ${f.envio_email || '—'}`}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {panel && panel.formularios.length >= panel.limite && (
          <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border">Se enseñan los {panel.limite} más recientes.</p>
        )}
      </section>

      {/* Facturas que salieron solas */}
      <section className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="fa-facturas">
        <h2 className="px-4 py-2.5 border-b border-border font-semibold text-sm flex items-center gap-2"><Receipt size={15} weight="bold" /> Facturas emitidas solas</h2>
        {!panel?.facturas.length ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">{cargando ? 'Cargando…' : 'Todavía ninguna.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla-cifras w-full text-[13px]">
              <thead className="text-[11px] text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left">Número</th>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-left">PDF</th>
                </tr>
              </thead>
              <tbody>
                {panel.facturas.map((i) => (
                  <tr key={i.id} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-3 py-2">
                      <span className="font-mono text-[12px] font-semibold">{i.codigo}</span>
                      <span className="block text-[11px] text-muted-foreground">{formatDateNumeric(i.fecha)} · {i.campus}</span>
                    </td>
                    <td className="px-3 py-2">
                      {i.conversion_id
                        ? <Link to={`/ventas/${i.conversion_id}`} className="hover:underline">{i.cliente_nombre || '—'}</Link>
                        : (i.cliente_nombre || '—')}
                      <span className="block text-[11px] text-muted-foreground">
                        {i.cliente_nif || 'sin NIF'} · {i.origen_datos === 'ficha' ? 'con su ficha' : 'con el formulario'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">{euros(i.total)}</td>
                    <td className="px-3 py-2 text-[12px]">
                      {i.sent_at
                        ? <span className="text-success">Enviado a {i.sent_to_email} · {cuando(i.sent_at)}</span>
                        : i.envio_nota
                          ? <span className="text-warning-soft-foreground">{i.envio_nota}</span>
                          : <span className="text-muted-foreground">No se envió{panel.enviar_pdf ? '' : ' (envío del PDF apagado)'}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {can('facturas.auditoria') && <AuditoriaFacturacion />}
    </div>
  );
}

// ── La auditoría (#765) ─────────────────────────────────────────────────────

type Incidencia = { tipo: string; serie?: string | null; texto: string };
type EstadoAuditoria = {
  activa: boolean; dias?: number; pausar?: boolean; desde?: string | null; pausada?: boolean;
  pausa?: { id: number; pausada_at: string; motivo: string } | null;
  ultima?: { id: number; termino: string; limpia: boolean; incidencias: Incidencia[]; resumen: Record<string, number>; origen: string } | null;
  cola?: { cobros: number; importe: number };
};
type Historial = {
  vueltas: Array<{ id: number; termino: string; limpia: boolean; incidencias: number; origen: string }>;
  pausas: Array<{ id: number; pausada_at: string; motivo: string; reanudada_at: string | null; reanudada_por: string | null }>;
};
type Simulacion = {
  desde: string; hasta: string; limpia: boolean; pausaria: boolean; total: number;
  resumen: Record<string, number>; incidencias: Incidencia[];
};

const TIPOS: Record<string, string> = {
  numero_repetido: 'Números repetidos',
  datos_fiscales: 'Facturas sin datos fiscales',
  cobro_sin_factura: 'Cobros sin factura',
};

function ListaDeIncidencias({ lista }: { lista: Incidencia[] }) {
  if (!lista.length) return null;
  return (
    <ul className="space-y-1 text-[12px] max-h-72 overflow-y-auto">
      {lista.map((i, k) => (
        <li key={k} className="flex gap-2">
          <span className="font-semibold whitespace-nowrap text-warning-soft-foreground">{TIPOS[i.tipo] || i.tipo}</span>
          <span className="text-muted-foreground">{i.texto}</span>
        </li>
      ))}
    </ul>
  );
}

function AuditoriaFacturacion() {
  const [estado, setEstado] = useState<EstadoAuditoria | null>(null);
  const [historial, setHistorial] = useState<Historial | null>(null);
  const [desde, setDesde] = useState('');
  const [sim, setSim] = useState<Simulacion | null>(null);
  const [simulando, setSimulando] = useState(false);

  useEffect(() => {
    client.get<EstadoAuditoria>('/facturacion-auditoria/estado')
      .then((r) => { if (r?.success) setEstado(r.data || null); })
      .catch(() => setEstado({ activa: false }));
    client.get<Historial>('/facturacion-auditoria/historial?limite=10')
      .then((r) => { if (r?.success) setHistorial(r.data || null); })
      .catch(() => {});
  }, []);

  async function simular() {
    setSimulando(true);
    try {
      const r = await client.get<Simulacion>(`/facturacion-auditoria/simular${desde ? `?desde=${desde}` : ''}`);
      if (r?.data) setSim(r.data);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo hacer la pasada en seco', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSimulando(false); }
  }

  const u = estado?.ultima;
  return (
    <section className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="fa-auditoria">
      <h2 className="px-4 py-2.5 border-b border-border font-semibold text-sm flex items-center gap-2">
        <ShieldCheck size={15} weight="bold" /> Auditoría de facturación
      </h2>
      <div className="p-4 space-y-4 text-sm">
        {!estado ? <p className="text-muted-foreground">Cargando…</p> : !estado.activa ? (
          <p className="text-muted-foreground">
            Apagada en este servidor. Encendida, cada 2 horas mira tres cosas por serie —números repetidos, facturas sin
            datos fiscales y cobros sin factura— y, si algo falla, pausa la emisión hasta que se arregla.
            Abajo puedes ver qué encontraría hoy, sin pausar nada.
          </p>
        ) : (
          <>
            <p>
              <strong>Encendida</strong>{estado.pausar === false ? ' en modo aviso (no pausa la facturación)' : ''} · cada 2 horas ·
              {' '}cobros y facturas de más de {estado.dias} días · audita desde el {estado.desde ? formatDateNumeric(estado.desde) : 'día de la primera vuelta'}.
            </p>
            {estado.pausada && estado.pausa ? (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive-soft text-destructive-soft-foreground px-3 py-2">
                Facturación PAUSADA desde {cuando(estado.pausa.pausada_at)}: {estado.pausa.motivo}.
                {' '}Se reanuda con «Marcar como solucionado» en el aviso de arriba.
                {estado.cola?.cobros ? ` ${estado.cola.cobros} cobro(s) esperan en la cola de la pausa (${euros(estado.cola.importe)}).` : ''}
              </p>
            ) : null}
            {u ? (
              <div className="space-y-2">
                <p>
                  Última vuelta: {cuando(u.termino)} ({u.origen}) ·{' '}
                  {u.limpia ? <span className="text-success font-semibold">limpia</span>
                    : <span className="text-warning-soft-foreground font-semibold">{u.incidencias.length} incidencia(s)</span>}
                </p>
                <ListaDeIncidencias lista={u.incidencias || []} />
              </div>
            ) : <p className="text-muted-foreground">Todavía no ha dado ninguna vuelta.</p>}
            {historial && (historial.pausas.length > 0 || historial.vueltas.length > 0) && (
              <div className="grid md:grid-cols-2 gap-4 text-[12px]">
                <div>
                  <h3 className="font-semibold mb-1">Vueltas</h3>
                  <ul className="space-y-0.5">
                    {historial.vueltas.map((v) => (
                      <li key={v.id}>{cuando(v.termino)} · {v.limpia ? 'limpia' : `${v.incidencias} incidencia(s)`} · {v.origen}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Pausas</h3>
                  {historial.pausas.length ? (
                    <ul className="space-y-0.5">
                      {historial.pausas.map((p) => (
                        <li key={p.id}>
                          {cuando(p.pausada_at)} · {p.motivo}
                          {p.reanudada_at ? ` · reanudada ${cuando(p.reanudada_at)}${p.reanudada_por ? ` por ${p.reanudada_por}` : ''}` : ' · sigue abierta'}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="text-muted-foreground">Ninguna.</p>}
                </div>
              </div>
            )}
          </>
        )}

        <div className="border-t border-border pt-3 space-y-2" data-recorrido="fa-pasada-en-seco">
          <h3 className="font-semibold">Pasada en seco</h3>
          <p className="text-[12px] text-muted-foreground">
            Las mismas comprobaciones, sin guardar, pausar ni avisar a nadie. Sin fecha, desde la que usaría la auditoría
            (el día de su primera vuelta): lo de antes no cuenta, para que las cargas antiguas no pausen la facturación.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[12px] space-y-1">
              <span className="block font-medium">Desde (opcional)</span>
              <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)}
                className="h-9 px-2 rounded-md border border-border bg-background text-sm" />
            </label>
            <button type="button" onClick={simular} disabled={simulando}
              className="h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
              {simulando ? 'Mirando…' : 'Hacer la pasada en seco'}
            </button>
          </div>
          {sim && (
            <div className="space-y-2">
              <p>
                Desde el {formatDateNumeric(sim.desde)} (cobros y facturas hasta el {formatDateNumeric(sim.hasta)}):{' '}
                {sim.limpia
                  ? <span className="text-success font-semibold">limpia, no pausaría nada.</span>
                  : <span className="text-warning-soft-foreground font-semibold">
                    {sim.total} incidencia(s) — {Object.entries(TIPOS).map(([k, t]) => `${t}: ${sim.resumen[k] || 0}`).join(' · ')}.
                    {sim.pausaria ? ' Encendida, pausaría la facturación.' : ' En modo aviso, solo avisaría.'}
                  </span>}
              </p>
              <ListaDeIncidencias lista={sim.incidencias} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
