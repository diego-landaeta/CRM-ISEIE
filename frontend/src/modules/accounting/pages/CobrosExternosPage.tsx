import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProjectContext } from '@/contexts/ProjectContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { ponerAmbito, TODOS_LOS_PROYECTOS } from '@/shared/lib/ambitoInforme';
import { formatCurrency, formatDateShort } from '@/shared/lib/format';
import { ArrowsClockwise, Bank, CheckCircle, PaypalLogo, UploadSimple, XCircle } from '@phosphor-icons/react';
import {
  cobrosExternosApi, type CobroPaypal, type EstadoCobrosExternos, type ExtractoBanco, type MovimientoBanco,
} from '../api/cobrosExternos.api';

/*
  REGISTRO AUTOMÁTICO DE COBROS (#766): PayPal y los extractos del banco.

  PayPal entra solo (sondeo y webhook) y aquí se ve qué se ha enlazado y qué
  no. Del banco se sube el extracto y aquí se deciden los abonos dudosos: el
  CRM solo enlaza solo cuando hay UN candidato y casan nombre e importe.

  Cada parte va detrás de su interruptor del servidor; apagada, la pestaña lo
  dice y no enseña nada más.
*/

type Pestana = 'paypal' | 'banco';

function errorDe(e: unknown): string {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error desconocido';
}

export default function CobrosExternosPage() {
  const { activeProject, activeIssuerId } = useProjectContext() as {
    activeProject: { id?: number | null; nombre?: string };
    activeIssuerId?: number | null;
  };
  const { can } = usePermission();
  const puedeEditar = can('cobros_externos.edit');
  const campus = activeProject?.id && activeProject.id !== TODOS_LOS_PROYECTOS && !activeIssuerId ? activeProject.id : null;
  const [estado, setEstado] = useState<EstadoCobrosExternos | null>(null);
  const [pestana, setPestana] = useState<Pestana>('paypal');

  useEffect(() => {
    cobrosExternosApi.estado()
      .then((r) => {
        const e = r.data || { paypal: false, santander: false };
        setEstado(e);
        if (!e.paypal && e.santander) setPestana('banco');
      })
      .catch(() => setEstado({ paypal: false, santander: false }));
  }, []);

  const qs = useCallback((extra: Record<string, string> = {}) =>
    ponerAmbito(new URLSearchParams(extra), { activeIssuerId, activeProject }), [activeIssuerId, activeProject]);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Cobros de PayPal y del banco"
        subtitle="Lo que entra por PayPal se registra solo en su venta. Del banco se sube el extracto y se deciden los abonos dudosos."
      />
      <div className="flex gap-2 border-b border-border">
        {([['paypal', 'PayPal', PaypalLogo], ['banco', 'Banco (extractos)', Bank]] as const).map(([k, label, Icono]) => (
          <button key={k} onClick={() => setPestana(k)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border-b-2 -mb-px ${pestana === k ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
            <Icono size={16} weight="duotone" /> {label}
          </button>
        ))}
      </div>
      {!estado ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : pestana === 'paypal' ? (
        estado.paypal
          ? <PestanaPaypal qs={qs} campus={campus} puedeEditar={puedeEditar} />
          : <Apagado que="PayPal" variable="PAYPAL_COBROS_ACTIVO=1" />
      ) : (
        estado.santander
          ? <PestanaBanco qs={qs} campus={campus} puedeEditar={puedeEditar} />
          : <Apagado que="Los extractos del banco" variable="SANTANDER_EXTRACTOS_ACTIVO=1" />
      )}
    </div>
  );
}

function Apagado({ que, variable }: { que: string; variable: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 text-sm text-muted-foreground">
      {que} está apagado en este servidor. Se enciende con <code className="px-1 rounded bg-muted">{variable}</code> en el
      <code className="px-1 rounded bg-muted ml-1">.env</code> del backend.
    </div>
  );
}

/** Un número de venta para enlazar a mano. */
function EnlazarAVenta({ alEnlazar }: { alEnlazar: (conversionId: number) => Promise<void> }) {
  const [venta, setVenta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const id = Number(venta);
  return (
    <span className="inline-flex items-center gap-1">
      <input value={venta} onChange={(e) => setVenta(e.target.value.replace(/\D/g, ''))} placeholder="Nº venta"
        className="w-20 h-7 px-2 rounded border border-border bg-card text-xs" aria-label="Número de venta" />
      <button disabled={!id || enviando}
        onClick={async () => { setEnviando(true); try { await alEnlazar(id); setVenta(''); } finally { setEnviando(false); } }}
        className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50">
        Enlazar
      </button>
    </span>
  );
}

// ─── PayPal ─────────────────────────────────────────────────────────────────
function PestanaPaypal({ qs, campus, puedeEditar }: { qs: (e?: Record<string, string>) => URLSearchParams; campus: number | null; puedeEditar: boolean }) {
  const [filas, setFilas] = useState<CobroPaypal[]>([]);
  const [enlazado, setEnlazado] = useState<'' | 'si' | 'no'>('no');
  const [cargando, setCargando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await cobrosExternosApi.paypal(qs({ limit: '100', ...(enlazado ? { enlazado } : {}) }));
      setFilas(r.data || []);
    } catch (e) {
      toast({ title: 'No se han podido traer los cobros', description: errorDe(e), variant: 'destructive' });
    } finally { setCargando(false); }
  }, [qs, enlazado]);
  useEffect(() => { cargar(); }, [cargar]);

  async function sincronizar() {
    if (!campus) return;
    setSincronizando(true);
    try {
      const r = await cobrosExternosApi.sincronizarPaypal(campus);
      toast({ title: 'PayPal sincronizado', description: `${r.data?.importados ?? 0} cobros leídos, ${r.data?.enlazados ?? 0} registrados en su venta.` });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido sincronizar', description: errorDe(e), variant: 'destructive' });
    } finally { setSincronizando(false); }
  }

  async function enlazar(id: number, conversionId: number) {
    try {
      await cobrosExternosApi.enlazarPaypal(id, conversionId);
      toast({ title: 'Cobro registrado en la venta', description: `Venta ${conversionId}. Queda en la cola de facturación.` });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido enlazar', description: errorDe(e), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={enlazado} onChange={(e) => setEnlazado(e.target.value as '' | 'si' | 'no')}
          className="h-9 px-2 rounded-md border border-border bg-card text-sm">
          <option value="no">Sin registrar en una venta</option>
          <option value="si">Registrados en su venta</option>
          <option value="">Todos</option>
        </select>
        {puedeEditar && (
          <button onClick={sincronizar} disabled={!campus || sincronizando}
            title={campus ? 'Traer ahora los cobros de PayPal de este campus' : 'Elige un campus arriba para sincronizar'}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <ArrowsClockwise size={14} weight="bold" /> {sincronizando ? 'Sincronizando…' : 'Sincronizar'}
          </button>
        )}
      </div>
      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Fecha</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-right px-3 py-2">Importe</th>
              <th className="text-left px-3 py-2">Estado</th>
              <th className="text-left px-3 py-2">Venta</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Cargando…</td></tr>
            ) : !filas.length ? (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No hay cobros con este filtro.</td></tr>
            ) : filas.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-3 py-2 whitespace-nowrap">{formatDateShort(f.paypal_created_at)}</td>
                <td className="px-3 py-2">
                  <div className="font-medium">{f.lead_nombre || f.customer_name || '—'}</div>
                  <div className="text-xs text-muted-foreground">{f.customer_email || 'sin correo'}{f.custom_id ? ` · ${f.custom_id}` : ''}</div>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {f.tipo === 'reembolso' ? '−' : ''}{f.currency === 'EUR' ? formatCurrency(Number(f.amount)) : `${f.amount} ${f.currency}`}
                </td>
                <td className="px-3 py-2 text-xs">{f.tipo === 'reembolso' ? 'Reembolso' : f.status === 'completed' ? 'Cobrado' : f.status}</td>
                <td className="px-3 py-2">
                  {f.conversion_payment_id && f.conversion_id ? (
                    <Link to={`/ventas/${f.conversion_id}`} className="text-primary hover:underline">
                      Venta {f.conversion_id}{f.producto_contratado ? ` · ${f.producto_contratado}` : ''}
                    </Link>
                  ) : f.tipo === 'cobro' && f.status === 'completed' && f.currency === 'EUR' && puedeEditar ? (
                    <EnlazarAVenta alEnlazar={(v) => enlazar(f.id, v)} />
                  ) : <span className="text-xs text-muted-foreground">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Banco ──────────────────────────────────────────────────────────────────
const ESTADOS: Array<[MovimientoBanco['estado'], string]> = [
  ['a_revisar', 'A revisar'], ['sin_candidato', 'Sin candidato'], ['enlazado', 'Registrados'], ['descartado', 'Descartados'],
];

function PestanaBanco({ qs, campus, puedeEditar }: { qs: (e?: Record<string, string>) => URLSearchParams; campus: number | null; puedeEditar: boolean }) {
  const [estado, setEstado] = useState<MovimientoBanco['estado']>('a_revisar');
  const [filas, setFilas] = useState<MovimientoBanco[]>([]);
  const [porEstado, setPorEstado] = useState<Record<string, number>>({});
  const [extractos, setExtractos] = useState<ExtractoBanco[]>([]);
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [m, e] = await Promise.all([
        cobrosExternosApi.movimientos(qs({ estado, limit: '100' })),
        cobrosExternosApi.extractos(qs()),
      ]);
      setFilas(m.data || []);
      setPorEstado(m.porEstado || {});
      setExtractos(e.data || []);
    } catch (err) {
      toast({ title: 'No se han podido traer los movimientos', description: errorDe(err), variant: 'destructive' });
    } finally { setCargando(false); }
  }, [qs, estado]);
  useEffect(() => { cargar(); }, [cargar]);

  async function subir(fichero: File | undefined) {
    if (!fichero || !campus) return;
    setSubiendo(true);
    try {
      const r = await cobrosExternosApi.subirExtracto(campus, fichero);
      const d = r.data;
      toast({
        title: 'Extracto subido',
        description: d ? `${d.nuevos} abonos nuevos: ${d.enlazados} registrados, ${d.yaApuntados} ya estaban apuntados, `
          + `${d.aRevisar} a revisar, ${d.sinCandidato} sin candidato${d.repetidos ? `, ${d.repetidos} repetidos de otro extracto` : ''}.` : undefined,
      });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido subir', description: errorDe(e), variant: 'destructive' });
    } finally { setSubiendo(false); }
  }

  async function confirmar(id: number, conversionId: number) {
    try {
      await cobrosExternosApi.confirmar(id, conversionId);
      toast({ title: 'Cobro registrado en la venta', description: `Venta ${conversionId}. Queda en la cola de facturación.` });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido registrar', description: errorDe(e), variant: 'destructive' });
    }
  }

  async function descartar(id: number) {
    if (!window.confirm('¿Descartar este abono? No se registrará en ninguna venta.')) return;
    try {
      await cobrosExternosApi.descartar(id);
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido descartar', description: errorDe(e), variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-4">
      {puedeEditar && (
        <div className="bg-card border border-border rounded-lg p-4 text-sm space-y-2">
          <p className="font-semibold">Subir un extracto</p>
          <p className="text-xs text-muted-foreground">
            Norma 43 (AEB43, el fichero «Cuaderno 43» de la banca online) o el CSV de movimientos. Solo se leen los abonos.
            Subir el mismo fichero dos veces no duplica nada, ni un extracto que se solapa con otro.
          </p>
          <label className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold ${!campus || subiendo ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}>
            <UploadSimple size={14} weight="bold" /> {subiendo ? 'Subiendo…' : 'Elegir fichero'}
            <input type="file" accept=".n43,.aeb,.aeb43,.q43,.txt,.csv,.dat" className="hidden" disabled={!campus || subiendo}
              onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          {!campus && <p className="text-xs text-warning-soft-foreground">Elige un campus arriba: el extracto se sube a un campus.</p>}
          {!!extractos.length && (
            <ul className="text-xs text-muted-foreground pt-2 space-y-0.5">
              {extractos.slice(0, 5).map((x) => (
                <li key={x.id}>
                  {formatDateShort(x.created_at)} · {x.nombre_fichero || x.formato.toUpperCase()} {x.cuenta ? `(${x.cuenta})` : ''} ·
                  {' '}{x.abonos_nuevos} abonos nuevos, {x.enlazados} registrados, {x.a_revisar} a revisar
                  {x.subido_por_nombre ? ` · ${x.subido_por_nombre}` : ''}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {ESTADOS.map(([k, label]) => (
          <button key={k} onClick={() => setEstado(k)}
            className={`h-8 px-3 rounded-full text-xs font-semibold border ${estado === k ? 'bg-primary text-primary-foreground border-primary' : 'bg-card border-border hover:bg-muted'}`}>
            {label} {porEstado[k] ? `(${porEstado[k]})` : ''}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : !filas.length ? (
          <p className="text-sm text-muted-foreground">No hay abonos en este estado.</p>
        ) : filas.map((m) => (
          <div key={m.id} className="bg-card border border-border rounded-lg p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold">{formatCurrency(Number(m.importe))}</span>
              <span className="text-muted-foreground text-xs">{formatDateShort(m.fecha_operacion)}{m.cuenta ? ` · ${m.cuenta}` : ''}</span>
              <span className="flex-1 min-w-0 break-words">{m.concepto || m.referencia || '(sin concepto)'}</span>
            </div>
            {m.estado === 'enlazado' && m.conversion_id && (
              <p className="mt-1 text-xs inline-flex items-center gap-1 text-success-soft-foreground">
                <CheckCircle size={12} weight="fill" />
                <Link to={`/ventas/${m.conversion_id}`} className="hover:underline">
                  Venta {m.conversion_id}{m.lead_nombre ? ` · ${m.lead_nombre}` : ''}
                </Link>
                {m.link_method?.includes('dedup') ? ' · ya estaba apuntado a mano' : m.link_method === 'auto' ? ' · registrado solo' : ''}
              </p>
            )}
            {m.estado === 'descartado' && (
              <p className="mt-1 text-xs text-muted-foreground inline-flex items-center gap-1">
                <XCircle size={12} /> {m.link_method === 'auto_liquidacion' ? 'Liquidación de Stripe o PayPal: cada cobro ya entra por su lado.' : 'Descartado a mano.'}
              </p>
            )}
            {(m.estado === 'a_revisar' || m.estado === 'sin_candidato') && puedeEditar && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {m.candidatos.map((c) => (
                  <button key={c.conversion_id} onClick={() => confirmar(m.id, c.conversion_id)}
                    title={`Coincide en: ${c.motivos.join(' e ')}`}
                    className="h-7 px-2 rounded border border-border bg-card text-xs hover:bg-muted">
                    Es de {c.nombre} · venta {c.conversion_id}{c.pendiente > 0 ? ` · faltan ${formatCurrency(c.pendiente)}` : ''}
                    {c.motivos.length === 2 ? ' ✓✓' : ''}
                  </button>
                ))}
                <EnlazarAVenta alEnlazar={(v) => confirmar(m.id, v)} />
                <button onClick={() => descartar(m.id)}
                  className="h-7 px-2 rounded border border-destructive/30 text-destructive text-xs hover:bg-destructive-soft">
                  Descartar
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
