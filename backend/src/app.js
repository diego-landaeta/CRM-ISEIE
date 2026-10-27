import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { logger } from './shared/utils/logger.js';
import { errorHandler } from './shared/middleware/errorHandler.js';

// Cada módulo exporta { prefix, router } y opcionalmente publicMount.
import authModule from './modules/auth/index.js';
import usersModule from './modules/users/index.js';
import projectsModule from './modules/projects/index.js';
import statusModule from './modules/status/index.js';
import leadsModule from './modules/leads/index.js';
import productsModule from './modules/products/index.js';
import conversionsModule from './modules/conversions/index.js';
import salesModule from './modules/sales/index.js';
import whatsappModule from './modules/whatsapp/index.js';
import tutoresModule from './modules/tutores/index.js';
import notificationsModule from './modules/notifications/index.js';
import metaAdsModule from './modules/meta-ads/index.js';
import commissionsModule from './modules/commissions/index.js';
import accountingModule from './modules/accounting/index.js';
import integrationsModule from './modules/integrations/index.js';
import stripePaymentsModule from './modules/stripe-payments/index.js';
import invoicesModule from './modules/invoices/index.js';
// Facturas de colaboradores (#202, como en MultiCRM): solo en pruebas hasta que
// Diego lo apruebe con FACTURAS_COLABORADOR_EN_PRODUCCION=1.
import facturasColaboradorModule from './modules/facturas-colaborador/index.js';
import { startFacturasColaboradorScheduler } from './jobs/facturasColaboradorJob.js';
import widgetModule from './modules/widget/index.js';
import expensesModule from './modules/expenses/index.js';
import accountsPayableModule from './modules/accounts-payable/index.js';
import payrollModule from './modules/payroll/index.js';
import permissionsModule from './modules/permissions/index.js';
import fieldDefinitionsModule from './modules/field-definitions/index.js';
import productCategoriesModule from './modules/product-categories/index.js';
import matriculasModule from './modules/matriculas/index.js';
import formsModule from './modules/forms/index.js';
import webhookTokensModule from './modules/webhook-tokens/index.js';
import emailSequencesModule from './modules/email-sequences/index.js';
import emailTemplatesModule from './modules/email-templates/index.js';
import documentsModule from './modules/documents/index.js';
import makeModule from './modules/make/index.js';
import woocommerceModule from './modules/woocommerce/index.js';
import connectorsModule from './modules/connectors/index.js';
// Conexión → «Webhook de transferencias» (Diego, 15/10), como en MultiCRM. Migración 206.
import webhooksSalientesModule from './modules/webhooks-salientes/index.js';
import asignacionModule from './modules/asignacion/index.js';
import { registrarActividad } from './shared/middleware/registrarActividad.js';
import { startWebhooksSalientesScheduler } from './jobs/webhooksSalientesScheduler.js';
import { startAsignacionScheduler } from './jobs/asignacionScheduler.js';
import projectChannelsModule from './modules/project-channels/index.js';
import installationModule from './modules/installation/index.js';
import credentialsModule from './modules/credentials/index.js';
import dossiersModule from './modules/dossiers/index.js';
import reportsModule from './modules/reports/index.js';
import clientErrorsModule from './modules/client-errors/index.js';
import changeRequestsModule from './modules/change-requests/index.js';
// El proceso comercial (#87): los pasos, y de ahí la cola del día.
import procesoModule from './modules/proceso/index.js';
// «¿Por que has desistido?» (#169) y su panel (#170).
import feedbackModule from './modules/feedback/index.js';
import novedadesModule from './modules/novedades/index.js';
import certifexModule from './modules/certifex/index.js';
// Sistema → Registro (#111), como en MultiCRM: quién hizo qué y los sucesos del sistema.
import registroModule from './modules/registro/index.js';
// Sistema → Mensajes: el chat interno del equipo, como en MultiCRM. Migración 232.
import messagesModule from './modules/messages/index.js';
import mcpModule from './modules/mcp/index.js';
import { startFeedbackDia7Scheduler } from './jobs/feedbackDia7Scheduler.js';
import { startNovedadesScheduler } from './jobs/novedadesScheduler.js';
import convocatoriasModule from './modules/convocatorias/index.js';
import { startEmailSequenceScheduler } from './jobs/emailSequenceScheduler.js';
import { startDocumentOrphanScheduler } from './jobs/documentOrphanScheduler.js';
import { startGoogleAdsTokenScheduler } from './jobs/googleAdsTokenScheduler.js';
import { startMetaAdsSyncScheduler } from './jobs/metaAdsSyncScheduler.js';
import { startReminderScheduler } from './jobs/reminderScheduler.js';
import { startWooCommerceSyncScheduler } from './jobs/wooCommerceSyncScheduler.js';
import { startStripePaymentsSyncScheduler } from './jobs/stripePaymentsSyncScheduler.js';
import { startTutorCommissionsScheduler } from './jobs/tutorCommissionsScheduler.js';
import { startVigilanteCatalogoScheduler } from './jobs/vigilanteCatalogoScheduler.js';
import { startLeadSinTocarScheduler } from './jobs/leadSinTocarScheduler.js';
import { startResumenDiarioScheduler } from './jobs/resumenDiarioScheduler.js';
import { startReporteSemanalScheduler } from './jobs/reporteSemanalScheduler.js';
import { startMcpRotacionScheduler } from './jobs/mcpRotacionScheduler.js';
import { startMcpVigilanciaScheduler } from './jobs/mcpVigilanciaScheduler.js';
// Tablero de tareas del equipo (#210, paridad con MultiCRM): solo en pruebas.
import tasksModule from './modules/tasks/index.js';
import { startTasksDailySummaryScheduler } from './jobs/tasksDailySummaryJob.js';
import { startTareasResumenScheduler } from './jobs/tareasResumenJob.js';
// Lo que aún no está aprobado para producción: el tablero (#210) y las facturas de colaboradores (#202).
import { tareasActivas, facturasColaboradorActivas } from './shared/config/soloEnPruebas.js';

const app = express();
const PORT = process.env.PORT || 3005;

// Detrás de Nginx (un único hop). Necesario para que express-rate-limit
// y req.ip funcionen con X-Forwarded-For sin lanzar ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// Middleware global
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:5173'],
  credentials: true,
}));
// El webhook de WhatsApp entra por su propia puerta, mas ancha.
//
// Evolution manda la foto o el audio dentro del propio aviso, en base64, y eso
// abulta un tercio mas que el archivo. Con el tope general de 5 MB, Express
// rechazaba el aviso ENTERO con «request entity too large»: no es que llegara el
// mensaje sin la foto, es que se perdia el mensaje. Paso el 21/08/2026.
//
// Se abre solo esta ruta y no el tope general: 25 MB en todos los endpoints es
// una invitacion a tumbar el servidor mandando cuerpos enormes. Los 25 MB son
// los mismos que deja pasar Nginx, para que no se rechace en dos sitios
// distintos con dos mensajes distintos.
app.use('/api/whatsapp/webhook', express.json({ limit: '25mb' }));

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
// Lo que hace una gestora y no guarda su autor, para «activa en los últimos 15 min» (CRM#513).
app.use(registrarActividad);

// API root
app.get('/api', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'CRM-ISEIE API',
      version: '1.0.0',
      status: 'online',
      endpoints: {
        health: '/api/health',
        auth: '/api/auth',
        users: '/api/users',
        projects: '/api/projects',
        leads: '/api/leads',
        products: '/api/products',
        conversions: '/api/conversions',
        commissions: '/api/commissions',
        accounting: '/api/accounting',
        expenses: '/api/expenses',
        accountsPayable: '/api/accounts-payable',
        payroll: '/api/payroll',
        permissions: '/api/permissions',
        fieldDefinitions: '/api/field-definitions',
        productCategories: '/api/product-categories',
        matriculas: '/api/matriculas',
        forms: '/api/forms',
        webhookTokens: '/api/webhook-tokens',
        emailSequences: '/api/email-sequences',
        emailTemplates: '/api/email-templates',
        documents: '/api/documents',
        make: '/api/make-webhooks',
        makeIngest: '/api/webhooks/make/:slug',
        woocommerce: '/api/woocommerce',
        connectors: '/api/connectors',
        projectChannels: '/api/project-channels',
        installation: '/api/installation',
        credentials: '/api/credentials',
        dossiers: '/api/dossiers',
        informes: '/api/informes',
        status: '/api/status',
      },
    },
  });
});

// Health check (público, ligero).
app.get('/api/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// Health detallado: DB ping + estado de credenciales externas + uptime +
// memoria. NO requiere auth (operativo para monitoring externo) pero NO
// expone secretos (solo presencia/ausencia y last_test_result).
app.get('/api/health/detailed', async (_req, res) => {
  const start = Date.now();
  const checks = { timestamp: new Date().toISOString() };

  // Uptime + memoria del proceso
  checks.process = {
    uptime_seconds: Math.round(process.uptime()),
    node_version: process.version,
    memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  };

  // DB connectivity (timeout 3s)
  try {
    const { query } = await import('./shared/config/db.js');
    const r = await Promise.race([
      query('SELECT 1 AS ping, COUNT(*)::int AS user_count FROM users'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('DB timeout 3s')), 3000)),
    ]);
    checks.database = { status: 'ok', user_count: r.rows[0].user_count };
  } catch (err) {
    checks.database = { status: 'fail', error: err.message };
  }

  // Credenciales externas configuradas (sin exponer valores)
  try {
    const { query } = await import('./shared/config/db.js');
    const { rows } = await query(
      `SELECT service, last_test_result, last_tested_at
         FROM api_credentials
        WHERE active = true`
    );
    checks.integrations = rows.reduce((acc, r) => {
      acc[r.service] = {
        configured: true,
        last_test: r.last_test_result || 'never',
        last_tested_at: r.last_tested_at || null,
      };
      return acc;
    }, {});
    const expected = ['brevo', 'google_ads', 'gsc', 'stripe', 'claude', 'meta'];
    for (const svc of expected) {
      if (!checks.integrations[svc]) checks.integrations[svc] = { configured: false };
    }
  } catch (err) {
    checks.integrations = { error: err.message };
  }

  // Schedulers: leemos de variables de entorno qué están activos
  checks.schedulers = {
    email_sequence: process.env.EMAIL_SEQ_DISABLED !== '1',
    document_orphan: process.env.DOC_ORPHAN_DISABLED !== '1',
    google_ads_token: process.env.GOOGLE_ADS_TOKEN_DISABLED !== '1',
    reminder: process.env.REMINDER_DISABLED !== '1',
    woocommerce_sync: process.env.WC_SYNC_DISABLED !== '1',
  };

  checks.elapsed_ms = Date.now() - start;
  const overallOk = checks.database?.status === 'ok';
  res.status(overallOk ? 200 : 503).json({ success: overallOk, data: checks });
});

// Catálogo de módulos a montar.
const MODULES = [
  authModule,
  whatsappModule,
  tutoresModule,
  usersModule,
  projectsModule,
  leadsModule,
  productsModule,
  productCategoriesModule,
  conversionsModule,
  salesModule,
  notificationsModule,
  metaAdsModule,
  commissionsModule,
  accountingModule,
  integrationsModule,
  stripePaymentsModule,
  invoicesModule,
  // Facturas de colaboradores (#202): la lista, el enlace del mes y «Mi factura».
  // Solo en pruebas también en el servidor: en producción ni la API ni la tarea del mes.
  ...(facturasColaboradorActivas() ? [facturasColaboradorModule] : []),
  widgetModule,
  expensesModule,
  accountsPayableModule,
  payrollModule,
  permissionsModule,
  fieldDefinitionsModule,
  matriculasModule,
  formsModule,
  webhookTokensModule,
  emailSequencesModule,
  emailTemplatesModule,
  documentsModule,
  makeModule,
  woocommerceModule,
  connectorsModule,
  // Avisa a fuera de los cobros por transferencia o depósito bancario (Diego, 15/10).
  webhooksSalientesModule,
  // Asignación de leads por actividad (CRM#513, 27/10/2026). Migración 243.
  asignacionModule,
  projectChannelsModule,
  installationModule,
  credentialsModule,
  dossiersModule,
  reportsModule,
  clientErrorsModule,
  changeRequestsModule,
  statusModule,
  procesoModule,
  feedbackModule,
  novedadesModule,
  convocatoriasModule,
  // Certifex: el CRM aprueba y Certifex emite (Matrículas → Certificaciones).
  certifexModule,
  // Sistema → Registro (#111): solo lectura sobre lo que ya se apunta. Admin y superadmin.
  registroModule,
  // Mensajes del equipo (/api/mensajes, con /api/messages de alias).
  messagesModule,
  // Conexion de Claude por MCP: solo consulta, con token personal (como MultiCRM).
  mcpModule,
  // El tablero aún no está aprobado para producción: solo en local y /staging.
  ...(tareasActivas() ? [tasksModule] : []),
];
if (!tareasActivas()) logger.info('Modulo SKIP (solo en pruebas): /api/tasks');

if (!facturasColaboradorActivas()) logger.info('Modulo SKIP (solo en pruebas): /api/facturas-colaborador');

for (const mod of MODULES) {
  app.use(mod.prefix, mod.router);
  logger.info(`Modulo registrado: ${mod.prefix}`);
  // Un modulo puede responder tambien por su nombre anterior. Sirve para
  // renombrar sin romper lo que ya apuntaba al viejo.
  if (mod.alias) {
    app.use(mod.alias, mod.router);
    logger.info(`Modulo registrado (alias): ${mod.alias}`);
  }
  if (mod.publicMount) {
    app.use(mod.publicMount.prefix, mod.publicMount.router);
    logger.info(`Modulo registrado (public): ${mod.publicMount.prefix}`);
  }
}

// Error handler (debe ir ultimo)
app.use(errorHandler);

// Traído de MultiCRM (a5087a0e, paridad 15/10).
/**
 * Vuelve a encolar los adjuntos que se quedaron a medias.
 *
 * La cola de descarga vive en memoria, asi que un reinicio la vacia. Habia un
 * boton para recuperarla, pero esperar a que una gestora lo pulse es esperar
 * sentado: lo que ve es que las fotos no llegan, no que hay una cola muerta.
 *
 * Se hace por sesion, porque para descifrar un adjunto hace falta el socket de
 * la sesion que lo recibio. Y con un retraso: al arrancar, Evolution todavia
 * esta levantando las suyas, y pedirle archivos antes de tiempo es tirar
 * peticiones que van a fallar.
 */
async function recuperarAdjuntosDeWhatsapp() {
  setTimeout(async () => {
    try {
      const { query } = await import('./shared/config/db.js');
      const media = await import('./modules/whatsapp/media.service.js');
      const { rows } = await query(
        `SELECT DISTINCT c.instancia
           FROM wa_mensajes m
           JOIN wa_conversaciones c ON c.id = m.conversacion_id
          WHERE m.media_url IS NULL
            AND m.tipo NOT IN ('texto', 'otro')
            AND m.wa_id IS NOT NULL`
      );
      let total = 0;
      for (const { instancia } of rows) total += await media.reencolarPendientes(instancia);
      if (total) logger.info({ sesiones: rows.length, archivos: total }, 'WhatsApp: adjuntos pendientes recuperados tras el arranque');
    } catch (err) {
      // Que no se pueda recuperar no puede impedir arrancar: el boton de
      // reintentar sigue estando para hacerlo a mano.
      logger.warn({ err: err.message }, 'WhatsApp: no se pudieron recuperar los adjuntos pendientes');
    }
  }, 45_000).unref();
}

// ── La red de seguridad del proceso ──────────────────────────────────────────
//
// No habia ninguna, y eso significa que UN fallo asincrono sin capturar en
// cualquier rincon tumba la API entera. Paso el 21/08/2026: un parpadeo de
// Postgres, el cron de Stripe lanzo dentro de su `setTimeout` —tenia
// `try/finally` pero no `catch`— y se llevo por delante el CRM completo.
//
// Y en WhatsApp eso duele el doble, porque la cola de descarga de adjuntos vive
// en memoria: al reiniciar, los archivos del historial que estaban en cola se
// quedan sin bajar y la gestora ve «⬇ Descargar» para siempre. Eso es lo que se
// veia como «la sincronizacion va fatal».
//
// Una promesa rota no puede tirar el servidor: se apunta y se sigue sirviendo.
// Una excepcion sincrona sin capturar SI se sale, porque ahi el proceso puede
// haber quedado a medias — pero por la puerta, dando tiempo a cerrar, y PM2 lo
// levanta. Al arrancar se recupera la cola, asi que reiniciar ya no pierde nada.
process.on('unhandledRejection', (motivo) => {
  logger.error(
    { err: motivo instanceof Error ? motivo.message : String(motivo),
      stack: motivo instanceof Error ? motivo.stack : undefined },
    'Promesa rechazada sin capturar — se sigue sirviendo'
  );
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: err.message, stack: err.stack }, 'Excepcion sin capturar — se cierra');
  // Un margen para que el registro salga antes de irse.
  setTimeout(() => process.exit(1), 500).unref();
});

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info(`CRM-ISEIE API corriendo en puerto ${PORT}`);
    if (process.env.EMAIL_SEQ_DISABLED !== '1') {
      try {
        startEmailSequenceScheduler();
        logger.info('Email sequence scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'Email sequence scheduler fallo al arrancar');
      }
    }
    if (process.env.DOC_ORPHAN_DISABLED !== '1') {
      try {
        startDocumentOrphanScheduler();
        logger.info('Document orphan scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'Document orphan scheduler fallo al arrancar');
      }
    }
    if (process.env.GOOGLE_ADS_TOKEN_DISABLED !== '1') {
      try {
        startGoogleAdsTokenScheduler();
        logger.info('Google Ads token scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'Google Ads token scheduler fallo al arrancar');
      }
    }
    if (process.env.META_SYNC_DISABLED !== '1') {
      try {
        startMetaAdsSyncScheduler();
        logger.info('Meta Ads sync scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'Meta Ads sync scheduler fallo al arrancar');
      }
    }
    if (process.env.REMINDER_DISABLED !== '1') {
      try {
        startReminderScheduler();
        logger.info('Reminder scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'Reminder scheduler fallo al arrancar');
      }
    }
    if (process.env.WC_SYNC_DISABLED !== '1') {
      try {
        startWooCommerceSyncScheduler();
        logger.info('WooCommerce sync scheduler arrancado');
      } catch (err) {
        logger.error({ err }, 'WooCommerce sync scheduler fallo al arrancar');
      }
    }
    if (process.env.STRIPE_SYNC_DISABLED !== '1') {
      try {
        startStripePaymentsSyncScheduler();
        startTutorCommissionsScheduler();
        startVigilanteCatalogoScheduler();
        startLeadSinTocarScheduler();
        startFeedbackDia7Scheduler();
        startNovedadesScheduler();
        startResumenDiarioScheduler();
        startReporteSemanalScheduler();
      } catch (err) {
        logger.error({ err }, 'Stripe sync scheduler fallo al arrancar');
      }
    }
    // Seguridad del MCP (#237, desde #194 y #195): fuera del bloque de Stripe
    // a propósito, para que apagar la sincronización de Stripe no la apague.
    // Cada uno con su interruptor en el .env, como los demás trabajos.
    if (process.env.MCP_ROTACION_DISABLED !== '1') {
      try {
        startMcpRotacionScheduler();
      } catch (err) {
        logger.error({ err }, 'MCP: la rotación de URLs falló al arrancar');
      }
    }
    if (process.env.MCP_VIGILANCIA_DISABLED !== '1') {
      try {
        startMcpVigilanciaScheduler();   // alertas de uso raro
      } catch (err) {
        logger.error({ err }, 'MCP: la vigilancia de alertas falló al arrancar');
      }
    }
    // Facturas de colaboradores (#202): el correo del mes y el recordatorio del día 5.
    if (facturasColaboradorActivas()) {
      try {
        startFacturasColaboradorScheduler();
      } catch (err) {
        logger.error({ err }, 'Facturas de colaboradores: la tarea del mes falló al arrancar');
      }
    }
    // Los reintentos del webhook de transferencias (se apaga con WEBHOOKS_SALIENTES_DISABLED=1).
    try {
      startWebhooksSalientesScheduler();
    } catch (err) {
      logger.error({ err }, 'Webhook de transferencias: los reintentos fallaron al arrancar');
    }
    // Los reintentos de la asignación de leads (CRM#513; se apaga con ASIGNACION_DISABLED=1).
    try {
      startAsignacionScheduler();
    } catch (err) {
      logger.error({ err }, 'Asignación de leads: los reintentos fallaron al arrancar');
    }
    // Los adjuntos de WhatsApp que se quedaron a medias con el reinicio (como en MultiCRM).
    recuperarAdjuntosDeWhatsapp();
    // El correo de cada mañana del tablero (se apaga con TAREAS_DIARIO_DISABLED=1).
    if (tareasActivas()) {
      try {
        startTasksDailySummaryScheduler();
      } catch (err) {
        logger.error({ err }, 'Tareas: el correo de cada mañana falló al arrancar');
      }
      // El resumen de la tarde y los correos de cambio de estado (26/10/2026).
      try {
        startTareasResumenScheduler();
      } catch (err) {
        logger.error({ err }, 'Tareas: el resumen de la tarde falló al arrancar');
      }
    }
  });
}

export default app;
