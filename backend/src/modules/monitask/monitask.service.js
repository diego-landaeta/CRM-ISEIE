import crypto from 'crypto';
import { encrypt, decrypt } from '../../shared/utils/crypto.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';
import { notifyUsers } from '../notifications/notifications.service.js';
import { avisarA } from '../facturas-colaborador/facturas.model.js';
import { monitaskActivo } from './interruptor.js';
import * as model from './monitask.model.js';
import * as cliente from './monitask.client.js';
import * as datos from './monitask.datos.js';

/*
  Monitask en el CRM (#236).

  1. CONECTAR. En Integraciones se pegan el client id y el secreto de la aplicación
     OAuth creada en Monitask (cifrado el secreto). «Conectar con Monitask» manda a
     quien lo pulsa a Monitask (authorization code + PKCE); Monitask vuelve a
     /api/monitask/oauth/callback con un código, y el CRM lo cambia por el access
     token y el refresh token, que se guardan cifrados. El access token se renueva
     solo con el refresh token cuando le quedan menos de dos minutos (o si la API
     contesta 401), y el refresh nuevo, si Monitask lo da, sustituye al anterior.

  2. SINCRONIZAR. Cada noche (y con el botón «Sincronizar») se traen las personas
     de la cuenta, se emparejan por correo con las fichas de colaborador y los
     usuarios del CRM, y por cada una sus entradas de tiempo y su actividad, que se
     resumen por día (de Madrid): horas, horas activas, % de actividad, proyectos y
     tareas. Nunca las capturas de pantalla.

  3. COTEJAR. Para cada colaborador y mes: las horas de sus facturas (#202) frente
     a las de Monitask, con la diferencia en horas y en %. Si se pasa del margen
     (10 % de serie, se cambia en Integraciones), sale en rojo y, si la factura aún
     no está pagada, avisa en la campana a quien la paga (una vez por factura).

  Con MONITASK_ACTIVO apagado no se hace nada de esto: ni rutas, ni noche, ni red.
*/

const SEGUNDOS_DE_MARGEN_DEL_TOKEN = 120;
const VIDA_DEL_CONECTAR_MS = 10 * 60 * 1000;

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const base64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const descifrar = (enc, iv, tag) => (enc && iv && tag ? decrypt(enc, iv, tag) : null);

// ─── Direcciones ────────────────────────────────────────────────────────────

/**
 * La «Redirect Uri» que hay que poner en la aplicación de Monitask: la API de ESTE
 * CRM + /api/monitask/oauth/callback. MONITASK_REDIRECT_URI la fija a mano; si no,
 * sale de CRM_BASE_URL (con su ruta: /crm, /testeo, /staging o nada).
 */
export function redirectUri(env = process.env) {
  const fija = String(env.MONITASK_REDIRECT_URI || '').trim();
  if (fija) return fija;
  const base = String(env.CRM_BASE_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/monitask/oauth/callback` : null;
}

/** La pantalla de Integraciones en el frontal de este CRM. */
export const RUTA_INTEGRACIONES = '/accounting/integrations';

/** A dónde vuelve el navegador al terminar el OAuth: Integraciones, con el resultado. */
export function urlDeVuelta(resultado, motivo = null, env = process.env) {
  const base = String(env.CRM_BASE_URL || '').trim().replace(/\/+$/, '');
  const qs = new URLSearchParams({ monitask: resultado, ...(motivo ? { motivo } : {}) });
  return `${base}${RUTA_INTEGRACIONES}?${qs}`;
}

// ─── La conexión ────────────────────────────────────────────────────────────

let enMarcha = false;
export const sincronizando = () => enMarcha;

/** Lo que enseña la tarjeta. Nunca un secreto ni un token, ni cifrado. */
export async function estado(env = process.env) {
  const c = await model.conexion();
  return {
    activo: monitaskActivo(env),
    client_id: c?.client_id || null,
    tiene_secreto: !!c?.secreto_cifrado,
    secreto_cola: c?.secreto_cola || null,
    conectada: !!(c?.refresh_cifrado || c?.access_cifrado),
    conectada_at: c?.conectada_at || null,
    conectada_por: c?.conectada_por_nombre || null,
    renueva_sola: !!c?.refresh_cifrado,
    access_caduca_at: c?.access_caduca_at || null,
    margen_pct: c ? Number(c.margen_pct) : 10,
    redirect_uri: redirectUri(env),
    ultima_sync_at: c?.ultima_sync_at || null,
    ultima_sync: c?.ultima_sync_resultado || null,
    ultimo_error: c?.ultimo_error || null,
    ultimo_error_at: c?.ultimo_error_at || null,
    sincronizando: enMarcha,
  };
}

/**
 * Guarda la aplicación OAuth. El secreto solo si viene. Si cambia el client id,
 * los tokens eran de la otra aplicación: se borran y hay que volver a conectar.
 */
export async function guardarApp({ clientId, clientSecret, margenPct }, userId) {
  const antes = await model.conexion();
  const secreto = clientSecret ? { ...encrypt(clientSecret), cola: clientSecret.slice(-4) } : null;
  if (!antes?.secreto_cifrado && !secreto) {
    throw new AppError('Falta el secreto (Client Secret) de la aplicación de Monitask', 400, 'VALIDATION_ERROR');
  }
  await model.guardarApp({ clientId, secreto, margenPct, userId });
  if (antes?.client_id && clientId && antes.client_id !== clientId) await model.borrarTokens();
  return estado();
}

export async function desconectar({ todo = false } = {}) {
  if (todo) await model.borrarTodo();
  else await model.borrarTokens();
  return estado();
}

/** La dirección de Monitask a la que se manda el navegador de quien pulsa «Conectar». */
export async function iniciarConexion(userId, env = process.env) {
  const c = await model.conexion();
  if (!c?.client_id || !c?.secreto_cifrado) {
    throw new AppError('Guarda primero el Client ID y el Client Secret de la aplicación de Monitask', 400, 'MONITASK_SIN_APP');
  }
  const uri = redirectUri(env);
  if (!uri) {
    throw new AppError('Falta CRM_BASE_URL (o MONITASK_REDIRECT_URI) en el servidor: sin ella no se sabe a dónde vuelve Monitask', 409, 'MONITASK_SIN_REDIRECT');
  }
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(48));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  await model.guardarEstadoOAuth({
    stateHash: sha256(state),
    verifier: encrypt(verifier),
    caducaAt: new Date(Date.now() + VIDA_DEL_CONECTAR_MS),
    userId,
  });
  return { url: cliente.urlDeAutorizacion({ clientId: c.client_id, redirectUri: uri, state, codeChallenge: challenge, env }) };
}

/**
 * La vuelta de Monitask. Devuelve { ok } o { ok: false, motivo } y nunca lanza: el
 * navegador tiene que volver a Integraciones pase lo que pase.
 *
 *   sin_estado / estado_no_valido / caducado   el `state` no es el de un «Conectar» vivo
 *   denegado      quien autorizaba dijo que no en Monitask
 *   sin_codigo    Monitask no mandó el código
 *   token         Monitask no dio los tokens (secreto mal pegado, redirect distinta…)
 */
export async function completarConexion({ code, state, error }, env = process.env) {
  if (!state) return { ok: false, motivo: 'sin_estado' };
  const pendiente = await model.tomarEstadoOAuth(sha256(state));
  if (!pendiente) return { ok: false, motivo: 'estado_no_valido' };
  if (!pendiente.oauth_caduca_at || new Date(pendiente.oauth_caduca_at).getTime() < Date.now()) {
    return { ok: false, motivo: 'caducado' };
  }
  if (error) return { ok: false, motivo: 'denegado' };
  if (!code) return { ok: false, motivo: 'sin_codigo' };
  const c = await model.conexion();
  try {
    const t = await cliente.cambiarCodigo({
      clientId: c.client_id,
      secreto: descifrar(c.secreto_cifrado, c.secreto_iv, c.secreto_tag),
      code,
      redirectUri: redirectUri(env),
      codeVerifier: descifrar(pendiente.oauth_verifier_cifrado, pendiente.oauth_verifier_iv, pendiente.oauth_verifier_tag),
    });
    await model.guardarTokens({
      access: encrypt(t.accessToken),
      caducaAt: new Date(Date.now() + t.expiraEn * 1000),
      refresh: t.refreshToken ? encrypt(t.refreshToken) : null,
      conectadaPor: pendiente.oauth_iniciado_por || null,
      nuevaConexion: true,
    });
    return { ok: true };
  } catch (err) {
    logger.warn({ err: err.message }, 'Monitask: no se pudo completar la conexión');
    await model.apuntarError(err.message).catch(() => {});
    return { ok: false, motivo: 'token' };
  }
}

// ─── El token ───────────────────────────────────────────────────────────────

let renovando = null;

async function renovarAhora(c) {
  try {
    const t = await cliente.renovar({
      clientId: c.client_id,
      secreto: descifrar(c.secreto_cifrado, c.secreto_iv, c.secreto_tag),
      refreshToken: descifrar(c.refresh_cifrado, c.refresh_iv, c.refresh_tag),
    });
    await model.guardarTokens({
      access: encrypt(t.accessToken),
      caducaAt: new Date(Date.now() + t.expiraEn * 1000),
      refresh: t.refreshToken ? encrypt(t.refreshToken) : null,
    });
    return t.accessToken;
  } catch (err) {
    // `invalid_grant`: el permiso ya no vale (lo retiraron en Monitask, o caducó sin
    // usarse). No hay arreglo sin una persona: se borran los tokens y se dice.
    if (err.codigo === 'invalid_grant') {
      await model.borrarTokens();
      const msg = 'Monitask ya no acepta la conexión (el permiso caducó o se retiró): vuelve a pulsar «Conectar con Monitask» en Integraciones.';
      await model.apuntarError(msg);
      throw new AppError(msg, 409, 'MONITASK_CADUCADO');
    }
    await model.apuntarError(err.message);
    throw err;
  }
}

/** Un access token que sirve ahora. Renueva si le quedan menos de dos minutos (o si se fuerza). */
export async function tokenVigente({ forzar = false } = {}) {
  const c = await model.conexion();
  if (!c?.access_cifrado && !c?.refresh_cifrado) {
    throw new AppError('Monitask no está conectado: pulsa «Conectar con Monitask» en Integraciones', 409, 'MONITASK_SIN_CONECTAR');
  }
  const vence = c.access_caduca_at ? new Date(c.access_caduca_at).getTime() : 0;
  if (!forzar && c.access_cifrado && vence - Date.now() > SEGUNDOS_DE_MARGEN_DEL_TOKEN * 1000) {
    return descifrar(c.access_cifrado, c.access_iv, c.access_tag);
  }
  if (!c.refresh_cifrado) {
    throw new AppError('El acceso a Monitask ha caducado y no se puede renovar solo: vuelve a pulsar «Conectar con Monitask»', 409, 'MONITASK_CADUCADO');
  }
  // Dos peticiones a la vez no renuevan dos veces: con refresh tokens de un solo uso,
  // la segunda gastaría uno ya cambiado y tumbaría la conexión.
  // Y se relee la conexión dentro: quien llegue cuando otra ya renovó no puede usar el
  // refresh token viejo (ya cambiado), que Monitask rechazaría y tumbaría la conexión.
  if (!renovando) {
    renovando = (async () => {
      const fresca = await model.conexion();
      const venceAhora = fresca?.access_caduca_at ? new Date(fresca.access_caduca_at).getTime() : 0;
      if (!forzar && fresca?.access_cifrado && venceAhora - Date.now() > SEGUNDOS_DE_MARGEN_DEL_TOKEN * 1000) {
        return descifrar(fresca.access_cifrado, fresca.access_iv, fresca.access_tag);
      }
      if (!fresca?.refresh_cifrado) {
        throw new AppError('Monitask no está conectado: pulsa «Conectar con Monitask» en Integraciones', 409, 'MONITASK_SIN_CONECTAR');
      }
      return renovarAhora(fresca);
    })().finally(() => { renovando = null; });
  }
  return renovando;
}

/** Llama a la API con el token; si contesta 401, renueva y lo intenta una vez más. */
async function conToken(llamada) {
  const token = await tokenVigente();
  try {
    return await llamada(token);
  } catch (err) {
    if (err?.status !== 401) throw err;
    return llamada(await tokenVigente({ forzar: true }));
  }
}

// ─── Sincronizar ────────────────────────────────────────────────────────────

const enteroEnv = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

export const diasNocturnos = (env = process.env) => enteroEnv(env.MONITASK_SYNC_DIAS, 3, 1, 62);
const diasPorTramo = (env = process.env) => enteroEnv(env.MONITASK_TRAMO_DIAS, 7, 1, 31);

/**
 * Trae de Monitask los días [desde, hasta] (de Madrid) de todas las personas.
 * Una a la vez: si ya hay una vuelta en marcha, 409.
 */
export async function sincronizar({ desde, hasta, nocturna = null } = {}, env = process.env) {
  if (!monitaskActivo(env)) return { apagado: true };
  if (enMarcha) throw new AppError('Ya se está sincronizando con Monitask: espera a que termine', 409, 'OCUPADO');
  enMarcha = true;
  const tz = datos.zona(env);
  const resultado = {
    desde, hasta, personas: 0, dias: 0, emparejadas: 0, avisos: 0,
    sin_actividad: false, errores: [], campos: {}, empezo: new Date().toISOString(),
  };
  try {
    const usuarios = datos.lista(await conToken((t) => cliente.usuarios(t, env)));
    resultado.campos.usuarios = datos.camposDe(usuarios);
    const personas = usuarios.map(datos.normalizarUsuario).filter(Boolean);
    for (const p of personas) await model.guardarPersona(p);
    resultado.emparejadas = await model.emparejarPorCorreo();

    // Los nombres de los proyectos, por si las entradas solo traen el id.
    const nombres = new Map();
    try {
      const proyectos = datos.lista(await conToken((t) => cliente.proyectos(t, env)));
      resultado.campos.proyectos = datos.camposDe(proyectos);
      for (const p of proyectos.map(datos.normalizarProyecto).filter(Boolean)) nombres.set(p.id, p.nombre);
    } catch (err) {
      if (err.code === 'MONITASK_CADUCADO') throw err;
      resultado.errores.push({ que: 'proyectos', error: String(err.message).slice(0, 200) });
    }

    for (const persona of personas) {
      try {
        const entradas = [];
        const actividad = [];
        for (const [a, b] of datos.tramos(desde, hasta, diasPorTramo(env))) {
          const rango = {
            userId: persona.id,
            desdeMs: datos.inicioDelDia(a, tz),
            hastaMs: datos.inicioDelDia(datos.sumarDias(b, 1), tz),
          };
          const crudas = datos.lista(await conToken((t) => cliente.entradas(t, rango, env)));
          if (crudas.length && !resultado.campos.entradas) resultado.campos.entradas = datos.camposDe(crudas);
          entradas.push(...crudas.map(datos.normalizarEntrada).filter(Boolean));
          if (!resultado.sin_actividad) {
            try {
              const act = datos.lista(await conToken((t) => cliente.actividad(t, rango, env)));
              if (act.length && !resultado.campos.actividad) resultado.campos.actividad = datos.camposDe(act);
              actividad.push(...act.map(datos.normalizarActividad).filter(Boolean));
            } catch (err) {
              if (err.code === 'MONITASK_CADUCADO') throw err;
              // Sin actividad las horas siguen valiendo: se apunta una vez y se sigue sin ella.
              resultado.sin_actividad = true;
              resultado.errores.push({ que: 'actividad', error: String(err.message).slice(0, 200) });
            }
          }
        }
        const dias = datos.resumirPorDia({ entradas, actividad, desde, hasta, tz, proyectos: nombres });
        await model.guardarDias(persona.id, desde, hasta, dias);
        resultado.personas += 1;
        resultado.dias += Object.keys(dias).length;
      } catch (err) {
        if (err.code === 'MONITASK_CADUCADO') throw err;
        resultado.errores.push({ que: `persona ${persona.id}`, error: String(err.message).slice(0, 200) });
      }
    }

    const sinFallos = resultado.errores.filter((e) => e.que.startsWith('persona')).length === 0;
    await model.apuntarSincronizacion({ ...resultado, termino: new Date().toISOString() },
      { nocturna, cubierto: sinFallos ? desde : null });
    try {
      resultado.avisos = await avisarDescuadres();
    } catch (err) {
      logger.warn({ err: err.message }, 'Monitask: no se pudieron mirar los descuadres');
    }
    if (resultado.avisos) await model.apuntarSincronizacion({ ...resultado, termino: new Date().toISOString() });
    return resultado;
  } catch (err) {
    await model.apuntarError(err.message).catch(() => {});
    await model.apuntarSincronizacion({ ...resultado, fallo: String(err.message).slice(0, 300) }, { nocturna })
      .catch(() => {});
    throw err;
  } finally {
    enMarcha = false;
  }
}

/** Lo mismo, sin esperar: para el botón y para después de conectar. */
export function sincronizarEnSegundoPlano(rango, env = process.env) {
  if (enMarcha) throw new AppError('Ya se está sincronizando con Monitask: espera a que termine', 409, 'OCUPADO');
  sincronizar(rango, env).catch((err) => logger.warn({ err: err.message }, 'Monitask: la sincronización falló'));
}

/** Los últimos `n` días hasta hoy (de Madrid), hoy incluido. */
export function ultimosDias(n, ahora = new Date(), env = process.env) {
  const hoy = datos.diaEn(ahora, datos.zona(env));
  return { desde: datos.sumarDias(hoy, -(n - 1)), hasta: hoy };
}

// ─── Actividad ──────────────────────────────────────────────────────────────

const horas = (seg) => Math.round((Number(seg) || 0) / 36) / 100;
const pct = (activos, medidos) => (medidos > 0 && activos !== null && activos !== undefined
  ? Math.round((Number(activos) / Number(medidos)) * 1000) / 10 : null);

export async function actividad({ desde, hasta, ambito, monitaskId = null, proyecto = null }) {
  const filas = await model.actividadPorPersona({ desde, hasta, ambito, monitaskId, proyecto });
  const proyectos = await model.proyectosDe({ ids: filas.map((f) => f.monitask_id), desde, hasta });
  return filas.map((f) => ({
    monitask_id: Number(f.monitask_id),
    nombre: f.nombre,
    correo: f.correo,
    colaborador_id: f.colaborador_id,
    colaborador_nombre: f.colaborador_nombre,
    user_id: f.user_id,
    usuario_nombre: f.usuario_nombre,
    horas: horas(f.segundos),
    horas_activas: f.segundos_activos === null ? null : horas(f.segundos_activos),
    actividad_pct: pct(f.segundos_activos, f.segundos_medidos),
    dias: f.dias,
    proyectos: proyectos.filter((p) => String(p.monitask_id) === String(f.monitask_id))
      .slice(0, 8).map((p) => ({ nombre: p.nombre, horas: horas(p.segundos) })),
  }));
}

export async function diasDePersona({ monitaskId, desde, hasta, ambito }) {
  const persona = await model.personaEnAmbito(monitaskId, ambito);
  if (!persona) throw new AppError('Persona no encontrada', 404, 'NOT_FOUND');
  const dias = await model.diasDe({ monitaskId, desde, hasta });
  return {
    persona: { monitask_id: Number(persona.monitask_id), nombre: persona.nombre },
    dias: dias.map((d) => ({
      dia: d.dia,
      horas: horas(d.segundos),
      horas_activas: d.segundos_activos === null ? null : horas(d.segundos_activos),
      actividad_pct: d.actividad_pct === null ? null : Number(d.actividad_pct),
      entradas: d.entradas,
      proyectos: (d.proyectos || []).map((p) => ({ nombre: p.nombre, horas: horas(p.segundos) })),
      tareas: (d.tareas || []).slice(0, 10).map((t) => ({ nombre: t.nombre, proyecto: t.proyecto, horas: horas(t.segundos) })),
    })),
  };
}

// ─── Emparejar ──────────────────────────────────────────────────────────────

export async function personas() {
  const [lista, cand] = await Promise.all([model.listarPersonas(), model.candidatos()]);
  return { personas: lista.map((p) => ({ ...p, monitask_id: Number(p.monitask_id) })), ...cand };
}

export async function emparejar(monitaskId, { colaboradorId = null, userId = null, ninguno = false }, por) {
  let usuario = userId;
  if (colaboradorId) {
    const col = await model.existeColaborador(colaboradorId);
    if (!col) throw new AppError('Esa ficha de colaborador no existe', 400, 'VALIDATION_ERROR');
    // La ficha ya dice qué usuario es: si no se ha elegido otro, ese.
    if (!usuario && col.user_id) usuario = col.user_id;
  }
  if (usuario && !(await model.existeUsuario(usuario))) throw new AppError('Ese usuario no existe', 400, 'VALIDATION_ERROR');
  const r = await model.emparejarAMano(monitaskId, { colaboradorId, userId: usuario, ninguno, por });
  if (!r) throw new AppError('Persona no encontrada', 404, 'NOT_FOUND');
  return r;
}

// ─── El cotejo ──────────────────────────────────────────────────────────────

const suma = (xs) => Math.round(xs.reduce((s, x) => s + (Number(x) || 0), 0) * 100) / 100;

/**
 * El cotejo de un mes («2026-10-01»): por colaborador, horas facturadas · horas en
 * Monitask · diferencia (h y %), y si se pasa del margen. Las horas facturadas son
 * las de TODAS sus facturas por horas de ese mes (a cualquier empresa del grupo): es
 * lo que se compara con todo lo que registra Monitask. A quien no ve todas las
 * empresas se le dicen cuántas son de otras, pero no cuáles.
 */
export async function cotejo({ periodo, ambito, colaboradorId = null }) {
  const c = await model.conexion();
  const margen = c ? Number(c.margen_pct) : 10;
  const { colaboradores, facturas, horas: horasMonitask } = await model.datosDelCotejo({ periodo, ambito, colaboradorId });
  const filas = colaboradores.map((col) => {
    const suyas = facturas.filter((f) => f.colaborador_id === col.id);
    const porHoras = suyas.filter((f) => f.horas !== null && f.modalidad !== 'fijo');
    const horasFacturadas = porHoras.length ? suma(porHoras.map((f) => f.horas)) : null;
    const h = horasMonitask.find((x) => x.colaborador_id === col.id);
    const enMonitask = h ? horas(h.segundos) : 0;
    const r = datos.cotejar({ horasFacturadas, horasMonitask: enMonitask, margenPct: margen });
    return {
      colaborador_id: col.id,
      nombre: col.nombre,
      email: col.email,
      con_monitask: !!col.con_monitask,
      horas_facturadas: horasFacturadas,
      horas_otras_empresas: suma(porHoras.filter((f) => !f.en_ambito).map((f) => f.horas)),
      horas_monitask: enMonitask,
      horas_activas: h && h.segundos_activos !== null ? horas(h.segundos_activos) : null,
      actividad_pct: h ? pct(h.segundos_activos, h.segundos_medidos) : null,
      dias: h ? h.dias : 0,
      sin_cotejo: r.sinCotejo,
      diferencia_horas: r.diferenciaHoras,
      diferencia_pct: r.diferenciaPct,
      fuera_de_margen: r.fuera,
      sin_factura: suyas.length === 0,
      facturas: suyas.filter((f) => f.en_ambito).map((f) => ({
        id: f.id, empresa: f.empresa, horas: f.horas === null ? null : Number(f.horas), modalidad: f.modalidad,
        numero_factura: f.numero_factura, numero_recepcion: f.numero_recepcion,
        pagada: !!f.pagada_at, issuer_id: f.issuer_id,
      })),
    };
  });
  const fuera = filas.filter((f) => f.fuera_de_margen);
  return {
    periodo,
    margen_pct: margen,
    filas,
    resumen: {
      colaboradores: filas.length,
      con_cotejo: filas.filter((f) => !f.sin_cotejo).length,
      factura_de_mas: fuera.filter((f) => (f.diferencia_horas ?? 0) > 0).map((f) => f.colaborador_id),
      factura_de_menos: fuera.filter((f) => (f.diferencia_horas ?? 0) < 0).map((f) => f.colaborador_id),
    },
  };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesEscrito = (p) => { const [a, m] = String(p).split('-').map(Number); return `${MESES[m - 1]} de ${a}`; };

/**
 * La campana: facturas por horas, sin pagar, de un mes ya cerrado y cubierto
 * entero por Monitask, que se pasan del margen. Una vez por factura, a quien la
 * paga (superadmin y los admin de esa empresa, como el aviso de factura recibida).
 */
export async function avisarDescuadres({ ahora = new Date() } = {}) {
  const c = await model.conexion();
  if (!c?.cubierto_desde_txt) return 0;
  const hoy = datos.diaEn(ahora);
  const esteMes = `${hoy.slice(0, 7)}-01`;
  const mesAnterior = datos.sumarDias(esteMes, -1).slice(0, 7) + '-01';
  // El primer mes entero con datos.
  const cubierto = c.cubierto_desde_txt;
  const primero = cubierto.endsWith('-01') ? cubierto : `${datos.sumarDias(`${cubierto.slice(0, 7)}-01`, 40).slice(0, 7)}-01`;
  if (primero > mesAnterior) return 0;
  const pendientes = await model.facturasParaAvisar({ desdePeriodo: primero, hastaPeriodo: mesAnterior });
  let avisos = 0;
  for (const { colaborador_id: colaboradorId, periodo } of pendientes) {
    const { filas, margen_pct: margen } = await cotejo({ periodo, ambito: null, colaboradorId });
    const fila = filas[0];
    if (!fila || fila.sin_cotejo || !fila.fuera_de_margen || !fila.con_monitask) continue;
    for (const f of fila.facturas) {
      if (f.pagada || f.horas === null || f.modalidad === 'fijo') continue;
      const nuevo = await model.apuntarAviso({
        facturaId: f.id, horasFacturadas: fila.horas_facturadas, horasMonitask: fila.horas_monitask,
        diferenciaPct: fila.diferencia_pct,
      });
      if (!nuevo) continue;
      const destinatarios = await avisarA(f.issuer_id);
      if (!destinatarios.length) continue;
      const dif = fila.diferencia_pct === null ? 'Monitask no tiene horas' : `${fila.diferencia_pct > 0 ? '+' : ''}${fila.diferencia_pct} %`;
      await notifyUsers({
        targetUserIds: destinatarios,
        type: 'monitask_descuadre',
        title: `Horas que no cuadran: ${fila.nombre}`,
        message: `${mesEscrito(periodo)} · factura ${fila.horas_facturadas} h, Monitask ${fila.horas_monitask} h (${dif}; margen ${margen} %). Revísalo antes de pagarla.`,
        link_path: `/equipo/actividad?vista=cotejo&mes=${String(periodo).slice(0, 7)}`,
        metadata: { factura_id: f.id, colaborador_id: colaboradorId, periodo },
      });
      avisos += 1;
    }
  }
  return avisos;
}
