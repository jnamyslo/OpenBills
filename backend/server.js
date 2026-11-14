import dotenv from 'dotenv';
import { createTables, pool } from './database.js';
import logger from './utils/logger.js';
import { createApp } from './app.js';
import { getPlanName } from './utils/plan.js';
import { assertAuthConfig } from './auth/config.js';
import { assertDemoConfig } from './demo/index.js';
import { assertPlatformMailConfig } from './services/mailRouting.js';
import { verifyDummyPassword } from './auth/password.js';
import { cleanupSessions } from './auth/sessions.js';
import { cleanupRateLimits } from './auth/rateLimit.js';
import { cleanupAuditLog } from './auth/audit.js';

dotenv.config();

const PORT = process.env.PORT || 3001;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

async function runCleanup() {
  for (const [name, fn] of [
    ['sessions', cleanupSessions],
    ['rate_limits', cleanupRateLimits],
    ['audit_log', cleanupAuditLog],
  ]) {
    try {
      await fn();
    } catch (error) {
      logger.error('Cleanup fehlgeschlagen', { job: name, error: error.message });
    }
  }
}

// Initialize database and start server
async function startServer() {
  try {
    assertAuthConfig();
    assertDemoConfig();
    assertPlatformMailConfig();
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }

  try {
    logger.info('Plan', { plan: getPlanName() });
    logger.info('Connecting to database...');
    await createTables();
    logger.info('Database initialized successfully');

    await verifyDummyPassword('warmup');

    createApp().listen(PORT, '0.0.0.0', () => {
      logger.info(`Server started`, { port: PORT, environment: process.env.NODE_ENV || 'development' });
    });

    setInterval(runCleanup, CLEANUP_INTERVAL_MS).unref();
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down server...');
  await pool.end();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down server (SIGTERM)...');
  await pool.end();
  process.exit(0);
});

startServer();
