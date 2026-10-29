import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const common = {
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  standardHeaders: 'draft-7' as const,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'DEMASIADAS_SOLICITUDES', message: 'Demasiadas solicitudes; intente más tarde' } },
};

export const apiLimiter = rateLimit({ ...common, limit: env.RATE_LIMIT_MAX });
export const loginLimiter = rateLimit({ ...common, limit: env.RATE_LIMIT_LOGIN_MAX });
// El chat se limita por usuario autenticado, no solo por IP.
export const chatLimiter = rateLimit({
  ...common,
  limit: env.RATE_LIMIT_CHAT_MAX,
  keyGenerator: (req) => `user:${req.user?.id ?? req.ip}`,
});
