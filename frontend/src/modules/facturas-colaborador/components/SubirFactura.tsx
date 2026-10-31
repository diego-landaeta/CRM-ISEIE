import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle, Copy, FilePdf, Plus, Trash, UploadSimple, WarningCircle } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import { Button } from '@/shared/components/ui/button';
import Field from '@/shared/components/ui/Field';
import FilaCampos from '@/shared/components/ui/FilaCampos';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import {
  avisoDelPdf, calcularDesglose, euros, normalizarImporte, MONEDAS, MONEDA_ES, simbolo,
  type DesgloseEnvio, type Moneda, type FacturaDelColaborador, type LineaForm,
} from '../api/facturasColaborador.api';

/*
  La factura de un mes, tal como la ve el colaborador (#202): por su enlace
  personal o desde «Mi factura». Lo de la «Definición acordada · Diego, 01/10»
  → «Página del enlace»: quién, mes y empresa; lo acordado; «Factura a nombre
  de» con un botón para copiar los datos; el archivo, el importe (con lo
  acordado ya puesto) y el número de factura. Si el importe no coincide con lo
  acordado, se hace notar y se deja enviar. Con desglose (segunda parte), el
  importe viene con su total y lo acordado se compara con la base.

  Si cuadra lo dice el PDF (corrección de Diego del 13/10): el servidor lee su
  total al subirlo y lo compara con lo escrito. Antes de enviar no se sabe, así
  que aquí ya no se avisa de «no cuadra» comparando con el desglose; después de
  enviar, sí se dice qué pone el PDF si no es lo escrito, o que no se pudo leer.
*/

const TOPE = 10 * 1024 * 1024;
const TIPOS = ['application/pdf', 'image/jpeg', 'image/png'];

function datosFiscales(f: FacturaDelColaborador) {
  const e = f.empresa;
  return [e.razon_social, e.nif ? `NIF ${e.nif}` : null, e.direccion, [e.cp, e.ciudad].filter(Boolean).join(' ') || null, e.pais]
    .filter(Boolean).join('\n');
}

const cuando = (iso: string) => {
  const d = new Date(iso);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `el ${dos(d.getDate())}/${dos(d.getMonth() + 1)} a las ${dos(d.getHours())}:${dos(d.getMinutes())}`;
};

export default function SubirFactura({ factura, alSubir, alNoFacturar, alDeshacerNoFacturar }: {
  factura: FacturaDelColaborador;
  /** Manda el formulario; devuelve la factura ya recibida o lanza el error del servidor. */
  alSubir: (archivo: File, importe: string, numero: string, desglose: DesgloseEnvio) => Promise<void>;
  /**
   * «Este mes no facturo a esta empresa» (Diego, 31/10). Solo en la página del enlace:
   * sin esto no se ofrece.
   */
  alNoFacturar?: (motivo: string) => Promise<void>;
  alDeshacerNoFacturar?: () => Promise<void>;
}) {
  const f = factura;
  // Ids propios: en «Mi factura» puede haber varios formularios montados a la vez (uno por mes pendiente).
  const uid = useId();
  // El desglose (segunda parte): las horas del mes, o una línea por encargo.
  const [horas, setHoras] = useState('');
  const [lineas, setLineas] = useState<LineaForm[]>([{ concepto: '', project_id: '', horas: '' }]);
  const cambiarLinea = (i: number, campo: keyof LineaForm, valor: string) =>
    setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));
  const calculo = f.cobro ? calcularDesglose(f.cobro, horas, lineas) : null;
  const [archivo, setArchivo] = useState<File | null>(null);
  // «Este mes no facturo» (31/10): primero se pregunta, con un motivo opcional.
  const [noFacturo, setNoFacturo] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [marcando, setMarcando] = useState(false);
  async function marcarNoFacturo(deshacer = false) {
    setMarcando(true);
    try {
      if (deshacer) await alDeshacerNoFacturar?.();
      else await alNoFacturar?.(motivo.trim());
      setNoFacturo(false);
    } catch (err: any) {
      toast({ title: 'No se pudo guardar', description: err?.data?.error || err?.message, variant: 'destructive' });
    } finally {
      setMarcando(false);
    }
  }
  // El importe sugerido: sin desglose, lo acordado (primera parte, «con el acordado ya
  // sugerido»); con desglose, su total, que sigue a las horas hasta que lo cambie a mano.
  // Lo acordado es la base (el ejemplo de Diego: 600 acordados, 636 de total con IVA e IRPF):
  // sugerirlo y compararlo con el total avisaba siempre, aunque la factura estuviera bien.
  const [escrito, setEscrito] = useState(!f.cobro && f.importe_acordado !== null ? String(f.importe_acordado).replace('.', ',') : '');
  const [tocado, setTocado] = useState(false);
  const sugerido = calculo && calculo.total > 0 ? calculo.total.toFixed(2).replace('.', ',') : '';
  const importe = calculo && !tocado ? sugerido : escrito;
  const [numero, setNumero] = useState('');
  // La moneda de su factura (247, 31/10): sale la de su ficha y la puede cambiar (Andrea factura en dólares).
  const [moneda, setMoneda] = useState<Moneda>(f.moneda || 'EUR');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);

  // Recargar o cerrar la página con la factura a medias lo borra todo: el navegador
  // avisa antes (Diana, prueba a mano del 12/10). Solo con algo puesto por la persona:
  // lo que rellena el CRM solo (el total del desglose, lo acordado) no cuenta.
  const aMedias = archivo !== null || numero.trim() !== '' || horas.trim() !== '' || tocado
    || lineas.some((l) => l.concepto.trim() !== '' || l.horas.trim() !== '');
  useEffect(() => {
    // Ya recibida (o anulada o caducada) no queda nada que perder: sin aviso.
    if (!aMedias || enviando || f.recibida || ['anulada', 'caducado'].includes(f.estado)) return undefined;
    const avisar = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [aMedias, enviando, f.recibida, f.estado]);

  const importeNum = Number(normalizarImporte(importe));
  // Con desglose, lo acordado se compara con la base; sin él, con el importe (como en la primera parte).
  const comparado = calculo ? calculo.base : (importe.trim() !== '' ? importeNum : NaN);
  const noCoincide = f.importe_acordado !== null && Number.isFinite(comparado) && (!calculo || calculo.base > 0)
    && Math.abs(comparado - f.importe_acordado) > 0.005;
  // Si cambió a mano el total sugerido, solo se le recuerda cuánto da su desglose. Ya no es
  // «no cuadra»: lo que cuenta es que lo escrito sea lo que pone su PDF (Diego, 13/10).
  const otroQueElDesglose = calculo !== null && calculo.total > 0 && importe.trim() !== ''
    && Number.isFinite(importeNum) && Math.abs(importeNum - calculo.total) > 0.005;

  function elegir(a: File | null | undefined) {
    setError(null);
    if (!a) return;
    if (!TIPOS.includes(a.type)) { setError('Tiene que ser un PDF o una foto JPG o PNG.'); return; }
    if (a.size > TOPE) { setError('El archivo pasa de 10 MB.'); return; }
    setArchivo(a);
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(datosFiscales(f));
      toast({ title: 'Datos copiados' });
    } catch {
      toast({ title: 'No se pudieron copiar', description: 'Selecciónalos y cópialos a mano.', variant: 'destructive' });
    }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo) { setError('Elige el archivo de tu factura.'); return; }
    if (!importe.trim()) { setError('Escribe el importe de tu factura.'); return; }
    if (!numero.trim()) { setError('Escribe el número de tu factura.'); return; }
    const desglose: DesgloseEnvio = { moneda };
    if (f.cobro?.modalidad === 'hora') {
      if (!horas.trim()) { setError('Escribe las horas del mes.'); return; }
      desglose.horas = horas.trim();
    }
    if (f.cobro?.modalidad === 'proyecto') {
      const mal = lineas.findIndex((l) => !l.concepto.trim() || !l.horas.trim());
      if (mal >= 0) { setError(`Escribe qué hiciste y las horas en el encargo ${mal + 1}.`); return; }
      desglose.lineas = JSON.stringify(lineas.map((l) => ({
        concepto: l.concepto.trim(), project_id: l.project_id ? Number(l.project_id) : null, horas: l.horas.trim(),
      })));
    }
    setEnviando(true);
    setError(null);
    try {
      // Tal cual: lo normaliza el servidor (hacerlo dos veces convertía «12,500» en 12500).
      await alSubir(archivo, importe.trim(), numero.trim(), desglose);
    } catch (err: any) {
      setError(err?.data?.error || err?.message || 'No se pudo enviar la factura.');
    } finally {
      setEnviando(false);
    }
  }

  const cabecera = (
    <div className="flex flex-wrap items-center gap-3">
      {f.empresa.logo_url && <img src={f.empresa.logo_url} alt="" className="h-9 w-auto max-w-[120px] object-contain" />}
      <div className="min-w-0">
        <h2 className="text-base font-semibold">{f.colaborador} · {f.mes} · {f.empresa.razon_social}</h2>
        {f.importe_acordado !== null && (
          <p className="text-xs text-muted-foreground">
            {/* Con desglose, lo acordado es la base: que no parezca que su factura (con IVA e IRPF) está mal. */}
            Importe acordado{f.cobro ? ' (base, sin IVA ni IRPF)' : ''}: <strong className="text-foreground">{euros(f.importe_acordado, f.moneda)}</strong>
          </p>
        )}
      </div>
    </div>
  );

  // ── Estados en los que ya no se sube nada ──
  if (f.estado === 'recibida' && f.recibida) {
    // Lo que dice el PDF frente a lo escrito (13/10): si no cuadra o no se pudo leer, se dice claro.
    const aviso = avisoDelPdf(f.recibida, f.moneda);
    return (
      <div className="space-y-4">
        {cabecera}
        <div className="rounded-lg bg-success-soft text-success-soft-foreground p-4 flex gap-3">
          <CheckCircle size={22} weight="fill" className="shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold">Factura recibida {cuando(f.recibida.subida_at)} · {f.recibida.numero_recepcion}</p>
            <p className="text-xs">
              {f.recibida.archivo} · {euros(f.recibida.importe, f.moneda)} · n.º {f.recibida.numero_factura}
            </p>
          </div>
        </div>
        {aviso && <Aviso neutro={f.recibida.cuadra === null}>{aviso}</Aviso>}
      </div>
    );
  }
  if (f.estado === 'sin_factura') {
    return (
      <div className="space-y-4">
        {cabecera}
        <Aviso neutro>
          Has indicado que este mes no facturas a {f.empresa.razon_social}. No te llegará el recordatorio.
        </Aviso>
        {alDeshacerNoFacturar && (
          <Button type="button" variant="outline" disabled={marcando} onClick={() => marcarNoFacturo(true)}>
            {marcando ? 'Guardando…' : 'Me equivoqué: sí voy a facturar este mes'}
          </Button>
        )}
      </div>
    );
  }
  if (f.estado === 'anulada') {
    return (
      <div className="space-y-4">
        {cabecera}
        <Aviso>Esta factura se anuló. Te llegará un enlace nuevo para subirla otra vez.</Aviso>
      </div>
    );
  }
  if (f.estado === 'caducado') {
    return (
      <div className="space-y-4">
        {cabecera}
        <Aviso>Este enlace ha caducado. Pide uno nuevo a administración.</Aviso>
      </div>
    );
  }

  return (
    <form onSubmit={enviar} className="space-y-5" noValidate>
      {cabecera}

      <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-muted-foreground">Factura a nombre de</p>
          <Button type="button" variant="outline" size="sm" onClick={copiar}>
            <Copy size={13} className="mr-1.5" /> Copiar datos
          </Button>
        </div>
        <p className="whitespace-pre-line text-sm">{datosFiscales(f)}</p>
      </div>

      <Field label="Archivo de tu factura" hint="PDF o foto (JPG, PNG), hasta 10 MB" required>
        <div
          role="button"
          tabIndex={0}
          aria-label="Elegir el archivo de la factura"
          onClick={() => entrada.current?.click()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); entrada.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }}
          onDragLeave={() => setArrastrando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastrando(false); elegir(e.dataTransfer.files?.[0]); }}
          className={`flex items-center gap-3 rounded-lg border-2 border-dashed p-4 cursor-pointer transition-colors ${
            arrastrando ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40'
          }`}
        >
          {archivo ? <FilePdf size={22} className="text-primary shrink-0" /> : <UploadSimple size={22} className="text-muted-foreground shrink-0" />}
          <span className="text-sm min-w-0 truncate">
            {archivo ? `${archivo.name} · ${Math.ceil(archivo.size / 1024)} KB` : 'Arrástralo aquí o pulsa para elegirlo'}
          </span>
          <input
            ref={entrada}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => elegir(e.target.files?.[0])}
          />
        </div>
      </Field>

      {f.cobro && calculo && (
        // El desglose («Añadido 01/10 (tarde)»): fijo, ya relleno; por hora, sus
        // horas; por proyecto, una línea por encargo. La tarifa es la de su ficha.
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-sm font-semibold">Tu desglose</p>

          {f.cobro.modalidad === 'fijo' && (
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">{f.cobro.concepto}</span>
              <span className="tabular-nums font-medium">{euros(f.cobro.importe_fijo, f.moneda)}</span>
            </div>
          )}

          {f.cobro.modalidad === 'hora' && (
            <div className="flex flex-wrap items-end gap-3 text-sm">
              <div className="w-32">
                <label htmlFor={`${uid}-horas`} className="text-xs text-muted-foreground">Horas del mes</label>
                <input id={`${uid}-horas`} inputMode="decimal" autoComplete="off" value={horas} onChange={(e) => setHoras(e.target.value)} className={inputClass} />
              </div>
              <span className="pb-2 text-muted-foreground">× {euros(f.cobro.tarifa_hora, f.moneda)}/h = <strong className="text-foreground tabular-nums">{euros(calculo.base, f.moneda)}</strong></span>
            </div>
          )}

          {f.cobro.modalidad === 'proyecto' && (
            <div className="space-y-2">
              {lineas.map((l, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_11rem_6rem_auto] gap-2 items-end">
                  <div>
                    <label htmlFor={`${uid}-linea-${i}`} className="text-xs text-muted-foreground">Encargo {i + 1}</label>
                    <input autoComplete="off" id={`${uid}-linea-${i}`} value={l.concepto} maxLength={200} onChange={(e) => cambiarLinea(i, 'concepto', e.target.value)}
                      className={inputClass} />
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground">Proyecto o campus</span>
                    <Select<string> value={l.project_id} onChange={(v) => cambiarLinea(i, 'project_id', v)} ariaLabel={`Proyecto de la línea ${i + 1}`}
                      options={[{ value: '', label: 'Toda la empresa' }, ...(f.campus ?? []).map((p) => ({ value: String(p.id), label: p.nombre }))]} />
                  </div>
                  <div>
                    <label htmlFor={`${uid}-horas-${i}`} className="text-xs text-muted-foreground">Horas</label>
                    <input id={`${uid}-horas-${i}`} inputMode="decimal" autoComplete="off" value={l.horas} onChange={(e) => cambiarLinea(i, 'horas', e.target.value)}
                      className={inputClass} />
                  </div>
                  <Button type="button" variant="ghost" size="sm" title="Quitar la línea" aria-label={`Quitar la línea ${i + 1}`}
                    disabled={lineas.length === 1} onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash size={15} />
                  </Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setLineas((ls) => [...ls, { concepto: '', project_id: '', horas: '' }])}>
                  <Plus size={13} className="mr-1.5" /> Añadir encargo
                </Button>
                <span className="text-xs text-muted-foreground">Tu tarifa: {euros(f.cobro.tarifa_hora, f.moneda)}/h</span>
              </div>
            </div>
          )}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 border-t border-border pt-3 text-sm tabular-nums">
            <dt className="text-muted-foreground">Base</dt><dd className="text-right">{euros(calculo.base, f.moneda)}</dd>
            <dt className="text-muted-foreground">IVA ({f.cobro.iva_pct} %)</dt><dd className="text-right">{euros(calculo.iva, f.moneda)}</dd>
            <dt className="text-muted-foreground">IRPF ({f.cobro.irpf_pct} %)</dt>
            <dd className="text-right">{calculo.irpf ? '−' : ''}{euros(calculo.irpf, f.moneda)}</dd>
            <dt className="font-semibold">Total</dt><dd className="text-right font-semibold">{euros(calculo.total, f.moneda)}</dd>
          </dl>
        </div>
      )}

      <FilaCampos>
        <Field label={`Importe de tu factura (${simbolo(moneda)})`} htmlFor={`${uid}-importe`} required
          // Con desglose y aún sin total (sin horas), no se dice «ya puesto»: no hay nada puesto.
          hint={calculo ? (tocado ? undefined : sugerido
            ? 'Ya está puesto el total de tu desglose: cámbialo si tu factura dice otro importe'
            : 'Se rellena solo con el total de tu desglose')
            : noCoincide ? undefined : (f.importe_acordado !== null ? 'Ya está puesto lo acordado: cámbialo si tu factura dice otro importe' : undefined)}>
          <input id={`${uid}-importe`} inputMode="decimal" autoComplete="off" value={importe}
            onChange={(e) => { setTocado(true); setEscrito(e.target.value); }}
            // Texto y no una cifra de ejemplo: el «600,00» gris se leía como si fuera lo acordado.
            placeholder="Escribe el importe de tu factura" className={inputClass} />
        </Field>
        <Field label="Moneda" required>
          <Select<Moneda> value={moneda} onChange={setMoneda} ariaLabel="Moneda de tu factura"
            options={MONEDAS.map((m) => ({ value: m, label: MONEDA_ES[m] }))} />
        </Field>
        <Field label="Número de tu factura" htmlFor={`${uid}-numero`} required>
          <input autoComplete="off" id={`${uid}-numero`} value={numero} onChange={(e) => setNumero(e.target.value)}
            placeholder="Escribe el número de tu factura" maxLength={60} className={inputClass} />
        </Field>
      </FilaCampos>

      {noCoincide && (
        <p className="rounded-md bg-warning-soft text-warning-soft-foreground px-3 py-2 text-xs">
          {calculo
            ? <>La base de tu desglose ({euros(calculo.base, f.moneda)}) no coincide con lo acordado ({euros(f.importe_acordado, f.moneda)}). Puedes enviarla igual.</>
            : <>El importe no coincide con lo acordado ({euros(f.importe_acordado, f.moneda)}). Puedes enviarla igual.</>}
        </p>
      )}
      {otroQueElDesglose && calculo && (
        <p className="text-xs text-muted-foreground">
          Tu desglose da {euros(calculo.total, f.moneda)}. Escribe el total que pone tu factura: es lo que se compara con el PDF.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-destructive-soft text-destructive-soft-foreground px-3 py-2 text-xs">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        {f.caduca_at && (
          <p className="text-xs text-muted-foreground">
            El enlace es solo tuyo y caduca el {new Date(f.caduca_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}.
          </p>
        )}
        <Button type="submit" disabled={enviando} className="ml-auto">
          {enviando ? 'Enviando…' : 'Enviar factura'}
        </Button>
      </div>

      {/* «Este mes no facturo a esta empresa» (Diego, 31/10): para quien recibe un
          enlace por empresa y un mes solo trabajó para alguna. */}
      {alNoFacturar && (
        <div className="border-t border-border pt-4">
          {!noFacturo ? (
            <button type="button" onClick={() => setNoFacturo(true)} className="text-sm text-muted-foreground underline hover:text-foreground">
              Este mes no facturo a {f.empresa.razon_social}
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold">¿Seguro que este mes no facturas a {f.empresa.razon_social}?</p>
              <p className="text-sm text-muted-foreground">No te llegará el recordatorio. Si te equivocas, puedes deshacerlo desde este mismo enlace.</p>
              <input
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                maxLength={300}
                placeholder="Motivo (opcional): no trabajé para esta empresa este mes…"
                className={inputClass}
              />
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setNoFacturo(false)} disabled={marcando}>Cancelar</Button>
                <Button type="button" onClick={() => marcarNoFacturo(false)} disabled={marcando}>
                  {marcando ? 'Guardando…' : 'Sí, este mes no facturo'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </form>
  );
}

/** Neutro: lo que no es un fallo suyo (el PDF no se pudo leer), sin el tono de aviso. */
function Aviso({ children, neutro = false }: { children: React.ReactNode; neutro?: boolean }) {
  return (
    <div role="status" className={`rounded-lg p-4 flex gap-3 ${neutro ? 'bg-muted text-foreground' : 'bg-warning-soft text-warning-soft-foreground'}`}>
      <WarningCircle size={22} weight="fill" className="shrink-0" />
      <p>{children}</p>
    </div>
  );
}
