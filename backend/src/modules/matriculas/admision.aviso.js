import { query } from '../../shared/config/db.js';
import { logger } from '../../shared/utils/logger.js';
import { sendEmail } from '../../shared/services/brevo.service.js';
import { correo, parrafo, boton, nota, esc, enlace } from '../../shared/services/email-plantilla.service.js';

/**
 * EL AVISO DE UNA SOLICITUD DE ADMISIÓN, SIN DATOS (#714).
 *
 * Carlos, 10/11/2026 (protección de datos): las solicitudes de admisión llegaban
 * por correo con el nombre, el DNI, las fotos del DNI por las dos caras y la firma
 * adjuntos. Eso se acaba: la solicitud se guarda SOLO en el CRM (Matrículas), con
 * los documentos detrás de un enlace firmado de 15 minutos y del permiso
 * `matriculas.view`, y el correo solo avisa de que ha llegado una.
 *
 * Lo que lleva el aviso, y por qué no lleva más:
 *   · el campus, el curso que pide y el número de la solicitud, y un botón a su
 *     ficha. Con eso quien lo recibe sabe de qué va y la abre en el CRM.
 *   · NI EL NOMBRE. Un nombre ya es un dato personal, y el correo se queda en
 *     buzones compartidos, se reenvía y se copia en el teléfono. Para saber quién
 *     es basta con abrir la ficha, que pide entrar en el CRM.
 *   · Ni correo, ni teléfono, ni DNI, ni adjuntos. Ni el texto libre del formulario.
 *
 * A quién: las direcciones del propio webhook (`aviso_emails`, en Matrículas →
 * Webhooks), que son las que hoy reciben el correo de Make o de la web
 * (admisiones@…, info@…). Sin ninguna, no se avisa a nadie.
 *
 * Con interruptor, como los demás avisos nuevos: `ADMISION_AVISO_ACTIVO=true` lo
 * enciende. Apagado, el correo se arma y se anota en el registro, pero no sale.
 * Fuera de producción, además, el freno de siempre: solo la lista blanca.
 *
 * Se manda DESPUÉS de contestar al formulario y sin esperar: el webhook tarda
 * siempre lo mismo (ver RESPUESTA_FIJA_MS en admision.service.js) y un aviso que
 * solo sale con las solicitudes nuevas delataría por el tiempo si la persona ya
 * había mandado la suya.
 */

export const avisoActivo = () => {
  const v = String(process.env.ADMISION_AVISO_ACTIVO || '').toLowerCase();
  return v === 'true' || v === '1';
};

/** Las direcciones del webhook, limpias y sin repetir. */
export function destinatarios(lista) {
  const vistos = new Set();
  for (const d of Array.isArray(lista) ? lista : []) {
    const e = String(d || '').trim().toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) vistos.add(e);
  }
  return [...vistos];
}

/** El curso, como texto corto y sin saltos: viene del formulario. */
const cursoCorto = (curso) => {
  const t = String(curso || '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 120) : '';
};

/**
 * El correo, armado. Aparte del envío para probarlo sin Brevo.
 * `marca`: el campus ({ id, nombre, slug, logo_url, emoji }).
 */
export function armarAviso({ marca = {}, matriculaId, curso = null }) {
  const campus = marca?.nombre || 'el campus';
  const c = cursoCorto(curso);
  const titulo = 'Nueva solicitud de admisión';
  const { htmlContent, textContent } = correo({
    proyecto: marca || {},
    titulo,
    resumen: `Ha llegado una solicitud de admisión a ${campus}. Ábrela en el CRM.`,
    bloques: [
      parrafo(`Ha llegado una <strong>solicitud de admisión</strong> a ${esc(campus)}${c ? ` para <strong>${esc(c)}</strong>` : ''}.`),
      nota(`Solicitud nº <strong>${esc(String(matriculaId))}</strong><br>Los datos y los documentos (DNI, firma, título) están solo en el CRM, en Matrículas. Por protección de datos este correo no los lleva.`),
      boton({ texto: 'Abrir la solicitud', url: enlace(`matriculas?matricula=${encodeURIComponent(matriculaId)}`) }),
      // Sin «apagar en Mis preferencias»: quien lo recibe puede ser un buzón sin usuario en el CRM.
      parrafo('<span style="font-size:13px;color:#71717a">Recibes este aviso porque tu dirección está en el webhook de admisión de este campus (Matrículas → Webhooks).</span>'),
    ],
  });
  return { asunto: `${titulo} · ${campus}`, htmlContent, textContent };
}

async function marcaDe(projectId) {
  try {
    const { rows: [p] } = await query('SELECT id, nombre, slug, logo_url, emoji FROM projects WHERE id = $1', [projectId]);
    return p || {};
  } catch (err) {
    logger.warn({ err: err.message, projectId }, 'Aviso de admisión: no se pudo leer la marca del campus');
    return {};
  }
}

/**
 * Avisa de una solicitud nueva. No lanza nunca: un fallo del correo no toca la
 * solicitud, que ya está guardada. Devuelve lo que pasó (para las pruebas).
 */
export async function avisarAdmision({ token, matriculaId, curso = null }) {
  try {
    const para = destinatarios(token?.aviso_emails);
    if (!para.length || !matriculaId) return { enviado: false, motivo: 'SIN_DESTINATARIOS' };
    const marca = await marcaDe(token.project_id);
    const c = armarAviso({ marca, matriculaId, curso });
    if (!avisoActivo()) {
      logger.info({ matriculaId, projectId: token.project_id, para: para.length }, 'Aviso de admisión armado sin enviar (ADMISION_AVISO_ACTIVO apagado)');
      return { enviado: false, motivo: 'APAGADO', correo: c };
    }
    const r = await sendEmail({
      to: para.map((email) => ({ email })),
      subject: c.asunto,
      htmlContent: c.htmlContent,
      textContent: c.textContent,
      tags: ['admision', 'aviso-admision'],
      clave: `admision-aviso-${matriculaId}`,
      projectId: token.project_id,
    });
    return { enviado: !!r?.sent, motivo: r?.reason || null, correo: c };
  } catch (err) {
    logger.warn({ err: err.message, matriculaId }, 'Aviso de admisión: el correo falló (la solicitud sí se guardó)');
    return { enviado: false, motivo: 'ERROR' };
  }
}
