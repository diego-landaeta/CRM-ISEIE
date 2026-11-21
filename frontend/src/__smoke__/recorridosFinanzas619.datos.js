/*
  Datos inventados para las pantallas de Finanzas con recorrido (CRM-ISEIE#619).
  Los usa la prueba `recorridosFinanzas619.test.jsx` (y, fuera del repo, el
  Playwright que recorre cada pantalla): con ellos sale TODO lo que el recorrido
  señala —avisos incluidos—, para comprobar que cada paso tiene su sitio.

  `respuestaFinanzas(url)` contesta como el servidor (`{ success, data, … }`) o
  `null` si la ruta no es de estas pantallas.
*/

const nombres = ['Ana Martínez Ruiz', 'Beto Sánchez', 'Carla Gómez Fernández', 'Dani Ortega', 'Eva López', 'Fran Díaz'];
const cursos = ['Máster en Psicología Clínica y de la Salud', 'Curso de Neuropsicología Infantil', 'Experto en Coaching Educativo'];
const dia = (d) => `2026-11-${String(d).padStart(2, '0')}`;

const DASHBOARD = {
  ingresos: { total_cobrado: 18450, total_pendiente: 6200, total_emitido: 16900, num_facturas: 23 },
  egresos: { total: 7320, por_categoria: [
    { categoria: 'publicidad', total: 3200 }, { categoria: 'software', total: 1450 },
    { categoria: 'alquiler', total: 1900 }, { categoria: 'otros', total: 770 },
  ] },
  balance: 11130,
  cuentas_por_cobrar: nombres.slice(0, 4).map((n, i) => ({
    id: i + 1, lead_id: 100 + i, lead_nombre: n, lead_email: `alumno${i + 1}@ejemplo.invalid`,
    producto_contratado: cursos[i % 3], proyecto_nombre: 'Campus Demo',
    importe_total: 1800, importe_pagado: 600 + i * 100, importe_pendiente: 1200 - i * 100,
    fecha_compromiso_pago: dia(5 + i * 6), vencido: i < 2,
  })),
  cuentas_por_cobrar_resumen: { num: 9, total: 6200, num_vencido: 2, total_vencido: 2300 },
  trend: {
    ingresos: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((mes, i) => ({ mes, total: 2400 + i * 450 })),
    egresos: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((mes, i) => ({ mes, total: 1100 + (i % 3) * 300 })),
  },
};

const VENDEDORAS = [
  { vendedora: 'Laura Gestora', ventas: 9, clientes: 8, cobrado: 9800, pendiente: 3100 },
  { vendedora: 'Marta Gestora', ventas: 7, clientes: 7, cobrado: 8650, pendiente: 3100 },
];

const CONVERSIONES = nombres.map((n, i) => ({
  id: 300 + i, lead_id: 100 + i, lead_nombre: n, lead_email: `alumno${i + 1}@ejemplo.invalid`,
  producto_contratado: cursos[i % 3], importe_total: 1500 + i * 150, importe_pagado: 900,
  tipo_pago: i % 2 ? 'abono_parcial' : 'pago_completo', fecha_conversion: dia(2 + i),
}));

const EGRESOS = [
  { id: 1, fecha: dia(3), concepto: 'Campaña de Meta Ads', categoria: 'publicidad', importe: 1200, project_id: 1, proyecto_nombre: 'Campus Demo', notas: 'Noviembre', comprobante_url: 'r2://comprobante-1.pdf' },
  { id: 2, fecha: dia(5), concepto: 'Alquiler de la oficina', categoria: 'alquiler', importe: 1900, project_id: null, issuer_id: 3, empresa_nombre: 'Empresa Demo', notas: null, comprobante_url: null },
  { id: 3, fecha: dia(8), concepto: 'Comisión de Stripe', categoria: 'comision_pasarela_pago', importe: 84.5, project_id: 1, proyecto_nombre: 'Campus Demo', source_stripe_payout_id: 'po_demo', comprobante_url: null },
  { id: 4, fecha: dia(9), concepto: 'Licencias de software', categoria: 'software', importe: 450, project_id: 1, proyecto_nombre: 'Campus Demo', notas: null, comprobante_url: null },
];
const EGRESOS_RESUMEN = {
  num: 4, total: 3634.5, sin_campus: { num: 1, total: 1900 },
  por_categoria: [
    { categoria: 'alquiler', total: 1900, num: 1 }, { categoria: 'publicidad', total: 1200, num: 1 },
    { categoria: 'software', total: 450, num: 1 }, { categoria: 'comision_pasarela_pago', total: 84.5, num: 1 },
  ],
};

const POR_COBRAR = {
  items: nombres.map((n, i) => ({
    tipo: i % 2 ? 'cuota' : 'venta', ref_id: 500 + i, conversion_id: 300 + i, lead_id: 100 + i,
    cliente: n, cliente_email: `alumno${i + 1}@ejemplo.invalid`, producto: cursos[i % 3],
    project_id: 1, proyecto_nombre: 'Campus Demo', gestora_nombre: i % 2 ? 'Laura Gestora' : 'Marta Gestora',
    importe: 230 + i * 50, vence: dia(3 + i * 4), vencido: i < 2, cuota_numero: i % 2 ? i : null,
  })),
  gestoras: [{ id: 7, nombre: 'Laura Gestora' }, { id: 8, nombre: 'Marta Gestora' }],
  resumen: { count: 6, total: 2130, count_vencidas: 2, total_vencido: 510 },
};

const POR_PAGAR = [
  { id: 1, proveedor: 'Imprenta Rápida SL', concepto: 'Diplomas de octubre', categoria: 'material', importe_total: 640, importe_pagado: 0, importe_pendiente: 640, fecha_compromiso_pago: dia(2), vencido: true, estado: 'pendiente', proyecto_nombre: 'Campus Demo' },
  { id: 2, proveedor: 'Gestoría Contable', concepto: 'Cuota trimestral', categoria: 'servicios', importe_total: 900, importe_pagado: 300, importe_pendiente: 600, fecha_compromiso_pago: dia(28), vencido: false, estado: 'parcial', proyecto_nombre: null },
  { id: 3, proveedor: 'Hosting Web', concepto: 'Servidor anual', categoria: 'software', importe_total: 480, importe_pagado: 480, importe_pendiente: 0, fecha_compromiso_pago: dia(1), vencido: false, estado: 'pagado', proyecto_nombre: 'Campus Demo' },
];
const POR_PAGAR_STATS = { total_facturado: 2020, total_pagado: 780, total_pendiente: 1240, vencidas: 1 };

const COMISIONES = nombres.slice(0, 4).map((n, i) => ({
  id: 600 + i, conversion_id: 300 + i, user_id: 7 + (i % 2), user_nombre: i % 2 ? 'Marta Gestora' : 'Laura Gestora',
  product_nombre: cursos[i % 3], producto_contratado: cursos[i % 3], lead_nombre: n,
  conv_total: 1800, conv_pagado: 900, importe_comision: 90 + i * 10, pct: 5, importe_base: 1800,
  estado: ['pendiente', 'pagado', 'pendiente', 'cancelado'][i], fecha_venta: dia(3 + i),
}));
const COMISIONES_STATS = { total: 420, pagado: 100, pendiente: 200, cantidad: 4 };

const TUTORES_RESUMEN = [
  { periodo: '2026-11', tutor_id: 21, tutor: 'Dra. Lucía Herrero', tutor_email: 'lucia@ejemplo.invalid', tutor_iban: 'ES00 0000 0000 0000 0000 0000', lineas: 3, base: 2700, pagada: 0, revertida: 0, pendiente: 405, ultima_liquidacion: null },
  { periodo: '2026-11', tutor_id: 22, tutor: 'Pablo Ibarra', tutor_email: 'pablo@ejemplo.invalid', tutor_iban: null, lineas: 1, base: 900, pagada: 135, revertida: 0, pendiente: 0, ultima_liquidacion: dia(10) },
];
const TUTORES_LINEAS = [
  { id: 1, tutor_id: 21, fecha_cobro: dia(3), alumno: 'Ana Martínez Ruiz', formacion: cursos[0], proyecto: 'Campus Demo', base_calculo: 900, pct: 15, importe: 135, estado: 'pendiente' },
  { id: 2, tutor_id: 21, fecha_cobro: dia(6), alumno: 'Beto Sánchez', formacion: cursos[0], proyecto: 'Campus Demo', base_calculo: 900, pct: 15, importe: 135, estado: 'notificada' },
  { id: 3, tutor_id: 21, fecha_cobro: dia(9), alumno: 'Eva López', formacion: cursos[0], proyecto: 'Campus Demo', base_calculo: 900, pct: 15, importe: 135, estado: 'falta_factura' },
  { id: 4, tutor_id: 22, fecha_cobro: dia(4), alumno: 'Dani Ortega', formacion: cursos[1], proyecto: 'Campus Demo', base_calculo: 900, pct: 15, importe: 135, estado: 'pagada', fecha_liquidacion: dia(10) },
];
const TUTORES_SIN_FORMACION = [
  { venta: 177, alumno: 'Fran Díaz', importe: 450 },
  { venta: 181, alumno: 'Gloria Pérez', importe: 300 },
];

const PLANES = [
  { id: 1, user_id: 7, user_nombre: 'Laura Gestora', user_email: 'laura@ejemplo.invalid', modo_fijo: 1400, modo_horas: '', modo_comisiones: true, active: true, notas: '' },
  { id: 2, user_id: 9, user_nombre: 'Sergio Soporte', user_email: 'sergio@ejemplo.invalid', modo_fijo: '', modo_horas: 14.5, modo_comisiones: false, active: true, notas: '' },
];
const USUARIOS = [
  { id: 7, nombre: 'Laura Gestora' }, { id: 8, nombre: 'Marta Gestora' }, { id: 9, nombre: 'Sergio Soporte' },
];

export function respuestaFinanzas(url) {
  const u = new URL(url, 'http://local.invalid');
  const p = u.pathname.replace(/^.*?\/api(?=\/)/, '');
  switch (p) {
    case '/accounting/dashboard': return { success: true, data: DASHBOARD };
    case '/informes/ventas-vendedora': return { success: true, data: VENDEDORAS };
    case '/conversions': return { success: true, data: CONVERSIONES, pagination: { total: CONVERSIONES.length } };
    case '/expenses': return { success: true, data: EGRESOS, pagination: { total: EGRESOS.length } };
    case '/expenses/resumen': return { success: true, data: EGRESOS_RESUMEN };
    case '/accounting/receivable': return { success: true, data: POR_COBRAR };
    case '/accounts-payable': return { success: true, data: POR_PAGAR };
    case '/accounts-payable/stats': return { success: true, data: POR_PAGAR_STATS };
    case '/commissions': case '/commissions/me': return { success: true, data: COMISIONES };
    case '/commissions/stats': case '/commissions/me/stats': return { success: true, data: COMISIONES_STATS };
    case '/tutores/comisiones/resumen': return { success: true, data: TUTORES_RESUMEN };
    case '/tutores/comisiones': return { success: true, data: TUTORES_LINEAS };
    case '/tutores/ajustes': return { success: true, data: { aplica_desde: '2026-09-01', pct_defecto: 15 } };
    case '/tutores/pagos-sin-formacion': return { success: true, data: TUTORES_SIN_FORMACION };
    case '/payroll/plans': return { success: true, data: PLANES };
    case '/users': return { success: true, data: USUARIOS };
    default: return null;
  }
}

/** Cada recorrido, en qué ruta de ISEIE vive su pantalla. */
export const RUTA_DE = {
  'finanzas-dashboard': '/accounting',
  conversiones: '/revenue',
  egresos: '/expenses',
  'por-cobrar': '/accounting/receivable',
  'por-pagar': '/accounting/payable',
  comisiones: '/commissions',
  'comisiones-tutores': '/tutores/comisiones',
  nominas: '/payroll',
};
