import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EnvelopeSimple, MagnifyingGlass, X, ArrowClockwise, TrayArrowDown, GearSix,
} from '@phosphor-icons/react';
import { toast } from '@/shared/hooks/useToast';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import { Button } from '@/shared/components/ui/button';
import RangoRapido from '@/shared/components/ui/RangoRapido';
import usePermission from '@/shared/hooks/usePermission';
import { correosApi, type CorreoEnLista, type CorreoCompleto, type Buzon } from '../api/correos.api';
import BuzonesDialog from '../components/BuzonesDialog';
// El recorrido guiado de la pantalla (#619, tanda E; gemela de CRM#941).
import VerRecorrido from '@/shared/components/ui/VerRecorrido';

/**
 * La Bandeja de correos (CRM-ISEIE#701, gemela de CRM#146 y CRM#1032).
 *
 * Diego, 23/11: «poder conectar varios correos de Hostinger como hicimos en
 * CEDIA», y lo mismo en ISEIE. Aquí se ve lo que LLEGA a los buzones conectados
 * (facturación, soporte, admisiones…): uno elegido o todos juntos, cada correo
 * con la etiqueta de su buzón. Se conectan en «Buzones» (`correos.buzones`).
 *
 * DIFERENCIA CON EL 360, a propósito: solo lo recibido. En ISEIE el envío sigue
 * por Brevo con su plantilla (Diego, CRM#1058: «por ahora solo leer») y lo que
 * sale no guarda su texto; eso se mira en Status › Correos.
 *
 * El CRM abre los buzones en SOLO LECTURA: no marca, no borra, no mueve nada.
 */

/** «María Eugenia · admisiones@…», o la dirección sola si no es de nadie del CRM. */
const conNombre = (nombre: string | null | undefined, direccion: string) => (nombre ? `${nombre} · ${direccion}` : direccion);

const cuando = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} `
    + `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/**
 * El texto del correo, AISLADO. Lo que entra no lo escribimos nosotros: puede
 * traer cualquier HTML. Va en un iframe con `sandbox` SIN `allow-scripts`, así
 * que ningún script del correo se ejecuta ni toca el CRM (el 360 lo pinta con
 * `dangerouslySetInnerHTML`; aquí no). `allow-same-origin` solo sirve para medir
 * su alto desde fuera; los enlaces se abren en otra pestaña.
 */
function CuerpoDelCorreo({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [alto, setAlto] = useState(240);
  const documento = '<!doctype html><html><head><meta charset="utf-8"><base target="_blank">'
    + '<style>body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#18181b;background:#fff;'
    + 'overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>'
    + html + '</body></html>';
  const medir = () => {
    try {
      const h = ref.current?.contentDocument?.documentElement?.scrollHeight;
      if (h) setAlto(Math.min(Math.max(h, 120), 4000));
    } catch { /* sin acceso, se queda el alto de serie */ }
  };
  return (
    <iframe
      ref={ref}
      title="Texto del correo"
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={documento}
      onLoad={medir}
      style={{ height: alto, colorScheme: 'light' }}
      className="w-full border border-border rounded-md bg-white"
    />
  );
}

export default function CorreosPage() {
  const [filas, setFilas] = useState<CorreoEnLista[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [trayendo, setTrayendo] = useState(false);
  const [busca, setBusca] = useState('');
  const [rango, setRango] = useState({ from: '', to: '' });
  const [abierto, setAbierto] = useState<CorreoCompleto | null>(null);
  const [abriendo, setAbriendo] = useState<number | null>(null);
  const [buzones, setBuzones] = useState<Buzon[]>([]);
  // '' = todos los buzones; si no, el id del elegido.
  const [buzon, setBuzon] = useState<string>('');
  const [gestionando, setGestionando] = useState(false);
  const { can } = usePermission();
  const puedeConectar = can('correos.buzones');
  const puedeTraer = can('correos.sincronizar');

  const cargarBuzones = useCallback(async () => {
    try {
      const r = await correosApi.buzones();
      if (r.success) {
        setBuzones(r.data);
        // Si el elegido ya no está (se quitó), vuelta a todos.
        setBuzon((b) => (b && !r.data.some((x) => String(x.id) === b) ? '' : b));
      }
    } catch { /* sin buzones, la Bandeja funciona igual */ }
  }, []);

  useEffect(() => { cargarBuzones(); }, [cargarBuzones]);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await correosApi.listar({
        busca: busca || null,
        desde: rango.from || null, hasta: rango.to || null,
        buzon: buzon ? Number(buzon) : null,
      });
      if (r.success) { setFilas(r.data.filas); setTotal(r.data.total); }
    } catch (e) {
      toast({ title: 'No se pudo cargar la Bandeja', description: (e as Error).message, variant: 'destructive' });
    } finally { setCargando(false); }
  }, [busca, rango.from, rango.to, buzon]);

  /** Lee ahora los buzones. El servidor ya lo hace solo cada media hora. */
  async function traerDelBuzon() {
    setTrayendo(true);
    try {
      // El elegido, o todos los que ve quien pulsa.
      const r = await correosApi.sincronizar(buzon ? Number(buzon) : null);
      const fallidos = (r.data.buzones || []).filter((b) => b.motivo === 'ERROR');
      if (r.success && r.data.motivo === 'SIN_BUZON') {
        toast({
          title: 'No hay buzones conectados',
          description: puedeConectar
            ? 'Conéctalos en «Buzones».'
            : 'Pide a una administradora que conecte el buzón.',
        });
      } else if (r.success && r.data.motivo === 'ERROR') {
        toast({
          title: 'No se pudo leer el buzón',
          description: fallidos.map((b) => `${b.nombre}: ${b.detalle || 'sin conexión'}`).join(' · ') || r.data.detalle,
          variant: 'destructive',
        });
      } else if (r.success) {
        toast({
          title: r.data.nuevos > 0 ? `${r.data.nuevos} correos nuevos` : 'Nada nuevo en el buzón',
          description: `Leídos ${r.data.leidos}.`
            + (fallidos.length ? ` No se pudo leer: ${fallidos.map((b) => b.nombre).join(', ')}.` : ''),
        });
      }
      await Promise.all([cargar(), cargarBuzones()]);
    } catch (e) {
      toast({ title: 'No se pudo leer el buzón', description: (e as Error).message, variant: 'destructive' });
    } finally { setTrayendo(false); }
  }

  // Al escribir no se pide en cada tecla: se espera a que pare.
  useEffect(() => {
    const t = setTimeout(cargar, busca ? 350 : 0);
    return () => clearTimeout(t);
  }, [cargar, busca]);

  async function abrir(c: CorreoEnLista) {
    setAbriendo(c.id);
    try {
      const r = await correosApi.uno(c.id);
      if (r.success) setAbierto(r.data);
    } catch (e) {
      toast({ title: 'No se pudo abrir el correo', description: (e as Error).message, variant: 'destructive' });
    } finally { setAbriendo(null); }
  }

  return (
    /* El margen de scroll de lo que señala el recorrido (#619, tanda E). */
    <div className="space-y-4 [&_[data-recorrido]]:scroll-mt-40 max-sm:[&_[data-recorrido]]:scroll-mt-64">
      <PageHeader
        title="Correos"
        subtitle="Lo que llega a los buzones conectados, con su texto"
        actions={<VerRecorrido id="correos" listo={!cargando} />}
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div data-recorrido="correos-buscar" className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <div className="flex items-center gap-2 h-8 px-2.5 rounded-md border border-border bg-card w-full sm:w-auto sm:min-w-[15rem]">
          <MagnifyingGlass size={13} className="text-muted-foreground shrink-0" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por remitente o asunto…"
            aria-label="Buscar"
            className="flex-1 bg-transparent text-sm outline-none min-w-0"
          />
          {busca && (
            <button type="button" onClick={() => setBusca('')} aria-label="Limpiar"
              className="text-muted-foreground hover:text-foreground">
              <X size={12} weight="bold" />
            </button>
          )}
        </div>

        <RangoRapido valor={rango} alElegir={setRango} />
        </div>

        {/* El buzón: uno, o todos juntos con su etiqueta. Solo si hay más de uno. */}
        {buzones.length > 1 && (
          <select
            value={buzon}
            onChange={(e) => setBuzon(e.target.value)}
            aria-label="Buzón"
            data-recorrido="correos-elegir-buzon"
            className="h-8 px-2 rounded-md border border-border bg-card text-xs font-medium max-w-full sm:max-w-[14rem]"
          >
            <option value="">Todos los buzones</option>
            {buzones.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        )}

        <div className="sm:ml-auto flex flex-wrap items-center gap-2" data-recorrido="correos-buzon">
          {puedeConectar && (
            <Button variant="outline" size="sm" onClick={() => setGestionando(true)}>
              <GearSix size={13} weight="bold" className="mr-1.5" />
              Buzones{buzones.length ? ` (${buzones.length})` : ''}
            </Button>
          )}
          {puedeTraer && (
            <Button variant="outline" size="sm" onClick={traerDelBuzon} disabled={trayendo}>
              <TrayArrowDown size={13} weight="bold" className="mr-1.5" />
              {trayendo ? 'Leyendo…' : 'Traer del buzón'}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={cargar} disabled={cargando}>
            <ArrowClockwise size={13} weight="bold" className="mr-1.5" />
            {cargando ? 'Cargando…' : 'Actualizar'}
          </Button>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden" data-recorrido="correos-lista">
        <div className="px-4 py-2.5 border-b border-border text-sm text-muted-foreground">
          {total} {total === 1 ? 'correo recibido' : 'correos recibidos'}
        </div>

        {filas.length === 0 ? (
          <EmptyState
            icon={EnvelopeSimple}
            title={cargando ? 'Cargando…' : 'Ningún correo con esos filtros'}
            description={buzones.length
              ? 'Aquí aparece lo que llega a los buzones conectados. Se leen solos cada media hora.'
              : 'Aún no hay buzones conectados. Conéctalos en «Buzones» y lo que llegue aparecerá aquí.'}
          />
        ) : (
          <div className="divide-y divide-border">
            {filas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => abrir(c)}
                disabled={abriendo === c.id}
                className="w-full text-left px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 hover:bg-muted/40 transition-colors"
              >
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-24">
                  {cuando(c.cuando)}
                </span>
                {/* En lo que entra, lo que se lee de un vistazo es QUIÉN escribe. */}
                <span className="text-sm truncate min-w-0 basis-full sm:basis-auto sm:min-w-[12rem] flex-1">
                  <span className="font-medium">{conNombre(c.de_quien, c.remitente || '(sin remitente)')}</span>
                  <span className="text-muted-foreground"> · {c.asunto}</span>
                </span>
                {/* El buzón por el que entró. */}
                {c.buzon_nombre && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-info-soft text-info-soft-foreground font-semibold shrink-0 max-w-full truncate"
                    title={c.buzon_direccion || undefined}>
                    {c.buzon_nombre}
                  </span>
                )}
                {!c.buzon_id && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-semibold shrink-0">
                    Buzón del servidor
                  </span>
                )}
                {c.campus && (
                  <span className="text-[11px] font-semibold text-muted-foreground shrink-0">{c.campus}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {gestionando && (
        <BuzonesDialog
          onCerrar={() => setGestionando(false)}
          onCambio={() => { cargarBuzones(); cargar(); }}
        />
      )}

      {/* El correo. z-[75]: por encima del botón de atajos (z-[70]) y por debajo de
          los avisos de confirmación (z-[80]). `!m-0`: la capa es hija del `space-y-4` y, sin él, el margen
          la baja 16 px y deja una franja sin oscurecer arriba. */}
      {abierto && (
        <div className="fixed inset-0 !m-0 z-[75] flex items-center justify-center p-4 bg-black/50"
          onClick={() => setAbierto(null)}>
          <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={abierto.asunto}
            className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 p-4 border-b border-border">
              <div className="min-w-0">
                <h2 className="font-bold truncate">{abierto.asunto}</h2>
                <p className="text-xs text-muted-foreground break-words">
                  {abierto.remitente ? `${conNombre(abierto.de_quien, abierto.remitente)} → ` : ''}
                  {abierto.destinatarios}
                  {abierto.buzon_nombre ? ` · ${abierto.buzon_nombre}` : ''}
                  {abierto.campus ? ` · ${abierto.campus}` : ''}
                  {' · '}{cuando(abierto.cuando)}
                </p>
              </div>
              <button type="button" onClick={() => setAbierto(null)} aria-label="Cerrar"
                className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={16} weight="bold" />
              </button>
            </div>

            <div className="p-4">
              {abierto.cuerpo_html ? (
                <CuerpoDelCorreo html={abierto.cuerpo_html} />
              ) : (
                <p className="text-sm text-muted-foreground italic">Este correo llegó sin texto.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
