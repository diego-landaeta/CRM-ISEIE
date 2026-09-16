import * as model from './chat.model.js';
import * as evolution from './evolution.client.js';
import * as media from './media.service.js';
import * as politica from './politica.js';
import { AppError } from '../../shared/utils/AppError.js';
import { logger } from '../../shared/utils/logger.js';

// EL FRENO DE ESCRIBIR A DESCONOCIDOS. Apagado por defecto — decision de Diego,
// 21/08/2026. El razonamiento entero esta abajo, donde se usa.
//
// Antes esto se llamaba WA_EXIGIR_CONSENTIMIENTO y venia encendido. Se cambia
// el nombre a proposito: la variable vieja significaba lo contrario (true =
// frenar), asi que dejarla habria bastado para que un .env olvidado volviera a
// bloquear justo lo que se decidio permitir. Si alguien la trae puesta, el
// servidor lo avisa al arrancar en vez de obedecerla en silencio.
const BLOQUEAR_DESCONOCIDOS = process.env.WA_BLOQUEO_DESCONOCIDOS === 'true';

if (process.env.WA_EXIGIR_CONSENTIMIENTO !== undefined) {
  logger.warn(
    'WhatsApp: WA_EXIGIR_CONSENTIMIENTO ya no se usa y se ignora. El freno ahora '
    + 'es WA_BLOQUEO_DESCONOCIDOS y viene apagado. Quita la vieja del .env.',
  );
}

/**
 * Cuando entro el ultimo mensaje de cada sesion.
 *
 * La pantalla pregunta cada cuatro segundos si sigue llegando historial, y eso
 * se contestaba contando la tabla entera de mensajes: con 380.000 filas y diez
 * pantallas abiertas eran dos escaneos completos por segundo para pintar un
 * «sincronizando…».
 *
 * Quien sabe si esta entrando algo es el webhook, que es por donde entra. Se
 * apunta aqui al vuelo y la pantalla lo lee de memoria, sin tocar la base.
 *
 * Vive en memoria a proposito: si el servidor se reinicia, lo peor que pasa es
 * que durante unos segundos diga «ya esta» en vez de «entrando», y el primer
 * mensaje que llegue lo corrige. No merece una tabla.
 */
const pulso = new Map();   // instancia -> milisegundos del ultimo mensaje

// Y el del HISTORIAL, aparte.
//
// «Sincronizando…» no se iba nunca. Miraba el pulso general, que se actualiza
// con CUALQUIER mensaje — incluidos los que manda una misma, que vuelven por el
// webhook como salientes. O sea que mientras estabas chateando, la pantalla
// creia que seguia entrando historial y dejaba el aviso puesto para siempre.
//
// El historial es lo unico que hay que esperar; una conversacion normal no.
const pulsoHistorial = new Map();

// El pulso general. Ya no lo lee ningun endpoint —«Sincronizando…» mira el del
// historial— pero el mapa sigue vivo por dentro y esto es por donde se
// comprueba. Se quedaba sin llamadas en `src/`, lo quite por muerto, y reventó
// cuatro pruebas: el barrido no habia mirado en `tests/`.
export const ultimoLatido = (instancia) => pulso.get(instancia) || null;

export const ultimoDelHistorial = (instancia) => pulsoHistorial.get(instancia) || null;

/**
 * Quien esta llamando AHORA MISMO.
 *
 * Lo de guardar solo el desenlace vale para el historial, pero llega tarde para
 * avisar: cuando entra el `timeout` la llamada ya se perdio. Para dar el aviso
 * mientras suena hace falta el `offer`, que no se guarda en la base —no es un
 * hecho todavia, es algo que esta pasando— y vive aqui mientras dura.
 *
 * En memoria como el pulso: si el servidor se reinicia se pierde un aviso, y el
 * peor caso es que la gestora vea la llamada perdida en el chat medio minuto
 * despues. No merece una tabla.
 */
const sonando = new Map();   // instancia -> { id, telefono, nombre, conversacionId, esVideo, desde }

// WhatsApp deja de llamar sobre los 30 segundos. Se da margen hasta 45 por si
// el aviso de que termino no llega nunca —un webhook que se pierde, el
// contenedor reiniciandose—: sin esto el cartel se quedaria puesto para siempre
// y habria que recargar la pagina para quitarlo.
const SUENA_MAX_MS = 45000;

/**
 * ¿Tiene WhatsApp enlazado? — para decidir cada cuanto pregunta la pantalla.
 *
 * El pulso vale cuando hay trafico, pero no basta: una gestora enlazada y
 * tranquila no tiene pulso ninguno despues de reiniciar el servidor, y entonces
 * la pantalla se pondria a preguntar cada minuto. Una llamada dura treinta
 * segundos: el aviso no llegaria nunca, que es justo lo que se venia a resolver.
 *
 * Asi que cuando no hay pulso se mira la base UNA vez y se guarda el resultado
 * cinco minutos. Es una consulta por persona cada cinco minutos, y ademas un
 * EXISTS; lo que no puede es ir una por vuelta, porque esto lo pregunta cada
 * pestaña abierta del CRM cada pocos segundos.
 */
const SESION_TTL_MS = 300000;
const sesionConocida = new Map();   // instancia -> { hay, hasta }

export async function tieneSesion(instancia) {
  if (pulso.get(instancia)) return true;
  const guardado = sesionConocida.get(instancia);
  if (guardado && guardado.hasta > Date.now()) return guardado.hay;
  try {
    const hay = await model.hayConversaciones(instancia);
    sesionConocida.set(instancia, { hay, hasta: Date.now() + SESION_TTL_MS });
    return hay;
  } catch (err) {
    // Que esto falle NO puede tumbar la peticion.
    //
    // Lo pregunta cada pestaña abierta del CRM cada pocos segundos, y el
    // manejador de errores escribe cada 5xx en la tabla de errores. Un mal
    // momento de la base se convertiria en una inundacion de escrituras a esa
    // misma base — el fallo alimentandose a si mismo.
    //
    // Se contesta que no hay sesion, que como mucho hace que la pantalla
    // pregunte mas despacio hasta que se recupere. Y se guarda medio minuto
    // para no repetir la consulta rota en cada vuelta.
    logger.warn({ instancia, err: err.message }, 'WhatsApp: no se pudo mirar si hay sesion');
    sesionConocida.set(instancia, { hay: false, hasta: Date.now() + 30000 });
    return false;
  }
}

/** La llamada en curso de esta sesion, o null. Se cae sola al caducar. */
export function llamadaSonando(instancia) {
  const l = sonando.get(instancia);
  if (!l) return null;
  if (Date.now() - l.desde > SUENA_MAX_MS) { sonando.delete(instancia); return null; }
  return l;
}

// Los frenos. Esto es lo que de verdad protege el numero.
//
// Lo que hace que WhatsApp suspenda una linea no es tanto detectar el cliente
// como que la gente la bloquee y la reporte. Por eso aqui no hay trucos para
// esconderse: hay limites de ritmo y la negativa a escribir a quien pidio que
// no le escriban. Es menos vistoso y funciona mucho mejor.

// Ritmo humano. Una persona no manda 40 mensajes en un minuto, y un numero
// nuevo que lo hace el primer dia es la señal mas clara que existe.
const TOPE_POR_MINUTO = Number(process.env.WA_TOPE_MINUTO || 6);
const TOPE_POR_HORA = Number(process.env.WA_TOPE_HORA || 60);
const TOPE_POR_DIA = Number(process.env.WA_TOPE_DIA || 300);

// Espera entre mensajes seguidos, para que no salgan todos de golpe.
const PAUSA_MS = Number(process.env.WA_PAUSA_MS || 1500);

let ultimoEnvio = 0;

async function limites(instancia) {
  const [min, hora, dia] = await Promise.all([
    model.salientesRecientes(instancia, 1),
    model.salientesRecientes(instancia, 60),
    model.salientesRecientes(instancia, 60 * 24),
  ]);
  if (min >= TOPE_POR_MINUTO) return `Vas muy rapido: ${min} mensajes en un minuto. Espera un poco.`;
  if (hora >= TOPE_POR_HORA) return `Llevas ${hora} mensajes esta hora. Se para aqui para no arriesgar el numero.`;
  if (dia >= TOPE_POR_DIA) return `Llevas ${dia} mensajes hoy. Se retoma mañana.`;
  return null;
}

/**
 * Las cuatro comprobaciones que van ANTES de llamar a WhatsApp. Una vez sale,
 * ya no se recoge.
 */
async function permitirEnvio(conversacionId) {
  const conv = await model.porId(conversacionId);
  if (!conv) throw new AppError('Conversacion no encontrada', 404, 'NOT_FOUND');

  // 1. Quien pidio que no le escribieran, no recibe nada. Ni con plantilla, ni
  //    «solo una ultima vez». Es la regla que evita los reportes.
  if (conv.no_escribir) {
    throw new AppError('Esta persona pidio que no se le escriba', 409, 'NO_ESCRIBIR');
  }

  // 2. Escribir a quien no pidio informacion es lo que acaba en bloqueos. Si
  //    el numero no esta atado a ningun lead y nunca nos ha escrito, no salio
  //    de un formulario nuestro.
  // NO VOLVER A BLOQUEAR ESTO. Decision de Diego, 21/08/2026.
  //
  // Aqui habia un freno que impedia el primer mensaje a un numero que no fuera
  // prospecto y que nunca hubiera escrito. Parecia proteger la linea y hacia lo
  // contrario: ese numero puede ser un antiguo alumno, una madre preguntando
  // por su hijo, o un prospecto de otra gestora que aun no esta en el CRM.
  //
  // Y cuando el CRM se negaba, la gestora no dejaba de escribir: escribia desde
  // su movil. O sea que el mensaje salia igual, pero SIN registro, SIN plantilla
  // y SIN los topes de ritmo. El freno no evitaba nada; solo sacaba el trabajo
  // fuera del CRM, que es donde no se puede vigilar.
  //
  // Escribir a quien no pidio informacion sigue siendo lo que hace que reporten
  // un numero, asi que no desaparece: queda apuntado en el registro. El freno
  // ahora es saberlo, no impedirlo. Si hiciera falta volver a frenar, se
  // enciende con WA_BLOQUEO_DESCONOCIDOS=true sin tocar el codigo — pero eso se
  // habla antes con Diego.
  const yaHablamos = (await model.mensajes(conversacionId, 1)).length > 0;
  const desconocido = !conv.lead_id && !yaHablamos;
  if (desconocido) {
    if (BLOQUEAR_DESCONOCIDOS) {
      throw new AppError(
        'Ese numero no esta en el CRM y nunca ha escrito.',
        409, 'SIN_CONSENTIMIENTO',
      );
    }
    logger.warn({ conversacionId, instancia: conv.instancia, telefono: conv.telefono },
      'WhatsApp: primer mensaje a un numero que no es prospecto y nunca escribio');
  }

  // 3. Ritmo.
  const frenado = await limites(conv.instancia);
  if (frenado) throw new AppError(frenado, 429, 'DEMASIADO_RAPIDO');

  if (!evolution.configurado()) {
    throw new AppError('WhatsApp no esta configurado en el servidor', 503, 'SIN_EVOLUTION');
  }

  // 4. Pausa entre envios seguidos, para no soltarlos en rafaga.
  const desde = Date.now() - ultimoEnvio;
  if (desde < PAUSA_MS) await new Promise((r) => setTimeout(r, PAUSA_MS - desde));
  ultimoEnvio = Date.now();

  return conv;
}

/**
 * A donde se manda. NO siempre son las cifras del jid.
 *
 * Esto era `String(conv.jid).split('@')[0]` a secas, y con eso:
 *
 *   · A un GRUPO no llegaba nada. Su jid es `1203634...@g.us`, y quitandole el
 *     sufijo queda un numero de 18 cifras que al otro lado se reconstruye como
 *     `...@s.whatsapp.net` — un telefono que no existe. Los grupos se veian en
 *     la lista y no se podia contestar en ellos, que es justo lo que hace falta
 *     que funcione en la #74.
 *
 *   · Con un `@lid` era peor que no llegar: ese identificador oculta el
 *     telefono de una persona, asi que sus cifras NO son un numero suyo. Tomarlo
 *     por telefono es mandarle el mensaje a quien tenga esa linea — un
 *     desconocido leyendo una conversacion con un prospecto.
 *
 * En los dos casos hay que mandar el jid ENTERO y dejar que el otro lado lo
 * resuelva. Solo se pelan las cifras cuando de verdad es un telefono.
 */
/**
 * La OTRA llave de esta persona, si el mensaje la trae (migracion 159).
 *
 * WhatsApp direcciona cada vez mas por `@lid`, un identificador que ocupa el
 * lugar del telefono sin revelarlo, y la misma persona llega unas veces con uno
 * y otras con el otro. Los avisos de etiquetas usan el que tengan a mano, asi
 * que sin el par no hay forma de saber en que chat va la etiqueta.
 *
 * Se descarta lo que no aporte: si la otra llave es la MISMA que el jid, no es
 * un par — es el mismo dato dos veces, y guardarlo solo sirve para creer que ya
 * se sabe algo que no se sabe. Paso de verdad: el puente traducia el @lid y
 * dejaba el telefono en los dos campos.
 */
function otraLlaveDe(key) {
  const suya = String(key?.remoteJid || '');
  const otra = key?.remoteJidAlt || key?.senderPn || null;
  if (!otra || String(otra) === suya) return null;
  return String(otra);
}

const numeroDe = (conv) => {
  const jid = String(conv.jid);
  if (jid.endsWith('@g.us') || jid.endsWith('@lid')) return jid;
  return jid.split('@')[0];
};

/** Manda un texto. */
export async function enviar({ conversacionId, texto, usuarioId, citarWaId = null }) {
  const conv = await permitirEnvio(conversacionId);

  // «Escribiendo…» antes de soltar el mensaje. No es adorno: un numero que
  // contesta al instante y sin escribir parece exactamente lo que es.
  await evolution.presencia(numeroDe(conv), 'composing', conv.instancia).catch(() => {});

  // Para citar hace falta mas que el identificador: Evolution quiere el jid de
  // la conversacion y si el mensaje citado era nuestro. Los dos estan guardados.
  let cita = null;
  if (citarWaId) {
    const citado = await model.mensajePorWaId(citarWaId).catch(() => null);
    cita = {
      waId: citarWaId,
      jid: conv.jid,
      mio: citado?.direccion === 'saliente',
      texto: citado?.texto || '',
    };
  }

  const r = await evolution.enviarTexto(numeroDe(conv), texto, conv.instancia, cita);
  const fila = await model.guardarMensaje({
    conversacionId, waId: r.waId, direccion: 'saliente', tipo: 'texto',
    texto, estado: r.ok ? 'enviado' : 'fallido', enviadoPor: usuarioId, ts: new Date(),
    // Se guarda tambien de nuestro lado: si no, la cita solo se veria en el
    // movil del otro y aqui el mensaje saldria suelto.
    respondeA: citarWaId || null,
  });
  if (!r.ok) {
    logger.error({ conversacionId, error: r.error }, 'WhatsApp: no se pudo enviar');
    throw new AppError('WhatsApp no acepto el mensaje. Queda anotado como fallido.', 502, 'ENVIO_FALLIDO');
  }
  return fila;
}

/**
 * Manda un adjunto. Si es audio sale como NOTA DE VOZ —con su onda y su boton
 * de reproducir—, que es como trabajan las gestoras; mandarlo como fichero
 * adjunto seria inutil.
 */
export async function enviarAdjunto({ conversacionId, buffer, mimetype, nombreArchivo, pie, usuarioId, segundos = null }) {
  const conv = await permitirEnvio(conversacionId);
  const numero = numeroDe(conv);
  let esAudio = /^audio\//.test(mimetype || '');

  // La nota de voz se convierte AQUI, antes de mandarla.
  //
  // Lo que graba el navegador es webm, porque Chrome no sabe grabar otra cosa.
  // Mandandolo tal cual, la nota llegaba muda al movil; mandando el MISMO audio
  // ya convertido a ogg, se oia. Comprobado con la misma grabacion por los dos
  // caminos, con identica duracion y onda: lo unico distinto era quien convertia.
  //
  // Convirtiendo aqui sale lo mismo desde produccion y desde local, en vez de
  // depender de los ajustes de Evolution en un sitio y del puente en el otro.
  if (esAudio) {
    const { aNotaDeVoz } = await import('./audio.service.js');
    const ogg = await aNotaDeVoz(buffer);
    if (ogg) {
      buffer = ogg;
      mimetype = 'audio/ogg; codecs=opus';
      nombreArchivo = 'nota-de-voz.ogg';
    } else {
      // Sin conversion NO se manda como nota de voz: llegaria muda y en el chat
      // parece enviada. Mejor que salga como fichero adjunto, que se puede
      // descargar y abrir, y que quede dicho en el registro.
      logger.warn({ conversacionId }, 'WhatsApp: nota de voz sin convertir, va como adjunto');
      esAudio = false;
    }
  }

  const base64 = buffer.toString('base64');

  // El «grabando audio…» NO se manda antes de una nota de voz.
  //
  // Es la unica cosa que hacia el camino del CRM y no hacia el envio directo al
  // puente — y en las pruebas todo lo que salio por aqui llego mudo al movil
  // («este audio ya no esta disponible») mientras que lo mismo, byte por byte,
  // enviado sin esta linea, sonaba. La presencia abre un aviso de estado sobre
  // el mismo chat y programa su apagado a los ~1,2 s, que cae justo encima de
  // la subida del audio.
  //
  // Ademas no aporta nada: la nota YA esta grabada cuando se llama, asi que el
  // aviso dura un suspiro y acto seguido aparece el audio. Es decorado.
  //
  // Para lo demas —imagenes, documentos— se mantiene: ahi si tiene sentido y
  // ahi nunca ha dado problema.
  if (!esAudio) {
    await evolution.presencia(numero, 'composing', conv.instancia).catch(() => {});
  }

  const r = esAudio
    ? await evolution.enviarAudio(numero, base64, conv.instancia)
    : await evolution.enviarMedia(numero, {
        tipo: /^image\//.test(mimetype) ? 'image' : /^video\//.test(mimetype) ? 'video' : 'document',
        base64, nombreArchivo, mimetype, pie,
      }, conv.instancia);

  // Se guarda una copia nuestra: WhatsApp no deja recuperar despues lo que se
  // mando, y sin esto el chat del CRM enseñaria un hueco.
  //
  // OJO CON LAS NOTAS DE VOZ. Lo que graba el navegador es **webm**, porque
  // Chrome no sabe grabar otra cosa. A WhatsApp le llega convertido a ogg/opus
  // —lo hace Evolution—, pero la copia que se guardaba aqui era el webm crudo,
  // y esa es la que reproduce el CRM.
  //
  // Resultado: la nota se oye en el navegador de un ordenador y NO se oye en el
  // movil. Safari de iOS no reproduce webm, ni en audio ni en video, y ahi no
  // hay apaño de reproductor que valga. Se veia como «el audio ya no esta
  // disponible» y parecia un fallo del envio, cuando el envio estaba bien.
  //
  // Asi que para el audio la copia NO es lo que subio el navegador: se pide de
  // vuelta el fichero ya convertido, el mismo que tiene quien lo recibe. Un
  // viaje mas, solo al mandar una nota de voz, y queda igual en local y en
  // produccion — el camino de bajada ya existe y es el que usa «descargar».
  let guardado = null;
  let mimeGuardado = mimetype;
  if (esAudio && r.ok && r.waId) {
    const media = await import('./media.service.js');
    const bajado = await media.bajarYGuardar({
      key: { remoteJid: conv.jid, fromMe: true, id: r.waId },
      message: null,
      instancia: conv.instancia,
    }).catch(() => null);
    if (bajado?.ruta) {
      guardado = bajado.ruta;
      mimeGuardado = bajado.mime || 'audio/ogg; codecs=opus';
    }
  }

  // Para todo lo demas —y si lo de arriba no salio— se guarda lo que subio el
  // navegador, que es exactamente lo que se mando.
  if (!guardado) {
    try {
      const ext = (nombreArchivo || '').split('.').pop() || 'bin';
      const ruta = `whatsapp/${conv.instancia}/env-${Date.now()}-${Math.random().toString(16).slice(2, 10)}.${ext}`;
      const { saveLocal } = await import('../../shared/services/localStorage.service.js');
      await saveLocal(ruta, buffer);
      guardado = ruta;
    } catch (err) {
      logger.warn({ err: err.message }, 'WhatsApp: no se pudo guardar copia del adjunto enviado');
    }
  }

  const fila = await model.guardarMensaje({
    conversacionId, waId: r.waId,
    direccion: 'saliente',
    tipo: esAudio ? 'audio' : /^image\//.test(mimetype) ? 'imagen' : /^video\//.test(mimetype) ? 'video' : 'documento',
    texto: pie || null,
    mediaUrl: guardado, mediaMime: mimeGuardado,
    nombreArchivo,
    estado: r.ok ? 'enviado' : 'fallido', enviadoPor: usuarioId, ts: new Date(),
  });
  if (!r.ok) throw new AppError('WhatsApp no acepto el adjunto. Queda anotado como fallido.', 502, 'ENVIO_FALLIDO');
  return fila;
}

/**
 * Lo que llega por el webhook de Evolution.
 *
 * Se traga los errores a proposito y siempre contesta 200: si el CRM devuelve
 * un fallo, Evolution reintenta, y un webhook reintentandose en bucle es peor
 * que perder un mensaje. La barrera de wa_id evita los duplicados igualmente.
 */
export async function recibir(cuerpo) {
  const evento = String(cuerpo?.event || cuerpo?.type || '');

  // Acuses de entrega y lectura: es lo que pinta el doble tic.
  if (/messages[._]update/i.test(evento)) return acuse(cuerpo);
  // Llamadas. Van por su propio evento, no por messages.upsert.
  if (/^call$/i.test(evento)) return llamada(cuerpo);
  // Cuanto lleva del historial. Es el UNICO numero real que hay: WhatsApp no
  // dice cuantos mensajes va a mandar en total, asi que un porcentaje calculado
  // por nosotros seria inventado. Baileys lo manda en cada tanda.
  if (/history[._]progress/i.test(evento)) return anotarProgreso(cuerpo);
  // Las fotos de perfil. Evolution las manda por su cuenta, no dentro del
  // mensaje: sin esto nadie tiene foto en produccion.
  if (/contacts[._](update|upsert)/i.test(evento)) return contactos(cuerpo);
  // Borrar un mensaje. «Para mi» viaja por aqui; «para todos» llega dentro de
  // un mensaje normal y se atiende mas abajo.
  if (/messages[._]delete/i.test(evento)) return borrado(cuerpo);
  // El historial que manda el movil al enlazar. Llega en tandas y por su propio
  // evento, no por `messages.upsert`: ver `historial()`.
  if (/messages[._]set/i.test(evento)) return historial(cuerpo);
  // Las etiquetas de la gestora (#128, #138). Dos avisos: la etiqueta en si, y
  // ponerla o quitarla de un chat.
  if (/labels?[._]edit/i.test(evento)) return etiquetaTocada(cuerpo);
  if (/labels?[._]association/i.test(evento)) return etiquetaEnUnChat(cuerpo);
  if (evento && !/messages[._]upsert/i.test(evento)) return { ignorado: evento };

  const datos = cuerpo?.data || cuerpo;
  const key = datos?.key;
  if (!key?.remoteJid) return { ignorado: 'sin remoteJid' };

  // Personas y grupos, si. Canales, listas de difusion y estados, no: esos son
  // emisiones de una via a las que no se puede contestar, y solo ensucian la
  // lista.
  const destino = String(key.remoteJid);
  const esGrupo = destino.endsWith('@g.us');
  // `@lid` es el direccionamiento nuevo de WhatsApp: identifica a una PERSONA
  // sin revelar su telefono. Se aceptaba solo `@s.whatsapp.net`, asi que esos
  // mensajes se descartaban junto con los canales. El puente intenta
  // traducirlo a su numero antes de mandarlo; cuando no puede, llega asi y
  // vale mas guardarlo con un nombre raro que perderlo.
  const esPersona = destino.endsWith('@s.whatsapp.net') || destino.endsWith('@lid');
  if (!esGrupo && !esPersona) {
    return { ignorado: `ni persona ni grupo (${destino.split('@')[1] || destino})` };
  }
  // Y si los grupos no entran, aqui se paran DE VERDAD.
  //
  // Antes esta linea no existia: se le pedia `groupsIgnore: true` a Evolution y
  // se daba por hecho. En la base de pruebas habia 2 grupos de 5 conversaciones,
  // con mensajes del mismo dia — entraban en vivo. Delegar una decision propia
  // en un servicio de terceros no es aplicarla. Es la #74.
  if (politica.sobraPorSerGrupo(destino)) {
    return { ignorado: 'los grupos no entran (WHATSAPP_GRUPOS=no)' };
  }
  // «0@s.whatsapp.net» y similares: WhatsApp cuela identificadores basura que
  // aparecian en la lista como una conversacion mas.
  const digitos = destino.split('@')[0].replace(/[^0-9]/g, '');
  if (digitos.length < 8) return { ignorado: `identificador invalido (${digitos})` };

  // Ruido del protocolo: acuses, claves de cifrado, reacciones, encuestas,
  // llamadas... Si se dejan pasar, crean conversaciones vacias en la lista.
  if (media.esRuido(datos?.message)) {
    return { ignorado: `ruido de protocolo (${Object.keys(datos?.message || {}).join(',') || 'vacio'})` };
  }

  // La instancia dice DE QUIEN es esta conversacion. Antes, si no venia, se
  // caia al nombre generico y el mensaje acababa en una sesion de nadie: nadie
  // lo veria nunca y encima ensuciaria la base. Mejor decirlo y no guardarlo.
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;
  if (!instancia) {
    logger.warn({ jid: key.remoteJid }, 'WhatsApp: aviso sin instancia, no se sabe de quien es');
    return { ignorado: 'sin instancia' };
  }
  // CUANDO se dijo esto. Se calcula aqui arriba y no mas abajo porque de ello
  // dependen las dos cosas que vienen: si el mensaje entra, y con que fecha se
  // queda su conversacion. `messageTimestamp` viene en segundos.
  const cuando = datos?.messageTimestamp
    ? new Date(Number(datos.messageTimestamp) * 1000)
    : new Date();

  // «El ultimo mes» tiene que ser un mes (#73), y se decide ANTES DE CREAR NADA.
  //
  // Estaba treinta lineas mas abajo, despues de `conversacionDe`, y el propio
  // comentario decia que iba antes: descartar el mensaje despues de crear la
  // conversacion deja un chat VACIO en la lista, que es peor que no tenerlo.
  //
  // En local no se notaba porque el puente ya recorta antes de mandar. Con
  // Evolution no: manda el historial entero y lo recorta el CRM, asi que
  // enlazar «el ultimo mes» un numero con dos años de conversaciones iba a
  // crear cientos de chats vacios. Es otra vez lo de siempre — lo que se prueba
  // no es lo que corre.
  //
  // Solo salta con el modo «rapido» apuntado y una fecha de hace mas de 30
  // dias, y un mensaje en vivo nunca cumple lo segundo.
  if (politica.sobraDelHistorial(instancia, cuando)) {
    return { ignorado: 'mas viejo que el mes que se pidio' };
  }

  // La otra llave de esta persona, si el mensaje la trae. Ver `otraLlaveDe`.
  const otraLlave = otraLlaveDe(key);

  // En un grupo, `pushName` es QUIEN ESCRIBIO, no el grupo.
  //
  // Usarlo como nombre de la conversacion hacia que «Psiko Aprende General»
  // saliera como «199247962062849» —el identificador de quien hablo el ultimo—
  // y que fuera cambiando segun quien escribiera. El nombre de un grupo es su
  // asunto; si no viene, mejor ninguno que uno que baila: la pantalla ya cae en
  // «Grupo sin nombre».
  const conv = await model.conversacionDe({
    instancia, jid: key.remoteJid,
    nombrePush: esGrupo
      ? (datos?.groupSubject || cuerpo?.groupSubject || datos?.subject || null)
      : datos?.pushName,
    avatarUrl: datos?.avatar || null,
    // En lo que mandamos nosotros, `pushName` somos NOSOTROS. Se dice aqui y la
    // regla se aplica dentro, que es donde no se puede olvidar.
    mensajeMio: Boolean(key.fromMe),
    // CUANDO, para que la lista se ordene por la conversacion y no por cuando
    // se importo. Ver `conversacionDe`.
    cuando,
    // LA OTRA LLAVE de esta persona, si el mensaje la trae (migracion 159).
    //
    // WhatsApp direcciona cada vez mas por `@lid`, un identificador que ocupa
    // el lugar del telefono. La misma persona llega unas veces con uno y otras
    // con el otro, y los avisos de etiquetas usan el que tengan a mano: uno
    // llego como «16699034202151@lid» mientras su chat estaba guardado por
    // numero, y la etiqueta se quedo fuera.
    //
    // El par viaja en la propia clave, asi que se aprende del primer mensaje que
    // lo traiga y la conversacion queda localizable por las dos.
    otraLlave,
  });

  // Si esta conversacion acaba de nacer, puede haber etiquetas esperandola.
  //
  // Al enlazar, WhatsApp manda las etiquetas ANTES que los mensajes: cuando
  // llega «la etiqueta 12 va en el chat de Marta», ese chat todavia no existe
  // aqui. Se guardaron aparte (migracion 158) y este es el momento de ponerlas.
  //
  // Suelto y solo al nacer: en cada mensaje seria una consulta de mas por cada
  // uno de los miles que entran al emparejar.
  //
  // Se mira en DOS momentos, y hacen falta los dos:
  //
  //   · cuando la conversacion NACE, con su jid;
  //   · y cuando APRENDE su otra llave, con esa. Este segundo faltaba y se vio
  //     enseguida: la etiqueta llego direccionada por `@lid`, el chat de esa
  //     persona ya existia —solo se actualizaba— y la etiqueta se quedaba en la
  //     cola para siempre aunque el par ya se supiera.
  //
  // La cola se vacia con un DELETE ... RETURNING, asi que cuando no hay nada
  // esperando esto es una consulta por indice que no devuelve filas.
  const llaves = [];
  if (conv?.recien_creada) llaves.push(key.remoteJid);
  if (otraLlave) llaves.push(otraLlave);
  for (const llave of llaves) {
    model.aplicarEtiquetasPendientes?.({ instancia, jid: llave })
      ?.catch(() => { /* ya se registra dentro */ });
  }

  // La foto de perfil, UNA vez por conversacion y sin bloquear.
  //
  // Evolution la manda en `contacts.update`, pero eso solo llega cuando cambia:
  // para un chat que ya existe sin foto no llega nunca. Se pide aqui la primera
  // vez, y solo esa: en cada mensaje serian cientos de llamadas de mas.
  //
  // Va suelta a proposito. Que WhatsApp tarde en dar una foto no puede retrasar
  // la entrada de un mensaje, y que falle no puede perderlo.
  if (!conv.avatar_url && !esGrupo) {
    evolution.fotoDe(conv.telefono, instancia)
      .then((url) => (url ? model.actualizarAvatar(instancia, conv.jid, url) : null))
      .catch(() => {});
  }

  // Y de un grupo, su nombre y su foto.
  //
  // Evolution no manda el asunto en el aviso del mensaje: en `key` solo viene el
  // jid. El puente si, porque se lo pedia el. Sin esto un grupo se queda con su
  // identificador de 18 cifras por nombre — o sin nombre, desde que se dejo de
  // usar el `pushName` de quien escribio el ultimo.
  //
  // Una vez por grupo, y suelta: que WhatsApp tarde no puede retrasar el mensaje.
  // Se pregunta tambien si YA tiene nombre: puede ser uno malo heredado, y el
  // asunto de verdad lo corrige. Una vez cada seis horas por grupo basta —
  // preguntarlo en cada mensaje serian cientos de llamadas de mas.
  if (esGrupo && tocaMirarElGrupo(conv)) {
    evolution.grupoDe(conv.jid, instancia)
      .then((g) => (g ? model.datosDeGrupo(instancia, conv.jid, g.asunto, g.foto) : null))
      .catch(() => {});
  }

  const m = datos?.message || {};

  // «Eliminar para todos» no es un evento aparte: llega como un mensaje normal
  // cuyo contenido es un `protocolMessage` de tipo REVOKE apuntando al original.
  // Si se guardara tal cual, en el chat saldria una burbuja vacia y el mensaje
  // borrado seguiria ahi al lado.
  const revocacion = m?.protocolMessage;
  if (revocacion && (revocacion.type === 0 || String(revocacion.type).toUpperCase() === 'REVOKE')) {
    const cual = revocacion.key?.id || null;
    const marcados = cual ? await model.marcarEliminado(cual, conv.id) : 0;
    return { revocado: cual, marcados };
  }

  const { tipo } = media.tipoDeMensaje(m);
  if (tipo === 'otro') {
    // Este aviso ya estaba, y es el que va a resolver de verdad lo que se ve en
    // produccion: el numero de los leads enseña una fila tras otra de
    // «Descargar otro» y ni una palabra. Desde aqui no se puede saber que tipo
    // es —hay medio centenar de clases de mensaje— y adivinar seria eso,
    // adivinar. Una linea de este registro lo dice.
    //
    // Ahora apunta tambien las claves de DENTRO del sobre: si el mensaje venia
    // envuelto, con las de fuera solo se veia «ephemeralMessage» y no lo que
    // llevaba dentro, que es lo que hace falta saber.
    media.apuntarDesconocido(m, { instancia, jid: destino.split('@')[0] });
  }

  // El adjunto NO se baja aqui. Se apunta en la cola y se descarga despues.
  //
  // Bajarlo dentro del webhook parecia lo natural y resulto ser el fallo mas
  // caro de la sesion: al emparejar llegan miles de mensajes, y por cada uno el
  // CRM le pedia el fichero de vuelta al mismo servicio que se los estaba
  // mandando. Miles de peticiones cruzadas en los dos sentidos a la vez: se
  // saturo la cola de conexiones y se perdieron 2.463 mensajes con «fetch
  // failed». El webhook tiene que contestar rapido y soltar.
  const fila = await model.guardarMensaje({
    conversacionId: conv.id,
    waId: key.id,
    direccion: key.fromMe ? 'saliente' : 'entrante',
    tipo,
    texto: media.textoDe(m),
    mediaMime: m.audioMessage?.mimetype || m.imageMessage?.mimetype
      || m.videoMessage?.mimetype || m.documentMessage?.mimetype || null,
    nombreArchivo: m.documentMessage?.fileName || null,
    // A que mensaje responde, si responde a alguno.
    //
    // Dos sitios, como con el autor del grupo: el puente lo manda ya masticado
    // en `respondeA`, y Evolution manda el mensaje crudo con la cita dentro del
    // `contextInfo` del tipo concreto. Leyendo solo lo primero, en produccion
    // una respuesta se guardaba SIN saber a que respondia — y la cita no salia
    // nunca. Es la mitad que faltaba del #62.
    respondeA: datos?.respondeA || media.aQueResponde(m, datos?.contextInfo) || null,
    // Quien escribio, en un grupo. Sin esto todos los mensajes de un grupo
    // salen iguales y no se sabe quien dijo que.
    //
    // Dos sitios porque hay dos remitentes: el puente de Baileys lo manda en
    // `datos.participante`, y Evolution —que es lo que corre en produccion— lo
    // pone en `key.participant`. Leyendo solo el primero, el autor quedaba
    // SIEMPRE vacio donde importa. Es el mismo patron del #63.
    //
    // Y el nombre sale de `pushName` precisamente porque en un grupo es el de
    // quien escribe: lo que lo hace inservible para nombrar la conversacion es
    // lo que lo hace correcto aqui.
    // `participantAlt` ANTES que `participant`.
    //
    // Con el direccionamiento nuevo de WhatsApp —`addressingMode: 'lid'`—
    // `participant` es un identificador opaco («213773457600590@lid») que no
    // dice quien es nadie. El telefono de verdad viene al lado, en
    // `participantAlt`. Comprobado en un grupo real: los tres mensajes que mire
    // traian el lid en uno y el numero en el otro.
    participante: datos?.participante || key.participantAlt || key.participant || null,
    participanteNombre: datos?.participanteNombre || (esGrupo ? datos?.pushName : null) || null,
    ts: cuando,
  });

  // Lo de AHORA se baja delante de todo; lo viejo del historial, con criterio.
  //
  // Antes entraba todo por igual y en orden de llegada: una foto recien enviada
  // se ponia detras de los 17.893 adjuntos del historial y tardaba mas de una
  // hora en verse. En el chat salia «no se pudo descargar», que ademas era
  // mentira: no habia fallado, es que no le habia llegado el turno.
  // Aunque el mensaje resulte duplicado, ha entrado: cuenta como señal de vida.
  pulso.set(instancia, Date.now());

  const esHistorial = Boolean(cuerpo?.historial);
  // Solo lo viejo cuenta como «sigue entrando historial». Lo de ahora es
  // conversacion, y no hay nada que esperar.
  if (esHistorial) pulsoHistorial.set(instancia, Date.now());
  let enCola = false;
  if (fila && tipo !== 'texto' && tipo !== 'otro') {
    if (media.mereceDescarga({ tipo, ts: fila.ts, esHistorial })) {
      media.encolar({ mensajeId: fila.id, key, message: m, instancia }, !esHistorial);
      enCola = true;
    }
  }

  return { conversacionId: conv.id, guardado: Boolean(fila), duplicado: !fila, tipo, enCola };
}

/**
 * Cuando paso, venga como venga.
 *
 * Baileys manda un Date y al pasar por JSON llega como texto ISO, que es lo
 * normal. Pero no se puede dar por hecho: si llegara en segundos —como hace
 * `messageTimestamp` en los mensajes— saldria una llamada fechada en 1970, y si
 * llegara rota, `new Date()` daria «Invalid Date», Postgres rechazaria la fila y
 * la llamada se perderia entera sin que nadie se entere.
 *
 * Ante la duda, la hora de ahora: una llamada fechada con un segundo de
 * diferencia sigue siendo util; una llamada que no se guarda, no.
 */
function cuandoFue(valor) {
  if (valor == null) return new Date();
  // Un numero es marca de tiempo. Por debajo de 10^11 son segundos: en
  // milisegundos esa cifra seria 1973, y no hay llamadas de WhatsApp de 1973.
  if (typeof valor === 'number' || /^\d+$/.test(String(valor))) {
    const n = Number(valor);
    const d = new Date(n < 1e11 ? n * 1000 : n);
    return Number.isNaN(d.getTime()) ? new Date() : d;
  }
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * call: alguien ha llamado.
 *
 * Hoy una llamada perdida no dejaba rastro en ningun sitio — ni la gestora sabia
 * que la habian llamado ni el CRM se enteraba. Se apunta como una linea mas del
 * hilo, que es donde se mira.
 *
 * Evolution manda un aviso por CADA cambio de estado de la misma llamada
 * (`offer`, `ringing`, `timeout`...), asi que si se guardaran todos saldrian
 * cinco lineas por una sola llamada. Se guarda solo el desenlace, y ademas el
 * identificador va como `call:<id>`: el indice unico de `wa_id` remata el
 * duplicado aunque el aviso se reintente.
 *
 * No hace falta migracion: `tipo` no tiene lista cerrada de valores.
 */
async function llamada(cuerpo) {
  // El aviso de llamada llega como OBJETO o como LISTA, segun quien lo mande.
  //
  // Baileys emite `call` con un array —`sock.ev.on('call', (llamadas) => …)`—
  // porque WhatsApp puede notificar varias de golpe. Quien lo reenvie fielmente
  // manda ese array. Aqui se leia `datos.id` a secas: con una lista eso es
  // undefined, y la llamada se descartaba entera por «sin id». En produccion no
  // se registraria ni una sola llamada entrante, y no habria ni rastro de por
  // que — el descarte no deja aviso.
  //
  // No se puede comprobar contra el Evolution de verdad desde aqui, asi que se
  // aceptan las dos formas. Aceptar de mas no rompe nada; suponer, si.
  const bruto = cuerpo?.data || cuerpo;
  const datos = Array.isArray(bruto) ? bruto[0] : bruto;
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;
  if (!instancia) return { ignorado: 'llamada sin instancia' };

  const id = datos?.id;
  if (!id) return { ignorado: 'llamada sin id' };

  const estado = String(datos?.status || '').toLowerCase();
  // Solo el desenlace se GUARDA. Lo de en medio no es un hecho todavia.
  //
  // `terminate` no esta aqui porque no dice COMO acabo. Se resuelve mas abajo,
  // que necesita saber si la llamada seguia sonando.
  const COMO_ACABO = { timeout: 'perdida', reject: 'rechazada', accept: 'contestada' };
  let desenlace = COMO_ACABO[estado];

  // `from` puede venir como `@lid`, que identifica a la persona sin dar su
  // numero. Baileys manda el telefono aparte en `callerPn` cuando lo sabe.
  const quienLlama = datos?.callerPn || datos?.from;
  if (!quienLlama) return { ignorado: 'llamada sin origen' };
  // En grupo, la conversacion es el grupo; en persona, quien llama.
  const jid = datos?.isGroup ? (datos?.chatId || datos?.groupJid || quienLlama) : quienLlama;

  // `terminate`: la llamada acabo, pero WhatsApp no dice COMO.
  //
  // Antes se descartaba, y por eso una llamada en la que el otro cuelga antes
  // de que salte el buzon NO DEJABA NADA. Ni una linea. Comprobado con una
  // llamada de verdad: llegaron `offer`, dieciseis `relaylatency` y un
  // `terminate`, y en la base no quedo mas que la conversacion vacia.
  //
  // Y no se puede deducir el final, esto no es una sospecha: en el Baileys que
  // lleva Evolution v2.3.7 el `terminate` sale «fired when accepted / rejected
  // / timeout / caller hangs up» —su propio comentario—, y `accept` y `reject`
  // solo se emiten cuando descuelga o rechaza ESTE aparato, no el movil. Asi
  // que cuando contestas en el movil aqui solo llega `terminate`: apuntar
  // «perdida» seria mentir en un historial que sirve para auditar.
  //
  // Se guarda lo que SI se sabe: que sono y que termino. La duracion la pone la
  // pantalla, y quien lo lea sabe que la llamada existio — que es justo lo que
  // faltaba.
  const seguiaSonando = sonando.get(instancia);
  if (estado === 'terminate') {
    sonando.delete(instancia);
    // Sin `offer` previo no hubo llamada nuestra que cerrar: es el `terminate`
    // que llega detras de un accept o un reject ya guardados, o el de una
    // llamada que empezo antes de arrancar el proceso.
    if (!seguiaSonando || seguiaSonando.id !== id) return { ignorado: 'llamada ya cerrada' };
    desenlace = 'terminada';
  }
  // Ni `offer` ni el desenlace: son estados intermedios del protocolo.
  if (!desenlace && estado !== 'offer') return { ignorado: `llamada en curso (${estado})` };

  // Quien llama, con nombre y cara.
  //
  // El aviso de la llamada no los trae —`handleCall` de Baileys arma el evento
  // con chatId, from, id, date, offline y status, y nada mas— asi que la
  // conversacion nacia sin nombre y la pantalla pintaba el identificador crudo:
  // catorce cifras que no le dicen nada a nadie. Se buscan en la agenda, donde
  // si estan.
  //
  // Solo al sonar: es un aviso raro y una llamada a Evolution de mas ahi no
  // molesta, mientras que hacerlo en cada cambio de estado serian cinco.
  const ficha = (estado === 'offer' && evolution.configurado())
    ? await evolution.contactoDe(jid, instancia).catch(() => null)
    : null;

  const conv = await model.conversacionDe({
    instancia,
    jid,
    nombrePush: ficha?.nombre || null,
    avatarUrl: ficha?.foto || null,
  });

  // Esta sonando. Se apunta en memoria para que la pantalla lo cante, se busca
  // el nombre AQUI —una vez, y es un aviso raro— y no en cada consulta de la
  // pantalla, que se repite cada pocos segundos y seria una consulta por vuelta.
  if (!desenlace) {
    sonando.set(instancia, {
      id: datos.id,
      telefono: conv.telefono,
      nombre: conv.nombre_push || null,
      conversacionId: conv.id,
      esVideo: Boolean(datos?.isVideo),
      esGrupo: Boolean(datos?.isGroup),
      desde: Date.now(),
    });
    return { conversacionId: conv.id, sonando: true, tipo: 'llamada' };
  }

  // Cuanto estuvo sonando, si se llego a ver el `offer`.
  const segundosSonando = seguiaSonando?.desde
    ? Math.max(1, Math.round((Date.now() - seguiaSonando.desde) / 1000))
    : null;

  // Ya no suena: se quita el cartel. Da igual como acabara — contestada en el
  // movil, rechazada o perdida—, lo que no puede es seguir avisando.
  sonando.delete(instancia);
  const fila = await model.guardarMensaje({
    conversacionId: conv.id,
    waId: `call:${id}`,
    direccion: 'entrante',
    tipo: 'llamada',
    // El desenlace en seco, no la frase. La pantalla decide como se dice, y asi
    // se puede filtrar por «perdidas» sin buscar dentro de un texto.
    //
    // Con los segundos detras cuando se sabe cuanto sono —«terminada:16»—, que
    // es lo unico que distingue una llamada que alguien dejo pasar de una que
    // no llego a sonar. No hay columna para esto y las migraciones estan
    // paradas; separado por dos puntos se lee igual de bien y quien filtra por
    // «perdida» sigue casando por delante.
    texto: (desenlace === 'terminada' && segundosSonando)
      ? `terminada:${segundosSonando}`
      : desenlace,
    // Para una llamada, «de que tipo de medio es» si significa algo.
    mediaMime: datos?.isVideo ? 'video' : 'audio',
    ts: cuandoFue(datos?.date),
  });

  // Y en la ficha del prospecto, que es donde mira quien no entra en WhatsApp.
  //
  // Solo si el mensaje se guardo de verdad: cuando `fila` viene vacia es que ese
  // aviso ya habia entrado —Evolution reintenta— y sin esta condicion la misma
  // llamada saldria dos y tres veces en el historial de contactos.
  if (fila && conv.lead_id) {
    // Escritas enteras, las dos formas. Pegar «Video» delante daba
    // «VideoLlamada rechazada», con la ele en mayuscula en mitad de la palabra.
    const COMO_SE_CUENTA = {
      perdida:    { voz: 'Llamada perdida por WhatsApp',    video: 'Videollamada perdida por WhatsApp' },
      rechazada:  { voz: 'Llamada rechazada por WhatsApp',  video: 'Videollamada rechazada por WhatsApp' },
      contestada: { voz: 'Llamada contestada por WhatsApp', video: 'Videollamada contestada por WhatsApp' },
      // No se sabe si la cogio en el movil o si el otro colgo, asi que se
      // cuenta lo que hay: que entro y cuanto sono.
      terminada:  {
        voz:   `Llamada por WhatsApp${segundosSonando ? ` (sonó ${segundosSonando} s)` : ''}`,
        video: `Videollamada por WhatsApp${segundosSonando ? ` (sonó ${segundosSonando} s)` : ''}`,
      },
    };
    const comoSeCuenta = COMO_SE_CUENTA[desenlace];
    try {
      await model.apuntarInteraccion({
        leadId: conv.lead_id,
        nota: comoSeCuenta
          ? (datos?.isVideo ? comoSeCuenta.video : comoSeCuenta.voz)
          : 'Llamada por WhatsApp',
        userId: evolution.usuarioDeInstancia(instancia),
        fecha: fila.ts,
      });
    } catch (err) {
      // Que no se apunte en la ficha no puede tirar el webhook: la llamada YA
      // esta guardada en el chat, que es lo que no se puede perder.
      logger.warn({ instancia, err: err.message }, 'WhatsApp: llamada guardada pero no apuntada en la ficha');
    }
  }

  pulso.set(instancia, Date.now());
  return { conversacionId: conv.id, guardado: Boolean(fila), duplicado: !fila, tipo: 'llamada', desenlace };
}

/** messages.update: WhatsApp dice que un mensaje nuestro llego o se leyo. */
async function acuse(cuerpo) {
  const datos = cuerpo?.data || cuerpo;

  // El identificador del mensaje viene en DOS sitios segun quien mande el aviso.
  //
  // El puente lo pone en `key.id`, como en el mensaje original. Evolution v2.3.7
  // —comprobado contra el de verdad, no suponiendo— manda el acuse APLANADO:
  //
  //     { keyId, remoteJid, fromMe, status, instanceId, messageId }
  //
  // No hay objeto `key`. Leyendo solo `key.id` se descartaban TODOS los acuses
  // por «sin id», y el mensaje se quedaba con un tic para siempre. Es el punto 3
  // del #99: comprobado mandando uno de verdad y viendo que se quedaba en
  // `enviado` con el mensaje ya en el movil.
  //
  // `messageId` NO sirve: es el identificador interno de Evolution, no el de
  // WhatsApp, y no casa con lo que guardamos.
  const waId = datos?.key?.id || datos?.keyId || null;
  if (!waId) return { ignorado: 'acuse sin id' };
  const crudo = datos?.status ?? datos?.update?.status;
  const bruto = String(crudo ?? '').toUpperCase();

  // El acuse llega de dos formas y solo se entendia una.
  //
  // En texto: SERVER_ACK, DELIVERY_ACK, READ, PLAYED. Y en numero, que es como
  // lo numera Baileys y como lo deja pasar Evolution en algunas versiones:
  // 2 entregado, 3 leido, 4 reproducido. Con solo el texto, un acuse numerico
  // caia en `null` y el mensaje se quedaba con un tic para siempre.
  //
  // PLAYED es una nota de voz escuchada. Escuchada es leida: no hay un tercer
  // tic para eso, y dejarlo fuera hacia que oir un audio no marcara nada.
  const porNumero = { 2: 'entregado', 3: 'leido', 4: 'leido' };
  const estado = /READ|PLAYED/.test(bruto) ? 'leido'
    : /DELIVER/.test(bruto) ? 'entregado'
    : /ERROR|FAIL/.test(bruto) ? 'fallido'
    : porNumero[Number(crudo)] || null;
  if (!estado) return { ignorado: `estado ${bruto}` };
  await model.actualizarEstado(waId, estado);
  return { waId, estado };
}

/**
 * Trae de Evolution el historial de UN chat y lo mete en la base (#73).
 *
 * «No aparecen los numeros de los seguimientos de tiempo atras»: al enlazar se
 * pide `syncFullHistory: false`, asi que solo entra lo reciente y el buscador
 * no puede encontrar lo que nunca llego. Poner eso a `true` traeria cientos de
 * miles de mensajes de golpe en un numero con años de uso.
 *
 * Se hace al reves: se pide UN chat, cuando alguien lo busca y no aparece.
 *
 * Reinyecta por `recibir()`, el mismo camino que el webhook. Es a proposito:
 * asi el historial pasa por toda la logica normal —tipos, adjuntos, citas,
 * autor en grupos— en vez de por una via paralela que se quedaria atras al
 * primer cambio. Y `wa_mensajes` tiene un unico por (conversacion, wa_id), asi
 * que repetirlo no duplica nada.
 */
export async function traerHistorial({ conversacion, limite = 300 }) {
  if (!evolution.configurado()) {
    throw new AppError('WhatsApp no esta configurado', 503, 'SIN_EVOLUTION');
  }
  const crudos = await evolution.mensajesDe(conversacion.jid, conversacion.instancia, limite);
  if (!crudos.length) return { pedidos: 0, metidos: 0 };

  let metidos = 0;
  for (const m of crudos) {
    // Se marca como historial: el CRM lo usa para decidir que adjuntos baja ya
    // y cuales pueden esperar. Sin esto, traer un chat de hace meses pondria
    // cientos de fotos por delante de las de ahora en la cola de descargas.
    const r = await recibir({
      instance: conversacion.instancia,
      historial: true,
      data: {
        key: m.key,
        pushName: m.pushName || null,
        message: m.message,
        messageTimestamp: String(m.messageTimestamp || Math.floor(Date.now() / 1000)),
      },
    }).catch(() => null);
    if (r && !r.ignorado) metidos += 1;
  }
  return { pedidos: crudos.length, metidos };
}

/**
 * ¿Toca volver a preguntar por este grupo?
 *
 * Si no tiene nombre o foto, si. Y aunque los tenga, cada seis horas: el nombre
 * de un grupo cambia, y ademas puede haberse quedado uno malo de antes.
 */
const grupoMirado = new Map();
const CADA_GRUPO_MS = 6 * 60 * 60 * 1000;
function tocaMirarElGrupo(conv) {
  if (!conv?.nombre_push || !conv?.avatar_url) return true;
  const antes = grupoMirado.get(conv.id);
  if (antes && Date.now() - antes < CADA_GRUPO_MS) return false;
  grupoMirado.set(conv.id, Date.now());
  return true;
}

/** Pide la foto de un contacto y la guarda. No lanza: es un adorno, no un dato. */
export async function buscarFoto(conv) {
  if (!evolution.configurado() || !conv?.telefono) return null;
  const url = await evolution.fotoDe(conv.telefono, conv.instancia);
  if (!url) return null;
  await model.actualizarAvatar(conv.instancia, conv.jid, url);
  return url;
}

/**
 * Alguien borro un mensaje.
 *
 * Llega de dos formas distintas y hay que atender las dos:
 *
 *  · «Eliminar para mi» — WhatsApp lo sincroniza entre los dispositivos de uno
 *    mismo y Baileys lo emite como `messages.delete`. La forma varia entre
 *    versiones: unas mandan un objeto, otras una lista, y la clave puede venir
 *    como `key` o aplanada. Se aceptan todas, que es lo que hemos aprendido a
 *    hacer con este proveedor.
 *
 *  · «Eliminar para todos» — no es un evento aparte: llega como un mensaje
 *    normal cuyo contenido es un `protocolMessage` de tipo REVOKE que apunta al
 *    mensaje original. Eso se atiende en `recibir()`.
 *
 * No se borra la fila: se marca. Ver `marcarEliminado`.
 */
async function borrado(cuerpo) {
  const bruto = cuerpo?.data || cuerpo;

  // La forma que faltaba: `{ keys: [...] }`.
  //
  // Es la que emite Baileys para «eliminar para mi», y se comprobo en el codigo
  // que corre dentro de Evolution v2.3.7: `chat-utils.js` hace
  //
  //     ev.emit('messages.delete', { keys: [{ remoteJid, id, fromMe }] })
  //
  // O sea que la clave NO viene en el objeto de arriba, sino dentro de una lista
  // que cuelga de `keys`. Se aceptaban el objeto suelto, la lista de objetos y
  // la clave aplanada — las tres — y esta se caia por el unico hueco que
  // quedaba: `d.key.id`, `d.keyId` y `d.id` son todos undefined, asi que el
  // aviso entraba, no casaba con nada y salia con «0 marcados» sin decir nada.
  //
  // Un borrado que no se refleja es de lo peor que puede hacer esto: el mensaje
  // sigue ahi para quien mira el CRM y ya no existe para quien mira el movil.
  const claves = Array.isArray(bruto?.keys) ? bruto.keys
    : Array.isArray(bruto) ? bruto
    : [bruto];

  let marcados = 0;
  for (const d of claves) {
    const waId = d?.key?.id || d?.keyId || d?.id || null;
    if (waId) marcados += await model.marcarEliminado(waId);
  }
  return { borrados: claves.length, marcados };
}

/**
 * La foto de perfil de un contacto.
 *
 * Cuarta vez que aparece el mismo patron. El CRM leia la foto de
 * `datos.avatar`, y eso lo manda el PUENTE: se la baja el mismo de WhatsApp y la
 * mete en el aviso del mensaje. Evolution no hace eso — manda un evento
 * `contacts.update` aparte, con `profilePicUrl`, y ese evento el CRM lo estaba
 * DESCARTANDO junto con todo lo que no fuera un mensaje.
 *
 * Resultado en produccion: nadie tiene foto. Ni una. Se ven las iniciales
 * siempre, y parece que la funcion no existe.
 *
 * Llega como lista —una entrada por contacto— aunque solo cambie uno.
 */
async function contactos(cuerpo) {
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;
  if (!instancia) return { ignorado: 'contactos sin instancia' };

  const bruto = cuerpo?.data || cuerpo;
  const lista = Array.isArray(bruto) ? bruto : [bruto];
  let puestas = 0;
  for (const c of lista) {
    const jid = c?.remoteJid || c?.id || c?.jid;
    const url = c?.profilePicUrl || c?.avatar || null;
    if (!jid || !url) continue;
    puestas += await model.actualizarAvatar(instancia, jid, url);
  }
  return { contactos: lista.length, fotos: puestas };
}

/** Marca leidos los entrantes de una conversacion, tambien en WhatsApp. */
export async function marcarLeida(conversacionId, noLeidos = null) {
  // Si no hay nada sin leer, no hay nada que marcar.
  //
  // La pantalla vuelve a pedir el hilo cada cinco segundos, y esto se hacia en
  // cada vuelta: tres consultas y una llamada a WhatsApp para no cambiar nada.
  // Con diez pantallas abiertas eran seis consultas y dos llamadas por segundo
  // de puro trabajo tirado.
  if (noLeidos === 0) return;
  await model.marcarLeida(conversacionId);
  const conv = await model.porId(conversacionId);
  const ultimo = (await model.ultimoEntranteSinLeer(conversacionId));
  if (conv && ultimo?.wa_id && evolution.configurado()) {
    await evolution.marcarLeido(
      {
        remoteJid: conv.jid,
        fromMe: false,
        id: ultimo.wa_id,
        // En un grupo, sin `participant` WhatsApp no sabe QUE mensaje marcar:
        // la terna es (remoteJid, participant, id). Se manda solo cuando lo hay
        // — en un chat de una persona el campo sobra y algunos servidores lo
        // rechazan si viene vacio.
        ...(ultimo.participante ? { participant: ultimo.participante } : {}),
      },
      conv.instancia
    ).catch(() => {});
  }
}

/**
 * Corrige un mensaje ya enviado. Tarea #75.
 *
 * Las tres condiciones no son nuestras, son de WhatsApp, y por eso se comprueban
 * ANTES de molestar a Evolution: solo se puede editar lo que uno mismo mando, y
 * solo texto, y solo durante 15 minutos. Preguntar sabiendo que va a decir que
 * no es tirar una peticion y ensuciar el registro.
 */
export const VENTANA_EDICION_MS = 15 * 60 * 1000;

/**
 * Reenvia un mensaje a otra conversacion (#99, punto 5).
 *
 * «De las cosas que mas se usan al pasar un dossier o un dato de una
 * conversacion a otra», y hasta ahora habia que descargar el archivo y volver
 * a subirlo a mano.
 *
 * No usa el reenvio nativo de WhatsApp —que marcaria el mensaje como
 * «reenviado»— sino que manda uno nuevo con el mismo contenido: el reenvio de
 * verdad necesita la clave original del mensaje, y de los importados del
 * historial no siempre la tenemos. Un mensaje nuevo funciona siempre.
 *
 * Las dos conversaciones tienen que ser de la MISMA sesion. Se comprueba
 * arriba, en el controlador, para las dos por separado: sin eso se podria
 * sacar contenido del chat de una companera hacia el propio.
 */
export async function reenviar({ mensaje, destinoId, usuarioId }) {
  if (mensaje.tipo === 'llamada') {
    throw new AppError('Una llamada no se puede reenviar', 400, 'NO_REENVIABLE');
  }

  // Sin archivo, es texto y basta con mandarlo.
  if (!mensaje.media_url) {
    const texto = (mensaje.texto || '').trim();
    if (!texto) throw new AppError('Ese mensaje no tiene nada que reenviar', 400, 'VACIO');
    return enviar({ conversacionId: destinoId, texto, usuarioId });
  }

  // Con archivo: se lee del disco y se manda como uno nuevo. Si el adjunto
  // todavia no se ha bajado —la cola va por detras— se dice, en vez de mandar
  // un mensaje a medias.
  let archivo;
  try {
    archivo = await media.leer(mensaje.media_url);
  } catch {
    throw new AppError('El archivo aun no esta descargado, intentalo en un momento', 409, 'SIN_ARCHIVO');
  }

  return enviarAdjunto({
    conversacionId: destinoId,
    buffer: archivo.buffer,
    mimetype: mensaje.media_mime,
    nombreArchivo: mensaje.nombre_archivo,
    // El pie va con el archivo: en WhatsApp el texto de una imagen es su pie,
    // y mandarlo aparte partiria en dos lo que era un solo mensaje.
    pie: mensaje.texto || null,
    usuarioId,
  });
}

export async function editarMensaje({ mensajeId, conversacion, texto, instancia }) {
  const m = await model.mensajePorId(mensajeId);
  if (!m || m.conversacion_id !== conversacion.id) {
    throw new AppError('Mensaje no encontrado', 404, 'NOT_FOUND');
  }
  if (m.direccion !== 'saliente') {
    throw new AppError('Solo se pueden corregir los mensajes que has mandado tu', 400, 'NO_ES_TUYO');
  }
  if (m.tipo !== 'texto') {
    throw new AppError('Solo se puede corregir el texto, no un archivo', 400, 'NO_ES_TEXTO');
  }
  if (!m.wa_id) {
    // Sin identificador de WhatsApp no hay a que apuntar. Pasa con los que
    // fallaron al salir: nunca llegaron, asi que no hay nada que corregir.
    throw new AppError('Ese mensaje no llego a salir; vuelve a mandarlo', 400, 'SIN_WA_ID');
  }
  const edad = Date.now() - new Date(m.ts).getTime();
  if (edad > VENTANA_EDICION_MS) {
    throw new AppError('WhatsApp solo deja corregir durante los primeros 15 minutos', 400, 'FUERA_DE_PLAZO');
  }

  const r = await evolution.editarTexto(
    // `telefono` y no el jid tenia el mismo fallo que `numeroDe`: en un grupo
    // son 18 cifras que no son un telefono de nadie.
    numeroDe(conversacion),
    { waId: m.wa_id, jid: conversacion.jid, mio: true },
    texto,
    instancia
  );
  if (!r.ok) {
    if (r.error === 'NO_SOPORTADO') {
      throw new AppError('Este WhatsApp no permite corregir mensajes', 400, 'NO_SOPORTADO');
    }
    throw new AppError('No se pudo corregir el mensaje', 502, 'EVOLUTION_ERROR');
  }

  // Se guarda el texto nuevo. El viejo NO se conserva: en WhatsApp una edicion
  // sustituye al mensaje y quien lo recibio ve el corregido; guardar aqui una
  // version que el prospecto ya no ve solo serviria para confundir a quien lea
  // el chat despues.
  return model.corregirTexto(mensajeId, texto);
}

/**
 * Cuanto lleva traido del historial, de 0 a 100.
 *
 * En memoria y por instancia. No lleva tabla a proposito: es un dato que solo
 * vale mientras dura la sincronizacion y que se puede perder sin consecuencias
 * — si se reinicia a mitad, la pantalla vuelve a enseñar los contadores de
 * siempre en vez de un porcentaje parado que ya no avanza.
 *
 * Puede no llegar nunca: depende de que quien manda los avisos lo incluya. Por
 * eso la pantalla lo enseña SOLO si existe, y si no, sigue con «1 chats y 4
 * mensajes hasta ahora» como hasta hoy. Nunca se inventa.
 */
const progresoHistorial = new Map();

function anotarProgreso(cuerpo) {
  const instancia = cuerpo?.instance || cuerpo?.instancia;
  const pct = Number(cuerpo?.data?.progress);
  if (!instancia || !Number.isFinite(pct)) return { ignorado: true };
  const ultimo = Boolean(cuerpo?.data?.isLatest);
  progresoHistorial.set(instancia, {
    pct: Math.max(0, Math.min(100, Math.round(pct))),
    ultimo,
    cuando: Date.now(),
  });
  return { progreso: pct };
}

/**
 * El historial que manda el movil al enlazar un numero (#73).
 *
 * QUE ES. Al elegir «el ultimo mes» o «todo el historial», WhatsApp no manda
 * esas conversaciones como mensajes nuevos: las vuelca en tandas por un evento
 * aparte. Baileys lo emite como `messaging-history.set` y Evolution lo reenvia
 * al webhook como `messages.set`, con un ARRAY de mensajes en `data` — no un
 * mensaje suelto como en `messages.upsert`.
 *
 * Hasta ahora ese evento ni se pedia ni se atendia, asi que en produccion las
 * tres opciones de la pantalla hacian lo mismo: nada del pasado. En local si
 * parecia funcionar porque el puente de Baileys manda su historial como
 * `messages.upsert`.
 *
 * POR QUE NO SE ESPERA A GUARDARLO. Evolution **se queda esperando** a que su
 * aviso conteste antes de seguir con el siguiente: si el CRM tarda, cada aviso
 * se come su tiempo de espera y la cola entera se para —ya paso, 109 reintentos
 * en doce minutos y el numero mudo toda la manana—. Una tanda puede traer miles
 * de mensajes, asi que se contesta al momento y se guardan detras, en una cola
 * propia, de una tanda en una.
 *
 * El recorte del mes va donde ya estaba, mensaje a mensaje (`sobraDelHistorial`),
 * y no hay que tocar nada mas: `no_leidos` solo sube con lo que llega de los dos
 * ultimos minutos y `ultimo_at` nunca retrocede, asi que importar un mes viejo
 * no llena el globo de avisos ni descoloca la lista.
 */
let colaDeHistorial = Promise.resolve();

function historial(cuerpo) {
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;

  // Cuanto lleva. Evolution lo manda junto a la tanda; el puente, en su propio
  // evento. Se aceptan los dos sitios para no depender de la forma de uno.
  const pct = Number(cuerpo?.progress ?? cuerpo?.data?.progress);
  if (Number.isFinite(pct)) {
    anotarProgreso({
      instance: instancia,
      data: { progress: pct, isLatest: cuerpo?.isLatest ?? cuerpo?.data?.isLatest },
    });
  }

  // Dos formas, otra vez: Evolution manda el array pelado en `data` y el puente
  // lo envuelve en `{ messages: [...] }`. Suponer una sola es el fallo que ya
  // costo la #63 y la #99.
  const lista = Array.isArray(cuerpo?.data) ? cuerpo.data
    : Array.isArray(cuerpo?.data?.messages) ? cuerpo.data.messages
    : [];
  if (!lista.length) return { historial: 0 };

  colaDeHistorial = colaDeHistorial.then(() => guardarTanda(cuerpo, lista)).catch(() => {});
  return { historial: lista.length, encolado: true };
}

/** Guarda una tanda, uno a uno, por el mismo camino que un mensaje normal. */
async function guardarTanda(cuerpo, lista) {
  let guardados = 0;
  let fuera = 0;
  for (const m of lista) {
    try {
      // Se reusa el camino de siempre a proposito: el historial tiene que pasar
      // por las mismas reglas —grupos, canales, el recorte del mes, la cita, el
      // autor del grupo— o acabarian siendo dos formas distintas de guardar un
      // mensaje, y una de las dos se quedaria atras.
      const r = await recibir({ ...cuerpo, event: 'messages.upsert', type: undefined, data: m });
      if (r?.ignorado) fuera += 1; else guardados += 1;
    } catch (err) {
      // Un mensaje raro no puede llevarse por delante la tanda entera.
      fuera += 1;
      logger.warn({ err: err.message }, 'WhatsApp: un mensaje del historial no se pudo guardar');
    }
  }
  logger.info(
    { instancia: cuerpo?.instance || cuerpo?.instanceName || null, guardados, fuera },
    'WhatsApp: tanda de historial'
  );
  return { guardados, fuera };
}

/** Para las pruebas: esperar a que la cola del historial se vacie. */
export const _historialGuardado = () => colaDeHistorial;

/**
 * Se creo, se renombro o se borro una etiqueta en el movil (#128, #138).
 *
 * El aviso trae `{ id, name, color, deleted?, predefinedId? }`.
 *
 * ESTE nombre es el bueno. Evolution guarda en su base el nombre pelado —le
 * quita todo lo que no sea ASCII imprimible antes de escribirlo, asi que
 * «Presupuesto ✅» se queda en «Presupuesto » y «Sesión» en «Sesin»— pero manda
 * el aviso ANTES de pelarlo. Por eso el CRM se queda con el de aqui y no con el
 * de `findLabels`.
 */
async function etiquetaTocada(cuerpo) {
  const instancia = cuerpo?.instance || cuerpo?.instanceName || cuerpo?.data?.instance || null;
  const d = cuerpo?.data || cuerpo;
  const waId = d?.id ?? d?.labelId;
  if (!instancia || waId == null) return { ignorado: 'aviso de etiqueta sin id' };

  if (d?.deleted) {
    await model.marcarEtiquetaBorrada(instancia, waId);
    return { etiqueta: String(waId), borrada: true };
  }
  await model.guardarEtiqueta({
    instancia,
    waId,
    nombre: d?.name ?? d?.nombre ?? `Etiqueta ${waId}`,
    color: d?.color ?? null,
  });
  return { etiqueta: String(waId) };
}

/**
 * Se puso o se quito una etiqueta en un chat.
 *
 * El aviso trae `{ instance, type: 'add'|'remove', chatId, labelId }`. `chatId`
 * es el jid entero, que es justo lo que hace falta para encontrar la
 * conversacion.
 */
async function etiquetaEnUnChat(cuerpo) {
  const instancia = cuerpo?.instance || cuerpo?.instanceName || cuerpo?.data?.instance || null;
  const d = cuerpo?.data || cuerpo;
  // Sin el numero de dispositivo.
  //
  // WhatsApp direcciona a veces con el aparato dentro —«34722134659:0@s.whats
  // app.net», donde el «:0» es desde que telefono se hablo— y las
  // conversaciones se guardan sin el. Con el sufijo no casan y la etiqueta se
  // queda esperando a un chat que no existira nunca. Se vio en vivo, traduciendo
  // el @lid de una etiqueta puesta desde el movil.
  const jid = String(d?.chatId ?? d?.association?.chatId ?? '').replace(/:\d+(?=@)/, '') || null;
  const waIdEtiqueta = d?.labelId ?? d?.association?.labelId;
  if (!instancia || !jid || waIdEtiqueta == null) {
    return { ignorado: 'aviso de asociacion incompleto' };
  }
  // El puente manda `type` y Evolution tambien, pero conviene no dar por hecho
  // que solo hay dos valores: cualquier cosa que no sea «remove» pone, que es
  // la equivocacion barata —ver una etiqueta de mas se corrige mirando; una de
  // menos no se nota.
  const poner = String(d?.type ?? d?.accion ?? 'add').toLowerCase() !== 'remove';
  return model.asociarEtiqueta({ instancia, jid: String(jid), waIdEtiqueta, poner });
}

/** El progreso de esta instancia, o null si nadie lo ha mandado. */
export function progresoDe(instancia) {
  const p = progresoHistorial.get(instancia);
  if (!p) return null;
  // Si lleva mas de dos minutos sin moverse, deja de contar: una barra parada
  // en el 40 % es peor que no tener barra.
  if (Date.now() - p.cuando > 120000) return null;
  return p.pct;
}

/** Para las pruebas. */
export const _progreso = progresoHistorial;
