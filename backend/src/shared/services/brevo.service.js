import { logger } from '../utils/logger.js';
import { yaSeEnvio, registrar } from './email-log.service.js';
import { dejaPasar, porQueSeParo } from './email-freno.service.js';

const BREVO_API_URL = 'https://api.brevo.com/v3';
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || 'no-reply@crm-test.local';
const FROM_NAME = process.env.BREVO_FROM_NAME || 'CRM ISEIE';

// Mientras no exista el modulo `credentials` (encriptacion AES-256 de claves por
// proyecto/global en la base), la clave sale del entorno. Al portar `credentials`
// desde el CRM hermano, devolver aqui la busqueda por base de datos.
function getApiKey() {
  const envKey = process.env.BREVO_API_KEY;
  if (!envKey || envKey === 'test') return null;
  return envKey;
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
 */
async function sendEmail({ to, subject, htmlContent, textContent, tags = [], projectId = null, fromEmail, fromName, attachment, clave = null }) {
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

  const apiKey = getApiKey();
  if (!apiKey) {
    logger.warn({ to, subject }, 'Brevo: sin API key configurada, email no enviado');
    await registrar({ clave, destinatarios, asunto: subject, etiquetas: tags, projectId,
      estado: 'fallido', intentos: 0, error: 'NO_API_KEY' });
    return { sent: false, reason: 'NO_API_KEY' };
  }

  const payload = {
    sender: { email: fromEmail || FROM_EMAIL, name: fromName || FROM_NAME },
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
  return { sent: false, ...ultimoFallo, intentos: hechos };
}

// ============================================================
// TEMPLATES
// ============================================================

export async function sendWelcomeUserEmail({ nombre, email, setPasswordToken, baseUrl }) {
  const link = `${baseUrl}/set-password?token=${encodeURIComponent(setPasswordToken)}`;
  const subject = 'Bienvenido al CRM - Establece tu contrasena';
  const htmlContent = `
    <!DOCTYPE html>
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
      <div style="background: linear-gradient(135deg, #3b82f6, #8b5cf6); padding: 32px; border-radius: 12px; color: white; text-align: center;">
        <h1 style="margin: 0; font-size: 24px;">Bienvenido al CRM</h1>
      </div>
      <div style="background: white; padding: 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p>Hola <strong>${nombre}</strong>,</p>
        <p>Se ha creado tu cuenta en el CRM MultiProyecto. Para empezar, establece tu contrasena haciendo click en el siguiente boton:</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${link}" style="background: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold; display: inline-block;">Establecer contrasena</a>
        </p>
        <p style="font-size: 13px; color: #6b7280;">O copia este enlace en tu navegador:<br><code style="background: #f3f4f6; padding: 4px 8px; border-radius: 4px; word-break: break-all;">${link}</code></p>
        <p style="font-size: 13px; color: #6b7280;">Este enlace expira en 24 horas.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
        <p style="font-size: 12px; color: #9ca3af;">Si no esperabas este email, ignoralo.</p>
      </div>
    </body></html>`;
  const textContent = `Hola ${nombre},\n\nSe ha creado tu cuenta en el CRM. Establece tu contrasena aqui:\n${link}\n\nEste enlace expira en 24 horas.`;

  return await sendEmail({
    to: [{ email, name: nombre }],
    subject,
    htmlContent,
    textContent,
    tags: ['welcome-user', 'crm'],
  });
}

export async function sendLeadAssignedEmail({ gestor, lead, proyecto, baseUrl }) {
  const link = `${baseUrl}/leads/${lead.id}`;
  const subject = `Nuevo lead asignado: ${lead.nombre}`;
  const htmlContent = `
    <!DOCTYPE html>
    <html><body style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #3b82f6;">Nuevo lead asignado</h2>
      <p>Hola <strong>${gestor.nombre}</strong>, te han asignado un nuevo lead.</p>
      <div style="background: #f9fafb; padding: 16px; border-radius: 8px; border-left: 4px solid #3b82f6;">
        <p style="margin: 0 0 8px;"><strong>${lead.nombre}</strong></p>
        <p style="margin: 0 0 4px; font-size: 14px;">${lead.email}</p>
        ${lead.telefono ? `<p style="margin: 0 0 4px; font-size: 14px;">${lead.telefono}</p>` : ''}
        <p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">Proyecto: ${proyecto.nombre}</p>
      </div>
      <p style="text-align: center; margin: 24px 0;">
        <a href="${link}" style="background: #3b82f6; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">Ver lead</a>
      </p>
      <p style="font-size: 12px; color: #9ca3af;">Contactalo lo antes posible para maximizar la conversion.</p>
    </body></html>`;
  const textContent = `Hola ${gestor.nombre},\nNuevo lead asignado:\n${lead.nombre} <${lead.email}>\nProyecto: ${proyecto.nombre}\nVer: ${link}`;

  return await sendEmail({
    to: [{ email: gestor.email, name: gestor.nombre }],
    subject,
    htmlContent,
    textContent,
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
