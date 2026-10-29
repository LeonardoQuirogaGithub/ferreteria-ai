import { query, queryOne, type Db } from '../../db/pool.js';
import type { AuthUser } from '../../middlewares/auth.js';

const USER_WITH_PERMISSIONS = `
  SELECT u.id, u.nombre, u.correo,
         COALESCE(array_agg(DISTINCT r.nombre) FILTER (WHERE r.id IS NOT NULL), '{}') AS roles,
         COALESCE(array_agg(DISTINCT p.codigo) FILTER (WHERE p.id IS NOT NULL), '{}') AS permisos
    FROM usuario u
    LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id
    LEFT JOIN rol r ON r.id = ur.rol_id
    LEFT JOIN rol_permiso rp ON rp.rol_id = r.id
    LEFT JOIN permiso p ON p.id = rp.permiso_id
   WHERE u.id = $1 AND u.activo
   GROUP BY u.id`;

export const findActiveUserWithPermissions = (id: number) => queryOne<AuthUser>(USER_WITH_PERMISSIONS, [id]);

export const findUserByEmail = (correo: string) =>
  queryOne<{ id: number; hash_password: string; activo: boolean }>(
    'SELECT id, hash_password, activo FROM usuario WHERE lower(correo) = lower($1)',
    [correo],
  );

export async function insertRefresh(usuarioId: number, tokenHash: string, expiraEn: Date, db?: Db) {
  await query('INSERT INTO sesion_refresh(usuario_id, token_hash, expira_en) VALUES ($1, $2, $3)', [usuarioId, tokenHash, expiraEn], db);
}

/** Revoca y devuelve la sesión si estaba vigente (rotación de un solo uso). */
export const consumeRefresh = (tokenHash: string, db?: Db) =>
  queryOne<{ usuario_id: number }>(
    `UPDATE sesion_refresh SET revocado_en = now()
      WHERE token_hash = $1 AND revocado_en IS NULL AND expira_en > now()
      RETURNING usuario_id`,
    [tokenHash],
    db,
  );

export const revokeRefresh = (tokenHash: string) =>
  query('UPDATE sesion_refresh SET revocado_en = now() WHERE token_hash = $1 AND revocado_en IS NULL', [tokenHash]);
