import { query } from '../config/db.js';
import { logger } from '../utils/logger.js';
import { avisaSiCruzaUmbral } from './gastoIAAviso.service.js';

/**
 * Cuanto llevamos gastado en IA este mes, y cuando hay que parar (#22, #30).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE EXISTE
 *
 * Hay dos sitios que llaman a Anthropic —el chat y el reporte mensual— y
 * ninguno lleva la cuenta. El chat hasta recibe los tokens de cada respuesta y
 * los guarda en la fila del mensaje; nadie los suma nunca. Asi que la pregunta
 * «¿cuanto llevamos este mes?» hoy solo la contesta la factura, cuando ya se
 * gasto.
 *
 * El issue #22 pone la condicion: «Sin tope no se enciende». El dia que se
 * ponga la clave esto ya tiene que estar puesto — no despues, porque el
 * "despues" de un tope es el recibo.
 *
 * LOS TOKENS SON UN HECHO, EL DINERO ES UNA CUENTA NUESTRA
 *
 * Los tokens los manda la API en `usage`. El coste lo calculamos aqui con una
 * tabla de precios que puede quedarse vieja, o no conocer un modelo que salio
 * la semana pasada. Por eso van separados en la tabla y por eso existe
 * `incierto`.
 *
 * Y por eso un modelo desconocido NO cuenta cero: cuenta al precio del mas caro
 * que conocemos. Cero seria la version silenciosa del fallo — el tope dejaria
 * de existir justo cuando alguien cambia `CLAUDE_MODEL` a algo nuevo, que es
 * exactamente cuando mas falta hace.
 *
 * EN DOLARES
 *
 * Anthropic factura en USD. Convertir a euros con un cambio fijo seria
 * inventarse un numero que ademas se mueve solo. Todo lo de aqui es USD y las
 * pantallas tienen que decirlo.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** USD por millon de tokens. Solo modelos comprobados contra la documentacion. */
const PRECIOS = {
  'claude-opus-5': { entrada: 5, salida: 25 },
  'claude-opus-4-8': { entrada: 5, salida: 25 },
  'claude-opus-4-7': { entrada: 5, salida: 25 },
  'claude-opus-4-6': { entrada: 5, salida: 25 },
  'claude-sonnet-5': { entrada: 3, salida: 15 },
  'claude-sonnet-4-6': { entrada: 3, salida: 15 },
  'claude-sonnet-4-5': { entrada: 3, salida: 15 },
  'claude-haiku-4-5': { entrada: 1, salida: 5 },
  'claude-fable-5': { entrada: 10, salida: 50 },
};

/** Si no sabemos el modelo exacto pero si la familia, se cobra por familia. */
const POR_FAMILIA = {
  fable: { entrada: 10, salida: 50 },
  mythos: { entrada: 10, salida: 50 },
  opus: { entrada: 5, salida: 25 },
  sonnet: { entrada: 3, salida: 15 },
  haiku: { entrada: 1, salida: 5 },
};

/** Lo mas caro que conocemos. Es lo que se le cobra a lo que no reconocemos. */
const EL_MAS_CARO = { entrada: 10, salida: 50 };

/** Lo que cuesta la cache respecto a la entrada normal. */
const FACTOR_CACHE_LECTURA = 0.1;
const FACTOR_CACHE_ESCRITURA = 1.25;

/**
 * Precio de un modelo.
 *
 * `incierto: true` significa «esto es un tope superior, no el precio». Sube
 * hasta la fila de la tabla para que despues se pueda ver que llamadas se
 * contaron a ojo.
 */
export function precioDe(modelo) {
  // Bedrock y Vertex prefijan el id; el modelo —y el precio— es el mismo.
  const id = String(modelo || '').trim().toLowerCase().replace(/^anthropic\./, '');
  if (PRECIOS[id]) return { ...PRECIOS[id], incierto: false };

  const familia = Object.keys(POR_FAMILIA).find((f) => id.includes(f));
  if (familia) return { ...POR_FAMILIA[familia], incierto: true };

  return { ...EL_MAS_CARO, incierto: true };
}

/** Lo que costo una llamada, en USD. */
export function costeDe({
  modelo, entrada = 0, salida = 0, cacheLectura = 0, cacheEscritura = 0,
}) {
  const precio = precioDe(modelo);
  const usd = (Number(entrada) || 0) / 1e6 * precio.entrada
    + (Number(cacheLectura) || 0) / 1e6 * precio.entrada * FACTOR_CACHE_LECTURA
    + (Number(cacheEscritura) || 0) / 1e6 * precio.entrada * FACTOR_CACHE_ESCRITURA
    + (Number(salida) || 0) / 1e6 * precio.salida;
  // Seis decimales: una llamada corta de Haiku cuesta del orden de 0,00003 USD
  // y redondear a centimos la dejaria en cero para siempre.
  return { usd: Math.round(usd * 1e6) / 1e6, incierto: precio.incierto };
}

/** El tope del mes, en USD. `0` = sin tope (se sigue apuntando el gasto). */
export function topeMensual() {
  const crudo = process.env.IA_TOPE_MENSUAL_USD;
  if (crudo === undefined || crudo === '') return 20;
  const n = Number(crudo);
  if (!Number.isFinite(n) || n < 0) {
    // Un tope mal escrito no puede convertirse en «sin tope» sin decirlo.
    logger.error({ crudo }, 'IA_TOPE_MENSUAL_USD no es un numero; se usa 20 USD');
    return 20;
  }
  return n;
}

// ─── ¿esta puesta la tabla? ──────────────────────────────────────────────────
//
// La migracion 145 se prepara aqui y se aplica en el servidor. Entre las dos
// cosas hay una ventana, y en esa ventana el chat tiene que seguir funcionando
// igual que hoy. Asi que si no esta la tabla: se avisa y se deja pasar.
//
// El «si» se recuerda para siempre; el «no» se vuelve a mirar cada rato, para
// que al aplicar la migracion esto se entere solo y no haya que reiniciar el
// proceso preguntandose por que sigue diciendo que no.

let tablaPuesta = null;
let ultimaMirada = 0;
const CADA_CUANTO_SE_REMIRA_MS = 5 * 60 * 1000;
let yaAvisadoDeQueFalta = false;

/** Cuantas veces no se pudo apuntar un gasto. Si sube, el tope esta ciego. */
let fallosAlApuntar = 0;

export async function hayTabla() {
  if (tablaPuesta === true) return true;
  if (tablaPuesta === false && Date.now() - ultimaMirada < CADA_CUANTO_SE_REMIRA_MS) return false;

  ultimaMirada = Date.now();
  try {
    const { rows } = await query(
      `SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ia_gasto'`
    );
    tablaPuesta = rows.length > 0;
  } catch (err) {
    // No saber si esta no es lo mismo que saber que no esta, pero para lo que
    // hay que decidir ahora vale igual: si no se puede contar, no se corta.
    logger.error({ err: err.message }, 'Gasto IA: no se pudo mirar si esta la tabla');
    tablaPuesta = false;
  }

  if (!tablaPuesta && !yaAvisadoDeQueFalta) {
    yaAvisadoDeQueFalta = true;
    logger.warn(
      'Gasto IA: falta la migracion 145. Las llamadas a IA NO tienen tope y no se estan apuntando.'
    );
  }
  return tablaPuesta;
}

/** Solo para las pruebas: olvida lo que sabia. */
export function _olvidar() {
  tablaPuesta = null;
  ultimaMirada = 0;
  yaAvisadoDeQueFalta = false;
  fallosAlApuntar = 0;
}

// ─── el estado ───────────────────────────────────────────────────────────────

/** Desde cuando cuenta el mes en curso. */
function principioDelMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/**
 * Que llevamos gastado y cuanto queda.
 *
 * `instalado: false` es una respuesta valida y hay que enseñarla: quiere decir
 * «no hay tope», que no es lo mismo que «el tope esta a cero».
 */
export async function estado() {
  const tope = topeMensual();
  if (!(await hayTabla())) {
    return {
      instalado: false,
      tope,
      gastado: 0,
      queda: null,
      porcentaje: 0,
      cerca: false,
      agotado: false,
      llamadas: 0,
      inciertas: 0,
      fallosAlApuntar,
      aviso: 'El tope no esta instalado: falta aplicar la migracion 145. Las llamadas no se estan contando.',
    };
  }

  let gastado = 0;
  let llamadas = 0;
  let inciertas = 0;
  try {
    const { rows } = await query(
      `SELECT COALESCE(SUM(coste_usd), 0) AS gastado,
              COUNT(*) AS llamadas,
              COUNT(*) FILTER (WHERE precio_incierto) AS inciertas
         FROM ia_gasto WHERE created_at >= $1`,
      [principioDelMes()]
    );
    gastado = Number(rows[0]?.gastado || 0);
    llamadas = Number(rows[0]?.llamadas || 0);
    inciertas = Number(rows[0]?.inciertas || 0);
  } catch (err) {
    // Si no se puede sumar, no se sabe si queda margen. Se dice, y `agotado`
    // queda en false: cortar el chat porque fallo una consulta seria cambiar un
    // problema por otro peor.
    logger.error({ err: err.message }, 'Gasto IA: no se pudo sumar el mes');
    return {
      instalado: true,
      tope,
      gastado: null,
      queda: null,
      porcentaje: 0,
      cerca: false,
      agotado: false,
      llamadas: 0,
      inciertas: 0,
      fallosAlApuntar,
      aviso: 'No se pudo leer el gasto del mes. El tope no puede aplicarse ahora mismo.',
    };
  }

  const sinTope = tope === 0;
  const porcentaje = sinTope ? 0 : Math.round((gastado / tope) * 100);
  return {
    instalado: true,
    tope,
    gastado: Math.round(gastado * 1e6) / 1e6,
    queda: sinTope ? null : Math.round(Math.max(0, tope - gastado) * 1e6) / 1e6,
    porcentaje,
    cerca: !sinTope && porcentaje >= 80 && gastado < tope,
    agotado: !sinTope && gastado >= tope,
    llamadas,
    inciertas,
    fallosAlApuntar,
    aviso: sinTope ? 'IA_TOPE_MENSUAL_USD=0: no hay tope, solo se apunta el gasto.' : null,
  };
}

/**
 * Se pregunta ANTES de gastar, nunca despues.
 *
 * Comprobar al terminar seria como mirar el deposito al llegar: la llamada que
 * se pasa del tope ya se pago. Devuelve `{ permitido, motivo, estado }` y no
 * lanza — quien llama decide como decirlo, porque el chat contesta por SSE y el
 * reporte contesta con JSON.
 */
export async function compruebaAntesDeGastar() {
  const e = await estado();
  if (e.agotado) {
    return {
      permitido: false,
      motivo: `Se alcanzo el tope de gasto en IA de este mes (${e.gastado} de ${e.tope} USD). `
        + 'Vuelve el dia 1, o se sube IA_TOPE_MENSUAL_USD en el servidor.',
      estado: e,
    };
  }
  return { permitido: true, motivo: null, estado: e };
}

/**
 * Despues de apuntar una llamada, ¿se ha cruzado el 80 % o el 100 % del tope?
 * El aviso al super admin vive en `gastoIAAviso.service.js` (una vez por umbral
 * y mes). Aqui solo se le dice cuanto llevamos; no lanza nunca.
 */
async function avisarSiToca() {
  try {
    const e = await estado();
    if (!e.instalado || !(e.tope > 0) || e.gastado == null) return;
    await avisaSiCruzaUmbral({ gastado: e.gastado, tope: e.tope });
  } catch (err) {
    logger.error({ err: err.message }, 'Gasto IA: no se pudo comprobar si toca avisar del tope');
  }
}

/**
 * Apunta lo que costo una llamada.
 *
 * No lanza nunca: que falle el contador no puede tumbar la respuesta que el
 * usuario ya tiene delante. Pero si falla se cuenta y sale en `estado()`,
 * porque un contador que no cuenta deja el tope ciego, y eso no puede quedarse
 * solo en una linea de log que no mira nadie.
 */
export async function registrar({
  projectId = null, userId = null, origen, modelo,
  entrada = 0, salida = 0, cacheLectura = 0, cacheEscritura = 0, fallo = null,
}) {
  const { usd, incierto } = costeDe({ modelo, entrada, salida, cacheLectura, cacheEscritura });
  try {
    if (!(await hayTabla())) return { apuntado: false, usd, incierto };
    await query(
      `INSERT INTO ia_gasto
         (project_id, user_id, origen, modelo, tokens_entrada, tokens_salida,
          tokens_cache_lectura, tokens_cache_escritura, coste_usd, precio_incierto, fallo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [projectId || null, userId || null, origen, String(modelo || 'desconocido'),
        entrada || 0, salida || 0, cacheLectura || 0, cacheEscritura || 0,
        usd, incierto, fallo || null]
    );
    await avisarSiToca();
    return { apuntado: true, usd, incierto };
  } catch (err) {
    fallosAlApuntar += 1;
    logger.error(
      { err: err.message, origen, modelo, usd, fallosAlApuntar },
      'Gasto IA: NO se pudo apuntar una llamada. El tope va por debajo de lo real.'
    );
    return { apuntado: false, usd, incierto };
  }
}

export default {
  precioDe, costeDe, topeMensual, hayTabla, estado, compruebaAntesDeGastar, registrar,
};
