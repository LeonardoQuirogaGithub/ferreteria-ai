import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { findActiveUserWithPermissions } from '../modules/auth/auth.repository.js';

export interface AuthUser {
  id: number;
  nombre: string;
  correo: string;
  roles: string[];
  permisos: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export const can = (user: AuthUser | undefined, permiso: string) => !!user && user.permisos.includes(permiso);

/**
 * Valida el JWT y recarga usuario y permisos desde la base en cada petición:
 * desactivar un usuario o retirarle un rol surte efecto de inmediato (RN-18).
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw unauthorized();
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(header.slice(7), env.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    } catch {
      throw unauthorized('Sesión inválida o expirada');
    }
    if (payload.typ !== 'access') throw unauthorized('Token no válido para esta operación');
    const user = await findActiveUserWithPermissions(Number(payload.sub));
    if (!user) throw unauthorized('Usuario inactivo o inexistente');
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export const requirePermission =
  (...permisos: string[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!permisos.some((p) => req.user!.permisos.includes(p))) return next(forbidden());
    next();
  };
