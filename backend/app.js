import express from 'express';
import cookieParser from 'cookie-parser';
import { checkHealth } from './database.js';
import logger from './utils/logger.js';
import { getAuthConfig } from './auth/config.js';
import {
  originCheck, loadSession, requireAuth, auditWrites, requireAdmin, requireAdminForWrites,
} from './auth/middleware.js';
import customersRouter from './routes/customers.js';
import invoicesRouter from './routes/invoices.js';
import quotesRouter from './routes/quotes.js';
import companyRouter from './routes/company.js';
import emailRouter from './routes/email.js';
import emailManagementRouter from './routes/emailManagement.js';
import jobsRouter from './routes/jobs.js';
import materialTemplatesRouter from './routes/materialTemplates.js';
import hourlyRatesRouter from './routes/hourlyRates.js';
import yearlyInvoiceStartNumbersRouter from './routes/yearlyInvoiceStartNumbers.js';
import backupRouter from './routes/backup.js';
import reportingRouter from './routes/reporting.js';
import remindersRouter from './routes/reminders.js';
import planRouter from './routes/plan.js';
import { requireFeature } from './utils/plan.js';

// Platzhalter bis Task 9 (auth), 11 (users) und 12 (audit-log) die echten Router liefern.
const authRouter = express.Router();
const usersRouter = express.Router();
const auditLogRouter = express.Router();

export function createApp() {
  const app = express();
  app.set('trust proxy', getAuthConfig().trustProxyHops);

  app.use(cookieParser());
  app.use(express.json({ limit: '100mb' })); // Increase limit for PDF attachments
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Health check endpoint (ohne Login)
  app.get('/health', async (req, res) => {
    const dbHealth = await checkHealth();

    if (dbHealth.healthy) {
      res.json({
        status: 'OK',
        message: 'Server is running',
        database: {
          status: 'connected',
          poolStats: dbHealth.poolStats,
        },
      });
    } else {
      res.status(503).json({
        status: 'DEGRADED',
        message: 'Server is running but database connection failed',
        database: {
          status: 'disconnected',
          error: dbHealth.error,
          poolStats: dbHealth.poolStats,
        },
      });
    }
  });

  // Jede /api-Route braucht eine Session (Ausnahmen: PUBLIC_API_PATHS)
  app.use('/api', originCheck, loadSession, requireAuth, auditWrites);

  // API routes
  app.use('/api/auth', authRouter);
  app.use('/api/users', requireAdmin, usersRouter);
  app.use('/api/audit-log', requireAdmin, auditLogRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/invoices', invoicesRouter);
  app.use('/api/quotes', quotesRouter);
  app.use('/api/company', requireAdminForWrites, companyRouter);
  app.use('/api/email', requireFeature('email'), emailRouter);
  app.use('/api/email-management', emailManagementRouter);
  app.use('/api/jobs', requireFeature('jobs', { allowRead: true }), jobsRouter);
  app.use('/api/material-templates', requireFeature('customerPricing', { allowRead: true }), requireAdminForWrites, materialTemplatesRouter);
  app.use('/api/hourly-rates', requireAdminForWrites, hourlyRatesRouter);
  app.use('/api/yearly-invoice-start-numbers', requireAdminForWrites, yearlyInvoiceStartNumbersRouter);
  app.use('/api/backup', requireAdmin, backupRouter);
  app.use('/api/reporting', reportingRouter);
  app.use('/api/reminders', requireFeature('reminders', { allowRead: true }), remindersRouter);
  app.use('/api/plan', planRouter);

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Unhandled server error', { error: err.message, stack: err.stack, url: req.url, method: req.method });
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
