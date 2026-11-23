import * as P from '../../shared/services/email-plantilla.service.js';

/*
  Matrícula automática en Moodle (#455) · el correo de bienvenida al alumno.

  Los datos de acceso los manda el CRM, no Moodle (Diego, 23/11): con la plantilla
  común y la marca de SU campus, como el resto de correos al alumno, y por
  `sendEmail` con el `projectId` (cuenta y remitente de la marca, y el freno de los
  entornos de pruebas).

  Dos correos:
    · alumno NUEVO: el botón para poner su contraseña (el enlace de un solo uso que
      da el plugin, 7 días), la dirección del campus y sus cursos.
    · alumno que YA tenía cuenta: sus cursos nuevos, el acceso al campus y
      «¿Has olvidado tu contraseña?». Solo con MATRICULA_MOODLE_CORREO_EXISTENTES.

  Ningún texto dice «CRM»: el alumno no sabe qué es (por eso el pie propio).
*/

const primerNombre = (n) => String(n || '').trim().split(/\s+/)[0] || null;

const marcaDe = (p) => (p ? { id: p.id, nombre: p.nombre, slug: p.slug, logo_url: p.logo_url, emoji: p.emoji } : {});

const nombreDelCurso = (c) => c.curso_nombre || 'Tu curso';

/** «7 de diciembre», en la hora de Madrid. */
const fmtDia = (d) => new Date(d).toLocaleDateString('es-ES', {
  day: 'numeric', month: 'long', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
});

/** La lista de cursos, cada uno con su enlace al curso en el campus. */
function listaDeCursos(cursos, campusUrl) {
  const T = P.T;
  const filas = cursos.map((c) => {
    const url = `${campusUrl}/course/view.php?id=${encodeURIComponent(c.curso_moodle_id)}`;
    return `<tr><td class="txt" style="font-family:${T.fuente};font-size:14px;line-height:22px;color:${T.texto};
               padding:8px 12px;border-bottom:1px solid ${T.borde}">
      <a class="enlace" href="${P.esc(url)}" style="color:${T.primario};text-decoration:none;font-weight:600">${P.esc(nombreDelCurso(c))}</a>
    </td></tr>`;
  }).join('');
  return `<table cellpadding="0" cellspacing="0" border="0" width="100%"
    style="border:1px solid ${T.borde};border-radius:${T.radio.md};border-collapse:separate;margin:0 0 16px">${filas}</table>`;
}

const pie = (campus) => `Has recibido este correo porque te has matriculado en
  <strong class="txt" style="color:${P.T.texto}">${P.esc(campus || 'el campus')}</strong>.
  Si no has sido tú, contesta a este correo.`;

/**
 * El correo del alumno NUEVO.
 * `cursos`: los que se acaban de matricular (o ya estaban), con `curso_nombre`.
 */
export function armarNuevo({ alumno, proyecto, campusUrl, cursos, enlace, caduca = null }) {
  const campus = proyecto?.nombre || 'el campus';
  const hasta = caduca || new Date(Date.now() + 7 * 24 * 3600 * 1000);
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(proyecto),
    titulo: 'Tu acceso al campus ya está listo',
    saludo: primerNombre(alumno),
    resumen: `Tu cuenta en el campus de ${campus} ya está creada. Pon tu contraseña para entrar.`,
    pie: pie(proyecto?.nombre),
    bloques: [
      P.parrafo(`¡Te damos la bienvenida! Ya tienes tu cuenta en el campus virtual de <strong>${P.esc(campus)}</strong> `
        + `y acceso a ${cursos.length > 1 ? 'estos cursos' : 'este curso'}:`),
      listaDeCursos(cursos, campusUrl),
      P.parrafo('Para entrar por primera vez, elige tu contraseña:'),
      P.boton({ texto: 'Poner mi contraseña', url: enlace }),
      P.nota(`El enlace es personal y sirve una sola vez, hasta el <strong>${P.esc(fmtDia(hasta))}</strong>. `
        + 'Después de poner tu contraseña, entrarás directamente a tus cursos.'),
      P.parrafo(`La próxima vez, entra en <a class="enlace" href="${P.esc(`${campusUrl}/login/index.php`)}" `
        + `style="color:${P.T.primario};text-decoration:none">${P.esc(campusUrl.replace(/^https?:\/\//, ''))}</a> `
        + 'con tu correo y la contraseña que elijas.'),
    ],
  });
  return { asunto: `${proyecto?.nombre ? `${proyecto.nombre} · ` : ''}tu acceso al campus`, htmlContent, textContent };
}

/** El correo de quien YA tenía cuenta: sus cursos nuevos y cómo entrar. */
export function armarExistente({ alumno, proyecto, campusUrl, cursos }) {
  const campus = proyecto?.nombre || 'el campus';
  const { htmlContent, textContent } = P.correo({
    proyecto: marcaDe(proyecto),
    titulo: cursos.length > 1 ? 'Tienes cursos nuevos en el campus' : 'Tienes un curso nuevo en el campus',
    saludo: primerNombre(alumno),
    resumen: `Ya tienes acceso a ${cursos.length > 1 ? 'tus cursos nuevos' : 'tu curso nuevo'} en ${campus}.`,
    pie: pie(proyecto?.nombre),
    bloques: [
      P.parrafo(`Ya tienes acceso a ${cursos.length > 1 ? 'estos cursos' : 'este curso'} del campus virtual de `
        + `<strong>${P.esc(campus)}</strong>:`),
      listaDeCursos(cursos, campusUrl),
      P.parrafo('Entra con tu cuenta de siempre: tu correo y tu contraseña.'),
      P.boton({ texto: 'Entrar al campus', url: `${campusUrl}/login/index.php` }),
      P.nota(`Si no la recuerdas, pulsa <a class="enlace" href="${P.esc(`${campusUrl}/login/forgot_password.php`)}" `
        + `style="color:${P.T.primario};text-decoration:none;font-weight:600">¿Has olvidado tu contraseña?</a> `
        + 'y te llegará un enlace para poner una nueva.'),
    ],
  });
  return { asunto: `${proyecto?.nombre ? `${proyecto.nombre} · ` : ''}tus cursos nuevos en el campus`, htmlContent, textContent };
}
