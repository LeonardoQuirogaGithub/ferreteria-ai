import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { authenticate } from '../../middlewares/auth.js';
import { loginLimiter } from '../../middlewares/rate-limit.js';
import * as service from './auth.service.js';

const LoginSchema = z.object({
  correo: z.string().trim().email().max(120),
  contrasena: z.string().min(1).max(200),
});
const RefreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { correo, contrasena } = LoginSchema.parse(req.body);
    res.json(await service.login(correo, contrasena));
  }),
);

authRouter.post(
  '/refresh',
  loginLimiter,
  asyncHandler(async (req, res) => {
    res.json(await service.refresh(RefreshSchema.parse(req.body).refreshToken));
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await service.logout(RefreshSchema.parse(req.body).refreshToken);
    res.status(204).end();
  }),
);

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);
