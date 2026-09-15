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
  // El nombre SOLO se coge de lo que ENTRA.
  //
  // `pushName` es el nombre de quien escribe. En un mensaje que sale, quien
  // escribe eres tu, asi que guardarlo aqui le pone TU nombre al chat del otro:
  // en cuanto la gestora escribia a alguien que no tenia guardado, esa
  // conversacion pasaba a llamarse «Iseie Innovation School». Y como el nombre
  // se conserva cuando el nuevo llega vacio, se quedaba puesto para siempre.
  const deMi = key.fromMe === true;
  // En un GRUPO, `pushName` es quien escribe, NO el grupo: usarlo aqui bautiza
  // la conversacion con el nombre —o el numero— del ultimo que hablo, y va
  // cambiando solo. El nombre de un grupo es su asunto, y viene aparte. Si no
  // llega, mejor dejarlo vacio que ponerle el de una persona.
  const nombreDelChat = esGrupo
    ? (datos?.groupSubject || cuerpo?.groupSubject || datos?.subject || null)
    : (deMi ? null : datos?.pushName);
  const conv = await model.conversacionDe({
    instancia, jid: key.remoteJid,
    nombrePush: nombreDelChat,
    avatarUrl: deMi ? null : (datos?.avatar || null),
  });

  const m = datos?.message || {};
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
  // messageTimestamp viene en segundos.
  const cuando = datos?.messageTimestamp
    ? new Date(Number(datos.messageTimestamp) * 1000)
    : new Date();

  // «El ultimo mes» tiene que ser un mes (#73).
  //
  // El recorte vivia solo en el puente de Baileys, asi que en produccion no
  // existia. Se hace ANTES de crear nada: descartarlo despues de guardar la
  // conversacion dejaria chats vacios en la lista, que es peor que no tenerlos.
  //
  // Solo puede saltar con el modo «rapido» apuntado y una fecha de hace mas de
  // 30 dias, y un mensaje en vivo nunca cumple lo segundo.
  if (politica.sobraDelHistorial(instancia, cuando)) {
    return { ignorado: 'mas viejo que el mes que se pidio' };
  }

  const fila = await model.guardarMensaje({
    conversacionId: conv.id,
    waId: key.id,
    direccion: key.fromMe ? 'saliente' : 'entrante',
    tipo,
    texto: media.textoDe(m),
    mediaMime: m.audioMessage?.mimetype || m.imageMessage?.mimetype
      || m.videoMessage?.mimetype || m.documentMessage?.mimetype || null,
    nombreArchivo: m.documentMessage?.fileName || null,
    // A que mensaje responde, si responde a alguno. Lo manda el puente.
    respondeA: datos?.respondeA || null,
    // Quien escribio, en un grupo. Sin esto todos los mensajes de un grupo
    // salen iguales y no se sabe quien dijo que.
    //
    // Se mira en DOS sitios. `participante` lo manda el puente de Baileys ya
    // traducido; pero produccion habla con Evolution DIRECTAMENTE, y Evolution
    // lo pone en `key.participant`. Leyendo solo el primero, en produccion el
    // autor quedaba siempre vacio — o sea que la mitad de para que sirve leer un
    // grupo no funcionaba justo donde importa.
    participante: datos?.participante || key?.participant || null,
    participanteNombre: datos?.participanteNombre
      || (esGrupo && !deMi ? datos?.pushName : null) || null,
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
  const datos = cuerpo?.data || cuerpo;
  const instancia = cuerpo?.instance || cuerpo?.instanceName || null;
  if (!instancia) return { ignorado: 'llamada sin instancia' };

  const id = datos?.id;
  if (!id) return { ignorado: 'llamada sin id' };

  const estado = String(datos?.status || '').toLowerCase();
  // Solo el desenlace se GUARDA. Lo de en medio no es un hecho todavia.
  const COMO_ACABO = { timeout: 'perdida', reject: 'rechazada', accept: 'contestada' };
  const desenlace = COMO_ACABO[estado];

  // `from` puede venir como `@lid`, que identifica a la persona sin dar su
  // numero. Baileys manda el telefono aparte en `callerPn` cuando lo sabe.
  const quienLlama = datos?.callerPn || datos?.from;
  if (!quienLlama) return { ignorado: 'llamada sin origen' };
  // En grupo, la conversacion es el grupo; en persona, quien llama.
  const jid = datos?.isGroup ? (datos?.chatId || datos?.groupJid || quienLlama) : quienLlama;

  // `terminate` dice que la llamada acabo, pero no COMO: llega detras de un
  // accept o un reject que ya se guardaron. No se guarda nada —seria adivinar—
  // pero si se apaga el cartel. Sin esto se quedaria puesto hasta caducar solo,
  // y son 45 segundos avisando de una llamada que ya no existe.
  if (estado === 'terminate') {
    sonando.delete(instancia);
    return { ignorado: 'llamada terminada' };
  }
  // Ni `offer` ni el desenlace: son estados intermedios del protocolo.
  if (!desenlace && estado !== 'offer') return { ignorado: `llamada en curso (${estado})` };

  const conv = await model.conversacionDe({ instancia, jid });

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
    texto: desenlace,
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
  const waId = datos?.key?.id;
  if (!waId) return { ignorado: 'acuse sin id' };
  const bruto = String(datos?.status || datos?.update?.status || '').toUpperCase();
  const estado = /READ/.test(bruto) ? 'leido'
    : /DELIVER/.test(bruto) ? 'entregado'
    : /ERROR|FAIL/.test(bruto) ? 'fallido'
    : null;
  if (!estado) return { ignorado: `estado ${bruto}` };
  await model.actualizarEstado(waId, estado);
  return { waId, estado };
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
