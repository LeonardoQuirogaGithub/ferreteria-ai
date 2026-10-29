import pg from 'pg';
import { env } from '../config/env.js';

// NUMERIC llega como texto: se conserva así para operar con decimal.js sin pérdida de precisión.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
});

export type Db = pg.Pool | pg.PoolClient;

export interface OperationContext {
  usuarioId: number;
  origen?: 'online' | 'offline';
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const result = await db.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | undefined> {
  const rows = await query<T>(text, params, db);
  return rows[0];
}

/**
 * Ejecuta `fn` en una transacción y fija el usuario y origen que leen los triggers de auditoría
 * (app.usuario_id / app.origen). Cualquier error revierte la operación completa (RNF-FIA-001).
 */
export async function withTransaction<T>(
  ctx: OperationContext | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (ctx) {
      await client.query(`SELECT set_config('app.usuario_id', $1, true), set_config('app.origen', $2, true)`, [
        String(ctx.usuarioId),
        ctx.origen ?? 'online',
      ]);
    }
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
