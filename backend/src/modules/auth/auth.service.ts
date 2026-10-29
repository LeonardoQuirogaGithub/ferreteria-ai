import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { withTransaction } from '../../db/pool.js';
import { unauthorized } from '../../lib/errors.js';
import * as repo from './auth.repository.js';

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
// Hash ficticio para que un correo inexistente tarde lo mismo que uno válido.
const DUMMY_HASH = bcrypt.hashSync('no-es-una-clave-real', 10);

async function issueTokens(usuarioId: number) {
  const accessToken = jwt.sign({ typ: 'access' }, env.JWT_SECRET, {
    subject: String(usuarioId),
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expira = new Date(Date.now() + env.JWT_REFRESH_DAYS * 86_400_000);
  await repo.insertRefresh(usuarioId, sha256(refreshToken), expira);
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_EXPIRES_IN };
}

async function profile(usuarioId: number) {
  const user = await repo.findActiveUserWithPermissions(usuarioId);
  if (!user) throw unauthorized('Usuario inactivo o inexistente');
  return user;
}

/** RF-SEG-001: solo usuarios activos con credenciales correctas inician sesión. */
export async function login(correo: string, contrasena: string) {
  const user = await repo.findUserByEmail(correo);
  const ok = await bcrypt.compare(contrasena, user?.hash_password ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Correo o contraseña incorrectos');
  if (!user.activo) throw unauthorized('El usuario está inactivo');
  return { ...(await issueTokens(user.id)), user: await profile(user.id) };
}

export async function refresh(refreshToken: string) {
  const session = await withTransaction(null, (db) => repo.consumeRefresh(sha256(refreshToken), db));
  if (!session) throw unauthorized('Sesión de renovación inválida o expirada');
  const user = await profile(session.usuario_id);
  return { ...(await issueTokens(user.id)), user };
}

export async function logout(refreshToken: string) {
  await repo.revokeRefresh(sha256(refreshToken));
}

export { profile };
