import { logger } from '../utils/logger.js';
import * as plantilla from './email-plantilla.service.js';
import { getDecryptedValue } from '../../modules/credentials/credentials.model.js';
import { query } from '../config/db.js';
import { yaSeEnvio, registrar } from './email-log.service.js';
import { dejaPasar, porQueSeParo } from './email-freno.service.js';
import { marcaDeLaPersona as marcaDeLaPersonaComun, remitenteDe } from './marca.service.js';

const BREVO_API_URL = 'https://api.brevo.com/v3';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'no-reply@crm-test.local';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'CRM ISEIE';

/** La cuenta del CRM: la clave global de la base y, si no hay, la del .env. */
async function getApiKey() {
  try {
    const fromDb = await getDecryptedValue('brevo', null);
    if (fromDb) return fromDb;
  } catch (err) {
    logger.warn({ err: err.message }, 'Brevo: error leyendo credencial DB');
  }
  const envKey = process.env.BREVO_API_KEY;
  if (!envKey || envKey === 'test') return null;
  return envKey;
}

/**
 * La cuenta de Brevo de la MARCA, si la tiene (como en MultiCRM, 28/09).
 *
 * Cada marca puede guardar la suya en «Configuración → Marca» —cifrada, en la
 * base: se cambia desde el panel sin tocar codigo ni servidor— junto a su «no
 * contestar». Con las dos, sus correos salen por su cuenta y con su remitente.
 * Una cuenta de marca solo sirve con un remitente de la marca: sin remitente,
 * nada (y el correo sale por la del CRM, como siempre).
 */
async function cuentaDeLaMarca(projectId, fromEmail) {
  if (!projectId) return null;
  try {
    const apiKey = await getDecryptedValue('brevo', projectId);
    if (!apiKey) return null;
    // to_jsonb: la columna es de la migracion 168; sin ella, null y no rompe.
    const { rows } = await query(
      "SELECT to_jsonb(p) ->> 'remitente_no_contestar' AS r, p.nombre FROM projects p WHERE p.id = $1", [projectId]);
    const remitente = fromEmail || rows[0]?.r || null;
    // El nombre de la marca, para el remitente (12/10, igual que MultiCRM).
    return remitente ? { apiKey, remitente, nombre: rows[0]?.nombre || null } : null;
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Brevo: error leyendo la cuenta de la marca');
    return null;
  }
}

// Cuantas veces se intenta y cuanto se espera entre intentos. Tres intentos con
// esperas de 1 s y 3 s cubren el caso normal —un corte de red, un 502 de paso—
// sin dejar colgada la peticion que lo llamo.
const INTENTOS = 3;
const ESPERAS_MS = [1000, 3000];

// Un 4xx no se reintenta: significa que el correo esta mal (direccion invalida,
// remitente sin verificar, plantilla rota). Reintentarlo es perder el tiempo y
// gastar cuota. Solo se reintenta lo que puede arreglarse solo: 5xx, 429 y los
// fallos de red.
const merecePenaReintentar = (estado) => estado === null || estado === 429 || estado >= 500;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Manda un correo por Brevo.
 *
 * Un parametro opcional que no existia antes:
 *   · clave  — de idempotencia. Si ya salio un correo con esa clave, NO se manda
 *              otro. Es lo que evita lo del vigilante del catalogo, que mando el
 *              mismo aviso cinco veces en una tarde porque cada reinicio del
 *              proceso lo disparaba de nuevo.
 *
 * Es el UNICO parametro nuevo: el «de donde sale» ya lo dicen las `tags` que
 * todos los llamadores pasan ya, y se guardan tal cual.
 *
 * Quien no la pase se comporta exactamente igual que antes, salvo que ahora
 * queda anotado el intento.
 *
 *   · cuenta — 'crm' obliga a salir por la cuenta del CRM aunque la marca
 *              tenga la suya. Sin nada: la de la marca si la tiene
 *              (`cuentaDeLaMarca`), la del CRM si no.
 */
async function sendEmail({ to, subject, htmlContent, textContent, tags = [], projectId = null, fromEmail, fromName, attachment, clave = null, cuenta = null }) {
  // `to` llega de cuatro formas: cadena, objeto, lista de objetos, y una cadena
  // con varios correos separados por comas (los avisos a administradores).
  const destinatarios = Array.isArray(to)
    ? to.map((d) => d?.email || d).filter(Boolean).join(',')
    : (to?.email || to || '');

  // EL FRENO, antes que nada.
  //
  // Fuera de produccion no sale ni un correo a un cliente real. Va lo primero a
  // proposito: comprobar la clave o pedir la API key antes seria trabajo para
  // algo que no se va a mandar, y sobre todo, cualquier cosa que se añada
  // despues nace ya frenada sin que nadie se acuerde.
  const freno = dejaPasar(destinatarios);
  if (!freno.pasa) {
    const porque = porQueSeParo(freno.motivo, freno.bloqueados);
    logger.warn({ to: destinatarios, subject, motivo: freno.motivo }, `Brevo: ${porque}`);
    // Se anota como `bloqueado`, NO como `fallido`: no es que Brevo lo
    // rechazara, es que aqui se decidio no mandarlo. Confundirlos haria que el
    // registro de fallos pareciera roto en cada entorno de pruebas.
    await registrar({
      clave, destinatarios, asunto: subject, etiquetas: tags, projectId,
      estado: 'bloqueado', intentos: 0, error: porque,
    });
    return { sent: false, reason: 'FRENO_DE_PRUEBAS', motivo: freno.motivo, detalle: porque };
  }

  // Si ya salio, no se vuelve a mandar.
  if (await yaSeEnvio(clave)) {
    logger.info({ clave, to: destinatarios, subject }, 'Brevo: ya se envio antes, no se repite');
    return { sent: false, reason: 'YA_ENVIADO', repetido: true };
  }

  // ¿Por que cuenta de Brevo? La de la marca, si la tiene; entonces tambien su
  // remitente, si quien llama no puso otro.
  const marca = cuenta === 'crm' ? null : await cuentaDeLaMarca(projectId, fromEmail);
  const remitente = marca?.remitente || fromEmail || FROM_EMAIL;
  // Sale por la cuenta de la marca: con su nombre, si quien llama no puso otro (12/10).
  if (marca && !fromName && marca.nombre) fromName = marca.nombre;
  const apiKey = marca?.apiKey || await getApiKey();
  if (!apiKey) {
    logger.warn({ to, subject }, 'Brevo: sin API key configurada, email no enviado');
    await registrar({ clave, destinatarios, asunto: subject, etiquetas: tags, projectId,
      estado: 'fallido', intentos: 0, error: 'NO_API_KEY' });
    return { sent: false, reason: 'NO_API_KEY' };
  }

  const payload = {
    sender: { email: remitente, name: fromName || FROM_NAME },
    to: Array.isArray(to) ? to : [{ email: to.email || to, name: to.name }],
    subject,
    htmlContent,
    textContent,
  };
  // Las etiquetas solo si las hay. Mandar la lista vacia hace que Brevo
  // conteste «400 · tags is blank» y NO envie el correo — y como casi ninguna
  // llamada pasa etiquetas, eso era todos los correos del CRM.
  if (Array.isArray(tags) && tags.length > 0) {
    payload.tags = tags;
  }
  // Brevo acepta `attachment: [{ name, content }]` con content en base64.
  // PDFs de facturas/certs estan muy por debajo del limite de 10MB.
  if (Array.isArray(attachment) && attachment.length > 0) {
    payload.attachment = attachment;
  }

  let ultimoFallo = { reason: 'DESCONOCIDO', details: null };
  // Los intentos que se hicieron DE VERDAD, no el tope. Un 4xx corta a la
  // primera, y anotar un 3 ahi haria creer que Brevo estuvo fallando.
  let hechos = 0;

  for (let intento = 1; intento <= INTENTOS; intento++) {
    hechos = intento;
    let estadoHttp = null;
    try {
      const res = await fetch(`${BREVO_API_URL}/smtp/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': apiKey,
          'accept': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      estadoHttp = res.status;

      if (res.ok) {
        const data = await res.json();
        logger.info({ messageId: data.messageId, to, subject, intento }, 'Brevo email enviado');
        await registrar({ clave, destinatarios, asunto: subject, etiquetas: tags, projectId,
          estado: 'enviado', intentos: intento, brevoMsgId: data.messageId });
        return { sent: true, messageId: data.messageId, intentos: intento };
      }

      const err = await res.text();
      ultimoFallo = { reason: `HTTP_${res.status}`, details: err };
      logger.error({ status: res.status, err, to, subject, intento }, 'Brevo error');
    } catch (err) {
      ultimoFallo = { reason: 'FETCH_ERROR', details: err.message };
      logger.error({ err: err.message, to, subject, intento }, 'Brevo fetch error');
    }

    // Un fallo permanente no mejora esperando: se corta aqui.
    if (!merecePenaReintentar(estadoHttp)) break;
    if (intento < INTENTOS) await esperar(ESPERAS_MS[intento - 1] ?? 3000);
  }

  // Que no salio ya no se queda solo en el log: queda escrito.
  await registrar({ clave, destinatarios, asunto: subject, etiquetas: tags, projectId,
    estado: 'fallido', intentos: hechos, error: `${ultimoFallo.reason} · ${ultimoFallo.details ?? ''}` });
  // Con un remitente que no es el del CRM —el de la marca—, una vez mas por la
  // cuenta del CRM y con su remitente: que llegue es mejor que no llegue.
  if (cuenta !== 'crm' && remitente !== FROM_EMAIL) {
    logger.warn({ remitente, to: destinatarios, subject, fallo: ultimoFallo.reason },
      'Brevo: no salio con el remitente de la marca; se intenta por la cuenta del CRM');
    const otra = await sendEmail({ to, subject, htmlContent, textContent, tags, projectId,
      fromEmail: undefined, fromName, attachment, clave, cuenta: 'crm' });
    return { ...otra, primerFallo: ultimoFallo.reason };
  }
  return { sent: false, ...ultimoFallo, intentos: hechos };
}

// ============================================================
// TEMPLATES
// ============================================================

/**
 * La marca con la que le llega un correo a una persona del equipo: la de sus
 * campus (`marca.service.js`). Un campus, el suyo; varios de una empresa, la
 * EMPRESA («CEDIA»), y no el primero de ellos con remitente —que en CEDIA era
 * Fono Aprende y le daba la bienvenida «al CRM de Fono Aprende» a quien trabaja
 * para los ocho (11/11)—; empresas mezcladas o ninguna, la del CRM.
 */
async function marcaDeLaPersona(email) {
  try {
    return await marcaDeLaPersonaComun({ email });
  } catch {
    return null;
  }
}

// Bienvenida con la plantilla común y la marca de su campus (Diego, 10/10:
// «cada correo con un formato completo y lindo, y con el branding»).
export async function sendWelcomeUserEmail({ nombre, email, setPasswordToken, baseUrl }) {
  const P = plantilla;
  const link = `${baseUrl}/set-password?token=${encodeURIComponent(setPasswordToken)}`;
  const marca = await marcaDeLaPersona(email);
  const subject = `Bienvenida al CRM${marca ? ` de ${marca.nombre}` : ''}: crea tu contraseña`;
  const { htmlContent, textContent } = P.correo({
    proyecto: marca || MARCA_CORREOS,
    titulo: 'Te damos la bienvenida al CRM',
    saludo: nombre,
    resumen: 'Crea tu contraseña para entrar',
    bloques: [
      P.parrafo('Ya tienes cuenta en el CRM. Para entrar, crea tu contraseña:'),
      P.boton({ texto: 'Crear mi contraseña', url: link }),
      P.nota(`Entrarás con <strong>${P.esc(email)}</strong>. El enlace caduca en 24 horas.`),
      letraPequena('Si no esperabas este correo, ignóralo: sin contraseña nadie puede entrar con tu cuenta.'),
    ],
  });
  return await sendEmail({
    to: [{ email, name: nombre }],
    subject,
    htmlContent,
    textContent,
    // La cuenta y el nombre del remitente, los de la marca: con la de una
    // empresa, la cuenta del CRM y «CEDIA» como nombre.
    ...remitenteDe(marca),
    tags: ['welcome-user', 'crm'],
  });
}

/**
 * Aviso a la dirección VIEJA de que el correo con el que se entra al CRM ha
 * cambiado (#246). Si no lo pidió la persona, es como se entera; y si sí, sabe
 * con cuál entrar a partir de ahora. Los tutores no lo reciben mientras siga el
 * freno (`NO_ESCRIBIR_A_TUTORES`): eso lo decide quien llama.
 */
/*
  LOS CORREOS DEL MCP DE CLAUDE Y EL DEL CAMBIO DE CORREO, CON LA PLANTILLA COMÚN
  (Diego, 07/10: «que se vean bonitos»). La misma cabecera con la marca y la
  fecha, el mismo botón, la nota y el pie que el resto de avisos del CRM, y su
  modo oscuro. Todo lo que viene de la base va escapado: un nombre o un
  User-Agent con «<» no puede romper el correo ni meter HTML.
*/
const MARCA_CORREOS = { nombre: 'ISEIE', slug: 'iseie' };
const zonaCorreos = () => process.env.APP_TIMEZONE || 'Europe/Madrid';
const fechaHoraCorreo = (d) => new Date(d).toLocaleString('es-ES', {
  timeZone: zonaCorreos(), day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
});
const fechaCorreo = (d) => new Date(d).toLocaleDateString('es-ES', { timeZone: zonaCorreos(), day: 'numeric', month: 'long' });
/**
 * «hora de Madrid», para poner junto a las horas (Diego, 13/10): la alerta de
 * madrugada decía «a las 02:20» sin decir de dónde, y quien la lee puede estar
 * en otro país. Con otra APP_TIMEZONE, su ciudad («America/Bogota» → «hora de
 * Bogota»); sin ciudad («UTC»), «hora UTC».
 */
const zonaDeLasHoras = () => {
  const zona = zonaCorreos();
  if (!zona.includes('/')) return `hora ${zona}`;
  return `hora de ${zona.split('/').pop().replace(/_/g, ' ')}`;
};
const letraPequena = (texto) => plantilla.parrafo(
  `<span style="font-size:13px;line-height:20px;color:#71717a">${plantilla.esc(texto)}</span>`);

export async function sendCorreoCambiadoEmail({ nombre, de, a }) {
  const P = plantilla;
  const subject = 'Ha cambiado el correo con el que entras al CRM';
  const { htmlContent, textContent } = P.correo({
    proyecto: MARCA_CORREOS,
    titulo: 'Ha cambiado tu correo de acceso',
    saludo: nombre,
    resumen: `A partir de ahora entras con ${a}`,
    bloques: [
      P.parrafo(`Un administrador ha cambiado el correo con el que entras al CRM (${P.esc(fechaHoraCorreo(new Date()))}):`),
      P.nota(`${P.esc(de)} → <strong>${P.esc(a)}</strong>`),
      P.parrafo(`A partir de ahora entra con <strong>${P.esc(a)}</strong>. Con esta dirección ya no podrás, y tendrás que volver a iniciar sesión.`),
      P.boton({ texto: 'Entrar al CRM', url: P.enlace('login') }),
      letraPequena('Si no esperabas este cambio, avisa a tu responsable cuanto antes.'),
    ],
  });
  return await sendEmail({ to: [{ email: de, name: nombre }], subject, htmlContent, textContent, tags: ['correo-cambiado', 'crm'] });
}

// Con la plantilla común y la marca del campus del prospecto (Diego, 10/10).
export async function sendLeadAssignedEmail({ gestor, lead, proyecto, baseUrl }) {
  const P = plantilla;
  const link = `${baseUrl}/leads/${lead.id}`;
  const subject = `Nuevo prospecto asignado: ${lead.nombre}`;
  const datos = [lead.email, lead.telefono].filter(Boolean).map((d) => P.esc(d)).join('<br>');
  const { htmlContent, textContent } = P.correo({
    proyecto: proyecto || MARCA_CORREOS,
    titulo: 'Te han asignado un prospecto',
    saludo: gestor.nombre,
    resumen: `${lead.nombre}${proyecto?.nombre ? ` · ${proyecto.nombre}` : ''}`,
    bloques: [
      P.nota(`<strong>${P.esc(lead.nombre)}</strong>${datos ? `<br>${datos}` : ''}${proyecto?.nombre ? `<br><span style="color:#71717a">${P.esc(proyecto.nombre)}</span>` : ''}`),
      P.boton({ texto: 'Ver el prospecto', url: link }),
      letraPequena('Cuanto antes lo contactes, más fácil es que se matricule.'),
    ],
  });
  return await sendEmail({
    to: [{ email: gestor.email, name: gestor.nombre }],
    subject,
    htmlContent,
    textContent,
    projectId: proyecto?.id ?? null,
    tags: ['lead-assigned', 'crm'],
  });
}

export async function sendTestEmail(apiKey, toEmail) {
  // Para test manual de credencial
  try {
    const res = await fetch(`${BREVO_API_URL}/account`, {
      method: 'GET',
      headers: { 'api-key': apiKey, 'accept': 'application/json' },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    return { ok: true, account: data.email };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { sendEmail };

/**
 * MCP de Claude (#192): una conexión se ha bloqueado por fallar el código de
 * desbloqueo. Va al dueño de la conexión y a quien vigila (MCP_AVISO_EMAIL o
 * los super admin). Puede ser un despiste o alguien probando códigos con una
 * URL que no es suya: el correo lo dice para que lo mire quien sabe.
 */
export async function sendMcpBloqueoEmail({ para, persona, hasta, maxFallos }) {
  const P = plantilla;
  const conexion = `${persona.conexion} (${persona.prefijo}…)`;
  const subject = `MCP de Claude bloqueado: ${persona.nombre}`;
  const { htmlContent, textContent } = P.correo({
    proyecto: MARCA_CORREOS,
    titulo: 'Conexión de Claude bloqueada',
    resumen: `${persona.nombre} falló el código ${maxFallos} veces seguidas`,
    bloques: [
      P.parrafo(`La conexión <strong>${P.esc(conexion)}</strong> de <strong>${P.esc(persona.nombre)}</strong> ha fallado el código de desbloqueo <strong>${P.esc(maxFallos)} veces seguidas</strong>.`),
      P.nota(`Queda bloqueada hasta el <strong>${P.esc(fechaHoraCorreo(hasta))}</strong> (${P.esc(zonaDeLasHoras())}): hasta entonces no da datos ni acepta códigos.`),
      P.parrafo('Puede ser un despiste. Si no has sido tú, revoca esa URL: alguien podría tenerla.'),
      P.boton({ texto: 'Ir a Conexión → MCP', url: P.enlace('conexion/mcp') }),
    ],
  });
  return await sendEmail({ to: para, subject, htmlContent, textContent, tags: ['mcp-bloqueo', 'crm'] });
}

/**
 * MCP de Claude (#194): sus URLs van a caducar pronto. Un correo por persona,
 * con todas las que le caducan, y el enlace a la pantalla para sacar otra.
 */
export async function sendMcpCaducidadEmail({ persona, urls, enlace }) {
  const P = plantilla;
  const una = urls.length === 1;
  const subject = una ? 'Tu URL de Claude para el CRM caduca pronto' : `${urls.length} URLs de Claude para el CRM caducan pronto`;
  const fila = (u) => `<li style="margin:0 0 8px"><strong>${P.esc(u.nombre)}</strong>`
    + ` <span style="color:#71717a">(${P.esc(u.prefijo)}…)</span><br>`
    + `caduca el <strong>${P.esc(fechaCorreo(u.expires_at))}</strong>`
    + `${u.conexion ? ` · conexión «${P.esc(u.conexion)}»` : ''}</li>`;
  const { htmlContent, textContent } = P.correo({
    proyecto: MARCA_CORREOS,
    titulo: una ? 'Tu URL de Claude caduca pronto' : 'Tus URLs de Claude caducan pronto',
    saludo: persona.nombre,
    resumen: una ? `Caduca el ${fechaCorreo(urls[0].expires_at)}` : `${urls.length} URLs caducan pronto`,
    bloques: [
      P.parrafo(una ? 'Esta URL, con la que Claude consulta el CRM, va a caducar:' : 'Estas URLs, con las que Claude consulta el CRM, van a caducar:'),
      P.nota(`<ul style="margin:0;padding-left:18px">${urls.map(fila).join('')}</ul>`),
      P.parrafo('Cuando caduque, Claude dejará de poder consultar. Para seguir, saca una nueva con el botón <strong>«URL nueva»</strong> de su conexión y cámbiala en tu Claude, en Configuración → Conectores.'),
      P.boton({ texto: 'Ir a Conexión → MCP', url: enlace || P.enlace('conexion/mcp') }),
      letraPequena('Si ya no la usas, no hace falta hacer nada: se apagará sola.'),
    ],
  });
  return await sendEmail({ to: [{ email: persona.email, name: persona.nombre }], subject, htmlContent, textContent, tags: ['mcp-caducidad', 'crm'] });
}

/**
 * «8 consultas, 0 con datos (todas bloqueadas por el código)» (Diego, 13/10).
 * La alerta de madrugada solo decía «N consultas», y no es lo mismo que Claude
 * se llevara datos a que el código lo parara todo. Una alerta sin el desglose
 * (de antes del cambio) se queda en «N consultas».
 */
function consultasDeMadrugada(d) {
  const n = Number(d.consultas) || 0;
  const consultas = `${n} consulta${n === 1 ? '' : 's'}`;
  if (d.con_datos === undefined || d.con_datos === null) return consultas;
  const datos = Number(d.con_datos) || 0;
  const bloqueadas = Number(d.bloqueadas) || 0;
  const desbloqueos = Number(d.desbloqueos) || 0;
  const sin = n - datos;
  if (sin <= 0) return n === 1 ? `${consultas}, con datos` : `${consultas}, todas con datos`;
  const base = `${consultas}, ${datos} con datos`;
  if (bloqueadas === sin) {
    if (datos === 0) return `${base} (${n === 1 ? 'bloqueada' : 'todas bloqueadas'} por el código)`;
    return `${base} (${sin === 1 ? 'la otra, bloqueada' : `las otras ${sin}, bloqueadas`} por el código)`;
  }
  const resto = [];
  if (bloqueadas) resto.push(`${bloqueadas} bloqueada${bloqueadas === 1 ? '' : 's'} por el código`);
  if (desbloqueos) resto.push(`${desbloqueos} para desbloquear`);
  const otras = sin - bloqueadas - desbloqueos;
  if (otras > 0) resto.push(`${otras} con otro error`);
  return `${base} (${resto.join(', ')})`;
}

/**
 * MCP de Claude (#195): las alertas de una vuelta, todas en un correo, para
 * quien vigila (MCP_AVISO_EMAIL o los super admin). También la de URL
 * compartida (Diego, 13/10), que sale sola y en el momento.
 */
export async function sendMcpAlertasEmail({ para, alertas, enlace }) {
  const P = plantilla;
  const hora = (d) => new Date(d).toLocaleString('es-ES', { timeZone: zonaCorreos(), day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  // Diego, 13/10: cada hora, con su zona («hora de Madrid»).
  const zona = P.esc(zonaDeLasHoras());
  const TITULOS = {
    rafaga: 'Ráfaga de consultas', ip_nueva: 'Red nueva', cliente_nuevo: 'Cliente nuevo',
    fallos_desbloqueo: 'Fallos de desbloqueo', madrugada: 'De madrugada', url_compartida: 'URL compartida',
  };
  const texto = (a) => {
    const quien = `<strong>${P.esc(a.persona.nombre)}</strong>${a.persona.email ? ` (${P.esc(a.persona.email)})` : ''}`;
    const d = a.detalle || {};
    switch (a.tipo) {
      case 'rafaga': return `${quien} hizo ${P.esc(d.consultas)} consultas en ${P.esc(d.minutos)} minutos (hasta las ${P.esc(hora(d.hasta))}, ${zona}).`;
      case 'ip_nueva': return `${quien} consultó desde ${P.esc(d.red)} (${P.esc((d.ips || []).join(', '))}), desde donde no lo había hecho antes.`;
      case 'cliente_nuevo': return `${quien} consultó con «${P.esc(d.cliente)}», que no había usado antes.`;
      case 'fallos_desbloqueo': return `${quien} falló el código ${P.esc(d.fallos)} veces en la última hora.`;
      case 'madrugada': return `${quien} hizo ${P.esc(consultasDeMadrugada(d))}, entre las ${P.esc(hora(d.primera))} y las ${P.esc(hora(d.ultima))} (${zona}; franja ${P.esc(d.franja)}).`;
      case 'url_compartida': {
        const url = d.conexion ? `<strong>${P.esc(d.conexion)}</strong>${d.prefijo ? ` (${P.esc(d.prefijo)}…)` : ''}` : 'la URL del MCP';
        const otra = `<strong>${P.esc(d.usada_por)}</strong>${d.usada_por_email ? ` (${P.esc(d.usada_por_email)})` : ''}`;
        return `La URL ${url} de ${quien} la está usando ${otra}: a las ${P.esc(hora(d.cuando))} (${zona}) probó en ella un código de desbloqueo suyo. `
          + 'No vale (un código solo sirve con la URL de quien lo sacó) y no cuenta como fallo. A su Claude se le ha dicho que use su propia URL.';
      }
      default: return quien;
    }
  };
  const subject = alertas.length === 1 ? 'Alerta del MCP de Claude' : `${alertas.length} alertas del MCP de Claude`;
  const { htmlContent, textContent } = P.correo({
    proyecto: MARCA_CORREOS,
    titulo: subject,
    resumen: alertas.map((a) => TITULOS[a.tipo] || a.tipo).join(' · '),
    bloques: [
      P.parrafo('Claude ha consultado el CRM de una forma que conviene mirar:'),
      ...alertas.map((a) => P.nota(`<strong>${P.esc(TITULOS[a.tipo] || a.tipo)}</strong><br>${texto(a)}`)),
      P.parrafo('El detalle de cada consulta está en la pestaña Actividad. Si algo no es de quien dice ser, revoca su URL en esa misma pantalla.'),
      P.boton({ texto: 'Ver la actividad', url: enlace || P.enlace('conexion/mcp') }),
    ],
  });
  return await sendEmail({ to: para, subject, htmlContent, textContent, tags: ['mcp-alertas', 'crm'] });
}

/**
 * Aviso de ticket nuevo (#38).
 *
 * VA A DONDE DIGA `SOPORTE_EMAIL`, Y SI ESTA VACIA NO SE MANDA NADA.
 *
 * El ticket pide avisar «al correo de destino» sin decir cual. Inventarse una
 * direccion es peor que no mandar: el aviso se daria por hecho y no llegaria a
 * nadie. Vacia, la funcion dice por que no salio y el ticket queda guardado
 * igual — que es lo que de verdad importaba, porque antes no se guardaba en
 * ningun sitio.
 */
export async function sendTicketNuevoEmail({ ticket, autor }) {
  const destino = String(process.env.SOPORTE_EMAIL || '').trim();
  if (!destino) return { sent: false, reason: 'SIN_SOPORTE_EMAIL' };

  const base = (process.env.CRM_BASE_URL || 'http://localhost:5173/crm').replace(/\/+$/, '');
  const link = `${base}/soporte`;
  const GRAVEDAD = { low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Critica' };
  const CLASE = { bug: 'Averia', feature: 'Mejora', question: 'Duda' };

  // Todo lo que escribe quien abre el ticket entra ESCAPADO: es texto libre y
  // llega a un buzon interno. Sin esto, un titulo con HTML pone enlaces o
  // contenido ajeno dentro de un correo en el que el equipo confia.
  const e = plantilla.esc;
  const saltos = (v) => String(e(v)).split('\n').join('<br>');
  const campo = (rotulo, valor) => (valor
    ? `<p style="margin:10px 0"><strong>${rotulo}</strong><br>${saltos(valor)}</p>`
    : '');

  const subject = `[${CLASE[ticket.kind] || ticket.kind} · ${GRAVEDAD[ticket.severity] || ticket.severity}] ${ticket.title}`;
  const htmlContent = `
    <!DOCTYPE html>
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color:#1f2937; max-width:640px; margin:0 auto; padding:24px;">
      <p style="margin:0 0 4px; font-size:12px; color:#6b7280;">
        ${CLASE[ticket.kind] || ticket.kind} · ${GRAVEDAD[ticket.severity] || ticket.severity}${ticket.projectName ? ` · ${e(ticket.projectName)}` : ''}
      </p>
      <h2 style="margin:0 0 12px; font-size:19px;">${e(ticket.title)}</h2>
      <p style="font-size:13px; color:#6b7280; margin:0 0 16px;">
        Lo abre <strong>${e(autor?.nombre || autor?.email || 'alguien del equipo')}</strong>.
      </p>
      ${campo('Que pasa', ticket.description)}
      ${campo('Pasos para reproducirlo', ticket.steps)}
      ${campo('Que deberia pasar', ticket.expected)}
      ${campo('Que pasa en su lugar', ticket.actual)}
      ${campo('Por que importa', ticket.whyItMatters)}
      ${ticket.url ? `<p style="margin:10px 0; font-size:13px;"><strong>Donde</strong><br><code style="background:#f3f4f6; padding:3px 6px; border-radius:4px; word-break:break-all;">${e(ticket.url)}</code></p>` : ''}
      <p style="text-align:center; margin:28px 0;">
        <a href="${link}" style="background:#3b82f6; color:#fff; padding:11px 22px; border-radius:8px; text-decoration:none; font-weight:bold; display:inline-block;">Abrir en el CRM</a>
      </p>
      <p style="font-size:12px; color:#9ca3af;">Ticket #${ticket.id} · responde desde el CRM, no a este correo.</p>
    </body></html>`;

  const textContent = [
    subject,
    '',
    `Lo abre ${autor?.nombre || 'alguien del equipo'}.`,
    '',
    ticket.description || '',
    ticket.steps ? `Pasos:\n${ticket.steps}` : '',
    ticket.url ? `Donde: ${ticket.url}` : '',
    '',
    `Abrir en el CRM: ${link}`,
  ].filter(Boolean).join('\n');

  return await sendEmail({
    to: [{ email: destino }],
    subject,
    htmlContent,
    textContent,
    tags: ['soporte', 'crm'],
  });
}

/**
 * El correo de «he olvidado la contraseña» (#37).
 *
 * Lleva al MISMO sitio que el del alta —`/set-password?token=`—, porque es el
 * mismo camino. Lo que cambia es el texto: a quien recupera no se le da la
 * bienvenida, y sobre todo se le dice que hacer si NO ha sido el, que es la
 * unica señal que tiene alguien de que le estan intentando entrar.
 */
export async function sendPasswordResetEmail({ nombre, email, setPasswordToken, baseUrl }) {
  const P = plantilla;
  const link = `${baseUrl}/set-password?token=${encodeURIComponent(setPasswordToken)}`;
  const { htmlContent, textContent } = P.correo({
    proyecto: MARCA_CORREOS,
    titulo: 'Recuperar contraseña',
    saludo: nombre,
    resumen: 'Pon una contraseña nueva para entrar al CRM',
    bloques: [
      P.parrafo('Has pedido recuperar tu contraseña del CRM. Pon una nueva desde aquí:'),
      P.boton({ texto: 'Poner una contraseña nueva', url: link }),
      P.nota('El enlace caduca en 24 horas y solo sirve una vez.'),
      letraPequena('Si no has sido tú, ignora este correo: tu contraseña sigue como estaba y el enlace caduca solo. Si se repite, avisa a quien administra el CRM.'),
    ],
  });
  return await sendEmail({
    to: [{ email, name: nombre }],
    subject: 'Recuperar tu contraseña del CRM',
    htmlContent,
    textContent,
    tags: ['password-reset', 'crm'],
  });
}
