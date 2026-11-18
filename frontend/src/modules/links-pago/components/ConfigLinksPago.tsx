import { useCallback, useEffect, useState } from 'react';
import { Percent, FloppyDisk, Broadcast, CheckCircle, MinusCircle, WarningCircle } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import {
  verConfig, guardarConfig, verWebhook, cambiarWebhook,
  type ConfigLinks, type WebhookDeLaCuenta,
} from '../api/linksPago.api';

/*
  INTEGRACIONES › LINKS DE PAGO: lo que configura el admin (CRM#680, fase 2).

  Diego, 17/11: «todo lo de Stripe se configura desde la web», por campus y con
  `links_pago.configurar`. Dos bloques dentro de la tarjeta de la clave:

    · las reglas del campus: descuento máximo, caducidad (por defecto y
      máxima), cuotas (si las admite y cuántas) y monedas (admitidas y por
      defecto);
    · el webhook de la cuenta de Stripe: el que se creó el 16/11, que se
      reutiliza (el CRM no crea otro). Se ve si está activo y qué escucha, se le
      añaden los eventos de los links y se activa o desactiva.
*/

function errorDe(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red';
}

const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm tabular-nums';

type Borrador = {
  descuento_max_pct: string; caducidad_dias: string; caducidad_max_dias: string;
  cuotas_admitidas: boolean; cuotas_max: string; monedas: string; moneda_defecto: string;
};

function aBorrador(c: Partial<ConfigLinks>): Borrador {
  const t = (v: unknown) => (v === undefined || v === null ? '' : String(v));
  return {
    descuento_max_pct: t(c.descuento_max_pct),
    caducidad_dias: t(c.caducidad_dias),
    caducidad_max_dias: t(c.caducidad_max_dias),
    cuotas_admitidas: c.cuotas_admitidas !== false,
    cuotas_max: t(c.cuotas_max),
    monedas: (c.monedas || []).join(', '),
    moneda_defecto: c.moneda_defecto || '',
  };
}

const listaDeMonedas = (txt: string) => [...new Set(txt.split(/[\s,;]+/).map((m) => m.trim().toUpperCase()).filter(Boolean))];

/** Lo que ha cambiado respecto a lo guardado, ya con su tipo. */
function cambiosDe(b: Borrador, g: Partial<ConfigLinks>): Partial<Omit<ConfigLinks, 'project_id'>> {
  const num = (s: string) => Number(s.replace(',', '.'));
  const c: Partial<Omit<ConfigLinks, 'project_id'>> = {};
  if (b.descuento_max_pct.trim() !== '' && num(b.descuento_max_pct) !== g.descuento_max_pct) c.descuento_max_pct = num(b.descuento_max_pct);
  if (b.caducidad_dias.trim() !== '' && num(b.caducidad_dias) !== g.caducidad_dias) c.caducidad_dias = num(b.caducidad_dias);
  if (b.caducidad_max_dias.trim() !== '' && num(b.caducidad_max_dias) !== g.caducidad_max_dias) c.caducidad_max_dias = num(b.caducidad_max_dias);
  if (g.cuotas_admitidas !== undefined && b.cuotas_admitidas !== g.cuotas_admitidas) c.cuotas_admitidas = b.cuotas_admitidas;
  if (b.cuotas_max.trim() !== '' && num(b.cuotas_max) !== g.cuotas_max) c.cuotas_max = num(b.cuotas_max);
  const mon = listaDeMonedas(b.monedas);
  if (mon.length && mon.join(',') !== (g.monedas || []).join(',')) c.monedas = mon;
  if (b.moneda_defecto && b.moneda_defecto !== g.moneda_defecto) c.moneda_defecto = b.moneda_defecto;
  return c;
}

export function ReglasDeLosLinks({ projectId }: { projectId: number }) {
  const [guardado, setGuardado] = useState<Partial<ConfigLinks> | null>(null);
  const [b, setB] = useState<Borrador>(aBorrador({}));
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setGuardado(null);
    setB(aBorrador({}));
    // Una respuesta que llega tarde, de otro campus, no pisa la de este.
    let vigente = true;
    verConfig(projectId)
      .then((res) => { if (vigente && res.success && res.data) { setGuardado(res.data); setB(aBorrador(res.data)); } })
      .catch(() => { /* la tarjeta sigue sirviendo para la clave */ });
    return () => { vigente = false; };
  }, [projectId]);

  const cambios = guardado ? cambiosDe(b, guardado) : {};
  const hayCambios = Object.keys(cambios).length > 0;
  const monedas = listaDeMonedas(b.monedas);
  const poner = (k: keyof Borrador) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setB((x) => ({ ...x, [k]: e.target.value }));

  async function guardar() {
    setGuardando(true);
    try {
      const res = await guardarConfig(projectId, cambios);
      if (res.success && res.data) {
        setGuardado(res.data);
        setB(aBorrador(res.data));
        toast({ title: 'Reglas de los links guardadas', description: 'Valen para los links que se creen desde ahora.' });
      }
    } catch (e) {
      toast({ title: 'No se han podido guardar', description: errorDe(e), variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  const id = (s: string) => `links-${s}-${projectId}`;
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <div>
        <p className="text-sm font-semibold">Reglas de los links en este campus</p>
        <p className="text-xs text-muted-foreground">
          Lo que puede elegir la gestora al crear un link. Ella no configura nada de Stripe.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={id('descuento')} className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-1">
            <Percent size={12} weight="bold" aria-hidden="true" /> Descuento máximo en este campus
          </label>
          <div className="relative w-28">
            <input id={id('descuento')} type="number" inputMode="decimal" min={0} max={100} step={0.5}
              value={b.descuento_max_pct} onChange={poner('descuento_max_pct')}
              className={`${campo} pr-7 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground" aria-hidden="true">%</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Sobre el precio del catálogo. Con 0, solo el admin descuenta.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={id('caducidad')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Caduca a los (días)</label>
            <input id={id('caducidad')} type="number" min={1} max={365} value={b.caducidad_dias} onChange={poner('caducidad_dias')} className={campo} />
          </div>
          <div>
            <label htmlFor={id('caducidad-max')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Máximo (días)</label>
            <input id={id('caducidad-max')} type="number" min={1} max={365} value={b.caducidad_max_dias} onChange={poner('caducidad_max_dias')} className={campo} />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-muted-foreground mb-1 flex items-center gap-2">
            <input type="checkbox" checked={b.cuotas_admitidas}
              onChange={(e) => setB((x) => ({ ...x, cuotas_admitidas: e.target.checked }))} />
            Admite cuotas mensuales
          </label>
          <div className="flex items-center gap-2">
            <label htmlFor={id('cuotas-max')} className="text-xs text-muted-foreground">Como mucho</label>
            <input id={id('cuotas-max')} type="number" min={2} max={36} value={b.cuotas_max} onChange={poner('cuotas_max')}
              disabled={!b.cuotas_admitidas} className={`${campo} w-20 disabled:opacity-50`} />
            <span className="text-xs text-muted-foreground">cuotas</span>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">Los links en cuotas llegan en la siguiente fase; la regla ya queda puesta.</p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor={id('monedas')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Monedas admitidas</label>
            <input id={id('monedas')} type="text" value={b.monedas} onChange={poner('monedas')}
              placeholder="EUR, USD" className={`${campo} uppercase`} />
          </div>
          <div>
            <label htmlFor={id('moneda-defecto')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Por defecto</label>
            <select id={id('moneda-defecto')} value={b.moneda_defecto} onChange={poner('moneda_defecto')} className={campo}>
              {!monedas.includes(b.moneda_defecto) && b.moneda_defecto && <option value={b.moneda_defecto}>{b.moneda_defecto}</option>}
              {monedas.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      </div>

      <button type="button" onClick={guardar} disabled={guardando || !hayCambios}
        className="inline-flex items-center gap-1.5 h-10 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
        <FloppyDisk size={14} weight="bold" aria-hidden="true" /> {guardando ? 'Guardando…' : 'Guardar reglas'}
      </button>
    </div>
  );
}

export function WebhookDeLaCuentaBloque({ projectId }: { projectId: number }) {
  const [we, setWe] = useState<WebhookDeLaCuenta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await verWebhook(projectId);
      setWe(res.data || null);
    } catch (e) {
      setWe(null);
      setError(errorDe(e));
    } finally { setCargando(false); }
  }, [projectId]);
  useEffect(() => { cargar(); }, [cargar]);

  async function hacer(accion: 'anadir_eventos' | 'activar' | 'desactivar') {
    const otros = (we?.comparten || []).filter((c) => c.id !== projectId);
    const aviso = otros.length ? `\n\nLa cuenta la comparten también: ${otros.map((c) => c.nombre).join(', ')}. El cambio les afecta.` : '';
    const textos = {
      anadir_eventos: `¿Añadir al webhook los eventos de los links de pago? Los que ya escucha se quedan.${aviso}`,
      activar: `¿Activar el webhook? Stripe empezará a avisar al CRM de cada cobro.${aviso}`,
      desactivar: `¿Desactivar el webhook? Los cobros seguirán entrando por el sondeo cada 5 minutos.${aviso}`,
    };
    if (!confirm(textos[accion])) return;
    setOcupado(true);
    try {
      const res = await cambiarWebhook(projectId, accion);
      setWe(res.data || null);
      toast({ title: res.data?.cambiado === false ? 'Ya los tenía todos' : 'Webhook cambiado' });
    } catch (e) {
      toast({ title: 'No se ha podido cambiar', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  const boton = 'inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50';
  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-xs">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Broadcast size={14} weight="bold" aria-hidden="true" /> Webhook de la cuenta de Stripe
      </p>
      <p className="text-muted-foreground">
        El que ya tiene la cuenta hacia el CRM (no se crea otro). Necesita que la clave de arriba lleve
        <em> Webhook Endpoints</em> con escritura.
      </p>
      {cargando && <p className="text-muted-foreground">Mirando en Stripe…</p>}
      {!cargando && error && <p role="alert" className="text-destructive-soft-foreground">{error}</p>}
      {!cargando && we && !we.vinculado && (
        <p className="text-warning-soft-foreground">
          Este campus no tiene ningún webhook de Stripe guardado en su integración. No se crea uno desde aquí.
        </p>
      )}
      {!cargando && we?.vinculado && we.existe === false && (
        <p className="text-warning-soft-foreground">
          El webhook guardado (<code>{we.endpoint_id}</code>) ya no existe en Stripe.
        </p>
      )}
      {!cargando && we?.vinculado && we.existe && (
        <>
          <p className="flex flex-wrap items-center gap-2">
            {we.activo
              ? <span className="inline-flex items-center gap-1 text-success-soft-foreground font-semibold"><CheckCircle size={12} weight="fill" aria-hidden="true" /> Activo</span>
              : <span className="inline-flex items-center gap-1 text-muted-foreground font-semibold"><MinusCircle size={12} aria-hidden="true" /> Desactivado</span>}
            <code className="bg-muted px-1 rounded text-[10px]">{we.endpoint_id}</code>
            <span className="text-muted-foreground">· escucha {we.eventos?.includes('*') ? 'todos los eventos' : `${we.eventos?.length || 0} eventos`}</span>
          </p>
          {we.faltan.length > 0 ? (
            <p className="text-warning-soft-foreground flex items-start gap-1">
              <WarningCircle size={12} weight="fill" className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>Le faltan los de los links: {we.faltan.join(', ')}.</span>
            </p>
          ) : (
            <p className="text-success-soft-foreground">Escucha todo lo que necesitan los links.</p>
          )}
          {(we.comparten || []).length > 1 && (
            <p className="text-muted-foreground">
              Cuenta compartida con: {(we.comparten || []).filter((c) => c.id !== projectId).map((c) => c.nombre).join(', ')}.
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {we.faltan.length > 0 && (
              <button type="button" disabled={ocupado} onClick={() => hacer('anadir_eventos')} className={boton}>
                Añadir los eventos de los links
              </button>
            )}
            {we.activo
              ? <button type="button" disabled={ocupado} onClick={() => hacer('desactivar')} className={boton}>Desactivar</button>
              : <button type="button" disabled={ocupado} onClick={() => hacer('activar')} className={boton}>Activar</button>}
          </div>
        </>
      )}
    </div>
  );
}
