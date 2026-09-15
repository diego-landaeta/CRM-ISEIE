import { query } from '../../shared/config/db.js';
import { tareasProgramadas } from '../../jobs/latido.js';
import { ultimoWebhook } from './webhooks.js';

/**
 * «¿Está todo funcionando?», respondido con hechos.
 *
 * Tarea #26. Lo que había antes contestaba otra pregunta:
 *
 *     checks.email = process.env.BREVO_API_KEY ? 'operational' : 'degraded';
 *
 * Eso no dice si Brevo funciona, dice si hay una variable puesta en un fichero.
 * Con la clave caducada seguía verde. El propio ticket lo señala al pedir
 * «Brevo — último correo enviado (hoy diría nunca)».
 *
 * Aquí cada pieza contesta con la última vez que hizo su trabajo DE VERDAD, que
 * es el dato que ya estaba en la base y nadie miraba: `last_synced_at` de Meta,
 * `last_sync_at` de Stripe, `wc_import_runs` de WooCommerce, `email_envios` del
 * correo. Ninguna consulta inventada: se leen los rastros que las propias
 * integraciones ya dejaban.
 *
 * Dos reglas del ticket, y las dos son estructurales aquí, no buenas intenciones:
 *
 * 1. «Una pieza caída no puede tumbar la pantalla.» Cada comprobación va por su
 *    lado con `allSettled` y con su propio tiempo máximo. La que reviente se
 *    pinta en rojo con su motivo; las demás ni se enteran. Se puede comprobar
 *    hoy mismo: sin la migración 127 la tabla de correos no existe, y la
 *    pantalla sale entera con ese bloque en ámbar.
 *
 * 2. «Sin datos sensibles.» No sale ni una clave ni un nombre de cliente:
 *    fechas, estados y cuentas. `stripe_payments` tiene `customer_email` y
 *    `customer_name` al lado de lo que se lee, y no se tocan. Lo único con
 *    texto de dentro es `detalle`, que lleva el motivo del fallo — si esta
 *    pantalla llega a enseñarse fuera, ese es el campo que se quita.
 */

/** Cada comprobación con su tiempo máximo: una pieza colgada no cuelga la pantalla. */
const TOPE_MS = 4000;

function conTiempo(promesa, ms = TOPE_MS) {
  return Promise.race([
    promesa,
    new Promise((_, no) => setTimeout(() => no(new Error(`no contestó en ${ms} ms`)), ms).unref()),
  ]);
}

const iso = (v) => (v ? new Date(v).toISOString() : null);
const horas = (v) => (v ? (Date.now() - new Date(v).getTime()) / 3600000 : null);

// ─────────────────────────────────────────────────────────────────────────────

async function baseDeDatos() {
  const t = Date.now();
  await query('SELECT 1');
  const ms = Date.now() - t;
  return {
    estado: ms > 1000 ? 'atencion' : 'bien',
    resumen: `Responde en ${ms} ms`,
    datos: { latenciaMs: ms },
  };
}

async function api() {
  // Una tarjeta que diga «funciona» porque acaba de contestar no informa de
  // nada: si la API estuviera caida no habria pantalla que mirar. Lo que si
  // informa son los 5xx, que `errorHandler` ya venia guardando en
  // `status_errors` desde hace tiempo sin que nadie los leyera nunca.
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')   AS ultima_hora,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS ultimas_24h,
            MAX(created_at)                                                  AS ultimo,
            -- La ruta que mas falla, con los identificadores tapados: sirve
            -- para saber DONDE mirar sin sacar a nadie en la pantalla.
            (SELECT REGEXP_REPLACE(SPLIT_PART(path, '?', 1), '/[0-9]+', '/:id', 'g')
               FROM status_errors
              WHERE created_at > NOW() - INTERVAL '24 hours'
              GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1)                     AS ruta
       FROM status_errors`
  );
  const r = rows[0] || {};
  const hora = Number(r.ultima_hora || 0);
  const dia = Number(r.ultimas_24h || 0);
  const arriba = Math.round(process.uptime() / 60);

  let estado = 'bien';
  let resumen = `Arriba desde hace ${arriba < 60 ? `${arriba} min` : `${Math.round(arriba / 60)} h`}`;
  if (hora > 0) {
    estado = hora >= 10 ? 'caida' : 'atencion';
    resumen = `${hora} error${hora > 1 ? 'es' : ''} de servidor en la última hora`;
  } else if (dia > 0) {
    resumen = `Sin errores en una hora (${dia} en el día)`;
  }
  return {
    estado, resumen,
    desde: iso(r.ultimo),
    desdeQue: 'Último error de servidor',
    datos: { errores1h: hora, errores24h: dia, arribaMin: arriba },
    detalle: hora > 0 && r.ruta ? `La que más falla: ${r.ruta}` : null,
  };
}

async function correo() {
  const { rows } = await query(
    `SELECT MAX(created_at) FILTER (WHERE estado = 'enviado')   AS ultimo_ok,
            MAX(created_at) FILTER (WHERE estado = 'fallido')   AS ultimo_fallo,
            COUNT(*)        FILTER (WHERE estado = 'enviado'   AND created_at > NOW() - INTERVAL '24 hours') AS ok_24h,
            COUNT(*)        FILTER (WHERE estado = 'fallido'   AND created_at > NOW() - INTERVAL '24 hours') AS fallos_24h,
            COUNT(*)        FILTER (WHERE estado = 'bloqueado' AND created_at > NOW() - INTERVAL '24 hours') AS frenados_24h
       FROM email_envios`
  );
  const r = rows[0] || {};
  const fallos = Number(r.fallos_24h || 0);
  const ok = Number(r.ok_24h || 0);

  let estado = 'bien';
  let resumen;
  if (!r.ultimo_ok && !r.ultimo_fallo) {
    // Lo que el ticket anticipaba: aquí pone «nunca» y es la verdad.
    estado = 'sin_datos';
    resumen = 'No consta ningún correo enviado';
  } else if (fallos > 0 && ok === 0) {
    estado = 'caida';
    resumen = `${fallos} fallidos en 24 h y ninguno enviado`;
  } else if (fallos > 0) {
    estado = 'atencion';
    resumen = `${ok} enviados y ${fallos} fallidos en 24 h`;
  } else if (horas(r.ultimo_ok) > 72) {
    // No es un fallo: puede que no haya habido nada que mandar. Pero si el CRM
    // lleva tres días sin mandar un correo, merece una mirada.
    estado = 'atencion';
    resumen = 'Sin enviar nada desde hace más de tres días';
  } else {
    resumen = `${ok} enviados en 24 h`;
  }
  return {
    estado, resumen,
    desde: iso(r.ultimo_ok),
    desdeQue: 'Último correo enviado',
    datos: {
      ok24h: ok, fallos24h: fallos,
      // Los frenados no son fallos: es el freno de pruebas de #27 haciendo su
      // trabajo. Contarlos como fallo pintaría de rojo todos los entornos que
      // no son producción.
      frenados24h: Number(r.frenados_24h || 0),
      ultimoFallo: iso(r.ultimo_fallo),
    },
  };
}

async function metaAds() {
  const { rows } = await query(
    `SELECT MAX(last_synced_at) AS ultimo,
            COUNT(*)                                          AS cuentas,
            COUNT(*) FILTER (WHERE last_sync_status = 'error') AS con_error,
            MAX(last_sync_error) FILTER (WHERE last_sync_status = 'error') AS motivo
       FROM meta_ad_accounts`
  );
  const r = rows[0] || {};
  const cuentas = Number(r.cuentas || 0);
  if (!cuentas) return { estado: 'sin_configurar', resumen: 'Ninguna cuenta publicitaria enlazada' };

  const conError = Number(r.con_error || 0);
  const h = horas(r.ultimo);
  let estado = 'bien';
  let resumen = `${cuentas} cuenta${cuentas > 1 ? 's' : ''} al día`;
  if (conError > 0) {
    estado = 'atencion';
    resumen = `${conError} de ${cuentas} cuentas con error`;
  } else if (h === null) {
    estado = 'sin_datos';
    resumen = 'Enlazada pero sin sincronizar todavía';
  } else if (h > 12) {
    // La tarea corre cada 3 h. Doce es cuatro vueltas perdidas: ya no es un
    // parpadeo.
    estado = 'caida';
    resumen = `Sin sincronizar desde hace ${Math.round(h)} h`;
  }
  return {
    estado, resumen, desde: iso(r.ultimo),
    desdeQue: 'Última sincronización',
    datos: { cuentas, conError },
    detalle: conError > 0 ? String(r.motivo || '').slice(0, 300) : null,
  };
}

async function stripe() {
  const { rows } = await query(
    `SELECT (SELECT MAX(last_sync_at) FROM stripe_sync_state)            AS ultima_sync,
            (SELECT MAX(last_error)   FROM stripe_sync_state
              WHERE last_error IS NOT NULL)                              AS motivo,
            (SELECT COUNT(*) FROM stripe_sync_state)                     AS proyectos,
            -- Solo la fecha y el número. Al lado de esta columna están
            -- customer_email y customer_name, y no salen de aquí.
            (SELECT MAX(stripe_created_at) FROM stripe_payments)         AS ultimo_cobro,
            (SELECT COUNT(*) FROM stripe_payments
              WHERE stripe_created_at > NOW() - INTERVAL '7 days')       AS cobros_7d`
  );
  const r = rows[0] || {};
  // El webhook se mira ANTES de rendirse por «sin configurar». Si no, el caso
  // que mas importa se esconde justo cuando pasa: llegan webhooks y se rechazan
  // porque falta el secreto, y la pantalla contesta «sin proyectos enlazados»
  // como si no estuviera pasando nada.
  const wh = ultimoWebhook('stripe');

  if (!Number(r.proyectos || 0)) {
    if (wh) {
      return {
        estado: wh.resultado === 'aceptado' ? 'atencion' : 'caida',
        resumen: 'Llegan webhooks pero Stripe no está enlazado aquí',
        desde: wh.cuando,
        desdeQue: 'Último webhook',
        datos: { webhook: wh },
        detalle: wh.motivo,
      };
    }
    return { estado: 'sin_configurar', resumen: 'Sin proyectos enlazados a Stripe' };
  }

  const h = horas(r.ultima_sync);
  let estado = 'bien';
  let resumen = `${Number(r.cobros_7d || 0)} cobros en 7 días`;
  let detalle = r.motivo ? String(r.motivo).slice(0, 300) : null;

  if (r.motivo) { estado = 'atencion'; resumen = 'La última sincronización dio error'; }
  else if (h === null) { estado = 'sin_datos'; resumen = 'Enlazado pero sin sincronizar todavía'; }
  else if (h > 2) { estado = 'caida'; resumen = `Sin sincronizar desde hace ${Math.round(h)} h`; }

  // El webhook, que el ticket pide aparte del cobro. Un webhook rechazado no
  // pierde dinero —el sondeo recoge los cobros igual— pero sí la inmediatez, y
  // hoy eso solo se descubre leyendo logs por SSH.
  if (wh && wh.resultado !== 'aceptado' && estado !== 'caida') {
    estado = 'atencion';
    detalle = `El último webhook se rechazó: ${wh.motivo || 'sin motivo'}`;
  }

  return {
    estado, resumen, desde: iso(r.ultima_sync),
    desdeQue: 'Última sincronización',
    datos: {
      ultimoCobro: iso(r.ultimo_cobro),
      cobros7d: Number(r.cobros_7d || 0),
      webhook: wh,
    },
    detalle,
  };
}

async function wooCommerce() {
  const { rows } = await query(
    `SELECT status, total_created, total_updated, total_fetched, error_message,
            COALESCE(finished_at, started_at) AS cuando
       FROM wc_import_runs
      ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
      LIMIT 1`
  );
  const r = rows[0];
  if (!r) return { estado: 'sin_datos', resumen: 'Ninguna importación registrada' };

  const fallo = r.status && !['ok', 'success', 'completed'].includes(r.status);
  const h = horas(r.cuando);
  let estado = 'bien';
  let resumen = `${Number(r.total_fetched || 0)} productos leídos, ${Number(r.total_created || 0)} nuevos`;
  if (fallo) { estado = 'caida'; resumen = `La última importación acabó en «${r.status}»`; }
  else if (h > 48) { estado = 'atencion'; resumen = `Sin importar desde hace ${Math.round(h / 24)} días`; }

  return {
    estado, resumen, desde: iso(r.cuando),
    desdeQue: 'Última importación',
    datos: { creados: Number(r.total_created || 0), actualizados: Number(r.total_updated || 0) },
    detalle: fallo ? String(r.error_message || '').slice(0, 300) : null,
  };
}

async function tareas() {
  const lista = tareasProgramadas();
  if (!lista.length) {
    return { estado: 'sin_datos', resumen: 'Las tareas no están arrancadas en este proceso', datos: { tareas: [] } };
  }

  const caidas = lista.filter((t) => t.estado === 'caida').length;
  const fallando = lista.filter((t) => t.estado === 'fallando').length;
  const esperando = lista.filter((t) => t.estado === 'esperando').length;

  let estado = 'bien';
  let resumen = `Las ${lista.length} dando vueltas`;
  if (caidas) { estado = 'caida'; resumen = `${caidas} de ${lista.length} sin dar señales`; }
  else if (fallando) { estado = 'atencion'; resumen = `${fallando} de ${lista.length} fallando`; }
  else if (esperando === lista.length) {
    // Ninguna ha dado todavia una vuelta. Verde aqui seria verde por no haber
    // fallado, no por haber demostrado nada — y justo despues de un despliegue
    // es cuando hace falta que la pantalla no mienta.
    estado = 'sin_datos';
    resumen = `Arrancadas hace poco, ninguna ha dado su primera vuelta`;
  } else if (esperando) {
    resumen = `${lista.length - esperando} dando vueltas, ${esperando} aún sin tocarles`;
  }

  return { estado, resumen, datos: { tareas: lista } };
}

// ─────────────────────────────────────────────────────────────────────────────

const PIEZAS = [
  { nombre: 'api',           titulo: 'API',                  comprobar: api },
  { nombre: 'base_de_datos', titulo: 'Base de datos',        comprobar: baseDeDatos },
  { nombre: 'correo',        titulo: 'Correo (Brevo)',       comprobar: correo },
  { nombre: 'meta_ads',      titulo: 'Meta Ads',             comprobar: metaAds },
  { nombre: 'stripe',        titulo: 'Stripe',               comprobar: stripe },
  { nombre: 'woocommerce',   titulo: 'WooCommerce',          comprobar: wooCommerce },
  { nombre: 'tareas',        titulo: 'Tareas programadas',   comprobar: tareas },
];

/** El peor manda: si algo está caído, la cabecera no puede decir que todo va bien. */
const GRAVEDAD = { bien: 0, sin_configurar: 0, sin_datos: 1, atencion: 2, caida: 3 };

export async function comprobarTodo() {
  const resultados = await Promise.allSettled(PIEZAS.map((p) => conTiempo(p.comprobar())));

  const piezas = PIEZAS.map((p, i) => {
    const r = resultados[i];
    if (r.status === 'fulfilled') return { nombre: p.nombre, titulo: p.titulo, detalle: null, ...r.value };
    // Aquí muere la pieza, no la pantalla. Tampoco se entierra el motivo: si la
    // tabla no existe o la consulta revienta, se dice cuál y por qué.
    return {
      nombre: p.nombre,
      titulo: p.titulo,
      estado: 'caida',
      resumen: 'No se pudo comprobar',
      detalle: String(r.reason?.message || r.reason).slice(0, 300),
    };
  });

  const peor = piezas.reduce((max, p) => Math.max(max, GRAVEDAD[p.estado] ?? 0), 0);
  return {
    global: Object.keys(GRAVEDAD).find((k) => GRAVEDAD[k] === peor) || 'bien',
    comprobado: new Date().toISOString(),
    // Para saber si un dato ausente es «esto está roto» o «acaban de reiniciar».
    arribaDesdeMs: Math.round(process.uptime() * 1000),
    piezas,
  };
}

export const _internos = { conTiempo, PIEZAS, GRAVEDAD };
