import { logger } from '../shared/utils/logger.js';
import { sendEmail } from '../shared/services/brevo.service.js';
import { query } from '../shared/config/db.js';
import * as model from '../modules/email-sequences/sequence.model.js';
import { renderTemplate } from '../modules/email-templates/email-templates.service.js';

const TICK_MS = parseInt(process.env.EMAIL_SEQ_TICK_MS || String(2 * 60 * 1000)); // 2 min default

let running = false;

// CRM-185 fase 3: si el step trae template_id, cargamos la plantilla y la
// renderizamos con datos reales del lead+proyecto. Si no, fallback al
// subject/body inline del step (compat).
async function resolveStepContent(step, run) {
  if (step.template_id) {
    const { rows } = await query(
      `SELECT t.subject, t.body_html, l.nombre AS lead_nombre, l.email AS lead_email,
              l.telefono AS lead_telefono, l.producto_interes AS lead_producto,
              p.nombre AS project_nombre
       FROM email_templates t
       JOIN leads l ON l.id = $2
       JOIN projects p ON p.id = $3
       WHERE t.id = $1`,
      [step.template_id, run.lead_id, run.project_id]
    );
    const tpl = rows[0];
    if (tpl) {
      const ctx = {
        lead: {
          nombre: tpl.lead_nombre || '',
          email: tpl.lead_email || '',
          telefono: tpl.lead_telefono || '',
          producto: tpl.lead_producto || '',
        },
        project: { nombre: tpl.project_nombre },
        user: { nombre: 'Sistema' },
      };
      return {
        subject: renderTemplate(tpl.subject, ctx),
        htmlContent: renderTemplate(tpl.body_html, ctx),
      };
    }
  }
  return {
    subject: step.subject || `Seguimiento (${run.current_step + 1})`,
    htmlContent: step.body || '<p>Hola</p>',
  };
}

async function processOne(run) {
  const step = run.steps?.[run.current_step];
  if (!step) {
    await model.advanceRun(run.id, 'no step');
    return;
  }
  const to = run.lead_email;
  if (!to) {
    await model.advanceRun(run.id, 'lead sin email');
    return;
  }
  try {
    const { subject, htmlContent } = await resolveStepContent(step, run);
    const result = await sendEmail({
      to,
      subject,
      htmlContent,
      tags: ['email-sequence', `seq-${run.sequence_id}`],
      projectId: run.project_id,
    });
    await model.advanceRun(run.id, result.sent === false ? (result.reason || 'no-send') : null);
    logger.info({ runId: run.id, to, step: run.current_step }, 'Email seguimiento procesado');
  } catch (err) {
    await model.advanceRun(run.id, err.message?.slice(0, 500));
    logger.error({ err, runId: run.id }, 'Error enviando email seguimiento');
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await model.findDueRuns(20);
    for (const r of due) await processOne(r);
  } catch (err) {
    logger.error({ err }, 'Email seq scheduler tick error');
  } finally {
    running = false;
  }
}

export function startEmailSequenceScheduler() {
  if (process.env.EMAIL_SEQ_DISABLED === '1') {
    logger.warn('Email sequence scheduler deshabilitado por EMAIL_SEQ_DISABLED=1');
    return;
  }
  setInterval(tick, TICK_MS);
  logger.info({ tickMs: TICK_MS }, 'Email sequence scheduler iniciado');
}
