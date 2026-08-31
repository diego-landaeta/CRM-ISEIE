/**
 * Los mensajes que no son texto ni adjunto: botones, menús, plantillas.
 *
 * Reportado por una gestora: «en el chat con el bot no me aparece nada».
 *
 * No es que no lleguen. Llegan y se guardan —no están en la lista de ruido de
 * protocolo— pero `textoDe` solo sabía leer `conversation`, `extendedTextMessage`
 * y los pies de los adjuntos. Todo lo demás quedaba con el texto a null y tipo
 * «otro», y la burbuja se pintaba vacía. Una conversación con un bot está hecha
 * casi entera de estos tipos, así que salía en blanco de arriba abajo.
 *
 * Y lo peor no era ver el menú del bot, sino lo contrario: `buttonsResponseMessage`
 * y `listResponseMessage` son **lo que el prospecto pulsó**. Sin leerlos, la
 * gestora no puede saber qué contestó — el mensaje existe, ocupa su hueco en el
 * chat, y está vacío.
 *
 * Nada de esto necesita migración: `tipo` es VARCHAR(20) sin CHECK, y estos
 * mensajes se guardan como 'texto' porque eso es lo que son al leerlos. Si se
 * les diera un tipo propio, la pantalla intentaría pintarles un adjunto que no
 * existe.
 */

/** Recorta y limpia, o devuelve null si no queda nada. */
const limpio = (v) => {
  const s = String(v ?? '').trim();
  return s || null;
};

/** Junta trozos saltándose los vacíos. */
const juntar = (...partes) => {
  const hay = partes.map(limpio).filter(Boolean);
  return hay.length ? hay.join('\n') : null;
};

/**
 * Lo que el PROSPECTO pulsó. Va primero porque es lo que más importa: sin esto
 * su respuesta no existe para quien lee el chat.
 */
function respuestaDelProspecto(m) {
  // Un botón.
  const boton = m.buttonsResponseMessage;
  if (boton) return limpio(boton.selectedDisplayText) || limpio(boton.selectedButtonId);

  // Una opción de un menú desplegable.
  const lista = m.listResponseMessage;
  if (lista) {
    return juntar(lista.title, lista.description)
      || limpio(lista.singleSelectReply?.selectedRowId);
  }

  // Un botón de una plantilla de empresa.
  const plantilla = m.templateButtonReplyMessage;
  if (plantilla) return limpio(plantilla.selectedDisplayText) || limpio(plantilla.selectedId);

  // Los botones nuevos, los de los flujos nativos.
  const nativo = m.interactiveResponseMessage;
  if (nativo) {
    return limpio(nativo.body?.text)
      || limpio(nativo.nativeFlowResponseMessage?.name);
  }

  return null;
}

/** Las opciones que ofrece el bot, en líneas, para poder leer de qué iba. */
function opcionesDe(m) {
  const botones = m.buttonsMessage?.buttons;
  if (Array.isArray(botones) && botones.length) {
    return botones.map((b) => `· ${limpio(b.buttonText?.displayText) || limpio(b.buttonId) || ''}`.trimEnd())
      .filter((l) => l !== '·').join('\n') || null;
  }

  const secciones = m.listMessage?.sections;
  if (Array.isArray(secciones) && secciones.length) {
    const filas = secciones.flatMap((s) => s.rows || []);
    return filas.map((f) => `· ${limpio(f.title) || limpio(f.rowId) || ''}`.trimEnd())
      .filter((l) => l !== '·').join('\n') || null;
  }

  const plantilla = m.templateMessage?.hydratedTemplate
    || m.templateMessage?.hydratedFourRowTemplate;
  const deLaPlantilla = plantilla?.hydratedButtons;
  if (Array.isArray(deLaPlantilla) && deLaPlantilla.length) {
    return deLaPlantilla.map((b) => {
      const t = b.quickReplyButton?.displayText
        || b.urlButton?.displayText
        || b.callButton?.displayText;
      return t ? `· ${t}` : null;
    }).filter(Boolean).join('\n') || null;
  }

  return null;
}

/** Lo que manda el BOT: el cuerpo del menú o de la plantilla. */
function mensajeDelBot(m) {
  const botones = m.buttonsMessage;
  if (botones) return juntar(botones.contentText, opcionesDe(m), botones.footerText);

  const lista = m.listMessage;
  if (lista) return juntar(lista.title, lista.description, opcionesDe(m), lista.footerText);

  const plantilla = m.templateMessage?.hydratedTemplate
    || m.templateMessage?.hydratedFourRowTemplate;
  if (plantilla) {
    return juntar(plantilla.hydratedTitleText, plantilla.hydratedContentText,
      opcionesDe(m), plantilla.hydratedFooterText);
  }

  const interactivo = m.interactiveMessage;
  if (interactivo) {
    return juntar(interactivo.header?.title, interactivo.body?.text, interactivo.footer?.text);
  }

  return null;
}

/** Sitios y contactos: tampoco tienen fichero que bajar, y salían igual de vacíos. */
function otrosSinFichero(m) {
  const sitio = m.locationMessage || m.liveLocationMessage;
  if (sitio) {
    const donde = juntar(sitio.name, sitio.address);
    const lat = sitio.degreesLatitude;
    const lon = sitio.degreesLongitude;
    const mapa = (lat != null && lon != null)
      ? `https://www.google.com/maps?q=${lat},${lon}`
      : null;
    return juntar('Ubicación', donde, mapa);
  }

  const contacto = m.contactMessage;
  if (contacto) return juntar('Contacto', contacto.displayName);

  const varios = m.contactsArrayMessage;
  if (varios) {
    const nombres = (varios.contacts || []).map((c) => c.displayName).filter(Boolean);
    return juntar(`Contactos (${nombres.length || 0})`, nombres.join(', '));
  }

  return null;
}

/**
 * El texto legible de un mensaje que no es texto plano ni adjunto.
 * Devuelve null si este mensaje no es de los que sabe leer.
 */
export function textoDeBot(m = {}) {
  if (!m || typeof m !== 'object') return null;
  return respuestaDelProspecto(m) || mensajeDelBot(m) || otrosSinFichero(m);
}

/** ¿Es uno de estos? Sirve para darle tipo 'texto' y que se pinte como tal. */
export function esDeBot(m = {}) {
  return textoDeBot(m) !== null;
}

export const _internos = { respuestaDelProspecto, mensajeDelBot, otrosSinFichero, opcionesDe };
