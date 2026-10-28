import { useCallback, useEffect, useState } from 'react';
import {
  Plus, ArrowClockwise, Trash, PencilSimple, PaperPlaneTilt, Key, Copy, X, Shuffle, ListBullets,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/hooks/useToast';
import { useAuth } from '@/contexts/AuthContext';
import { copyToClipboard } from '@/shared/lib/clipboard';
import usePermission from '@/shared/hooks/usePermission';
import {
  opcionesDeAmbito, ambitoDesdeOpcion, opcionDesdeWebhook, type CampusConEmpresa,
} from '@/modules/webhooks-salientes/api/webhooksSalientes.api';
import {
  asignacionApi, errorDeDestino, URL_ENTRADA,
  type ConfigAsignacion, type DecisionAsignacion, type TipoDestino, type EstadoEnvio,
} from '../api/asignacion.api';

/**
 * Conexión → «Asignación de leads» (CRM#513; Carlos y Diego, 27/10/2026).
 *
 * «Una gestora está activa si ha hecho al menos una acción válida en los últimos
 * 15 minutos.» El formulario entra por Make, que se lo pasa al CRM: con alguna
 * activa, el CRM crea el lead con ella y lo manda al escenario 2 (el nuevo, sin
 * la rotación por HTTP); sin ninguna, al escenario 1 (el de siempre).
 *
 * Solo super admin y admin (lo corta el servidor), como el webhook de transferencias.
 */

const TIPOS = [
  { value: 'mailhook' as TipoDestino, label: 'Mailhook (correo de Make)' },
  { value: 'webhook' as TipoDestino, label: 'Webhook (URL de Make)' },
];

function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : `hace ${Math.floor(h / 24)} d`;
}

const fechaHora = (iso: string) => new Date(iso).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });

function ParaQuien({ c }: { c: ConfigAsignacion }) {
  if (c.ambito === 'todas') return <span className="rounded bg-info-soft px-1.5 py-0.5 text-[10px] font-semibold text-info-soft-foreground">Todas las empresas</span>;
  if (c.ambito === 'empresa') return <span className="rounded bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success-soft-foreground">Toda {c.empresa || 'la empresa'}</span>;
  return <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">{c.proyecto || 'Un campus'}</span>;
}

/** La clave recién creada: se enseña una vez, con la dirección de la entrada. */
function ClaveUnaVez({ nombre, clave, onCerrar }: { nombre: string; clave: string; onCerrar: () => void }) {
  const copiar = async (t: string, que: string) => toast({ title: (await copyToClipboard(t)) ? `${que} copiada` : 'No se pudo copiar' });
  return (
    <div role="status" className="space-y-2 rounded-md border border-warning bg-warning-soft p-3 text-sm text-warning-soft-foreground">
      <p className="flex items-center gap-2 font-semibold"><Key size={15} /> Clave de la entrada de «{nombre}»: cópiala ahora</p>
      <p className="text-xs">No se vuelve a enseñar. En Make, la entrada hace un <b>POST</b> a esta dirección con la cabecera <code>Authorization: Bearer &lt;clave&gt;</code>.</p>
      {[['Dirección', URL_ENTRADA], ['Clave', clave]].map(([que, v]) => (
        <div key={que} className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-xs font-semibold">{que}</span>
          <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 font-mono text-xs text-foreground">{v}</code>
          <button type="button" onClick={() => copiar(v, que)} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">
            <Copy size={14} /> Copiar
          </button>
        </div>
      ))}
      <button type="button" onClick={onCerrar} className="inline-flex h-8 items-center rounded-md border border-border bg-card px-3 text-xs font-bold text-foreground hover:bg-muted">Ya la he copiado</button>
    </div>
  );
}

function CampoDestino({ n, tipo, valor, onTipo, onValor, esAlta, cola }: {
  n: 1 | 2; tipo: TipoDestino; valor: string; onTipo: (t: TipoDestino) => void; onValor: (v: string) => void; esAlta: boolean; cola?: string | null;
}) {
  const error = errorDeDestino(tipo, valor);
  return (
    <fieldset className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <legend className="px-1 text-xs font-semibold">
        {n === 1 ? 'Escenario 1 · el de siempre (sin nadie activa o con el CRM caído)' : 'Escenario 2 · el nuevo (con la gestora elegida)'}
      </legend>
      <Select value={tipo} onChange={onTipo} options={TIPOS} ariaLabel={`Tipo del escenario ${n}`} />
      <Field label={tipo === 'mailhook' ? 'Dirección del mailhook' : 'URL del webhook'} htmlFor={`asig-d${n}`} error={error}
        hint={!esAlta && !valor ? `Déjalo vacío para mantener el actual${cola ? ` (…${cola})` : ''}.` : undefined}>
        <input id={`asig-d${n}`} value={valor} onChange={(e) => onValor(e.target.value)} autoComplete="off"
          placeholder={tipo === 'mailhook' ? 'xxxxx@hook.eu2.make.com' : 'https://hook.eu2.make.com/…'} className={cn(inputClass, 'font-mono')} />
      </Field>
    </fieldset>
  );
}

function Dialogo({ config, proyectos, esSuperadmin, onCerrar, onGuardado }: {
  config: ConfigAsignacion | null; proyectos: CampusConEmpresa[]; esSuperadmin: boolean;
  onCerrar: () => void; onGuardado: (c: ConfigAsignacion) => void;
}) {
  const esAlta = config === null;
  const [nombre, setNombre] = useState(config?.nombre || '');
  const [para, setPara] = useState(config ? opcionDesdeWebhook(config) : '');
  const [activo, setActivo] = useState(config ? config.activo : true);
  const [ventana, setVentana] = useState(String(config?.ventana_min ?? 15));
  const [t1, setT1] = useState<TipoDestino>(config?.escenario1.tipo || 'mailhook');
  const [v1, setV1] = useState('');
  const [t2, setT2] = useState<TipoDestino>(config?.escenario2.tipo || 'mailhook');
  const [v2, setV2] = useState('');
  const [guardando, setGuardando] = useState(false);

  const minutos = Number(ventana);
  const errorVentana = !Number.isInteger(minutos) || minutos < 1 || minutos > 240 ? 'De 1 a 240 minutos' : undefined;
  const falta = !nombre.trim() || !para || !!errorVentana
    || (esAlta && (!v1.trim() || !v2.trim())) || !!errorDeDestino(t1, v1) || !!errorDeDestino(t2, v2)
    || (!esAlta && t1 !== config!.escenario1.tipo && !v1.trim()) || (!esAlta && t2 !== config!.escenario2.tipo && !v2.trim());

  async function guardar() {
    if (falta) return;
    setGuardando(true);
    try {
      const datos = {
        nombre: nombre.trim(), activo, ventana_min: minutos,
        ...(esAlta ? ambitoDesdeOpcion(para) : {}),
        ...(v1.trim() ? { escenario1: { tipo: t1, valor: v1.trim() } } : {}),
        ...(v2.trim() ? { escenario2: { tipo: t2, valor: v2.trim() } } : {}),
      };
      const r = esAlta ? await asignacionApi.crear(datos) : await asignacionApi.cambiar(config!.id, datos);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo guardar');
      toast({ title: esAlta ? 'Asignación creada' : 'Asignación guardada' });
      onGuardado(r.data as ConfigAsignacion);
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onCerrar}>
        <div role="dialog" aria-modal="true" aria-label={esAlta ? 'Nueva asignación de leads' : 'Editar asignación de leads'}
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-md border border-border bg-card shadow-sm" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h2 className="font-semibold">{esAlta ? 'Nueva asignación de leads' : `Editar · ${config!.nombre}`}</h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><X size={16} /></button>
          </div>
          <div className="space-y-3 p-5">
            <Field label="Nombre" required htmlFor="asig-nombre" hint="Para reconocerla en la lista.">
              <input id="asig-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={150} placeholder="ISEIE · formularios de la web" className={inputClass} />
            </Field>
            {esAlta ? (
              <Field label="Para quién" required hint="Con una de empresa o de todas, la entrada de Make tiene que mandar el campus (project_id o proyecto).">
                <Select value={para} onChange={setPara} ariaLabel="Para quién"
                  options={[{ value: '', label: 'Elige campus, empresa o todas' }, ...opcionesDeAmbito(proyectos, esSuperadmin)]} />
              </Field>
            ) : (
              <p className="text-xs text-muted-foreground">Para: <ParaQuien c={config!} /> (para cambiarlo, crea otra).</p>
            )}
            <Field label="Ventana de actividad (minutos)" required htmlFor="asig-ventana" error={errorVentana}
              hint="Activa = alguna acción en el CRM en estos últimos minutos.">
              <input id="asig-ventana" type="number" min={1} max={240} value={ventana} onChange={(e) => setVentana(e.target.value)} className={inputClass} />
            </Field>
            <CampoDestino n={1} tipo={t1} valor={v1} onTipo={setT1} onValor={setV1} esAlta={esAlta} cola={config?.escenario1.cola} />
            <CampoDestino n={2} tipo={t2} valor={v2} onTipo={setT2} onValor={setV2} esAlta={esAlta} cola={config?.escenario2.cola} />
            <label className="flex items-center gap-2 px-1 text-sm">
              <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
              Encendida (apagada, todo va al escenario 1)
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={onCerrar} className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">Cancelar</button>
            <button type="button" onClick={guardar} disabled={guardando || falta} title={falta ? 'Faltan campos obligatorios' : undefined}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {guardando ? 'Guardando…' : esAlta ? 'Crear' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}

const ESTADOS: Record<EstadoEnvio, string> = {
  pendiente: 'bg-warning-soft text-warning-soft-foreground', enviando: 'bg-info-soft text-info-soft-foreground',
  enviado: 'bg-success-soft text-success-soft-foreground', fallido: 'bg-destructive/10 text-destructive',
};

function Registro({ configs }: { configs: ConfigAsignacion[] }) {
  const [filas, setFilas] = useState<DecisionAsignacion[]>([]);
  const [filtro, setFiltro] = useState<{ destinoId: number | null; escenario: 1 | 2 | null; estado: EstadoEnvio | '' }>({ destinoId: null, escenario: null, estado: '' });
  const [cargando, setCargando] = useState(true);
  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await asignacionApi.decisiones(filtro);
      setFilas(r.success ? (r.data as DecisionAsignacion[]) : []);
    } finally { setCargando(false); }
  }, [filtro]);
  useEffect(() => { cargar(); }, [cargar]);

  async function reenviar(id: number) {
    try {
      const r = await asignacionApi.reenviar(id);
      toast({ title: r.data?.estado === 'enviado' ? 'Reenviado' : 'Se ha vuelto a intentar', description: r.data?.error || undefined });
      cargar();
    } catch (e: any) { toast({ title: 'No se pudo reenviar', description: e?.data?.error || e?.message, variant: 'destructive' }); }
  }

  return (
    <section className="space-y-3" aria-labelledby="asig-registro">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="asig-registro" className="mr-auto flex items-center gap-2 font-semibold"><ListBullets size={16} /> Registro de decisiones</h2>
        <Select<number | null> value={filtro.destinoId} onChange={(v) => setFiltro((f) => ({ ...f, destinoId: v }))} size="sm" ariaLabel="Configuración"
          options={[{ value: null, label: 'Todas las configuraciones' }, ...configs.map((c) => ({ value: c.id, label: c.nombre }))]} />
        <Select<1 | 2 | null> value={filtro.escenario} onChange={(v) => setFiltro((f) => ({ ...f, escenario: v }))} size="sm" ariaLabel="Escenario"
          options={[{ value: null, label: 'Los dos escenarios' }, { value: 2, label: 'Escenario 2 · con gestora' }, { value: 1, label: 'Escenario 1 · el de siempre' }]} />
        <Select<EstadoEnvio | ''> value={filtro.estado} onChange={(v) => setFiltro((f) => ({ ...f, estado: v }))} size="sm" ariaLabel="Estado del envío"
          options={[{ value: '', label: 'Cualquier estado' }, { value: 'enviado', label: 'Enviado' }, { value: 'pendiente', label: 'Pendiente' }, { value: 'fallido', label: 'Fallido' }]} />
        <button type="button" onClick={cargar} aria-label="Recargar" className="inline-flex h-8 items-center rounded-md border border-border px-2 hover:bg-muted"><ArrowClockwise size={14} /></button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">Cuándo</th><th className="px-3 py-2">Campus · formulario</th><th className="px-3 py-2">Escenario</th><th className="px-3 py-2">Gestora · por qué</th><th className="px-3 py-2">Envío</th></tr>
          </thead>
          <tbody>
            {filas.map((d) => (
              <tr key={d.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap px-3 py-2 tabular-nums">{fechaHora(d.created_at)}{d.prueba && <span className="ml-1 rounded bg-muted px-1 text-[10px]">prueba</span>}</td>
                <td className="px-3 py-2"><div className="font-medium">{d.proyecto}</div><div className="text-xs text-muted-foreground">{d.cliente || '—'}{d.cliente_email ? ` · ${d.cliente_email}` : ''}</div></td>
                <td className="whitespace-nowrap px-3 py-2">{d.escenario === 2 ? 'Escenario 2' : 'Escenario 1'}</td>
                <td className="px-3 py-2"><div className="font-medium">{d.responsable || '—'}{d.lead_id ? <span className="ml-1 text-xs text-muted-foreground">· lead #{d.lead_id}</span> : null}</div><div className="text-xs text-muted-foreground">{d.motivo?.texto || ''}</div></td>
                <td className="px-3 py-2">
                  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', ESTADOS[d.estado])}>{d.estado}</span>
                  {d.error && <div className="mt-1 max-w-[260px] text-xs text-destructive">{d.error}</div>}
                  {d.estado === 'fallido' && !d.prueba && (
                    <button type="button" onClick={() => reenviar(d.id)} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"><PaperPlaneTilt size={12} /> Reenviar</button>
                  )}
                </td>
              </tr>
            ))}
            {!filas.length && (
              <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted-foreground">{cargando ? 'Cargando…' : 'Todavía no ha entrado ningún formulario por la asignación.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function AsignacionLeadsPage() {
  const { user, projects } = useAuth() as { user: { role?: string } | null; projects: CampusConEmpresa[] };
  const { can } = usePermission();
  const esSuperadmin = user?.role === 'superadmin';
  const puedeEditar = can('webhooks_salientes.edit');
  const [configs, setConfigs] = useState<ConfigAsignacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [dialogo, setDialogo] = useState<ConfigAsignacion | null | undefined>(undefined);
  const [clave, setClave] = useState<{ nombre: string; clave: string } | null>(null);
  const [probando, setProbando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await asignacionApi.listar();
      setConfigs(r.success ? (r.data as ConfigAsignacion[]) : []);
    } finally { setCargando(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  async function probar(c: ConfigAsignacion, escenario: 1 | 2) {
    setProbando(`${c.id}-${escenario}`);
    try {
      const r = await asignacionApi.probar(c.id, escenario);
      const ok = r.data?.estado === 'enviado';
      toast({ title: ok ? `Prueba enviada al escenario ${escenario}` : `La prueba al escenario ${escenario} no llegó`, description: ok ? undefined : r.data?.error || undefined, variant: ok ? undefined : 'destructive' });
    } catch (e: any) {
      toast({ title: 'No se pudo probar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setProbando(null); }
  }

  async function nuevaClave(c: ConfigAsignacion) {
    if (!window.confirm(`¿Generar otra clave para «${c.nombre}»? La actual deja de valer y hay que cambiarla en Make.`)) return;
    try {
      const r = await asignacionApi.nuevaClave(c.id);
      if (r.data?.clave) setClave({ nombre: c.nombre, clave: r.data.clave });
      cargar();
    } catch (e: any) { toast({ title: 'No se pudo', description: e?.data?.error || e?.message, variant: 'destructive' }); }
  }

  async function borrar(c: ConfigAsignacion) {
    if (!window.confirm(`¿Borrar «${c.nombre}»? Sus formularios dejarán de repartirse por actividad (la entrada de Make recibirá 401 y los mandará al escenario 1).`)) return;
    try { await asignacionApi.borrar(c.id); toast({ title: 'Borrada' }); cargar(); } catch (e: any) {
      toast({ title: 'No se pudo borrar', description: e?.data?.error || e?.message, variant: 'destructive' });
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Asignación de leads" subtitle="A quién va cada formulario: a la gestora que está trabajando ahora o, si no hay nadie, al escenario de siempre."
        actions={puedeEditar ? (
          <button type="button" onClick={() => setDialogo(null)} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-bold text-primary-foreground hover:opacity-90">
            <Plus size={15} /> Nueva
          </button>
        ) : undefined} />

      <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-3 text-sm">
        <p><b>Cómo funciona.</b> La entrada de Make recibe el formulario y lo pasa al CRM. Si alguna gestora que recibe leads en ese campus ha trabajado en el CRM en los últimos minutos, el CRM crea el lead con ella (la que menos lleva hoy; si empatan, la que menos en total) y lo manda al <b>escenario 2</b>. Si no hay ninguna, lo manda al <b>escenario 1</b>, que lo crea como siempre. Si el CRM no contesta, la entrada de Make lo manda al escenario 1 por su cuenta.</p>
        <p className="text-xs text-muted-foreground">Dirección de la entrada (POST con <code>Authorization: Bearer &lt;clave&gt;</code>): <code className="break-all">{URL_ENTRADA}</code></p>
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">Qué cuenta como «activa»</summary>
          <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-muted-foreground">
            <li>Cualquier acción en el CRM en los últimos minutos de la ventana (15 de serie): llamada, correo o WhatsApp registrado, nota, cambio de estado, recordatorio, paso del proceso, editar un prospecto, crear un lead, una venta, un cobro, una matrícula o una factura.</li>
            <li>También los WhatsApp que manda desde su móvil con el número conectado (no los de grupos ni el historial que baja al conectar el número).</li>
            <li>No cuentan: abrir una ficha, guardar sin cambiar nada, tener la sesión abierta, una nota de menos de 20 caracteres o repetida, ni un cambio de estado deshecho en menos de 10 minutos.</li>
            <li>Entre varias activas: la que menos leads lleva hoy en ese campus (hora de Valencia), luego la que menos en total allí, y luego la que lleva más rato sin recibir uno. Cada campus reparte aparte: lo que reciba en otro no cuenta.</li>
            <li>WhatsApp: con esto encendido, el botón de WhatsApp de la web lleva a la gestora activa a la que le toca. Pulsarlo no asigna nada; cuenta cuando la persona le escribe o cuando se registra el lead.</li>
          </ul>
        </details>
        <details className="text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">Cómo montarlo en Make, paso a paso</summary>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5 text-muted-foreground">
            <li>Aquí: <b>Nueva</b>, elige el campus y pon el mailhook o la URL del <b>escenario 1</b> (el de siempre) y del <b>escenario 2</b> (el nuevo). Copia la clave: solo se enseña una vez.</li>
            <li>En Make, el <b>escenario 2</b> es una copia del de siempre <b>sin</b> la rotación por HTTP y <b>sin</b> crear el lead (el CRM ya lo ha creado con la gestora). Recibe lo mismo que el formulario y además <code>gestora</code>, <code>responsable_id</code>, <code>responsable_email</code>, <code>responsable_nombre</code> y <code>lead_id</code>.</li>
            <li>La <b>entrada</b> (mailhook o webhook del formulario) hace un POST a la dirección de arriba con la clave y estos campos: <code>uid</code> (único por formulario: si Make lo reenvía, no se duplica), <code>nombre</code>, <code>email</code> o <code>telefono</code>, y los demás del formulario tal cual. Si es un correo, mándalo en <code>original</code> (<code>asunto</code>, <code>html</code>, <code>texto</code>) y saldrá igual hacia el escenario.</li>
            <li>En ese módulo HTTP de Make pon un tiempo máximo de 5 segundos y una ruta de error: si el CRM no contesta o contesta con error, la entrada manda el formulario al <b>escenario 1</b>. Si contesta bien, no hace nada más: el CRM ya lo ha mandado al escenario que toca.</li>
            <li>Prueba con <b>Probar escenario 1</b> y <b>Probar escenario 2</b>, y mira abajo el <b>Registro de decisiones</b>: a quién fue cada formulario, por qué y si llegó.</li>
          </ol>
        </details>
      </div>

      {clave && <ClaveUnaVez nombre={clave.nombre} clave={clave.clave} onCerrar={() => setClave(null)} />}

      {!cargando && !configs.length ? (
        <EmptyState icon={Shuffle} title="Ningún campus reparte todavía por actividad" description="Crea una para un campus o una empresa con los destinos de sus escenarios 1 y 2 de Make." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {configs.map((c) => (
            <article key={c.id} className="space-y-2 rounded-md border border-border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="mr-auto font-semibold">{c.nombre}</h3>
                <ParaQuien c={c} />
                <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold', c.activo ? 'bg-success-soft text-success-soft-foreground' : 'bg-muted text-muted-foreground')}>{c.activo ? 'Encendida' : 'Apagada'}</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Activa si</dt><dd>alguna acción en los últimos {c.ventana_min} min</dd>
                <dt className="text-muted-foreground">Escenario 1</dt><dd>{c.escenario1.tipo === 'mailhook' ? 'Mailhook' : 'Webhook'} …{c.escenario1.cola}</dd>
                <dt className="text-muted-foreground">Escenario 2</dt><dd>{c.escenario2.tipo === 'mailhook' ? 'Mailhook' : 'Webhook'} …{c.escenario2.cola}</dd>
                <dt className="text-muted-foreground">Clave</dt><dd>…{c.clave_cola}</dd>
                <dt className="text-muted-foreground">Último formulario</dt><dd>{hace(c.ultima_decision_at)}{c.fallidos_30_dias ? <span className="ml-2 text-destructive">{c.fallidos_30_dias} envíos fallidos en 30 días</span> : null}</dd>
              </dl>
              {puedeEditar && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <button type="button" onClick={() => setDialogo(c)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted"><PencilSimple size={13} /> Editar</button>
                  {([1, 2] as const).map((n) => (
                    <button key={n} type="button" onClick={() => probar(c, n)} disabled={probando === `${c.id}-${n}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted disabled:opacity-50">
                      <PaperPlaneTilt size={13} /> {probando === `${c.id}-${n}` ? 'Probando…' : `Probar escenario ${n}`}
                    </button>
                  ))}
                  <button type="button" onClick={() => nuevaClave(c)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold hover:bg-muted"><Key size={13} /> Otra clave</button>
                  <button type="button" onClick={() => borrar(c)} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs font-semibold text-destructive hover:bg-destructive/10"><Trash size={13} /> Borrar</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      <Registro configs={configs} />

      {dialogo !== undefined && (
        <Dialogo config={dialogo} proyectos={projects || []} esSuperadmin={esSuperadmin} onCerrar={() => setDialogo(undefined)}
          onGuardado={(c) => { setDialogo(undefined); if (c.clave) setClave({ nombre: c.nombre, clave: c.clave }); cargar(); }} />
      )}
    </div>
  );
}
