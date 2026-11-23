import { useCallback, useEffect, useState } from 'react';
import { Ticket, Plus, Prohibit } from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import {
  listarCodigos, crearCodigo, desactivarCodigo, verConfig, textoDelCodigo,
  type CodigoPromocional, type ConfigLinks,
} from '../api/linksPago.api';

/*
  INTEGRACIONES › LINKS DE PAGO › CÓDIGOS PROMOCIONALES (CRM#986).

  Diego, 21/11/2026: «códigos promocionales de Stripe en el link, con fecha
  límite, para campañas». Quien configura crea aquí el código de cada campaña:
  lo que escribe el alumno (BLACKFRIDAY), cuánto descuenta (en % o en una moneda
  del campus), hasta cuándo vale (obligatorio) y, si se quiere, cuántas veces. El
  CRM crea en Stripe el cupón y el código con esa fecha límite. Desactivarlo lo
  apaga en Stripe al momento.

  Los códigos de Stripe son de la cuenta: si varios campus la comparten, un
  código vale en los links de todos los que admitan códigos.
*/

function errorDe(e: unknown) {
  const err = e as { data?: { error?: string }; message?: string };
  return err?.data?.error || err?.message || 'Error de red';
}

const hoyEnMadrid = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date());
const fecha = (s: string) => {
  const [a, m, d] = String(s).slice(0, 10).split('-');
  return d && m && a ? `${d}/${m}/${a}` : s;
};

const campo = 'w-full h-10 px-3 rounded-md border border-border bg-card text-sm';
const ESTADO: Record<CodigoPromocional['estado'], string> = {
  vigente: 'text-success-soft-foreground',
  caducado: 'text-muted-foreground',
  desactivado: 'text-muted-foreground line-through',
};

export default function CodigosPromocionales({ projectId }: { projectId: number }) {
  const [cfg, setCfg] = useState<ConfigLinks | null>(null);
  const [lista, setLista] = useState<CodigoPromocional[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [campana, setCampana] = useState('');
  const [tipo, setTipo] = useState<'pct' | 'monto'>('pct');
  const [valor, setValor] = useState('');
  const [moneda, setMoneda] = useState('');
  const [caduca, setCaduca] = useState('');
  const [usos, setUsos] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [c, l] = await Promise.all([verConfig(projectId), listarCodigos(projectId)]);
      setCfg(c.data || null);
      setMoneda((m) => m || c.data?.moneda_defecto || 'EUR');
      setLista(Array.isArray(l.data) ? l.data : []);
    } catch (e) {
      setError(errorDe(e));
    } finally { setCargando(false); }
  }, [projectId]);
  useEffect(() => { cargar(); }, [cargar]);
  // Al guardar las reglas de arriba (encender o apagar los códigos), sin recargar.
  useEffect(() => {
    const alGuardar = (e: Event) => {
      const c = (e as CustomEvent<ConfigLinks>).detail;
      if (c && Number(c.project_id) === Number(projectId)) setCfg(c);
    };
    window.addEventListener('links-pago:config', alGuardar);
    return () => window.removeEventListener('links-pago:config', alGuardar);
  }, [projectId]);

  const v = Number(valor.replace(',', '.'));
  const hoy = hoyEnMadrid();
  const motivos: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(codigo.trim())) motivos.push('El código, de 3 a 40 letras o números, sin espacios.');
  if (!(v > 0)) motivos.push('Escribe el descuento.');
  else if (tipo === 'pct' && v > 100) motivos.push('El descuento no puede pasar del 100 %.');
  if (!caduca) motivos.push('Elige la fecha límite.');
  else if (caduca < hoy) motivos.push('La fecha límite no puede ser anterior a hoy.');
  if (usos.trim() && !(Number(usos) >= 1)) motivos.push('Los usos máximos, de 1 en adelante (o vacío: sin límite).');

  async function crear() {
    if (motivos.length) return;
    setOcupado(true);
    try {
      const r = await crearCodigo(projectId, {
        codigo: codigo.trim().toUpperCase(), tipo, valor: v, caduca_el: caduca,
        ...(tipo === 'monto' ? { moneda } : {}),
        ...(usos.trim() ? { max_usos: Number(usos) } : {}),
        ...(campana.trim() ? { campana: campana.trim() } : {}),
      });
      toast({ title: `Código ${r.data?.codigo || ''} creado`, description: 'Ya se puede usar en los links de pago único del campus.' });
      setCodigo(''); setCampana(''); setValor(''); setUsos(''); setCaduca(''); setAbierto(false);
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha creado el código', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  async function desactivar(c: CodigoPromocional) {
    if (!confirm(`¿Desactivar el código ${c.codigo}? Deja de valer en Stripe al momento, también en los links ya enviados.`)) return;
    setOcupado(true);
    try {
      await desactivarCodigo(projectId, c.id);
      toast({ title: `Código ${c.codigo} desactivado` });
      await cargar();
    } catch (e) {
      toast({ title: 'No se ha podido desactivar', description: errorDe(e), variant: 'destructive' });
    } finally { setOcupado(false); }
  }

  const id = (s: string) => `codigos-${s}-${projectId}`;
  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-xs" data-recorrido="links-codigos">
      <p className="text-sm font-semibold flex items-center gap-1.5">
        <Ticket size={14} weight="bold" aria-hidden="true" /> Códigos promocionales de campaña
      </p>
      <p className="text-muted-foreground">
        Lo que escribe el alumno al pagar un link de pago único, con su fecha límite. El descuento queda en la venta.
      </p>
      {cargando && <p className="text-muted-foreground">Cargando…</p>}
      {!cargando && error && <p role="alert" className="text-destructive-soft-foreground">{error}</p>}
      {!cargando && cfg && !cfg.codigos_promo && (
        <p className="text-warning-soft-foreground">
          Este campus no admite códigos: actívalos en las reglas de arriba («Códigos promocionales en los links») y guarda.
        </p>
      )}

      {!cargando && lista.length > 0 && (
        <ul className="divide-y divide-border border border-border rounded-md">
          {lista.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-2">
              <code className={`font-semibold ${ESTADO[c.estado]}`}>{c.codigo}</code>
              <span className="tabular-nums">−{textoDelCodigo(c)}</span>
              <span className="text-muted-foreground">hasta el {fecha(c.caduca_el)}</span>
              {c.max_usos ? <span className="text-muted-foreground">· {c.max_usos} usos como mucho</span> : null}
              {c.campana ? <span className="text-muted-foreground">· {c.campana}</span> : null}
              <span className="text-muted-foreground">· {c.estado}</span>
              {c.estado === 'vigente' && (
                <button type="button" disabled={ocupado} onClick={() => desactivar(c)}
                  className="ml-auto inline-flex items-center gap-1 h-8 px-2.5 rounded-md border border-border bg-card font-semibold hover:bg-muted disabled:opacity-50">
                  <Prohibit size={12} weight="bold" aria-hidden="true" /> Desactivar
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!cargando && !error && lista.length === 0 && cfg?.codigos_promo && (
        <p className="text-muted-foreground">Todavía no hay ningún código.</p>
      )}

      {cfg?.codigos_promo && !abierto && (
        <button type="button" onClick={() => setAbierto(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-semibold hover:bg-muted">
          <Plus size={14} weight="bold" aria-hidden="true" /> Nuevo código
        </button>
      )}
      {cfg?.codigos_promo && abierto && (
        <div className="rounded-md bg-muted/30 p-2.5 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label htmlFor={id('codigo')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Código</label>
              <input id={id('codigo')} type="text" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())}
                placeholder="BLACKFRIDAY" maxLength={40} className={`${campo} uppercase font-mono`} />
            </div>
            <div>
              <label htmlFor={id('campana')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Campaña (opcional)</label>
              <input id={id('campana')} type="text" value={campana} onChange={(e) => setCampana(e.target.value)} maxLength={120}
                placeholder="Black Friday 2026" className={campo} />
            </div>
            <div>
              <label htmlFor={id('valor')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Descuento</label>
              <div className="flex gap-2">
                <input id={id('valor')} type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)}
                  className={`${campo} tabular-nums`} />
                <select aria-label="Tipo de descuento" value={tipo === 'pct' ? 'pct' : moneda}
                  onChange={(e) => { if (e.target.value === 'pct') setTipo('pct'); else { setTipo('monto'); setMoneda(e.target.value); } }}
                  className="h-10 px-2 rounded-md border border-border bg-card text-sm">
                  <option value="pct">%</option>
                  {(cfg.monedas || []).map((mon) => <option key={mon} value={mon}>{mon}</option>)}
                </select>
              </div>
              {tipo === 'monto' && <p className="text-[11px] text-muted-foreground mt-1">Solo vale en links en {moneda}.</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor={id('caduca')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Vale hasta</label>
                <input id={id('caduca')} type="date" min={hoy} value={caduca} onChange={(e) => setCaduca(e.target.value)} className={campo} />
              </div>
              <div>
                <label htmlFor={id('usos')} className="text-[11px] font-semibold text-muted-foreground mb-1 block">Usos máximos</label>
                <input id={id('usos')} type="number" min={1} value={usos} onChange={(e) => setUsos(e.target.value)}
                  placeholder="Sin límite" className={`${campo} tabular-nums`} />
              </div>
            </div>
          </div>
          {motivos.length > 0 && (codigo || valor || caduca) && (
            <ul className="text-[11px] text-muted-foreground list-disc pl-4">{motivos.map((x) => <li key={x}>{x}</li>)}</ul>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={crear} disabled={ocupado || motivos.length > 0}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50">
              {ocupado ? 'Creando…' : 'Crear código'}
            </button>
            <button type="button" onClick={() => setAbierto(false)} disabled={ocupado}
              className="inline-flex items-center h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted">
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
