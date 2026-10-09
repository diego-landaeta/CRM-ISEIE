import { logger } from '../shared/utils/logger.js';
import { query } from '../shared/config/db.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import { vigilar } from './latido.js';
// Por el espacio de nombres: el repaso mensual de la base (#132) solo existe en
// MultiCRM. En ISEIE estas funciones no estan y el repaso no se manda.
import * as leadModel from '../modules/leads/lead.model.js';
import { correoDiarioDireccion, correoDiarioGestora, envoltorio } from './correosDelEquipo.js';
import { CRM_CORREOS } from '../shared/config/crm.js';

/**
 * Los avisos de final de jornada (tarea #28), rehechos el 28/09 con datos y con
 * la marca (ver `correosDelEquipo.js`):
 *
 *   · **Resumen del dia** por la tarde — a direccion (admin y superadmin),
 *     POR EMPRESA: quien lleva tres empresas recibe un correo con las tres.
 *   · **Tu dia y lo de mañana** por la noche — a cada gestora: lo de hoy, su
 *     cola de mañana, sus recordatorios y como va el mes. Absorbe el antiguo
 *     resumen de las 19:00 de la gestora: dos correos cada tarde era uno de mas.
 *
 * Van juntos porque comparten todo menos el texto: la misma consulta de a quien
 * avisar, el mismo respeto por quien lo apago y la misma clave de idempotencia.
 * Separarlos habria sido escribir dos veces lo mismo para que se separaran solos
 * el dia que alguien tocara uno.
 *
 * La clave lleva el DIA, al reves que el aviso de prospecto sin contactar. Ahi
 * el aviso es «este lead concreto» y repetirlo seria acosar; aqui es «lo de
 * hoy», y tiene que llegar cada dia. Un reinicio no lo repite, y eso es lo que
 * se quiere.
 */

const HORA_RESUMEN = parseInt(process.env.RESUMEN_HORA || '19', 10);
const HORA_PLAN = parseInt(process.env.PLAN_HORA || '21', 10);
const DIA_VALIDACION = parseInt(process.env.VALIDACION_DIA || '25', 10);
const TICK_MS = parseInt(process.env.RESUMEN_TICK_MS || String(30 * 60 * 1000), 10);
const AL_ARRANCAR_MS = parseInt(process.env.AVISOS_AL_ARRANCAR_MS || String(60 * 1000), 10);

let corriendo = false;

const hoy = () => new Date().toISOString().slice(0, 10);

/** A quien le toca este aviso: gestoras activas que no lo hayan apagado. */
async function destinatarios(aviso, roles) {
  const { rows } = await query(
    `SELECT u.id, u.nombre, u.email, u.role
       FROM users u
      WHERE u.active
        AND u.email IS NOT NULL
        AND u.role = ANY($1)
        AND NOT COALESCE(u.gestor_colaboraciones, false)
        AND NOT EXISTS (
          SELECT 1 FROM avisos_apagados a
           WHERE a.user_id = u.id AND a.aviso = $2
        )
      ORDER BY u.nombre`,
    [roles, aviso]
  );
  return rows;
}

// Para el repaso mensual: una linea con su enlace al listado ya filtrado.
const BASE = () => (process.env.FEEDBACK_BASE_URL || process.env.CRM_BASE_URL || 'http://localhost:5173/crm').replace(/\/+$/, '');
const lineaConEnlace = (etiqueta, valor, qf, projectId) => (valor
  ? `<li style="margin:6px 0">
       <strong>${valor}</strong> ${etiqueta}
       &nbsp;<a href="${BASE()}${CRM_CORREOS.rutas.prospectos}?projectId=${projectId}&qf=${qf}"
               style="color:${CRM_CORREOS.color};font-weight:600;text-decoration:none">abrir &rarr;</a>
     </li>`
  : '');

/**
 * `texto` y `periodo` llegan de fuera.
 *
 * Antes esto elegia el cuerpo con `aviso === 'resumen_del_dia' ? … : …`, un if
 * de dos ramas. Al llegar el tercer aviso —la validacion mensual— ese if habria
 * mandado el texto del plan de mañana con el asunto del repaso. Se parametriza
 * y deja de haber una rama que adivinar.
 *
 * `periodo` es lo que hace que la clave de idempotencia signifique lo correcto:
 * los diarios llevan el dia y tienen que llegar cada dia; el mensual lleva el
 * mes, o llegaria treinta veces.
 */
/**
 * El repaso de fin de mes: su base entera, para validarla (#132).
 *
 * Diego: «solamente el seguimiento de toda la base, que se puede enviar por
 * correo a cada gestora esa base y que la validen».
 *
 * No lleva la lista de fichas dentro. Una base son cientos: un correo con
 * cientos de nombres no se lee, y ademas quedaria congelado el dia que se
 * mando. Lleva el numero y el enlace, que es donde se puede trabajar.
 */
async function loDeLaBase(userId) {
  const { rows: suyos } = await query(
    `SELECT p.id, p.nombre
       FROM user_projects up JOIN projects p ON p.id = up.project_id
      WHERE up.user_id = $1 AND up.active AND p.active
      ORDER BY p.nombre`, [userId]);

  const bloques = [];
  for (const proyecto of suyos) {
    const c = await leadModel.comoVaLaRevision({ projectId: proyecto.id, responsableId: userId });
    if (c.total) bloques.push({ proyecto, ...c });
  }
  return { bloques, variosProyectos: suyos.length > 1 };
}

function textoValidacionSolo(nombre, d) {
  const bloques = (d?.bloques || []).filter((b) => b.pendientes > 0);
  if (!bloques.length) {
    return `
      <p>Hola ${nombre},</p>
      <p>Tienes la base entera repasada este mes. No queda ninguna ficha por validar.</p>
      <p style="font-size:12px;color:#666">Puedes apagar este aviso en <em>Mis preferencias</em>.</p>
    `;
  }
  const trozo = (b) => {
    const hechas = b.total - b.pendientes;
    const pct = b.total ? Math.round((hechas / b.total) * 100) : 0;
    return `
      ${d.variosProyectos ? `<p style="margin:14px 0 4px"><strong>${b.proyecto.nombre}</strong></p>` : ''}
      <ul style="padding-left:18px;margin:4px 0">
        ${lineaConEnlace('por validar', b.pendientes, 'sin-revisar', b.proyecto.id)}
      </ul>
      <p style="font-size:12px;color:#666;margin:2px 0 0">
        Llevas ${hechas} de ${b.total} (${pct} %).
      </p>`;
  };
  return `
    <p>Hola ${nombre},</p>
    <p>Toca el repaso de la base: mirar quien sigue vivo, quien ya no y quien cambio de idea.</p>
    ${bloques.map(trozo).join('')}
    <p style="font-size:13px;color:#555">
      El enlace abre tu lista con lo que te falta. Cada ficha se marca desde ahi,
      y el numero baja segun avanzas — no hace falta terminarlo de una sentada.
    </p>
    <p style="font-size:12px;color:#666">Puedes apagar este aviso en <em>Mis preferencias</em>.</p>
  `;
}

// El repaso mensual, con la misma cabecera y el mismo pie que los demas.
const textoValidacion = (nombre, d) => envoltorio({
  preTitulo: 'Repaso de tu base', titulo: 'Toca repasar tu base',
  contenido: textoValidacionSolo(nombre, d),
});

async function mandar(aviso, roles, asunto, arma, texto, periodo = hoy()) {
  const gente = await destinatarios(aviso, roles);
  let mandados = 0;
  for (const persona of gente) {
    try {
      // Los correos nuevos se arman enteros (asunto y cuerpo) con la persona;
      // el repaso mensual, con sus datos y su plantilla.
      const correo = texto ? { asunto, html: texto(persona.nombre, await arma(persona.id)) } : await arma(persona);
      if (!correo) continue;
      const r = await sendEmail({
        to: persona.email,
        subject: correo.asunto,
        htmlContent: correo.html,
        tags: ['recordatorio', aviso.replace(/_/g, '-')],
        clave: `${aviso}-${persona.id}-${periodo}`,
      });
      if (r?.sent) mandados++;
    } catch (err) {
      // Que falle el de una persona no puede dejar sin aviso a las demas.
      logger.error({ err: err.message, userId: persona.id, aviso }, 'Fallo mandando el aviso diario');
    }
  }
  return { destinatarios: gente.length, mandados };
}

async function vuelta() {
  if (corriendo) return;
  corriendo = true;
  try {
    const hora = new Date().getHours();

    // Se comprueba la hora en cada vuelta en vez de programar a una hora exacta:
    // asi un reinicio a las 19:05 no se salta el aviso del dia. La clave impide
    // que se mande dos veces.
    if (hora === HORA_RESUMEN) {
      const r = await mandar(
        'resumen_del_dia',
        ['admin', 'superadmin'],
        null,
        (persona) => correoDiarioDireccion(persona), null
      );
      logger.info({ ...r, aviso: 'resumen_del_dia' }, 'Resumen del dia');
    }

    // El repaso mensual. `DIA_VALIDACION` por defecto el 25: con margen para
    // que dé tiempo antes de fin de mes, que es cuando toca el quinto paso.
    if (hora === HORA_PLAN && new Date().getDate() === DIA_VALIDACION) {
      // Si la migracion 155 no esta, NO se manda. Un correo que dice «valida tu
      // base» y lleva a una pantalla donde no se puede marcar es peor que no
      // mandarlo: se abre, no se puede hacer nada, y el mes siguiente ya no se
      // abre.
      if (leadModel.sePuedeRevisar && await leadModel.sePuedeRevisar()) {
        const r = await mandar(
          'validacion_mensual',
          ['gestor'],
          '[CRM] Toca repasar tu base',
          loDeLaBase, textoValidacion,
          hoy().slice(0, 7),
        );
        logger.info({ ...r, aviso: 'validacion_mensual' }, 'Validacion mensual');
      } else {
        logger.warn('Falta la migracion 155 (lead_revisiones): no se manda la validacion mensual');
      }
    }

    if (hora === HORA_PLAN) {
      const r = await mandar(
        'plan_de_manana',
        ['gestor'],
        null,
        (persona) => correoDiarioGestora(persona), null
      );
      logger.info({ ...r, aviso: 'plan_de_manana' }, 'Plan de mañana');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Fallo en los avisos diarios');
  } finally {
    corriendo = false;
  }
}

export function startResumenDiarioScheduler() {
  if (process.env.RESUMEN_DISABLED === '1') {
    logger.info('Avisos diarios desactivados (RESUMEN_DISABLED=1)');
    return;
  }
  // Y una vuelta al minuto de arrancar: un reinicio a las 21:40 ya no se salta
  // el resumen de ese día (la clave del día impide que salga dos veces).
  vigilar('resumen_diario', 'Resumen del día y plan de mañana', vuelta, TICK_MS, { alArrancarMs: AL_ARRANCAR_MS });
  logger.info({ tickMs: TICK_MS, horaResumen: HORA_RESUMEN, horaPlan: HORA_PLAN },
    'Avisos diarios iniciados');
}

export const _internos = { destinatarios, loDeLaBase, textoValidacion, mandar, vuelta };
