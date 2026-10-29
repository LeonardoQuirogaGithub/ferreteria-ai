import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { buildOpenApi } from './docs/openapi.js';
import { logger } from './lib/logger.js';
import { authenticate } from './middlewares/auth.js';
import { errorHandler, notFoundHandler } from './middlewares/error-handler.js';
import { apiLimiter } from './middlewares/rate-limit.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { OllamaClient, type LlmClient } from './modules/ai/ollama.client.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { catalogsRouter } from './modules/catalogs/catalogs.routes.js';
import { importsRouter } from './modules/imports/imports.routes.js';
import { integrationRouter } from './modules/integration/integration.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { pricesRouter } from './modules/prices/prices.routes.js';
import { productsRouter } from './modules/products/products.routes.js';
import { purchasesRouter } from './modules/purchases/purchases.routes.js';
import { quotationsRouter } from './modules/quotations/quotations.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { salesRouter } from './modules/sales/sales.routes.js';
import { thirdPartiesRouter } from './modules/thirdparties/thirdparties.routes.js';

export interface AppDeps {
  llm?: LlmClient;
}

export function createApp(deps: AppDeps = {}) {
  const app = express();
  const llm = deps.llm ?? new OllamaClient();
  const openapi = buildOpenApi();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_URL.split(',').map((s) => s.trim()), credentials: false }));
  app.use(express.json({ limit: '200kb' }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok' });
    } catch {
      res.status(503).json({ status: 'degradado', db: 'no_disponible' });
    }
  });
  app.get('/api/openapi.json', (_req, res) => res.json(openapi));
  app.use('/api/docs', helmet({ contentSecurityPolicy: false }), swaggerUi.serve, swaggerUi.setup(openapi));

  const api = express.Router();
  api.use(apiLimiter);
  api.use('/auth', authRouter);
  api.use(authenticate); // todo lo siguiente exige sesión
  api.use('/products', productsRouter);
  api.use('/', catalogsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/third-parties', thirdPartiesRouter);
  api.use('/purchases', purchasesRouter);
  api.use('/sales', salesRouter);
  api.use('/prices', pricesRouter);
  api.use('/quotations', quotationsRouter);
  api.use('/reports', reportsRouter);
  api.use('/imports', importsRouter);
  api.use('/integration', integrationRouter);
  api.use('/ai', aiRouter(llm));
  api.use('/', adminRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
