/**
 * Monitask (#236) · lo que se hace con lo que devuelve su API, sin red ni base.
 *
 * La especificación de la API externa (external.monitask.com/swagger/v1/swagger.json)
 * NO describe las respuestas: solo las rutas y los parámetros. Por eso aquí se lee
 * con tolerancia: cada dato se busca por los nombres que puede tener («startedAt» o
 * «start», «projectId» o «project.id»…) y lo que no se reconoce se ignora sin
 * romper la sincronización. La primera vuelta de verdad guarda qué campos trae cada
 * respuesta (solo los NOMBRES, nunca valores) en el resultado de la sincronización,
 * para poder afinar esto si hiciera falta.
 *
 * Los días son de Madrid (o de MONITASK_ZONA): una entrada que cruza la medianoche
 * se reparte entre los dos días.
 */

export const ZONA_POR_DEFECTO = 'Europe/Madrid';

export function zona(env = process.env) {
  const z = String(env.MONITASK_ZONA || '').trim();
  if (!z) return ZONA_POR_DEFECTO;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: z });
    return z;
  } catch {
    return ZONA_POR_DEFECTO;
  }
}

// ─── Fechas en la zona de la empresa ────────────────────────────────────────

const formateadores = new Map();
function partesEn(fecha, tz) {
  if (!formateadores.has(tz)) {
    formateadores.set(tz, new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }));
  }
  const p = Object.fromEntries(formateadores.get(tz).formatToParts(fecha).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** «2026-11-17»: el día de ese instante en la zona. */
export function diaEn(fecha, tz = ZONA_POR_DEFECTO) {
  const { y, m, d } = partesEn(new Date(fecha), tz);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Minutos que la zona va por delante de UTC en ese instante. */
function desfase(instanteMs, tz) {
  const p = partesEn(new Date(instanteMs), tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instanteMs / 1000) * 1000) / 60000;
}

/** El instante (ms) en que empieza ese día («2026-11-17») en la zona. */
export function inicioDelDia(dia, tz = ZONA_POR_DEFECTO) {
  const [y, m, d] = String(dia).split('-').map(Number);
  const local = Date.UTC(y, m - 1, d);
  // Dos pasos: el desfase de la medianoche puede no ser el de la hora estimada
  // los días de cambio de hora.
  let t = local - desfase(local, tz) * 60000;
  t = local - desfase(t, tz) * 60000;
  return t;
}

/** «2026-11-17» + n días. */
export function sumarDias(dia, n) {
  const [y, m, d] = String(dia).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Los días entre dos fechas, ambas incluidas. */
export function diasEntre(desde, hasta) {
  const lista = [];
  for (let d = desde; d <= hasta && lista.length < 400; d = sumarDias(d, 1)) lista.push(d);
  return lista;
}

/** Tramos de como mucho `n` días para no pedir rangos enormes a la API. */
export function tramos(desde, hasta, n = 7) {
  const salida = [];
  for (let d = desde; d <= hasta; d = sumarDias(d, n)) {
    const fin = sumarDias(d, n - 1);
    salida.push([d, fin < hasta ? fin : hasta]);
  }
  return salida;
}

/** Una fecha de la API a milisegundos. Sin zona escrita, se toma como UTC. */
export function aMs(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  if (typeof valor === 'number') return valor > 1e12 ? valor : valor * 1000;
  const s = String(valor).trim();
  const conZona = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  const t = Date.parse(conZona || !/T\d/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : null;
}

// ─── Lectura tolerante ──────────────────────────────────────────────────────

/** El primer valor no vacío entre varias rutas («project.id», «projectId»…). */
function primero(obj, rutas) {
  for (const ruta of rutas) {
    let v = obj;
    for (const k of ruta.split('.')) v = v == null ? undefined : v[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

/** La lista de una respuesta, venga como array o envuelta. */
export function lista(respuesta) {
  if (Array.isArray(respuesta)) return respuesta;
  if (!respuesta || typeof respuesta !== 'object') return [];
  for (const k of ['data', 'items', 'result', 'results', 'value', 'values', 'timeEntries', 'activities', 'users', 'projects']) {
    if (Array.isArray(respuesta[k])) return respuesta[k];
  }
  return [];
}

/** Los nombres de los campos de una lista (sin valores), para el diagnóstico. */
export function camposDe(items) {
  const set = new Set();
  for (const it of (items || []).slice(0, 20)) {
    if (it && typeof it === 'object') Object.keys(it).forEach((k) => set.add(k));
  }
  return [...set].sort();
}

/**
 * El aviso cuando Monitask devuelve datos y el CRM no entiende ninguno: con los
 * NOMBRES de sus campos (nunca valores), para poder adaptar la lectura.
 */
export function avisoDeFormato(que, cuantas, campos = []) {
  const lista = (campos || []).slice(0, 25).join(', ') || 'ninguno';
  return `Monitask devolvió ${cuantas} ${que} y el CRM no ha sabido leer ninguna. Campos que trae: ${lista}.`;
}

const esCorreo = (v) => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export function normalizarUsuario(u) {
  const id = Number(primero(u, ['id', 'userId', 'Id']));
  if (!Number.isFinite(id) || id <= 0) return null;
  const correo = [primero(u, ['email', 'Email', 'emailAddress']), primero(u, ['userName', 'username', 'login'])]
    .find(esCorreo) || null;
  const nombre = [primero(u, ['firstName']), primero(u, ['lastName'])].filter(Boolean).join(' ').trim()
    || primero(u, ['name', 'fullName', 'displayName', 'userName']) || `Persona ${id}`;
  return { id, nombre: String(nombre).slice(0, 200), correo: correo ? correo.trim().toLowerCase().slice(0, 255) : null };
}

export function normalizarProyecto(p) {
  const id = Number(primero(p, ['id', 'projectId']));
  if (!Number.isFinite(id)) return null;
  return { id, nombre: String(primero(p, ['name', 'projectName', 'title']) || `Proyecto ${id}`).slice(0, 200) };
}

/**
 * Una entrada de tiempo: { inicio, fin } en ms, su proyecto y su tarea («note»
 * en Monitask). Si no trae fin, se calcula con la duración. null si no se entiende.
 */
export function normalizarEntrada(e) {
  const inicio = aMs(primero(e, ['startedAt', 'startDate', 'start', 'dateStart', 'startTime', 'from', 'begin']));
  let fin = aMs(primero(e, ['endedAt', 'endDate', 'end', 'dateEnd', 'endTime', 'to', 'finish']));
  if (inicio !== null && fin === null) {
    const seg = Number(primero(e, ['duration', 'durationSeconds', 'totalSeconds', 'seconds', 'trackedSeconds']));
    if (Number.isFinite(seg) && seg > 0) fin = inicio + seg * 1000;
  }
  if (inicio === null || fin === null || fin <= inicio) return null;
  // Un día entero como mucho por entrada: más es un dato roto, no trabajo.
  if (fin - inicio > 24 * 3600 * 1000) fin = inicio + 24 * 3600 * 1000;
  const proyectoId = primero(e, ['projectId', 'project.id']);
  const tareaId = primero(e, ['noteId', 'note.id', 'taskId', 'task.id']);
  return {
    inicio, fin,
    proyectoId: proyectoId === null ? null : Number(proyectoId),
    proyectoNombre: primero(e, ['projectName', 'project.name']),
    tareaId: tareaId === null ? null : Number(tareaId),
    tareaNombre: primero(e, ['noteText', 'noteName', 'note.text', 'note.name', 'taskName', 'task.name', 'noteKey']),
  };
}

/**
 * Un tramo de actividad: { inicio, fin, nivel 0-100 }. Monitask mide la
 * actividad (teclado y ratón) por intervalos; sin fin, se toma la duración o
 * 10 minutos. null si no hay nivel.
 */
export function normalizarActividad(a) {
  const nivelCrudo = primero(a, ['activityLevel', 'activityPercent', 'activityRate', 'activity', 'level', 'percent', 'percentage', 'value']);
  let nivel = Number(nivelCrudo);
  if (!Number.isFinite(nivel)) return null;
  const inicio = aMs(primero(a, ['startedAt', 'startDate', 'start', 'from', 'date', 'time', 'timestamp', 'createdAt']));
  if (inicio === null) return null;
  let fin = aMs(primero(a, ['endedAt', 'endDate', 'end', 'to']));
  if (fin === null || fin <= inicio) {
    const seg = Number(primero(a, ['duration', 'durationSeconds', 'seconds', 'interval']));
    fin = inicio + (Number.isFinite(seg) && seg > 0 ? seg : 600) * 1000;
  }
  nivel = Math.max(0, nivel);
  return { inicio, fin, nivel };
}

/** Si TODOS los niveles van de 0 a 1 y alguno tiene decimales, son fracciones: a %. */
export function nivelesEnPorcentaje(tramosAct) {
  const fracciones = tramosAct.length > 0
    && tramosAct.every((t) => t.nivel <= 1)
    && tramosAct.some((t) => t.nivel > 0 && t.nivel < 1);
  return tramosAct.map((t) => ({ ...t, nivel: Math.min(100, fracciones ? t.nivel * 100 : t.nivel) }));
}

/** Parte [inicio, fin) por días de la zona: [{ dia, ms }]. */
export function repartirPorDias(inicio, fin, tz = ZONA_POR_DEFECTO) {
  const trozos = [];
  let cursor = inicio;
  let vueltas = 0;
  while (cursor < fin && vueltas++ < 40) {
    const dia = diaEn(cursor, tz);
    const siguiente = inicioDelDia(sumarDias(dia, 1), tz);
    const hasta = Math.min(fin, siguiente);
    trozos.push({ dia, ms: hasta - cursor });
    cursor = hasta;
  }
  return trozos;
}

/**
 * El resumen por día de una persona, con sus entradas y su actividad ya
 * normalizadas. Solo los días de [desde, hasta]. Las entradas que se pisan
 * (dos a la vez) no se suman dos veces: se juntan antes.
 *
 * Devuelve { [dia]: { segundos, entradas, segundosActivos, actividadPct, proyectos, tareas } }.
 */
export function resumirPorDia({ entradas, actividad, desde, hasta, tz = ZONA_POR_DEFECTO, proyectos = new Map() }) {
  const dias = {};
  const dentro = (d) => d >= desde && d <= hasta;
  const delDia = (d) => {
    if (!dias[d]) dias[d] = { segundos: 0, entradas: 0, msActividad: 0, msActivos: 0, proyectos: new Map(), tareas: new Map() };
    return dias[d];
  };

  // Sin solapes: ordenar y recortar lo que ya está contado.
  const ordenadas = [...entradas].sort((a, b) => a.inicio - b.inicio);
  let hastaAhora = -Infinity;
  for (const e of ordenadas) {
    const inicio = Math.max(e.inicio, hastaAhora);
    if (e.fin <= inicio) continue;
    hastaAhora = Math.max(hastaAhora, e.fin);
    let contada = false;
    for (const { dia, ms } of repartirPorDias(inicio, e.fin, tz)) {
      if (!dentro(dia)) continue;
      const r = delDia(dia);
      r.segundos += ms / 1000;
      if (!contada) { r.entradas += 1; contada = true; }
      const pKey = e.proyectoId ?? 'sin';
      const pNombre = e.proyectoNombre || (e.proyectoId !== null ? proyectos.get(e.proyectoId) : null)
        || (e.proyectoId !== null ? `Proyecto ${e.proyectoId}` : 'Sin proyecto');
      const p = r.proyectos.get(pKey) || { id: e.proyectoId, nombre: pNombre, segundos: 0 };
      p.segundos += ms / 1000;
      r.proyectos.set(pKey, p);
      if (e.tareaId !== null || e.tareaNombre) {
        const tKey = e.tareaId ?? e.tareaNombre;
        const t = r.tareas.get(tKey) || {
          id: e.tareaId, nombre: String(e.tareaNombre || `Tarea ${e.tareaId}`).slice(0, 200), proyecto: pNombre, segundos: 0,
        };
        t.segundos += ms / 1000;
        r.tareas.set(tKey, t);
      }
    }
  }

  for (const a of nivelesEnPorcentaje(actividad)) {
    for (const { dia, ms } of repartirPorDias(a.inicio, a.fin, tz)) {
      if (!dentro(dia)) continue;
      const r = delDia(dia);
      r.msActividad += ms;
      r.msActivos += ms * (a.nivel / 100);
    }
  }

  const redondo = (x) => Math.round(x);
  const salida = {};
  for (const [dia, r] of Object.entries(dias)) {
    const conActividad = r.msActividad > 0;
    salida[dia] = {
      segundos: redondo(r.segundos),
      entradas: r.entradas,
      // Los segundos activos se calculan sobre el tiempo trabajado del día con el
      // % medio: el tiempo con actividad medida y el registrado no siempre coinciden.
      actividadPct: conActividad ? Math.round((r.msActivos / r.msActividad) * 10000) / 100 : null,
      segundosActivos: conActividad ? redondo(r.segundos * (r.msActivos / r.msActividad)) : null,
      proyectos: [...r.proyectos.values()].map((p) => ({ ...p, segundos: redondo(p.segundos) }))
        .sort((a, b) => b.segundos - a.segundos),
      tareas: [...r.tareas.values()].map((t) => ({ ...t, segundos: redondo(t.segundos) }))
        .sort((a, b) => b.segundos - a.segundos).slice(0, 50),
    };
  }
  return salida;
}

// ─── El cotejo ──────────────────────────────────────────────────────────────

/**
 * Horas facturadas frente a horas de Monitask. La diferencia se cuenta sobre
 * Monitask: «factura un 15 % más de lo que registra».
 *
 *   sinCotejo   no factura por horas (fijo) o la factura no dice horas
 *   fuera       la diferencia pasa del margen (en cualquiera de los dos sentidos)
 */
export function cotejar({ horasFacturadas, horasMonitask, margenPct = 10 }) {
  if (horasFacturadas === null || horasFacturadas === undefined || !Number.isFinite(Number(horasFacturadas))) {
    return { sinCotejo: true, diferenciaHoras: null, diferenciaPct: null, fuera: false };
  }
  const f = Number(horasFacturadas);
  const m = Number(horasMonitask) || 0;
  const diferenciaHoras = Math.round((f - m) * 100) / 100;
  let diferenciaPct;
  if (m > 0) diferenciaPct = Math.round(((f - m) / m) * 10000) / 100;
  else diferenciaPct = f > 0 ? null : 0;   // null: factura horas y Monitask no tiene ninguna
  const fuera = diferenciaPct === null ? f > 0 : Math.abs(diferenciaPct) > Number(margenPct);
  return { sinCotejo: false, diferenciaHoras, diferenciaPct, fuera };
}
