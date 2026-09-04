import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Key, WarningCircle, Clock, ShieldCheck, Eye, EyeSlash, Plus,
  ClockCounterClockwise, MagnifyingGlass, EnvelopeSimple, CreditCard, PencilSimple, Trash,
  ChartBar, WhatsappLogo, Cloud, ShoppingBag, Robot, Lightning, Copy,
} from '@phosphor-icons/react';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import { toast } from '@/shared/hooks/useToast';
import { credencialesApi, type Credencial, type Hueco } from '../api/credenciales.api';
import DialogoClave from '../components/DialogoClave';
import RegistroClaves from '../components/RegistroClaves';

/**
 * Claves y variables, tarea #80.
 *
 * Antes, para saber qué clave de Brevo estaba puesta había que entrar por SSH a
 * tres máquinas y leer ficheros. Eso hizo que `/testeo` llevara sin clave desde
 * siempre sin que nadie lo supiera, y que dos claves de producción acabaran
 * escritas en un chat para poder consultarlas.
 *
 * Dos cosas que esta pantalla NO hace, y son a propósito:
 *
 *   · **No guarda ningún valor en memoria.** Lo que llega del listado son los
 *     cuatro últimos caracteres. Pulsar «Ver» pide el valor al servidor, se
 *     enseña, y al cerrarlo se olvida — no queda en el estado de React ni en
 *     ninguna caché.
 *   · **No enseña nada sin dejar rastro.** Cada «Ver» queda anotado en el
 *     servidor con quién y cuándo.
 */

const ICONO: Record<string, { Icon: typeof Key; color: string; que: string }> = {
  brevo:       { Icon: EnvelopeSimple, color: 'bg-primary/10 text-primary',                       que: 'Correo transaccional' },
  stripe:      { Icon: CreditCard,     color: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400', que: 'Cobros y suscripciones' },
  meta:        { Icon: ChartBar,       color: 'bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400',         que: 'Meta Ads' },
  google_ads:  { Icon: ChartBar,       color: 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400',     que: 'Google Ads' },
  gsc:         { Icon: MagnifyingGlass,color: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400', que: 'Search Console' },
  woocommerce: { Icon: ShoppingBag,    color: 'bg-orange-50 text-orange-600 dark:bg-orange-950/30 dark:text-orange-400', que: 'Tienda y pedidos' },
  evolution:   { Icon: WhatsappLogo,   color: 'bg-green-50 text-green-600 dark:bg-green-950/30 dark:text-green-400',     que: 'Puente de WhatsApp' },
  r2:          { Icon: Cloud,          color: 'bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400',             que: 'Almacenamiento' },
  make:        { Icon: Lightning,      color: 'bg-pink-50 text-pink-600 dark:bg-pink-950/30 dark:text-pink-400',         que: 'Automatizaciones' },
  claude:      { Icon: Robot,          color: 'bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400', que: 'Análisis con IA' },
};
const deServicio = (s: string) => ICONO[s] || { Icon: Key, color: 'bg-muted text-muted-foreground', que: '' };

const NOMBRE: Record<string, string> = {
  brevo: 'Brevo', stripe: 'Stripe', meta: 'Meta Ads', google_ads: 'Google Ads',
  gsc: 'Search Console', woocommerce: 'WooCommerce', evolution: 'Evolution',
  r2: 'Cloudflare R2', make: 'Make', claude: 'Claude',
};

/** «hace 12 min», «hace 5 meses», «nunca». */
function hace(iso: string | null): string {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 31) return `hace ${d} día${d > 1 ? 's' : ''}`;
  const m = Math.floor(d / 30);
  return `hace ${m} mes${m > 1 ? 'es' : ''}`;
}

/** Lleva sin usarse más de 90 días: candidata a estar de más. */
const olvidada = (iso: string | null) =>
  !!iso && (Date.now() - new Date(iso).getTime()) > 90 * 24 * 3600 * 1000;

export default function ClavesPage() {
  const [claves, setClaves] = useState<Credencial[]>([]);
  const [huecos, setHuecos] = useState<Hueco[]>([]);
  const [cargando, setCargando] = useState(true);
  const [entorno, setEntorno] = useState<'produccion' | 'pruebas' | 'todos'>('produccion');
  const [busca, setBusca] = useState('');
  // El valor revelado vive AQUI y solo aquí: una credencial a la vez, y se
  // borra al cerrarla. No entra en `claves` ni en ninguna caché.
  const [visible, setVisible] = useState<{ id: number; value: string } | null>(null);
  // `undefined` = cerrado; `null` = alta; una clave = cambio.
  const [editando, setEditando] = useState<Credencial | null | undefined>(undefined);
  const [verRegistro, setVerRegistro] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const [l, p] = await Promise.all([credencialesApi.listar(), credencialesApi.paridad()]);
      if (l.success) setClaves(l.data as Credencial[]);
      if (p.success) setHuecos(p.data as Hueco[]);
    } catch (e) {
      toast({ title: 'No se pudieron cargar las claves', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  async function ver(id: number) {
    if (visible?.id === id) { setVisible(null); return; }
    try {
      const r = await credencialesApi.revelar(id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      setVisible({ id, value: (r.data as { value: string }).value });
    } catch (e) {
      toast({ title: 'No se pudo mostrar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  async function borrar(c: Credencial) {
    // Sin vuelta atras y sobre una credencial que puede estar en uso: se
    // pregunta con el nombre delante, no con un «¿seguro?».
    const nombre = `${NOMBRE[c.service] || c.service}${c.project_nombre ? ` de ${c.project_nombre}` : ''} (${c.entorno})`;
    if (!window.confirm(`Se va a borrar la clave de ${nombre}.

Lo que la use dejara de funcionar en cuanto se despliegue. ¿Seguir?`)) return;
    try {
      const r = await credencialesApi.borrar(c.id);
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo');
      toast({ title: 'Clave borrada' });
      if (visible?.id === c.id) setVisible(null);
      cargar();
    } catch (e) {
      toast({ title: 'No se pudo borrar', description: (e as Error).message, variant: 'destructive' });
    }
  }

  const mostradas = useMemo(() => claves.filter((c) => {
    if (entorno !== 'todos' && c.entorno !== entorno) return false;
    if (!busca.trim()) return true;
    const t = busca.toLowerCase();
    return (NOMBRE[c.service] || c.service).toLowerCase().includes(t)
        || (c.project_nombre || '').toLowerCase().includes(t);
  }), [claves, entorno, busca]);

  const sinUsar = claves.filter((c) => olvidada(c.last_used_at)).length;

  return (
    <div className="space-y-5 pb-8">
      <PageHeader
        title="Claves y variables"
        subtitle="Qué hay puesto en cada proyecto y en cada entorno · solo soporte y superadmin"
        actions={
          <>
            <button
              onClick={() => setVerRegistro(true)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-sm font-medium hover:bg-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
              <ClockCounterClockwise size={14} weight="bold" /> Registro
            </button>
            <button
              onClick={() => setEditando(null)}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
              <Plus size={14} weight="bold" /> Añadir clave
            </button>
          </>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <KpiCard icon={Key} label="Claves guardadas" numericValue={claves.length} />
        <KpiCard
          icon={WarningCircle} iconBg="bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-400"
          label="Huecos entre entornos" numericValue={huecos.length}
        />
        <KpiCard
          icon={Clock} iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          label="Sin usarse en 90 días" numericValue={sinUsar}
        />
        <KpiCard
          icon={ShieldCheck} iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
          label="Proyectos cubiertos" numericValue={new Set(claves.map((c) => c.project_id)).size}
        />
      </div>

      {/* El aviso que motivó el ticket: si esto hubiera existido, no se habría
          perdido la mañana buscando en el código por qué no salían los correos. */}
      {huecos.length > 0 && (
        <div className="flex gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4">
          <WarningCircle size={20} weight="fill" className="text-amber-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">
              {huecos.length === 1 ? 'Falta una clave en un entorno' : `Faltan ${huecos.length} claves entre entornos`}
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400 mt-0.5 leading-relaxed">
              {huecos.map((h, i) => (
                <span key={`${h.service}-${h.project_id}`}>
                  {i > 0 && ' · '}
                  <strong>{NOMBRE[h.service] || h.service}</strong>
                  {h.project_nombre ? ` en ${h.project_nombre}` : ''} falta en <strong>{h.falta_en}</strong>
                </span>
              ))}
              . Las tareas que las usan arrancan y no hacen nada, sin avisar.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex bg-muted rounded-lg p-0.5 gap-0.5">
          {(['produccion', 'pruebas', 'todos'] as const).map((e) => (
            <button
              key={e} onClick={() => setEntorno(e)}
              className={`h-8 px-3 rounded-md text-[13px] font-semibold transition-colors ${
                entorno === e ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {e === 'produccion' ? 'Producción' : e === 'pruebas' ? 'Pruebas' : 'Los dos'}
            </button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[180px]">
          <MagnifyingGlass size={16} className="absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="search" value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por servicio o proyecto…"
            className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-sm
                       focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        {cargando ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : !mostradas.length ? (
          <EmptyState icon={Key} title="Ninguna clave guardada aquí"
            description="Las que están en el .env de cada servidor no salen todavía en este panel." />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] uppercase text-muted-foreground">
                <th className="text-left font-bold px-4 py-2.5">Servicio</th>
                <th className="text-left font-bold px-4 py-2.5">Proyecto</th>
                <th className="text-left font-bold px-4 py-2.5">Entorno</th>
                <th className="text-left font-bold px-4 py-2.5">Valor</th>
                <th className="text-left font-bold px-4 py-2.5">Quién y cuándo</th>
                <th className="text-left font-bold px-4 py-2.5">Último uso</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {mostradas.map((c) => {
                const { Icon, color, que } = deServicio(c.service);
                const abierta = visible?.id === c.id;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 ${color}`}>
                          <Icon size={16} weight="regular" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{NOMBRE[c.service] || c.service}</p>
                          {que && <p className="text-xs text-muted-foreground truncate">{que}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">{c.project_nombre || <span className="text-muted-foreground">— global</span>}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        c.entorno === 'produccion'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-secondary text-secondary-foreground'}`}>
                        {c.entorno === 'produccion' ? 'Producción' : 'Pruebas'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <code className="text-[13px] text-muted-foreground break-all">
                        {abierta ? visible.value : `••••${c.cola || '····'}`}
                      </code>
                      {abierta && (
                        <button
                          onClick={() => { navigator.clipboard?.writeText(visible.value); toast({ title: 'Copiada al portapapeles' }); }}
                          aria-label="Copiar la clave"
                          className="ml-2 text-muted-foreground hover:text-foreground align-middle"
                        ><Copy size={14} weight="bold" /></button>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-[13px]">{c.puesta_por || '—'}</p>
                      <p className="text-xs text-muted-foreground">{hace(c.updated_at)}</p>
                    </td>
                    <td className={`px-4 py-3 text-xs ${olvidada(c.last_used_at) ? 'text-amber-600 font-semibold' : 'text-muted-foreground'}`}>
                      {hace(c.last_used_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <button
                          onClick={() => ver(c.id)}
                          aria-label={abierta ? 'Ocultar la clave' : 'Ver la clave entera'}
                          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-primary/20
                                     bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 transition-colors
                                     focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          {abierta ? <EyeSlash size={14} weight="bold" /> : <Eye size={14} weight="bold" />}
                          {abierta ? 'Ocultar' : 'Ver'}
                        </button>
                        <button
                          onClick={() => setEditando(c)}
                          aria-label={`Cambiar la clave de ${NOMBRE[c.service] || c.service}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border
                                     bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors
                                     focus:outline-none focus:ring-2 focus:ring-primary/40"
                        ><PencilSimple size={14} weight="bold" /></button>
                        <button
                          onClick={() => borrar(c)}
                          aria-label={`Borrar la clave de ${NOMBRE[c.service] || c.service}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border
                                     bg-card text-muted-foreground hover:text-destructive hover:border-destructive/30
                                     transition-colors focus:outline-none focus:ring-2 focus:ring-destructive/40"
                        ><Trash size={14} weight="bold" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        El listado nunca trae el valor: solo los cuatro últimos caracteres. Pulsar <strong>Ver</strong> es
        otra llamada y <strong>queda registrada</strong> — quién lo miró y cuándo.
      </p>

      {editando !== undefined && (
        <DialogoClave
          clave={editando}
          onCerrar={() => setEditando(undefined)}
          onGuardada={cargar}
        />
      )}
      {verRegistro && <RegistroClaves onCerrar={() => setVerRegistro(false)} />}
    </div>
  );
}
