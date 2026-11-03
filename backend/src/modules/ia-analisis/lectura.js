import { cifrasSinRespaldo } from './cifras.js';
import { llamarAnthropic } from './preguntar.service.js';
import * as gasto from '../../shared/services/gastoIA.service.js';
import { getDecryptedValue } from '../credentials/credentials.model.js';
import { logger } from '../../shared/utils/logger.js';

/**
 * La lectura de la semana para el correo de los lunes (#30, cuarta subfase).
 *
 *   «qué subió, qué bajó y qué conviene mirar»
 *
 * UNA SOLA LLAMADA, SIN HERRAMIENTAS. El reporte semanal ya tiene calculadas las
 * cifras de esta semana y de la anterior —las mismas que enseña el correo—, asi
 * que aqui no se consulta nada: se le dan al modelo tal cual y se le pide que las
 * lea. Escribir otras consultas daria otros numeros que los de las tarjetas de
 * arriba, y el correo se contradiria a si mismo.
 *
 * LAS VARIACIONES VAN YA CALCULADAS. Si el modelo tuviera que restar y dividir,
 * escribiria cifras («+12,5 %») que no estan en ningun dato y la comprobacion
 * las rechazaria con razon. Calculadas aqui, las cita.
 *
 * AQUI LA REGLA ES MAS ESTRICTA QUE EN LAS PREGUNTAS. Una respuesta con una cifra
 * sin comprobar se enseña MARCADA: quien pregunta esta delante. Un correo no: sale
 * a las 8 de la mañana a direccion y nadie esta para matizarlo. Asi que si una
 * sola cifra del texto no sale de los datos, la lectura entera NO se manda y el
 * correo sale como siempre, sin ella.
 *
 * NO LANZA NUNCA. Que el analisis falle —sin clave, con el tope agotado, con la
 * IA caida— no puede impedir que llegue el reporte, que es lo que importa.
 */

const MODELO = () => process.env.CLAUDE_MODEL || 'claude-sonnet-4-5';

/** Cuanto cambia `ahora` respecto a `antes`, en %, con un decimal. `null` si no hay base. */
export function variacion(ahora, antes) {
  const a = Number(ahora);
  const b = Number(antes);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  return Math.round(((a - b) / Math.abs(b)) * 1000) / 10;
}

/**
 * Lo que se le da al modelo: las cifras de las dos semanas y su variacion.
 * `esta` y `anterior` son objetos con las mismas claves numericas
 * (prospectos, convertidos, ventas, cobrado…).
 */
export function datosDeLaSemana({ empresa, periodo, esta, anterior }) {
  const variaciones = {};
  for (const clave of Object.keys(esta || {})) {
    const v = variacion(esta[clave], anterior?.[clave]);
    if (v !== null) variaciones[clave] = v;
  }
  return {
    empresa, periodo, esta_semana: esta, semana_anterior: anterior, variacion_porcentual: variaciones,
  };
}

const INSTRUCCION = [
  'Eres el analista de datos del CRM y escribes la lectura de la semana para la dirección.',
  'Tienes las cifras de esta semana, las de la anterior y la variación porcentual ya calculada.',
  '',
  'Escribe en español, como mucho TRES frases cortas: qué subió, qué bajó y qué conviene mirar.',
  '',
  'REGLAS, sin excepciones:',
  '1. Todo número que escribas tiene que aparecer tal cual en los datos. No calcules ni estimes:',
  '   si quieres hablar de un cambio, usa la variación que ya viene calculada.',
  '2. No des causas que los datos no muestran (campañas, vacaciones, estacionalidad). Solo lo que',
  '   se ve en las cifras.',
  '3. Si no hay base de comparación (variación ausente), dilo en lugar de inventarla.',
  '4. Sin saludos, sin títulos ni listas: solo el texto.',
].join('\n');

async function claveDeAnthropic() {
  try {
    const g = await getDecryptedValue('anthropic', null);
    if (g) return g;
  } catch { /* se prueba la del servidor */ }
  return process.env.ANTHROPIC_API_KEY || null;
}

/**
 * Devuelve `{ texto }` o `null`. `null` significa «no hay lectura esta semana» y
 * el correo sale sin ella; no es un error.
 */
export async function lecturaDeLaSemana({
  empresa, periodo, esta, anterior, userId = null, llamar = llamarAnthropic,
}) {
  try {
    const apiKey = await claveDeAnthropic();
    if (!apiKey) return null;

    const permiso = await gasto.compruebaAntesDeGastar();
    if (!permiso.permitido) {
      logger.info('Lectura de la semana: tope de gasto agotado, el correo sale sin ella');
      return null;
    }

    const datos = datosDeLaSemana({ empresa, periodo, esta, anterior });
    let r;
    try {
      r = await llamar({
        apiKey,
        system: INSTRUCCION,
        tools: undefined,
        messages: [{ role: 'user', content: JSON.stringify(datos) }],
      });
    } catch (err) {
      await gasto.registrar({
        userId, origen: 'ia-semanal', modelo: MODELO(), fallo: String(err.message).slice(0, 300),
      });
      logger.warn({ err: err.message }, 'Lectura de la semana: la IA no respondió');
      return null;
    }

    const u = r.usage || {};
    await gasto.registrar({
      userId, origen: 'ia-semanal', modelo: MODELO(),
      entrada: u.input_tokens || 0, salida: u.output_tokens || 0,
      cacheLectura: u.cache_read_input_tokens || 0, cacheEscritura: u.cache_creation_input_tokens || 0,
    });

    const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (!texto) return null;

    // Aqui NO se marca, se descarta: ver la cabecera.
    const sinComprobar = cifrasSinRespaldo(texto, [datos]);
    if (sinComprobar.length) {
      logger.warn({ empresa, sinComprobar }, 'Lectura de la semana descartada: cifras que no salen de los datos');
      return null;
    }

    return { texto };
  } catch (err) {
    logger.error({ err: err.message }, 'Lectura de la semana: fallo inesperado, el correo sale sin ella');
    return null;
  }
}
