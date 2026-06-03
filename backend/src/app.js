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
import notificationsModule from './modules/notifications/index.js';
import metaAdsModule from './modules/meta-ads/index.js';
import commissionsModule from './modules/commissions/index.js';
import accountingModule from './modules/accounting/index.js';
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
import projectChannelsModule from './modules/project-channels/index.js';
import installationModule from './modules/installation/index.js';
import credentialsModule from './modules/credentials/index.js';
import dossiersModule from './modules/dossiers/index.js';
import reportsModule from './modules/reports/index.js';
import clientErrorsModule from './modules/client-errors/index.js';
import { startEmailSequenceScheduler } from './jobs/emailSequenceScheduler.js';
import { startDocumentOrphanScheduler } from './jobs/documentOrphanScheduler.js';
import { startGoogleAdsTokenScheduler } from './jobs/googleAdsTokenScheduler.js';
import { startReminderScheduler } from './jobs/reminderScheduler.js';
import { startWooCommerceSyncScheduler } from './jobs/wooCommerceSyncScheduler.js';

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
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());

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
        reports: '/api/reports',
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
  projectChannelsModule,
  installationModule,
  credentialsModule,
  dossiersModule,
  reportsModule,
  clientErrorsModule,
  statusModule,
];

for (const mod of MODULES) {
  app.use(mod.prefix, mod.router);
  logger.info(`Modulo registrado: ${mod.prefix}`);
  if (mod.publicMount) {
    app.use(mod.publicMount.prefix, mod.publicMount.router);
    logger.info(`Modulo registrado (public): ${mod.publicMount.prefix}`);
  }
}

// Error handler (debe ir ultimo)
app.use(errorHandler);

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
  });
}

export default app;
