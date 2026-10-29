import { createApp } from './app.js';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { logger } from './lib/logger.js';
import { scheduleMonthlyClosure } from './modules/admin/closure-scheduler.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info(`API en http://localhost:${env.PORT}/api — documentación en /api/docs`);
});

const stopScheduler = env.CIERRE_AUTOMATICO ? scheduleMonthlyClosure() : () => undefined;

function shutdown() {
  stopScheduler();
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
