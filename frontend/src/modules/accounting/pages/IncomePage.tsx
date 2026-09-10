import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { CurrencyEur, ArrowRight, Receipt, CheckCircle, Plus, GraduationCap } from '@phosphor-icons/react';
import { formatDate } from '@/shared/lib/format';
// Las metas son mensuales: el mes que toque segun el filtro de fechas.
import { mesDe } from '@/modules/sales/components/FiltroPeriodo';

const RegisterSaleDialog = lazy(() => import('@/modules/sales/components/RegisterSaleDialog'));
const TutorialesVentas = lazy(() => import('@/modules/sales/components/TutorialesVentas'));
const TopProductsCard = lazy(() => import('@/modules/sales/components/TopProductsCard'));
const MyGoalCard = lazy(() => import('@/modules/sales/components/MyGoalCard'));
const GestoresStatsTable = lazy(() => import('@/modules/sales/components/GestoresStatsTable'));

function fmt(n) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
}
const PER_PAGE = 50;

/*
  Los atajos de fecha.

  `toISOString()` NO sirve aqui: pasa a UTC, y en España a partir de las 22:00
  «hoy» se convierte en mañana. Un atajo que enseña el dia equivocado por la
  noche es peor que no tenerlo, asi que la fecha se arma con los numeros locales.
*/
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const sumaDias = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/* «Esta semana» empieza en LUNES, no en domingo: es la semana con la que se
   trabaja aqui. getDay() da 0 para el domingo, de ahi el ajuste. */
const lunesDe = (d) => sumaDias(d, -((d.getDay() + 6) % 7));

function atajosDeFecha() {
  const hoy = new Date();
  const ayer = sumaDias(hoy, -1);
  const lunes = lunesDe(hoy);
  const lunesPasado = sumaDias(lunes, -7);
  const primeroDeMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const finMesPasado = sumaDias(primeroDeMes, -1);
  const primeroMesPasado = new Date(finMesPasado.getFullYear(), finMesPasado.getMonth(), 1);
  return [
    { id: 'hoy', texto: 'Hoy', from: iso(hoy), to: iso(hoy) },
    { id: 'ayer', texto: 'Ayer', from: iso(ayer), to: iso(ayer) },
    // De lunes a HOY, no a domingo: enseñar dias que aun no han pasado hace
    // parecer que la semana va peor de lo que va.
    { id: 'semana', texto: 'Esta semana', from: iso(lunes), to: iso(hoy) },
    { id: 'semana_pasada', texto: 'Semana pasada', from: iso(lunesPasado), to: iso(sumaDias(lunes, -1)) },
    { id: 'mes', texto: 'Este mes', from: iso(primeroDeMes), to: iso(hoy) },
    { id: 'mes_pasado', texto: 'Mes pasado', from: iso(primeroMesPasado), to: iso(finMesPasado) },
  ];
}



/*
  El estado de pago de una fila, calculado.

  `estado_pago` NO existe en el backend: la columna Estado salia como una
  pastilla naranja vacia. Se calcula de lo pagado contra el total, que es lo
  que significaba.
*/
function estadoDe(total: unknown, pagado: unknown): 'pagado' | 'parcial' | 'pendiente' {
  const t = Number(total || 0), p = Number(pagado || 0);
  if (t > 0 && p >= t - 0.005) return 'pagado';
  if (p > 0) return 'parcial';
  return 'pendiente';
}

/* La etiqueta de cada fila de la lista: lo que es, no solo lo que vale. */
function Tipo({ tipo, compartida }: { tipo: string; compartida?: boolean }) {
  const base = 'inline-block px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap';
  const etiqueta = tipo === 'cuota'
    ? <span className={`${base} bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300`}>CUOTA</span>
    : tipo === 'parte'
      ? <span className={`${base} bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300`}>MISMA VENTA</span>
      : <span className={`${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300`}>VENTA</span>;
  if (!compartida) return etiqueta;
  // Atendida entre dos gestoras: cada una cuenta su parte. Se dice aqui para
  // que un 2,5 en el equipo no parezca un error de la pantalla.
  return (
    <span className="inline-flex items-center gap-1">
      {etiqueta}
      <span
        className={`${base} bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300`}
        title="Venta repartida entre dos gestoras. Cada una suma su parte."
      >
        A MEDIAS
      </span>
    </span>
  );
}

export default function IncomePage({ title = 'Ingresos', subtitlePrefix = 'Todas las ventas registradas' }) {
  const navigate = useNavigate();
  const { activeProject, activeIssuer = null, switchProject = (_id: number) => {} } = useProjectContext() as any;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [tutorialesOpen, setTutorialesOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewUserId, setViewUserId] = useState('all');
  const [gestores, setGestores] = useState([]);
  const [filterCurso, setFilterCurso] = useState('all');
  const [cursos, setCursos] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totales, setTotales] = useState({
    importe: 0, pagado: 0, pendiente: 0, iva: 0,
    facturadas: 0, sinFactura: 0, noRequiereFactura: 0, pendientesDeFacturar: 0, facturasDeAntes: { n: 0, importe: 0 },
    facturadoEnPeriodo: { n: 0, importe: 0 },
    cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } }, facturasPorClase: { venta: { n: 0, importe: 0 }, cuota: { n: 0, importe: 0 }, parte: { n: 0, importe: 0 }, suelta: { n: 0, importe: 0 } }, porProyecto: [],
  });
  const atajos = atajosDeFecha();
  // Por defecto, ESTE MES. Diego: «por defecto es este mes». Sin fechas la
  // lista era el historico entero, y la etiqueta venta/cuota solo tiene sentido
  // con un periodo: asi la pantalla abre ya con la lista mezclada y etiquetada.
  const esteMes = atajos.find((a) => a.id === 'mes') || { from: '', to: '' };
  const [rango, setRango] = useState({ from: esteMes.from, to: esteMes.to });
  // La lista de abajo con fechas puestas: ventas + cuotas facturadas, cada una
  // con su etiqueta. Sin fechas, la lista sigue siendo la de ventas.
  const [filas, setFilas] = useState<any[]>([]);
  const [totalFilas, setTotalFilas] = useState(0);
  // El desglose de las cuotas: cuales son y con que factura. Se pide al abrirlo
  // y no al cargar la pantalla, porque casi nunca hace falta.
  const [cuotas, setCuotas] = useState([]);
  const [verCuotas, setVerCuotas] = useState(false);
  const [cargandoCuotas, setCargandoCuotas] = useState(false);
  const effectiveResponsableId = isAdmin ? (viewUserId === 'all' ? null : Number(viewUserId)) : null;

  useEffect(() => {
    if (!activeProject?.id || !isAdmin) return;
    client.get('/ventas/gestores-stats', { params: { projectId: activeProject.id, periodo: 'all' } })
      .then((r) => setGestores(r?.data?.gestores || []))
      .catch(() => setGestores([]));
  }, [activeProject?.id, isAdmin, reloadKey]);

  useEffect(() => {
    const params: Record<string, any> = {};
    if (activeProject?.id) params.projectId = activeProject.id;
    if (effectiveResponsableId) params.responsableId = effectiveResponsableId;
    client.get('/conversions/productos', { params })
      .then((r) => setCursos(r?.data || []))
      .catch(() => setCursos([]));
  }, [activeProject?.id, effectiveResponsableId, reloadKey]);

  // Al cambiar de fechas, el desglose de cuotas de antes ya no vale.
  useEffect(() => { setCuotas([]); setVerCuotas(false); },
    [activeProject?.id, effectiveResponsableId, rango.from, rango.to]);

  // Cualquier cambio de filtro devuelve a la primera pagina.
  useEffect(() => { setPage(1); }, [activeProject?.id, effectiveResponsableId, filterCurso, rango.from, rango.to]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const params: Record<string, any> = { page, limit: PER_PAGE };
        if (activeProject?.id) params.projectId = activeProject.id;
        if (effectiveResponsableId) params.responsableId = effectiveResponsableId;
        if (filterCurso !== 'all') params.producto = filterCurso;
        if (rango.from) params.from = rango.from;
        if (rango.to) params.to = rango.to;
        const res = await client.get('/conversions', { params });
        // Con fechas, la lista de abajo son ventas + cuotas facturadas del
        // periodo. Se pide aparte porque une dos tablas y pagina sobre la union.
        const conFechas = Boolean(rango.from && rango.to);
        // Aislada: si /filas falla, las tarjetas que /conversions ya trajo bien
        // se quedan; solo se vacia la lista. Antes un 500 aqui lo borraba todo.
        const resFilas = conFechas
          ? await client.get('/conversions/filas', { params }).catch(() => null) : null;
        if (res.success) {
          setItems(res.data || []);
          setTotal(res.pagination?.total ?? (res.data || []).length);
          if (resFilas?.success) {
            const lista = resFilas.data || [];
            setFilas(lista);
            setTotalFilas(resFilas.pagination?.total ?? lista.length);
            // Pagina fuera de rango --se borro una fila y la lista bajo de 51 a 50
            // estando en la 2--: COUNT(*) OVER() da 0. Se vuelve a la primera.
            if (page > 1 && lista.length === 0) setPage(1);
          } else { setFilas([]); setTotalFilas(0); }
          // Los totales vienen del servidor sobre TODO el filtro; antes se
          // sumaban las filas cargadas y las tarjetas no cuadraban nunca.
          setTotales(res.totales || { importe: 0, pagado: 0, pendiente: 0, iva: 0, facturadas: 0, sinFactura: 0, noRequiereFactura: 0, pendientesDeFacturar: 0, facturasDeAntes: { n: 0, importe: 0 }, facturadoEnPeriodo: { n: 0, importe: 0 }, cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } }, facturasPorClase: { venta: { n: 0, importe: 0 }, cuota: { n: 0, importe: 0 }, parte: { n: 0, importe: 0 }, suelta: { n: 0, importe: 0 } }, porProyecto: [] });
        }
      } catch {
        setItems([]); setTotal(0); setFilas([]); setTotalFilas(0); setTotales({ importe: 0, pagado: 0, pendiente: 0, iva: 0, facturadas: 0, sinFactura: 0, noRequiereFactura: 0, pendientesDeFacturar: 0, facturasDeAntes: { n: 0, importe: 0 }, facturadoEnPeriodo: { n: 0, importe: 0 }, cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } }, facturasPorClase: { venta: { n: 0, importe: 0 }, cuota: { n: 0, importe: 0 }, parte: { n: 0, importe: 0 }, suelta: { n: 0, importe: 0 } }, porProyecto: [] });
      } finally { setLoading(false); }
    })();
  }, [activeProject?.id, reloadKey, effectiveResponsableId, page, filterCurso, rango.from, rango.to]);

  async function abrirCuotas() {
    if (verCuotas) { setVerCuotas(false); return; }
    setVerCuotas(true);
    if (cuotas.length) return;
    setCargandoCuotas(true);
    try {
      const params: Record<string, any> = { from: rango.from, to: rango.to };
      if (activeProject?.id) params.projectId = activeProject.id;
      if (effectiveResponsableId) params.responsableId = effectiveResponsableId;
      const r = await client.get('/conversions/cuotas', { params });
      setCuotas(r?.success ? (r.data || []) : []);
    } catch { setCuotas([]); }
    finally { setCargandoCuotas(false); }
  }

  const conFechas = Boolean(rango.from && rango.to);
  // Una sola forma de fila, venga de la lista de ventas o de la mezclada.
  const visibleItems = conFechas
    ? filas.map((f: any) => ({
        clave: `${f.tipo}-${f.clave_id}`, tipo: f.tipo, fecha: f.fecha, fecha_de_la_venta: f.fecha_de_la_venta,
        lead_id: f.lead_id, venta_id: f.venta_id, cliente: f.cliente, producto: f.producto,
        total: f.total, pagado: f.pagado, factura: f.factura, factura_no_requerida: f.factura_no_requerida,
        compartida: Boolean(f.compartida),
        estado: f.tipo === 'venta' ? estadoDe(f.total, f.pagado) : (Number(f.pagado) > 0 ? 'pagado' : 'pendiente'),
      }))
    : items.map((r: any) => ({
        clave: `venta-${r.id}`, tipo: 'venta', fecha: r.fecha_conversion || r.fecha_compra, fecha_de_la_venta: r.fecha_conversion,
        lead_id: r.lead_id, venta_id: r.id, cliente: r.lead_nombre, producto: r.producto_contratado,
        total: r.importe_total, pagado: r.importe_pagado, factura: null, factura_no_requerida: false,
        compartida: false,
        estado: estadoDe(r.importe_total, r.importe_pagado),
      }));
  const totalLista = conFechas ? totalFilas : total;
  const totalPages = Math.max(1, Math.ceil(totalLista / PER_PAGE));

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <PageHeader
          title={title}
          subtitle={`${subtitlePrefix}${activeProject ? ' en ' + activeProject.nombre : ''}`}
        />
        <div className="flex items-center gap-2 self-start sm:self-auto">
        {/* Como leer esta pantalla. Casi todas las dudas salen de comparar
            cifras que cuentan cosas distintas, asi que se explica aqui mismo. */}
        <button
          type="button"
          onClick={() => setTutorialesOpen(true)}
          title="Cómo leer esta pantalla"
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-semibold hover:bg-muted"
        >
          <GraduationCap size={16} weight="duotone" className="text-violet-600" />
          Tutoriales
        </button>
        <button
          type="button"
          onClick={() => navigate('/ventas/analisis')}
          className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-semibold hover:bg-muted"
        >
          Análisis
        </button>
        {activeProject?.id && (
          <button
            type="button"
            onClick={() => setRegisterOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 self-start sm:self-auto"
          >
            <Plus size={14} weight="bold" />
            Nueva venta
          </button>
        )}
        </div>
      </div>

      <Suspense fallback={null}>
        {tutorialesOpen && <TutorialesVentas onCerrar={() => setTutorialesOpen(false)} />}
      </Suspense>

      <Suspense fallback={null}>
        <RegisterSaleDialog
          open={registerOpen}
          project={activeProject}
          onClose={() => setRegisterOpen(false)}
          onSaved={() => setReloadKey((k) => k + 1)}
        />
      </Suspense>

      {(
        <div className="bg-card border border-border rounded-lg p-3 flex items-center gap-3 flex-wrap">
          {isAdmin && gestores.length > 0 && (
            <>
              <label className="text-xs font-semibold text-muted-foreground">Ver ventas de:</label>
              <select
                value={viewUserId}
                onChange={(e) => setViewUserId(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium min-w-[200px]"
              >
                <option value="all">— Todas (vista general) —</option>
                {gestores.map((g) => (
                  <option key={g.user_id} value={g.user_id}>
                    {g.nombre} · {g.role} ({g.ventas} venta{g.ventas === 1 ? '' : 's'})
                  </option>
                ))}
              </select>
            </>
          )}
          {cursos.length > 1 && (
            <>
              <label className="text-xs font-semibold text-muted-foreground">Curso:</label>
              <select
                value={filterCurso}
                onChange={(e) => setFilterCurso(e.target.value)}
                className="h-9 px-3 rounded-md border border-border bg-card text-sm font-medium min-w-[200px] max-w-[320px]"
              >
                <option value="all">— Todos los cursos —</option>
                {cursos.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </>
          )}
          <label className="text-xs font-semibold text-muted-foreground">Desde:</label>
          <input type="date" value={rango.from} onChange={(e) => setRango((v) => ({ ...v, from: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          <label className="text-xs font-semibold text-muted-foreground">Hasta:</label>
          <input type="date" value={rango.to} onChange={(e) => setRango((v) => ({ ...v, to: e.target.value }))}
            className="h-9 px-2 rounded-md border border-border bg-card text-sm" />
          {(viewUserId !== 'all' || filterCurso !== 'all' || rango.from !== esteMes.from || rango.to !== esteMes.to) && (
            <button type="button" onClick={() => { setViewUserId('all'); setFilterCurso('all'); setRango({ from: esteMes.from, to: esteMes.to }); }} className="text-[11px] text-primary hover:underline">
              Quitar filtros
            </button>
          )}

          {/* Atajos. Van en su propia fila y ocupando el ancho para que no
              queden escondidos al final de una fila larga de filtros. */}
          <div className="basis-full flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-semibold text-muted-foreground mr-0.5">Rápido:</span>
            {atajos.map((a) => {
              const puesto = rango.from === a.from && rango.to === a.to;
              return (
                <button key={a.id} type="button"
                  onClick={() => setRango(puesto ? { from: '', to: '' } : { from: a.from, to: a.to })}
                  // Se dice el periodo exacto que coge: «Semana pasada» no
                  // significa lo mismo para todo el mundo.
                  title={`${a.from} → ${a.to}`}
                  className={`h-7 px-2.5 rounded-md border text-xs font-medium transition-colors ${
                    puesto
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'}`}>
                  {a.texto}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={Receipt}
          iconBg="bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400"
          label="Ventas"
          numericValue={total}
        />
        {/* Las mensualidades: dinero que entra este mes de algo que YA estaba
            vendido, asi que no es una venta nueva y no puede sumarse con ellas.
            Solo con un periodo elegido: sin fechas no significa nada. */}
        {(rango.from && rango.to) && (
          <div title={`Facturas con etiqueta CUOTA emitidas en estas fechas: las mismas que se ven en Facturación con este filtro`}>
            <KpiCard
              icon={Receipt}
              iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
              label="Cuotas facturadas"
              numericValue={totales.facturasPorClase.cuota.importe}
              format={fmt}
              badge={totales.facturasPorClase.cuota.n > 0
                ? `${totales.facturasPorClase.cuota.n} ${totales.facturasPorClase.cuota.n === 1 ? 'cuota' : 'cuotas'}`
                : null}
              badgeColor="bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
            />
          </div>
        )}
        {/* Ventas por facturas: cuantas de estas ventas tienen factura.
            El detalle va en el texto que sale al pasar el raton, que es donde
            lo pidio Diego — la tarjeta enseña la proporcion de un vistazo. */}
        <div title={`${totales.facturadas} ventas facturadas · ${totales.noRequiereFactura} no necesitan factura · ${totales.pendientesDeFacturar} pendientes de facturar`}>
          <KpiCard
            icon={Receipt}
            iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
            label="Ventas por facturas"
            value={`${totales.facturadas} / ${total}`}
            /* El aviso solo cuando hay algo que HACER: contar tambien las
               marcadas «no requiere factura» tapaba la unica cifra que importa. */
            badge={totales.pendientesDeFacturar > 0
              ? `${totales.pendientesDeFacturar} por facturar` : null}
            badgeColor="bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            trend="down"
          />
        </div>
        {/* Se llamaba «Facturado» y NO es lo facturado: es la suma del importe
            de las ventas del periodo. Por eso Ventas y Facturacion parecian
            contradecirse. Ahora dice lo que es. */}
        <div title="Suma del importe de las ventas de estas fechas. No es lo que se facturó: una venta a plazos se factura por cobros, mes a mes.">
          <KpiCard
            icon={CurrencyEur}
            iconBg="bg-violet-50 text-violet-600 dark:bg-violet-950/30 dark:text-violet-400"
            label="Importe vendido"
            numericValue={totales.importe}
            format={fmt}
          />
        </div>
        <div title="Lo pagado de esas ventas hasta hoy, no lo cobrado dentro de estas fechas. Una venta de julio que sigue pagando cuotas suma aquí entera.">
          <KpiCard
            icon={CheckCircle}
            iconBg="bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400"
            label="Cobrado de esas ventas"
            numericValue={totales.pagado}
            format={fmt}
          />
        </div>
        <KpiCard
          icon={Receipt}
          iconBg="bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400"
          label="IVA aprox."
          numericValue={totales.iva}
          format={fmt}
        />
      </div>


      {/* Con una empresa elegida: en que campus hubo ventas y cuotas. La suma
          de cada columna es la tarjeta de arriba; si no, es un fallo. */}
      {activeIssuer && (totales.porProyecto || []).length > 0 && (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Por proyecto · {activeIssuer.nombre}</span>
            <span className="text-[11px] text-muted-foreground">{totales.porProyecto.length} con movimiento</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2 font-bold">Proyecto</th>
                  <th className="text-right px-4 py-2 font-bold">Ventas</th>
                  <th className="text-right px-4 py-2 font-bold">Importe vendido</th>
                  <th className="text-right px-4 py-2 font-bold">Cuotas facturadas</th>
                  <th className="text-right px-4 py-2 font-bold">Importe cuotas</th>
                </tr>
              </thead>
              <tbody>
                {totales.porProyecto.map((p: any) => (
                  <tr key={p.project_id} className="border-t border-border hover:bg-muted/30 cursor-pointer"
                    title="Ver solo este proyecto" onClick={() => switchProject(p.project_id)}>
                    <td className="px-4 py-2 font-medium">{p.nombre}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.ventas.n}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(p.ventas.importe)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{p.cuotas.n}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmt(p.cuotas.importe)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/30 text-xs font-semibold">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{totales.porProyecto.reduce((s: number, p: any) => s + p.ventas.n, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(totales.porProyecto.reduce((s: number, p: any) => s + p.ventas.importe, 0))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{totales.porProyecto.reduce((s: number, p: any) => s + p.cuotas.n, 0)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmt(totales.porProyecto.reduce((s: number, p: any) => s + p.cuotas.importe, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Lo unico que hay que HACER: las ventas que esperan factura. */}
      {totales.pendientesDeFacturar > 0 && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            <strong>{totales.pendientesDeFacturar}</strong>{' '}
            {totales.pendientesDeFacturar === 1 ? 'venta de estas fechas espera factura' : 'ventas de estas fechas esperan factura'}.
          </p>
          <p className="text-xs text-amber-800 dark:text-amber-300">
            Las {totales.noRequiereFactura > 0 ? `otras ${totales.noRequiereFactura} sin factura están marcadas «no requiere factura»` : 'demás están facturadas'}.
          </p>
          <button type="button" onClick={() => navigate('/accounting/facturas')}
            className="ml-auto text-xs font-semibold text-amber-900 dark:text-amber-200 underline hover:no-underline">
            Ir a facturarlas
          </button>
        </div>
      )}

      {/*
        Por que Facturacion enseña mas filas que esta pantalla en el mismo dia.

        Es la duda de Diego del 09/09 —«pongo ventas del 8 al 8 y sale 1»— y la
        respuesta era que esa pantalla contaba bien: ese dia hubo una venta nueva
        y dos facturas, porque la otra era una cuota de una venta de julio. Una
        venta a plazos emite una factura por cada cobro, y esas facturas caen en
        el mes en que se cobran, no en el que se vendio.

        Solo sale cuando de verdad hay descuadre que explicar.
      */}
      {totales.facturasDeAntes?.n > 0 && (
        <div className="rounded-lg border border-sky-200 dark:border-sky-900 bg-sky-50 dark:bg-sky-950/30 px-3 py-2.5">
          <p className="text-sm text-sky-900 dark:text-sky-200">
            <strong>{totales.facturasDeAntes.n}</strong>{' '}
            {totales.facturasDeAntes.n === 1 ? 'factura de este periodo no es de una venta de este periodo' : 'facturas de este periodo no son de ventas de este periodo'}
            {' '}({fmt(totales.facturasDeAntes.importe)}).
          </p>
          <p className="text-xs text-sky-800 dark:text-sky-300 mt-0.5 leading-relaxed">
            Son cuotas de ventas anteriores: una venta a plazos emite una factura por
            cada cobro, y esa factura cae en el mes en que se cobra. Por eso Facturación
            enseña más filas que Ventas en las mismas fechas — aquí se cuentan
            <strong> ventas</strong>, allí <strong>facturas</strong>. Las dos cifras son correctas.
          </p>
          {/* El reparto de Facturacion, TAL CUAL: los mismos numeros que se ven
              alli con este filtro. Si no coinciden, es un fallo. */}
          {totales.facturadoEnPeriodo?.n > 0 && (
            <p className="text-xs text-sky-900 dark:text-sky-200 mt-1.5 pt-1.5 border-t border-sky-200 dark:border-sky-900">
              En estas fechas se emitieron <strong>{totales.facturadoEnPeriodo.n}</strong>{' '}
              {totales.facturadoEnPeriodo.n === 1 ? 'factura' : 'facturas'} por{' '}
              <strong>{fmt(totales.facturadoEnPeriodo.importe)}</strong>:{' '}
              <strong>{totales.facturasPorClase.venta.n}</strong> de venta nueva,{' '}
              <strong>{totales.facturasPorClase.cuota.n}</strong> {totales.facturasPorClase.cuota.n === 1 ? 'cuota' : 'cuotas'}
              {totales.facturasPorClase.parte.n > 0 && <>, <strong>{totales.facturasPorClase.parte.n}</strong> de la misma venta</>}
              {totales.facturasPorClase.suelta.n > 0 && <>, <strong>{totales.facturasPorClase.suelta.n}</strong> sin venta detrás</>}.
              {' '}Y se vendieron <strong>{total}</strong> {total === 1 ? 'venta' : 'ventas'} por{' '}
              <strong>{fmt(totales.importe)}</strong>.
              {totales.facturasPorClase.cuota.n > 0 && (
                <>
                  {' '}
                  <button type="button" onClick={abrirCuotas}
                    className="font-semibold underline hover:no-underline">
                    {verCuotas ? 'Ocultar las cuotas' : 'Ver las cuotas'}
                  </button>
                </>
              )}
            </p>
          )}
          {false && (
            <p className="text-xs text-sky-800 dark:text-sky-300 mt-1 leading-relaxed">
              Del dinero que entró en estas fechas,{' '}
              <strong>{fmt(totales.cobrosDelPeriodo.matricula.importe)}</strong> son de ventas
              nuevas y <strong>{fmt(totales.cobrosDelPeriodo.cuotas.importe)}</strong> son{' '}
              {totales.cobrosDelPeriodo.cuotas.n} {totales.cobrosDelPeriodo.cuotas.n === 1 ? 'cuota' : 'cuotas'}{' '}
              de ventas anteriores.{' '}
              <button type="button" onClick={abrirCuotas}
                className="font-semibold underline hover:no-underline">
                {verCuotas ? 'Ocultar el detalle' : 'Ver cuáles son'}
              </button>
            </p>
          )}

          {verCuotas && (
            <div className="mt-2 rounded-md border border-sky-200 dark:border-sky-900 bg-card overflow-x-auto">
              {cargandoCuotas ? (
                <p className="p-3 text-xs text-muted-foreground">cargando…</p>
              ) : cuotas.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No se pudo cargar el detalle.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="text-left font-medium px-3 py-2">Factura</th>
                      <th className="text-left font-medium px-3 py-2">Emitida</th>
                      <th className="text-left font-medium px-3 py-2">Cliente</th>
                      <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Formación</th>
                      <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Venta de</th>
                      <th className="text-right font-medium px-3 py-2">Importe</th>
                      <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Cobrada</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuotas.map((q: any) => (
                      <tr key={q.factura_id} className="border-t border-border">
                        <td className="px-3 py-1.5 font-medium whitespace-nowrap">{q.factura}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(q.fecha)}</td>
                        <td className="px-3 py-1.5">{q.cliente || 'Sin nombre'}</td>
                        <td className="px-3 py-1.5 hidden md:table-cell max-w-[280px] truncate"
                          title={q.producto || ''}>{q.producto || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(q.fecha_de_la_venta)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmt(q.importe)}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          {/* El dia del cobro solo si no es el de la factura: es
                              el dato que explica por que otra pantalla la
                              contaria otro dia. */}
                          {q.cobro_fecha
                            ? (String(q.cobro_fecha).slice(0, 10) === String(q.fecha).slice(0, 10)
                                ? 'el mismo día'
                                : formatDate(q.cobro_fecha))
                            : <span className="text-amber-700 dark:text-amber-400 font-semibold">sin cobro apuntado</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Suspense fallback={null}>
          <MyGoalCard projectId={activeProject?.id} />
        </Suspense>
        <Suspense fallback={null}>
          <TopProductsCard projectId={activeProject?.id}
            from={rango.from || null} to={rango.to || null}
            responsableId={effectiveResponsableId} days={null} limit={5} title={effectiveResponsableId ? `Programas vendidos por ${gestores.find(g => g.user_id === effectiveResponsableId)?.nombre || 'gestor'}` : 'Programas más vendidos'} />
        </Suspense>
      </div>

      {isAdmin && (
        <Suspense fallback={null}>
          {/* El mes ES el del filtro de arriba. Sin pasarlo, la tabla cogia
              siempre el mes en curso: con el filtro en agosto decia
              «Equipo de ventas — 2026-09» y todos a cero (#100 · 4). */}
          <GestoresStatsTable projectId={activeProject?.id}
            periodo={mesDe(rango.from, rango.to)}
            from={rango.from || null} to={rango.to || null} canEdit={true} />
        </Suspense>
      )}

      {loading ? (
        <SkeletonTable rows={5} columns={6} />
      ) : visibleItems.length === 0 ? (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <EmptyState icon={CurrencyEur} title={conFechas ? 'Sin ventas ni cuotas en estas fechas' : 'Sin ventas'} description={conFechas ? 'Ni se vendió ni se facturó ninguna cuota en el periodo elegido' : 'Las conversiones aparecerán aquí cuando un lead compre'} />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="tabla-cifras w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
                  {/* Que es cada fila. Diego: «ahi abajo debe de decirme cual
                      es cuota y cual es venta». */}
                  <th className="text-left px-4 py-2.5 font-bold">Tipo</th>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Producto</th>
                  <th className="text-right px-4 py-2.5 font-bold">Total</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pagado</th>
                  <th className="text-left px-4 py-2.5 font-bold">Factura</th>
                  <th className="text-left px-4 py-2.5 font-bold">Estado</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((r: any) => (
                  <tr key={r.clave} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/leads/${r.lead_id}`)}>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{formatDate(r.fecha)}</td>
                    <td className="px-4 py-3">
                      <Tipo tipo={r.tipo} compartida={r.compartida} />
                      {r.tipo !== 'venta' && r.fecha_de_la_venta && (
                        <div className="text-[10px] text-muted-foreground whitespace-nowrap">venta del {formatDate(r.fecha_de_la_venta)}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-semibold">{r.cliente || 'Sin nombre'}</td>
                    <td className="px-4 py-3">{r.producto || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(r.total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">{fmt(r.pagado)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {r.factura
                        ? <span className="font-mono">{r.factura}</span>
                        : r.factura_no_requerida
                          ? <span className="text-muted-foreground">no requiere</span>
                          : <span className="text-amber-700 dark:text-amber-400 font-semibold">sin factura</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        r.estado === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                        r.estado === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                        'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                      }`}>{r.estado}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/ventas/${r.venta_id}`); }}
                        title="Ver detalle de la venta"
                        className="text-muted-foreground hover:text-primary p-1 rounded focus:outline-none focus:ring-2 focus:ring-primary/40"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-border">
            {visibleItems.map((r: any) => (
              <button key={r.clave} type="button" onClick={() => navigate(`/leads/${r.lead_id}`)} className="w-full text-left p-4 space-y-2 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2"><Tipo tipo={r.tipo} compartida={r.compartida} /><span className="font-semibold truncate">{r.cliente || 'Sin nombre'}</span></div>
                    <div className="text-xs text-muted-foreground truncate">{r.producto || '—'}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                    r.estado === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                    r.estado === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                    'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                  }`}>{r.estado}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-xs text-muted-foreground">{formatDate(r.fecha)}{r.factura ? ` · ${r.factura}` : ''}</div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-green-600 dark:text-green-400">{fmt(r.pagado)}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="tabular-nums">{fmt(r.total)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm">
              <span className="text-muted-foreground">
                {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, totalLista)} de {totalLista}
              </span>
              <div className="flex items-center gap-2">
                <button type="button" disabled={page <= 1} onClick={() => setPage((v) => Math.max(1, v - 1))}
                  className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Anterior</button>
                <span className="text-muted-foreground tabular-nums">{page} / {totalPages}</span>
                <button type="button" disabled={page >= totalPages} onClick={() => setPage((v) => Math.min(totalPages, v + 1))}
                  className="h-8 px-3 rounded-md border border-border disabled:opacity-40 hover:bg-muted">Siguiente</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
