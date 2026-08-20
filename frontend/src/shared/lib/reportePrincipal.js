// Reporte principal: un solo Excel con todo lo que se mira en la pantalla de
// Reportes, cada cosa en su hoja.
//
// Existe porque bajarse seis ficheros sueltos y cuadrarlos a mano es justo lo
// que nadie hace. Todas las hojas usan el mismo rango de fechas, así que los
// totales de una cuadran con los de la otra.
//
// Ojo con las tres fechas, que no son la misma: los leads cuentan por su fecha
// de entrada, las ventas por su fecha de venta y los cobros por su fecha de
// cobro. Por eso una asesora puede cobrar en julio algo que vendió en mayo.
import client from '@/shared/api/client';

const cab = (t) => ({ value: t, fontWeight: 'bold' });
const num = (v) => ({ value: v == null ? null : Number(v), type: Number });
const txt = (v) => ({ value: v == null ? '' : String(v), type: String });

// Nombre legible de cada KPI que devuelve el backend.
const ETIQUETAS = {
  prospectos: 'Leads recibidos',
  ventas: 'Ventas cerradas',
  vendido: 'Importe vendido (EUR)',
  ingresos: 'Ingresos cobrados (EUR)',
  ingresos_venta: '· de ventas nuevas (EUR)',
  ingresos_cuotas: '· de mensualidades (EUR)',
  mensualidades: 'Mensualidades cobradas',
  tasa: 'Tasa de conversión (%)',
};

export async function descargarReportePrincipal({ projectId, projectName, from, to }) {
  const q = new URLSearchParams();
  if (projectId) q.set('projectId', String(projectId));
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const qs = q.toString();

  // Si una parte falla, el resto del informe se baja igual: mejor un Excel al
  // que le falte una hoja que ningún Excel.
  const pide = (ruta) => client.get(`${ruta}?${qs}`).then((r) => r?.data || []).catch(() => []);
  const [panel, asesoras, paises, formaciones, detalle] = await Promise.all([
    client.get(`/informes/panel?${qs}`).then((r) => r?.data || null).catch(() => null),
    pide('/informes/asesoras-mes'),
    pide('/informes/paises'),
    pide('/informes/formaciones'),
    pide('/informes/ventas-asesora'),
  ]);

  const hojas = [];

  if (panel?.kpis) {
    hojas.push({
      sheet: 'Resumen',
      data: [
        [cab('Métrica'), cab('Periodo'), cab('Periodo anterior'), cab('Variación %')],
        ...Object.entries(panel.kpis).map(([k, v]) => [
          txt(ETIQUETAS[k] || k), num(v.value), num(v.prev),
          v.trend == null ? txt(panel?.rango?.comparable === false ? 'sin comparar' : '—') : num(v.trend),
        ]),
        [],
        [txt('Rango'), txt(`${from || '—'} a ${to || '—'}`)],
        [txt('Proyecto'), txt(projectName || 'todos')],
      ],
    });
  }

  if (panel?.serie?.length) {
    hojas.push({
      sheet: 'Evolución',
      data: [
        [cab('Periodo'), cab('Leads'), cab('Ventas'), cab('Vendido EUR'),
         cab('Cobrado EUR'), cab('De ventas EUR'), cab('Tasa %')],
        ...panel.serie.map((x) => [
          txt(x.periodo), num(x.prospectos), num(x.ventas), num(x.vendido),
          num(x.ingresos), num(x.ingresos_venta), num(x.tasa),
        ]),
      ],
    });
  }

  if (asesoras.length) {
    hojas.push({
      sheet: 'Asesoras',
      data: [
        [cab('Mes'), cab('Asesora'), cab('Leads recibidos'), cab('Leads convertidos'),
         cab('Tasa %'), cab('Ventas'), cab('Mensualidades'), cab('Vendido EUR'),
         cab('Cobrado EUR'), cab('De ventas EUR'), cab('De cuotas EUR'), cab('Ticket medio EUR')],
        ...asesoras.map((r) => [
          txt(r.mes), txt(r.asesora), num(r.leads), num(r.leads_convertidos),
          num(r.tasa_conversion), num(r.ventas), num(r.mensualidades), num(r.vendido),
          num(r.cobrado), num(r.cobrado_venta), num(r.cobrado_cuotas), num(r.ticket_medio),
        ]),
      ],
    });
  }

  if (paises.length) {
    hojas.push({
      sheet: 'Países',
      data: [
        [cab('País'), cab('Leads recibidos'), cab('Leads convertidos'), cab('Tasa %'),
         cab('Ventas'), cab('Clientes'), cab('Vendido EUR'), cab('Cobrado EUR')],
        ...paises.map((r) => [
          txt(r.pais), num(r.leads), num(r.leads_convertidos), num(r.tasa_conversion),
          num(r.ventas), num(r.clientes), num(r.vendido), num(r.cobrado),
        ]),
      ],
    });
  }

  if (formaciones.length) {
    hojas.push({
      sheet: 'Formaciones',
      data: [
        [cab('Formación'), cab('Origen del dato'), cab('Ventas'), cab('Clientes'),
         cab('Vendido EUR'), cab('Ticket medio EUR')],
        ...formaciones.map((r) => [
          txt(r.formacion), txt(r.origen), num(r.ventas), num(r.clientes),
          num(r.vendido), num(r.ticket_medio),
        ]),
      ],
    });
  }

  if (detalle.length) {
    hojas.push({
      sheet: 'Ventas detalle',
      data: [
        [cab('Asesora'), cab('Fecha venta'), cab('Cliente'), cab('Email'), cab('Teléfono'),
         cab('Formación'), cab('Importe EUR'), cab('Cobrado EUR'), cab('Estado del pago'),
         cab('Facturas'), cab('Cuotas pendientes')],
        ...detalle.map((r) => [
          txt(r.asesora), txt(r.fecha_venta), txt(r.cliente), txt(r.email), txt(r.telefono),
          txt(r.producto), num(r.venta_total), num(r.cobrado), txt(r.estado_pago),
          txt(r.facturas), num(r.cuotas_pendientes),
        ]),
      ],
    });
  }

  // Y ahora el grano fino: registro a registro. Es lo que se pide cuando los
  // totales no cuadran y hay que ir a mirar de donde sale cada euro.
  const filas = (tipo) => {
    const q2 = new URLSearchParams(q);
    q2.set('tipo', tipo);
    q2.set('limite', '20000');
    return client.get(`/informes/detalle?${q2.toString()}`).then((r) => r?.data || []).catch(() => []);
  };
  const [leads, ventas, cobros] = await Promise.all([
    filas('leads'), filas('ventas'), filas('cobros'),
  ]);

  if (leads.length) {
    hojas.push({
      sheet: 'Leads (uno a uno)',
      data: [
        [cab('Entrada'), cab('Nombre'), cab('Email'), cab('Teléfono'), cab('País'),
         cab('Estado'), cab('Asesora'), cab('Convirtió'), cab('Ventas')],
        ...leads.map((r) => [
          txt(r.fecha), txt(r.cliente), txt(r.email), txt(r.telefono), txt(r.pais),
          txt(r.estado), txt(r.asesora), txt(r.convirtio ? 'sí' : 'no'), num(r.ventas),
        ]),
      ],
    });
  }

  if (ventas.length) {
    hojas.push({
      sheet: 'Ventas (una a una)',
      data: [
        [cab('Fecha'), cab('Cliente'), cab('Email'), cab('Teléfono'), cab('País'),
         cab('Tipo'), cab('Formación'), cab('Importe EUR'), cab('Cobrado EUR'),
         cab('Nº cobros'), cab('Compras antes'), cab('Asesora'), cab('Facturas')],
        ...ventas.map((r) => [
          txt(r.fecha), txt(r.cliente), txt(r.email), txt(r.telefono), txt(r.pais),
          txt(r.es_mensualidad ? 'mensualidad' : 'venta nueva'), txt(r.formacion),
          num(r.importe), num(r.cobrado), num(r.cobros), num(r.ventas_previas),
          txt(r.asesora), txt(r.facturas),
        ]),
      ],
    });
  }

  if (cobros.length) {
    hojas.push({
      sheet: 'Cobros (uno a uno)',
      data: [
        [cab('Fecha'), cab('Cliente'), cab('Importe EUR'), cab('Tipo'), cab('Cuota nº'),
         cab('Formación'), cab('Factura'), cab('Asesora'), cab('Venta de')],
        ...cobros.map((r) => [
          txt(r.fecha), txt(r.cliente), num(r.importe),
          txt(r.es_primer_cobro ? 'cobro de la venta' : 'mensualidad'),
          num(r.cuota), txt(r.formacion), txt(r.factura), txt(r.asesora), txt(r.fecha_venta),
        ]),
      ],
    });
  }

  if (!hojas.length) return { nombre: null, hojas: 0 };

  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const nombre = `reporte-principal-${projectName || 'crm'}-${from || 'inicio'}_${to || 'hoy'}.xlsx`
    .replace(/\s+/g, '-');
  // Multi-hoja: la librería espera [{ sheet, data }], no [data] con { sheets }.
  await writeXlsxFile(hojas, { dateFormat: 'yyyy-mm-dd' }).toFile(nombre);
  return { nombre, hojas: hojas.length };
}
