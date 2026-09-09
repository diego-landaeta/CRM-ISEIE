import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/shared/components/ui/PageHeader';
import KpiCard from '@/shared/components/ui/KpiCard';
import EmptyState from '@/shared/components/ui/EmptyState';
import SkeletonTable from '@/shared/components/ui/SkeletonTable';
import { CurrencyEur, ArrowRight, Receipt, CheckCircle, Plus } from '@phosphor-icons/react';
import { formatDate } from '@/shared/lib/format';
// Las metas son mensuales: el mes que toque segun el filtro de fechas.
import { mesDe } from '@/modules/sales/components/FiltroPeriodo';

const RegisterSaleDialog = lazy(() => import('@/modules/sales/components/RegisterSaleDialog'));
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


export default function IncomePage({ title = 'Ingresos', subtitlePrefix = 'Todas las ventas registradas' }) {
  const navigate = useNavigate();
  const { activeProject } = useProjectContext();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [viewUserId, setViewUserId] = useState('all');
  const [gestores, setGestores] = useState([]);
  const [filterCurso, setFilterCurso] = useState('all');
  const [cursos, setCursos] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totales, setTotales] = useState({
    importe: 0, pagado: 0, pendiente: 0, iva: 0,
    facturadas: 0, sinFactura: 0, facturasDeAntes: { n: 0, importe: 0 },
    facturadoEnPeriodo: { n: 0, importe: 0 },
    cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } },
  });
  const [rango, setRango] = useState({ from: '', to: '' });
  const atajos = atajosDeFecha();
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
        if (res.success) {
          setItems(res.data || []);
          setTotal(res.pagination?.total ?? (res.data || []).length);
          // Los totales vienen del servidor sobre TODO el filtro; antes se
          // sumaban las filas cargadas y las tarjetas no cuadraban nunca.
          setTotales(res.totales || { importe: 0, pagado: 0, pendiente: 0, iva: 0, facturadas: 0, sinFactura: 0, facturasDeAntes: { n: 0, importe: 0 }, facturadoEnPeriodo: { n: 0, importe: 0 }, cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } } });
        }
      } catch {
        setItems([]); setTotal(0); setTotales({ importe: 0, pagado: 0, pendiente: 0, iva: 0, facturadas: 0, sinFactura: 0, facturasDeAntes: { n: 0, importe: 0 }, facturadoEnPeriodo: { n: 0, importe: 0 }, cobrosDelPeriodo: { matricula: { n: 0, importe: 0 }, cuotas: { n: 0, importe: 0 } } });
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

  const visibleItems = items;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <PageHeader
          title={title}
          subtitle={`${subtitlePrefix}${activeProject ? ' en ' + activeProject.nombre : ''}`}
        />
        <div className="flex items-center gap-2 self-start sm:self-auto">
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
          {(viewUserId !== 'all' || filterCurso !== 'all' || rango.from || rango.to) && (
            <button type="button" onClick={() => { setViewUserId('all'); setFilterCurso('all'); setRango({ from: '', to: '' }); }} className="text-[11px] text-primary hover:underline">
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
          <div title={`En estas fechas entraron ${fmt(totales.cobrosDelPeriodo.matricula.importe)} de ventas nuevas y ${fmt(totales.cobrosDelPeriodo.cuotas.importe)} de cuotas de ventas anteriores`}>
            <KpiCard
              icon={Receipt}
              iconBg="bg-sky-50 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
              label="Cuotas cobradas"
              numericValue={totales.cobrosDelPeriodo.cuotas.importe}
              format={fmt}
              badge={totales.cobrosDelPeriodo.cuotas.n > 0
                ? `${totales.cobrosDelPeriodo.cuotas.n} ${totales.cobrosDelPeriodo.cuotas.n === 1 ? 'cuota' : 'cuotas'}`
                : null}
              badgeColor="bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
            />
          </div>
        )}
        {/* Ventas por facturas: cuantas de estas ventas tienen factura.
            El detalle va en el texto que sale al pasar el raton, que es donde
            lo pidio Diego — la tarjeta enseña la proporcion de un vistazo. */}
        <div title={`${totales.facturadas} ventas facturadas · ${totales.sinFactura} ventas no facturadas`}>
          <KpiCard
            icon={Receipt}
            iconBg="bg-teal-50 text-teal-600 dark:bg-teal-950/30 dark:text-teal-400"
            label="Ventas por facturas"
            value={`${totales.facturadas} / ${total}`}
            badge={totales.sinFactura > 0 ? `${totales.sinFactura} sin factura` : null}
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
          {/* Las dos cifras juntas: es lo unico que zanja el «no me cuadra». */}
          {totales.facturadoEnPeriodo?.n > 0 && (
            <p className="text-xs text-sky-900 dark:text-sky-200 mt-1.5 pt-1.5 border-t border-sky-200 dark:border-sky-900">
              En estas fechas se emitieron <strong>{totales.facturadoEnPeriodo.n}</strong>{' '}
              {totales.facturadoEnPeriodo.n === 1 ? 'factura' : 'facturas'} por{' '}
              <strong>{fmt(totales.facturadoEnPeriodo.importe)}</strong>, y se vendieron{' '}
              <strong>{total}</strong> {total === 1 ? 'venta' : 'ventas'} por{' '}
              <strong>{fmt(totales.importe)}</strong>. No tienen por qué coincidir.
            </p>
          )}
          {totales.cobrosDelPeriodo?.cuotas.n > 0 && (
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
                      <th className="text-left font-medium px-3 py-2">Cobrada</th>
                      <th className="text-left font-medium px-3 py-2">Cliente</th>
                      <th className="text-left font-medium px-3 py-2 hidden md:table-cell">Formación</th>
                      <th className="text-left font-medium px-3 py-2 whitespace-nowrap">Venta de</th>
                      <th className="text-right font-medium px-3 py-2">Importe</th>
                      <th className="text-left font-medium px-3 py-2">Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cuotas.map((q: any) => (
                      <tr key={q.id} className="border-t border-border">
                        <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(q.fecha)}</td>
                        <td className="px-3 py-1.5">{q.cliente || 'Sin nombre'}</td>
                        <td className="px-3 py-1.5 hidden md:table-cell max-w-[280px] truncate"
                          title={q.producto || ''}>{q.producto || '—'}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                          {formatDate(q.fecha_de_la_venta)}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{fmt(q.importe)}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {/* Sin factura NO es un hueco en blanco: es dinero
                              cobrado que no se ha declarado, y se dice. */}
                          {q.factura
                            ? <span className="font-medium">{q.factura}</span>
                            : <span className="text-amber-700 dark:text-amber-400 font-semibold">sin factura</span>}
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
          <EmptyState icon={CurrencyEur} title="Sin ventas" description="Las conversiones aparecerán aquí cuando un lead compre" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-[11px] text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-2.5 font-bold">Fecha</th>
                  <th className="text-left px-4 py-2.5 font-bold">Cliente</th>
                  <th className="text-left px-4 py-2.5 font-bold">Producto</th>
                  <th className="text-right px-4 py-2.5 font-bold">Total</th>
                  <th className="text-right px-4 py-2.5 font-bold">Pagado</th>
                  <th className="text-left px-4 py-2.5 font-bold">Estado</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/prospectos/${r.lead_id}`)}>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(r.fecha_conversion || r.fecha_compra)}</td>
                    <td className="px-4 py-3 font-semibold">{r.lead_nombre}</td>
                    <td className="px-4 py-3">{r.producto_contratado}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmt(r.importe_total)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                        r.estado_pago === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                        r.estado_pago === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                        'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                      }`}>{r.estado_pago}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); navigate(`/ventas/${r.id}`); }}
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
            {visibleItems.map(r => (
              <button key={r.id} type="button" onClick={() => navigate(`/prospectos/${r.lead_id}`)} className="w-full text-left p-4 space-y-2 hover:bg-muted/30 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.lead_nombre}</div>
                    <div className="text-xs text-muted-foreground truncate">{r.producto_contratado}</div>
                  </div>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
                    r.estado_pago === 'pagado' ? 'bg-green-100 text-green-700 dark:bg-green-950/30 dark:text-green-400' :
                    r.estado_pago === 'parcial' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400' :
                    'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400'
                  }`}>{r.estado_pago}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="text-xs text-muted-foreground">{formatDate(r.fecha_conversion || r.fecha_compra)}</div>
                  <div className="flex items-center gap-3">
                    <span className="tabular-nums text-green-600 dark:text-green-400">{fmt(r.importe_pagado)}</span>
                    <span className="text-muted-foreground">/</span>
                    <span className="tabular-nums">{fmt(r.importe_total)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm">
              <span className="text-muted-foreground">
                {(page - 1) * PER_PAGE + 1}–{Math.min(page * PER_PAGE, total)} de {total}
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
