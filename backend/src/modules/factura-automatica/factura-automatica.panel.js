import { query } from '../../shared/config/db.js';
import { motivoDelError, MOTIVOS_CORTOS } from './factura-automatica.service.js';
import { NOTA_LA_ENVIA_LA_GESTORA, NOTA_POR_ENVIAR } from './factura-automatica.envio.js';

/*
  LA PANTALLA DE LA FACTURACIÓN AUTOMÁTICA (#764, 24/11).

  Diego, al encenderla en producción: «un sitio para VER la facturación
  automática y la auditoría». Solo lee. Por campus (los de quien mira) y, a una
  gestora, lo de sus alumnos (`personas`, su alcance comercial).

    · formularios   cada petición de datos fiscales: enviada, contestada,
                    vencida (pasó el plazo) o esperando, y a qué correo.
    · facturas      las que salieron solas, con su número, si se mandó el PDF y
                    a qué correo, o por qué no.
    · atencion      lo que necesita a una persona: en revisión, posible
                    duplicada, el correo que no salió…, con su motivo y qué hacer.

  La auditoría no va aquí: la pantalla la pide a /facturacion-auditoria (con su
  permiso), para no tener dos sitios que digan lo mismo.
*/

/** Qué hacer con cada motivo. `donde`: 'cola' (abrir el cobro en la cola), 'venta', 'config' o null. */
export const ACCIONES = {
  REVISION: { texto: 'Reenvía el formulario (corrige antes el correo si hace falta) o factúrala desde la cola con los datos buenos.', donde: 'cola' },
  POSIBLE_DUPLICADA: { texto: 'Ábrela en la cola: al generarla se te pide confirmar que no es la misma factura.', donde: 'cola' },
  FACTURACION_PAUSADA: { texto: 'Sale cuando se reanude la facturación (mira la auditoría, abajo).', donde: null },
  HAY_ANTERIORES: { texto: 'Nada: sale sola cuando salgan los cobros anteriores de la cola.', donde: 'cola' },
  EMISOR_SIN_CIF: { texto: 'Pon el CIF de la sociedad emisora en Facturas › Configuración.', donde: 'config' },
  ANTES_DEL_ARRANQUE: { texto: 'Emítela a mano desde la cola.', donde: 'cola' },
  TOTAL_CORTO: { texto: 'Revisa los importes de la venta: lo facturado no cuadra con lo cobrado.', donde: 'venta' },
  TIENE_PROFORMA: { texto: 'Pásala desde su proforma (Proformas › Cobrada).', donde: 'venta' },
  SIN_CORREO: { texto: 'El formulario no salió: pon el correo en la venta («Enviar a este correo») y se reenvía.', donde: 'venta' },
  OTRO: { texto: 'Revísala en la cola.', donde: 'cola' },
};

/** En qué punto está una petición, para contarla. */
export function situacion(f, ahora = new Date()) {
  if (f.origen_datos === 'formulario') return 'contestado';
  if (f.origen_datos === 'ficha') return 'vencido';
  const caducada = f.caduca_at && new Date(f.caduca_at) <= ahora;
  if (f.estado === 'revision') return f.respondido_at || !caducada ? 'revision' : 'vencido';
  if (f.estado === 'pendiente') return caducada ? 'vencido' : 'esperando';
  return f.estado;
}

/** Lo que necesita a una persona, o null. */
export function necesitaAtencion(f) {
  if (f.estado === 'revision') {
    return { codigo: 'REVISION', motivo: 'faltan datos válidos', detalle: f.motivo_revision || null, ...ACCIONES.REVISION };
  }
  if (f.estado === 'pendiente' && f.envio_error) {
    return { codigo: 'SIN_CORREO', motivo: 'el formulario no salió', detalle: f.envio_error, ...ACCIONES.SIN_CORREO };
  }
  const { codigo, texto } = motivoDelError(f.ultimo_error);
  if (!texto) return null;
  const cod = codigo || 'OTRO';
  return { codigo: cod, motivo: MOTIVOS_CORTOS[cod] || 'no se pudo emitir', detalle: texto, ...(ACCIONES[cod] || ACCIONES.OTRO) };
}

const FILTRO = (alias, n) => `($${n}::int[] IS NULL OR ${alias} = ANY($${n}::int[]))`;

export async function panel({ projectIds = null, personas = null, limite = 200, ahora = new Date() } = {}) {
  const { rows: peticiones } = await query(
    `SELECT f.id, f.conversion_id, f.lead_id, f.project_id, p.nombre AS campus, l.nombre AS alumno,
            f.estado, f.origen_datos, f.enviado_a, f.enviado_at, f.envio_error, f.caduca_at,
            f.respondido_at, f.intentos, f.motivo_revision, f.ultimo_error, f.created_at,
            c.factura_envio_auto, COALESCE(c.factura_envio_email, l.email) AS envio_email,
            u.nombre AS gestora,
            (SELECT COUNT(*)::int FROM invoices i WHERE i.datos_fiscales_id = f.id AND i.estado <> 'cancelada') AS facturas,
            (SELECT cp.id FROM conversion_payments cp
              WHERE cp.conversion_id = f.conversion_id AND cp.importe > 0
                AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.payment_id = cp.id AND i.estado <> 'cancelada')
              ORDER BY cp.fecha, cp.id LIMIT 1) AS cobro_sin_factura_id
       FROM factura_datos_fiscales f
       JOIN conversions c ON c.id = f.conversion_id
       JOIN projects p ON p.id = f.project_id
       LEFT JOIN leads l ON l.id = f.lead_id
       LEFT JOIN users u ON u.id = l.responsable_id
      WHERE f.estado <> 'anulado'
        AND ${FILTRO('f.project_id', 1)}
        AND ${FILTRO('l.responsable_id', 2)}
      ORDER BY f.created_at DESC
      LIMIT $3`,
    [projectIds, personas, limite]);

  const { rows: facturas } = await query(
    `SELECT i.id, i.codigo, i.fecha_emision::text AS fecha, i.total, i.cliente_nombre, i.cliente_nif,
            i.estado, i.sent_at, i.sent_to_email, i.envio_nota, i.conversion_id, i.lead_id, i.project_id,
            p.nombre AS campus, f.origen_datos,
            COALESCE(c.factura_envio_email, f.email, l.email) AS envio_email
       FROM invoices i
       JOIN factura_datos_fiscales f ON f.id = i.datos_fiscales_id
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN conversions c ON c.id = i.conversion_id
       LEFT JOIN leads l ON l.id = f.lead_id
      WHERE ${FILTRO('i.project_id', 1)}
        AND ${FILTRO('l.responsable_id', 2)}
      ORDER BY i.created_at DESC
      LIMIT $3`,
    [projectIds, personas, limite]);

  const formularios = peticiones.map((f) => ({
    ...f,
    situacion: situacion(f, ahora),
    envio_nota: f.factura_envio_auto === false ? NOTA_LA_ENVIA_LA_GESTORA : null,
  }));
  const atencion = formularios
    .map((f) => ({ f, a: necesitaAtencion(f) }))
    .filter(({ a }) => a)
    .map(({ f, a }) => ({
      id: f.id, conversion_id: f.conversion_id, lead_id: f.lead_id, project_id: f.project_id,
      campus: f.campus, alumno: f.alumno, gestora: f.gestora, cobro_id: f.cobro_sin_factura_id,
      envio_email: f.envio_email, estado: f.estado, ...a,
    }));

  const cuenta = (pred) => formularios.filter(pred).length;
  // «Por enviar» (25/11): salieron solas y esperan a que administración las
  // verifique y las mande. Con el PDF ya enviado o anuladas, ya no.
  const porEnviar = facturas.filter((i) => i.envio_nota === NOTA_POR_ENVIAR && !i.sent_at
    && !['cancelada', 'anulada'].includes(String(i.estado)));
  return {
    resumen: {
      formularios: formularios.length,
      enviados: cuenta((f) => !!f.enviado_at),
      contestados: cuenta((f) => f.situacion === 'contestado'),
      vencidos: cuenta((f) => f.situacion === 'vencido'),
      esperando: cuenta((f) => f.situacion === 'esperando'),
      en_revision: cuenta((f) => f.estado === 'revision'),
      posibles_duplicadas: atencion.filter((a) => a.codigo === 'POSIBLE_DUPLICADA').length,
      atencion: atencion.length,
      facturas: facturas.length,
      pdf_enviados: facturas.filter((i) => i.sent_at).length,
      las_envia_la_gestora: facturas.filter((i) => i.envio_nota && i.envio_nota !== NOTA_POR_ENVIAR).length,
      por_enviar: porEnviar.length,
    },
    formularios,
    facturas,
    por_enviar: porEnviar,
    atencion,
    limite,
  };
}
